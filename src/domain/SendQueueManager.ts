/**
 * Send Queue Manager
 *
 * Manages the send queue with lease-based processing and retry logic.
 *
 * 重要:
 * - PIIは使用しない
 * - 同じdraftの二重送信を防ぐ（冪等性）
 * - dead_letterに落ちたら人が確認して再キュー
 */

import {
  SendQueueStore,
  SendJob,
  SendJobStatus,
  SendErrorCode,
  getSendQueueStore,
} from '../data/SendQueueStore';
import { RetryPolicy, getRetryPolicy } from './RetryPolicy';

/**
 * Enqueue parameters
 */
export interface EnqueueParams {
  draft_id: string;
  tracking_id: string;
  company_id: string;
  template_id: string;
  ab_variant: 'A' | 'B' | null;
  to_domain: string;
  approval_fingerprint: string;
}

/**
 * Enqueue result
 */
export interface EnqueueResult {
  success: boolean;
  job_id?: string;
  job?: SendJob;
  error?: string;
  already_queued?: boolean;
  existing_job_id?: string;
}

/**
 * Lease result
 */
export interface LeaseResult {
  success: boolean;
  job?: SendJob;
  error?: string;
}

/**
 * Mark sent result
 */
export interface MarkSentResult {
  success: boolean;
  error?: string;
}

/**
 * Mark failed result
 */
export interface MarkFailedResult {
  success: boolean;
  action: 'retry' | 'fail' | 'dead_letter';
  next_attempt_at?: string;
  error?: string;
}

/**
 * Cancel result
 */
export interface CancelResult {
  success: boolean;
  error?: string;
}

/**
 * Retry dead letter result
 */
export interface RetryDeadLetterResult {
  success: boolean;
  job_id?: string;
  error?: string;
}

/**
 * Send Queue Manager class
 */
export class SendQueueManager {
  private readonly store: SendQueueStore;
  private readonly retryPolicy: RetryPolicy;

  constructor(options?: {
    store?: SendQueueStore;
    retryPolicy?: RetryPolicy;
  }) {
    this.store = options?.store || getSendQueueStore();
    this.retryPolicy = options?.retryPolicy || getRetryPolicy();
  }

  /**
   * Enqueue a send job
   * Returns error if same draft is already queued or sent
   */
  enqueue(params: EnqueueParams): EnqueueResult {
    // Check for duplicate draft
    const existing = this.store.findByDraftId(params.draft_id);
    if (existing) {
      // If already sent, reject
      if (existing.status === 'sent') {
        return {
          success: false,
          error: 'Draft already sent',
          already_queued: true,
          existing_job_id: existing.job_id,
        };
      }
      // If queued or in_progress, return the existing job
      if (existing.status === 'queued' || existing.status === 'in_progress') {
        return {
          success: true,
          job_id: existing.job_id,
          job: existing,
          already_queued: true,
          existing_job_id: existing.job_id,
        };
      }
      // If failed/dead_letter/cancelled, allow re-queue by creating new job
    }

    const job = this.store.createJob(params);

    return {
      success: true,
      job_id: job.job_id,
      job,
    };
  }

  /**
   * Lease the next ready job for processing
   * Changes status to in_progress and sets in_progress_started_at
   */
  leaseNextJob(now: Date = new Date()): LeaseResult {
    const job = this.store.findNextReadyJob(now);
    if (!job) {
      return { success: false, error: 'No jobs ready' };
    }

    // Transition to in_progress
    job.status = 'in_progress';
    job.attempts++;
    job.in_progress_started_at = now.toISOString();
    this.store.updateJob(job);

    return { success: true, job };
  }

  /**
   * Mark a job as successfully sent
   */
  markSent(jobId: string, meta: { message_id: string; thread_id: string }): MarkSentResult {
    const job = this.store.getJob(jobId);
    if (!job) {
      return { success: false, error: 'Job not found' };
    }

    // Idempotent: if already sent, succeed silently
    if (job.status === 'sent') {
      return { success: true };
    }

    // Only in_progress jobs can be marked sent
    if (job.status !== 'in_progress') {
      return { success: false, error: `Cannot mark ${job.status} job as sent` };
    }

    job.status = 'sent';
    job.message_id = meta.message_id;
    job.thread_id = meta.thread_id;
    job.sent_at = new Date().toISOString();
    job.last_error_code = undefined;
    job.last_error_message_hash = undefined;

    this.store.updateJob(job);
    return { success: true };
  }

