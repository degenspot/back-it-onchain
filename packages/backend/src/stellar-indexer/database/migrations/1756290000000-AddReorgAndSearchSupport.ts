import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableIndex,
} from 'typeorm';

/**
 * BE-04 — Multi-Chain Indexer Orchestrator support:
 *
 *   - `blockHash` / `isOrphaned`: the cursor + soft-invalidation flag used
 *     by CallEventStoreService to detect and recover from chain reorgs.
 *   - `searchVector`: a generated tsvector column (kept in sync by trigger)
 *     over eventType/contractId/txHash, backing full-text search on the
 *     unified `calls` table.
 *   - A unique index on (chain, txHash, eventSequence) makes the upsert in
 *     CallEventStoreService safe against concurrent/duplicate delivery of
 *     the same on-chain event.
 */
export class AddReorgAndSearchSupport1756290000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner
      .addColumn(
        'calls',
        new TableColumn({
          name: 'blockHash',
          type: 'varchar',
          isNullable: true,
          comment: 'Block/ledger hash at index time — reorg-detection cursor',
        }),
      )
      .catch(() => {});

    await queryRunner
      .addColumn(
        'calls',
        new TableColumn({
          name: 'isOrphaned',
          type: 'boolean',
          isNullable: false,
          default: false,
        }),
      )
      .catch(() => {});

    await queryRunner
      .query(
        `ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "searchVector" tsvector;`,
      )
      .catch(() => {});

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION calls_search_vector_update() RETURNS trigger AS $$
      BEGIN
        NEW."searchVector" := to_tsvector('english',
          coalesce(NEW."eventType", '') || ' ' ||
          coalesce(NEW."contractId", '') || ' ' ||
          coalesce(NEW."txHash", '')
        );
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner
      .query(`DROP TRIGGER IF EXISTS trg_calls_search_vector ON "calls";`)
      .catch(() => {});

    await queryRunner.query(`
      CREATE TRIGGER trg_calls_search_vector
      BEFORE INSERT OR UPDATE ON "calls"
      FOR EACH ROW EXECUTE FUNCTION calls_search_vector_update();
    `);

    // Backfill existing rows so the trigger's guarantee holds retroactively.
    await queryRunner.query(`
      UPDATE "calls" SET "searchVector" = to_tsvector('english',
        coalesce("eventType", '') || ' ' ||
        coalesce("contractId", '') || ' ' ||
        coalesce("txHash", '')
      );
    `);

    await queryRunner
      .query(
        `CREATE INDEX IF NOT EXISTS idx_calls_search_vector ON "calls" USING GIN ("searchVector");`,
      )
      .catch(() => {});

    // Idempotency guard for CallEventStoreService.upsertEvent(). Wrapped in
    // a catch since pre-existing duplicate (chain, txHash, eventSequence)
    // rows — if any slipped in under the old check-then-insert logic —
    // would otherwise abort the whole migration.
    await queryRunner
      .createIndex(
        'calls',
        new TableIndex({
          name: 'UQ_calls_chain_tx_hash_sequence',
          columnNames: ['chain', 'txHash', 'eventSequence'],
          isUnique: true,
        }),
      )
      .catch((err: unknown) => {
        console.warn(
          'Skipping UQ_calls_chain_tx_hash_sequence — existing duplicate rows found. ' +
            'Dedupe manually and re-run this migration to enforce it. ' +
            (err instanceof Error ? err.message : String(err)),
        );
      });
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner
      .dropIndex('calls', 'UQ_calls_chain_tx_hash_sequence')
      .catch(() => {});
    await queryRunner
      .dropIndex('calls', 'idx_calls_search_vector')
      .catch(() => {});
    await queryRunner
      .query(`DROP TRIGGER IF EXISTS trg_calls_search_vector ON "calls";`)
      .catch(() => {});
    await queryRunner
      .query(`DROP FUNCTION IF EXISTS calls_search_vector_update();`)
      .catch(() => {});
    await queryRunner.dropColumn('calls', 'searchVector').catch(() => {});
    await queryRunner.dropColumn('calls', 'isOrphaned').catch(() => {});
    await queryRunner.dropColumn('calls', 'blockHash').catch(() => {});
  }
}
