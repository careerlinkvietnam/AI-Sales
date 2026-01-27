/**
 * Send Queue Manager Tests
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  SendQueueManager,
  createTestSendQueueManager,
} from '../src/domain/SendQueueManager';
import {
  SendQueueStore,
  SendJob,
  createTestSendQueueStore,
} from '../src/data/SendQueueStore';
import { RetryPolicy, createTestRetryPolicy } from '../src/domain/RetryPolicy';

describe('SendQueueManager', () => {
  const testDir = path.join(__dirname, 'tmp_send_queue_manager_test');
  const testFilePath = path.join(testDir, 'test_queue.ndjson');
  let store: SendQueueStore;
  let policy: RetryPolicy;
  let manager: SendQueueManager;

  beforeEach(() => {
    // Create test directory
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    // Initialize empty queue file
    fs.writeFileSync(testFilePath, '');

    store = createTestSendQueueStore(testFilePath);
    policy = createTestRetryPolicy({
      maxAttempts: 3,
      jitterFactor: 0, // Disable jitter for deterministic tests
    });
    manager = createTestSendQueueManager({ store, retryPolicy: policy });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('enqueue', () => {
    it('creates a new job', () => {
      const result = manager.enqueue({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'fp12345',
      });

      expect(result.success).toBe(true);
      expect(result.job_id).toBeDefined();
      expect(result.job).toBeDefined();
      expect(result.job!.status).toBe('queued');
      expect(result.already_queued).toBeUndefined();
    });

    it('returns existing job if already queued', () => {
      const first = manager.enqueue({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'fp12345',
      });

      const second = manager.enqueue({
        draft_id: 'draft-123', // Same draft
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'fp12345',
      });

      expect(second.success).toBe(true);
      expect(second.already_queued).toBe(true);
      expect(second.existing_job_id).toBe(first.job_id);
    });

    it('rejects if draft already sent', () => {
      // Create and mark as sent
      const first = manager.enqueue({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'fp12345',
      });

      // Lease and mark sent
      manager.leaseNextJob();
      manager.markSent(first.job_id!, { message_id: 'msg-1', thread_id: 'th-1' });

      // Try to enqueue again
      const second = manager.enqueue({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'fp12345',
      });

      expect(second.success).toBe(false);
      expect(second.error).toContain('already sent');
      expect(second.already_queued).toBe(true);
    });

    it('allows re-queue for failed/dead_letter/cancelled jobs', () => {
      const first = manager.enqueue({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'fp12345',
      });

      // Lease and mark as dead_letter
      manager.leaseNextJob();
      manager.markFailed(first.job_id!, 'Auth error', 401);

      // Re-enqueue should work (creates new job)
      const second = manager.enqueue({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'fp12345',
      });

      expect(second.success).toBe(true);
      expect(second.job_id).not.toBe(first.job_id); // New job
    });
  });

  describe('leaseNextJob', () => {
    it('returns and transitions job to in_progress', () => {
      const enqueued = manager.enqueue({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'fp12345',
      });

      const result = manager.leaseNextJob();

      expect(result.success).toBe(true);
      expect(result.job).toBeDefined();
      expect(result.job!.job_id).toBe(enqueued.job_id);
      expect(result.job!.status).toBe('in_progress');
      expect(result.job!.attempts).toBe(1);
    });

    it('returns error when no jobs ready', () => {
      const result = manager.leaseNextJob();

      expect(result.success).toBe(false);
      expect(result.error).toBe('No jobs ready');
    });

    it('does not return job with future next_attempt_at', () => {
      const enqueued = manager.enqueue({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'fp12345',
      });

      // Set next_attempt_at to future
      const job = manager.getJob(enqueued.job_id!)!;
      job.next_attempt_at = new Date(Date.now() + 3600000).toISOString();
      store.updateJob(job);

      const result = manager.leaseNextJob();

      expect(result.success).toBe(false);
    });
  });

  describe('markSent', () => {
    it('marks job as sent with metadata', () => {
      manager.enqueue({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'fp12345',
      });

      const leased = manager.leaseNextJob();
      const result = manager.markSent(leased.job!.job_id, {
        message_id: 'msg-123',
        thread_id: 'thread-456',
      });

      expect(result.success).toBe(true);

      const job = manager.getJob(leased.job!.job_id);
      expect(job!.status).toBe('sent');
      expect(job!.message_id).toBe('msg-123');
      expect(job!.thread_id).toBe('thread-456');
      expect(job!.sent_at).toBeDefined();
    });

    it('is idempotent for already sent jobs', () => {
      manager.enqueue({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'fp12345',
      });

      const leased = manager.leaseNextJob();
      manager.markSent(leased.job!.job_id, {
        message_id: 'msg-123',
        thread_id: 'thread-456',
      });

      // Mark sent again
      const result = manager.markSent(leased.job!.job_id, {
        message_id: 'different-msg',
        thread_id: 'different-thread',
      });

      expect(result.success).toBe(true);
      // Should keep original message_id
      const job = manager.getJob(leased.job!.job_id);
      expect(job!.message_id).toBe('msg-123');
    });

    it('fails for non-existent job', () => {
      const result = manager.markSent('non-existent', {
        message_id: 'msg-123',
        thread_id: 'thread-456',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Job not found');
    });

    it('fails for queued job (not in_progress)', () => {
      const enqueued = manager.enqueue({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'fp12345',
      });

      // Try to mark sent without leasing
      const result = manager.markSent(enqueued.job_id!, {
        message_id: 'msg-123',
        thread_id: 'thread-456',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot mark');
    });
  });

  describe('markFailed', () => {
    it('returns retry for retryable errors under max attempts', () => {
      manager.enqueue({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'fp12345',
      });

      const leased = manager.leaseNextJob();
      const result = manager.markFailed(leased.job!.job_id, 'Rate limit exceeded', 429);

      expect(result.success).toBe(true);
      expect(result.action).toBe('retry');
      expect(result.next_attempt_at).toBeDefined();

      const job = manager.getJob(leased.job!.job_id);
      expect(job!.status).toBe('queued');
      expect(job!.last_error_code).toBe('gmail_429');
    });

    it('returns dead_letter at max attempts for retryable errors', () => {
      const enqueued = manager.enqueue({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'fp12345',
      });

      const jobId = enqueued.job_id!;

      // Attempt 1
      let leased = manager.leaseNextJob();
      expect(leased.success).toBe(true);
      expect(leased.job!.attempts).toBe(1);
      let fail = manager.markFailed(jobId, 'Rate limit', 429);
      expect(fail.action).toBe('retry');

      // Update next_attempt_at to now for immediate retry
      let job: SendJob | null = manager.getJob(jobId);
      expect(job).not.toBeNull();
      job!.next_attempt_at = new Date().toISOString();
      store.updateJob(job!);

      // Attempt 2
      leased = manager.leaseNextJob();
      expect(leased.success).toBe(true);
      expect(leased.job!.attempts).toBe(2);
      fail = manager.markFailed(jobId, 'Rate limit', 429);
      expect(fail.action).toBe('retry');

      // Update next_attempt_at
      job = manager.getJob(jobId);
      expect(job).not.toBeNull();
      job!.next_attempt_at = new Date().toISOString();
      store.updateJob(job!);

      // Attempt 3 - should hit max (maxAttempts=3)
      leased = manager.leaseNextJob();
      expect(leased.success).toBe(true);
      expect(leased.job!.attempts).toBe(3);
      fail = manager.markFailed(jobId, 'Rate limit', 429);

      expect(fail.action).toBe('dead_letter');

      job = manager.getJob(jobId);
      expect(job).not.toBeNull();
      expect(job!.status).toBe('dead_letter');
    });

    it('returns dead_letter immediately for non-retryable auth errors', () => {
      manager.enqueue({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'fp12345',
      });

      const leased = manager.leaseNextJob();
      const result = manager.markFailed(leased.job!.job_id, 'invalid_grant', 401);

      expect(result.success).toBe(true);
      expect(result.action).toBe('dead_letter');

      const job = manager.getJob(leased.job!.job_id);
      expect(job!.status).toBe('dead_letter');
      expect(job!.last_error_code).toBe('auth');
    });

    it('returns fail for non-retryable policy errors', () => {
      manager.enqueue({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'fp12345',
      });

      const leased = manager.leaseNextJob();
      const result = manager.markFailed(leased.job!.job_id, 'kill_switch active');

      expect(result.success).toBe(true);
      expect(result.action).toBe('fail');

      const job = manager.getJob(leased.job!.job_id);
      expect(job!.status).toBe('failed');
      expect(job!.last_error_code).toBe('policy');
    });

    it('fails for non-existent job', () => {
      const result = manager.markFailed('non-existent', 'Error');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Job not found');
    });
  });

  describe('cancel', () => {
    it('cancels queued job', () => {
      const enqueued = manager.enqueue({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'fp12345',
      });

      const result = manager.cancel(enqueued.job_id!, 'operator', 'Test cancellation');

      expect(result.success).toBe(true);

      const job = manager.getJob(enqueued.job_id!);
      expect(job!.status).toBe('cancelled');
      expect(job!.cancelled_by).toBe('operator');
      expect(job!.cancel_reason).toBe('Test cancellation');
    });

    it('cancels in_progress job', () => {
      manager.enqueue({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'fp12345',
      });

      const leased = manager.leaseNextJob();
      const result = manager.cancel(leased.job!.job_id, 'operator', 'Abort');

      expect(result.success).toBe(true);

      const job = manager.getJob(leased.job!.job_id);
      expect(job!.status).toBe('cancelled');
    });

    it('fails for sent job', () => {
      manager.enqueue({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'fp12345',
      });

      const leased = manager.leaseNextJob();
      manager.markSent(leased.job!.job_id, { message_id: 'm', thread_id: 't' });

      const result = manager.cancel(leased.job!.job_id, 'operator', 'Too late');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot cancel');
    });
  });

  describe('retryDeadLetter', () => {
    it('re-queues dead_letter job', () => {
      manager.enqueue({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'fp12345',
      });

      const leased = manager.leaseNextJob();
      manager.markFailed(leased.job!.job_id, 'Auth error', 401);

      // Verify in dead_letter
      let job = manager.getJob(leased.job!.job_id);
      expect(job!.status).toBe('dead_letter');

      // Retry
      const result = manager.retryDeadLetter(leased.job!.job_id, 'operator', 'Fixed auth');

      expect(result.success).toBe(true);
      expect(result.job_id).toBe(leased.job!.job_id);

      // Verify re-queued
      job = manager.getJob(leased.job!.job_id);
      expect(job!.status).toBe('queued');
      expect(job!.attempts).toBe(0);
      expect(job!.last_error_code).toBeUndefined();
    });

    it('re-queues failed job', () => {
      manager.enqueue({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'fp12345',
      });

      const leased = manager.leaseNextJob();
      manager.markFailed(leased.job!.job_id, 'Policy error');

      // Verify failed
      let job = manager.getJob(leased.job!.job_id);
      expect(job!.status).toBe('failed');

      // Retry
      const result = manager.retryDeadLetter(leased.job!.job_id, 'operator', 'Policy fixed');

      expect(result.success).toBe(true);

      job = manager.getJob(leased.job!.job_id);
      expect(job!.status).toBe('queued');
    });

    it('fails for queued job', () => {
      const enqueued = manager.enqueue({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'fp12345',
      });

      const result = manager.retryDeadLetter(enqueued.job_id!, 'operator', 'Why?');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot retry');
    });
  });

  describe('getStatusCounts', () => {
    it('returns counts by status', () => {
      // Create and process jobs in sequence to maintain predictable order

      // Job 1: Create and leave as queued
      const e1 = manager.enqueue({
        draft_id: 'draft-1',
        tracking_id: 't1',
        company_id: 'c1',
        template_id: 't1',
        ab_variant: null,
        to_domain: 'e.com',
        approval_fingerprint: 'f1',
      });
      // Lease and mark as sent
      manager.leaseNextJob();
      manager.markSent(e1.job_id!, { message_id: 'm1', thread_id: 't1' });

      // Job 2: Create and mark as dead_letter
      const e2 = manager.enqueue({
        draft_id: 'draft-2',
        tracking_id: 't2',
        company_id: 'c2',
        template_id: 't2',
        ab_variant: null,
        to_domain: 'e.com',
        approval_fingerprint: 'f2',
      });
      manager.leaseNextJob();
      manager.markFailed(e2.job_id!, 'Auth', 401);

      // Job 3: Create and leave as queued
      manager.enqueue({
        draft_id: 'draft-3',
        tracking_id: 't3',
        company_id: 'c3',
        template_id: 't3',
        ab_variant: null,
        to_domain: 'e.com',
        approval_fingerprint: 'f3',
      });

      const counts = manager.getStatusCounts();

      expect(counts.queued).toBe(1);
      expect(counts.sent).toBe(1);
      expect(counts.dead_letter).toBe(1);
    });
  });

  describe('getDeadLetterJobs', () => {
    it('returns only dead_letter jobs', () => {
      const e1 = manager.enqueue({
        draft_id: 'draft-1',
        tracking_id: 't1',
        company_id: 'c1',
        template_id: 't1',
        ab_variant: null,
        to_domain: 'e.com',
        approval_fingerprint: 'f1',
      });

      const e2 = manager.enqueue({
        draft_id: 'draft-2',
        tracking_id: 't2',
        company_id: 'c2',
        template_id: 't2',
        ab_variant: null,
        to_domain: 'e.com',
        approval_fingerprint: 'f2',
      });

      // Make e1 dead_letter
      manager.leaseNextJob();
      manager.markFailed(e1.job_id!, 'Auth', 401);

      // Make e2 sent
      manager.leaseNextJob();
      manager.markSent(e2.job_id!, { message_id: 'm', thread_id: 't' });

      const deadLetters = manager.getDeadLetterJobs();

      expect(deadLetters.length).toBe(1);
      expect(deadLetters[0].job_id).toBe(e1.job_id);
    });
  });

  describe('shouldSkipJob', () => {
    it('returns true for sent jobs', () => {
      manager.enqueue({
        draft_id: 'draft-1',
        tracking_id: 't1',
        company_id: 'c1',
        template_id: 't1',
        ab_variant: null,
        to_domain: 'e.com',
        approval_fingerprint: 'f1',
      });

      const leased = manager.leaseNextJob();
      manager.markSent(leased.job!.job_id, { message_id: 'm', thread_id: 't' });

      const job = manager.getJob(leased.job!.job_id)!;
      expect(manager.shouldSkipJob(job)).toBe(true);
    });

    it('returns false for queued jobs', () => {
      const enqueued = manager.enqueue({
        draft_id: 'draft-1',
        tracking_id: 't1',
        company_id: 'c1',
        template_id: 't1',
        ab_variant: null,
        to_domain: 'e.com',
        approval_fingerprint: 'f1',
      });

      const job = manager.getJob(enqueued.job_id!)!;
      expect(manager.shouldSkipJob(job)).toBe(false);
    });

    it('returns false for in_progress jobs', () => {
      manager.enqueue({
        draft_id: 'draft-1',
        tracking_id: 't1',
        company_id: 'c1',
        template_id: 't1',
        ab_variant: null,
        to_domain: 'e.com',
        approval_fingerprint: 'f1',
      });

      const leased = manager.leaseNextJob();
      expect(manager.shouldSkipJob(leased.job!)).toBe(false);
    });
  });
});
