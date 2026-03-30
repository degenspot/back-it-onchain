# Suggested npm Scripts for Database Validation

Add these scripts to `packages/backend/package.json` in the "scripts" section:

```json
{
  "scripts": {
    "db:validate": "jest --testPathPattern=database.integrity.spec.ts",
    "db:validate:watch": "jest --testPathPattern=database.integrity.spec.ts --watch",
    "db:validate:cli": "ts-node -r tsconfig-paths/register src/common/database/schema-validator.ts",
    "db:check": "npm run db:validate -- --runInBand"
  }
}
```

## Usage

```bash
# Validate schema (Jest test)
npm run db:validate

# Watch mode for development
npm run db:validate:watch

# Quick CLI validation (doesn't use Jest)
npm run db:validate:cli

# CI-friendly validation (sequential)
npm run db:check
```

## Integration with CI/CD

Add to your CI pipeline (e.g., GitHub Actions, Jenkins):

```yaml
# Before deploying, validate schema consistency
- name: Validate Database Schema
  run: npm run db:validate
```

This ensures migrations are applied before the schema validator runs.
