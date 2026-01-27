/**
 * Reap Stale Queue Jobs
 *
 * Recovers stuck in_progress jobs that have exceeded the stale threshold.
 * Design: Reaping counts as an attempt (+1), with backoff calculated.
 * Jobs exceeding max_attempts are moved to dead_letter.
 *
 * Configuration: config/send_queue.json
 * - stale_minutes: How long a job can be in_progress before being considered stale
 * - max_attempts: Maximum attempts before moving to dead_letter
 * - reap_action: "requeue" (default) or "dead_letter"
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  SendQueueStore,
  SendJob,
  getSendQueueStore,
} from '../data/SendQueueStore';
import { RetryPolicy, getRetryPolicy } from '../domain/RetryPolicy';
import { notifySendQueueReaped } from '../notifications';

/**
 * Reaper configuration
 */
export interface ReaperConfig {
  stale_minutes: number;
  max_attempts: number;
  reap_action: 'requeue' | 'dead_letter';
}

/**
 * Reap result for a single job
 */
export interface ReapJobResult {
  job_id: string;
  tracking_id: string;
  action: 'requeued' | 'dead_lettered' | 'skipped';
  attempts: number;
  reason: string;
}

/**
 * Overall reap result
 */
export interface ReapResult {
  success: boolean;
  dryRun: boolean;
  staleMinutes: number;
  maxAttempts: number;
  staleJobsFound: number;
  requeued: number;
  deadLettered: number;
  skipped: number;
  jobs: ReapJobResult[];
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: ReaperConfig = {
  stale_minutes: 30,
  max_attempts: 8,
  reap_action: 'requeue',
};

/**
 * Load reaper configuration from file
 */
export function loadReaperConfig(configPath?: string): ReaperConfig {
  const filePath = configPath || path.join(process.cwd(), 'config', 'send_queue.json');

  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const config = JSON.parse(content);
      return {
        stale_minutes: config.reaper?.stale_minutes ?? DEFAULT_CONFIG.stale_minutes,
        max_attempts: config.reaper?.max_attempts ?? DEFAULT_CONFIG.max_attempts,
        reap_action: config.reaper?.reap_action ?? DEFAULT_CONFIG.reap_action,
      };
    }
  } catch {
    // Use defaults
  }

  return DEFAULT_CONFIG;
}

/**
 * Reap stale jobs
 *
 * @param options - Reap options
 * @returns Reap result
 */
export function reapStaleJobs(options: {
  execute?: boolean;
  staleMinutes?: number;
  maxAttempts?: number;
  store?: SendQueueStore;
  retryPolicy?: RetryPolicy;
  now?: Date;
  notify?: boolean;
}): ReapResult {
  const config = loadReaperConfig();
  const staleMinutes = options.staleMinutes ?? config.stale_minutes;
  const maxAttempts = options.maxAttempts ?? config.max_attempts;
  const store = options.store ?? getSendQueueStore();
  const retryPolicy = options.retryPolicy ?? getRetryPolicy();
  const now = options.now ?? new Date();
  const execute = options.execute ?? false;
  const notify = options.notify ?? true;

  // Find stale jobs
  const staleJobs = store.findStaleJobs(staleMinutes, now);

  const result: ReapResult = {
    success: true,
    dryRun: !execute,
    staleMinutes,
    maxAttempts,
    staleJobsFound: staleJobs.length,
    requeued: 0,
    deadLettered: 0,
    skipped: 0,
    jobs: [],
  };

  for (const job of staleJobs) {
    // Idempotency: skip if job status changed (e.g., already processed)
    const currentJob = store.getJob(job.job_id);
    if (!currentJob || currentJob.status !== 'in_progress') {
      result.jobs.push({
        job_id: job.job_id,
        tracking_id: job.tracking_id,
        action: 'skipped',
        attempts: job.attempts,
        reason: 'Status changed during reap',
      });
      result.skipped++;
      continue;
    }

    // Reaping counts as an attempt (design decision)
    const newAttempts = currentJob.attempts + 1;

    // Check if max attempts exceeded
    if (newAttempts > maxAttempts) {
      // Move to dead_letter
      if (execute) {
        currentJob.status = 'dead_letter';
        currentJob.attempts = newAttempts;
        currentJob.last_error_code = 'unknown';
        currentJob.last_error_message_hash = SendQueueStore.createErrorHash('Reaped: max attempts exceeded');
        currentJob.in_progress_started_at = undefined;
        store.updateJob(currentJob);
      }

      result.jobs.push({
        job_id: currentJob.job_id,
        tracking_id: currentJob.tracking_id,
        action: 'dead_lettered',
        attempts: newAttempts,
        reason: `Max attempts (${maxAttempts}) exceeded`,
      });
      result.deadLettered++;
    } else {
      // Requeue with backoff
      const backoff = retryPolicy.calculateBackoff(newAttempts);
      const nextAttemptAt = new Date(now.getTime() + backoff.backoffSeconds * 1000);

      if (execute) {
        currentJob.status = 'queued';
        currentJob.attempts = newAttempts;
        currentJob.next_attempt_at = nextAttemptAt.toISOString();
        currentJob.last_error_code = 'unknown';
        currentJob.last_error_message_hash = SendQueueStore.createErrorHash('Reaped: stale job recovered');
        currentJob.in_progress_started_at = undefined;
        store.updateJob(currentJob);
      }

      result.jobs.push({
        job_id: currentJob.job_id,
        tracking_id: currentJob.tracking_id,
        action: 'requeued',
        attempts: newAttempts,
        reason: `Reaped after ${staleMinutes}min stale, next attempt at ${nextAttemptAt.toISOString()}`,
      });
      result.requeued++;
    }
  }

  // Send notification if jobs were reaped and execute mode
  if (execute && notify && (result.requeued > 0 || result.deadLettered > 0)) {
    const sampleJobIds = result.jobs
      .filter(j => j.action !== 'skipped')
      .slice(0, 3)
      .map(j => j.job_id);

    notifySendQueueReaped({
      requeued: result.requeued,
      deadLettered: result.deadLettered,
      sampleJobIds,
    }).catch(() => {});
  }

  return result;
}

export default reapStaleJobs;
