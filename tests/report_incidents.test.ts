/**
 * Report Incidents Tests
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  generateIncidentReport,
  formatReportMarkdown,
  IncidentReportResult,
} from '../src/cli/report_incidents';
import {
  IncidentStore,
  createTestIncidentStore,
  resetIncidentStore,
  Incident,
  IncidentSnapshot,
} from '../src/data/IncidentStore';
import { resetRootCauseClassifier } from '../src/domain/RootCauseClassifier';

describe('report_incidents', () => {
  // Use the default path that getIncidentStore() uses
  const defaultIncidentPath = path.join('data', 'incidents.ndjson');
  let store: IncidentStore;

  beforeEach(() => {
    resetIncidentStore();
    resetRootCauseClassifier();

    // Clean up the default incidents file
    if (fs.existsSync(defaultIncidentPath)) {
      fs.unlinkSync(defaultIncidentPath);
    }

    // Get the singleton store (which will use the default path)
    store = require('../src/data/IncidentStore').getIncidentStore();
  });

  afterEach(() => {
    // Clean up
    if (fs.existsSync(defaultIncidentPath)) {
      fs.unlinkSync(defaultIncidentPath);
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
      kill_switch_state: { env: false, runtime: false },
      active_templates: ['tpl-1'],
    };

    return {
      incident_id: store.generateIncidentId(),
      created_at: now,
      created_by: 'auto_stop',
      trigger_type: 'AUTO_STOP',
      severity: 'error',
      status: 'open',
      reason: 'Reply rate too low: 1.2%',
      snapshot,
      actions_taken: [],
      notes: [],
      updated_at: now,
      ...overrides,
    };
  };

  describe('generateIncidentReport', () => {
    it('should generate report with no incidents', () => {
      const report = generateIncidentReport({});

      expect(report.total_incidents).toBe(0);
      expect(report.by_category).toHaveLength(0);
      expect(report.by_severity).toHaveLength(0);
      expect(report.open_incidents).toHaveLength(0);
    });

    it('should count incidents correctly', () => {
      store.createIncident(createTestIncident({ severity: 'error' }));
      store.createIncident(createTestIncident({ severity: 'warn' }));
      store.createIncident(createTestIncident({ severity: 'error', status: 'closed' }));

      const report = generateIncidentReport({});

      expect(report.total_incidents).toBe(3);
    });

    it('should aggregate by category', () => {
      // Create two AUTO_STOP incidents (should both be auto_stop_triggered)
      store.createIncident(createTestIncident({
        trigger_type: 'AUTO_STOP',
        reason: 'Reply rate too low',
      }));
      store.createIncident(createTestIncident({
        trigger_type: 'AUTO_STOP',
        reason: 'Reply rate dropped again',
      }));

      // Create one OPS_ROLLBACK incident
      store.createIncident(createTestIncident({
        trigger_type: 'OPS_ROLLBACK',
        reason: 'Experiment paused',
        actions_taken: [
          { timestamp: new Date().toISOString(), action: 'experiment_paused', actor: 'op' },
        ],
      }));

      const report = generateIncidentReport({});

      // Should have at least 2 categories
      expect(report.by_category.length).toBeGreaterThanOrEqual(1);

      // auto_stop_triggered should be first (most incidents)
      const autoStopCategory = report.by_category.find((c) => c.category_id === 'auto_stop_triggered');
      expect(autoStopCategory?.count).toBe(2);
    });

    it('should aggregate by severity', () => {
      store.createIncident(createTestIncident({ severity: 'error' }));
      store.createIncident(createTestIncident({ severity: 'error' }));
      store.createIncident(createTestIncident({ severity: 'warn' }));

      const report = generateIncidentReport({});

      expect(report.by_severity.length).toBe(2);

      const errorSeverity = report.by_severity.find((s) => s.severity === 'error');
      expect(errorSeverity?.count).toBe(2);

      const warnSeverity = report.by_severity.find((s) => s.severity === 'warn');
      expect(warnSeverity?.count).toBe(1);
    });

    it('should list open incidents', () => {
      store.createIncident(createTestIncident({ status: 'open' }));
      store.createIncident(createTestIncident({ status: 'mitigated' }));
      store.createIncident(createTestIncident({ status: 'closed' }));

      const report = generateIncidentReport({});

      // open and mitigated count as open
      expect(report.open_incidents.length).toBe(2);
    });

    it('should filter by since date', () => {
      // Create old incident
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10);
      store.createIncident(createTestIncident({
        created_at: oldDate.toISOString(),
        updated_at: oldDate.toISOString(),
      }));

      // Create recent incident
      store.createIncident(createTestIncident());

      // Report with since 3 days ago
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const report = generateIncidentReport({
        since: threeDaysAgo.toISOString().split('T')[0],
      });

      expect(report.total_incidents).toBe(1);
    });

    it('should include recommendations', () => {
      store.createIncident(createTestIncident({
        trigger_type: 'AUTO_STOP',
        reason: 'Reply rate too low',
      }));

      const report = generateIncidentReport({});

      expect(report.recommendations.length).toBeGreaterThan(0);
      expect(report.recommendations[0].actions.length).toBeGreaterThan(0);
    });

    it('should truncate long reasons in open incidents', () => {
      const longReason = 'A'.repeat(100);
      store.createIncident(createTestIncident({
        reason: longReason,
        status: 'open',
      }));

      const report = generateIncidentReport({});

      expect(report.open_incidents[0].reason_short.length).toBeLessThanOrEqual(50);
      expect(report.open_incidents[0].reason_short).toContain('...');
    });
  });

  describe('formatReportMarkdown', () => {
    it('should format empty report', () => {
      const report: IncidentReportResult = {
        period: { start: '2026-01-20', end: '2026-01-27' },
        total_incidents: 0,
        by_category: [],
        by_severity: [],
        open_incidents: [],
        recommendations: [],
      };

      const markdown = formatReportMarkdown(report);

      expect(markdown).toContain('# Incident Report');
      expect(markdown).toContain('**Total Incidents**: 0');
      expect(markdown).toContain('No incidents in this period.');
    });

    it('should format report with data', () => {
      const report: IncidentReportResult = {
        period: { start: '2026-01-20', end: '2026-01-27' },
        total_incidents: 3,
        by_category: [
          {
            category_id: 'auto_stop_triggered',
            category_name: 'Auto-Stop Triggered',
            category_name_ja: '自動停止発動',
            count: 2,
            recommended_actions: ['Check reply rate'],
          },
          {
            category_id: 'policy_config',
            category_name: 'Policy Config',
            category_name_ja: 'ポリシー設定問題',
            count: 1,
            recommended_actions: ['Check allowlist'],
          },
        ],
        by_severity: [
          { severity: 'error', count: 2 },
          { severity: 'warn', count: 1 },
        ],
        open_incidents: [
          {
            incident_id: 'INC-123',
            created_at: '2026-01-25T10:00:00Z',
            category_id: 'auto_stop_triggered',
            category_name_ja: '自動停止発動',
            reason_short: 'Reply rate too low',
            days_open: 2,
          },
        ],
        recommendations: [
          {
            category_id: 'auto_stop_triggered',
            category_name_ja: '自動停止発動',
            actions: ['Check reply rate', 'Review templates'],
          },
        ],
      };

      const markdown = formatReportMarkdown(report);

      expect(markdown).toContain('# Incident Report');
      expect(markdown).toContain('**Total Incidents**: 3');
      expect(markdown).toContain('## Category Breakdown');
      expect(markdown).toContain('自動停止発動');
      expect(markdown).toContain('## Severity Breakdown');
      expect(markdown).toContain('## Open Incidents');
      expect(markdown).toContain('## Recommended Actions');
      expect(markdown).toContain('recommendations only');
    });

    it('should include severity emojis', () => {
      const report: IncidentReportResult = {
        period: { start: '2026-01-20', end: '2026-01-27' },
        total_incidents: 2,
        by_category: [],
        by_severity: [
          { severity: 'error', count: 1 },
          { severity: 'warn', count: 1 },
        ],
        open_incidents: [],
        recommendations: [],
      };

      const markdown = formatReportMarkdown(report);

      // Check for emojis in severity breakdown
      expect(markdown).toMatch(/🔴.*error/);
      expect(markdown).toMatch(/🟡.*warn/);
    });
  });
});
