/**
 * Fix Proposal Event Store Tests
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  FixProposalEventStore,
  FixProposalEvent,
  createTestFixProposalEventStore,
  resetFixProposalEventStore,
} from '../src/data/FixProposalEventStore';

describe('FixProposalEventStore', () => {
  const testFilePath = path.join('data', 'test_fix_proposal_events.ndjson');
  let store: FixProposalEventStore;

  beforeEach(() => {
    resetFixProposalEventStore();

    // Clean up test file
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }

    store = createTestFixProposalEventStore(testFilePath);
  });

  afterEach(() => {
    // Clean up test file
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  });

  describe('createEvent', () => {
    it('should create and store an event', () => {
      const event = store.createEvent({
        proposal_id: 'FIX-20260127-abc12345',
        action: 'ACCEPT',
        actor: 'operator1',
        reason: 'Looks good, proceeding with implementation',
      });

      expect(event.event_id).toBeDefined();
      expect(event.timestamp).toBeDefined();
      expect(event.proposal_id).toBe('FIX-20260127-abc12345');
      expect(event.action).toBe('ACCEPT');
      expect(event.actor).toBe('operator1');
      expect(event.reason).toBe('Looks good, proceeding with implementation');
    });

    it('should persist events to file', () => {
      store.createEvent({
        proposal_id: 'FIX-20260127-abc12345',
        action: 'ACCEPT',
        actor: 'operator1',
        reason: 'Reason 1',
      });

      store.createEvent({
        proposal_id: 'FIX-20260127-abc12345',
        action: 'IMPLEMENT',
        actor: 'operator1',
        reason: 'Implemented in PR #123',
        links: { pr: '#123' },
      });

      // Reload from file
      const newStore = createTestFixProposalEventStore(testFilePath);
      const events = newStore.getEventsForProposal('FIX-20260127-abc12345');

      expect(events).toHaveLength(2);
      expect(events[0].action).toBe('ACCEPT');
      expect(events[1].action).toBe('IMPLEMENT');
      expect(events[1].links?.pr).toBe('#123');
    });

    it('should include links when provided', () => {
      const event = store.createEvent({
        proposal_id: 'FIX-20260127-abc12345',
        action: 'IMPLEMENT',
        actor: 'operator1',
        reason: 'Fixed in PR',
        links: {
          ticket: 'JIRA-123',
          pr: '#456',
          commit: 'abc123',
        },
      });

      expect(event.links).toBeDefined();
      expect(event.links?.ticket).toBe('JIRA-123');
      expect(event.links?.pr).toBe('#456');
      expect(event.links?.commit).toBe('abc123');
    });
  });

  describe('getEventsForProposal', () => {
    it('should return events for specific proposal', () => {
      store.createEvent({
        proposal_id: 'FIX-001',
        action: 'ACCEPT',
        actor: 'operator1',
        reason: 'Accepted',
      });

      store.createEvent({
        proposal_id: 'FIX-002',
        action: 'REJECT',
        actor: 'operator2',
        reason: 'Rejected',
      });

      store.createEvent({
        proposal_id: 'FIX-001',
        action: 'IMPLEMENT',
        actor: 'operator1',
        reason: 'Implemented',
      });

      const events = store.getEventsForProposal('FIX-001');
      expect(events).toHaveLength(2);
      expect(events[0].action).toBe('ACCEPT');
      expect(events[1].action).toBe('IMPLEMENT');
    });

    it('should return empty array for non-existent proposal', () => {
      const events = store.getEventsForProposal('FIX-NONE');
      expect(events).toHaveLength(0);
    });

    it('should return events in chronological order', () => {
      const event1 = store.createEvent({
        proposal_id: 'FIX-001',
        action: 'NOTE',
        actor: 'operator1',
        reason: 'First note',
      });

      // Tiny delay to ensure different timestamps
      const event2 = store.createEvent({
        proposal_id: 'FIX-001',
        action: 'ACCEPT',
        actor: 'operator1',
        reason: 'Accepted',
      });

      const events = store.getEventsForProposal('FIX-001');
      expect(events[0].event_id).toBe(event1.event_id);
      expect(events[1].event_id).toBe(event2.event_id);
    });
  });

  describe('getAllEvents', () => {
    it('should return all events', () => {
      store.createEvent({
        proposal_id: 'FIX-001',
        action: 'ACCEPT',
        actor: 'operator1',
        reason: 'Accepted',
      });

      store.createEvent({
        proposal_id: 'FIX-002',
        action: 'REJECT',
        actor: 'operator2',
        reason: 'Rejected',
      });

      const events = store.getAllEvents();
      expect(events).toHaveLength(2);
    });
  });

  describe('event actions', () => {
    it('should support ACCEPT action', () => {
      const event = store.createEvent({
        proposal_id: 'FIX-001',
        action: 'ACCEPT',
        actor: 'operator1',
        reason: 'Approved for implementation',
      });

      expect(event.action).toBe('ACCEPT');
    });

    it('should support REJECT action', () => {
      const event = store.createEvent({
        proposal_id: 'FIX-001',
        action: 'REJECT',
        actor: 'operator1',
        reason: 'Not applicable to current situation',
      });

      expect(event.action).toBe('REJECT');
    });

    it('should support IMPLEMENT action', () => {
      const event = store.createEvent({
        proposal_id: 'FIX-001',
        action: 'IMPLEMENT',
        actor: 'operator1',
        reason: 'Deployed to production',
      });

      expect(event.action).toBe('IMPLEMENT');
    });

    it('should support NOTE action', () => {
      const event = store.createEvent({
        proposal_id: 'FIX-001',
        action: 'NOTE',
        actor: 'operator1',
        reason: 'Discussed in weekly meeting',
      });

      expect(event.action).toBe('NOTE');
    });
  });

  describe('generateEventId', () => {
    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(store.generateEventId());
      }
      expect(ids.size).toBe(100);
    });
  });
});
