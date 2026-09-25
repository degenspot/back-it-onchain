import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';

import { Eip712Domain, Eip712Types } from './key-signer';

/**
 * quorum-consensus.service.ts
 *
 * BE-017 — multi-signer quorum for decentralised oracle resolution.
 *
 * One oracle node deciding a resolution is a single point of failure and a
 * single point of trust: whoever controls it can resolve any market. This
 * service collects signed votes from an independent node set over a pub/sub
 * channel and only reports a resolution once M distinct, verified nodes agree
 * on the *same* payload.
 *
 * What counts as a valid vote:
 *
 *   - the signature must recover (EIP-712) to an address in the registered
 *     node set — an unknown signer is rejected, not counted;
 *   - it must recover against the payload this round asked about, so a node
 *     that signs a different outcome is rejected rather than counted;
 *   - a node voting twice is counted once.
 *
 * If M votes are not reached before the deadline the round aborts; it never
 * throws, so one silent or slow node cannot stall the pipeline. Every decision
 * logs how long consensus took.
 */

export interface ResolutionPayload {
  domain: Eip712Domain;
  types: Eip712Types;
  value: Record<string, unknown>;
}

export interface QuorumVote {
  /** Address recovered from the signature, never taken from the wire. */
  signer: string;
  signature: string;
}

export interface QuorumRejection {
  reason: 'unknown-signer' | 'wrong-payload' | 'unverifiable';
  signature: string;
  detail?: string;
}

export interface QuorumOutcome {
  converged: boolean;
  payloadHash: string;
  threshold: number;
  nodeCount: number;
  signers: string[];
  signatures: string[];
  /** Stable hash of the collected signature set — the value submitted on-chain. */
  aggregate: string;
  latencyMs: number;
  reason?: 'timeout' | 'no-nodes' | 'no-transport';
  rejections: QuorumRejection[];
}

interface RequestMessage {
  type: 'resolution-request';
  roundId: string;
  payload: ResolutionPayload;
  deadline: number;
}

interface VoteMessage {
  type: 'resolution-vote';
  roundId: string;
  signature: string;
}

/**
 * Pub/sub seam. The consensus protocol does not care whether the messages
 * travel through Redis, NATS or one process — only that every node sees every
 * request and every vote.
 */
export interface QuorumTransport {
  publish(channel: string, message: unknown): Promise<void>;
  subscribe(
    channel: string,
    handler: (message: unknown) => void,
  ): Promise<() => Promise<void>>;
}

export const QUORUM_TRANSPORT = Symbol('QUORUM_TRANSPORT');

/** Any ioredis-compatible client: the three calls pub/sub actually needs. */
export interface RedisPubSubClient {
  publish(channel: string, payload: string): Promise<unknown>;
  subscribe(channel: string): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  on(
    event: 'message',
    handler: (channel: string, payload: string) => void,
  ): unknown;
}

/** In-process transport: one process hosting every node (dev, tests). */
export class InMemoryQuorumTransport implements QuorumTransport {
  private readonly handlers = new Map<
    string,
    Set<(message: unknown) => void>
  >();

  publish(channel: string, message: unknown): Promise<void> {
    const subscribers = this.handlers.get(channel);
    if (!subscribers) return Promise.resolve();
    // A node that throws while handling a message must not stop the others.
    for (const handler of [...subscribers]) {
      try {
        handler(message);
      } catch {
        /* ignore: the transport is not the place to handle node errors */
      }
    }
    return Promise.resolve();
  }

  subscribe(
    channel: string,
    handler: (message: unknown) => void,
  ): Promise<() => Promise<void>> {
    const subscribers = this.handlers.get(channel) ?? new Set();
    subscribers.add(handler);
    this.handlers.set(channel, subscribers);
    return Promise.resolve(() => {
      subscribers.delete(handler);
      return Promise.resolve();
    });
  }
}

/**
 * Redis pub/sub transport. Takes the client instead of constructing one, so
 * the module wires whichever client the deployment already uses (the repo
 * ships cache-manager/Keyv, which has no pub/sub of its own).
 *
 * Each subscriber needs its own connection: a client in subscribe mode cannot
 * publish. Pass a dedicated client built with `client.duplicate()`.
 */
export class RedisPubSubTransport implements QuorumTransport {
  private readonly handlers = new Map<
    string,
    Set<(message: unknown) => void>
  >();

