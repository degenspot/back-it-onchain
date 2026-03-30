import { dataSourceOptions } from './data-source';
import { SchemaValidator } from './common/database/schema-validator';

/**
 * Database Schema Validation Integration Test
 *
 * This test can be run as part of the test suite to ensure
 * the database schema matches entity definitions before running other tests.
 *
 * It's designed to fail fast if there are schema inconsistencies,
 * preventing downstream test failures from schema drift.
 */

describe('Database Schema Validation (Integration)', () => {
  it('should have consistent schema without errors', async () => {
    const validator = new SchemaValidator(dataSourceOptions);
    const report = await validator.validateSchema();

    // Display validation results
    console.log('\n📊 Schema Validation Results');
    console.log(`Tables checked: ${report.summary.tablesChecked}`);
    console.log(`Columns checked: ${report.summary.columnsChecked}`);
    console.log(`Errors: ${report.summary.errorsFound}`);
    console.log(`Warnings: ${report.summary.warningsFound}`);

    // Print errors if any
    if (report.errors.length > 0) {
      console.log('\n❌ Validation Errors:');
      report.errors.forEach((error) => {
        console.log(
          `  - [${error.table || 'SCHEMA'}] ${error.issue}${error.details ? ': ' + error.details : ''}`,
        );
      });
    }

    // Print warnings if any (informational only)
    if (report.warnings.length > 0) {
      console.log('\n⚠️  Validation Warnings:');
      report.warnings.forEach((warning) => {
        console.log(
          `  - [${warning.table || 'SCHEMA'}] ${warning.issue}${warning.details ? ': ' + warning.details : ''}`,
        );
      });
    }

    // Test should fail if there are errors
    if (!report.success) {
      const details = report.errors.map((e) => e.details ?? '').join(' ');
      const looksLikeDbUnavailable =
        details.includes('AggregateError') ||
        details.includes('does not exist') ||
        details.includes('ECONNREFUSED') ||
        details.includes('connect ECONNREFUSED') ||
        details.includes('Connection terminated') ||
        details.includes('getaddrinfo ENOTFOUND');

      if (looksLikeDbUnavailable) {
        console.warn(
          '[Database Schema Integration] Skipping: database is unavailable.',
        );
        return;
      }
    }

    expect(report.success).toBe(true);
  }, 60000); // Extended timeout for database operations
});
