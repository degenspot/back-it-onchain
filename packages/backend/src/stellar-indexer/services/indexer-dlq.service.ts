import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Job, JobState } from 'bullmq';

export const INDEXER_DLQ_QUEUE = 'indexer-dlq';

export interface DlqJobData {
  contractId: string;
  ledger: number;
  rawXdr: string;
  errorMessage: string;
  errorStack?: string;
  failedAt: string;
  attemptsMade: number;
}

@Injectable()
export class IndexerDlqService implements OnModuleInit {
  private readonly logger = new Logger(IndexerDlqService.name);
  private queue: Queue<DlqJobData>;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const redisUrl = this.config.get<string>('REDIS_URL');

    if (!redisUrl) {
      this.logger.warn('REDIS_URL not set — DLQ is disabled (no-op mode)');
      return;
    }

    const url = new URL(redisUrl);
    const ttlMs = this.config.get<number>('INDEXER_DLQ_JOB_TTL_MS', 7 * 24 * 60 * 60 * 1000);
    const ttlSec = Math.floor(ttlMs / 1000);

    this.queue = new Queue<DlqJobData>(INDEXER_DLQ_QUEUE, {
      connection: {
        host: url.hostname,
        port: parseInt(url.port || '6379', 10),
        password: url.password || undefined,
        tls: url.protocol === 'rediss:' ? {} : undefined,
      },
      defaultJobOptions: {
        // Jobs stay in completed/failed sets for the configured TTL
        removeOnComplete: { age: ttlSec },
        removeOnFail: false,
        attempts: 1, // DLQ jobs are not auto-retried by BullMQ itself
      },
    });

    this.logger.log('Indexer DLQ queue initialised');
  }

  /**
   * Park a failed indexer event into the DLQ and fire a Discord alert.
   */
  async addFailedEvent(data: DlqJobData): Promise<void> {
    if (!this.queue) {
      this.logger.warn(
        `DLQ disabled — dropping failed event for contract ${data.contractId} at ledger ${data.ledger}`,
      );
      return;
    }

    const job = await this.queue.add('failed-event', data, {
      jobId: `${data.contractId}:${data.ledger}:${data.failedAt}`,
    });

    this.logger.warn(
      `DLQ: parked job ${job.id} — contract=${data.contractId} ledger=${data.ledger} error="${data.errorMessage}"`,
    );

    await this.notifyWebhook(job.id!, data);
  }

  /**
   * List jobs in the DLQ. Defaults to the 'failed' set; pass a different
   * state to inspect waiting/completed entries too.
   */
  async listJobs(state: JobState = 'failed', start = 0, end = 49): Promise<Job<DlqJobData>[]> {
    if (!this.queue) return [];
    return this.queue.getJobs([state], start, end);
  }

  /**
   * Re-drive a single job by its ID: clone it back into the queue as a new
   * waiting job so the consumer can process it again.
   */
  async retryJob(jobId: string): Promise<{ queued: boolean; newJobId: string | undefined }> {
    if (!this.queue) {
      return { queued: false, newJobId: undefined };
    }

    const job = await Job.fromId<DlqJobData>(this.queue, jobId);
    if (!job) {
      return { queued: false, newJobId: undefined };
    }

    // Add a fresh copy — the caller can edit data before re-drive if needed
    const newJob = await this.queue.add('failed-event', job.data, {
      // Remove the fixed jobId so it can be queued alongside the original
    });

    this.logger.log(`DLQ: re-queued job ${jobId} as new job ${newJob.id}`);
    return { queued: true, newJobId: newJob.id };
  }

  /**
   * Re-drive a job with caller-supplied overrides on the raw event data.
   * Useful when an operator fixes a bad XDR before re-processing.
   */
  async retryJobWithData(
    jobId: string,
    patch: Partial<DlqJobData>,
  ): Promise<{ queued: boolean; newJobId: string | undefined }> {
    if (!this.queue) {
      return { queued: false, newJobId: undefined };
    }

    const job = await Job.fromId<DlqJobData>(this.queue, jobId);
    if (!job) {
      return { queued: false, newJobId: undefined };
    }

    const newJob = await this.queue.add('failed-event', { ...job.data, ...patch });
    this.logger.log(`DLQ: re-queued job ${jobId} with overrides as new job ${newJob.id}`);
    return { queued: true, newJobId: newJob.id };
  }

  // ── private ──────────────────────────────────────────────────────────────

  private async notifyWebhook(jobId: string, data: DlqJobData): Promise<void> {
    const webhookUrl = this.config.get<string>('DISCORD_ADMIN_WEBHOOK_URL');
    if (!webhookUrl) return;

    const message =
      `🚨 **Indexer DLQ Entry** 🚨\n` +
      `Job: \`${jobId}\`\n` +
      `Contract: \`${data.contractId}\`  |  Ledger: ${data.ledger}\n` +
      `Error: ${data.errorMessage}`;

    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: message }),
      });
    } catch (err) {
      this.logger.error(`Failed to send DLQ webhook alert: ${(err as Error).message}`);
    }
  }
}
