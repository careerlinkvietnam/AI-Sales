/**
 * Send Queue Store
 *
 * Persistent queue for email sends with retry support.
 * Append-only NDJSON format - latest snapshot for each job_id is used.
 *
 * 重要:
 * - PIIは保存禁止（メールアドレス、本文禁止）
 * - to_domain のみ保存（ドメイン部分のみ）
 * - approval_fingerprint のみ保存（トークン本体は保存しない）
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Job status
 */
export type SendJobStatus =
  | 'queued'
  | 'in_progress'
  | 'sent'
  | 'failed'
  | 'dead_letter'
  | 'cancelled';

/**
 * Error code classification
 */
export type SendErrorCode =
  | 'gmail_429'
  | 'gmail_5xx'
  | 'gmail_400'
  | 'auth'
  | 'policy'
  | 'gate'
  | 'not_found'
  | 'unknown';

/**
 * Send job record (PII-free)
 */
export interface SendJob {
  job_id: string;
  created_at: string;
  status: SendJobStatus;
  draft_id: string;
  tracking_id: string;
  company_id: string;
  template_id: string;
  ab_variant: 'A' | 'B' | null;
  to_domain: string;
  approval_fingerprint: string;
  attempts: number;
  next_attempt_at: string;
  in_progress_started_at?: string; // When job was leased (for stale detection)
  last_error_code?: SendErrorCode;
  last_error_message_hash?: string;
  last_updated_at: string;
  // Success metadata
  message_id?: string;
  thread_id?: string;
  sent_at?: string;
  // Cancellation metadata
  cancelled_by?: string;
  cancel_reason?: string;
}

/**
 * Default data directory and file
 */
const DEFAULT_DATA_DIR = 'data';
const DEFAULT_QUEUE_FILE = 'send_queue.ndjson';

/**
 * Send Queue Store class
 */
export class SendQueueStore {
  private readonly filePath: string;
  private jobs: Map<string, SendJob> = new Map();

  constructor(filePath?: string) {
    this.filePath = filePath || path.join(DEFAULT_DATA_DIR, DEFAULT_QUEUE_FILE);
    this.loadFromFile();
  }

  /**
   * Load jobs from file (latest snapshot per job_id)
   */
  private loadFromFile(): void {
    this.jobs.clear();

    if (!fs.existsSync(this.filePath)) {
      return;
    }

    try {
      const content = fs.readFileSync(this.filePath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());

      for (const line of lines) {
        try {
          const job = JSON.parse(line) as SendJob;
          // Always use the latest snapshot for each job_id
          this.jobs.set(job.job_id, job);
        } catch {
          // Skip invalid lines
        }
      }
    } catch {
      // File doesn't exist or can't be read
    }
  }

