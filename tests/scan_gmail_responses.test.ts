/**
 * ScanGmailResponses Job Test Suite
 */

import * as fs from 'fs';
import * as path from 'path';
import { ScanGmailResponses, IGmailClient } from '../src/jobs/ScanGmailResponses';
import { MetricsStore } from '../src/data/MetricsStore';
import { GmailSearchResult } from '../src/connectors/gmail/GmailClient';

describe('ScanGmailResponses', () => {
  const testDir = 'data/test-scan';
  const testAuditDir = 'logs/test-scan';
  const testAuditFile = 'audit-scan.ndjson';
  const testMetricsFile = 'metrics-scan.ndjson';

  let metricsStore: MetricsStore;
  let mockGmailClient: IGmailClient;

  beforeEach(() => {
    // Ensure test directories exist
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    if (!fs.existsSync(testAuditDir)) {
      fs.mkdirSync(testAuditDir, { recursive: true });
    }

    // Clean up test files
    const metricsPath = path.join(testDir, testMetricsFile);
    const auditPath = path.join(testAuditDir, testAuditFile);
    if (fs.existsSync(metricsPath)) {
      fs.unlinkSync(metricsPath);
    }
    if (fs.existsSync(auditPath)) {
      fs.unlinkSync(auditPath);
    }

    // Create metrics store
    metricsStore = new MetricsStore({
      dataDir: testDir,
      metricsFile: testMetricsFile,
      enabled: true,
    });

    // Create mock Gmail client
    mockGmailClient = {
      searchSentByTrackingId: jest.fn().mockResolvedValue(null),
      searchInboxRepliesByTrackingId: jest.fn().mockResolvedValue(null),
      isStubMode: jest.fn().mockReturnValue(true),
    };
  });

  afterAll(() => {
    // Clean up test directories
    const metricsPath = path.join(testDir, testMetricsFile);
    const auditPath = path.join(testAuditDir, testAuditFile);
    if (fs.existsSync(metricsPath)) fs.unlinkSync(metricsPath);
    if (fs.existsSync(auditPath)) fs.unlinkSync(auditPath);
    if (fs.existsSync(testDir)) fs.rmdirSync(testDir);
    if (fs.existsSync(testAuditDir)) fs.rmdirSync(testAuditDir);
  });

  /**
   * Helper to write test audit records
   */
  function writeAuditRecords(records: object[]): void {
    const auditPath = path.join(testAuditDir, testAuditFile);
    const content = records.map(r => JSON.stringify(r)).join('\n') + '\n';
    fs.writeFileSync(auditPath, content, 'utf-8');
  }

  describe('loadAuditRecords', () => {
    it('loads draft_created records with tracking ID', () => {
      writeAuditRecords([
        {
          timestamp: '2026-01-15T10:00:00Z',
          eventType: 'draft_created',
          companyId: 'c1',
          trackingId: 'track123',
          templateId: 'template-A',
          abVariant: 'A',
        },
        {
          timestamp: '2026-01-15T11:00:00Z',
          eventType: 'pipeline_run',
          companyId: 'c2',
          trackingId: 'track456',
        },
      ]);

      const scanner = new ScanGmailResponses({
        gmailClient: mockGmailClient,
        metricsStore,
        auditLogPath: path.join(testAuditDir, testAuditFile),
      });

      const records = scanner.loadAuditRecords();

      // Should only load draft_created events
      expect(records).toHaveLength(1);
      expect(records[0].trackingId).toBe('track123');
    });

    it('filters by since date', () => {
      writeAuditRecords([
        {
          timestamp: '2026-01-10T10:00:00Z',
          eventType: 'draft_created',
          companyId: 'c1',
          trackingId: 'old-track',
          templateId: 't1',
          abVariant: 'A',
        },
        {
          timestamp: '2026-01-20T10:00:00Z',
          eventType: 'draft_created',
          companyId: 'c2',
          trackingId: 'new-track',
          templateId: 't2',
          abVariant: 'B',
        },
      ]);

      const scanner = new ScanGmailResponses({
        gmailClient: mockGmailClient,
        metricsStore,
        auditLogPath: path.join(testAuditDir, testAuditFile),
      });

      const records = scanner.loadAuditRecords('2026-01-15');

      expect(records).toHaveLength(1);
      expect(records[0].trackingId).toBe('new-track');
    });
  });

  describe('run', () => {
    it('detects sent messages and records SENT_DETECTED', async () => {
      writeAuditRecords([
        {
          timestamp: '2026-01-15T10:00:00Z',
          eventType: 'draft_created',
          companyId: 'company-1',
          trackingId: 'sent-track',
          templateId: 'template-A',
          abVariant: 'A',
        },
      ]);

      // Mock Gmail client returns sent result
      const sentResult: GmailSearchResult = {
        threadId: 'gmail-thread-1',
        messageId: 'gmail-msg-1',
        internalDate: new Date('2026-01-16T10:00:00Z').getTime(),
        dateIso: '2026-01-16T10:00:00Z',
      };
      (mockGmailClient.searchSentByTrackingId as jest.Mock).mockResolvedValue(sentResult);

      const scanner = new ScanGmailResponses({
        gmailClient: mockGmailClient,
        metricsStore,
        auditLogPath: path.join(testAuditDir, testAuditFile),
      });

      const result = await scanner.run();

      expect(result.processed).toBe(1);
      expect(result.sentDetected).toBe(1);

      // Check metrics store
      expect(metricsStore.hasEvent('sent-track', 'SENT_DETECTED')).toBe(true);
    });

    it('detects replies and records REPLY_DETECTED with latency', async () => {
      writeAuditRecords([
        {
          timestamp: '2026-01-15T10:00:00Z',
          eventType: 'draft_created',
          companyId: 'company-1',
          trackingId: 'reply-track',
          templateId: 'template-B',
          abVariant: 'B',
        },
      ]);

      // Mock: sent found
      const sentResult: GmailSearchResult = {
        threadId: 'thread-1',
        messageId: 'msg-1',
        internalDate: new Date('2026-01-16T10:00:00Z').getTime(),
        dateIso: '2026-01-16T10:00:00Z',
      };
      (mockGmailClient.searchSentByTrackingId as jest.Mock).mockResolvedValue(sentResult);

      // Mock: reply found (24 hours after sent)
      const replyResult: GmailSearchResult = {
        threadId: 'thread-1',
        messageId: 'msg-2',
        internalDate: new Date('2026-01-17T10:00:00Z').getTime(),
        dateIso: '2026-01-17T10:00:00Z',
      };
      (mockGmailClient.searchInboxRepliesByTrackingId as jest.Mock).mockResolvedValue(replyResult);

      const scanner = new ScanGmailResponses({
        gmailClient: mockGmailClient,
        metricsStore,
        auditLogPath: path.join(testAuditDir, testAuditFile),
      });

      const result = await scanner.run();

      expect(result.sentDetected).toBe(1);
      expect(result.replyDetected).toBe(1);

      // Check reply latency
      const events = metricsStore.readAllEvents();
      const replyEvent = events.find(e => e.eventType === 'REPLY_DETECTED');
      expect(replyEvent?.replyLatencyHours).toBe(24);
    });

    it('skips duplicate SENT_DETECTED events', async () => {
      writeAuditRecords([
        {
          timestamp: '2026-01-15T10:00:00Z',
          eventType: 'draft_created',
          companyId: 'company-1',
          trackingId: 'dup-track',
          templateId: 'template-A',
          abVariant: 'A',
        },
      ]);

      // Pre-record SENT_DETECTED
      metricsStore.recordSentDetected({
        trackingId: 'dup-track',
        companyId: 'company-1',
        templateId: 'template-A',
        abVariant: 'A',
        gmailThreadId: 'existing-thread',
        sentDate: '2026-01-16T10:00:00Z',
      });

      // Mock would return sent, but should be skipped
      (mockGmailClient.searchSentByTrackingId as jest.Mock).mockResolvedValue({
        threadId: 'new-thread',
        messageId: 'new-msg',
        internalDate: Date.now(),
        dateIso: new Date().toISOString(),
      });

      const scanner = new ScanGmailResponses({
        gmailClient: mockGmailClient,
        metricsStore,
        auditLogPath: path.join(testAuditDir, testAuditFile),
      });

      const result = await scanner.run();

      // Should not detect new sent (already exists)
      expect(result.sentDetected).toBe(0);

      // Should only have the original event
      const sentEvents = metricsStore.readAllEvents().filter(
        e => e.trackingId === 'dup-track' && e.eventType === 'SENT_DETECTED'
      );
      expect(sentEvents).toHaveLength(1);
      expect(sentEvents[0].gmailThreadId).toBe('existing-thread');
    });

    it('skips duplicate REPLY_DETECTED events', async () => {
      writeAuditRecords([
        {
          timestamp: '2026-01-15T10:00:00Z',
          eventType: 'draft_created',
          companyId: 'company-1',
          trackingId: 'reply-dup',
          templateId: 'template-A',
          abVariant: 'A',
        },
      ]);

      // Pre-record both SENT and REPLY
      metricsStore.recordSentDetected({
        trackingId: 'reply-dup',
        companyId: 'company-1',
        templateId: 'template-A',
        abVariant: 'A',
        gmailThreadId: 'thread-1',
        sentDate: '2026-01-16T10:00:00Z',
      });
      metricsStore.recordReplyDetected({
        trackingId: 'reply-dup',
        companyId: 'company-1',
        templateId: 'template-A',
        abVariant: 'A',
        gmailThreadId: 'thread-1',
        replyDate: '2026-01-17T10:00:00Z',
        sentDate: '2026-01-16T10:00:00Z',
      });

      const scanner = new ScanGmailResponses({
        gmailClient: mockGmailClient,
        metricsStore,
        auditLogPath: path.join(testAuditDir, testAuditFile),
      });

      const result = await scanner.run();

      expect(result.sentDetected).toBe(0);
      expect(result.replyDetected).toBe(0);
    });
  });
});
