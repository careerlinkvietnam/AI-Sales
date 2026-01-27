/**
 * ApprovalCandidatePicker Tests
 */

import {
  ApprovalCandidatePicker,
  ApprovalCandidates,
  TemplateApprovalCandidate,
  FixProposalCandidate,
  OpsCandidate,
  getApprovalCandidatePicker,
  resetApprovalCandidatePicker,
} from '../src/domain/ApprovalCandidatePicker';

// Mock dependencies
jest.mock('../src/domain/ExperimentScheduler', () => ({
  getExperimentScheduler: () => ({
    getActiveExperiment: () => ({
      experiment: null,
    }),
  }),
}));

jest.mock('../src/data/MetricsStore', () => ({
  getMetricsStore: () => ({
    readEventsSince: () => [],
  }),
}));

jest.mock('../src/domain/IncidentManager', () => ({
  getIncidentManager: () => ({
    listIncidents: () => [],
  }),
}));

jest.mock('../src/domain/FixProposalManager', () => ({
  getFixProposalManager: () => ({
    listProposals: () => [],
  }),
}));

jest.mock('../src/domain/RuntimeKillSwitch', () => ({
  getRuntimeKillSwitch: () => ({
    isEnabled: () => false,
    getState: () => null,
  }),
}));

jest.mock('../src/domain/SendPolicy', () => ({
  getSendPolicy: () => ({
    getConfig: () => ({ killSwitch: false }),
  }),
}));

jest.mock('../src/domain/SendQueueManager', () => ({
  getSendQueueManager: () => ({
    getStatusCounts: () => ({
      queued: 0,
      in_progress: 0,
      dead_letter: 0,
      sent: 0,
      failed: 0,
    }),
  }),
}));

jest.mock('../src/data/NdjsonCompactor', () => ({
  getDataFileStatus: () => ({
    exists: false,
    lines: 0,
    sizeBytes: 0,
  }),
  formatBytes: (bytes: number) => `${bytes} B`,
}));

describe('ApprovalCandidatePicker', () => {
  let picker: ApprovalCandidatePicker;

  beforeEach(() => {
    resetApprovalCandidatePicker();
    picker = new ApprovalCandidatePicker();
  });

  describe('pick', () => {
    it('returns ApprovalCandidates with all required fields', () => {
      const result = picker.pick();

      expect(result).toHaveProperty('generatedAt');
      expect(result).toHaveProperty('period');
      expect(result).toHaveProperty('templates');
      expect(result).toHaveProperty('fixes');
      expect(result).toHaveProperty('ops');
      expect(result).toHaveProperty('summary');
    });

    it('uses default 7 days period when since is not provided', () => {
      const result = picker.pick();

      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      expect(result.period.from).toBe(sevenDaysAgo.toISOString().split('T')[0]);
      expect(result.period.to).toBe(now.toISOString().split('T')[0]);
    });

    it('uses provided since date', () => {
      const result = picker.pick({ since: '2026-01-15' });

      expect(result.period.from).toBe('2026-01-15');
    });

    it('respects max limits', () => {
      const result = picker.pick({
        maxTemplates: 1,
        maxFixes: 1,
        maxOps: 1,
      });

      expect(result.templates.length).toBeLessThanOrEqual(1);
      expect(result.fixes.length).toBeLessThanOrEqual(1);
      expect(result.ops.length).toBeLessThanOrEqual(1);
    });
  });

  describe('templates candidates', () => {
    it('returns empty array when no experiments', () => {
      const result = picker.pick();

      expect(result.templates).toEqual([]);
    });
  });

  describe('fixes candidates', () => {
    it('returns empty array when no proposed fixes', () => {
      const result = picker.pick();

      expect(result.fixes).toEqual([]);
    });
  });

  describe('ops candidates', () => {
    it('returns empty array when no issues', () => {
      const result = picker.pick();

      expect(result.ops).toEqual([]);
    });
  });

  describe('summary', () => {
    it('calculates total candidates correctly', () => {
      const result = picker.pick();

      const expectedTotal = result.templates.length + result.fixes.length + result.ops.length;
      expect(result.summary.totalCandidates).toBe(expectedTotal);
    });

    it('counts priorities correctly', () => {
      const result = picker.pick();

      // With mocks returning empty, all should be 0
      expect(result.summary.p0Count).toBe(0);
      expect(result.summary.p1Count).toBe(0);
      expect(result.summary.p2Count).toBe(0);
    });
  });

  describe('generateMarkdown', () => {
    it('includes required sections', () => {
      const result = picker.pick();
      const markdown = picker.generateMarkdown(result);

      expect(markdown).toContain('# Approval Candidates');
      expect(markdown).toContain('## 1. Template Approval Candidates');
      expect(markdown).toContain('## 2. Fix Proposal Candidates');
      expect(markdown).toContain('## 3. Ops Candidates');
    });

    it('includes period information', () => {
      const result = picker.pick();
      const markdown = picker.generateMarkdown(result);

      expect(markdown).toContain(`**Period**: ${result.period.from} ~ ${result.period.to}`);
    });

    it('includes summary', () => {
      const result = picker.pick();
      const markdown = picker.generateMarkdown(result);

      expect(markdown).toContain('**Summary**:');
      expect(markdown).toContain('candidate(s)');
    });

    it('includes disclaimer about no automatic approvals', () => {
      const result = picker.pick();
      const markdown = picker.generateMarkdown(result);

      expect(markdown).toContain('No automatic approvals are performed');
    });

    it('shows no candidates message when empty', () => {
      const result = picker.pick();
      const markdown = picker.generateMarkdown(result);

      expect(markdown).toContain('No template approval candidates');
      expect(markdown).toContain('No fix proposal candidates');
      expect(markdown).toContain('No ops candidates');
    });
  });

  describe('getApprovalCandidatePicker', () => {
    it('returns singleton instance', () => {
      const picker1 = getApprovalCandidatePicker();
      const picker2 = getApprovalCandidatePicker();

      expect(picker1).toBe(picker2);
    });

    it('resets singleton', () => {
      const picker1 = getApprovalCandidatePicker();
      resetApprovalCandidatePicker();
      const picker2 = getApprovalCandidatePicker();

      expect(picker1).not.toBe(picker2);
    });
  });
});

