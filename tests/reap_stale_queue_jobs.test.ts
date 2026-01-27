/**
 * Reap Stale Queue Jobs Tests
 */

import * as fs from 'fs';
import * as path from 'path';
import { reapStaleJobs, loadReaperConfig } from '../src/jobs/ReapStaleQueueJobs';
import {
  SendQueueStore,
  createTestSendQueueStore,
  resetSendQueueStore,
} from '../src/data/SendQueueStore';
import { RetryPolicy, createTestRetryPolicy, resetRetryPolicy } from '../src/domain/RetryPolicy';

// Mock notifications
jest.mock('../src/notifications', () => ({
  notifySendQueueReaped: jest.fn().mockResolvedValue(undefined),
}));

describe('ReapStaleQueueJobs', () => {
  const testDir = path.join(__dirname, 'tmp_reap_stale_test');
  const queueFilePath = path.join(testDir, 'test_queue.ndjson');
  let store: SendQueueStore;
  let policy: RetryPolicy;

  beforeEach(() => {
    // Create test directory
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    // Initialize empty files
    fs.writeFileSync(queueFilePath, '');

    // Reset singletons
    resetSendQueueStore();
    resetRetryPolicy();

    // Create test instances
    store = createTestSendQueueStore(queueFilePath);
    policy = createTestRetryPolicy({
      maxAttempts: 8,
      jitterFactor: 0,
    });

    jest.clearAllMocks();
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    resetSendQueueStore();
    resetRetryPolicy();
  });

  describe('loadReaperConfig', () => {
    it('returns default config when file does not exist', () => {
      const config = loadReaperConfig('/nonexistent/path.json');
      expect(config.stale_minutes).toBe(30);
      expect(config.max_attempts).toBe(8);
      expect(config.reap_action).toBe('requeue');
    });

    it('loads config from file', () => {
      const configPath = path.join(testDir, 'test_config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          reaper: {
            stale_minutes: 15,
            max_attempts: 5,
            reap_action: 'dead_letter',
          },
        })
      );

      const config = loadReaperConfig(configPath);
      expect(config.stale_minutes).toBe(15);
      expect(config.max_attempts).toBe(5);
      expect(config.reap_action).toBe('dead_letter');
    });
  });

  describe('reapStaleJobs', () => {
    it('finds no stale jobs when queue is empty', () => {
      const result = reapStaleJobs({
        store,
        retryPolicy: policy,
        execute: false,
        notify: false,
      });

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.staleJobsFound).toBe(0);
      expect(result.requeued).toBe(0);
      expect(result.deadLettered).toBe(0);
    });

    it('finds no stale jobs when all jobs are recent', () => {
      // Create a job and set it to in_progress with recent timestamp
      const job = store.createJob({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'fp12345',
      });
      job.status = 'in_progress';
      job.in_progress_started_at = new Date().toISOString();
      job.attempts = 1;
      store.updateJob(job);

      const result = reapStaleJobs({
        store,
        retryPolicy: policy,
        staleMinutes: 30,
        execute: false,
        notify: false,
      });

      expect(result.staleJobsFound).toBe(0);
    });

    it('finds stale jobs that exceed threshold', () => {
      // Create a job and set it to in_progress with old timestamp
      const job = store.createJob({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'fp12345',
      });

      // Set in_progress_started_at to 40 minutes ago
      const fortyMinutesAgo = new Date(Date.now() - 40 * 60 * 1000);
      job.status = 'in_progress';
      job.in_progress_started_at = fortyMinutesAgo.toISOString();
      job.attempts = 1;
      store.updateJob(job);

      const result = reapStaleJobs({
        store,
        retryPolicy: policy,
        staleMinutes: 30,
        execute: false,
        notify: false,
      });

      expect(result.staleJobsFound).toBe(1);
      expect(result.requeued).toBe(1);
      expect(result.deadLettered).toBe(0);
    });

    it('requeues stale job in dry-run mode without changes', () => {
      const job = store.createJob({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'fp12345',
      });

      const fortyMinutesAgo = new Date(Date.now() - 40 * 60 * 1000);
      job.status = 'in_progress';
      job.in_progress_started_at = fortyMinutesAgo.toISOString();
      job.attempts = 1;
      store.updateJob(job);

      // Dry run
      reapStaleJobs({
        store,
        retryPolicy: policy,
        staleMinutes: 30,
        execute: false,
        notify: false,
      });

      // Job should still be in_progress
      const updatedJob = store.getJob(job.job_id);
      expect(updatedJob!.status).toBe('in_progress');
    });

    it('requeues stale job in execute mode', () => {
      const job = store.createJob({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'fp12345',
      });

      const fortyMinutesAgo = new Date(Date.now() - 40 * 60 * 1000);
      job.status = 'in_progress';
      job.in_progress_started_at = fortyMinutesAgo.toISOString();
      job.attempts = 1;
      store.updateJob(job);

      const result = reapStaleJobs({
        store,
        retryPolicy: policy,
        staleMinutes: 30,
        execute: true,
        notify: false,
      });

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(false);
      expect(result.requeued).toBe(1);

      // Job should be back in queue with incremented attempts
      const updatedJob = store.getJob(job.job_id);
      expect(updatedJob!.status).toBe('queued');
      expect(updatedJob!.attempts).toBe(2); // Was 1, now 2 (reap counts as attempt)
      expect(updatedJob!.in_progress_started_at).toBeUndefined();
    });

    it('moves job to dead_letter when max attempts exceeded', () => {
      const job = store.createJob({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'fp12345',
      });

      const fortyMinutesAgo = new Date(Date.now() - 40 * 60 * 1000);
      job.status = 'in_progress';
      job.in_progress_started_at = fortyMinutesAgo.toISOString();
      job.attempts = 8; // At max already
      store.updateJob(job);

      const result = reapStaleJobs({
        store,
        retryPolicy: policy,
        staleMinutes: 30,
        maxAttempts: 8,
        execute: true,
        notify: false,
      });

      expect(result.deadLettered).toBe(1);
      expect(result.requeued).toBe(0);

      const updatedJob = store.getJob(job.job_id);
      expect(updatedJob!.status).toBe('dead_letter');
      expect(updatedJob!.attempts).toBe(9); // Was 8, now 9
    });

    it('is idempotent - skips jobs that changed status', () => {
      const job = store.createJob({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'fp12345',
      });

      const fortyMinutesAgo = new Date(Date.now() - 40 * 60 * 1000);
      job.status = 'in_progress';
      job.in_progress_started_at = fortyMinutesAgo.toISOString();
      job.attempts = 1;
      store.updateJob(job);

      // First reap
      reapStaleJobs({
        store,
        retryPolicy: policy,
        staleMinutes: 30,
        execute: true,
        notify: false,
      });

      // Second reap should find nothing (job is now queued, not in_progress)
      const result2 = reapStaleJobs({
        store,
        retryPolicy: policy,
        staleMinutes: 30,
        execute: true,
        notify: false,
      });

      expect(result2.staleJobsFound).toBe(0);
    });

    it('handles multiple stale jobs', () => {
      // Create 3 stale jobs
      for (let i = 0; i < 3; i++) {
        const job = store.createJob({
          draft_id: `draft-${i}`,
          tracking_id: `track-${i}`,
          company_id: `company-${i}`,
          template_id: 'template-001',
          ab_variant: 'A',
          to_domain: 'example.com',
          approval_fingerprint: `fp${i}`,
        });

        const fortyMinutesAgo = new Date(Date.now() - 40 * 60 * 1000 - i * 1000);
        job.status = 'in_progress';
        job.in_progress_started_at = fortyMinutesAgo.toISOString();
        job.attempts = i + 1;
        store.updateJob(job);
      }

      const result = reapStaleJobs({
        store,
        retryPolicy: policy,
        staleMinutes: 30,
        execute: true,
        notify: false,
      });

      expect(result.staleJobsFound).toBe(3);
      expect(result.jobs.length).toBe(3);
    });
  });
});
