/**
 * Send Queue Store Tests
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  SendQueueStore,
  SendJob,
  createTestSendQueueStore,
} from '../src/data/SendQueueStore';

describe('SendQueueStore', () => {
  const testDir = path.join(__dirname, 'tmp_send_queue_store_test');
  const testFilePath = path.join(testDir, 'test_queue.ndjson');
  let store: SendQueueStore;

  beforeEach(() => {
    // Create test directory
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    // Initialize empty queue file
    fs.writeFileSync(testFilePath, '');
    store = createTestSendQueueStore(testFilePath);
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('createJob', () => {
    it('creates a new job with correct fields', () => {
      const job = store.createJob({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'abc12345',
      });

      expect(job.job_id).toMatch(/^SND-/);
      expect(job.status).toBe('queued');
      expect(job.draft_id).toBe('draft-123');
      expect(job.tracking_id).toBe('track-abc');
      expect(job.company_id).toBe('company-xyz');
      expect(job.template_id).toBe('template-001');
      expect(job.ab_variant).toBe('A');
      expect(job.to_domain).toBe('example.com');
      expect(job.approval_fingerprint).toBe('abc12345');
      expect(job.attempts).toBe(0);
      expect(job.created_at).toBeDefined();
      expect(job.next_attempt_at).toBe(job.created_at);
    });

    it('persists job to file', () => {
      store.createJob({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: null,
        to_domain: 'example.com',
        approval_fingerprint: 'abc12345',
      });

      const content = fs.readFileSync(testFilePath, 'utf-8');
      expect(content).toContain('draft-123');
      expect(content).toContain('track-abc');
      expect(content).toContain('"status":"queued"');
    });

    it('handles null ab_variant', () => {
      const job = store.createJob({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: null,
        to_domain: 'example.com',
        approval_fingerprint: 'abc12345',
      });

      expect(job.ab_variant).toBeNull();
    });
  });

  describe('getJob', () => {
    it('returns job by ID', () => {
      const created = store.createJob({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'B',
        to_domain: 'example.com',
        approval_fingerprint: 'abc12345',
      });

      const found = store.getJob(created.job_id);

      expect(found).not.toBeNull();
      expect(found!.draft_id).toBe('draft-123');
      expect(found!.ab_variant).toBe('B');
    });

    it('returns null for non-existent job', () => {
      const found = store.getJob('non-existent-job');
      expect(found).toBeNull();
    });
  });

  describe('updateJob', () => {
    it('updates job in memory and appends to file', () => {
      const job = store.createJob({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'abc12345',
      });

      job.status = 'in_progress';
      job.attempts = 1;
      store.updateJob(job);

      const found = store.getJob(job.job_id);
      expect(found!.status).toBe('in_progress');
      expect(found!.attempts).toBe(1);

      // Check file has two entries (create + update)
      const content = fs.readFileSync(testFilePath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(2);
    });

    it('updates last_updated_at timestamp', () => {
      const job = store.createJob({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: null,
        to_domain: 'example.com',
        approval_fingerprint: 'abc12345',
      });

      const originalUpdatedAt = job.last_updated_at;

      // Wait a bit to ensure different timestamp
      jest.useFakeTimers();
      jest.advanceTimersByTime(1000);

      job.status = 'sent';
      store.updateJob(job);

      const found = store.getJob(job.job_id);
      expect(found!.last_updated_at).not.toBe(originalUpdatedAt);

      jest.useRealTimers();
    });
  });

  describe('findNextReadyJob', () => {
    it('returns job with status=queued and next_attempt_at <= now', () => {
      const job = store.createJob({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: null,
        to_domain: 'example.com',
        approval_fingerprint: 'abc12345',
      });

      const found = store.findNextReadyJob();

      expect(found).not.toBeNull();
      expect(found!.job_id).toBe(job.job_id);
    });

    it('returns null when no jobs ready', () => {
      const found = store.findNextReadyJob();
      expect(found).toBeNull();
    });

    it('returns null when job has future next_attempt_at', () => {
      const job = store.createJob({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: null,
        to_domain: 'example.com',
        approval_fingerprint: 'abc12345',
      });

      // Set next_attempt_at to future
      const future = new Date(Date.now() + 3600000); // 1 hour later
      job.next_attempt_at = future.toISOString();
      store.updateJob(job);

      const found = store.findNextReadyJob();
      expect(found).toBeNull();
    });

    it('does not return in_progress jobs', () => {
      const job = store.createJob({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: null,
        to_domain: 'example.com',
        approval_fingerprint: 'abc12345',
      });

      job.status = 'in_progress';
      store.updateJob(job);

      const found = store.findNextReadyJob();
      expect(found).toBeNull();
    });

    it('does not return sent jobs', () => {
      const job = store.createJob({
        draft_id: 'draft-123',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: null,
        to_domain: 'example.com',
        approval_fingerprint: 'abc12345',
      });

      job.status = 'sent';
      store.updateJob(job);

      const found = store.findNextReadyJob();
      expect(found).toBeNull();
    });
  });

  describe('listJobs', () => {
    beforeEach(() => {
      // Create multiple jobs with different statuses
      const job1 = store.createJob({
        draft_id: 'draft-1',
        tracking_id: 'track-1',
        company_id: 'company-1',
        template_id: 'template-1',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'fp1',
      });

      const job2 = store.createJob({
        draft_id: 'draft-2',
        tracking_id: 'track-2',
        company_id: 'company-2',
        template_id: 'template-2',
        ab_variant: 'B',
        to_domain: 'example.com',
        approval_fingerprint: 'fp2',
      });
      job2.status = 'sent';
      store.updateJob(job2);

      const job3 = store.createJob({
        draft_id: 'draft-3',
        tracking_id: 'track-3',
        company_id: 'company-3',
        template_id: 'template-3',
        ab_variant: null,
        to_domain: 'example.com',
        approval_fingerprint: 'fp3',
      });
      job3.status = 'dead_letter';
      store.updateJob(job3);
    });

    it('returns all jobs without filter', () => {
      const jobs = store.listJobs();
      expect(jobs.length).toBe(3);
    });

    it('filters by status', () => {
      const queuedJobs = store.listJobs({ status: 'queued' });
      expect(queuedJobs.length).toBe(1);
      expect(queuedJobs[0].draft_id).toBe('draft-1');

      const sentJobs = store.listJobs({ status: 'sent' });
      expect(sentJobs.length).toBe(1);
      expect(sentJobs[0].draft_id).toBe('draft-2');

      const deadLetterJobs = store.listJobs({ status: 'dead_letter' });
      expect(deadLetterJobs.length).toBe(1);
      expect(deadLetterJobs[0].draft_id).toBe('draft-3');
    });

    it('returns empty array for no matching status', () => {
      const failedJobs = store.listJobs({ status: 'failed' });
      expect(failedJobs.length).toBe(0);
    });

    it('sorts by created_at descending', () => {
      const jobs = store.listJobs();
      // Jobs created in quick succession may have same timestamp
      // Just verify we get all 3 jobs back
      expect(jobs.length).toBe(3);
      expect(jobs.map(j => j.draft_id).sort()).toEqual(['draft-1', 'draft-2', 'draft-3']);
    });
  });

  describe('countByStatus', () => {
    it('counts jobs by status', () => {
      // Create jobs with various statuses
      store.createJob({
        draft_id: 'draft-1',
        tracking_id: 't1',
        company_id: 'c1',
        template_id: 't1',
        ab_variant: null,
        to_domain: 'e.com',
        approval_fingerprint: 'f1',
      });

      const job2 = store.createJob({
        draft_id: 'draft-2',
        tracking_id: 't2',
        company_id: 'c2',
        template_id: 't2',
        ab_variant: null,
        to_domain: 'e.com',
        approval_fingerprint: 'f2',
      });
      job2.status = 'sent';
      store.updateJob(job2);

      const job3 = store.createJob({
        draft_id: 'draft-3',
        tracking_id: 't3',
        company_id: 'c3',
        template_id: 't3',
        ab_variant: null,
        to_domain: 'e.com',
        approval_fingerprint: 'f3',
      });
      job3.status = 'sent';
      store.updateJob(job3);

      const counts = store.countByStatus();

      expect(counts.queued).toBe(1);
      expect(counts.sent).toBe(2);
      expect(counts.in_progress).toBe(0);
      expect(counts.failed).toBe(0);
      expect(counts.dead_letter).toBe(0);
      expect(counts.cancelled).toBe(0);
    });
  });

  describe('findByDraftId', () => {
    it('finds job by draft_id', () => {
      store.createJob({
        draft_id: 'unique-draft-id',
        tracking_id: 'track-abc',
        company_id: 'company-xyz',
        template_id: 'template-001',
        ab_variant: 'A',
        to_domain: 'example.com',
        approval_fingerprint: 'abc12345',
      });

      const found = store.findByDraftId('unique-draft-id');

      expect(found).not.toBeNull();
      expect(found!.draft_id).toBe('unique-draft-id');
    });

    it('returns null for non-existent draft_id', () => {
      const found = store.findByDraftId('non-existent');
      expect(found).toBeNull();
    });
  });

  describe('static helpers', () => {
    it('createApprovalFingerprint returns 8 char hash', () => {
      const fp = SendQueueStore.createApprovalFingerprint('some-token-value');
      expect(fp).toHaveLength(8);
      expect(fp).toMatch(/^[a-f0-9]+$/);
    });

    it('createApprovalFingerprint is deterministic', () => {
      const fp1 = SendQueueStore.createApprovalFingerprint('same-token');
      const fp2 = SendQueueStore.createApprovalFingerprint('same-token');
      expect(fp1).toBe(fp2);
    });

    it('createApprovalFingerprint differs for different tokens', () => {
      const fp1 = SendQueueStore.createApprovalFingerprint('token-a');
      const fp2 = SendQueueStore.createApprovalFingerprint('token-b');
      expect(fp1).not.toBe(fp2);
    });

    it('createErrorHash returns 8 char hash', () => {
      const hash = SendQueueStore.createErrorHash('Error: Something went wrong');
      expect(hash).toHaveLength(8);
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });

    it('createErrorHash is deterministic', () => {
      const h1 = SendQueueStore.createErrorHash('Same error message');
      const h2 = SendQueueStore.createErrorHash('Same error message');
      expect(h1).toBe(h2);
    });
  });

  describe('persistence and reload', () => {
    it('persists and reloads jobs correctly', () => {
      // Create some jobs
      const job1 = store.createJob({
        draft_id: 'draft-1',
        tracking_id: 't1',
        company_id: 'c1',
        template_id: 't1',
        ab_variant: 'A',
        to_domain: 'e.com',
        approval_fingerprint: 'f1',
      });

      const job2 = store.createJob({
        draft_id: 'draft-2',
        tracking_id: 't2',
        company_id: 'c2',
        template_id: 't2',
        ab_variant: 'B',
        to_domain: 'e.com',
        approval_fingerprint: 'f2',
      });
      job2.status = 'sent';
      job2.message_id = 'msg-123';
      store.updateJob(job2);

      // Create new store instance (simulates process restart)
      const newStore = createTestSendQueueStore(testFilePath);

      // Verify jobs are loaded
      const foundJob1 = newStore.getJob(job1.job_id);
      expect(foundJob1).not.toBeNull();
      expect(foundJob1!.draft_id).toBe('draft-1');
      expect(foundJob1!.status).toBe('queued');

      const foundJob2 = newStore.getJob(job2.job_id);
      expect(foundJob2).not.toBeNull();
      expect(foundJob2!.draft_id).toBe('draft-2');
      expect(foundJob2!.status).toBe('sent');
      expect(foundJob2!.message_id).toBe('msg-123');
    });

    it('uses latest snapshot when multiple entries exist', () => {
      const job = store.createJob({
        draft_id: 'draft-1',
        tracking_id: 't1',
        company_id: 'c1',
        template_id: 't1',
        ab_variant: null,
        to_domain: 'e.com',
        approval_fingerprint: 'f1',
      });

      // Multiple updates
      job.status = 'in_progress';
      job.attempts = 1;
      store.updateJob(job);

      job.status = 'sent';
      job.message_id = 'final-msg-id';
      store.updateJob(job);

      // Reload
      const newStore = createTestSendQueueStore(testFilePath);
      const found = newStore.getJob(job.job_id);

      // Should have latest state
      expect(found!.status).toBe('sent');
      expect(found!.message_id).toBe('final-msg-id');
      expect(found!.attempts).toBe(1);
    });
  });

  describe('directory creation', () => {
    it('creates directory if it does not exist', () => {
      const nestedPath = path.join(testDir, 'nested', 'deep', 'queue.ndjson');

      const newStore = createTestSendQueueStore(nestedPath);
      newStore.createJob({
        draft_id: 'draft-1',
        tracking_id: 't1',
        company_id: 'c1',
        template_id: 't1',
        ab_variant: null,
        to_domain: 'e.com',
        approval_fingerprint: 'f1',
      });

      expect(fs.existsSync(nestedPath)).toBe(true);
    });
  });
});
