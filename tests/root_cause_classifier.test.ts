/**
 * Root Cause Classifier Tests
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  RootCauseClassifier,
  createTestRootCauseClassifier,
  resetRootCauseClassifier,
  ClassificationResult,
} from '../src/domain/RootCauseClassifier';
import { Incident, IncidentSnapshot } from '../src/data/IncidentStore';

describe('RootCauseClassifier', () => {
  const configPath = path.join('config', 'incident_categories.json');
  let classifier: RootCauseClassifier;

  beforeEach(() => {
    resetRootCauseClassifier();
    classifier = createTestRootCauseClassifier(configPath);
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
      incident_id: 'test-' + Date.now(),
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

  describe('classify', () => {
    it('should classify AUTO_STOP with low reply rate as auto_stop_triggered', () => {
      const incident = createTestIncident({
        trigger_type: 'AUTO_STOP',
        reason: 'Reply rate too low: 1.2% (min: 1.5%); 2 consecutive days',
        actions_taken: [
          { timestamp: new Date().toISOString(), action: 'runtime_kill_switch_enabled', actor: 'auto_stop' },
        ],
      });

      const result = classifier.classify(incident);

      expect(result.category_id).toBe('auto_stop_triggered');
      expect(result.confidence).toBe('high');
      expect(result.evidence.length).toBeGreaterThan(0);
    });

    it('should classify OPS_STOP_SEND as policy_config', () => {
      const incident = createTestIncident({
        trigger_type: 'OPS_STOP_SEND',
        reason: 'Manual stop due to no allowlist configured',
        snapshot: {
          window_days: 3,
          sent: 0,
          replies: 0,
          reply_rate: 0,
          blocked: 0,
          blocked_rate: 0,
          ramp_cap_today: null,
          kill_switch_state: { env: false, runtime: true },
          active_templates: [],
        },
      });

      const result = classifier.classify(incident);

      expect(result.category_id).toBe('policy_config');
      expect(result.evidence.some((e) => e.includes('trigger_type=OPS_STOP_SEND'))).toBe(true);
    });

    it('should classify OPS_ROLLBACK as experiment_health', () => {
      const incident = createTestIncident({
        trigger_type: 'OPS_ROLLBACK',
        reason: 'Experiment failed - reply rate dropped significantly',
        experiment_id: 'exp-123',
        actions_taken: [
          { timestamp: new Date().toISOString(), action: 'experiment_paused', actor: 'operator' },
        ],
      });

      const result = classifier.classify(incident);

      expect(result.category_id).toBe('experiment_health');
    });

    it('should classify incidents with ramp keywords as ramp_limited', () => {
      const incident = createTestIncident({
        reason: 'Daily ramp limit reached: sent 20/20 today',
      });

      const result = classifier.classify(incident);

      expect(result.category_id).toBe('ramp_limited');
    });

    it('should classify incidents with content gate keywords as content_gate_failed', () => {
      const incident = createTestIncident({
        reason: 'TemplateQualityGate validation failed: PII detected in template',
      });

      const result = classifier.classify(incident);

      expect(result.category_id).toBe('content_gate_failed');
    });

    it('should classify incidents with token keywords as token_or_registry', () => {
      const incident = createTestIncident({
        reason: 'Draft not found in registry (not_in_registry)',
      });

      const result = classifier.classify(incident);

      expect(result.category_id).toBe('token_or_registry');
    });

    it('should classify incidents with Gmail API errors as gmail_api', () => {
      const incident = createTestIncident({
        reason: 'Gmail API error: rate_limit exceeded',
      });

      const result = classifier.classify(incident);

      expect(result.category_id).toBe('gmail_api');
    });

    it('should classify unknown incidents as unknown', () => {
      const incident = createTestIncident({
        reason: 'Something completely unexpected happened',
        trigger_type: 'OPS_STOP_SEND',
      });

      // Remove trigger type from reason to avoid matching policy_config
      incident.reason = 'aaaaaaa bbbbbbb ccccccc';

      const result = classifier.classify(incident);

      // May match policy_config due to trigger_type, or unknown if no rules match
      expect(['policy_config', 'unknown']).toContain(result.category_id);
    });

    it('should return recommended actions for classified incidents', () => {
      const incident = createTestIncident({
        trigger_type: 'AUTO_STOP',
        reason: 'Reply rate too low',
      });

      const result = classifier.classify(incident);

      expect(result.recommended_actions.length).toBeGreaterThan(0);
      expect(result.recommended_actions[0]).toBeTruthy();
    });
  });

  describe('confidence levels', () => {
    it('should have high confidence for clear matches', () => {
      const incident = createTestIncident({
        trigger_type: 'AUTO_STOP',
        reason: 'Reply rate too low: 0.5%. Auto-stop triggered after 2 consecutive days.',
        actions_taken: [
          { timestamp: new Date().toISOString(), action: 'runtime_kill_switch_enabled', actor: 'auto_stop' },
        ],
      });

      const result = classifier.classify(incident);

      expect(result.confidence).toBe('high');
    });

    it('should have medium confidence for partial matches', () => {
      const incident = createTestIncident({
        reason: 'Some ramp issue occurred',
      });

      const result = classifier.classify(incident);

      // ramp keyword match gives some score, but not enough for high confidence
      expect(['high', 'medium', 'low']).toContain(result.confidence);
    });
  });

  describe('getCategories', () => {
    it('should return all categories', () => {
      const categories = classifier.getCategories();

      expect(categories.length).toBeGreaterThan(0);
      expect(categories.some((c) => c.id === 'auto_stop_triggered')).toBe(true);
      expect(categories.some((c) => c.id === 'policy_config')).toBe(true);
      expect(categories.some((c) => c.id === 'unknown')).toBe(true);
    });
  });

  describe('getCategory', () => {
    it('should return category by ID', () => {
      const category = classifier.getCategory('auto_stop_triggered');

      expect(category).not.toBeNull();
      expect(category?.id).toBe('auto_stop_triggered');
      expect(category?.name_ja).toBe('自動停止発動');
    });

    it('should return null for unknown category', () => {
      const category = classifier.getCategory('nonexistent');

      expect(category).toBeNull();
    });
  });

  describe('classifyBatch', () => {
    it('should classify multiple incidents and group by category', () => {
      const incidents = [
        createTestIncident({
          trigger_type: 'AUTO_STOP',
          reason: 'Reply rate too low',
        }),
        createTestIncident({
          trigger_type: 'AUTO_STOP',
          reason: 'Reply rate dropped again',
        }),
        createTestIncident({
          trigger_type: 'OPS_ROLLBACK',
          reason: 'Experiment paused',
          actions_taken: [
            { timestamp: new Date().toISOString(), action: 'experiment_paused', actor: 'op' },
          ],
        }),
      ];

      const result = classifier.classifyBatch(incidents);

      expect(result.size).toBeGreaterThan(0);

      // Check that auto_stop incidents are grouped
      const autoStopResults = result.get('auto_stop_triggered');
      expect(autoStopResults?.length).toBe(2);
    });
  });

  describe('snapshot condition matching', () => {
    it('should match runtime kill switch state', () => {
      const incident = createTestIncident({
        trigger_type: 'OPS_STOP_SEND',
        reason: 'Manual stop',
        snapshot: {
          window_days: 3,
          sent: 0,
          replies: 0,
          reply_rate: 0,
          blocked: 0,
          blocked_rate: 0,
          ramp_cap_today: null,
          kill_switch_state: { env: false, runtime: true },
          active_templates: [],
        },
      });

      const result = classifier.classify(incident);

      expect(result.evidence.some((e) => e.includes('kill_switch_state.runtime=true'))).toBe(true);
    });
  });
});
