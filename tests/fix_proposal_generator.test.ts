/**
 * Fix Proposal Generator Tests
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  FixProposalGenerator,
  ProposalGeneratorInput,
  CategorySummary,
  createTestFixProposalGenerator,
  resetFixProposalGenerator,
} from '../src/domain/FixProposalGenerator';
import {
  FixProposalStore,
  createTestFixProposalStore,
  resetFixProposalStore,
} from '../src/data/FixProposalStore';

describe('FixProposalGenerator', () => {
  const testFilePath = path.join('data', 'test_generator_proposals.ndjson');
  let store: FixProposalStore;
  let generator: FixProposalGenerator;

  beforeEach(() => {
    resetFixProposalStore();
    resetFixProposalGenerator();

    // Clean up test file
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }

    store = createTestFixProposalStore(testFilePath);
    generator = createTestFixProposalGenerator({
      store,
      maxProposals: 5,
      deduplicationDays: 7,
    });
  });

  afterEach(() => {
    // Clean up test file
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  });

  const createTestInput = (
    categories: Array<{ id: string; count: number }>
  ): ProposalGeneratorInput => {
    const byCategory: CategorySummary[] = categories.map((c) => ({
      category_id: c.id,
      category_name: c.id,
      category_name_ja: c.id,
      count: c.count,
      recommended_actions: ['Action 1'],
    }));

    return {
      period: {
        start: '2026-01-20',
        end: '2026-01-27',
      },
      total_incidents: categories.reduce((sum, c) => sum + c.count, 0),
      by_category: byCategory,
      open_incidents: [],
    };
  };

  describe('generate', () => {
    it('should generate proposals for auto_stop_triggered', () => {
      const input = createTestInput([{ id: 'auto_stop_triggered', count: 3 }]);

      const proposals = generator.generate(input);

      expect(proposals).toHaveLength(1);
      expect(proposals[0].category_id).toBe('auto_stop_triggered');
      expect(proposals[0].title).toContain('自動停止原因');
      expect(proposals[0].recommended_steps.length).toBeGreaterThan(0);
    });

    it('should generate proposals for policy_config', () => {
      const input = createTestInput([{ id: 'policy_config', count: 2 }]);

      const proposals = generator.generate(input);

      expect(proposals).toHaveLength(1);
      expect(proposals[0].category_id).toBe('policy_config');
      expect(proposals[0].title).toContain('ポリシー設定');
    });

    it('should generate proposals for ramp_limited', () => {
      const input = createTestInput([{ id: 'ramp_limited', count: 2 }]);

      const proposals = generator.generate(input);

      expect(proposals).toHaveLength(1);
      expect(proposals[0].category_id).toBe('ramp_limited');
      expect(proposals[0].title).toContain('段階リリース');
    });

    it('should generate proposals for content_gate_failed', () => {
      const input = createTestInput([{ id: 'content_gate_failed', count: 2 }]);

      const proposals = generator.generate(input);

      expect(proposals).toHaveLength(1);
      expect(proposals[0].category_id).toBe('content_gate_failed');
      expect(proposals[0].title).toContain('テンプレート');
    });

    it('should generate proposals for unknown categories', () => {
      const input = createTestInput([{ id: 'some_new_category', count: 2 }]);

      const proposals = generator.generate(input);

      // Should use the 'unknown' template
      expect(proposals).toHaveLength(1);
      expect(proposals[0].category_id).toBe('unknown');
    });

    it('should only generate for top N categories', () => {
      const limitedGenerator = createTestFixProposalGenerator({
        store,
        maxProposals: 2,
        deduplicationDays: 7,
      });

      const input = createTestInput([
        { id: 'auto_stop_triggered', count: 5 },
        { id: 'policy_config', count: 3 },
        { id: 'ramp_limited', count: 1 },
      ]);

      const proposals = limitedGenerator.generate(input);

      expect(proposals.length).toBeLessThanOrEqual(2);
    });

    it('should skip categories with zero incidents', () => {
      const input = createTestInput([
        { id: 'auto_stop_triggered', count: 0 },
        { id: 'policy_config', count: 2 },
      ]);

      const proposals = generator.generate(input);

      expect(proposals).toHaveLength(1);
      expect(proposals[0].category_id).toBe('policy_config');
    });
  });

  describe('priority calculation', () => {
    it('should set P0 for auto_stop_triggered by default', () => {
      const input = createTestInput([{ id: 'auto_stop_triggered', count: 1 }]);

      const proposals = generator.generate(input);

      expect(proposals[0].priority).toBe('P0');
    });

    it('should escalate priority for high incident counts', () => {
      const input = createTestInput([{ id: 'ramp_limited', count: 10 }]);

      const proposals = generator.generate(input);

      // ramp_limited base is P2, but should escalate to P0 for 10+ incidents
      expect(proposals[0].priority).toBe('P0');
    });

    it('should escalate P2 to P1 for 5+ incidents', () => {
      const input = createTestInput([{ id: 'ramp_limited', count: 5 }]);

      const proposals = generator.generate(input);

      expect(proposals[0].priority).toBe('P1');
    });
  });

  describe('deduplication', () => {
    it('should skip categories with existing proposed proposals', () => {
      // Create existing proposal
      const existingProposal = {
        proposal_id: store.generateProposalId(),
        created_at: new Date().toISOString(),
        created_by: 'auto' as const,
        source: { report_since: '2026-01-15', top_categories: ['auto_stop_triggered'] },
        category_id: 'auto_stop_triggered',
        priority: 'P0' as const,
        title: 'Existing',
        recommended_steps: ['Step'],
        related_artifacts: {},
        status: 'proposed' as const,
        rationale: { incident_count: 1 },
        updated_at: new Date().toISOString(),
      };
      store.createProposal(existingProposal);

      const input = createTestInput([{ id: 'auto_stop_triggered', count: 3 }]);

      const proposals = generator.generate(input);

      expect(proposals).toHaveLength(0);
    });

    it('should not skip categories with rejected proposals', () => {
      // Create rejected proposal
      const rejectedProposal = {
        proposal_id: store.generateProposalId(),
        created_at: new Date().toISOString(),
        created_by: 'auto' as const,
        source: { report_since: '2026-01-15', top_categories: ['auto_stop_triggered'] },
        category_id: 'auto_stop_triggered',
        priority: 'P0' as const,
        title: 'Rejected',
        recommended_steps: ['Step'],
        related_artifacts: {},
        status: 'rejected' as const,
        rationale: { incident_count: 1 },
        updated_at: new Date().toISOString(),
      };
      store.createProposal(rejectedProposal);

      const input = createTestInput([{ id: 'auto_stop_triggered', count: 3 }]);

      const proposals = generator.generate(input);

      expect(proposals).toHaveLength(1);
    });
  });

  describe('createProposals', () => {
    it('should create and store proposals', () => {
      const input = createTestInput([{ id: 'auto_stop_triggered', count: 3 }]);

      const proposals = generator.createProposals(input);

      expect(proposals).toHaveLength(1);
      expect(proposals[0].proposal_id).toMatch(/^FIX-/);

      // Verify stored
      const stored = store.getProposal(proposals[0].proposal_id);
      expect(stored).not.toBeNull();
    });

    it('should not store in dry-run mode', () => {
      const input = createTestInput([{ id: 'auto_stop_triggered', count: 3 }]);

      const proposals = generator.createProposals(input, { dryRun: true });

      expect(proposals).toHaveLength(1);

      // Verify not stored
      const stored = store.getProposal(proposals[0].proposal_id);
      expect(stored).toBeNull();
    });

    it('should include recent incident IDs in rationale', () => {
      const input: ProposalGeneratorInput = {
        period: { start: '2026-01-20', end: '2026-01-27' },
        total_incidents: 3,
        by_category: [
          {
            category_id: 'auto_stop_triggered',
            category_name: 'Auto-Stop',
            category_name_ja: '自動停止発動',
            count: 3,
            recommended_actions: [],
          },
        ],
        open_incidents: [
          { incident_id: 'INC-001', category_id: 'auto_stop_triggered' },
          { incident_id: 'INC-002', category_id: 'auto_stop_triggered' },
        ],
      };

      const proposals = generator.createProposals(input, { dryRun: true });

      expect(proposals[0].rationale.recent_examples).toEqual(['INC-001', 'INC-002']);
    });
  });

  describe('related artifacts', () => {
    it('should include relevant files for auto_stop_triggered', () => {
      const input = createTestInput([{ id: 'auto_stop_triggered', count: 1 }]);

      const proposals = generator.generate(input);

      expect(proposals[0].related_artifacts.files).toContain('config/auto_stop.json');
      expect(proposals[0].related_artifacts.commands).toContain('run_ops report');
    });

    it('should include relevant files for policy_config', () => {
      const input = createTestInput([{ id: 'policy_config', count: 1 }]);

      const proposals = generator.generate(input);

      expect(proposals[0].related_artifacts.files).toContain('.env');
      expect(proposals[0].related_artifacts.commands).toContain('run_ops stop-status');
    });
  });
});
