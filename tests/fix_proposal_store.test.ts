/**
 * Fix Proposal Store Tests
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  FixProposalStore,
  FixProposal,
  createTestFixProposalStore,
  resetFixProposalStore,
} from '../src/data/FixProposalStore';

describe('FixProposalStore', () => {
  const testFilePath = path.join('data', 'test_fix_proposals.ndjson');
  let store: FixProposalStore;

  beforeEach(() => {
    resetFixProposalStore();

    // Clean up test file
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }

    store = createTestFixProposalStore(testFilePath);
  });

  afterEach(() => {
    // Clean up test file
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  });

  const createTestProposal = (overrides?: Partial<FixProposal>): FixProposal => {
    const now = new Date().toISOString();
    return {
      proposal_id: store.generateProposalId(),
      created_at: now,
      created_by: 'auto',
      source: {
        report_since: '2026-01-20',
        top_categories: ['auto_stop_triggered'],
      },
      category_id: 'auto_stop_triggered',
      priority: 'P1',
      title: 'Test proposal',
      recommended_steps: ['Step 1', 'Step 2'],
      related_artifacts: {
        files: ['config/auto_stop.json'],
        commands: ['run_ops report'],
      },
      status: 'proposed',
      rationale: {
        incident_count: 3,
        recent_examples: ['INC-001', 'INC-002'],
      },
      updated_at: now,
      ...overrides,
    };
  };

  describe('createProposal', () => {
    it('should create a new proposal', () => {
      const proposal = createTestProposal();
      store.createProposal(proposal);

      const retrieved = store.getProposal(proposal.proposal_id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.proposal_id).toBe(proposal.proposal_id);
      expect(retrieved?.title).toBe('Test proposal');
    });

    it('should persist to file', () => {
      const proposal = createTestProposal();
      store.createProposal(proposal);

      // Create new store to verify persistence
      const newStore = createTestFixProposalStore(testFilePath);
      const retrieved = newStore.getProposal(proposal.proposal_id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.proposal_id).toBe(proposal.proposal_id);
    });
  });

  describe('listProposals', () => {
    it('should return empty array when no proposals', () => {
      const proposals = store.listProposals();
      expect(proposals).toEqual([]);
    });

    it('should return all proposals', () => {
      store.createProposal(createTestProposal({ status: 'proposed' }));
      store.createProposal(createTestProposal({ status: 'accepted' }));

      const proposals = store.listProposals();
      expect(proposals).toHaveLength(2);
    });

    it('should filter by status', () => {
      store.createProposal(createTestProposal({ status: 'proposed' }));
      store.createProposal(createTestProposal({ status: 'accepted' }));

      const proposed = store.listProposals({ status: 'proposed' });
      expect(proposed).toHaveLength(1);
      expect(proposed[0].status).toBe('proposed');
    });

    it('should sort by created_at descending', () => {
      const older = createTestProposal({
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      });
      const newer = createTestProposal({
        created_at: '2026-01-02T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      });

      store.createProposal(older);
      store.createProposal(newer);

      const proposals = store.listProposals();
      expect(proposals[0].created_at).toBe('2026-01-02T00:00:00Z');
      expect(proposals[1].created_at).toBe('2026-01-01T00:00:00Z');
    });
  });

  describe('updateStatus', () => {
    it('should update proposal status to accepted', () => {
      const proposal = createTestProposal();
      store.createProposal(proposal);

      const success = store.updateStatus(proposal.proposal_id, 'accepted', 'operator');
      expect(success).toBe(true);

      const updated = store.getProposal(proposal.proposal_id);
      expect(updated?.status).toBe('accepted');
      expect(updated?.accepted_by).toBe('operator');
      expect(updated?.accepted_at).toBeDefined();
    });

    it('should update proposal status to rejected with reason', () => {
      const proposal = createTestProposal();
      store.createProposal(proposal);

      const success = store.updateStatus(
        proposal.proposal_id,
        'rejected',
        'operator',
        'Not applicable'
      );
      expect(success).toBe(true);

      const updated = store.getProposal(proposal.proposal_id);
      expect(updated?.status).toBe('rejected');
      expect(updated?.rejected_by).toBe('operator');
      expect(updated?.rejection_reason).toBe('Not applicable');
    });

    it('should update proposal status to implemented', () => {
      const proposal = createTestProposal();
      store.createProposal(proposal);

      const success = store.updateStatus(proposal.proposal_id, 'implemented', 'operator');
      expect(success).toBe(true);

      const updated = store.getProposal(proposal.proposal_id);
      expect(updated?.status).toBe('implemented');
      expect(updated?.implemented_by).toBe('operator');
    });

    it('should return false for non-existent proposal', () => {
      const success = store.updateStatus('non-existent', 'accepted', 'operator');
      expect(success).toBe(false);
    });
  });

  describe('findRecentProposals', () => {
    it('should find proposals for category within days', () => {
      const proposal = createTestProposal({ category_id: 'auto_stop_triggered' });
      store.createProposal(proposal);

      const recent = store.findRecentProposals('auto_stop_triggered', 7);
      expect(recent).toHaveLength(1);
    });

    it('should not find proposals for different category', () => {
      const proposal = createTestProposal({ category_id: 'auto_stop_triggered' });
      store.createProposal(proposal);

      const recent = store.findRecentProposals('policy_config', 7);
      expect(recent).toHaveLength(0);
    });
  });

  describe('hasSimilarProposal', () => {
    it('should return true if proposed proposal exists', () => {
      const proposal = createTestProposal({
        category_id: 'auto_stop_triggered',
        status: 'proposed',
      });
      store.createProposal(proposal);

      const has = store.hasSimilarProposal('auto_stop_triggered', 7);
      expect(has).toBe(true);
    });

    it('should return true if accepted proposal exists', () => {
      const proposal = createTestProposal({
        category_id: 'auto_stop_triggered',
        status: 'accepted',
      });
      store.createProposal(proposal);

      const has = store.hasSimilarProposal('auto_stop_triggered', 7);
      expect(has).toBe(true);
    });

    it('should return false if only rejected proposal exists', () => {
      const proposal = createTestProposal({
        category_id: 'auto_stop_triggered',
        status: 'rejected',
      });
      store.createProposal(proposal);

      const has = store.hasSimilarProposal('auto_stop_triggered', 7);
      expect(has).toBe(false);
    });

    it('should return false for different category', () => {
      const proposal = createTestProposal({
        category_id: 'auto_stop_triggered',
        status: 'proposed',
      });
      store.createProposal(proposal);

      const has = store.hasSimilarProposal('policy_config', 7);
      expect(has).toBe(false);
    });
  });

  describe('generateProposalId', () => {
    it('should generate unique IDs', () => {
      const id1 = store.generateProposalId();
      const id2 = store.generateProposalId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^FIX-\d{8}-[a-f0-9]{8}$/);
    });
  });
});
