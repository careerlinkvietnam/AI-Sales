/**
 * Interactive Runner Tests
 */

import {
  InteractiveRunner,
  ExecutionContext,
  ExecutionResult,
  executeWithoutInteraction,
} from '../src/cli/interactive_runner';
import {
  ApprovalCandidates,
  TemplateApprovalCandidate,
  FixProposalCandidate,
  OpsCandidate,
} from '../src/domain/ApprovalCandidatePicker';

// Mock dependencies
jest.mock('../src/domain/ExperimentScheduler', () => ({
  getExperimentScheduler: () => ({
    getActiveExperiment: () => ({
      experiment: null,
    }),
  }),
}));

jest.mock('../src/domain/IncidentManager', () => ({
  getIncidentManager: () => ({
    listIncidents: () => [],
  }),
}));

jest.mock('../src/domain/FixProposalManager', () => {
  const mockAccept = jest.fn().mockReturnValue({ success: true, newStatus: 'accepted' });
  const mockReject = jest.fn().mockReturnValue({ success: true, newStatus: 'rejected' });
  return {
    getFixProposalManager: () => ({
      accept: mockAccept,
      reject: mockReject,
      listProposals: () => [],
    }),
    __mockAccept: mockAccept,
    __mockReject: mockReject,
  };
});

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


