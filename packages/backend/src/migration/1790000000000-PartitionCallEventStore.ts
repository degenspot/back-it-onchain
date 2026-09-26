import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PartitionCallEventStore1790000000000 — BE-005.
 *
 * Range-partitions the raw chain event store by ledger height so archival
 * scans touch one partition instead of the whole table, and adds the composite
 * B-Tree index the event queries actually use.
 *
 * Two deliberate departures from the issue text, both explained in the PR:
 *
 *  - The issue names a `call_event_store` table partitioned on
 *    `ledger_sequence`. Neither exists: `CallEventStoreService` writes into the
 *    `calls` table, and the column is `ledgerHeight`. This creates the named
 *    table with the repository's camelCase column convention, populated from
 *    `calls`, rather than rewriting the live table in place.
 *  - `calls` is left untouched. Converting it would mean making `ledgerHeight`
 *    NOT NULL (Postgres requires the partition key in the primary key), which
 *    changes "height unknown" into a real height. That is a data-semantics
 *    decision for the maintainers, not a migration side effect — and the issue
 *    guideline asks for backward compatibility with non-partitioned
 *    environments.
 */

/** Ledgers per partition, per the issue's 100,000 suggestion. */
const PARTITION_SPAN = 100_000;

/** Partitions created ahead of the current head at migration time. */
const PARTITIONS_AHEAD = 4;

export class PartitionCallEventStore1790000000000 implements MigrationInterface {
  name = 'PartitionCallEventStore1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Idempotent: a re-run against an already-migrated database is a no-op.
    const exists = await queryRunner.query(`
      SELECT 1 FROM pg_class WHERE relname = 'call_event_store' LIMIT 1;
    `);
    if (exists.length > 0) return;

    await queryRunner.query(`
      CREATE TABLE "call_event_store" (
        "id"                  uuid NOT NULL DEFAULT gen_random_uuid(),
        "chain"               varchar(16) NOT NULL DEFAULT 'base',
        "txHash"              varchar NOT NULL,
        "contractId"          varchar,
        "stellarContractId"   varchar,
        "baseContractAddress" varchar,
        "eventData"           jsonb,
        "ledgerHeight"        bigint NOT NULL,
        "eventType"           varchar,
        "eventSequence"       integer,
        "blockHash"           varchar,
        "isOrphaned"          boolean NOT NULL DEFAULT false,
        "createdAt"           TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"           TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_call_event_store" PRIMARY KEY ("id", "ledgerHeight")
      ) PARTITION BY RANGE ("ledgerHeight");
    `);

    // Catches heights outside every declared range. Without it an insert
    // beyond the highest partition fails outright, which would stall
    // ingestion the moment the chain runs past the last partition created.
    await queryRunner.query(`
      CREATE TABLE "call_event_store_default"
        PARTITION OF "call_event_store" DEFAULT;
    `);

    /*
     * Creates a partition for the range containing `height`, if absent.
     *
     * Declared here rather than in application code so scheduled maintenance
     * and the migration share one definition of where boundaries fall.
     */
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION ensure_call_event_partition(height bigint)
      RETURNS text AS $$
      DECLARE
        span      bigint := ${PARTITION_SPAN};
        range_start bigint := (height / span) * span;
        range_end   bigint := ((height / span) + 1) * span;
        part_name text;
      BEGIN
        part_name := format('call_event_store_p%s', range_start);
        IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
          EXECUTE format(
            'CREATE TABLE %I PARTITION OF "call_event_store" FOR VALUES FROM (%s) TO (%s)',
            part_name, range_start, range_end
          );
        END IF;
        RETURN part_name;
      END;
      $$ LANGUAGE plpgsql;
    `);

    /*
     * Creates every partition needed to cover existing rows, plus a few ahead
     * of the current head so ingestion does not immediately fall into the
     * default partition.
     */
    await queryRunner.query(`
      DO $$
      DECLARE
        span      bigint := ${PARTITION_SPAN};
        min_h     bigint;
        max_h     bigint;
        cursor_h  bigint;
      BEGIN
        SELECT COALESCE(MIN("ledgerHeight"), 0),
               COALESCE(MAX("ledgerHeight"), 0)
          INTO min_h, max_h
          FROM "calls"
         WHERE "ledgerHeight" IS NOT NULL;

        cursor_h := (min_h / span) * span;
        WHILE cursor_h <= max_h + (span * ${PARTITIONS_AHEAD}) LOOP
          PERFORM ensure_call_event_partition(cursor_h);
          cursor_h := cursor_h + span;
        END LOOP;
      END $$;
    `);

    /*
     * Backfill. Rows with a NULL ledgerHeight are skipped rather than
     * defaulted: the partition key is NOT NULL, and inventing a height for an
     * event whose height was never recorded would put it in a range it does
     * not belong to. They stay readable in `calls`.
     */
    await queryRunner.query(`
      INSERT INTO "call_event_store" (
        "id", "chain", "txHash", "contractId", "stellarContractId",
        "baseContractAddress", "eventData", "ledgerHeight", "eventType",
        "eventSequence", "blockHash", "isOrphaned", "createdAt", "updatedAt"
      )
      SELECT
        "id", "chain"::text, "txHash", "contractId", "stellarContractId",
        "baseContractAddress", "eventData", "ledgerHeight", "eventType",
        "eventSequence", "blockHash", "isOrphaned", "createdAt", "updatedAt"
      FROM "calls"
      WHERE "ledgerHeight" IS NOT NULL;
    `);

    // The composite the issue calls for: (contract_id, topic0, ledger_sequence)
    // in this schema's terms. Ordered most to least selective for the range
    // scans this table exists to serve.
    await queryRunner.query(`
      CREATE INDEX "idx_ces_contract_event_ledger"
        ON "call_event_store" ("contractId", "eventType", "ledgerHeight");
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_ces_chain_tx"
        ON "call_event_store" ("chain", "txHash");
    `);

    // Same composite on `calls`, which still serves live reads. Independently
    // useful whether or not the partitioned table is adopted.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_calls_contract_event_ledger"
        ON "calls" ("contractId", "eventType", "ledgerHeight");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Dropping the parent removes every partition with it.
    await queryRunner.query(`DROP TABLE IF EXISTS "call_event_store" CASCADE;`);
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS ensure_call_event_partition(bigint);`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_calls_contract_event_ledger";`,
    );
  }
}
