#!/usr/bin/env npx ts-node
/**
 * Compact Data CLI
 *
 * Compacts and rotates NDJSON data files to manage storage growth.
 *
 * Usage:
 *   npx ts-node src/cli/compact_data.ts --target send_queue
 *   npx ts-node src/cli/compact_data.ts --target all --execute
 *   npx ts-node src/cli/compact_data.ts status
 *
 * 機能:
 * - send_queue: job_idの最新スナップショットのみ保持
 * - metrics/incidents/etc: 日付付きでローテーション
 */

import { Command } from 'commander';
import * as path from 'path';
import {
  loadRetentionConfig,
  compactLatestByKey,
  rotate,
  getDataFileStatus,
  formatBytes,
  CompactionResult,
  RotationResult,
} from '../data/NdjsonCompactor';

/**
 * Known data files and their paths
 */
const DATA_FILES: Record<string, string> = {
  send_queue: 'data/send_queue.ndjson',
  metrics: 'data/metrics.ndjson',
  incidents: 'data/incidents.ndjson',
  fix_proposals: 'data/fix_proposals.ndjson',
  fix_proposal_events: 'data/fix_proposal_events.ndjson',
  approvals: 'data/approvals.ndjson',
};

/**
 * Compact or rotate a data file based on retention config
 */
function processFile(
  target: string,
  filePath: string,
  execute: boolean
): { compaction?: CompactionResult; rotation?: RotationResult } {
  const config = loadRetentionConfig();
  const policy = config[target];

  const result: { compaction?: CompactionResult; rotation?: RotationResult } = {};

  if (!policy) {
    return result;
  }

  if (policy.compact && policy.key) {
    result.compaction = compactLatestByKey(filePath, policy.key, { execute });
  }

  if (policy.rotate) {
    result.rotation = rotate(filePath, { execute });
  }

  return result;
}

/**
 * Main CLI
 */
async function main(): Promise<void> {
  const program = new Command();

  program
    .name('compact_data')
    .description('Compact and rotate NDJSON data files')
    .version('0.1.0');

  // Default command: compact
  program
    .option('--target <target>', 'Target file: send_queue, metrics, incidents, all')
    .option('--execute', 'Actually perform the operation (default is dry-run)')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const targets = opts.target === 'all'
        ? Object.keys(DATA_FILES)
        : opts.target
          ? [opts.target]
          : [];

      if (targets.length === 0) {
        console.error('Error: --target is required');
        console.error('Valid targets: send_queue, metrics, incidents, fix_proposals, fix_proposal_events, approvals, all');
        process.exit(1);
      }

      const execute = opts.execute || false;
      const json = opts.json || false;

      const results: Record<string, any> = {};

      for (const target of targets) {
        const filePath = DATA_FILES[target];
        if (!filePath) {
          if (!json) {
            console.error(`Unknown target: ${target}`);
          }
          continue;
        }

        const fullPath = path.join(process.cwd(), filePath);
        const processResult = processFile(target, fullPath, execute);
        results[target] = processResult;

        if (!json) {
          console.log('='.repeat(60));
          console.log(`Target: ${target}`);
          console.log(`File: ${filePath}`);
          console.log('='.repeat(60));
          console.log('');

          if (processResult.compaction) {
            const c = processResult.compaction;
            console.log(`Compaction (${c.dryRun ? 'DRY RUN' : 'EXECUTED'}):`);
            if (c.success) {
              console.log(`  Input:  ${c.inputLines} lines, ${formatBytes(c.inputSizeBytes)}`);
              console.log(`  Output: ${c.outputLines} lines, ${formatBytes(c.outputSizeBytes)}`);
              console.log(`  Reduced: ${c.reduction.lines} lines, ${formatBytes(c.reduction.bytes)} (${c.reduction.percentage}%)`);
              if (c.backupPath) {
                console.log(`  Backup: ${c.backupPath}`);
              }
            } else {
              console.log(`  Error: ${c.error}`);
            }
            console.log('');
          }

          if (processResult.rotation) {
            const r = processResult.rotation;
            console.log(`Rotation (${r.dryRun ? 'DRY RUN' : 'EXECUTED'}):`);
            if (r.success) {
              console.log(`  Would rotate to: ${r.rotatedPath}`);
              console.log(`  Size: ${formatBytes(r.rotatedSizeBytes || 0)}`);
            } else {
              console.log(`  Error: ${r.error}`);
            }
            console.log('');
          }

          if (!processResult.compaction && !processResult.rotation) {
            console.log('  No action configured for this target');
            console.log('');
          }
        }
      }

      if (json) {
        console.log(JSON.stringify({
          success: true,
          dryRun: !execute,
          results,
        }, null, 2));
      } else if (!execute) {
        console.log('-'.repeat(60));
        console.log('This was a DRY RUN. Use --execute to perform the operation.');
      }
    });

  // Status command
  program
    .command('status')
    .description('Show status of all data files')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const json = opts.json || false;
      const statuses: Record<string, any> = {};

      for (const [name, filePath] of Object.entries(DATA_FILES)) {
        const fullPath = path.join(process.cwd(), filePath);
        const status = getDataFileStatus(fullPath);
        statuses[name] = status;
      }

      if (json) {
        console.log(JSON.stringify({ success: true, files: statuses }, null, 2));
      } else {
        console.log('='.repeat(70));
        console.log('Data File Status');
        console.log('='.repeat(70));
        console.log('');
        console.log('Name                  | Lines    | Size       | Last Modified');
        console.log('-'.repeat(70));

        for (const [name, status] of Object.entries(statuses)) {
          const namePad = name.padEnd(20);
          const linesPad = status.exists ? String(status.lines).padStart(8) : '-'.padStart(8);
          const sizePad = status.exists
            ? formatBytes(status.sizeBytes).padStart(10)
            : '-'.padStart(10);
          const modifiedPad = status.lastModified
            ? status.lastModified.substring(0, 19)
            : '-';

          console.log(`${namePad} | ${linesPad} | ${sizePad} | ${modifiedPad}`);
        }

        console.log('-'.repeat(70));
        console.log('');
        console.log('To compact: npx ts-node src/cli/compact_data.ts --target <name> --execute');
      }
    });

  program.parse();
}

// Run
main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
