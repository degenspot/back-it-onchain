/**
 * Migration: AddLedgerCheckpointTable  (BE-002)
 *
 * Creates the `ledger_checkpoints` table that backs the durable
 * LedgerCheckpointService, storing per-stream ledger sequence numbers
 * and hash fingerprints for reorg detection.
 */
import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddLedgerCheckpointTable1756300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'ledger_checkpoints',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'streamKey',
            type: 'varchar',
            isUnique: true,
            isNullable: false,
            comment: 'Stable stream identifier, e.g. stellar:CREGISTRY,COUTCOME',
          },
          {
            name: 'ledgerSequence',
            type: 'bigint',
            isNullable: false,
            comment: 'Last fully-committed ledger sequence for this stream',
          },
          {
            name: 'ledgerHash',
            type: 'varchar',
            isNullable: true,
            comment: 'Hash/fingerprint at ledgerSequence — reorg-detection cursor',
          },
          {
            name: 'chain',
            type: 'varchar',
            default: "'stellar'",
            comment: 'Chain identifier: stellar | base',
          },
          {
            name: 'isCanonical',
            type: 'boolean',
            default: true,
            comment: 'False when superseded by a reorg checkpoint',
          },
          {
            name: 'createdAt',
            type: 'timestamptz',
            default: 'now()',
          },
          {
            name: 'updatedAt',
            type: 'timestamptz',
            default: 'now()',
          },
        ],
      }),
      true, // ifNotExists
    );

    // Index for fast canonical lookups per stream
    await queryRunner
      .createIndex(
        'ledger_checkpoints',
        new TableIndex({
          name: 'IDX_ledger_checkpoints_stream_canonical',
          columnNames: ['streamKey', 'isCanonical'],
        }),
      )
      .catch(() => {});
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('ledger_checkpoints', true);
  }
}
