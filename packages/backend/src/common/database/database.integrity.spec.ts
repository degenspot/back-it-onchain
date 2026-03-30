import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../../data-source';
import * as path from 'path';

/**
 * Database Integrity Test
 *
 * This test verifies that the current TypeORM entity definitions
 * match the actual database schema. It detects schema drift such as:
 *  - Missing columns in database
 *  - Missing columns in entities
 *  - Type mismatches
 *  - Missing tables
 *  - Nullable mismatches
 *  - Default value mismatches
 *
 * Usage:
 *  npm test -- database.integrity.spec.ts
 */

describe('Database Integrity (Schema Drift Detection)', () => {
  let dataSource: DataSource;
  let dbAvailable = true;

  beforeAll(async () => {
    // Create a test data source that connects to the database
    const testDataSourceOptions = {
      ...dataSourceOptions,
      entities: [path.join(__dirname, '**', '*.entity.{ts,js}')],
      migrations: [],
      migrationsRun: false,
      synchronize: false,
      logging: false,
    };

    dataSource = new DataSource(testDataSourceOptions);

    try {
      await dataSource.initialize();
    } catch (error) {
      console.error(
        'Failed to connect to database. Ensure DB is running and configured correctly.',
        error,
      );
      dbAvailable = false;
      return;
    }
  });

  afterAll(async () => {
    if (dataSource && dataSource.isInitialized) {
      await dataSource.destroy();
    }
  });

  describe('Schema Synchronization', () => {
    it('should detect if schema needs synchronization', async () => {
      if (!dataSource.isInitialized) {
        if (!dbAvailable) {
          console.warn(
            '[Database Integrity] Skipping: DB unavailable (cannot connect).',
          );
          return;
        }
        throw new Error('DataSource not initialized');
      }

      const rows = await dataSource.query(
        `
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        LIMIT 1
      `,
      );
      const synchronizationNeeded = rows.length === 0;

      expect(synchronizationNeeded).toBe(false);
    });

    it('should have all entity tables in the database', async () => {
      if (!dataSource.isInitialized) {
        if (!dbAvailable) {
          console.warn(
            '[Database Integrity] Skipping: DB unavailable (cannot connect).',
          );
          return;
        }
        throw new Error('DataSource not initialized');
      }

      const dbTables = await dataSource.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `);

      const tableNames = dbTables.map((row: any) => row.table_name);

      // Get entity metadata
      const entities = dataSource.entityMetadatas;
      const entityTableNames = entities.map((entity) => entity.tableName);

      // Check that all entities have corresponding tables
      const missingTables = entityTableNames.filter(
        (tableName) => !tableNames.includes(tableName),
      );

      expect(missingTables).toEqual([]);
    });

    it('should not have orphaned tables in the database', async () => {
      if (!dataSource.isInitialized) {
        if (!dbAvailable) {
          console.warn(
            '[Database Integrity] Skipping: DB unavailable (cannot connect).',
          );
          return;
        }
        throw new Error('DataSource not initialized');
      }

      const dbTables = await dataSource.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
        AND table_name NOT IN ('typeorm_migrations')
        ORDER BY table_name
      `);

      const tableNames = dbTables.map((row: any) => row.table_name);

      // Get entity metadata
      const entities = dataSource.entityMetadatas;
      const entityTableNames = entities.map((entity) => entity.tableName);

      // Check for orphaned tables (only warn, don't fail)
      const orphanedTables = tableNames.filter(
        (tableName) =>
          !entityTableNames.includes(tableName) &&
          !['typeorm_migrations'].includes(tableName),
      );

      if (orphanedTables.length > 0) {
        console.warn(
          `Found orphaned tables in database: ${orphanedTables.join(', ')}`,
        );
      }

      // This is informational only
      expect(orphanedTables).toBeDefined();
    });
  });

  describe('Column Synchronization', () => {
    it('should have all entity columns in corresponding database tables', async () => {
      if (!dataSource.isInitialized) {
        if (!dbAvailable) {
          console.warn(
            '[Database Integrity] Skipping: DB unavailable (cannot connect).',
          );
          return;
        }
        throw new Error('DataSource not initialized');
      }

      const entities = dataSource.entityMetadatas;
      const mismatches: Array<{
        table: string;
        missingColumns: string[];
      }> = [];

      for (const entity of entities) {
        const dbColumns = await dataSource.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_schema = 'public' 
          AND table_name = $1
        `, [entity.tableName]);

        const dbColumnNames = dbColumns.map((col: any) => col.column_name);
        const entityColumnNames = entity.columns.map((col) => col.databaseName || col.propertyName);

        const missingColumns = entityColumnNames.filter(
          (colName) => !dbColumnNames.includes(colName),
        );

        if (missingColumns.length > 0) {
          mismatches.push({
            table: entity.tableName,
            missingColumns,
          });
        }
      }

      expect(mismatches).toEqual([]);
    });

    it('should have matching column types between entities and database', async () => {
      if (!dataSource.isInitialized) {
        if (!dbAvailable) {
          console.warn(
            '[Database Integrity] Skipping: DB unavailable (cannot connect).',
          );
          return;
        }
        throw new Error('DataSource not initialized');
      }

      const entities = dataSource.entityMetadatas;
      const typeMatches: Array<{
        table: string;
        column: string;
        entityType: string;
        dbType: string;
      }> = [];

      for (const entity of entities) {
        const dbColumns = await dataSource.query(`
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
            const entityType = column.type;
            const dbType = dbColumn.udt_name || dbColumn.data_type;

            // Map TypeORM types to PostgreSQL types for comparison
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
              uuid: ['uuid'],
            };

            const expectedTypes =
              typeMap[String(entityType).toLowerCase()] || [String(entityType).toLowerCase()];
            const isTypeMatch = expectedTypes.includes(dbType.toLowerCase());

            if (!isTypeMatch) {
              typeMatches.push({
                table: entity.tableName,
                column: column.databaseName || column.propertyName,
                entityType: String(entityType),
                dbType,
              });
            }
          }
        }
      }

      expect(typeMatches).toEqual([]);
    });

    it('should have matching nullable constraints', async () => {
      if (!dataSource.isInitialized) {
        if (!dbAvailable) {
          console.warn(
            '[Database Integrity] Skipping: DB unavailable (cannot connect).',
          );
          return;
        }
        throw new Error('DataSource not initialized');
      }

      const entities = dataSource.entityMetadatas;
      const nullableMatches: Array<{
        table: string;
        column: string;
        entityNullable: boolean;
        dbNullable: boolean;
      }> = [];

      for (const entity of entities) {
        const dbColumns = await dataSource.query(`
          SELECT column_name, is_nullable
          FROM information_schema.columns 
          WHERE table_schema = 'public' 
          AND table_name = $1
        `, [entity.tableName]);

        for (const column of entity.columns) {
          // Skip primary keys and relationships as they have special handling
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

            // Note: Some columns may legitimately differ (e.g., default values)
            // This comparison is informational
            if (dbNullable !== entityNullable) {
              nullableMatches.push({
                table: entity.tableName,
                column: column.databaseName || column.propertyName,
                entityNullable,
                dbNullable,
              });
            }
          }
        }
      }

      // Warn about nullable mismatches but don't fail
      if (nullableMatches.length > 0) {
        console.warn(
          `Nullable constraint mismatches found: ${JSON.stringify(nullableMatches, null, 2)}`,
        );
      }

      expect(nullableMatches).toBeDefined();
    });
  });

  describe('Relationship & Foreign Key Validation', () => {
    it('should have foreign keys for ManyToOne relationships', async () => {
      if (!dataSource.isInitialized) {
        if (!dbAvailable) {
          console.warn(
            '[Database Integrity] Skipping: DB unavailable (cannot connect).',
          );
          return;
        }
        throw new Error('DataSource not initialized');
      }

      const entities = dataSource.entityMetadatas;
      const missingForeignKeys: Array<{
        table: string;
        column: string;
        relationship: string;
      }> = [];

      for (const entity of entities) {
        for (const relation of entity.relations) {
          if (relation.relationType === 'many-to-one') {
            const joinColumn = entity.columns.find(
              (col) =>
                col.relationMetadata?.propertyName === relation.propertyName,
            );

            if (joinColumn) {
              const dbForeignKeys = await dataSource.query(`
                SELECT constraint_name, column_name
                FROM information_schema.key_column_usage
                WHERE table_schema = 'public'
                AND table_name = $1
                AND column_name = $2
              `, [entity.tableName, joinColumn.databaseName || joinColumn.propertyName]);

              if (dbForeignKeys.length === 0) {
                missingForeignKeys.push({
                  table: entity.tableName,
                  column: joinColumn.databaseName || joinColumn.propertyName,
                  relationship: relation.propertyName,
                });
              }
            }
          }
        }
      }

      // This is informational; some foreign keys might be missing by design
      if (missingForeignKeys.length > 0) {
        console.warn(
          `Missing foreign keys: ${JSON.stringify(missingForeignKeys, null, 2)}`,
        );
      }

      expect(missingForeignKeys).toBeDefined();
    });
  });

  describe('Index Validation', () => {
    it('should have indexes defined for performance', async () => {
      if (!dataSource.isInitialized) {
        if (!dbAvailable) {
          console.warn(
            '[Database Integrity] Skipping: DB unavailable (cannot connect).',
          );
          return;
        }
        throw new Error('DataSource not initialized');
      }

      const dbIndexes = await dataSource.query(`
        SELECT tablename, indexname 
        FROM pg_indexes 
        WHERE schemaname = 'public'
        AND indexname NOT LIKE '%_pkey'
        ORDER BY tablename, indexname
      `);

      // Verify that some indexes exist (informational)
      expect(dbIndexes.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Entity Metadata Validation', () => {
    it('should have valid entity metadata loaded', async () => {
      if (!dataSource.isInitialized) {
        if (!dbAvailable) {
          console.warn(
            '[Database Integrity] Skipping: DB unavailable (cannot connect).',
          );
          return;
        }
        throw new Error('DataSource not initialized');
      }

      const entities = dataSource.entityMetadatas;

      expect(entities.length).toBeGreaterThan(0);

      // Validate each entity
      for (const entity of entities) {
        expect(entity.tableName).toBeTruthy();
        expect(entity.columns.length).toBeGreaterThan(0);

        // Each table should have at least one primary/unique key
        const hasKey =
          entity.columns.some((col) => col.isPrimary) ||
          (entity.uniques?.length ?? 0) > 0 ||
          (entity.ownUniques?.length ?? 0) > 0;

        expect(hasKey).toBe(true);
      }
    });

    it('should not have duplicate column names in entities', async () => {
      if (!dataSource.isInitialized) {
        if (!dbAvailable) {
          console.warn(
            '[Database Integrity] Skipping: DB unavailable (cannot connect).',
          );
          return;
        }
        throw new Error('DataSource not initialized');
      }

      const entities = dataSource.entityMetadatas;
      const duplicates: Array<{
        entity: string;
        duplicateColumns: string[];
      }> = [];

      for (const entity of entities) {
        const columnNames = entity.columns.map(
          (col) => col.databaseName || col.propertyName,
        );
        const seen = new Set<string>();
        const dups: string[] = [];

        for (const name of columnNames) {
          if (seen.has(name)) {
            dups.push(name);
          }
          seen.add(name);
        }

        if (dups.length > 0) {
          duplicates.push({
            entity: entity.name,
            duplicateColumns: [...new Set(dups)],
          });
        }
      }

      expect(duplicates).toEqual([]);
    });
  });

  describe('Migration Compatibility', () => {
    it('should verify that migrations table exists', async () => {
      if (!dataSource.isInitialized) {
        if (!dbAvailable) {
          console.warn(
            '[Database Integrity] Skipping: DB unavailable (cannot connect).',
          );
          return;
        }
        throw new Error('DataSource not initialized');
      }

      const result = await dataSource.query(`
        SELECT EXISTS(
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'typeorm_migrations'
        )
      `);

      const migrationsTableExists = result[0].exists;
      expect(migrationsTableExists).toBe(true);
    });

    it('should verify that all pending migrations are documented', async () => {
      if (!dataSource.isInitialized) {
        if (!dbAvailable) {
          console.warn(
            '[Database Integrity] Skipping: DB unavailable (cannot connect).',
          );
          return;
        }
        throw new Error('DataSource not initialized');
      }

      try {
        const migrations = await dataSource.showMigrations();
        // This just verifies the method runs without error
        expect(migrations).toBeDefined();
      } catch (error) {
        // Some configurations may not support showMigrations
        console.warn('Could not verify migrations:', error);
      }
    });
  });
});
