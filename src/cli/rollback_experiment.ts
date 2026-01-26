#!/usr/bin/env ts-node
/**
 * Rollback Experiment CLI
 *
 * Stops an experiment and optionally stops all sending.
 *
 * Usage:
 *   npx ts-node src/cli/rollback_experiment.ts --experiment "exp-2026-01" --reason "reply_rate drop" --set-by "operator"
 *   npx ts-node src/cli/rollback_experiment.ts --experiment "exp-2026-01" --reason "issue" --set-by "op" --stop-send
 *
 * 目的:
 * - 実験のステータスを 'paused' に変更
 * - オプションで RuntimeKillSwitch を有効化して全送信を停止
 * - 操作を metrics に記録
 *
 * 制約:
 * - experiments.json のバックアップを作成
 * - PIIはログ出力しない
 */

import { config } from 'dotenv';
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { ExperimentEvaluator, ExperimentsRegistry } from '../domain/ExperimentEvaluator';
import { getRuntimeKillSwitch } from '../domain/RuntimeKillSwitch';
import { getMetricsStore } from '../data/MetricsStore';
import { notifyOpsRollback } from '../notifications';

// Load environment variables
config();

// CLI Configuration
const program = new Command();

program
  .name('rollback_experiment')
  .description('Stop an experiment and optionally stop all sending')
  .version('0.1.0')
  .requiredOption('--experiment <id>', 'Experiment ID to roll back')
  .requiredOption('--reason <reason>', 'Reason for rollback')
  .requiredOption('--set-by <name>', 'Name/ID of operator performing rollback')
  .option('--stop-send', 'Also stop all sending via RuntimeKillSwitch')
  .option('--dry-run', 'Show what would be done without making changes')
  .option('--json', 'Output as JSON');

/**
 * Rollback result
 */
interface RollbackResult {
  success: boolean;
  experimentId: string;
  previousStatus: string;
  newStatus: string;
  stoppedSending: boolean;
  backupPath: string | null;
  error?: string;
}

/**
 * Execute rollback
 */
function rollbackExperiment(options: {
  experimentId: string;
  reason: string;
  setBy: string;
  stopSend: boolean;
  dryRun: boolean;
}): RollbackResult {
  const { experimentId, reason, setBy, stopSend, dryRun } = options;

  const evaluator = new ExperimentEvaluator();
  let registry: ExperimentsRegistry;

  try {
    registry = evaluator.loadRegistry();
  } catch (error) {
    return {
      success: false,
      experimentId,
      previousStatus: 'unknown',
      newStatus: 'unknown',
      stoppedSending: false,
      backupPath: null,
      error: `Failed to load experiments registry: ${error instanceof Error ? error.message : 'Unknown'}`,
    };
  }

  // Find experiment
  const experiment = registry.experiments.find(e => e.experimentId === experimentId);
  if (!experiment) {
    return {
      success: false,
      experimentId,
      previousStatus: 'unknown',
      newStatus: 'unknown',
      stoppedSending: false,
      backupPath: null,
      error: `Experiment not found: ${experimentId}`,
    };
  }

  const previousStatus = experiment.status || 'running';

  if (dryRun) {
    return {
      success: true,
      experimentId,
      previousStatus,
      newStatus: 'paused',
      stoppedSending: stopSend,
      backupPath: null,
    };
  }

  // Create backup
  const backupDir = path.join('data', 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `experiments_${timestamp}.json`);

  // Update experiment status
  experiment.status = 'paused';
  experiment.endAt = new Date().toISOString();

  // Add rollback note to description
  const rollbackNote = `[ROLLBACK ${timestamp}] Reason: ${reason}, By: ${setBy}`;
  experiment.description = experiment.description
    ? `${experiment.description}\n${rollbackNote}`
    : rollbackNote;

  // Save with backup
  evaluator.saveRegistry(registry, backupPath);

  // Stop sending if requested
  let stoppedSending = false;
  if (stopSend) {
    const killSwitch = getRuntimeKillSwitch();
    killSwitch.setEnabled(`Rollback: ${experimentId} - ${reason}`, setBy);
    stoppedSending = true;
  }

  // Record metrics
  const metrics = getMetricsStore();
  metrics.recordOpsRollback({
    experimentId,
    reason,
    setBy,
    stoppedSending,
  });

  // Send notification (best effort, never throws)
  notifyOpsRollback({
    experimentId,
    reason,
    setBy,
    stoppedSending,
  }).catch(() => {
    // Ignore notification failures - they are logged internally
  });

  return {
    success: true,
    experimentId,
    previousStatus,
    newStatus: 'paused',
    stoppedSending,
    backupPath,
  };
}

export { rollbackExperiment, RollbackResult };

// Only run if this is the main module
if (require.main === module) {
  program.parse();

  const opts = program.opts();

  const result = rollbackExperiment({
    experimentId: opts.experiment,
    reason: opts.reason,
    setBy: opts.setBy,
    stopSend: opts.stopSend || false,
    dryRun: opts.dryRun || false,
  });

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.success) {
      if (opts.dryRun) {
        console.log('='.repeat(60));
        console.log('Rollback Preview (Dry Run)');
        console.log('='.repeat(60));
        console.log('');
        console.log(`Experiment: ${result.experimentId}`);
        console.log(`Status Change: ${result.previousStatus} -> ${result.newStatus}`);
        console.log(`Stop Sending: ${result.stoppedSending ? 'Yes' : 'No'}`);
        console.log('');
        console.log('No changes made (dry run).');
      } else {
        console.log('='.repeat(60));
        console.log('Rollback Complete');
        console.log('='.repeat(60));
        console.log('');
        console.log(`Experiment: ${result.experimentId}`);
        console.log(`Status: ${result.previousStatus} -> ${result.newStatus}`);
        console.log(`Backup: ${result.backupPath}`);
        console.log(`Sending Stopped: ${result.stoppedSending ? 'Yes' : 'No'}`);
        console.log('');
        if (result.stoppedSending) {
          console.log('IMPORTANT: All sending has been stopped via RuntimeKillSwitch.');
          console.log('To resume sending, run:');
          console.log('  npx ts-node src/cli/run_ops.ts resume-send --reason "..." --set-by "..."');
        }
      }
    } else {
      console.error('Rollback Failed:');
      console.error(`  ${result.error}`);
      process.exit(1);
    }
  }
}
