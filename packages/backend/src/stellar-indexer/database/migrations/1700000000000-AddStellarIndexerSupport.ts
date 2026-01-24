import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddStellarIndexerSupport1700000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum type for chain
    await queryRunner.query(`
      CREATE TYPE chain_enum AS ENUM ('base', 'stellar');
    `).catch(() => {
      // Type might already exist
    });

    // Add chain column with default 'base' for backward compatibility
    await queryRunner.addColumn(
      'calls',
      new TableColumn({
        name: 'chain',
        type: 'chain_enum',
        default: "'base'",
        isNullable: false,
      }),
    ).catch(() => {
      // Column might already exist
    });

    // Add stellar_tx_hash column
    await queryRunner.addColumn(
      'calls',
      new TableColumn({
        name: 'stellar_tx_hash',
        type: 'varchar',
        isNullable: true,
        comment: 'Stellar transaction hash',
      }),
    ).catch(() => {
      // Column might already exist
    });

    // Add stellar_contract_id column
    await queryRunner.addColumn(
      'calls',
      new TableColumn({
        name: 'stellar_contract_id',
        type: 'varchar',
        isNullable: true,
        comment: 'Stellar contract ID in XDR format',
      }),
    ).catch(() => {
      // Column might already exist
    });

    // Add indexes for better query performance
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_calls_chain_tx_hash 
      ON calls(chain, tx_hash);
    `).catch(() => {});

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_calls_stellar_contract_id 
      ON calls(stellar_contract_id) 
      WHERE chain = 'stellar';
    `).catch(() => {});
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('calls', 'stellar_contract_id').catch(() => {});
    await queryRunner.dropColumn('calls', 'stellar_tx_hash').catch(() => {});
    await queryRunner.dropColumn('calls', 'chain').catch(() => {});

    await queryRunner.query(`DROP TYPE IF EXISTS chain_enum`).catch(() => {});
  }
}
