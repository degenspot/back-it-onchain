import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Creates the `audit_logs` table backing `AuditLog` (src/oracle/audit-log.entity.ts).
 *
 * The entity existed before this migration but was never registered with a
 * DataSource nor backed by a table — OracleService's settlement/rotation
 * audit trail (BE-01/BE-02) needs it to actually persist.
 */
export class CreateAuditLogsTable1756289000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('audit_logs');
    if (!hasTable) {
      await queryRunner.createTable(
        new Table({
          name: 'audit_logs',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              default: 'gen_random_uuid()',
            },
            { name: 'action', type: 'varchar', isNullable: false },
            { name: 'actor', type: 'varchar', isNullable: false },
            { name: 'targetResource', type: 'varchar', isNullable: true },
            { name: 'payload', type: 'jsonb', isNullable: true },
            { name: 'evidenceCid', type: 'varchar', isNullable: true },
            { name: 'chain', type: 'varchar', isNullable: true },
            {
              name: 'createdAt',
              type: 'timestamptz',
              default: 'now()',
            },
          ],
        }),
        true,
      );
    }

    await queryRunner
      .createIndex(
        'audit_logs',
        new TableIndex({
          name: 'IDX_audit_log_action_created_at',
          columnNames: ['action', 'createdAt'],
        }),
      )
      .catch(() => {
        // Index may already exist if this migration re-runs partially.
      });
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner
      .dropIndex('audit_logs', 'IDX_audit_log_action_created_at')
      .catch(() => {});
    await queryRunner.dropTable('audit_logs', true).catch(() => {});
  }
}
