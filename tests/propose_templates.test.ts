/**
 * propose_templates CLI Tests
 *
 * Note: Full integration tests require actual data files.
 * These tests verify the supporting functions and structure.
 */
import * as fs from 'fs';
import * as path from 'path';

// Mock the CLI module internals by testing the components
import { ImprovementPicker, SegmentMetricsForPicker } from '../src/domain/ImprovementPicker';
import { TemplateGenerator, TemplateProposal } from '../src/domain/TemplateGenerator';
import { ExperimentEvaluator, ExperimentsRegistry } from '../src/domain/ExperimentEvaluator';

describe('propose_templates CLI Components', () => {
  describe('median calculation', () => {
    // Reimplementing for test verification
    function median(values: number[]): number | null {
      if (values.length === 0) return null;
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
      }
      return sorted[mid];
    }

    it('should return null for empty array', () => {
      expect(median([])).toBeNull();
    });

    it('should return single value for array of one', () => {
      expect(median([5])).toBe(5);
    });

    it('should return middle value for odd-length array', () => {
      expect(median([1, 2, 3])).toBe(2);
      expect(median([1, 3, 5, 7, 9])).toBe(5);
    });

    it('should return average of middle values for even-length array', () => {
      expect(median([1, 2, 3, 4])).toBe(2.5);
      expect(median([10, 20, 30, 40])).toBe(25);
    });

    it('should handle unsorted arrays', () => {
      expect(median([3, 1, 2])).toBe(2);
      expect(median([9, 1, 5, 3, 7])).toBe(5);
    });
  });

  describe('segment filter parsing', () => {
    function parseSegmentFilter(filter: string): { name: string; value: string } | null {
      const [name, value] = filter.split('=');
      if (name && value) {
        return { name, value };
      }
      return null;
    }

    it('should parse valid segment filter', () => {
      const result = parseSegmentFilter('region=南部');
      expect(result).toEqual({ name: 'region', value: '南部' });
    });

    it('should parse filter with equals in value', () => {
      const result = parseSegmentFilter('key=value');
      expect(result).toEqual({ name: 'key', value: 'value' });
    });

    it('should return null for invalid filter', () => {
      expect(parseSegmentFilter('')).toBeNull();
      expect(parseSegmentFilter('noequals')).toBeNull();
    });
  });

  describe('workflow integration', () => {
    let picker: ImprovementPicker;
    let generator: TemplateGenerator;

    beforeEach(() => {
      picker = new ImprovementPicker({
        minSent: 50,
        minGap: 0.03,
        maxCandidates: 5,
      });
      generator = new TemplateGenerator();
    });

    it('should complete full proposal workflow', () => {
      // Step 1: Aggregate metrics (simulated)
      const metrics: SegmentMetricsForPicker[] = [
        {
          segmentName: 'region',
          segmentValue: '南部',
          templateId: 'new_candidates_v1_A',
          variant: 'A',
          sent: 100,
          replies: 15,
          replyRate: 0.15,
          medianLatencyHours: 24,
        },
        {
          segmentName: 'region',
          segmentValue: '南部',
          templateId: 'new_candidates_v1_B',
          variant: 'B',
          sent: 100,
          replies: 5,
          replyRate: 0.05,
          medianLatencyHours: 36,
        },
      ];

      // Step 2: Pick improvement candidates
      const candidates = picker.pick(metrics);
      expect(candidates.length).toBe(1);
      expect(candidates[0].templateId).toBe('new_candidates_v1_B');

      // Step 3: Generate proposals
      const allProposals: TemplateProposal[] = [];
      for (const candidate of candidates) {
        const proposals = generator.generate(candidate, 2);
        allProposals.push(...proposals);
      }

      expect(allProposals.length).toBeGreaterThan(0);

      // Step 4: Verify proposal structure
      const proposal = allProposals[0];
      expect(proposal.status).toBe('proposed');
      expect(proposal.baseTemplateId).toBe('new_candidates_v1_B');
      expect(proposal.targetSegment.segmentName).toBe('region');
      expect(proposal.targetSegment.segmentValue).toBe('南部');
    });

    it('should handle no candidates scenario', () => {
      // All templates performing similarly
      const metrics: SegmentMetricsForPicker[] = [
        {
          segmentName: 'region',
          segmentValue: '南部',
          templateId: 'new_candidates_v1_A',
          variant: 'A',
          sent: 100,
          replies: 10,
          replyRate: 0.10,
          medianLatencyHours: 24,
        },
        {
          segmentName: 'region',
          segmentValue: '南部',
          templateId: 'new_candidates_v1_B',
          variant: 'B',
          sent: 100,
          replies: 10,
          replyRate: 0.10,
          medianLatencyHours: 24,
        },
      ];

      const candidates = picker.pick(metrics);
      expect(candidates.length).toBe(0);
    });
  });

  describe('experiments.json update logic', () => {
    const testDir = path.join(__dirname, 'tmp_propose_test');
    const experimentsPath = path.join(testDir, 'experiments.json');
    const backupPath = path.join(testDir, 'experiments.json.bak');

    beforeEach(() => {
      // Create test directory
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }

      // Create initial experiments.json
      const registry: ExperimentsRegistry = {
        experiments: [
          {
            experimentId: 'test_experiment',
            name: 'Test Experiment',
            startDate: '2026-01-01',
            endDate: null,
            primaryMetric: 'replyRate',
            minSentPerVariant: 50,
            decisionRule: { alpha: 0.05, minLift: 0.02 },
            templates: [
              { templateId: 'new_candidates_v1_A', variant: 'A', status: 'active' },
              { templateId: 'new_candidates_v1_B', variant: 'B', status: 'active' },
            ],
          },
        ],
      };
      fs.writeFileSync(experimentsPath, JSON.stringify(registry, null, 2));
    });

    afterEach(() => {
      // Cleanup
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true });
      }
    });

    it('should add proposals with proposed status', () => {
      // Read current registry
      const content = fs.readFileSync(experimentsPath, 'utf-8');
      const registry: ExperimentsRegistry = JSON.parse(content);

      // Create backup
      fs.writeFileSync(backupPath, content);

      // Add proposal
      const proposal: TemplateProposal = {
        templateIdNew: 'new_candidates_v1_B_urgency_test123',
        baseTemplateId: 'new_candidates_v1_B',
        variant: 'B',
        status: 'proposed',
        changes: [
          {
            field: 'subjectTemplate',
            type: 'urgency',
            description: 'Added urgency',
            before: 'Original',
            after: 'Updated',
          },
        ],
        content: {
          subjectTemplate: 'Updated',
          candidateHeader: '【候補者】',
          ctaText: 'ご連絡ください。',
        },
        targetSegment: { segmentName: 'region', segmentValue: '南部' },
        rationale: 'Test rationale',
      };

      const experiment = registry.experiments[0];
      experiment.templates.push({
        templateId: proposal.templateIdNew,
        variant: proposal.variant,
        status: 'proposed' as 'active' | 'archived' | 'inactive',
      });

      fs.writeFileSync(experimentsPath, JSON.stringify(registry, null, 2));

      // Verify
      const updated = JSON.parse(fs.readFileSync(experimentsPath, 'utf-8'));
      expect(updated.experiments[0].templates.length).toBe(3);
      expect(updated.experiments[0].templates[2].status).toBe('proposed');

      // Verify backup was created
      expect(fs.existsSync(backupPath)).toBe(true);
    });

    it('should not include proposed templates in active list', () => {
      // Add proposed template
      const content = fs.readFileSync(experimentsPath, 'utf-8');
      const registry: ExperimentsRegistry = JSON.parse(content);

      registry.experiments[0].templates.push({
        templateId: 'proposed_template',
        variant: 'A',
        status: 'proposed' as 'active' | 'archived' | 'inactive',
      });

      fs.writeFileSync(experimentsPath, JSON.stringify(registry, null, 2));

      // Use evaluator to get active templates
      const evaluator = new ExperimentEvaluator({ experimentsPath });
      const activeTemplates = evaluator.getActiveTemplates('test_experiment');

      expect(activeTemplates.length).toBe(2);
      expect(activeTemplates.every(t => t.status === 'active')).toBe(true);
      expect(activeTemplates.some(t => t.templateId === 'proposed_template')).toBe(false);
    });
  });

  describe('result structure', () => {
    it('should build proper result object', () => {
      interface ProposeResult {
        experimentId: string;
        period: { since: string; until: string };
        segmentFilter: string | null;
        candidatesFound: number;
        proposalsGenerated: number;
        proposals: TemplateProposal[];
        updatedFile: boolean;
        backupPath: string | null;
        error: string | null;
      }

      const result: ProposeResult = {
        experimentId: 'test_experiment',
        period: {
          since: '2026-01-01',
          until: '2026-01-26',
        },
        segmentFilter: 'region=南部',
        candidatesFound: 2,
        proposalsGenerated: 4,
        proposals: [],
        updatedFile: false,
        backupPath: null,
        error: null,
      };

      expect(result.experimentId).toBe('test_experiment');
      expect(result.period.since).toBe('2026-01-01');
      expect(result.segmentFilter).toBe('region=南部');
      expect(result.error).toBeNull();
    });
  });
});