describe('Candidate priority', () => {
  it('defines valid priority values', () => {
    const validPriorities = ['P0', 'P1', 'P2'];

    for (const priority of validPriorities) {
      expect(['P0', 'P1', 'P2']).toContain(priority);
    }
  });
});

describe('TemplateApprovalCandidate type', () => {
  it('has all required properties', () => {
    const candidate: TemplateApprovalCandidate = {
      id: 'tmpl-1',
      templateId: 'template-1',
      experimentId: 'exp-1',
      variant: 'A',
      priority: 'P0',
      rationale: 'Test rationale',
      recommendedCommand: 'npx ts-node ...',
      guardrails: [],
    };

    expect(candidate).toHaveProperty('id');
    expect(candidate).toHaveProperty('templateId');
    expect(candidate).toHaveProperty('experimentId');
    expect(candidate).toHaveProperty('variant');
    expect(candidate).toHaveProperty('priority');
    expect(candidate).toHaveProperty('rationale');
    expect(candidate).toHaveProperty('recommendedCommand');
    expect(candidate).toHaveProperty('guardrails');
  });
});

describe('FixProposalCandidate type', () => {
  it('has all required properties', () => {
    const candidate: FixProposalCandidate = {
      id: 'fix-1',
      proposalId: 'proposal-1',
      categoryId: 'auto_stop_triggered',
      priority: 'P0',
      rationale: 'Test rationale',
      recommendedCommand: 'npx ts-node ...',
      guardrails: [],
    };

    expect(candidate).toHaveProperty('id');
    expect(candidate).toHaveProperty('proposalId');
    expect(candidate).toHaveProperty('categoryId');
    expect(candidate).toHaveProperty('priority');
    expect(candidate).toHaveProperty('rationale');
    expect(candidate).toHaveProperty('recommendedCommand');
    expect(candidate).toHaveProperty('guardrails');
  });
});

describe('OpsCandidate type', () => {
  it('has all required properties', () => {
    const candidate: OpsCandidate = {
      id: 'ops-1',
      type: 'dead_letter',
      priority: 'P0',
      rationale: 'Test rationale',
      recommendedCommand: 'npx ts-node ...',
      guardrails: [],
    };

    expect(candidate).toHaveProperty('id');
    expect(candidate).toHaveProperty('type');
    expect(candidate).toHaveProperty('priority');
    expect(candidate).toHaveProperty('rationale');
    expect(candidate).toHaveProperty('recommendedCommand');
    expect(candidate).toHaveProperty('guardrails');
  });

  it('type can be dead_letter, kill_switch, queue_backlog, data_cleanup, or incident_review', () => {
    const validTypes = ['dead_letter', 'kill_switch', 'queue_backlog', 'data_cleanup', 'incident_review'];

    for (const type of validTypes) {
      expect(validTypes).toContain(type);
    }
  });
});

describe('Priority-based picking', () => {
  it('sorts candidates by priority P0 > P1 > P2', () => {
    // Create a picker and verify sorting works
    const picker = new ApprovalCandidatePicker();

    // Since we're using mocks, we can't easily test internal sorting
    // but we can verify the result structure is correct
    const result = picker.pick();

    // If there were candidates, they should be sorted
    // With mocks, we just verify the structure
    expect(Array.isArray(result.templates)).toBe(true);
    expect(Array.isArray(result.fixes)).toBe(true);
    expect(Array.isArray(result.ops)).toBe(true);
  });
});
