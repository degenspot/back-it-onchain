import { DataSource } from 'typeorm';
import * as path from 'path';

/**
 * SchemaValidator
 *
 * A utility class for validating database schema consistency without requiring
 * a full test harness. Can be used for:
 *  - Pre-deployment validation
 *  - CI/CD pipeline checks
 *  - Development environment verification
 *
 * Usage:
 *  const validator = new SchemaValidator(dataSourceOptions);
 *  const report = await validator.validateSchema();
 *  console.log(report);
 */

export interface ValidationError {
  level: 'error' | 'warning';
  table?: string;
  column?: string;
  issue: string;
  details?: string;
}

export interface ValidationReport {
  timestamp: Date;
  success: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  summary: {
    tablesChecked: number;
    columnsChecked: number;
    errorsFound: number;
    warningsFound: number;
  };
}

export class SchemaValidator {
  private dataSource: DataSource;
  private errors: ValidationError[] = [];
  private warnings: ValidationError[] = [];

  constructor(dataSourceOptions: any) {
    this.dataSource = new DataSource({
      ...dataSourceOptions,
      migrations: [],
      migrationsRun: false,
      synchronize: false,
      logging: false,
    });
  }

  async validateSchema(): Promise<ValidationReport> {
    this.errors = [];
    this.warnings = [];

    try {
      if (!this.dataSource.isInitialized) {
        await this.dataSource.initialize();
      }

      // Run validation checks
      await this.validateEntityTables();
      await this.validateColumnDefinitions();
      await this.validateColumnTypes();
      await this.validateNullableConstraints();
      await this.validateRelationships();
      await this.validateMigrationsTableExists();

      return this.generateReport();
    } catch (error) {
      this.errors.push({
        level: 'error',
        issue: 'Schema validation failed',
        details: error instanceof Error ? error.message : String(error),
      });
      return this.generateReport();
    } finally {
      if (this.dataSource.isInitialized) {
        await this.dataSource.destroy();
      }
    }
  }

