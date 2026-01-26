/**
 * rollback_experiment CLI Tests
 */

import * as fs from 'fs';
import * as path from 'path';
import { rollbackExperiment } from '../src/cli/rollback_experiment';
import { resetRuntimeKillSwitch, getRuntimeKillSwitch } from '../src/domain/RuntimeKillSwitch';
import { resetMetricsStore } from '../src/data/MetricsStore';

describe('rollback_experiment CLI', () => {
  const testDir = path.join(__dirname, 'tmp_rollback_test');
  const experimentsPath = path.join(testDir, 'experiments.json');
  const killSwitchPath = path.join(testDir, 'kill_switch.json');
  const metricsPath = path.join(testDir, 'metrics.ndjson');
  const backupsDir = path.join('data', 'backups');
  const configExperimentsPath = path.join(process.cwd(), 'config', 'experiments.json');
  let originalExperiments: string;

  const sampleExperiments = {
    experiments: [
      {
        experimentId: 'exp-test-001',
        name: 'Test Experiment',
        description: 'Test',
        startDate: '2026-01-01',
        endDate: null,
        primaryMetric: 'reply_rate',
        minSentPerVariant: 50,
        status: 'running',
        decisionRule: { alpha: 0.05, minLift: 0.02 },
        templates: [
          { templateId: 'tpl-a', variant: 'A', status: 'active' },
          { templateId: 'tpl-b', variant: 'B', status: 'active' },
        ],
      },
      {
        experimentId: 'exp-test-002',
        name: 'Another Experiment',
        status: 'paused',
        startDate: '2026-01-01',
        endDate: null,
        primaryMetric: 'reply_rate',
        minSentPerVariant: 50,
        decisionRule: { alpha: 0.05, minLift: 0.02 },
        templates: [],
      },
    ],
  };

  beforeEach(() => {
    // Create test directory
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    // Save original experiments.json
    if (fs.existsSync(configExperimentsPath)) {
      originalExperiments = fs.readFileSync(configExperimentsPath, 'utf-8');
    }

    // Create experiments.json in config directory
    const configDir = path.join(process.cwd(), 'config');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(
      configExperimentsPath,
      JSON.stringify(sampleExperiments, null, 2)
    );

    // Set up environment
    process.env.METRICS_STORE_PATH = metricsPath;
    fs.writeFileSync(metricsPath, '');

    // Reset singletons
    resetRuntimeKillSwitch();
    resetMetricsStore();

    // Clean up kill switch
    if (fs.existsSync(path.join('data', 'kill_switch.json'))) {
      fs.unlinkSync(path.join('data', 'kill_switch.json'));
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    delete process.env.METRICS_STORE_PATH;
    resetRuntimeKillSwitch();
    resetMetricsStore();

    // Restore original experiments.json
    if (originalExperiments) {
      fs.writeFileSync(configExperimentsPath, originalExperiments);
    }

    // Clean up backups
    if (fs.existsSync(backupsDir)) {
      const files = fs.readdirSync(backupsDir);
      for (const file of files) {
        if (file.startsWith('experiments_')) {
          fs.unlinkSync(path.join(backupsDir, file));
        }
      }
    }

    // Clean up kill switch
    if (fs.existsSync(path.join('data', 'kill_switch.json'))) {
      fs.unlinkSync(path.join('data', 'kill_switch.json'));
    }
  });

  describe('dry-run mode', () => {
    it('shows what would be done without making changes', () => {
      const result = rollbackExperiment({
        experimentId: 'exp-test-001',
        reason: 'testing dry run',
        setBy: 'tester',
        stopSend: false,
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe('running');
      expect(result.newStatus).toBe('paused');
      expect(result.stoppedSending).toBe(false);
      expect(result.backupPath).toBeNull();

      // Verify no changes made
      const experiments = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), 'config', 'experiments.json'), 'utf-8')
      );
      expect(experiments.experiments[0].status).toBe('running');
    });

    it('shows stopSend=true in dry run when requested', () => {
      const result = rollbackExperiment({
        experimentId: 'exp-test-001',
        reason: 'testing',
        setBy: 'tester',
        stopSend: true,
        dryRun: true,
      });

      expect(result.stoppedSending).toBe(true);

      // Kill switch should NOT be activated in dry run
      const ks = getRuntimeKillSwitch();
      expect(ks.isEnabled()).toBe(false);
    });
  });

  describe('experiment not found', () => {
    it('returns error for non-existent experiment', () => {
      const result = rollbackExperiment({
        experimentId: 'non-existent',
        reason: 'testing',
        setBy: 'tester',
        stopSend: false,
        dryRun: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('actual rollback', () => {
    it('changes experiment status to paused', () => {
      const result = rollbackExperiment({
        experimentId: 'exp-test-001',
        reason: 'reply_rate drop',
        setBy: 'operator',
        stopSend: false,
        dryRun: false,
      });

      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe('running');
      expect(result.newStatus).toBe('paused');
      expect(result.backupPath).toBeDefined();
      expect(result.backupPath).toContain('backups');

      // Verify changes made
      const experiments = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), 'config', 'experiments.json'), 'utf-8')
      );
      expect(experiments.experiments[0].status).toBe('paused');
      expect(experiments.experiments[0].endAt).toBeDefined();
      expect(experiments.experiments[0].description).toContain('ROLLBACK');
      expect(experiments.experiments[0].description).toContain('reply_rate drop');
    });

    it('creates backup file', () => {
      const result = rollbackExperiment({
        experimentId: 'exp-test-001',
        reason: 'testing',
        setBy: 'tester',
        stopSend: false,
        dryRun: false,
      });

      expect(result.success).toBe(true);
      expect(result.backupPath).toBeDefined();
      expect(fs.existsSync(result.backupPath!)).toBe(true);

      // Backup should contain original data
      const backup = JSON.parse(fs.readFileSync(result.backupPath!, 'utf-8'));
      expect(backup.experiments[0].status).toBe('running');
    });

    it('records metrics event', () => {
      rollbackExperiment({
        experimentId: 'exp-test-001',
        reason: 'metrics test',
        setBy: 'metrics-tester',
        stopSend: false,
        dryRun: false,
      });

      const metricsContent = fs.readFileSync(metricsPath, 'utf-8');
      expect(metricsContent).toContain('OPS_ROLLBACK');
      expect(metricsContent).toContain('exp-test-001');
      expect(metricsContent).toContain('metrics-tester');
    });
  });

  describe('with stop-send', () => {
    it('activates RuntimeKillSwitch when --stop-send is used', () => {
      const result = rollbackExperiment({
        experimentId: 'exp-test-001',
        reason: 'incident response',
        setBy: 'admin',
        stopSend: true,
        dryRun: false,
      });

      expect(result.success).toBe(true);
      expect(result.stoppedSending).toBe(true);

      // Kill switch should be activated
      const ks = getRuntimeKillSwitch();
      expect(ks.isEnabled()).toBe(true);

      const state = ks.getState();
      expect(state?.reason).toContain('exp-test-001');
      expect(state?.reason).toContain('incident response');
      expect(state?.set_by).toBe('admin');
    });

    it('does not activate kill switch without --stop-send', () => {
      rollbackExperiment({
        experimentId: 'exp-test-001',
        reason: 'testing',
        setBy: 'tester',
        stopSend: false,
        dryRun: false,
      });

      const ks = getRuntimeKillSwitch();
      expect(ks.isEnabled()).toBe(false);
    });
  });
});
