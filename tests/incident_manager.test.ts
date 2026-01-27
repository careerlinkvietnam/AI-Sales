/**
 * Incident Manager Tests
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  IncidentManager,
  createTestIncidentManager,
  resetIncidentManager,
} from '../src/domain/IncidentManager';
import {
  IncidentStore,
  createTestIncidentStore,
  resetIncidentStore,
} from '../src/data/IncidentStore';

describe('IncidentManager', () => {
  const testFilePath = path.join('data', 'test_manager_incidents.ndjson');
  let store: IncidentStore;
  let manager: IncidentManager;

  beforeEach(() => {
    resetIncidentStore();
    resetIncidentManager();
    // Clean up test file
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
    store = createTestIncidentStore(testFilePath);
    manager = createTestIncidentManager(store);
  });

  afterEach(() => {
    // Clean up test file
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  });

  describe('createIncident', () => {
    it('should create a new incident with snapshot', () => {
      const incident = manager.createIncident({
        trigger_type: 'AUTO_STOP',
        created_by: 'auto_stop',
        severity: 'error',
        reason: 'Reply rate too low',
      });

      expect(incident.incident_id).toBeDefined();
      expect(incident.trigger_type).toBe('AUTO_STOP');
      expect(incident.created_by).toBe('auto_stop');
      expect(incident.severity).toBe('error');
      expect(incident.reason).toBe('Reply rate too low');
      expect(incident.status).toBe('open');
      expect(incident.snapshot).toBeDefined();
      expect(incident.snapshot.window_days).toBeDefined();
    });

    it('should include initial actions', () => {
      const incident = manager.createIncident({
        trigger_type: 'OPS_STOP_SEND',
        created_by: 'operator',
        severity: 'warn',
        reason: 'Manual stop',
        initial_actions: ['runtime_kill_switch_enabled'],
      });

      expect(incident.actions_taken).toHaveLength(1);
      expect(incident.actions_taken[0].action).toBe('runtime_kill_switch_enabled');
    });

    it('should include experiment_id when provided', () => {
      const incident = manager.createIncident({
        trigger_type: 'OPS_ROLLBACK',
        created_by: 'operator',
        severity: 'error',
        reason: 'Experiment failed',
        experiment_id: 'exp-123',
      });

      expect(incident.experiment_id).toBe('exp-123');
    });

    it('should reuse existing open incident', () => {
      // Create first incident
      const first = manager.createIncident({
        trigger_type: 'AUTO_STOP',
        created_by: 'auto_stop',
        severity: 'error',
        reason: 'First reason',
      });

      // Create second incident - should reuse the first
      const second = manager.createIncident({
        trigger_type: 'OPS_STOP_SEND',
        created_by: 'operator',
        severity: 'warn',
        reason: 'Second reason',
      });

      expect(second.incident_id).toBe(first.incident_id);

      // Check that note was added
      const retrieved = manager.getIncident(first.incident_id);
      expect(retrieved?.notes).toHaveLength(1);
      expect(retrieved?.notes[0].note).toContain('Additional trigger');
    });
  });

  describe('listIncidents', () => {
    it('should list all incidents', () => {
      manager.createIncident({
        trigger_type: 'AUTO_STOP',
        created_by: 'auto_stop',
        severity: 'error',
        reason: 'Reason 1',
      });

      // Close the first incident to allow second creation
      const incidents1 = manager.listIncidents();
      manager.updateStatus(incidents1[0].incident_id, 'closed', 'test', 'test');

      manager.createIncident({
        trigger_type: 'OPS_STOP_SEND',
        created_by: 'operator',
        severity: 'warn',
        reason: 'Reason 2',
      });

      const incidents = manager.listIncidents();
      expect(incidents).toHaveLength(2);
    });

    it('should filter by status', () => {
      manager.createIncident({
        trigger_type: 'AUTO_STOP',
        created_by: 'auto_stop',
        severity: 'error',
        reason: 'Test',
      });

      const openIncidents = manager.listIncidents({ status: 'open' });
      expect(openIncidents).toHaveLength(1);

      const closedIncidents = manager.listIncidents({ status: 'closed' });
      expect(closedIncidents).toHaveLength(0);
    });
  });

  describe('addNote', () => {
    it('should add a note to an incident', () => {
      const incident = manager.createIncident({
        trigger_type: 'AUTO_STOP',
        created_by: 'auto_stop',
        severity: 'error',
        reason: 'Test',
      });

      const success = manager.addNote(incident.incident_id, 'Investigation started', 'operator');
      expect(success).toBe(true);

      const updated = manager.getIncident(incident.incident_id);
      expect(updated?.notes).toHaveLength(1);
      expect(updated?.notes[0].note).toBe('Investigation started');
    });
  });

  describe('addAction', () => {
    it('should add an action to an incident', () => {
      const incident = manager.createIncident({
        trigger_type: 'AUTO_STOP',
        created_by: 'auto_stop',
        severity: 'error',
        reason: 'Test',
      });

      const success = manager.addAction(incident.incident_id, 'contacted_support', 'operator');
      expect(success).toBe(true);

      const updated = manager.getIncident(incident.incident_id);
      expect(updated?.actions_taken).toHaveLength(1);
    });
  });

  describe('updateStatus', () => {
    it('should update incident status', () => {
      const incident = manager.createIncident({
        trigger_type: 'AUTO_STOP',
        created_by: 'auto_stop',
        severity: 'error',
        reason: 'Test',
      });

      const success = manager.updateStatus(incident.incident_id, 'mitigated', 'operator');
      expect(success).toBe(true);

      const updated = manager.getIncident(incident.incident_id);
      expect(updated?.status).toBe('mitigated');
    });
  });

  describe('closeIncident', () => {
    it('should close an incident with reason', () => {
      const incident = manager.createIncident({
        trigger_type: 'AUTO_STOP',
        created_by: 'auto_stop',
        severity: 'error',
        reason: 'Test',
      });

      const success = manager.closeIncident(incident.incident_id, 'operator', 'Issue resolved');
      expect(success).toBe(true);

      const closed = manager.getIncident(incident.incident_id);
      expect(closed?.status).toBe('closed');
      expect(closed?.close_reason).toBe('Issue resolved');
      expect(closed?.closed_by).toBe('operator');
    });
  });

  describe('findOpenIncident', () => {
    it('should find open incident', () => {
      const incident = manager.createIncident({
        trigger_type: 'AUTO_STOP',
        created_by: 'auto_stop',
        severity: 'error',
        reason: 'Test',
      });

      const found = manager.findOpenIncident();
      expect(found?.incident_id).toBe(incident.incident_id);
    });

    it('should return null when no open incident', () => {
      const incident = manager.createIncident({
        trigger_type: 'AUTO_STOP',
        created_by: 'auto_stop',
        severity: 'error',
        reason: 'Test',
      });

      manager.closeIncident(incident.incident_id, 'operator', 'Done');

      const found = manager.findOpenIncident();
      expect(found).toBeNull();
    });
  });

  describe('hasActiveIncident', () => {
    it('should return true for open incident', () => {
      manager.createIncident({
        trigger_type: 'AUTO_STOP',
        created_by: 'auto_stop',
        severity: 'error',
        reason: 'Test',
      });

      expect(manager.hasActiveIncident()).toBe(true);
    });

    it('should return true for mitigated incident', () => {
      const incident = manager.createIncident({
        trigger_type: 'AUTO_STOP',
        created_by: 'auto_stop',
        severity: 'error',
        reason: 'Test',
      });

      manager.updateStatus(incident.incident_id, 'mitigated', 'operator');

      expect(manager.hasActiveIncident()).toBe(true);
    });

    it('should return false for only closed incidents', () => {
      const incident = manager.createIncident({
        trigger_type: 'AUTO_STOP',
        created_by: 'auto_stop',
        severity: 'error',
        reason: 'Test',
      });

      manager.closeIncident(incident.incident_id, 'operator', 'Done');

      expect(manager.hasActiveIncident()).toBe(false);
    });
  });
});