  /**
   * Append job snapshot to file
   */
  private appendToFile(job: SendJob): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const line = JSON.stringify(job) + '\n';
    fs.appendFileSync(this.filePath, line, 'utf-8');
  }

  /**
   * Generate a new job ID
   */
  generateJobId(): string {
    return `SND-${crypto.randomUUID().substring(0, 12)}`;
  }

  /**
   * Create approval fingerprint from token (first 8 chars of SHA256)
   */
  static createApprovalFingerprint(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex').substring(0, 8);
  }

  /**
   * Create error message hash (for deduplication, no PII)
   */
  static createErrorHash(message: string): string {
    return crypto.createHash('sha256').update(message).digest('hex').substring(0, 8);
  }

  /**
   * Create a new job
   */
  createJob(params: {
    draft_id: string;
    tracking_id: string;
    company_id: string;
    template_id: string;
    ab_variant: 'A' | 'B' | null;
    to_domain: string;
    approval_fingerprint: string;
  }): SendJob {
    const now = new Date().toISOString();
    const job: SendJob = {
      job_id: this.generateJobId(),
      created_at: now,
      status: 'queued',
      draft_id: params.draft_id,
      tracking_id: params.tracking_id,
      company_id: params.company_id,
      template_id: params.template_id,
      ab_variant: params.ab_variant,
      to_domain: params.to_domain,
      approval_fingerprint: params.approval_fingerprint,
      attempts: 0,
      next_attempt_at: now,
      last_updated_at: now,
    };

    this.jobs.set(job.job_id, job);
    this.appendToFile(job);
    return job;
  }

  /**
   * Get a job by ID
   */
  getJob(jobId: string): SendJob | null {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Update a job (appends new snapshot)
   */
  updateJob(job: SendJob): void {
    job.last_updated_at = new Date().toISOString();
    this.jobs.set(job.job_id, job);
    this.appendToFile(job);
  }

  /**
   * Find next job ready to process
   * Returns jobs with status=queued and next_attempt_at <= now
   */
  findNextReadyJob(now: Date = new Date()): SendJob | null {
    const nowStr = now.toISOString();

    for (const job of this.jobs.values()) {
      if (job.status === 'queued' && job.next_attempt_at <= nowStr) {
        return job;
      }
    }

    return null;
  }

  /**
   * List jobs by status
   */
  listJobs(filter?: { status?: SendJobStatus }): SendJob[] {
    let result = Array.from(this.jobs.values());

    if (filter?.status) {
      result = result.filter((j) => j.status === filter.status);
    }

    // Sort by created_at descending
    result.sort((a, b) => b.created_at.localeCompare(a.created_at));

    return result;
  }

  /**
   * Count jobs by status
   */
  countByStatus(): Record<SendJobStatus, number> {
    const counts: Record<SendJobStatus, number> = {
      queued: 0,
      in_progress: 0,
      sent: 0,
      failed: 0,
      dead_letter: 0,
      cancelled: 0,
    };

    for (const job of this.jobs.values()) {
      counts[job.status]++;
    }

    return counts;
  }

  /**
   * Check if a draft is already queued or sent
   */
  findByDraftId(draftId: string): SendJob | null {
    for (const job of this.jobs.values()) {
      if (job.draft_id === draftId) {
        return job;
      }
    }
    return null;
  }

  /**
   * Find stale in_progress jobs (for reaper)
   * Returns jobs that have been in_progress for longer than staleMinutes
   */
  findStaleJobs(staleMinutes: number, now: Date = new Date()): SendJob[] {
    const staleThreshold = new Date(now.getTime() - staleMinutes * 60 * 1000);
    const staleJobs: SendJob[] = [];

    for (const job of this.jobs.values()) {
      if (job.status === 'in_progress' && job.in_progress_started_at) {
        const startedAt = new Date(job.in_progress_started_at);
        if (startedAt < staleThreshold) {
          staleJobs.push(job);
        }
      }
    }

    // Sort by in_progress_started_at ascending (oldest first)
    staleJobs.sort((a, b) =>
      (a.in_progress_started_at || '').localeCompare(b.in_progress_started_at || '')
    );

    return staleJobs;
  }

  /**
   * Get all jobs (for compaction)
   */
  getAllJobs(): SendJob[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Reload from file (for testing)
   */
  reload(): void {
    this.loadFromFile();
  }

  /**
   * Get file path
   */
  getFilePath(): string {
    return this.filePath;
  }
}

/**
 * Singleton instance
 */
let defaultStore: SendQueueStore | null = null;

/**
 * Get or create default store
 */
export function getSendQueueStore(): SendQueueStore {
  if (!defaultStore) {
    defaultStore = new SendQueueStore();
  }
  return defaultStore;
}

/**
 * Reset singleton (for testing)
 */
export function resetSendQueueStore(): void {
  defaultStore = null;
}

/**
 * Create store for testing
 */
export function createTestSendQueueStore(filePath: string): SendQueueStore {
  return new SendQueueStore(filePath);
}

export default SendQueueStore;
