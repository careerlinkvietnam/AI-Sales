/**
 * Fix Proposal Manager Tests
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  FixProposalManager,
  createTestFixProposalManager,
  resetFixProposalManager,
} from '../src/domain/FixProposalManager';
import {
  FixProposalStore,
  FixProposal,
  createTestFixProposalStore,
  resetFixProposalStore,
} from '../src/data/FixProposalStore';
import {
  FixProposalEventStore,
  createTestFixProposalEventStore,
  resetFixProposalEventStore,
} from '../src/data/FixProposalEventStore';

describe('FixProposalManager', () => {
  const testProposalPath = path.join('data', 'test_manager_proposals.ndjson');
  const testEventPath = path.join('data', 'test_manager_events.ndjson');
  let proposalStore: FixProposalStore;
  let eventStore: FixProposalEventStore;
  let manager: FixProposalManager;

  const createTestProposal = (overrides?: Partial<FixProposal>): FixProposal => {
    const now = new Date().toISOString();
    return {
      proposal_id: proposalStore.generateProposalId(),
      created_at: now,
      created_by: 'auto',
      source: { report_since: '2026-01-20', top_categories: ['auto_stop_triggered'] },
      category_id: 'auto_stop_triggered',
      priority: 'P0',
      title: 'Test Proposal',
      recommended_steps: ['Step 1', 'Step 2'],
      related_artifacts: { files: ['config/test.json'] },
      status: 'proposed',
      rationale: { incident_count: 3 },
      updated_at: now,
      ...overrides,
    };
  };

  beforeEach(() => {
    resetFixProposalStore();
    resetFixProposalEventStore();
    resetFixProposalManager();

    // Clean up test files
    if (fs.existsSync(testProposalPath)) fs.unlinkSync(testProposalPath);
    if (fs.existsSync(testEventPath)) fs.unlinkSync(testEventPath);

    proposalStore = createTestFixProposalStore(testProposalPath);
    eventStore = createTestFixProposalEventStore(testEventPath);
    manager = createTestFixProposalManager({ proposalStore, eventStore });
  });

  afterEach(() => {
    // Clean up test files
    if (fs.existsSync(testProposalPath)) fs.unlinkSync(testProposalPath);
    if (fs.existsSync(testEventPath)) fs.unlinkSync(testEventPath);
  });

  describe('status computation', () => {
    it('should return proposed status for new proposals', () => {
      const proposal = createTestProposal();
      proposalStore.createProposal(proposal);

      const result = manager.getProposal(proposal.proposal_id);
      expect(result).not.toBeNull();
      expect(result!.status).toBe('proposed');
    });

    it('should return accepted status after ACCEPT event', () => {
      const proposal = createTestProposal();
      proposalStore.createProposal(proposal);

      manager.accept(proposal.proposal_id, 'operator1', 'Approved');

      const result = manager.getProposal(proposal.proposal_id);
      expect(result!.status).toBe('accepted');
    });

    it('should return rejected status after REJECT event', () => {
      const proposal = createTestProposal();
      proposalStore.createProposal(proposal);

      manager.reject(proposal.proposal_id, 'operator1', 'Not applicable');

      const result = manager.getProposal(proposal.proposal_id);
      expect(result!.status).toBe('rejected');
    });

    it('should return implemented status after ACCEPT then IMPLEMENT events', () => {
      const proposal = createTestProposal();
      proposalStore.createProposal(proposal);

      manager.accept(proposal.proposal_id, 'operator1', 'Approved');
      manager.implement(proposal.proposal_id, 'operator1', 'Done');

      const result = manager.getProposal(proposal.proposal_id);
      expect(result!.status).toBe('implemented');
    });

    it('should not change status on NOTE event', () => {
      const proposal = createTestProposal();
      proposalStore.createProposal(proposal);

      manager.addNote(proposal.proposal_id, 'operator1', 'Some note');

      const result = manager.getProposal(proposal.proposal_id);
      expect(result!.status).toBe('proposed');
    });
  });

  describe('invalid transitions', () => {
    it('should reject ACCEPT on rejected proposal', () => {
      const proposal = createTestProposal();
      proposalStore.createProposal(proposal);
      manager.reject(proposal.proposal_id, 'operator1', 'Not applicable');

      const result = manager.accept(proposal.proposal_id, 'operator2', 'Actually ok');
      expect(result.success).toBe(false);
      expect(result.error).toContain('却下済み');
    });

    it('should reject IMPLEMENT on rejected proposal', () => {
      const proposal = createTestProposal();
      proposalStore.createProposal(proposal);
      manager.reject(proposal.proposal_id, 'operator1', 'Not applicable');

      const result = manager.implement(proposal.proposal_id, 'operator2', 'Done anyway');
      expect(result.success).toBe(false);
      expect(result.error).toContain('却下済み');
    });

    it('should reject ACCEPT on implemented proposal', () => {
      const proposal = createTestProposal();
      proposalStore.createProposal(proposal);
      manager.accept(proposal.proposal_id, 'operator1', 'Approved');
      manager.implement(proposal.proposal_id, 'operator1', 'Done');

      const result = manager.accept(proposal.proposal_id, 'operator2', 'Accept again');
      expect(result.success).toBe(false);
      expect(result.error).toContain('実装済み');
    });

    it('should reject REJECT on implemented proposal', () => {
      const proposal = createTestProposal();
      proposalStore.createProposal(proposal);
      manager.accept(proposal.proposal_id, 'operator1', 'Approved');
      manager.implement(proposal.proposal_id, 'operator1', 'Done');

      const result = manager.reject(proposal.proposal_id, 'operator2', 'Reject after implement');
      expect(result.success).toBe(false);
      expect(result.error).toContain('実装済み');
    });

    it('should reject REJECT on accepted proposal', () => {
      const proposal = createTestProposal();
      proposalStore.createProposal(proposal);
      manager.accept(proposal.proposal_id, 'operator1', 'Approved');

      const result = manager.reject(proposal.proposal_id, 'operator2', 'Changed mind');
      expect(result.success).toBe(false);
      expect(result.error).toContain('承認済み');
    });

    it('should reject IMPLEMENT on proposed (not accepted) proposal', () => {
      const proposal = createTestProposal();
      proposalStore.createProposal(proposal);

      const result = manager.implement(proposal.proposal_id, 'operator1', 'Skip accept');
      expect(result.success).toBe(false);
      expect(result.error).toContain('承認されていない');
    });
  });

  describe('valid transitions', () => {
    it('should allow NOTE on any status', () => {
      const proposal = createTestProposal();
      proposalStore.createProposal(proposal);

      // Note on proposed
      let result = manager.addNote(proposal.proposal_id, 'operator1', 'Note 1');
      expect(result.success).toBe(true);

      // Accept, then note
      manager.accept(proposal.proposal_id, 'operator1', 'Approved');
      result = manager.addNote(proposal.proposal_id, 'operator1', 'Note 2');
      expect(result.success).toBe(true);

      // Implement, then note
      manager.implement(proposal.proposal_id, 'operator1', 'Done');
      result = manager.addNote(proposal.proposal_id, 'operator1', 'Note 3');
      expect(result.success).toBe(true);
    });

    it('should allow NOTE on rejected proposal', () => {
      const proposal = createTestProposal();
      proposalStore.createProposal(proposal);
      manager.reject(proposal.proposal_id, 'operator1', 'Not applicable');

      const result = manager.addNote(proposal.proposal_id, 'operator2', 'For the record');
      expect(result.success).toBe(true);
    });
  });

  describe('listProposals', () => {
    it('should list all proposals with computed status', () => {
      const p1 = createTestProposal({ title: 'Proposal 1' });
      const p2 = createTestProposal({ title: 'Proposal 2' });
      const p3 = createTestProposal({ title: 'Proposal 3' });
      proposalStore.createProposal(p1);
      proposalStore.createProposal(p2);
      proposalStore.createProposal(p3);

      manager.accept(p1.proposal_id, 'operator1', 'Approved');
      manager.reject(p2.proposal_id, 'operator1', 'Not needed');

      const all = manager.listProposals();
      expect(all).toHaveLength(3);

      const p1Summary = all.find((p) => p.proposal_id === p1.proposal_id);
      const p2Summary = all.find((p) => p.proposal_id === p2.proposal_id);
      const p3Summary = all.find((p) => p.proposal_id === p3.proposal_id);

      expect(p1Summary!.status).toBe('accepted');
      expect(p2Summary!.status).toBe('rejected');
      expect(p3Summary!.status).toBe('proposed');
    });

    it('should filter by status', () => {
      const p1 = createTestProposal({ title: 'Proposal 1' });
      const p2 = createTestProposal({ title: 'Proposal 2' });
      const p3 = createTestProposal({ title: 'Proposal 3' });
      proposalStore.createProposal(p1);
      proposalStore.createProposal(p2);
      proposalStore.createProposal(p3);

      manager.accept(p1.proposal_id, 'operator1', 'Approved');
      manager.reject(p2.proposal_id, 'operator1', 'Not needed');

      const proposed = manager.listProposals({ status: 'proposed' });
      expect(proposed).toHaveLength(1);
      expect(proposed[0].proposal_id).toBe(p3.proposal_id);

      const accepted = manager.listProposals({ status: 'accepted' });
      expect(accepted).toHaveLength(1);
      expect(accepted[0].proposal_id).toBe(p1.proposal_id);

      const rejected = manager.listProposals({ status: 'rejected' });
      expect(rejected).toHaveLength(1);
      expect(rejected[0].proposal_id).toBe(p2.proposal_id);
    });
  });

  describe('getProposal', () => {
    it('should return null for non-existent proposal', () => {
      const result = manager.getProposal('FIX-NONEXISTENT');
      expect(result).toBeNull();
    });

    it('should include history in result', () => {
      const proposal = createTestProposal();
      proposalStore.createProposal(proposal);

      manager.addNote(proposal.proposal_id, 'operator1', 'Note 1');
      manager.accept(proposal.proposal_id, 'operator1', 'Approved');
      manager.addNote(proposal.proposal_id, 'operator1', 'Note 2');

      const result = manager.getProposal(proposal.proposal_id);
      expect(result!.history).toHaveLength(3);
      expect(result!.history[0].action).toBe('NOTE');
      expect(result!.history[1].action).toBe('ACCEPT');
      expect(result!.history[2].action).toBe('NOTE');
    });
  });

  describe('event links', () => {
    it('should store links with accept event', () => {
      const proposal = createTestProposal();
      proposalStore.createProposal(proposal);

      manager.accept(proposal.proposal_id, 'operator1', 'Approved', {
        ticket: 'JIRA-123',
      });

      const result = manager.getProposal(proposal.proposal_id);
      expect(result!.history[0].links?.ticket).toBe('JIRA-123');
    });

    it('should store links with implement event', () => {
      const proposal = createTestProposal();
      proposalStore.createProposal(proposal);

      manager.accept(proposal.proposal_id, 'operator1', 'Approved');
      manager.implement(proposal.proposal_id, 'operator1', 'Done', {
        pr: '#456',
        commit: 'abc123',
      });

      const result = manager.getProposal(proposal.proposal_id);
      const implementEvent = result!.history.find((e) => e.action === 'IMPLEMENT');
      expect(implementEvent!.links?.pr).toBe('#456');
      expect(implementEvent!.links?.commit).toBe('abc123');
    });
  });

  describe('addEvent error handling', () => {
    it('should return error for non-existent proposal', () => {
      const result = manager.accept('FIX-NONEXISTENT', 'operator1', 'Approved');
      expect(result.success).toBe(false);
      expect(result.error).toContain('見つかりません');
    });
  });

  describe('convenience methods', () => {
    it('getProposedProposals should return only proposed', () => {
      const p1 = createTestProposal({ title: 'Proposal 1' });
      const p2 = createTestProposal({ title: 'Proposal 2' });
      proposalStore.createProposal(p1);
      proposalStore.createProposal(p2);

      manager.accept(p1.proposal_id, 'operator1', 'Approved');

      const proposed = manager.getProposedProposals();
      expect(proposed).toHaveLength(1);
      expect(proposed[0].proposal_id).toBe(p2.proposal_id);
    });

    it('getAcceptedProposals should return only accepted', () => {
      const p1 = createTestProposal({ title: 'Proposal 1' });
      const p2 = createTestProposal({ title: 'Proposal 2' });
      proposalStore.createProposal(p1);
      proposalStore.createProposal(p2);

      manager.accept(p1.proposal_id, 'operator1', 'Approved');

      const accepted = manager.getAcceptedProposals();
      expect(accepted).toHaveLength(1);
      expect(accepted[0].proposal_id).toBe(p1.proposal_id);
    });
  });
});