  private async validateEntityTables(): Promise<void> {
    const entities = this.dataSource.entityMetadatas;

    if (entities.length === 0) {
      this.warnings.push({
        level: 'warning',
        issue: 'No entities found',
        details: 'No TypeORM entities were loaded',
      });
      return;
    }

    const dbTables = await this.dataSource.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
    `);

    const tableNames = dbTables.map((row: any) => row.table_name);

    for (const entity of entities) {
      if (!tableNames.includes(entity.tableName)) {
        this.errors.push({
          level: 'error',
          table: entity.tableName,
          issue: 'Table missing in database',
          details: `Entity ${entity.name} expects table "${entity.tableName}" but it doesn't exist`,
        });
      }
    }
  }

  private async validateColumnDefinitions(): Promise<void> {
    const entities = this.dataSource.entityMetadatas;

    for (const entity of entities) {
      const dbColumns = await this.dataSource.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = $1
      `, [entity.tableName]);

      const dbColumnNames = dbColumns.map((col: any) => col.column_name);

      for (const column of entity.columns) {
        const dbColumnName = column.databaseName || column.propertyName;

        if (!dbColumnNames.includes(dbColumnName)) {
          this.errors.push({
            level: 'error',
            table: entity.tableName,
            column: dbColumnName,
            issue: 'Column missing in database',
            details: `Entity column "${dbColumnName}" not found in database table "${entity.tableName}"`,
          });
        }
      }
    }
  }

  private async validateColumnTypes(): Promise<void> {
    const entities = this.dataSource.entityMetadatas;

    const typeMap: { [key: string]: string[] } = {
      int: ['int4'],
      integer: ['int4'],
      bigint: ['int8'],
      decimal: ['numeric'],
      varchar: ['varchar'],
      text: ['text'],
      boolean: ['bool'],
      date: ['date'],
      timestamp: ['timestamp', 'timestamptz'],
      datetime: ['timestamp', 'timestamptz'],
      json: ['json', 'jsonb'],
      jsonb: ['jsonb', 'json'],
      uuid: ['uuid'],
      enum: ['enum'],
    };

    for (const entity of entities) {
      const dbColumns = await this.dataSource.query(`
        SELECT column_name, data_type, udt_name
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = $1
      `, [entity.tableName]);

      for (const column of entity.columns) {
        const dbColumn = dbColumns.find(
          (col: any) =>
            col.column_name === (column.databaseName || column.propertyName),
        );

        if (dbColumn) {
          const entityType = String(column.type).toLowerCase();
          const dbType = (dbColumn.udt_name || dbColumn.data_type).toLowerCase();
          const expectedTypes = typeMap[entityType] || [entityType];

          if (!expectedTypes.includes(dbType)) {
            this.errors.push({
              level: 'error',
              table: entity.tableName,
              column: column.databaseName || column.propertyName,
              issue: 'Column type mismatch',
              details: `Expected type "${entityType}" (${expectedTypes.join(', ')}), but database has "${dbType}"`,
            });
          }
        }
      }
    }
  }

  private async validateNullableConstraints(): Promise<void> {
    const entities = this.dataSource.entityMetadatas;

    for (const entity of entities) {
      const dbColumns = await this.dataSource.query(`
        SELECT column_name, is_nullable
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = $1
      `, [entity.tableName]);

      for (const column of entity.columns) {
        if (column.isPrimary || column.relationMetadata) {
          continue;
        }

        const dbColumn = dbColumns.find(
          (col: any) =>
            col.column_name === (column.databaseName || column.propertyName),
        );

        if (dbColumn) {
          const dbNullable = dbColumn.is_nullable === 'YES';
          const entityNullable = column.isNullable !== false;

          if (dbNullable !== entityNullable) {
            this.warnings.push({
              level: 'warning',
              table: entity.tableName,
              column: column.databaseName || column.propertyName,
              issue: 'Nullable constraint mismatch',
              details: `Entity expects nullable=${entityNullable}, but database has nullable=${dbNullable}`,
            });
          }
        }
      }
    }
  }

  private async validateRelationships(): Promise<void> {
    const entities = this.dataSource.entityMetadatas;
    let relationshipsChecked = 0;

    for (const entity of entities) {
      for (const relation of entity.relations) {
        if (relation.relationType === 'many-to-one') {
          relationshipsChecked++;

          // Check if the join column exists
          const joinColumn = entity.columns.find(
            (col) =>
              col.relationMetadata?.relationName === relation.propertyName,
          );

          if (!joinColumn) {
            this.warnings.push({
              level: 'warning',
              table: entity.tableName,
              issue: 'Missing join column for relationship',
              details: `Many-to-one relationship "${relation.propertyName}" has no join column`,
            });
          }
        }
      }
    }
  }

  private async validateMigrationsTableExists(): Promise<void> {
    const result = await this.dataSource.query(`
      SELECT EXISTS(
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'typeorm_migrations'
      )
    `);

    const migrationsTableExists = result[0].exists;

    if (!migrationsTableExists) {
      this.warnings.push({
        level: 'warning',
        issue: 'Migrations table missing',
        details: 'TypeORM migrations table "typeorm_migrations" not found',
      });
    }
  }

  private generateReport(): ValidationReport {
    const entities = this.dataSource.entityMetadatas;
    const report: ValidationReport = {
      timestamp: new Date(),
      success: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings,
      summary: {
        tablesChecked: entities.length,
        columnsChecked: entities.reduce((sum, e) => sum + e.columns.length, 0),
        errorsFound: this.errors.length,
        warningsFound: this.warnings.length,
      },
    };

    return report;
  }
}

/**
 * CLI Entry Point
 *
 * Run this script directly to validate schema:
 *  npx ts-node src/common/database/schema-validator.ts
 */
if (require.main === module) {
  (async () => {
    try {
      const { dataSourceOptions } = require('../../data-source');
      const validator = new SchemaValidator(dataSourceOptions);
      const report = await validator.validateSchema();

      console.log('\n📊 Database Schema Validation Report');
      console.log('═'.repeat(50));
      console.log(`✅ Status: ${report.success ? 'PASS' : 'FAIL'}`);
      console.log(`⏰ Checked at: ${report.timestamp.toISOString()}`);
      console.log(
        `📋 Summary: ${report.summary.tablesChecked} tables, ${report.summary.columnsChecked} columns`,
      );
      console.log(
        `❌ Errors: ${report.summary.errorsFound} | ⚠️  Warnings: ${report.summary.warningsFound}`,
      );

      if (report.errors.length > 0) {
        console.log('\n❌ ERRORS:');
        report.errors.forEach((error, index) => {
          console.log(`  ${index + 1}. [${error.table || 'GENERAL'}] ${error.issue}`);
          if (error.details) {
            console.log(`     └─ ${error.details}`);
          }
        });
      }

      if (report.warnings.length > 0) {
        console.log('\n⚠️  WARNINGS:');
        report.warnings.forEach((warning, index) => {
          console.log(`  ${index + 1}. [${warning.table || 'GENERAL'}] ${warning.issue}`);
          if (warning.details) {
            console.log(`     └─ ${warning.details}`);
          }
        });
      }

      console.log('═'.repeat(50));
      process.exit(report.success ? 0 : 1);
    } catch (error) {
      console.error('Schema validation failed:', error);
      process.exit(1);
    }
  })();
}
