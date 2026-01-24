/**
 * Example Oracle Implementation
 * 
 * This demonstrates how to set up an oracle that can submit outcomes
 * to the OutcomeManager contract.
 */

import {
  generateOracleKeypair,
  OracleSigner,
  calculatePayout,
  canSettleCall,
  prepareOutcomeSubmission,
  AuditTrail,
  uint8ArrayToHex,
} from './integration';

/**
 * Oracle Service
 * Responsible for:
 * - Monitoring calls that need settlement
 * - Gathering outcome data from price feeds
 * - Signing and submitting outcomes
 * - Logging audit trail
 */
export class OracleService {
  private signer: OracleSigner;
  private contractAddress: string;
  private auditTrail: AuditTrail;

  constructor(
    contractAddress: string,
    keypair: Awaited<ReturnType<typeof generateOracleKeypair>>
  ) {
    this.contractAddress = contractAddress;
    this.signer = new OracleSigner(keypair);
    this.auditTrail = new AuditTrail();
  }

  /**
   * Get oracle's public key for authorization
   */
  getPublicKey(): string {
    return uint8ArrayToHex(this.signer.getPublicKey());
  }

  /**
   * Get contract address
   */
  getContractAddress(): string {
    return this.contractAddress;
  }

  /**
   * Main function - settle a call with outcome
   */
  async settleCall(
    callId: bigint,
    outcome: boolean,
    finalPrice: bigint,
    currentTimestamp: bigint,
    callEndTimestamp: bigint
  ): Promise<{
    call_id: bigint;
    outcome: boolean;
    final_price: bigint;
    timestamp: bigint;
    oracle_pubkey: Uint8Array;
    signature: Uint8Array;
  }> {
    // Verify call can be settled
    if (!canSettleCall(currentTimestamp, callEndTimestamp)) {
      throw new Error(
        `Call ${callId} cannot be settled yet. End time: ${callEndTimestamp}, Current: ${currentTimestamp}`
      );
    }

    // Prepare submission with signature
    const submission = await prepareOutcomeSubmission(
      callId,
      outcome,
      finalPrice,
      currentTimestamp,
      this.signer
    );

    // Log to audit trail
    this.auditTrail.addEntry({
      timestamp: currentTimestamp,
      callId,
      outcome,
      finalPrice,
      oracleAddress: this.getPublicKey(),
      signature: uint8ArrayToHex(submission.signature),
    });

    return submission;
  }

  /**
   * Simulate settling multiple calls from a price feed
   */
  async settleCallsFromPriceFeed(
    calls: Array<{
      callId: bigint;
      endTimestamp: bigint;
      priceSource: () => Promise<bigint>; // Function to fetch final price
      outcomeLogic: (price: bigint) => boolean; // Function to determine outcome based on price
    }>,
    currentTimestamp: bigint
  ): Promise<
    Array<{
      call_id: bigint;
      outcome: boolean;
      final_price: bigint;
      timestamp: bigint;
      oracle_pubkey: Uint8Array;
      signature: Uint8Array;
    }>
  > {
    const submissions = [];

    for (const call of calls) {
      if (!canSettleCall(currentTimestamp, call.endTimestamp)) {
        console.log(
          `Skipping call ${call.callId} - not yet ready for settlement`
        );
        continue;
      }

      try {
        const finalPrice = await call.priceSource();
        const outcome = call.outcomeLogic(finalPrice);

        const submission = await this.settleCall(
          call.callId,
          outcome,
          finalPrice,
          currentTimestamp,
          call.endTimestamp
        );

        submissions.push(submission);
      } catch (error) {
        console.error(`Error settling call ${call.callId}:`, error);
      }
    }

    return submissions;
  }

  /**
   * Get audit trail for verification
   */
  getAuditTrail() {
    return this.auditTrail.getEntries();
  }

  /**
   * Export audit trail as JSON
   */
  exportAuditTrail(): string {
    return this.auditTrail.exportJSON();
  }
}

/**
 * Example usage scenario
 */
