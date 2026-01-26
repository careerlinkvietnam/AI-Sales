/**
 * A/B Metrics Report Test Suite
 *
 * Tests for the metrics aggregation logic.
 */

import * as fs from 'fs';
import * as path from 'path';
import { MetricsStore, MetricsEvent } from '../src/data/MetricsStore';

/**
 * Simplified report generation for testing
 * (mirrors the logic in report_ab_metrics.ts)
 */
interface TemplateMetrics {
  templateId: string;
  abVariant: 'A' | 'B' | null;
  drafts: number;
  sentDetected: number;
  replies: number;
  replyRate: number | null;
  medianReplyLatencyHours: number | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function generateMetrics(events: MetricsEvent[]): TemplateMetrics[] {
  const groupMap = new Map<string, TemplateMetrics & { latencies: number[] }>();

  for (const event of events) {
    const key = `${event.templateId}:${event.abVariant || 'none'}`;

    if (!groupMap.has(key)) {
      groupMap.set(key, {
        templateId: event.templateId,
        abVariant: event.abVariant,
        drafts: 0,
        sentDetected: 0,
        replies: 0,
        replyRate: null,
        medianReplyLatencyHours: null,
        latencies: [],
      });
    }

    const metrics = groupMap.get(key)!;

    switch (event.eventType) {
      case 'DRAFT_CREATED':
        metrics.drafts++;
        break;
      case 'SENT_DETECTED':
        metrics.sentDetected++;
        break;
      case 'REPLY_DETECTED':
        metrics.replies++;
        if (event.replyLatencyHours !== null) {
          metrics.latencies.push(event.replyLatencyHours);
        }
        break;
    }
  }

  return Array.from(groupMap.values()).map(m => {
    const { latencies, ...rest } = m;
    return {
      ...rest,
      replyRate: m.sentDetected > 0
        ? Math.round((m.replies / m.sentDetected) * 1000) / 10
        : null,
      medianReplyLatencyHours: median(latencies),
    };
  });
}

describe('A/B Metrics Report', () => {
  const testDir = 'data/test-report';
  const testFile = 'report-metrics.ndjson';
  const testPath = path.join(testDir, testFile);

  let store: MetricsStore;

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
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
    if (fs.existsSync(testPath)) fs.unlinkSync(testPath);
    if (fs.existsSync(testDir)) fs.rmdirSync(testDir);
  });

