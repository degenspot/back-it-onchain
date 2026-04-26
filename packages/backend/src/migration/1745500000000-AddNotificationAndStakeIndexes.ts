import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNotificationAndStakeIndexes1745500000000 implements MigrationInterface {
  name = 'AddNotificationAndStakeIndexes1745500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_notification_recipient" ON "notification" ("recipientWallet")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_notification_unread" ON "notification" ("recipientWallet", "isRead")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_stake_activity_staker" ON "stake_activity" ("stakerWallet")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_stake_activity_staker"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_notification_unread"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_notification_recipient"`);
  }
}