  /**
   * Mark a job as failed
   * Handles retry logic based on error classification
   */
  markFailed(
    jobId: string,
    error: Error | string,
    httpStatus?: number
  ): MarkFailedResult {
    const job = this.store.getJob(jobId);
    if (!job) {
      return { success: false, action: 'fail', error: 'Job not found' };
    }

    // Only in_progress jobs can be marked failed
    if (job.status !== 'in_progress') {
      return { success: false, action: 'fail', error: `Cannot mark ${job.status} job as failed` };
    }

    const errorMessage = typeof error === 'string' ? error : error.message;
    const result = this.retryPolicy.handleFailure(job.attempts, error, httpStatus);

    job.last_error_code = result.classification.code;
    job.last_error_message_hash = SendQueueStore.createErrorHash(errorMessage);

    if (result.action === 'retry') {
      // Return to queued with backoff
      job.status = 'queued';
      job.next_attempt_at = result.backoff.nextAttemptAt.toISOString();
      this.store.updateJob(job);

      return {
        success: true,
        action: 'retry',
        next_attempt_at: job.next_attempt_at,
      };
    } else if (result.action === 'dead_letter') {
      job.status = 'dead_letter';
      this.store.updateJob(job);

      return {
        success: true,
        action: 'dead_letter',
      };
    } else {
      job.status = 'failed';
      this.store.updateJob(job);

      return {
        success: true,
        action: 'fail',
      };
    }
  }

  /**
   * Cancel a job
   */
  cancel(jobId: string, actor: string, reason: string): CancelResult {
    const job = this.store.getJob(jobId);
    if (!job) {
      return { success: false, error: 'Job not found' };
    }

    // Can only cancel queued or in_progress jobs
    if (job.status !== 'queued' && job.status !== 'in_progress') {
      return { success: false, error: `Cannot cancel ${job.status} job` };
    }

    job.status = 'cancelled';
    job.cancelled_by = actor;
    job.cancel_reason = reason;

    this.store.updateJob(job);
    return { success: true };
  }

  /**
   * Retry a dead letter job (re-queue)
   */
  retryDeadLetter(jobId: string, actor: string, reason: string): RetryDeadLetterResult {
    const job = this.store.getJob(jobId);
    if (!job) {
      return { success: false, error: 'Job not found' };
    }

    // Only dead_letter or failed jobs can be retried
    if (job.status !== 'dead_letter' && job.status !== 'failed') {
      return { success: false, error: `Cannot retry ${job.status} job` };
    }

    // Reset for retry
    job.status = 'queued';
    job.attempts = 0;
    job.next_attempt_at = new Date().toISOString();
    job.last_error_code = undefined;
    job.last_error_message_hash = undefined;

    this.store.updateJob(job);

    return {
      success: true,
      job_id: job.job_id,
    };
  }

  /**
   * Get job by ID
   */
  getJob(jobId: string): SendJob | null {
    return this.store.getJob(jobId);
  }

  /**
   * List jobs with optional filter
   */
  listJobs(filter?: { status?: SendJobStatus }): SendJob[] {
    return this.store.listJobs(filter);
  }

  /**
   * Count jobs by status
   */
  getStatusCounts(): Record<SendJobStatus, number> {
    return this.store.countByStatus();
  }

  /**
   * Get dead letter jobs
   */
  getDeadLetterJobs(): SendJob[] {
    return this.store.listJobs({ status: 'dead_letter' });
  }

  /**
   * Check if a job should be skipped (already sent)
   */
  shouldSkipJob(job: SendJob): boolean {
    return job.status === 'sent';
  }
}

/**
 * Singleton instance
 */
let defaultManager: SendQueueManager | null = null;

/**
 * Get or create default manager
 */
export function getSendQueueManager(): SendQueueManager {
  if (!defaultManager) {
    defaultManager = new SendQueueManager();
  }
  return defaultManager;
}

/**
 * Reset singleton (for testing)
 */
export function resetSendQueueManager(): void {
  defaultManager = null;
}

/**
 * Create manager for testing
 */
export function createTestSendQueueManager(options: {
  store: SendQueueStore;
  retryPolicy?: RetryPolicy;
}): SendQueueManager {
  return new SendQueueManager(options);
}

export default SendQueueManager;
