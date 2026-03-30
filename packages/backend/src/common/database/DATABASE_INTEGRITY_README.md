# Database Integrity & Schema Validation

This directory contains utilities for detecting and verifying database schema consistency with TypeORM entity definitions.

## Files

- **database.integrity.spec.ts** - Jest test suite for comprehensive schema validation
- **schema-validator.ts** - Standalone utility class and CLI tool for schema validation

## Problem Solved

Database schema drift occurs when:
- Entity definitions are updated but migrations aren't run
- Migrations are run but entity definitions aren't updated
- Manual SQL changes are applied without entity updates
- Column types, nullability, or defaults diverge between entity and database

This validation suite detects these issues automatically.

## Running Tests

### Via Jest (Recommended for CI/CD)

```bash
# Run all tests including integrity checks
npm test

# Run only database integrity tests
npm test -- database.integrity.spec.ts

# Run with coverage
npm test -- --coverage database.integrity.spec.ts

# Watch mode for development
npm test -- --watch database.integrity.spec.ts
```

### Via CLI Validator (Manual Checks)

```bash
# Validate schema and print detailed report
npx ts-node src/common/database/schema-validator.ts

# In production (compiled version)
node dist/common/database/schema-validator.js
```

## What Gets Validated

### Tables
- ✅ All entities have corresponding database tables
- ✅ No orphaned tables exist
- ⚠️  Warns about tables without entity definitions

### Columns
- ✅ All entity columns exist in database
- ✅ Column types match expected mappings
- ✅ Nullable constraints consistency
- ⚠️  Warns about nullable mismatches

### Relationships
- ✅ Foreign key constraints for ManyToOne relationships
- ⚠️  Warns about missing join columns

### Metadata
- ✅ Entity metadata is properly loaded
- ✅ No duplicate column definitions
- ✅ Every table has at least one key (primary or unique)
- ✅ Migrations table exists

## Type Mapping

The validator understands TypeORM to PostgreSQL type mappings:

| TypeORM | PostgreSQL |
|---------|-----------|
| int, integer | int4 |
| bigint | int8 |
| decimal | numeric |
| varchar | varchar |
| text | text |
| boolean | bool |
| date | date |
| timestamp, datetime | timestamp, timestamptz |
| json, jsonb | json, jsonb |
| uuid | uuid |

## Environment Setup

### Prerequisites
- PostgreSQL database running
- Database connection configured via environment variables:
  ```
  DB_HOST=localhost
  DB_PORT=5432
  DB_USERNAME=postgres
  DB_PASSWORD=postgres
  DB_NAME=backit
  ```

### CI/CD Integration

Add to your CI pipeline:

```yaml
# Example: GitHub Actions
- name: Validate Database Schema
  run: npm test -- database.integrity.spec.ts
  env:
    DB_HOST: postgres
    DB_PORT: 5432
    DB_USERNAME: postgres
    DB_PASSWORD: postgres
    DB_NAME: backit_test
```

## Usage Examples

### As a Test Suite

```typescript
import { SchemaValidator } from './schema-validator';
import { dataSourceOptions } from '../../data-source';

describe('Database', () => {
  it('should have matching schema', async () => {
    const validator = new SchemaValidator(dataSourceOptions);
    const report = await validator.validateSchema();
    
    expect(report.success).toBe(true);
    expect(report.errors).toHaveLength(0);
  });
});
```

### As a Utility Class

```typescript
import { SchemaValidator } from './schema-validator';
import { dataSourceOptions } from '../../data-source';

const validator = new SchemaValidator(dataSourceOptions);
const report = await validator.validateSchema();

console.log(`Errors: ${report.summary.errorsFound}`);
console.log(`Warnings: ${report.summary.warningsFound}`);

report.errors.forEach(error => {
  console.error(`[${error.table}] ${error.issue}: ${error.details}`);
});
```

## Common Issues & Solutions

### "Table missing in database"
**Cause:** Entity defined but migration not run  
**Solution:** Run pending migrations with `npm run migrate:run`

### "Column missing in database"
**Cause:** Entity column added but migration not created  
**Solution:** Generate migration: `npm run migrate:generate -- -n AddColumnName`

### "Column type mismatch"
**Cause:** Entity type doesn't match database type  
**Solution:** Either update entity type or create migration to alter column

### "Connection failed"
**Cause:** Database not running or credentials incorrect  
**Solution:** Verify DB connection, check .env file, ensure PostgreSQL is running

## Migration Workflow

Proper workflow to avoid drift:

1. **Make entity changes** in `.entity.ts` files
2. **Generate migration**: `npm run migrate:generate -- -n DescribeChange`
3. **Review migration** in `src/migrations/`
4. **Run migration**: `npm run migrate:run`
5. **Run validation**: `npm test -- database.integrity.spec.ts`
6. **Commit changes**: Include both entity and migration files

## Contributing

When adding new entities:
1. Create `src/your-module/entities/your-entity.entity.ts`
2. Add TypeORM decorators and columns
3. Generate migration automatically
4. Run validation to verify
5. Keep entity and migration files in sync

## References

- [TypeORM Documentation](https://typeorm.io/)
- [TypeORM Migrations](https://typeorm.io/migrations)
- [PostgreSQL Column Types](https://www.postgresql.org/docs/current/datatype.html)
