/**
 * Migration: AddMultiOutcomeTables  (BE-003)
 *
 * Creates:
 *  - `outcome_pools`: per-outcome stake bucket for multi-outcome calls
 *  - `participant_stakes`: per-wallet per-outcome stake record
 */
import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddMultiOutcomeTables1756310000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── outcome_pools ────────────────────────────────────────────────────────
    await queryRunner.createTable(
      new Table({
        name: 'outcome_pools',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'callOnchainId', type: 'varchar', isNullable: false },
          { name: 'chain', type: 'varchar', default: "'stellar'" },
          { name: 'outcomeIndex', type: 'int', isNullable: false, comment: '0-based outcome slot (max 31)' },
          { name: 'outcomeLabel', type: 'varchar', isNullable: true },
          { name: 'totalStake', type: 'decimal', precision: 36, scale: 0, default: '0', comment: 'BigInt-safe decimal string' },
          { name: 'participantCount', type: 'int', default: 0 },
          { name: 'ledgerHeight', type: 'int', isNullable: true },
          { name: 'blockHash', type: 'varchar', isNullable: true },
          { name: 'isOrphaned', type: 'boolean', default: false },
          { name: 'createdAt', type: 'timestamptz', default: 'now()' },
          { name: 'updatedAt', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex('outcome_pools', new TableIndex({
      name: 'IDX_outcome_pools_call_ledger',
      columnNames: ['callOnchainId', 'ledgerHeight'],
    })).catch(() => {});

    await queryRunner.createIndex('outcome_pools', new TableIndex({
      name: 'IDX_outcome_pools_chain_call',
      columnNames: ['chain', 'callOnchainId'],
    })).catch(() => {});

    // ── participant_stakes ────────────────────────────────────────────────────
    await queryRunner.createTable(
      new Table({
        name: 'participant_stakes',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'callOnchainId', type: 'varchar', isNullable: false },
          { name: 'chain', type: 'varchar', default: "'stellar'" },
          { name: 'wallet', type: 'varchar', isNullable: false },
          { name: 'outcomeIndex', type: 'int', isNullable: false },
          { name: 'stakeAmount', type: 'decimal', precision: 36, scale: 0, default: '0' },
          { name: 'lastLedgerHeight', type: 'int', isNullable: true },
          { name: 'lastTxHash', type: 'varchar', isNullable: true },
          { name: 'isOrphaned', type: 'boolean', default: false },
          { name: 'createdAt', type: 'timestamptz', default: 'now()' },
          { name: 'updatedAt', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex('participant_stakes', new TableIndex({
      name: 'UQ_participant_stakes_key',
      columnNames: ['chain', 'callOnchainId', 'wallet', 'outcomeIndex'],
      isUnique: true,
    })).catch(() => {});

    await queryRunner.createIndex('participant_stakes', new TableIndex({
      name: 'IDX_participant_stakes_wallet',
      columnNames: ['wallet'],
    })).catch(() => {});
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('participant_stakes', true);
    await queryRunner.dropTable('outcome_pools', true);
  }
}
