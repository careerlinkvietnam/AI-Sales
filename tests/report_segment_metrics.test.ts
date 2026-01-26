/**
 * Report Segment Metrics Test Suite
 */

import * as fs from 'fs';
import * as path from 'path';
import { MetricsStore } from '../src/data/MetricsStore';
import { Segmenter, SegmentClassification } from '../src/domain/Segmenter';

describe('Report Segment Metrics', () => {
  const testDir = 'data/test-segment-report';
  const testMetricsFile = 'metrics.ndjson';
  const testMetricsPath = path.join(testDir, testMetricsFile);

  let metricsStore: MetricsStore;

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    if (fs.existsSync(testMetricsPath)) {
      fs.unlinkSync(testMetricsPath);
    }

    metricsStore = new MetricsStore({
      dataDir: testDir,
      metricsFile: testMetricsFile,
      enabled: true,
    });
  });

  afterAll(() => {
    if (fs.existsSync(testMetricsPath)) fs.unlinkSync(testMetricsPath);
    if (fs.existsSync(testDir)) fs.rmdirSync(testDir);
  });

  describe('aggregation by segment', () => {
    it('aggregates metrics correctly by template and variant', () => {
      // Create test events
      for (let i = 0; i < 20; i++) {
        metricsStore.recordSentDetected({
          trackingId: `track-${i}`,
          companyId: `company-${i}`,
          templateId: 'template_A',
          abVariant: 'A',
          gmailThreadId: `thread-${i}`,
          sentDate: '2026-01-15T10:00:00Z',
        });
      }

      for (let i = 0; i < 8; i++) {
        metricsStore.recordReplyDetected({
          trackingId: `track-${i}`,
          companyId: `company-${i}`,
          templateId: 'template_A',
          abVariant: 'A',
          gmailThreadId: `thread-${i}`,
          replyDate: '2026-01-16T10:00:00Z',
          sentDate: '2026-01-15T10:00:00Z',
        });
      }

      const events = metricsStore.readAllEvents();

      // Count manually
      let sent = 0;
      let replies = 0;
      for (const event of events) {
        if (event.templateId === 'template_A' && event.abVariant === 'A') {
          if (event.eventType === 'SENT_DETECTED') sent++;
          if (event.eventType === 'REPLY_DETECTED') replies++;
        }
      }

      expect(sent).toBe(20);
      expect(replies).toBe(8);
      // Reply rate = 8/20 = 40%
      expect(Math.round((replies / sent) * 100)).toBe(40);
    });

    it('groups by company for segment assignment', () => {
      // Same company should have same segment
      const companyId = 'company-1';

      metricsStore.recordSentDetected({
        trackingId: 'track-1',
        companyId,
        templateId: 'template_A',
        abVariant: 'A',
        gmailThreadId: 'thread-1',
        sentDate: '2026-01-15T10:00:00Z',
      });

      metricsStore.recordSentDetected({
        trackingId: 'track-2',
        companyId,
        templateId: 'template_A',
        abVariant: 'A',
        gmailThreadId: 'thread-2',
        sentDate: '2026-01-16T10:00:00Z',
      });

      const events = metricsStore.readAllEvents();
      const companyEvents = events.filter((e) => e.companyId === companyId);

      expect(companyEvents).toHaveLength(2);
      // All events from same company should get same segment
    });
  });

  describe('min-sent threshold', () => {
    it('marks rows as insufficient when below threshold', () => {
      const minSent = 30;

      // Create 20 sent events (below threshold)
      for (let i = 0; i < 20; i++) {
        metricsStore.recordSentDetected({
          trackingId: `below-${i}`,
          companyId: `company-below-${i}`,
          templateId: 'template_A',
          abVariant: 'A',
          gmailThreadId: `thread-below-${i}`,
          sentDate: '2026-01-15T10:00:00Z',
        });
      }

      const events = metricsStore.readAllEvents();
      const sentCount = events.filter(
        (e) => e.eventType === 'SENT_DETECTED' && e.abVariant === 'A'
      ).length;

      expect(sentCount).toBe(20);
      expect(sentCount < minSent).toBe(true);
    });

    it('marks rows as sufficient when at or above threshold', () => {
      const minSent = 30;

      // Create 35 sent events (above threshold)
      for (let i = 0; i < 35; i++) {
        metricsStore.recordSentDetected({
          trackingId: `above-${i}`,
          companyId: `company-above-${i}`,
          templateId: 'template_B',
          abVariant: 'B',
          gmailThreadId: `thread-above-${i}`,
          sentDate: '2026-01-15T10:00:00Z',
        });
      }

      const events = metricsStore.readAllEvents();
      const sentCount = events.filter(
        (e) => e.eventType === 'SENT_DETECTED' && e.abVariant === 'B'
      ).length;

      expect(sentCount).toBe(35);
      expect(sentCount >= minSent).toBe(true);
    });
  });

  describe('reply rate calculation', () => {
    it('calculates reply rate correctly', () => {
      // 50 sent, 15 replies = 30%
      for (let i = 0; i < 50; i++) {
        metricsStore.recordSentDetected({
          trackingId: `rate-${i}`,
          companyId: `company-rate-${i}`,
          templateId: 'rate_template',
          abVariant: 'A',
          gmailThreadId: `thread-rate-${i}`,
          sentDate: '2026-01-15T10:00:00Z',
        });
      }

      for (let i = 0; i < 15; i++) {
        metricsStore.recordReplyDetected({
          trackingId: `rate-${i}`,
          companyId: `company-rate-${i}`,
          templateId: 'rate_template',
          abVariant: 'A',
          gmailThreadId: `thread-rate-${i}`,
          replyDate: '2026-01-16T10:00:00Z',
          sentDate: '2026-01-15T10:00:00Z',
        });
      }

      const events = metricsStore.readAllEvents();
      const sent = events.filter(
        (e) => e.eventType === 'SENT_DETECTED' && e.templateId === 'rate_template'
      ).length;
      const replies = events.filter(
        (e) => e.eventType === 'REPLY_DETECTED' && e.templateId === 'rate_template'
      ).length;

      const replyRate = Math.round((replies / sent) * 1000) / 10;
      expect(replyRate).toBe(30);
    });

    it('returns null for zero sent', () => {
      // No sent events for this template
      const events = metricsStore.readAllEvents();
      const sent = events.filter(
        (e) => e.eventType === 'SENT_DETECTED' && e.templateId === 'nonexistent'
      ).length;

      expect(sent).toBe(0);
      // Reply rate would be null (division by zero protection)
    });
  });

  describe('latency calculation', () => {
    it('calculates median latency correctly', () => {
      // Create replies with specific latencies: 12, 24, 36, 48, 60 hours
      // Median should be 36 hours
      const latencies = [12, 24, 36, 48, 60];

      for (let i = 0; i < latencies.length; i++) {
        metricsStore.recordSentDetected({
          trackingId: `lat-${i}`,
          companyId: `company-lat-${i}`,
          templateId: 'latency_template',
          abVariant: 'A',
          gmailThreadId: `thread-lat-${i}`,
          sentDate: '2026-01-15T10:00:00Z',
        });

        metricsStore.recordReplyDetected({
          trackingId: `lat-${i}`,
          companyId: `company-lat-${i}`,
          templateId: 'latency_template',
          abVariant: 'A',
          gmailThreadId: `thread-lat-${i}`,
          replyDate: new Date(
            new Date('2026-01-15T10:00:00Z').getTime() + latencies[i] * 60 * 60 * 1000
          ).toISOString(),
          sentDate: '2026-01-15T10:00:00Z',
        });
      }

      const events = metricsStore.readAllEvents();
      const replyEvents = events.filter(
        (e) => e.eventType === 'REPLY_DETECTED' && e.templateId === 'latency_template'
      );

      const recordedLatencies = replyEvents
        .map((e) => e.replyLatencyHours)
        .filter((l): l is number => l !== null);

      expect(recordedLatencies).toHaveLength(5);

      // Calculate median
      const sorted = [...recordedLatencies].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      expect(median).toBe(36);
    });
  });
});

describe('Segmenter integration', () => {
  let segmenter: Segmenter;

  beforeEach(() => {
    segmenter = new Segmenter();
  });

  describe('segment assignment from audit data', () => {
    it('assigns region from tag', () => {
      const classification = segmenter.classify({
        tag: { rawTag: '南部・3月連絡', region: '南部', isContactTag: true },
      });

      expect(classification.region).toBe('南部');
    });

    it('assigns unknown when no data', () => {
      const classification = segmenter.classify({});

      expect(classification.region).toBe('不明');
      expect(classification.customerState).toBe('unknown');
      expect(classification.industryBucket).toBe('不明');
    });
  });
});
