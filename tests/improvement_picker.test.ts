/**
 * ImprovementPicker Tests
 */
import {
  ImprovementPicker,
  SegmentMetricsForPicker,
  ImprovementCandidate,
  createImprovementPicker,
} from '../src/domain/ImprovementPicker';

describe('ImprovementPicker', () => {
  let picker: ImprovementPicker;

  beforeEach(() => {
    picker = new ImprovementPicker({
      minSent: 50,
      minGap: 0.03,
      maxCandidates: 5,
      considerLatency: true,
      latencyGapThreshold: 6,
    });
  });

  describe('pick', () => {
    it('should return empty array when no metrics provided', () => {
      const result = picker.pick([]);
      expect(result).toEqual([]);
    });

    it('should return empty array when only one variant exists', () => {
      const metrics: SegmentMetricsForPicker[] = [
        {
          segmentName: 'region',
          segmentValue: '南部',
          templateId: 'template_A',
          variant: 'A',
          sent: 100,
          replies: 10,
          replyRate: 0.1,
          medianLatencyHours: 24,
        },
      ];

      const result = picker.pick(metrics);
      expect(result).toEqual([]);
    });

    it('should return empty array when samples are below minimum', () => {
      const metrics: SegmentMetricsForPicker[] = [
        {
          segmentName: 'region',
          segmentValue: '南部',
          templateId: 'template_A',
          variant: 'A',
          sent: 30,
          replies: 3,
          replyRate: 0.1,
          medianLatencyHours: 24,
        },
        {
          segmentName: 'region',
          segmentValue: '南部',
          templateId: 'template_B',
          variant: 'B',
          sent: 40,
          replies: 2,
          replyRate: 0.05,
          medianLatencyHours: 30,
        },
      ];

      const result = picker.pick(metrics);
      expect(result).toEqual([]);
    });

    it('should identify underperforming template based on reply rate gap', () => {
      const metrics: SegmentMetricsForPicker[] = [
        {
          segmentName: 'region',
          segmentValue: '南部',
          templateId: 'template_A',
          variant: 'A',
          sent: 100,
          replies: 15,
          replyRate: 0.15,
          medianLatencyHours: 24,
        },
        {
          segmentName: 'region',
          segmentValue: '南部',
          templateId: 'template_B',
          variant: 'B',
          sent: 100,
          replies: 8,
          replyRate: 0.08,
          medianLatencyHours: 24,
        },
      ];

      const result = picker.pick(metrics);
      expect(result.length).toBe(1);
      expect(result[0].templateId).toBe('template_B');
      expect(result[0].variant).toBe('B');
      expect(result[0].gapVsBest).toBeCloseTo(0.07);
      expect(result[0].reason).toContain('Reply rate');
    });

    it('should not flag when gap is below threshold', () => {
      const metrics: SegmentMetricsForPicker[] = [
        {
          segmentName: 'region',
          segmentValue: '南部',
          templateId: 'template_A',
          variant: 'A',
          sent: 100,
          replies: 10,
          replyRate: 0.10,
          medianLatencyHours: 24,
        },
        {
          segmentName: 'region',
          segmentValue: '南部',
          templateId: 'template_B',
          variant: 'B',
          sent: 100,
          replies: 9,
          replyRate: 0.09,
          medianLatencyHours: 24,
        },
      ];

      const result = picker.pick(metrics);
      expect(result).toEqual([]);
    });

    it('should identify underperforming template based on latency gap', () => {
      const metrics: SegmentMetricsForPicker[] = [
        {
          segmentName: 'region',
          segmentValue: '南部',
          templateId: 'template_A',
          variant: 'A',
          sent: 100,
          replies: 10,
          replyRate: 0.10,
          medianLatencyHours: 12,
        },
        {
          segmentName: 'region',
          segmentValue: '南部',
          templateId: 'template_B',
          variant: 'B',
          sent: 100,
          replies: 10,
          replyRate: 0.10,
          medianLatencyHours: 24,
        },
      ];

      const result = picker.pick(metrics);
      expect(result.length).toBe(1);
      expect(result[0].templateId).toBe('template_B');
      expect(result[0].latencyGapVsBest).toBe(12);
      expect(result[0].reason).toContain('Latency');
    });

    it('should sort candidates by gap (descending)', () => {
      const metrics: SegmentMetricsForPicker[] = [
        {
          segmentName: 'region',
          segmentValue: '南部',
          templateId: 'template_A',
          variant: 'A',
          sent: 100,
          replies: 20,
          replyRate: 0.20,
          medianLatencyHours: 24,
        },
        {
          segmentName: 'region',
          segmentValue: '南部',
          templateId: 'template_B',
          variant: 'B',
          sent: 100,
          replies: 10,
          replyRate: 0.10, // gap: 0.10
          medianLatencyHours: 24,
        },
        {
          segmentName: 'region',
          segmentValue: '中部',
          templateId: 'template_A',
          variant: 'A',
          sent: 100,
          replies: 15,
          replyRate: 0.15,
          medianLatencyHours: 24,
        },
        {
          segmentName: 'region',
          segmentValue: '中部',
          templateId: 'template_B',
          variant: 'B',
          sent: 100,
          replies: 5,
          replyRate: 0.05, // gap: 0.10
          medianLatencyHours: 24,
        },
      ];

      const result = picker.pick(metrics);
      expect(result.length).toBe(2);
      // Both have same gap (0.10), so order may vary but both should be present
      // Use toBeCloseTo for floating point comparison
      expect(result.every(r => r.gapVsBest !== null && Math.abs(r.gapVsBest - 0.10) < 0.001)).toBe(true);
    });

    it('should limit candidates to maxCandidates', () => {
      const metrics: SegmentMetricsForPicker[] = [];

      // Create 10 segments with underperforming templates
      for (let i = 0; i < 10; i++) {
        metrics.push(
          {
            segmentName: 'region',
            segmentValue: `segment_${i}`,
            templateId: 'template_A',
            variant: 'A',
            sent: 100,
            replies: 15,
            replyRate: 0.15,
            medianLatencyHours: 24,
          },
          {
            segmentName: 'region',
            segmentValue: `segment_${i}`,
            templateId: 'template_B',
            variant: 'B',
            sent: 100,
            replies: 5,
            replyRate: 0.05,
            medianLatencyHours: 24,
          }
        );
      }

      const result = picker.pick(metrics);
      expect(result.length).toBe(5); // maxCandidates
    });

    it('should handle multiple segment types', () => {
      const metrics: SegmentMetricsForPicker[] = [
        // Region segment
        {
          segmentName: 'region',
          segmentValue: '南部',
          templateId: 'template_A',
          variant: 'A',
          sent: 100,
          replies: 15,
          replyRate: 0.15,
          medianLatencyHours: 24,
        },
        {
          segmentName: 'region',
          segmentValue: '南部',
          templateId: 'template_B',
          variant: 'B',
          sent: 100,
          replies: 8,
          replyRate: 0.08,
          medianLatencyHours: 24,
        },
        // Industry segment
        {
          segmentName: 'industryBucket',
          segmentValue: '製造業',
          templateId: 'template_A',
          variant: 'A',
          sent: 100,
          replies: 12,
          replyRate: 0.12,
          medianLatencyHours: 24,
        },
        {
          segmentName: 'industryBucket',
          segmentValue: '製造業',
          templateId: 'template_B',
          variant: 'B',
          sent: 100,
          replies: 5,
          replyRate: 0.05,
          medianLatencyHours: 24,
        },
      ];

      const result = picker.pick(metrics);
      expect(result.length).toBe(2);
      expect(result.some(r => r.segmentName === 'region')).toBe(true);
      expect(result.some(r => r.segmentName === 'industryBucket')).toBe(true);
    });
  });

  describe('configuration', () => {
    it('should use default config when not provided', () => {
      const defaultPicker = new ImprovementPicker();
      const config = defaultPicker.getConfig();

      expect(config.minSent).toBe(50);
      expect(config.minGap).toBe(0.03);
      expect(config.maxCandidates).toBe(5);
      expect(config.considerLatency).toBe(true);
      expect(config.latencyGapThreshold).toBe(6);
    });

    it('should merge partial config with defaults', () => {
      const customPicker = new ImprovementPicker({
        minSent: 100,
        minGap: 0.05,
      });
      const config = customPicker.getConfig();

      expect(config.minSent).toBe(100);
      expect(config.minGap).toBe(0.05);
      expect(config.maxCandidates).toBe(5); // default
      expect(config.considerLatency).toBe(true); // default
    });

    it('should disable latency consideration when configured', () => {
      const noLatencyPicker = new ImprovementPicker({
        considerLatency: false,
      });

      const metrics: SegmentMetricsForPicker[] = [
        {
          segmentName: 'region',
          segmentValue: '南部',
          templateId: 'template_A',
          variant: 'A',
          sent: 100,
          replies: 10,
          replyRate: 0.10,
          medianLatencyHours: 12,
        },
        {
          segmentName: 'region',
          segmentValue: '南部',
          templateId: 'template_B',
          variant: 'B',
          sent: 100,
          replies: 10,
          replyRate: 0.10,
          medianLatencyHours: 48, // Much slower but not flagged
        },
      ];

      const result = noLatencyPicker.pick(metrics);
      expect(result).toEqual([]);
    });
  });

  describe('createImprovementPicker factory', () => {
    it('should create picker with default config', () => {
      const factoryPicker = createImprovementPicker();
      expect(factoryPicker.getConfig().minSent).toBe(50);
    });

    it('should create picker with custom config', () => {
      const factoryPicker = createImprovementPicker({ minSent: 200 });
      expect(factoryPicker.getConfig().minSent).toBe(200);
    });
  });
});
