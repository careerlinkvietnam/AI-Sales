/**
 * Draft Registry
 *
 * Stores metadata about drafts created by the system (PII-free).
 * Enables verification that a draft was created by this system before sending.
 *
 * 保存場所: data/drafts.ndjson (gitignore)
 *
 * 設計原則:
 * - PIIを保存しない（メールアドレスは保存せず、ドメインのみ）
 * - subject/bodyはハッシュのみ保存
 * - send_draft時にこのレジストリを参照し、本システム生成の下書きのみ送信可能にする
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Draft entry structure (PII-free)
 */
export interface DraftEntry {
  /** Creation timestamp in ISO format */
  timestamp: string;
  /** Gmail draft ID */
  draftId: string;
  /** Tracking ID for this email */
  trackingId: string;
  /** Company ID */
  companyId: string;
  /** Template ID used */
  templateId: string;
  /** A/B variant */
  abVariant: 'A' | 'B' | null;
  /** SHA-256 hash of subject (not the subject itself) */
  subjectHash: string;
  /** SHA-256 hash of body (not the body itself) */
  bodyHash: string;
  /** Recipient domain only (no full email address - PII protection) */
  toDomain: string;
}

/**
 * Lookup result when finding a draft
 */
export interface DraftLookupResult {
  found: boolean;
  entry?: DraftEntry;
}

/**
 * Default data directory
 */
const DEFAULT_DATA_DIR = 'data';
const DEFAULT_DRAFTS_FILE = 'drafts.ndjson';

/**
 * Draft Registry class
 */
export class DraftRegistry {
  private readonly dataDir: string;
  private readonly draftsFile: string;
  private readonly draftsPath: string;
  private readonly enabled: boolean;

  constructor(options?: {
    dataDir?: string;
    draftsFile?: string;
    enabled?: boolean;
  }) {
    this.dataDir = options?.dataDir || DEFAULT_DATA_DIR;
    this.draftsFile = options?.draftsFile || DEFAULT_DRAFTS_FILE;
    this.draftsPath = path.join(this.dataDir, this.draftsFile);
    this.enabled = options?.enabled !== false;

    // Ensure data directory exists
    if (this.enabled) {
      this.ensureDataDir();
    }
  }

  /**
   * Register a new draft (called when draft is created)
   */
  registerDraft(data: {
    draftId: string;
    trackingId: string;
    companyId: string;
    templateId: string;
    abVariant: 'A' | 'B' | null;
    subject: string;
    body: string;
    toEmail: string;
  }): DraftEntry {
    const entry: DraftEntry = {
      timestamp: new Date().toISOString(),
      draftId: data.draftId,
      trackingId: data.trackingId,
      companyId: data.companyId,
      templateId: data.templateId,
      abVariant: data.abVariant,
      subjectHash: this.hashContent(data.subject),
      bodyHash: this.hashContent(data.body),
      toDomain: this.extractDomain(data.toEmail),
    };

    this.writeEntry(entry);
    return entry;
  }

  /**
   * Look up a draft by draft ID
   */
  lookupByDraftId(draftId: string): DraftLookupResult {
    const entries = this.readAllEntries();
    const entry = entries.find(e => e.draftId === draftId);

    if (entry) {
      return { found: true, entry };
    }
    return { found: false };
  }

  /**
   * Look up a draft by tracking ID
   */
  lookupByTrackingId(trackingId: string): DraftLookupResult {
    const entries = this.readAllEntries();
    const entry = entries.find(e => e.trackingId === trackingId);

    if (entry) {
      return { found: true, entry };
    }
    return { found: false };
  }

  /**
   * Verify that a draft exists and matches expected tracking ID
   */
  verifyDraft(draftId: string, trackingId: string): {
    valid: boolean;
    entry?: DraftEntry;
    error?: string;
  } {
    const lookup = this.lookupByDraftId(draftId);

    if (!lookup.found) {
      return {
        valid: false,
        error: `Draft ${draftId} not found in registry`,
      };
    }

    if (lookup.entry!.trackingId !== trackingId) {
      return {
        valid: false,
        entry: lookup.entry,
        error: `Tracking ID mismatch: expected ${lookup.entry!.trackingId}, got ${trackingId}`,
      };
    }

    return {
      valid: true,
      entry: lookup.entry,
    };
  }

  /**
   * Check if draft exists in registry
   */
  hasDraft(draftId: string): boolean {
    return this.lookupByDraftId(draftId).found;
  }

  /**
   * Read all entries
   */
  readAllEntries(): DraftEntry[] {
    if (!this.enabled || !fs.existsSync(this.draftsPath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(this.draftsPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      return lines.map(line => JSON.parse(line) as DraftEntry);
    } catch {
      return [];
    }
  }

  /**
   * Get the drafts file path
   */
  getDraftsPath(): string {
    return this.draftsPath;
  }

  // ============================================================
  // Private Methods
  // ============================================================

  private ensureDataDir(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private writeEntry(entry: DraftEntry): void {
    if (!this.enabled) return;

    try {
      const line = JSON.stringify(entry) + '\n';
      fs.appendFileSync(this.draftsPath, line, 'utf-8');
    } catch (error) {
      console.error(
        `[DraftRegistry] Failed to write entry: ${error instanceof Error ? error.message : 'Unknown'}`
      );
    }
  }

  /**
   * Hash content using SHA-256 (for subject/body - no PII stored)
   */
  private hashContent(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Extract domain from email address (PII protection)
   */
  private extractDomain(email: string): string {
    const parts = email.split('@');
    return parts.length === 2 ? parts[1].toLowerCase() : 'unknown';
  }
}

/**
 * Singleton instance
 */
let defaultRegistry: DraftRegistry | null = null;

/**
 * Get or create the default draft registry
 */
export function getDraftRegistry(): DraftRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new DraftRegistry();
  }
  return defaultRegistry;
}

/**
 * Reset the singleton for testing
 */
export function resetDraftRegistry(): void {
  defaultRegistry = null;
}

/**
 * Create draft registry for testing
 */
export function createTestDraftRegistry(options?: {
  dataDir?: string;
  enabled?: boolean;
}): DraftRegistry {
  return new DraftRegistry({
    dataDir: options?.dataDir || 'data/test',
    enabled: options?.enabled ?? false,
  });
}

export default DraftRegistry;