  constructor(private readonly client: RedisPubSubClient) {
    this.client.on('message', (channel: string, payload: string) => {
      const subscribers = this.handlers.get(channel);
      if (!subscribers) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return;
      }
      for (const handler of [...subscribers]) {
        try {
          handler(parsed);
        } catch {
          /* ignore: see InMemoryQuorumTransport */
        }
      }
    });
  }

  async publish(channel: string, message: unknown): Promise<void> {
    await this.client.publish(channel, JSON.stringify(message));
  }

  async subscribe(
    channel: string,
    handler: (message: unknown) => void,
  ): Promise<() => Promise<void>> {
    const subscribers = this.handlers.get(channel) ?? new Set();
    subscribers.add(handler);
    this.handlers.set(channel, subscribers);
    if (subscribers.size === 1) await this.client.subscribe(channel);
    return () => {
      subscribers.delete(handler);
      return subscribers.size === 0
        ? this.client.unsubscribe(channel).then(() => undefined)
        : Promise.resolve();
    };
  }
}

export interface QuorumConfig {
  /** Signatures required to resolve (M). */
  threshold: number;
  /** Seconds to wait for M votes before aborting. */
  timeoutMs: number;
  /** Channel prefix; each round gets its own topic under it. */
  channel: string;
}

export const DEFAULT_QUORUM_CONFIG: QuorumConfig = {
  threshold: 2,
  timeoutMs: 5_000,
  channel: 'oracle:resolution',
};

@Injectable()
export class QuorumConsensusService {
  private readonly logger = new Logger(QuorumConsensusService.name);
  private readonly config: QuorumConfig;
  private nodes = new Set<string>();
  private round = 0;
  private static readonly MAX_NODE_COUNT = 64;

  constructor(
    private readonly configService: ConfigService,
    @Optional()
    @Inject(QUORUM_TRANSPORT)
    private readonly transport?: QuorumTransport,
  ) {
    this.config = {
      threshold: this.readInt(
        'ORACLE_QUORUM_THRESHOLD',
        DEFAULT_QUORUM_CONFIG.threshold,
      ),
      timeoutMs: this.readInt(
        'ORACLE_QUORUM_TIMEOUT_MS',
        DEFAULT_QUORUM_CONFIG.timeoutMs,
      ),
      channel:
        this.configService.get<string>('ORACLE_QUORUM_CHANNEL') ??
        DEFAULT_QUORUM_CONFIG.channel,
    };
  }

