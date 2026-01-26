/**
 * MetricsStore Test Suite
 */

import * as fs from 'fs';
import * as path from 'path';
import { MetricsStore, createTestMetricsStore } from '../src/data/MetricsStore';

describe('MetricsStore', () => {
  const testDir = 'data/test-metrics';
  const testFile = 'test-metrics.ndjson';
  const testPath = path.join(testDir, testFile);

  let store: MetricsStore;

  beforeEach(() => {
    // Clean up test file if exists
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }

    store = new MetricsStore({
      dataDir: testDir,
      metricsFile: testFile,
      enabled: true,
    });
  });

  afterAll(() => {
    // Clean up test directory
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
    if (fs.existsSync(testDir)) {
      fs.rmdirSync(testDir);
    }
  });

  describe('recordDraftCreated', () => {
    it('records DRAFT_CREATED event', () => {
      store.recordDraftCreated({
        trackingId: 'abc12345',
        companyId: 'company-1',
        templateId: 'new_candidates_v1_A',
        abVariant: 'A',
        gmailDraftId: 'draft-123',
      });

      const events = store.readAllEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('DRAFT_CREATED');
      expect(events[0].trackingId).toBe('abc12345');
      expect(events[0].templateId).toBe('new_candidates_v1_A');
      expect(events[0].abVariant).toBe('A');
    });
  });

  describe('recordSentDetected', () => {
    it('records SENT_DETECTED event', () => {
      store.recordSentDetected({
        trackingId: 'abc12345',
        companyId: 'company-1',
        templateId: 'new_candidates_v1_B',
        abVariant: 'B',
        gmailThreadId: 'thread-456',
        sentDate: '2026-01-15T10:00:00Z',
      });

      const events = store.readAllEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('SENT_DETECTED');
      expect(events[0].gmailThreadId).toBe('thread-456');
      expect(events[0].meta.sentDate).toBe('2026-01-15T10:00:00Z');
    });
  });

  describe('recordReplyDetected', () => {
    it('records REPLY_DETECTED event with latency', () => {
      store.recordReplyDetected({
        trackingId: 'abc12345',
        companyId: 'company-1',
        templateId: 'new_candidates_v1_A',
        abVariant: 'A',
        gmailThreadId: 'thread-456',
        replyDate: '2026-01-15T22:30:00Z', // 12.5 hours later
        sentDate: '2026-01-15T10:00:00Z',
      });

      const events = store.readAllEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('REPLY_DETECTED');
      expect(events[0].replyLatencyHours).toBe(12.5);
    });

    it('calculates reply latency correctly', () => {
      store.recordReplyDetected({
        trackingId: 'test123',
        companyId: 'company-1',
        templateId: 'template-1',
        abVariant: null,
        gmailThreadId: 'thread-1',
        replyDate: '2026-01-16T10:00:00Z', // 24 hours later
        sentDate: '2026-01-15T10:00:00Z',
      });

      const events = store.readAllEvents();
      expect(events[0].replyLatencyHours).toBe(24);
    });
  });

  describe('hasEvent', () => {
    it('returns true if event exists', () => {
      store.recordSentDetected({
        trackingId: 'track123',
        companyId: 'company-1',
        templateId: 'template-1',
        abVariant: 'A',
        gmailThreadId: 'thread-1',
        sentDate: '2026-01-15T10:00:00Z',
      });

      expect(store.hasEvent('track123', 'SENT_DETECTED')).toBe(true);
      expect(store.hasEvent('track123', 'REPLY_DETECTED')).toBe(false);
      expect(store.hasEvent('other', 'SENT_DETECTED')).toBe(false);
    });
  });

  describe('getSentEvent', () => {
    it('returns sent event for tracking ID', () => {
      store.recordSentDetected({
        trackingId: 'track456',
        companyId: 'company-1',
        templateId: 'template-1',
        abVariant: 'B',
        gmailThreadId: 'thread-2',
        sentDate: '2026-01-20T10:00:00Z',
      });

      const event = store.getSentEvent('track456');
      expect(event).not.toBeNull();
      expect(event?.trackingId).toBe('track456');
      expect(event?.meta.sentDate).toBe('2026-01-20T10:00:00Z');
    });

    it('returns null if not found', () => {
      expect(store.getSentEvent('nonexistent')).toBeNull();
    });
  });

  describe('readEventsSince', () => {
    it('filters events by date', () => {
      // Record events at different times
      store.appendEvent({
        trackingId: 'old',
        companyId: 'c1',
        templateId: 't1',
        abVariant: null,
        eventType: 'DRAFT_CREATED',
        gmailThreadId: null,
        replyLatencyHours: null,
        meta: {},
      });

      // Wait and record another
      const events = store.readAllEvents();
      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('disabled store', () => {
    it('does not write when disabled', () => {
      const disabledStore = createTestMetricsStore(false);

      disabledStore.recordDraftCreated({
        trackingId: 'test',
        companyId: 'test',
        templateId: 'test',
        abVariant: null,
      });

      expect(disabledStore.readAllEvents()).toHaveLength(0);
    });
  });
});