export async function exampleOracleSetup() {
  // Step 1: Generate oracle keypair (one-time setup)
  console.log('Generating oracle keypair...');
  const seed = new Uint8Array(32);
  crypto.getRandomValues(seed); // Or load from secure storage
  const keypair = await generateOracleKeypair(seed);
  console.log('Oracle public key:', uint8ArrayToHex(keypair.publicKey));

  // Step 2: Initialize oracle service
  const contractAddress = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB5L';
  const oracle = new OracleService(contractAddress, keypair);
  console.log('Oracle initialized for contract:', oracle.getContractAddress());

  // Step 3: Example - Settle a call
  const callId = 1n;
  const callEndTimestamp = 1000000n;
  const currentTimestamp = 1000001n; // Call has ended
  const finalPrice = 105n; // Price feed shows $105
  const outcome = finalPrice > 100n; // Outcome based on price

  console.log('\nSettling call...');
  const submission = await oracle.settleCall(
    callId,
    outcome,
    finalPrice,
    currentTimestamp,
    callEndTimestamp
  );

  console.log('Submission prepared:', {
    call_id: submission.call_id.toString(),
    outcome: submission.outcome,
    final_price: submission.final_price.toString(),
    signature_hex: uint8ArrayToHex(submission.signature),
  });

  // Step 4: Example - Calculate payouts for users
  const longTokens = 1000n; // Total staked on long side
  const shortTokens = 500n; // Total staked on short side

  const longUserStake = 100n;
  const longUserPayout = calculatePayout(
    longUserStake,
    true, // Was on long side
    outcome, // Long won
    longTokens,
    shortTokens
  );

  const shortUserStake = 50n;
  const shortUserPayout = calculatePayout(
    shortUserStake,
    false, // Was on short side
    outcome, // Short lost
    longTokens,
    shortTokens
  );

  console.log('\nPayouts:');
  console.log(
    `Long user (staked ${longUserStake}): ${longUserPayout} tokens`
  );
  console.log(
    `Short user (staked ${shortUserStake}): ${shortUserPayout} tokens`
  );

  // Step 5: Example - Multiple calls settlement
  const calls = [
    {
      callId: 2n,
      endTimestamp: 1000000n,
      priceSource: async () => 110n, // Mock price feed
      outcomeLogic: (price: bigint) => price > 100n,
    },
    {
      callId: 3n,
      endTimestamp: 1100000n,
      priceSource: async () => 95n,
      outcomeLogic: (price: bigint) => price > 100n,
    },
  ];

  console.log('\nSettling multiple calls...');
  const submissions2 = await oracle.settleCallsFromPriceFeed(
    calls,
    1000001n
  );
  console.log(`Settled ${submissions2.length} calls`);

  // Step 6: Export audit trail
  console.log('\nAudit Trail:');
  console.log(oracle.exportAuditTrail());
}

/**
 * Monitor and auto-settle pattern
 */
export class OracleMonitor {
  private oracle: OracleService;
  private settlementInterval: NodeJS.Timer | null = null;
  private pendingCalls: Map<
    bigint,
    {
      endTimestamp: bigint;
      priceSource: () => Promise<bigint>;
      outcomeLogic: (price: bigint) => boolean;
    }
  > = new Map();

  constructor(oracle: OracleService) {
    this.oracle = oracle;
  }

  /**
   * Register a call for monitoring
   */
  registerCall(
    callId: bigint,
    endTimestamp: bigint,
    priceSource: () => Promise<bigint>,
    outcomeLogic: (price: bigint) => boolean
  ): void {
    this.pendingCalls.set(callId, {
      endTimestamp,
      priceSource,
      outcomeLogic,
    });
  }

  /**
   * Start monitoring - checks every interval and settles ready calls
   */
  startMonitoring(intervalSeconds: number = 60): void {
    this.settlementInterval = setInterval(async () => {
      const now = BigInt(Math.floor(Date.now() / 1000));

      const callsToSettle = Array.from(this.pendingCalls.entries())
        .filter(([_, call]) => now >= call.endTimestamp)
        .map(([callId, call]) => ({ callId, ...call }));

      for (const call of callsToSettle) {
        try {
          const finalPrice = await call.priceSource();
          const outcome = call.outcomeLogic(finalPrice);

          await this.oracle.settleCall(
            call.callId,
            outcome,
            finalPrice,
            now,
            call.endTimestamp
          );

          this.pendingCalls.delete(call.callId);
          console.log(`Settled call ${call.callId}`);
        } catch (error) {
          console.error(`Error settling call ${call.callId}:`, error);
        }
      }
    }, intervalSeconds * 1000);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.settlementInterval) {
      clearInterval(this.settlementInterval);
      this.settlementInterval = null;
    }
  }

  /**
   * Get pending calls
   */
  getPendingCalls(): bigint[] {
    return Array.from(this.pendingCalls.keys());
  }
}