  describe('aggregation', () => {
    it('counts events by type', () => {
      store.recordDraftCreated({
        trackingId: 't1',
        companyId: 'c1',
        templateId: 'template_A',
        abVariant: 'A',
      });
      store.recordDraftCreated({
        trackingId: 't2',
        companyId: 'c2',
        templateId: 'template_A',
        abVariant: 'A',
      });
      store.recordSentDetected({
        trackingId: 't1',
        companyId: 'c1',
        templateId: 'template_A',
        abVariant: 'A',
        gmailThreadId: 'thread-1',
        sentDate: '2026-01-15T10:00:00Z',
      });

      const events = store.readAllEvents();
      const metrics = generateMetrics(events);

      expect(metrics).toHaveLength(1);
      expect(metrics[0].drafts).toBe(2);
      expect(metrics[0].sentDetected).toBe(1);
      expect(metrics[0].replies).toBe(0);
    });

    it('groups by template and variant', () => {
      store.recordDraftCreated({
        trackingId: 't1',
        companyId: 'c1',
        templateId: 'template_v1',
        abVariant: 'A',
      });
      store.recordDraftCreated({
        trackingId: 't2',
        companyId: 'c2',
        templateId: 'template_v1',
        abVariant: 'B',
      });
      store.recordDraftCreated({
        trackingId: 't3',
        companyId: 'c3',
        templateId: 'template_v2',
        abVariant: 'A',
      });

      const events = store.readAllEvents();
      const metrics = generateMetrics(events);

      expect(metrics).toHaveLength(3);
    });

    it('calculates reply rate correctly', () => {
      // 10 sent, 3 replies = 30%
      for (let i = 0; i < 10; i++) {
        store.recordSentDetected({
          trackingId: `s${i}`,
          companyId: `c${i}`,
          templateId: 'test_template',
          abVariant: 'A',
          gmailThreadId: `thread-${i}`,
          sentDate: '2026-01-15T10:00:00Z',
        });
      }
      for (let i = 0; i < 3; i++) {
        store.recordReplyDetected({
          trackingId: `s${i}`,
          companyId: `c${i}`,
          templateId: 'test_template',
          abVariant: 'A',
          gmailThreadId: `thread-${i}`,
          replyDate: '2026-01-16T10:00:00Z',
          sentDate: '2026-01-15T10:00:00Z',
        });
      }

      const events = store.readAllEvents();
      const metrics = generateMetrics(events);

      expect(metrics[0].sentDetected).toBe(10);
      expect(metrics[0].replies).toBe(3);
      expect(metrics[0].replyRate).toBe(30);
    });

    it('handles zero sent (no divide by zero)', () => {
      store.recordDraftCreated({
        trackingId: 't1',
        companyId: 'c1',
        templateId: 'no_sent_template',
        abVariant: 'A',
      });

      const events = store.readAllEvents();
      const metrics = generateMetrics(events);

      expect(metrics[0].sentDetected).toBe(0);
      expect(metrics[0].replyRate).toBeNull();
    });

    it('calculates median reply latency', () => {
      // Latencies: 1, 2, 3, 4, 5 -> median = 3
      const latencies = [1, 2, 3, 4, 5];
      for (let i = 0; i < latencies.length; i++) {
        store.recordReplyDetected({
          trackingId: `lat${i}`,
          companyId: `c${i}`,
          templateId: 'latency_template',
          abVariant: 'B',
          gmailThreadId: `thread-${i}`,
          replyDate: new Date(Date.now() + latencies[i] * 60 * 60 * 1000).toISOString(),
          sentDate: new Date().toISOString(),
        });
      }

      const events = store.readAllEvents();
      const metrics = generateMetrics(events);

      expect(metrics[0].medianReplyLatencyHours).toBe(3);
    });

    it('calculates median for even number of values', () => {
      // Latencies: 2, 4, 6, 8 -> median = 5
      const latencies = [2, 4, 6, 8];
      for (let i = 0; i < latencies.length; i++) {
        store.recordReplyDetected({
          trackingId: `even${i}`,
          companyId: `c${i}`,
          templateId: 'even_template',
          abVariant: 'A',
          gmailThreadId: `thread-${i}`,
          replyDate: new Date(Date.now() + latencies[i] * 60 * 60 * 1000).toISOString(),
          sentDate: new Date().toISOString(),
        });
      }

      const events = store.readAllEvents();
      const metrics = generateMetrics(events);

      expect(metrics[0].medianReplyLatencyHours).toBe(5);
    });

    it('returns null median for no replies', () => {
      store.recordSentDetected({
        trackingId: 'no-reply',
        companyId: 'c1',
        templateId: 'no_reply_template',
        abVariant: 'A',
        gmailThreadId: 'thread-1',
        sentDate: '2026-01-15T10:00:00Z',
      });

      const events = store.readAllEvents();
      const metrics = generateMetrics(events);

      expect(metrics[0].medianReplyLatencyHours).toBeNull();
    });
  });

  describe('A/B comparison', () => {
    it('shows different rates for A and B', () => {
      // Variant A: 10 sent, 5 replies = 50%
      for (let i = 0; i < 10; i++) {
        store.recordSentDetected({
          trackingId: `a${i}`,
          companyId: `c${i}`,
          templateId: 'compare_template',
          abVariant: 'A',
          gmailThreadId: `thread-a${i}`,
          sentDate: '2026-01-15T10:00:00Z',
        });
      }
      for (let i = 0; i < 5; i++) {
        store.recordReplyDetected({
          trackingId: `a${i}`,
          companyId: `c${i}`,
          templateId: 'compare_template',
          abVariant: 'A',
          gmailThreadId: `thread-a${i}`,
          replyDate: '2026-01-16T10:00:00Z',
          sentDate: '2026-01-15T10:00:00Z',
        });
      }

      // Variant B: 10 sent, 2 replies = 20%
      for (let i = 0; i < 10; i++) {
        store.recordSentDetected({
          trackingId: `b${i}`,
          companyId: `cb${i}`,
          templateId: 'compare_template',
          abVariant: 'B',
          gmailThreadId: `thread-b${i}`,
          sentDate: '2026-01-15T10:00:00Z',
        });
      }
      for (let i = 0; i < 2; i++) {
        store.recordReplyDetected({
          trackingId: `b${i}`,
          companyId: `cb${i}`,
          templateId: 'compare_template',
          abVariant: 'B',
          gmailThreadId: `thread-b${i}`,
          replyDate: '2026-01-16T10:00:00Z',
          sentDate: '2026-01-15T10:00:00Z',
        });
      }

      const events = store.readAllEvents();
      const metrics = generateMetrics(events);

      const variantA = metrics.find(m => m.abVariant === 'A');
      const variantB = metrics.find(m => m.abVariant === 'B');

      expect(variantA?.replyRate).toBe(50);
      expect(variantB?.replyRate).toBe(20);
    });
  });
});
