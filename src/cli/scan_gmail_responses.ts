#!/usr/bin/env ts-node
/**
 * Scan Gmail Responses CLI
 *
 * Scans Gmail for sent messages and replies, updates metrics.ndjson.
 *
 * Usage:
 *   npx ts-node src/cli/scan_gmail_responses.ts
 *   npx ts-node src/cli/scan_gmail_responses.ts --since "2026-01-01"
 *
 * Environment Variables:
 *   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
 *
 * 注意:
 * - 本文は取得しない（メタデータのみ）
 * - PIIはログに出さない
 */

import { config } from 'dotenv';
import { Command } from 'commander';
import { ScanGmailResponses } from '../jobs/ScanGmailResponses';
import { isGmailConfigured } from '../connectors/gmail/GmailClient';

// Load environment variables
config();

// CLI Configuration
const program = new Command();

program
  .name('scan_gmail_responses')
  .description('Scan Gmail for sent messages and replies to update metrics')
  .version('0.1.0');

program
  .option('--since <date>', 'Only scan records since this date (ISO format)')
  .option('--json', 'Output results as JSON only');

program.parse();

const options = program.opts();

/**
 * Logger that respects --json flag
 */
function log(message: string): void {
  if (!options.json) {
    console.log(message);
  }
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  if (!options.json) {
    console.log('='.repeat(60));
    console.log('AI Sales - Gmail Response Scanner');
    console.log('='.repeat(60));
    console.log('');
  }

  // Check Gmail configuration
  if (!isGmailConfigured()) {
    log('Warning: Gmail not configured. Running in stub mode.');
    log('Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN to enable.');
    log('');
  }

  log('Scanning Gmail for sent messages and replies...');
  if (options.since) {
    log(`  Since: ${options.since}`);
  }
  log('');

  // Run the scan job
  const scanner = new ScanGmailResponses();
  const result = await scanner.run(options.since);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    log('='.repeat(60));
    log('Scan Results');
    log('='.repeat(60));
    log(`  Records processed: ${result.processed}`);
    log(`  Skipped (no tracking ID): ${result.skipped}`);
    log(`  New SENT_DETECTED: ${result.sentDetected}`);
    log(`  New REPLY_DETECTED: ${result.replyDetected}`);

    if (result.errors.length > 0) {
      log('');
      log('Errors:');
      result.errors.forEach(err => log(`  - ${err}`));
    }

    log('');
    log('Metrics updated in: data/metrics.ndjson');
  }

  process.exit(result.errors.length > 0 ? 1 : 0);
}

// Run
main().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
