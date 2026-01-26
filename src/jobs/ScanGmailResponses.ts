/**
 * Scan Gmail Responses Job
 *
 * Reconciles audit.ndjson records with Gmail to detect:
 * - SENT_DETECTED: Draft was sent (found in Sent folder)
 * - REPLY_DETECTED: Reply received (found in Inbox)
 *
 * 制約:
 * - 本文は取得しない（メタデータのみ）
 * - PIIをログに出さない
 * - 重複イベントは記録しない
 */

import * as fs from 'fs';
import * as path from 'path';
import { GmailClient, GmailSearchResult } from '../connectors/gmail/GmailClient';
import { MetricsStore, getMetricsStore } from '../data/MetricsStore';
import { AuditLogEntry } from '../domain/AuditLogger';

/**
 * Audit record with tracking info
 */
export interface AuditRecordForScan {
  timestamp: string;
  companyId: string;
  trackingId: string;
  templateId: string;
  abVariant: 'A' | 'B' | null;
  gmailDraftId?: string;
}

/**
 * Scan result summary
 */
export interface ScanResult {
  /** Total audit records processed */
  processed: number;
  /** Records skipped (no tracking ID) */
  skipped: number;
  /** New SENT_DETECTED events recorded */
  sentDetected: number;
  /** New REPLY_DETECTED events recorded */
  replyDetected: number;
  /** Errors encountered */
  errors: string[];
}

/**
 * Gmail client interface for dependency injection
 */
export interface IGmailClient {
  searchSentByTrackingId(trackingId: string): Promise<GmailSearchResult | null>;
  searchInboxRepliesByTrackingId(trackingId: string): Promise<GmailSearchResult | null>;
  isStubMode(): boolean;
}

/**
 * Scan Gmail Responses Job
 */
export class ScanGmailResponses {
  private readonly gmailClient: IGmailClient;
  private readonly metricsStore: MetricsStore;
  private readonly auditLogPath: string;

  constructor(options?: {
    gmailClient?: IGmailClient;
    metricsStore?: MetricsStore;
    auditLogPath?: string;
  }) {
    this.gmailClient = options?.gmailClient || new GmailClient();
    this.metricsStore = options?.metricsStore || getMetricsStore();
    this.auditLogPath = options?.auditLogPath || 'logs/audit.ndjson';
  }

  /**
   * Load audit records from audit.ndjson
   */
  loadAuditRecords(since?: string): AuditRecordForScan[] {
    if (!fs.existsSync(this.auditLogPath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(this.auditLogPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      const entries = lines.map(line => JSON.parse(line) as AuditLogEntry);

      // Filter to draft_created events with tracking ID
      let filtered = entries.filter(
        e => e.eventType === 'draft_created' && e.trackingId
      );

      // Filter by date if specified
      if (since) {
        const sinceDate = new Date(since);
        filtered = filtered.filter(e => new Date(e.timestamp) >= sinceDate);
      }

      // Map to scan format
      return filtered.map(e => ({
        timestamp: e.timestamp,
        companyId: e.companyId,
        trackingId: e.trackingId!,
        templateId: e.templateId || 'unknown',
        abVariant: e.abVariant || null,
        gmailDraftId: e.gmailDraftId,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Run the scan job
   */
  async run(since?: string): Promise<ScanResult> {
    const result: ScanResult = {
      processed: 0,
      skipped: 0,
      sentDetected: 0,
      replyDetected: 0,
      errors: [],
    };

    // Load audit records
    const records = this.loadAuditRecords(since);
    result.processed = records.length;

    for (const record of records) {
      try {
        await this.processRecord(record, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(`[${record.trackingId}] ${message}`);
      }
    }

    return result;
  }

  /**
   * Process a single audit record
   */
  private async processRecord(
    record: AuditRecordForScan,
    result: ScanResult
  ): Promise<void> {
    const { trackingId, companyId, templateId, abVariant } = record;

    // Check if SENT_DETECTED already recorded
    const hasSentEvent = this.metricsStore.hasEvent(trackingId, 'SENT_DETECTED');

    if (!hasSentEvent) {
      // Search for sent message
      const sentResult = await this.gmailClient.searchSentByTrackingId(trackingId);

      if (sentResult) {
        // Record SENT_DETECTED
        this.metricsStore.recordSentDetected({
          trackingId,
          companyId,
          templateId,
          abVariant,
          gmailThreadId: sentResult.threadId,
          sentDate: sentResult.dateIso,
        });
        result.sentDetected++;
      }
    }

    // Check if REPLY_DETECTED already recorded
    const hasReplyEvent = this.metricsStore.hasEvent(trackingId, 'REPLY_DETECTED');

    if (!hasReplyEvent) {
      // Search for reply message
      const replyResult = await this.gmailClient.searchInboxRepliesByTrackingId(trackingId);

      if (replyResult) {
        // Get the sent date for latency calculation
        const sentEvent = this.metricsStore.getSentEvent(trackingId);
        const sentDate = sentEvent
          ? (sentEvent.meta.sentDate as string)
          : record.timestamp; // Fallback to draft timestamp

        // Record REPLY_DETECTED
        this.metricsStore.recordReplyDetected({
          trackingId,
          companyId,
          templateId,
          abVariant,
          gmailThreadId: replyResult.threadId,
          replyDate: replyResult.dateIso,
          sentDate,
        });
        result.replyDetected++;
      }
    }
  }
}

export default ScanGmailResponses;
