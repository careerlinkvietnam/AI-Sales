/**
 * Incident Store Tests
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  IncidentStore,
  createTestIncidentStore,
  resetIncidentStore,
  Incident,
  IncidentSnapshot,
} from '../src/data/IncidentStore';

describe('IncidentStore', () => {
  const testFilePath = path.join('data', 'test_incidents.ndjson');
  let store: IncidentStore;

  beforeEach(() => {
    resetIncidentStore();
    // Clean up test file
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
    store = createTestIncidentStore(testFilePath);
  });

  afterEach(() => {
    // Clean up test file
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  });

  const createTestIncident = (overrides?: Partial<Incident>): Incident => {
    const now = new Date().toISOString();
    const snapshot: IncidentSnapshot = {
      window_days: 3,
      sent: 100,
      replies: 5,
      reply_rate: 0.05,
      blocked: 10,
      blocked_rate: 0.09,
      ramp_cap_today: 10,
      kill_switch_state: { env: false, runtime: true },
      active_templates: ['tpl-1', 'tpl-2'],
    };

    return {
      incident_id: store.generateIncidentId(),
      created_at: now,
      created_by: 'auto_stop',
      trigger_type: 'AUTO_STOP',
      severity: 'error',
      status: 'open',
      reason: 'Test reason',
      snapshot,
      actions_taken: [],
      notes: [],
      updated_at: now,
      ...overrides,
    };
  };

  describe('createIncident', () => {
    it('should create a new incident', () => {
      const incident = createTestIncident();
      store.createIncident(incident);

      const retrieved = store.getIncident(incident.incident_id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.incident_id).toBe(incident.incident_id);
      expect(retrieved?.reason).toBe('Test reason');
      expect(retrieved?.status).toBe('open');
    });

    it('should persist to file', () => {
      const incident = createTestIncident();
      store.createIncident(incident);

      // Create a new store instance to verify persistence
      const newStore = createTestIncidentStore(testFilePath);
      const retrieved = newStore.getIncident(incident.incident_id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.incident_id).toBe(incident.incident_id);
    });
  });

  describe('getIncident', () => {
    it('should return null for non-existent incident', () => {
      const result = store.getIncident('non-existent-id');
      expect(result).toBeNull();
    });

    it('should return the incident if it exists', () => {
      const incident = createTestIncident();
      store.createIncident(incident);

      const result = store.getIncident(incident.incident_id);
      expect(result?.incident_id).toBe(incident.incident_id);
    });
  });

  describe('listIncidents', () => {
    it('should return empty array when no incidents', () => {
      const incidents = store.listIncidents();
      expect(incidents).toEqual([]);
    });

    it('should return all incidents', () => {
      const incident1 = createTestIncident({ status: 'open' });
      const incident2 = createTestIncident({ status: 'closed' });
      store.createIncident(incident1);
      store.createIncident(incident2);

      const incidents = store.listIncidents();
      expect(incidents).toHaveLength(2);
    });

    it('should filter by status', () => {
      const openIncident = createTestIncident({ status: 'open' });
      const closedIncident = createTestIncident({ status: 'closed' });
      store.createIncident(openIncident);
      store.createIncident(closedIncident);

      const openIncidents = store.listIncidents({ status: 'open' });
      expect(openIncidents).toHaveLength(1);
      expect(openIncidents[0].status).toBe('open');
    });

    it('should sort by created_at descending', () => {
      const older = createTestIncident({
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      });
      const newer = createTestIncident({
        created_at: '2026-01-02T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      });
      store.createIncident(older);
      store.createIncident(newer);

      const incidents = store.listIncidents();
      expect(incidents[0].created_at).toBe('2026-01-02T00:00:00Z');
      expect(incidents[1].created_at).toBe('2026-01-01T00:00:00Z');
    });
  });

  describe('findOpenIncident', () => {
    it('should return null when no open incidents', () => {
      const closed = createTestIncident({ status: 'closed' });
      store.createIncident(closed);

      const result = store.findOpenIncident();
      expect(result).toBeNull();
    });

    it('should return the most recent open incident', () => {
      const older = createTestIncident({
        status: 'open',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      });
      const newer = createTestIncident({
        status: 'open',
        created_at: '2026-01-02T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      });
      store.createIncident(older);
      store.createIncident(newer);

      const result = store.findOpenIncident();
      expect(result?.created_at).toBe('2026-01-02T00:00:00Z');
    });
  });

  describe('updateStatus', () => {
    it('should update incident status', () => {
      const incident = createTestIncident({ status: 'open' });
      store.createIncident(incident);

      const success = store.updateStatus(incident.incident_id, 'mitigated', 'operator');
      expect(success).toBe(true);

      const updated = store.getIncident(incident.incident_id);
      expect(updated?.status).toBe('mitigated');
    });

    it('should return false for non-existent incident', () => {
      const success = store.updateStatus('non-existent', 'closed', 'operator');
      expect(success).toBe(false);
    });

    it('should set closed fields when closing', () => {
      const incident = createTestIncident({ status: 'open' });
      store.createIncident(incident);

      store.updateStatus(incident.incident_id, 'closed', 'operator', 'Issue resolved');

      const updated = store.getIncident(incident.incident_id);
      expect(updated?.status).toBe('closed');
      expect(updated?.closed_by).toBe('operator');
      expect(updated?.close_reason).toBe('Issue resolved');
      expect(updated?.closed_at).toBeDefined();
    });
  });

  describe('addNote', () => {
    it('should add a note to an incident', () => {
      const incident = createTestIncident();
      store.createIncident(incident);

      const success = store.addNote(incident.incident_id, 'Test note', 'tester');
      expect(success).toBe(true);

      const updated = store.getIncident(incident.incident_id);
      expect(updated?.notes).toHaveLength(1);
      expect(updated?.notes[0].note).toBe('Test note');
      expect(updated?.notes[0].actor).toBe('tester');
    });

    it('should return false for non-existent incident', () => {
      const success = store.addNote('non-existent', 'Test note', 'tester');
      expect(success).toBe(false);
    });
  });

  describe('addAction', () => {
    it('should add an action to an incident', () => {
      const incident = createTestIncident();
      store.createIncident(incident);

      const success = store.addAction(incident.incident_id, 'kill_switch_disabled', 'operator');
      expect(success).toBe(true);

      const updated = store.getIncident(incident.incident_id);
      expect(updated?.actions_taken).toHaveLength(1);
      expect(updated?.actions_taken[0].action).toBe('kill_switch_disabled');
      expect(updated?.actions_taken[0].actor).toBe('operator');
    });
  });

  describe('append-only integrity', () => {
    it('should handle concurrent appends (simulated)', () => {
      // Create two stores pointing to the same file
      const store1 = createTestIncidentStore(testFilePath);
      const store2 = createTestIncidentStore(testFilePath);

      const incident1 = createTestIncident();
      const incident2 = createTestIncident();

      store1.createIncident(incident1);
      store2.createIncident(incident2);

      // Both incidents should be readable
      const newStore = createTestIncidentStore(testFilePath);
      const incidents = newStore.listIncidents();
      expect(incidents).toHaveLength(2);
    });
  });
});