describe('InteractiveRunner', () => {
  const createMockContext = (executeMode = false): ExecutionContext => ({
    actor: 'test-user',
    reason: 'test reason',
    source: 'interactive',
    executeMode,
  });

  const createMockCandidates = (): ApprovalCandidates => ({
    generatedAt: new Date().toISOString(),
    period: { from: '2026-01-20', to: '2026-01-27' },
    templates: [],
    fixes: [],
    ops: [],
    summary: {
      totalCandidates: 0,
      p0Count: 0,
      p1Count: 0,
      p2Count: 0,
    },
  });

  describe('executeWithoutInteraction', () => {
    it('returns empty results for empty candidates', () => {
      const candidates = createMockCandidates();
      const context = createMockContext();
      const decisions = new Map<string, string>();

      const results = executeWithoutInteraction(candidates, context, decisions);

      expect(results).toEqual([]);
    });

    it('skips templates when no decision provided', () => {
      const candidates = createMockCandidates();
      candidates.templates = [{
        id: 'tmpl-1',
        templateId: 'template-1',
        experimentId: 'exp-1',
        variant: 'A',
        priority: 'P1',
        rationale: 'Test rationale',
        recommendedCommand: 'npx ts-node ...',
        guardrails: [],
      }];
      candidates.summary.totalCandidates = 1;

      const context = createMockContext();
      const decisions = new Map<string, string>();

      const results = executeWithoutInteraction(candidates, context, decisions);

      expect(results.length).toBe(1);
      expect(results[0].action).toBe('skip');
      expect(results[0].candidateId).toBe('tmpl-1');
    });

    it('blocks template with min_sent guardrail', () => {
      const candidates = createMockCandidates();
      candidates.templates = [{
        id: 'tmpl-1',
        templateId: 'template-1',
        experimentId: 'exp-1',
        variant: 'A',
        priority: 'P1',
        rationale: 'Test rationale',
        recommendedCommand: 'npx ts-node ...',
        guardrails: ['min_sent未満 (5/10)'],
      }];
      candidates.summary.totalCandidates = 1;

      const context = createMockContext(true);
      const decisions = new Map<string, string>([['tmpl-1', 'approve']]);

      const results = executeWithoutInteraction(candidates, context, decisions);

      expect(results.length).toBe(1);
      expect(results[0].success).toBe(false);
      expect(results[0].blockedByGuardrails).toBeDefined();
      expect(results[0].blockedByGuardrails).toContain('Insufficient sample size (min_sent not met)');
    });

    it('performs dry-run for template when not in execute mode', () => {
      const candidates = createMockCandidates();
      candidates.templates = [{
        id: 'tmpl-1',
        templateId: 'template-1',
        experimentId: 'exp-1',
        variant: 'A',
        priority: 'P1',
        rationale: 'Test rationale',
        recommendedCommand: 'npx ts-node ...',
        guardrails: [],
      }];
      candidates.summary.totalCandidates = 1;

      const context = createMockContext(false); // dry-run mode
      const decisions = new Map<string, string>([['tmpl-1', 'approve']]);

      const results = executeWithoutInteraction(candidates, context, decisions);

      expect(results.length).toBe(1);
      expect(results[0].dryRun).toBe(true);
      expect(results[0].action).toBe('template_approve');
    });

    it('executes fix proposal accept in execute mode', () => {
      const { __mockAccept } = require('../src/domain/FixProposalManager');
      __mockAccept.mockClear();

      const candidates = createMockCandidates();
      candidates.fixes = [{
        id: 'fix-1',
        proposalId: 'proposal-1',
        categoryId: 'test_category',
        priority: 'P1',
        rationale: 'Test fix',
        recommendedCommand: 'npx ts-node ...',
        guardrails: [],
      }];
      candidates.summary.totalCandidates = 1;

      const context = createMockContext(true); // execute mode
      const decisions = new Map<string, string>([['fix-1', 'accept']]);

      const results = executeWithoutInteraction(candidates, context, decisions);

      expect(results.length).toBe(1);
      expect(results[0].dryRun).toBe(false);
      expect(results[0].action).toBe('fix_accept');
      expect(results[0].success).toBe(true);
      expect(__mockAccept).toHaveBeenCalledWith('proposal-1', 'test-user', 'test reason');
    });

    it('executes fix proposal reject in execute mode', () => {
      const { __mockReject } = require('../src/domain/FixProposalManager');
      __mockReject.mockClear();

      const candidates = createMockCandidates();
      candidates.fixes = [{
        id: 'fix-1',
        proposalId: 'proposal-1',
        categoryId: 'test_category',
        priority: 'P1',
        rationale: 'Test fix',
        recommendedCommand: 'npx ts-node ...',
        guardrails: [],
      }];
      candidates.summary.totalCandidates = 1;

      const context = createMockContext(true);
      const decisions = new Map<string, string>([['fix-1', 'reject']]);

      const results = executeWithoutInteraction(candidates, context, decisions);

      expect(results.length).toBe(1);
      expect(results[0].dryRun).toBe(false);
      expect(results[0].action).toBe('fix_reject');
      expect(__mockReject).toHaveBeenCalledWith('proposal-1', 'test-user', 'test reason');
    });

    it('performs dry-run for fix when not in execute mode', () => {
      const candidates = createMockCandidates();
      candidates.fixes = [{
        id: 'fix-1',
        proposalId: 'proposal-1',
        categoryId: 'test_category',
        priority: 'P1',
        rationale: 'Test fix',
        recommendedCommand: 'npx ts-node ...',
        guardrails: [],
      }];
      candidates.summary.totalCandidates = 1;

      const context = createMockContext(false);
      const decisions = new Map<string, string>([['fix-1', 'accept']]);

      const results = executeWithoutInteraction(candidates, context, decisions);

      expect(results.length).toBe(1);
      expect(results[0].dryRun).toBe(true);
      expect(results[0].action).toBe('fix_accept');
    });

    it('processes ops candidates', () => {
      const candidates = createMockCandidates();
      candidates.ops = [{
        id: 'ops-1',
        type: 'dead_letter',
        priority: 'P0',
        rationale: 'Dead letter queue',
        recommendedCommand: 'npx ts-node ...',
        guardrails: [],
      }];
      candidates.summary.totalCandidates = 1;

      const context = createMockContext();
      const decisions = new Map<string, string>([['ops-1', 'list']]);

      const results = executeWithoutInteraction(candidates, context, decisions);

      expect(results.length).toBe(1);
      expect(results[0].candidateId).toBe('ops-1');
    });

    it('skips ops when no decision provided', () => {
      const candidates = createMockCandidates();
      candidates.ops = [{
        id: 'ops-1',
        type: 'dead_letter',
        priority: 'P0',
        rationale: 'Dead letter queue',
        recommendedCommand: 'npx ts-node ...',
        guardrails: [],
      }];
      candidates.summary.totalCandidates = 1;

      const context = createMockContext();
      const decisions = new Map<string, string>();

      const results = executeWithoutInteraction(candidates, context, decisions);

      expect(results.length).toBe(1);
      expect(results[0].action).toBe('skip');
    });
  });

  describe('Guardrails', () => {
    it('blocks template execution when experiment is paused', () => {
      // Override mock for this test
      jest.doMock('../src/domain/ExperimentScheduler', () => ({
        getExperimentScheduler: () => ({
          getActiveExperiment: () => ({
            experiment: { status: 'paused' },
          }),
        }),
      }));

      const candidates = createMockCandidates();
      candidates.templates = [{
        id: 'tmpl-1',
        templateId: 'template-1',
        experimentId: 'exp-1',
        variant: 'A',
        priority: 'P1',
        rationale: 'Test rationale',
        recommendedCommand: 'npx ts-node ...',
        guardrails: ['experiment is paused'],
      }];
      candidates.summary.totalCandidates = 1;

      const context = createMockContext(true);
      const decisions = new Map<string, string>([['tmpl-1', 'approve']]);

      const results = executeWithoutInteraction(candidates, context, decisions);

      expect(results.length).toBe(1);
      expect(results[0].success).toBe(false);
      expect(results[0].blockedByGuardrails).toContain('Experiment is paused - cannot approve templates');
    });
  });

  describe('ExecutionContext', () => {
    it('requires actor and reason', () => {
      const context: ExecutionContext = {
        actor: 'reviewer',
        reason: 'weekly review',
        source: 'interactive',
        executeMode: false,
      };

      expect(context.actor).toBe('reviewer');
      expect(context.reason).toBe('weekly review');
      expect(context.source).toBe('interactive');
    });
  });

  describe('ExecutionResult', () => {
    it('has all required properties', () => {
      const result: ExecutionResult = {
        success: true,
        action: 'fix_accept',
        candidateId: 'fix-1',
        dryRun: false,
        message: 'Executed successfully',
      };

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('action');
      expect(result).toHaveProperty('candidateId');
      expect(result).toHaveProperty('dryRun');
      expect(result).toHaveProperty('message');
    });

    it('can include error and blockedByGuardrails', () => {
      const result: ExecutionResult = {
        success: false,
        action: 'template_approve',
        candidateId: 'tmpl-1',
        dryRun: true,
        message: 'Blocked',
        error: 'Test error',
        blockedByGuardrails: ['min_sent not met'],
      };

      expect(result.error).toBe('Test error');
      expect(result.blockedByGuardrails).toContain('min_sent not met');
    });
  });
});

