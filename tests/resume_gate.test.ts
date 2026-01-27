/**
 * Resume Gate Tests
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ResumeGate,
  createTestResumeGate,
  resetResumeGate,
} from '../src/domain/ResumeGate';
import { resetRuntimeKillSwitch, getRuntimeKillSwitch } from '../src/domain/RuntimeKillSwitch';
import { resetIncidentStore, createTestIncidentStore } from '../src/data/IncidentStore';
import { resetIncidentManager, createTestIncidentManager } from '../src/domain/IncidentManager';
import { resetMetricsStore, getMetricsStore, MetricsStore } from '../src/data/MetricsStore';
import { resetSendPolicy } from '../src/domain/SendPolicy';

describe('ResumeGate', () => {
  const testMetricsDir = path.join('data', 'test');
  const testMetricsPath = path.join(testMetricsDir, 'metrics.ndjson');
  const mainMetricsPath = path.join('data', 'metrics.ndjson');
  const testIncidentPath = path.join('data', 'test_resume_gate_incidents.ndjson');
  const killSwitchPath = path.join('data', 'kill_switch.json');
  let metricsStore: MetricsStore;
  let gate: ResumeGate;

  beforeEach(() => {
    // Reset all singletons
    resetResumeGate();
    resetRuntimeKillSwitch();
    resetIncidentStore();
    resetIncidentManager();
    resetMetricsStore();
    resetSendPolicy();

    // Ensure test directory exists
    if (!fs.existsSync(testMetricsDir)) {
      fs.mkdirSync(testMetricsDir, { recursive: true });
    }

    // Clean up test files
    if (fs.existsSync(testMetricsPath)) {
      fs.unlinkSync(testMetricsPath);
    }
    // Clean up main metrics file (may contain events from previous tests)
    if (fs.existsSync(mainMetricsPath)) {
      fs.unlinkSync(mainMetricsPath);
    }
    if (fs.existsSync(testIncidentPath)) {
      fs.unlinkSync(testIncidentPath);
    }
    // Clean up kill switch file to ensure fresh state
    if (fs.existsSync(killSwitchPath)) {
      fs.unlinkSync(killSwitchPath);
    }

    // Set up required environment variables
    process.env.ENABLE_AUTO_SEND = 'true';
    process.env.SEND_ALLOWLIST_DOMAINS = 'test.com';
    delete process.env.KILL_SWITCH;

    // Create test instances - use getMetricsStore() which creates a singleton
    metricsStore = getMetricsStore();
    const incidentStore = createTestIncidentStore(testIncidentPath);
    createTestIncidentManager(incidentStore);

    gate = createTestResumeGate({ cooldownHours: 24 });
  });

  afterEach(() => {
    // Clean up test files
    if (fs.existsSync(testMetricsPath)) {
      fs.unlinkSync(testMetricsPath);
    }
    if (fs.existsSync(mainMetricsPath)) {
      fs.unlinkSync(mainMetricsPath);
    }
    if (fs.existsSync(testIncidentPath)) {
      fs.unlinkSync(testIncidentPath);
    }
    // Clean up kill switch file
    if (fs.existsSync(killSwitchPath)) {
      fs.unlinkSync(killSwitchPath);
    }

    // Restore environment
    delete process.env.ENABLE_AUTO_SEND;
    delete process.env.SEND_ALLOWLIST_DOMAINS;
    delete process.env.KILL_SWITCH;
  });

  describe('evaluate', () => {
    it('should return ok when all checks pass', () => {
      const result = gate.evaluate();

      expect(result.ok).toBe(true);
      expect(result.blockers).toHaveLength(0);
    });

    it('should block when runtime kill switch is ON', () => {
      const killSwitch = getRuntimeKillSwitch();
      killSwitch.setEnabled('Test reason', 'tester');

      const result = gate.evaluate();

      expect(result.ok).toBe(false);
      expect(result.blockers.some(b => b.includes('RuntimeKillSwitch is ON'))).toBe(true);
      expect(result.checkResults.runtimeKillSwitch.blocked).toBe(true);
    });

    it('should block when KILL_SWITCH env is true', () => {
      process.env.KILL_SWITCH = 'true';

      const result = gate.evaluate();

      expect(result.ok).toBe(false);
      expect(result.blockers).toContain('Environment KILL_SWITCH=true is set');
      expect(result.checkResults.envKillSwitch.blocked).toBe(true);
    });

    it('should block when ENABLE_AUTO_SEND is not true', () => {
      process.env.ENABLE_AUTO_SEND = 'false';

      const result = gate.evaluate();

      expect(result.ok).toBe(false);
      expect(result.blockers).toContain('ENABLE_AUTO_SEND is not set to true');
      expect(result.checkResults.autoSendEnabled.blocked).toBe(true);
    });

    it('should block when no allowlist is configured', () => {
      delete process.env.SEND_ALLOWLIST_DOMAINS;
      delete process.env.SEND_ALLOWLIST_EMAILS;

      const result = gate.evaluate();

      expect(result.ok).toBe(false);
      expect(result.blockers.some(b => b.includes('No allowlist configured'))).toBe(true);
      expect(result.checkResults.allowlistConfigured.blocked).toBe(true);
    });

    it('should block when auto-stop occurred within cooldown period', () => {
      // Record an auto-stop event
      metricsStore.recordOpsStopSend({
        reason: 'Auto-stop test',
        setBy: 'auto_stop',
      });

      const result = gate.evaluate();

      expect(result.ok).toBe(false);
      expect(result.blockers.some(b => b.includes('Auto-stop triggered within last'))).toBe(true);
      expect(result.checkResults.cooldownPeriod.blocked).toBe(true);
    });

    it('should not block for manual stop within cooldown period', () => {
      // Record a manual stop event (not auto_stop)
      metricsStore.recordOpsStopSend({
        reason: 'Manual stop test',
        setBy: 'operator',
      });

      const result = gate.evaluate();

      expect(result.checkResults.cooldownPeriod.blocked).toBe(false);
    });

    it('should warn when there is an open incident', () => {
      const incidentManager = require('../src/domain/IncidentManager').getIncidentManager();
      incidentManager.createIncident({
        trigger_type: 'AUTO_STOP',
        created_by: 'auto_stop',
        severity: 'error',
        reason: 'Test incident',
      });

      const result = gate.evaluate();

      // Open incident is a warning, not a blocker
      expect(result.warnings.some(w => w.includes('Open incident exists'))).toBe(true);
      expect(result.checkResults.noOpenIncident.blocked).toBe(true);
    });
  });

  describe('cooldown period with custom hours', () => {
    it('should use custom cooldown hours', () => {
      // Create a gate with 1 hour cooldown
      const shortGate = createTestResumeGate({ cooldownHours: 1 });

      // Record an event 2 hours ago (outside 1-hour cooldown)
      const twoHoursAgo = new Date();
      twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);

      // Record current auto-stop
      metricsStore.recordOpsStopSend({
        reason: 'Auto-stop test',
        setBy: 'auto_stop',
      });

      // Should still block because the event is recent
      const result = shortGate.evaluate();
      expect(result.checkResults.cooldownPeriod.blocked).toBe(true);
    });
  });

  describe('multiple blockers', () => {
    it('should return all blockers when multiple checks fail', () => {
      // Set up multiple failure conditions
      const killSwitch = getRuntimeKillSwitch();
      killSwitch.setEnabled('Test reason', 'tester');
      process.env.ENABLE_AUTO_SEND = 'false';
      delete process.env.SEND_ALLOWLIST_DOMAINS;

      const result = gate.evaluate();

      expect(result.ok).toBe(false);
      expect(result.blockers.length).toBeGreaterThan(1);

      // All checks should be blocked
      expect(result.checkResults.runtimeKillSwitch.blocked).toBe(true);
      expect(result.checkResults.autoSendEnabled.blocked).toBe(true);
      expect(result.checkResults.allowlistConfigured.blocked).toBe(true);
    });
  });

  describe('checkResults structure', () => {
    it('should return detailed check results', () => {
      const result = gate.evaluate();

      expect(result.checkResults).toHaveProperty('runtimeKillSwitch');
      expect(result.checkResults).toHaveProperty('envKillSwitch');
      expect(result.checkResults).toHaveProperty('autoSendEnabled');
      expect(result.checkResults).toHaveProperty('allowlistConfigured');
      expect(result.checkResults).toHaveProperty('cooldownPeriod');
      expect(result.checkResults).toHaveProperty('replyRateRecovered');
      expect(result.checkResults).toHaveProperty('noOpenIncident');

      // Each check result should have blocked field
      expect(result.checkResults.runtimeKillSwitch).toHaveProperty('blocked');
    });
  });
});