  private readInt(key: string, fallback: number): number {
    const raw = this.configService.get<string | number>(key);
    const parsed =
      typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  getConfig(): QuorumConfig {
    return { ...this.config };
  }

  /**
   * Replaces the trusted node set. Addresses are compared case-insensitively,
   * so a checksummed and a lowercase form of the same key are one node.
   */
  registerNodes(addresses: string[]): {
    registered: number;
    ignored: string[];
  } {
    const ignored: string[] = [];
    const next = new Set<string>();

    for (const address of addresses) {
      if (!ethers.isAddress(address)) {
        ignored.push(address);
        continue;
      }
      next.add(address.toLowerCase());
    }

    if (next.size > QuorumConsensusService.MAX_NODE_COUNT) {
      throw new Error(
        `node set too large: ${next.size} > ${QuorumConsensusService.MAX_NODE_COUNT}`,
      );
    }

    this.nodes = next;
    if (ignored.length > 0) {
      this.logger.warn(`ignored ${ignored.length} malformed node address(es)`);
    }
    return { registered: next.size, ignored };
  }

  getNodes(): string[] {
    return [...this.nodes];
  }

  /** Canonical hash of a payload — what signatures are bound to. */
  hashPayload(payload: ResolutionPayload): string {
    return ethers.keccak256(ethers.toUtf8Bytes(canonicalise(payload)));
  }

  /**
   * Asks the node set to sign `payload` and waits for M verified, distinct
   * votes. Never throws and never waits longer than the deadline.
   */
  async resolve(
    payload: ResolutionPayload,
    overrides: Partial<Pick<QuorumConfig, 'threshold' | 'timeoutMs'>> = {},
  ): Promise<QuorumOutcome> {
    const threshold = overrides.threshold ?? this.config.threshold;
    const timeoutMs = overrides.timeoutMs ?? this.config.timeoutMs;
    const payloadHash = this.hashPayload(payload);
    const startedAt = Date.now();

    const outcome = (
      partial: Partial<QuorumOutcome> & { converged: boolean },
    ): QuorumOutcome => ({
      payloadHash,
      threshold,
      nodeCount: this.nodes.size,
      signers: [],
      signatures: [],
      aggregate: '',
      latencyMs: Date.now() - startedAt,
      rejections: [],
      ...partial,
    });

    if (this.nodes.size === 0) {
      return outcome({ converged: false, reason: 'no-nodes' });
    }

    // A threshold above the number of possible signers can never be reached;
    // failing fast beats burning the deadline.
    if (threshold > this.nodes.size) {
      return outcome({
        converged: false,
        reason: 'no-nodes',
        rejections: [
          {
            reason: 'unverifiable',
            signature: '',
            detail: `threshold ${threshold} exceeds node count ${this.nodes.size}`,
          },
        ],
      });
    }

    if (!this.transport) {
      return outcome({ converged: false, reason: 'no-transport' });
    }

    const roundId = this.newRoundId();
    // One long-lived topic, not one per round: a node has to be subscribed
    // before the request it would answer is published, so the topic cannot be
    // derived from the round. Votes are filtered by roundId instead.
    const channel = this.config.channel;
    const votes = new Map<string, QuorumVote>();
    const rejections: QuorumRejection[] = [];

    let settle: (outcome: QuorumOutcome) => void = () => {};

    const done = new Promise<QuorumOutcome>((resolve) => {
      settle = resolve;
    });

    const unsubscribe = await this.transport.subscribe(channel, (message) => {
      const vote = asVote(message);
      if (!vote || vote.roundId !== roundId) return;

      const verified = this.verifyVote(vote.signature, payload);
      if (!verified.ok) {
        rejections.push({
          reason: verified.reason,
          signature: vote.signature,
          detail: verified.detail,
        });
        return;
      }

      if (votes.has(verified.signer)) return; // double vote, same weight

      votes.set(verified.signer, {
        signer: verified.signer,
        signature: vote.signature,
      });

      if (votes.size >= threshold) {
        settle(
          outcome({
            converged: true,
            signers: [...votes.keys()].sort(),
            signatures: [...votes.values()].map((v) => v.signature),
            aggregate: this.aggregate([...votes.values()]),
            rejections,
          }),
        );
      }
    });

    const timer = setTimeout(() => {
      settle(
        outcome({
          converged: false,
          reason: 'timeout',
          signers: [...votes.keys()].sort(),
          signatures: [...votes.values()].map((v) => v.signature),
          rejections,
        }),
      );
    }, timeoutMs);

    const request: RequestMessage = {
      type: 'resolution-request',
      roundId,
      payload,
      deadline: Date.now() + timeoutMs,
    };

    await this.transport.publish(channel, request);

    const result = await done;
    clearTimeout(timer);
    await unsubscribe();

    if (result.converged) {
      this.logger.log(
        `quorum reached for round ${roundId}: ${result.signers.length}/${result.threshold} signers in ${result.latencyMs}ms (${result.rejections.length} rejected)`,
      );
    } else {
      this.logger.warn(
        `quorum failed for round ${roundId} after ${result.latencyMs}ms: ${result.reason} (${result.signers.length}/${result.threshold} verified votes)`,
      );
    }

    return result;
  }

  /**
   * A node's own contribution: publish its signature for a round. Nodes call
   * this in response to a resolution-request they received on the same topic.
   */
  async vote(signature: string, roundId: string): Promise<void> {
    if (!this.transport) return;
    const message: VoteMessage = {
      type: 'resolution-vote',
      roundId,
      signature,
    };
    await this.transport.publish(this.config.channel, message);
  }

  private verifyVote(
    signature: string,
    payload: ResolutionPayload,
  ):
    | { ok: true; signer: string }
    | { ok: false; reason: QuorumRejection['reason']; detail?: string } {
    let signer: string;
    try {
      signer = ethers.verifyTypedData(
        payload.domain,
        payload.types,
        payload.value,
        signature,
      );
    } catch (error) {
      return {
        ok: false,
        reason: 'unverifiable',
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    const normalised = signer.toLowerCase();
    if (!this.nodes.has(normalised)) {
      return { ok: false, reason: 'unknown-signer', detail: signer };
    }

    return { ok: true, signer: normalised };
  }

  /**
   * The value that goes on-chain: a hash over the sorted signature set, so the
   * same M signatures always aggregate to the same value.
   */
  private aggregate(votes: QuorumVote[]): string {
    const sorted = [...votes]
      .map((v) => v.signature.toLowerCase())
      .sort()
      .join(',');
    return ethers.keccak256(ethers.toUtf8Bytes(sorted));
  }

  private newRoundId(): string {
    this.round += 1;
    return `${Date.now().toString(36)}-${this.round}`;
  }
}

function asVote(message: unknown): VoteMessage | null {
  if (!message || typeof message !== 'object') return null;
  const candidate = message as Partial<VoteMessage>;
  if (candidate.type !== 'resolution-vote') return null;
  if (typeof candidate.roundId !== 'string') return null;
  if (
    typeof candidate.signature !== 'string' ||
    candidate.signature.length === 0
  ) {
    return null;
  }
  return candidate as VoteMessage;
}

/**
 * Deterministic JSON: object keys sorted, so two nodes serialising the same
 * payload cannot bind their signatures to different bytes.
 */
function canonicalise(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v)]));
  }
  return value;
}