describe('Multiple candidates processing', () => {
  it('processes all candidate types in sequence', () => {
    const candidates: ApprovalCandidates = {
      generatedAt: new Date().toISOString(),
      period: { from: '2026-01-20', to: '2026-01-27' },
      templates: [{
        id: 'tmpl-1',
        templateId: 'template-1',
        experimentId: 'exp-1',
        variant: 'A',
        priority: 'P1',
        rationale: 'Test',
        recommendedCommand: 'npx ts-node ...',
        guardrails: [],
      }],
      fixes: [{
        id: 'fix-1',
        proposalId: 'proposal-1',
        categoryId: 'test',
        priority: 'P0',
        rationale: 'Test',
        recommendedCommand: 'npx ts-node ...',
        guardrails: [],
      }],
      ops: [{
        id: 'ops-1',
        type: 'dead_letter',
        priority: 'P0',
        rationale: 'Test',
        recommendedCommand: 'npx ts-node ...',
        guardrails: [],
      }],
      summary: {
        totalCandidates: 3,
        p0Count: 2,
        p1Count: 1,
        p2Count: 0,
      },
    };

    const context: ExecutionContext = {
      actor: 'test-user',
      reason: 'test',
      source: 'interactive',
      executeMode: false,
    };

    const decisions = new Map<string, string>([
      ['tmpl-1', 'approve'],
      ['fix-1', 'accept'],
      ['ops-1', 'list'],
    ]);

    const results = executeWithoutInteraction(candidates, context, decisions);

    expect(results.length).toBe(3);
    expect(results[0].candidateId).toBe('tmpl-1');
    expect(results[1].candidateId).toBe('fix-1');
    expect(results[2].candidateId).toBe('ops-1');
  });

  it('continues processing after one failure', () => {
    const { __mockAccept } = require('../src/domain/FixProposalManager');
    __mockAccept.mockReturnValueOnce({ success: false, error: 'Test error' });

    const candidates: ApprovalCandidates = {
      generatedAt: new Date().toISOString(),
      period: { from: '2026-01-20', to: '2026-01-27' },
      templates: [],
      fixes: [
        {
          id: 'fix-1',
          proposalId: 'proposal-1',
          categoryId: 'test',
          priority: 'P0',
          rationale: 'Test',
          recommendedCommand: 'npx ts-node ...',
          guardrails: [],
        },
        {
          id: 'fix-2',
          proposalId: 'proposal-2',
          categoryId: 'test',
          priority: 'P1',
          rationale: 'Test 2',
          recommendedCommand: 'npx ts-node ...',
          guardrails: [],
        },
      ],
      ops: [],
      summary: {
        totalCandidates: 2,
        p0Count: 1,
        p1Count: 1,
        p2Count: 0,
      },
    };

    const context: ExecutionContext = {
      actor: 'test-user',
      reason: 'test',
      source: 'interactive',
      executeMode: true,
    };

    const decisions = new Map<string, string>([
      ['fix-1', 'accept'],
      ['fix-2', 'accept'],
    ]);

    const results = executeWithoutInteraction(candidates, context, decisions);

    // Both should be processed even if first fails
    expect(results.length).toBe(2);
  });
});
