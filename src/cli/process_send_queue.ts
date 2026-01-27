#!/usr/bin/env npx ts-node
/**
 * Process Send Queue CLI
 *
 * Worker that processes queued send jobs with retry and backoff.
 *
 * Usage:
 *   npx ts-node src/cli/process_send_queue.ts --max-jobs 10
 *   npx ts-node src/cli/process_send_queue.ts --max-jobs 10 --execute
 *
 * 重要:
 * - PIIは使用しない
 * - 送信前にSendPolicy/KillSwitchを再確認
 * - dead_letterに落ちたら自動送信しない
 */

import { config } from 'dotenv';
import { Command } from 'commander';
import { GmailClient } from '../connectors/gmail/GmailClient';
import { getSendQueueManager, SendQueueManager } from '../domain/SendQueueManager';
import { SendJob } from '../data/SendQueueStore';
import { getSendPolicy } from '../domain/SendPolicy';
import { getRuntimeKillSwitch } from '../domain/RuntimeKillSwitch';
import { getMetricsStore } from '../data/MetricsStore';
import {
  notifyAutoSendSuccess,
  notifyAutoSendBlocked,
  notifySendQueueDeadLetter,
  notifySendQueueBackoff,
} from '../notifications';

// Load environment variables
config();

/**
 * Process result for a single job
 */
interface JobProcessResult {
  job_id: string;
  tracking_id: string;
  status: 'sent' | 'blocked' | 'retry' | 'dead_letter' | 'failed' | 'skipped';
  message_id?: string;
  thread_id?: string;
  error_code?: string;
  reason?: string;
  next_attempt_at?: string;
}

/**
 * Overall process result
 */
interface ProcessResult {
  processed: number;
  sent: number;
  blocked: number;
  retried: number;
  dead_letter: number;
  failed: number;
  skipped: number;
  dry_run: boolean;
  jobs: JobProcessResult[];
}

/**
 * Extract HTTP status from error message
 */
