/**
 * Propose Fixes CLI Tests
 */

import * as fs from 'fs';
import * as path from 'path';
import { proposeFixes, ProposeFixesResult } from '../src/cli/propose_fixes';
import { resetFixProposalStore, getFixProposalStore } from '../src/data/FixProposalStore';
import { resetIncidentStore, getIncidentStore, Incident, IncidentSnapshot } from '../src/data/IncidentStore';
import { resetRootCauseClassifier } from '../src/domain/RootCauseClassifier';
import { resetFixProposalGenerator } from '../src/domain/FixProposalGenerator';

describe('propose_fixes', () => {
  const defaultIncidentPath = path.join('data', 'incidents.ndjson');
  const defaultProposalPath = path.join('data', 'fix_proposals.ndjson');

  beforeEach(() => {
    // Reset all singletons
    resetIncidentStore();
    resetFixProposalStore();
    resetRootCauseClassifier();
    resetFixProposalGenerator();

    // Clean up files
    if (fs.existsSync(defaultIncidentPath)) {
      fs.unlinkSync(defaultIncidentPath);
    }
    if (fs.existsSync(defaultProposalPath)) {
      fs.unlinkSync(defaultProposalPath);
    }
  });

  afterEach(() => {
    // Clean up files
    if (fs.existsSync(defaultIncidentPath)) {
      fs.unlinkSync(defaultIncidentPath);
    }
    if (fs.existsSync(defaultProposalPath)) {
      fs.unlinkSync(defaultProposalPath);
    }
  });

  const createTestIncident = (overrides?: Partial<Incident>): Incident => {
    const store = getIncidentStore();
    const now = new Date().toISOString();
    const snapshot: IncidentSnapshot = {
      window_days: 3,
      sent: 100,
      replies: 1,
      reply_rate: 0.01,
      blocked: 5,
      blocked_rate: 0.05,
      ramp_cap_today: 10,
      kill_switch_state: { env: false, runtime: true },
      active_templates: ['tpl-1'],
    };

    return {
      incident_id: `INC-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      created_at: now,
      created_by: 'auto_stop',
      trigger_type: 'AUTO_STOP',
      severity: 'error',
      status: 'open',
      reason: 'Reply rate too low: 1.0%',
      snapshot,
      actions_taken: [
        { timestamp: now, action: 'runtime_kill_switch_enabled', actor: 'auto_stop' },
      ],
      notes: [],
      updated_at: now,
      ...overrides,
    };
  };

  describe('proposeFixes', () => {
    it('should return empty proposals when no incidents', () => {
      const result = proposeFixes({});

      expect(result.total_incidents).toBe(0);
      expect(result.proposals_generated).toBe(0);
      expect(result.proposals).toHaveLength(0);
    });

    it('should generate proposals for incidents', () => {
      const store = getIncidentStore();
      store.createIncident(createTestIncident());
      store.createIncident(createTestIncident());

      const result = proposeFixes({});

      expect(result.total_incidents).toBe(2);
      expect(result.proposals_generated).toBeGreaterThan(0);
    });

    it('should not save in dry-run mode', () => {
      const store = getIncidentStore();
      store.createIncident(createTestIncident());

      const result = proposeFixes({ dryRun: true });

      expect(result.dry_run).toBe(true);
      expect(result.proposals_generated).toBeGreaterThan(0);

      // Verify not saved
      const proposalStore = getFixProposalStore();
      const saved = proposalStore.listProposals();
      expect(saved).toHaveLength(0);
    });

    it('should save proposals when not dry-run', () => {
      const store = getIncidentStore();
      store.createIncident(createTestIncident());

      const result = proposeFixes({ dryRun: false });

      expect(result.dry_run).toBe(false);

      // Verify saved
      const proposalStore = getFixProposalStore();
      const saved = proposalStore.listProposals();
      expect(saved.length).toBe(result.proposals_generated);
    });

    it('should respect top parameter', () => {
      const store = getIncidentStore();

      // Create incidents for multiple categories
      store.createIncident(createTestIncident({
        trigger_type: 'AUTO_STOP',
        reason: 'Reply rate too low',
      }));
      store.createIncident(createTestIncident({
        trigger_type: 'OPS_STOP_SEND',
        reason: 'Manual stop - no allowlist',
      }));

      const result = proposeFixes({ top: 1, dryRun: true });

      // Should only generate for top 1 category
      expect(result.proposals_generated).toBeLessThanOrEqual(1);
    });

    it('should filter by since date', () => {
      const store = getIncidentStore();

      // Create old incident
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10);
      store.createIncident(createTestIncident({
        created_at: oldDate.toISOString(),
        updated_at: oldDate.toISOString(),
      }));

      // Create recent incident
      store.createIncident(createTestIncident());

      // With since 3 days ago
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const result = proposeFixes({
        since: threeDaysAgo.toISOString().split('T')[0],
        dryRun: true,
      });

      expect(result.total_incidents).toBe(1);
    });

    it('should include period in result', () => {
      const result = proposeFixes({});

      expect(result.period).toBeDefined();
      expect(result.period.start).toBeDefined();
      expect(result.period.end).toBeDefined();
    });

    it('should classify proposals by category', () => {
      const store = getIncidentStore();

      // Create AUTO_STOP incident
      store.createIncident(createTestIncident({
        trigger_type: 'AUTO_STOP',
        reason: 'Reply rate too low',
      }));

      const result = proposeFixes({ dryRun: true });

      if (result.proposals.length > 0) {
        expect(result.proposals[0].category_id).toBe('auto_stop_triggered');
      }
    });
  });

  describe('proposal content', () => {
    it('should include recommended steps', () => {
      const store = getIncidentStore();
      store.createIncident(createTestIncident());

      const result = proposeFixes({ dryRun: true });

      if (result.proposals.length > 0) {
        expect(result.proposals[0].recommended_steps.length).toBeGreaterThan(0);
      }
    });

    it('should include related artifacts', () => {
      const store = getIncidentStore();
      store.createIncident(createTestIncident());

      const result = proposeFixes({ dryRun: true });

      if (result.proposals.length > 0) {
        expect(result.proposals[0].related_artifacts).toBeDefined();
      }
    });

    it('should include rationale with incident count', () => {
      const store = getIncidentStore();
      store.createIncident(createTestIncident());
      store.createIncident(createTestIncident());

      const result = proposeFixes({ dryRun: true });

      if (result.proposals.length > 0) {
        expect(result.proposals[0].rationale.incident_count).toBeGreaterThanOrEqual(2);
      }
    });
  });
});
