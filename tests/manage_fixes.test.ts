/**
 * Manage Fixes CLI Tests (run_ops fixes-* commands)
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  FixProposalStore,
  FixProposal,
  createTestFixProposalStore,
  resetFixProposalStore,
  getFixProposalStore,
} from '../src/data/FixProposalStore';
import {
  FixProposalEventStore,
  createTestFixProposalEventStore,
  resetFixProposalEventStore,
  getFixProposalEventStore,
} from '../src/data/FixProposalEventStore';
import {
  FixProposalManager,
  createTestFixProposalManager,
  resetFixProposalManager,
  getFixProposalManager,
} from '../src/domain/FixProposalManager';

describe('manage_fixes CLI integration', () => {
  const testProposalPath = path.join('data', 'test_cli_proposals.ndjson');
  const testEventPath = path.join('data', 'test_cli_events.ndjson');
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
      title: '[自動停止発動] 自動停止原因の調査と対策',
      recommended_steps: ['Step 1', 'Step 2'],
      related_artifacts: { files: ['config/auto_stop.json'] },
      status: 'proposed',
      rationale: { incident_count: 3, recent_examples: ['INC-001', 'INC-002'] },
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

  describe('fixes-accept workflow', () => {
    it('should accept a proposal and record event', () => {
      const proposal = createTestProposal();
      proposalStore.createProposal(proposal);

      const result = manager.accept(
        proposal.proposal_id,
        'tanaka',
        'Looks good, creating JIRA ticket',
        { ticket: 'JIRA-456' }
      );

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe('accepted');
      expect(result.event?.action).toBe('ACCEPT');
      expect(result.event?.actor).toBe('tanaka');
      expect(result.event?.links?.ticket).toBe('JIRA-456');

      // Verify event is persisted
      const events = eventStore.getEventsForProposal(proposal.proposal_id);
      expect(events).toHaveLength(1);
      expect(events[0].action).toBe('ACCEPT');
    });

    it('should show correct status in list after accept', () => {
      const proposal = createTestProposal();
      proposalStore.createProposal(proposal);

      manager.accept(proposal.proposal_id, 'tanaka', 'Approved');

      const list = manager.listProposals({ status: 'accepted' });
      expect(list).toHaveLength(1);
      expect(list[0].proposal_id).toBe(proposal.proposal_id);
    });
  });

  describe('fixes-reject workflow', () => {
    it('should reject a proposal and record event', () => {
      const proposal = createTestProposal();
      proposalStore.createProposal(proposal);

      const result = manager.reject(
        proposal.proposal_id,
        'suzuki',
        'Root cause is different, not applicable'
      );

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe('rejected');
      expect(result.event?.action).toBe('REJECT');
      expect(result.event?.reason).toContain('Root cause is different');
    });

    it('should show correct status in list after reject', () => {
      const proposal = createTestProposal();
      proposalStore.createProposal(proposal);

      manager.reject(proposal.proposal_id, 'suzuki', 'Not needed');

      const list = manager.listProposals({ status: 'rejected' });
      expect(list).toHaveLength(1);
      expect(list[0].proposal_id).toBe(proposal.proposal_id);
    });
  });

  describe('fixes-implement workflow', () => {
    it('should implement an accepted proposal and record event', () => {
      const proposal = createTestProposal();
      proposalStore.createProposal(proposal);

      manager.accept(proposal.proposal_id, 'tanaka', 'Approved');

      const result = manager.implement(
        proposal.proposal_id,
        'yamada',
        'Fixed in PR #123, deployed to production',
        { pr: '#123', commit: 'abc123def' }
      );

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe('implemented');
      expect(result.event?.action).toBe('IMPLEMENT');
      expect(result.event?.links?.pr).toBe('#123');
      expect(result.event?.links?.commit).toBe('abc123def');
    });

    it('should show correct status in list after implement', () => {
      const proposal = createTestProposal();
      proposalStore.createProposal(proposal);

      manager.accept(proposal.proposal_id, 'tanaka', 'Approved');
      manager.implement(proposal.proposal_id, 'yamada', 'Done');

      const list = manager.listProposals({ status: 'implemented' });
      expect(list).toHaveLength(1);
      expect(list[0].proposal_id).toBe(proposal.proposal_id);
    });

    it('should fail to implement a proposed (not accepted) proposal', () => {
      const proposal = createTestProposal();
      proposalStore.createProposal(proposal);

      const result = manager.implement(
        proposal.proposal_id,
        'yamada',
        'Trying to skip accept step'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('fixes-note workflow', () => {
    it('should add a note and record event', () => {
      const proposal = createTestProposal();
      proposalStore.createProposal(proposal);

      const result = manager.addNote(
        proposal.proposal_id,
        'tanaka',
        'Discussed in weekly ops meeting, waiting for team input'
      );

      expect(result.success).toBe(true);
      expect(result.event?.action).toBe('NOTE');
      expect(result.event?.reason).toContain('Discussed in weekly');
    });

    it('should not change status when adding note', () => {
      const proposal = createTestProposal();
      proposalStore.createProposal(proposal);

      const statusBefore = manager.getProposal(proposal.proposal_id)?.status;
      manager.addNote(proposal.proposal_id, 'tanaka', 'Some note');
      const statusAfter = manager.getProposal(proposal.proposal_id)?.status;

      expect(statusBefore).toBe('proposed');
      expect(statusAfter).toBe('proposed');
    });
  });

  describe('fixes-show with history', () => {
    it('should show full history of events', () => {
      const proposal = createTestProposal();
      proposalStore.createProposal(proposal);

      manager.addNote(proposal.proposal_id, 'tanaka', 'Initial review');
      manager.accept(proposal.proposal_id, 'tanaka', 'Approved', { ticket: 'JIRA-789' });
      manager.addNote(proposal.proposal_id, 'yamada', 'Starting implementation');
      manager.implement(proposal.proposal_id, 'yamada', 'Done', { pr: '#100' });

      const result = manager.getProposal(proposal.proposal_id);

      expect(result).not.toBeNull();
      expect(result!.status).toBe('implemented');
      expect(result!.history).toHaveLength(4);
      expect(result!.history[0].action).toBe('NOTE');
      expect(result!.history[1].action).toBe('ACCEPT');
      expect(result!.history[2].action).toBe('NOTE');
      expect(result!.history[3].action).toBe('IMPLEMENT');
    });
  });

  describe('fixes-list with events', () => {
    it('should correctly compute status from events when listing', () => {
      const p1 = createTestProposal({ title: 'Proposal 1' });
      const p2 = createTestProposal({ title: 'Proposal 2' });
      const p3 = createTestProposal({ title: 'Proposal 3' });
      const p4 = createTestProposal({ title: 'Proposal 4' });

      proposalStore.createProposal(p1);
      proposalStore.createProposal(p2);
      proposalStore.createProposal(p3);
      proposalStore.createProposal(p4);

      // p1: proposed
      // p2: accepted
      manager.accept(p2.proposal_id, 'tanaka', 'Approved');
      // p3: rejected
      manager.reject(p3.proposal_id, 'suzuki', 'Not needed');
      // p4: implemented
      manager.accept(p4.proposal_id, 'tanaka', 'Approved');
      manager.implement(p4.proposal_id, 'yamada', 'Done');

      const all = manager.listProposals();
      expect(all).toHaveLength(4);

      const statuses = new Map(all.map((p) => [p.title, p.status]));
      expect(statuses.get('Proposal 1')).toBe('proposed');
      expect(statuses.get('Proposal 2')).toBe('accepted');
      expect(statuses.get('Proposal 3')).toBe('rejected');
      expect(statuses.get('Proposal 4')).toBe('implemented');
    });
  });

  describe('full weekly workflow simulation', () => {
    it('should support the full weekly ops routine', () => {
      // Step 1: Create proposals (from propose_fixes)
      const p1 = createTestProposal({
        category_id: 'auto_stop_triggered',
        priority: 'P0',
        title: '[自動停止発動] 自動停止原因の調査と対策',
      });
      const p2 = createTestProposal({
        category_id: 'policy_config',
        priority: 'P1',
        title: '[ポリシー設定] ポリシー設定の確認と是正',
      });
      proposalStore.createProposal(p1);
      proposalStore.createProposal(p2);

      // Step 2: Weekly review - list proposed
      let proposed = manager.listProposals({ status: 'proposed' });
      expect(proposed).toHaveLength(2);

      // Step 3: Accept P0 proposal with ticket
      manager.accept(p1.proposal_id, 'ops-lead', 'High priority, creating task', {
        ticket: 'JIRA-100',
      });

      // Step 4: Reject P1 proposal with reason
      manager.reject(p2.proposal_id, 'ops-lead', 'Current config is intentional per product team');

      // Step 5: Verify list updates
      proposed = manager.listProposals({ status: 'proposed' });
      expect(proposed).toHaveLength(0);

      const accepted = manager.listProposals({ status: 'accepted' });
      expect(accepted).toHaveLength(1);

      const rejected = manager.listProposals({ status: 'rejected' });
      expect(rejected).toHaveLength(1);

      // Step 6: Implement accepted proposal
      manager.addNote(p1.proposal_id, 'dev1', 'Working on fix, ETA tomorrow');
      manager.implement(p1.proposal_id, 'dev1', 'Fixed auto-stop threshold, tested in staging', {
        pr: '#200',
        commit: 'fix123abc',
      });

      // Step 7: Verify final state
      const implemented = manager.listProposals({ status: 'implemented' });
      expect(implemented).toHaveLength(1);

      const finalState = manager.getProposal(p1.proposal_id);
      expect(finalState!.status).toBe('implemented');
      expect(finalState!.history).toHaveLength(3); // accept, note, implement
    });
  });
});