function extractHttpStatus(error: Error | string): number | undefined {
  const message = typeof error === 'string' ? error : error.message;
  const match = message.match(/HTTP\s+(\d+)/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  if (message.includes('429')) return 429;
  if (message.includes('500')) return 500;
  if (message.includes('503')) return 503;
  return undefined;
}

/**
 * Process a single job
 */
async function processJob(
  job: SendJob,
  manager: SendQueueManager,
  execute: boolean
): Promise<JobProcessResult> {
  const metricsStore = getMetricsStore();
  const sendPolicy = getSendPolicy();
  const killSwitch = getRuntimeKillSwitch();

  // Skip if already sent (idempotent)
  if (manager.shouldSkipJob(job)) {
    return {
      job_id: job.job_id,
      tracking_id: job.tracking_id,
      status: 'skipped',
      reason: 'Already sent',
    };
  }

  // Re-check kill switch at execution time
  if (killSwitch.isEnabled()) {
    const result = manager.markFailed(job.job_id, 'runtime_kill_switch active');
    if (result.action === 'dead_letter') {
      notifySendQueueDeadLetter({
        jobId: job.job_id,
        errorCode: 'policy',
        attempts: job.attempts,
        toDomain: job.to_domain,
        templateId: job.template_id,
        trackingId: job.tracking_id,
      }).catch(() => {});
    }
    return {
      job_id: job.job_id,
      tracking_id: job.tracking_id,
      status: result.action === 'dead_letter' ? 'dead_letter' : 'blocked',
      error_code: 'policy',
      reason: 'Kill switch active',
    };
  }

  // Re-check send policy at execution time (sending enabled, not at rate limit)
  if (!sendPolicy.isSendingEnabled()) {
    const result = manager.markFailed(job.job_id, 'Sending not enabled');
    return {
      job_id: job.job_id,
      tracking_id: job.tracking_id,
      status: result.action === 'dead_letter' ? 'dead_letter' : 'blocked',
      error_code: 'policy',
      reason: 'Sending not enabled',
    };
  }

  // Dry run: don't actually send
  if (!execute) {
    return {
      job_id: job.job_id,
      tracking_id: job.tracking_id,
      status: 'skipped',
      reason: 'Dry run - would send',
    };
  }

  // Actually send
  try {
    const gmailClient = new GmailClient();
    const sendResult = await gmailClient.sendDraft(job.draft_id);

    // Mark as sent
    manager.markSent(job.job_id, {
      message_id: sendResult.messageId,
      thread_id: sendResult.threadId,
    });

    // Record metrics
    metricsStore.recordAutoSendSuccess({
      trackingId: job.tracking_id,
      companyId: job.company_id,
      templateId: job.template_id,
      abVariant: job.ab_variant,
      draftId: job.draft_id,
      messageId: sendResult.messageId,
      threadId: sendResult.threadId,
      recipientDomain: job.to_domain,
    });

    // Notify success
    notifyAutoSendSuccess({
      trackingId: job.tracking_id,
      companyId: job.company_id,
      templateId: job.template_id,
      abVariant: job.ab_variant || undefined,
    }).catch(() => {});

    return {
      job_id: job.job_id,
      tracking_id: job.tracking_id,
      status: 'sent',
      message_id: sendResult.messageId,
      thread_id: sendResult.threadId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const httpStatus = extractHttpStatus(error instanceof Error ? error : errorMessage);

    const result = manager.markFailed(job.job_id, errorMessage, httpStatus);

    // Record blocked metrics
    metricsStore.recordAutoSendBlocked({
      trackingId: job.tracking_id,
      companyId: job.company_id,
      templateId: job.template_id,
      abVariant: job.ab_variant,
      draftId: job.draft_id,
      reason: 'gate_failed',
      details: `Gmail API error: ${result.action}`,
      recipientDomain: job.to_domain,
    });

    // Notify based on result
    if (result.action === 'dead_letter') {
      notifySendQueueDeadLetter({
        jobId: job.job_id,
        errorCode: 'gmail_' + (httpStatus || 'unknown'),
        attempts: job.attempts,
        toDomain: job.to_domain,
        templateId: job.template_id,
        trackingId: job.tracking_id,
      }).catch(() => {});
    } else if (result.action === 'retry' && result.next_attempt_at) {
      notifySendQueueBackoff({
        jobId: job.job_id,
        errorCode: 'gmail_' + (httpStatus || 'unknown'),
        nextAttemptAt: result.next_attempt_at,
        attempts: job.attempts,
      }).catch(() => {});
    } else {
      notifyAutoSendBlocked({
        trackingId: job.tracking_id,
        companyId: job.company_id,
        reason: `Send failed: ${result.action}`,
        templateId: job.template_id,
        abVariant: job.ab_variant || undefined,
      }).catch(() => {});
    }

    return {
      job_id: job.job_id,
      tracking_id: job.tracking_id,
      status: result.action === 'retry' ? 'retry' : result.action === 'dead_letter' ? 'dead_letter' : 'failed',
      error_code: `gmail_${httpStatus || 'unknown'}`,
      reason: errorMessage.substring(0, 100),
      next_attempt_at: result.next_attempt_at,
    };
  }
}

/**
 * Process queue
 */
async function processQueue(options: {
  maxJobs: number;
  execute: boolean;
}): Promise<ProcessResult> {
  const manager = getSendQueueManager();
  const result: ProcessResult = {
    processed: 0,
    sent: 0,
    blocked: 0,
    retried: 0,
    dead_letter: 0,
    failed: 0,
    skipped: 0,
    dry_run: !options.execute,
    jobs: [],
  };

  const now = new Date();

  for (let i = 0; i < options.maxJobs; i++) {
    // Lease next job
    const leaseResult = manager.leaseNextJob(now);
    if (!leaseResult.success || !leaseResult.job) {
      break; // No more jobs ready
    }

    const job = leaseResult.job;
    result.processed++;

    // Process the job
    const jobResult = await processJob(job, manager, options.execute);
    result.jobs.push(jobResult);

    // Update counts
    switch (jobResult.status) {
      case 'sent':
        result.sent++;
        break;
      case 'blocked':
        result.blocked++;
        break;
      case 'retry':
        result.retried++;
        break;
      case 'dead_letter':
        result.dead_letter++;
        break;
      case 'failed':
        result.failed++;
        break;
      case 'skipped':
        result.skipped++;
        break;
    }
  }

  return result;
}

/**
 * CLI entry point
 */
async function main(): Promise<void> {
  const program = new Command();

  program
    .name('process_send_queue')
    .description('Process queued send jobs')
    .option('--max-jobs <n>', 'Maximum jobs to process', '10')
    .option('--execute', 'Actually send (default is dry-run)')
    .option('--json', 'Output JSON')
    .parse(process.argv);

  const opts = program.opts();
  const maxJobs = parseInt(opts.maxJobs, 10);
  const execute = opts.execute || false;
  const json = opts.json || false;

  const result = await processQueue({ maxJobs, execute });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('='.repeat(60));
    console.log(`Send Queue Processing ${execute ? '(EXECUTE)' : '(DRY RUN)'}`);
    console.log('='.repeat(60));
    console.log('');
    console.log(`Processed: ${result.processed}`);
    console.log(`  Sent: ${result.sent}`);
    console.log(`  Blocked: ${result.blocked}`);
    console.log(`  Retried: ${result.retried}`);
    console.log(`  Dead Letter: ${result.dead_letter}`);
    console.log(`  Failed: ${result.failed}`);
    console.log(`  Skipped: ${result.skipped}`);

    if (result.jobs.length > 0) {
      console.log('');
      console.log('Job Details:');
      for (const job of result.jobs) {
        const statusIcon = {
          sent: '✅',
          blocked: '🚫',
          retry: '🔄',
          dead_letter: '💀',
          failed: '❌',
          skipped: '⏭️',
        }[job.status] || '?';

        console.log(`  ${statusIcon} ${job.job_id} [${job.tracking_id}] - ${job.status}`);
        if (job.message_id) {
          console.log(`     Message ID: ${job.message_id}`);
        }
        if (job.error_code) {
          console.log(`     Error: ${job.error_code}`);
        }
        if (job.reason) {
          console.log(`     Reason: ${job.reason}`);
        }
        if (job.next_attempt_at) {
          console.log(`     Next attempt: ${job.next_attempt_at}`);
        }
      }
    }

    if (!execute && result.processed > 0) {
      console.log('');
      console.log('To actually send, add --execute flag.');
    }
  }
}

// Export for testing
export { processQueue, processJob, ProcessResult, JobProcessResult };

// Run if called directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  });
}
