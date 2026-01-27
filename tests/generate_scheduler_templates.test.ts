/**
 * Generate Scheduler Templates Tests
 */

import * as fs from 'fs';
import * as path from 'path';
import { generateSchedulerTemplates } from '../src/cli/generate_scheduler_templates';

describe('generateSchedulerTemplates', () => {
  const testDir = path.join(__dirname, 'tmp_scheduler_templates');

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  it('creates output directory if it does not exist', () => {
    const result = generateSchedulerTemplates(testDir);

    expect(result.success).toBe(true);
    expect(fs.existsSync(testDir)).toBe(true);
  });

  it('creates systemd subdirectory', () => {
    const result = generateSchedulerTemplates(testDir);

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(testDir, 'systemd'))).toBe(true);
  });

  it('generates cron templates', () => {
    const result = generateSchedulerTemplates(testDir);

    expect(result.success).toBe(true);
    expect(result.filesGenerated).toContain('cron_daily.txt');
    expect(result.filesGenerated).toContain('cron_weekly.txt');

    // Verify files exist
    expect(fs.existsSync(path.join(testDir, 'cron_daily.txt'))).toBe(true);
    expect(fs.existsSync(path.join(testDir, 'cron_weekly.txt'))).toBe(true);
  });

  it('generates systemd service files', () => {
    const result = generateSchedulerTemplates(testDir);

    expect(result.success).toBe(true);
    expect(result.filesGenerated).toContain('systemd/ai_sales_daily.service');
    expect(result.filesGenerated).toContain('systemd/ai_sales_weekly.service');
    expect(result.filesGenerated).toContain('systemd/ai_sales_health.service');

    // Verify files exist
    expect(fs.existsSync(path.join(testDir, 'systemd', 'ai_sales_daily.service'))).toBe(true);
    expect(fs.existsSync(path.join(testDir, 'systemd', 'ai_sales_weekly.service'))).toBe(true);
    expect(fs.existsSync(path.join(testDir, 'systemd', 'ai_sales_health.service'))).toBe(true);
  });

  it('generates systemd timer files', () => {
    const result = generateSchedulerTemplates(testDir);

    expect(result.success).toBe(true);
    expect(result.filesGenerated).toContain('systemd/ai_sales_daily.timer');
    expect(result.filesGenerated).toContain('systemd/ai_sales_weekly.timer');
    expect(result.filesGenerated).toContain('systemd/ai_sales_health.timer');

    // Verify files exist
    expect(fs.existsSync(path.join(testDir, 'systemd', 'ai_sales_daily.timer'))).toBe(true);
    expect(fs.existsSync(path.join(testDir, 'systemd', 'ai_sales_weekly.timer'))).toBe(true);
    expect(fs.existsSync(path.join(testDir, 'systemd', 'ai_sales_health.timer'))).toBe(true);
  });

  it('generates install guide', () => {
    const result = generateSchedulerTemplates(testDir);

    expect(result.success).toBe(true);
    expect(result.filesGenerated).toContain('systemd/INSTALL.md');
    expect(fs.existsSync(path.join(testDir, 'systemd', 'INSTALL.md'))).toBe(true);
  });

  it('generates all expected files', () => {
    const result = generateSchedulerTemplates(testDir);

    expect(result.success).toBe(true);
    expect(result.filesGenerated.length).toBe(9);

    const expectedFiles = [
      'cron_daily.txt',
      'cron_weekly.txt',
      'systemd/ai_sales_daily.service',
      'systemd/ai_sales_daily.timer',
      'systemd/ai_sales_weekly.service',
      'systemd/ai_sales_weekly.timer',
      'systemd/ai_sales_health.service',
      'systemd/ai_sales_health.timer',
      'systemd/INSTALL.md',
    ];

    for (const file of expectedFiles) {
      expect(result.filesGenerated).toContain(file);
    }
  });

  describe('cron template content', () => {
    it('cron_daily.txt contains run_ops daily command', () => {
      generateSchedulerTemplates(testDir);

      const content = fs.readFileSync(path.join(testDir, 'cron_daily.txt'), 'utf-8');

      expect(content).toContain('run_ops.ts daily');
      expect(content).toContain('6:00');
      expect(content).toContain('--json');
    });

    it('cron_weekly.txt contains run_ops weekly command', () => {
      generateSchedulerTemplates(testDir);

      const content = fs.readFileSync(path.join(testDir, 'cron_weekly.txt'), 'utf-8');

      expect(content).toContain('run_ops.ts weekly');
      expect(content).toContain('Sunday');
      expect(content).toContain('--json');
    });
  });

  describe('systemd template content', () => {
    it('daily service contains correct ExecStart', () => {
      generateSchedulerTemplates(testDir);

      const content = fs.readFileSync(
        path.join(testDir, 'systemd', 'ai_sales_daily.service'),
        'utf-8'
      );

      expect(content).toContain('[Unit]');
      expect(content).toContain('[Service]');
      expect(content).toContain('ExecStart=');
      expect(content).toContain('run_ops.ts daily');
      expect(content).toContain('Type=oneshot');
    });

    it('daily timer contains correct OnCalendar', () => {
      generateSchedulerTemplates(testDir);

      const content = fs.readFileSync(
        path.join(testDir, 'systemd', 'ai_sales_daily.timer'),
        'utf-8'
      );

      expect(content).toContain('[Timer]');
      expect(content).toContain('OnCalendar=');
      expect(content).toContain('06:00:00');
      expect(content).toContain('Persistent=true');
    });

    it('weekly service contains correct ExecStart', () => {
      generateSchedulerTemplates(testDir);

      const content = fs.readFileSync(
        path.join(testDir, 'systemd', 'ai_sales_weekly.service'),
        'utf-8'
      );

      expect(content).toContain('run_ops.ts weekly');
    });

    it('weekly timer runs on Sunday', () => {
      generateSchedulerTemplates(testDir);

      const content = fs.readFileSync(
        path.join(testDir, 'systemd', 'ai_sales_weekly.timer'),
        'utf-8'
      );

      expect(content).toContain('Sun');
      expect(content).toContain('07:00:00');
    });

    it('health service runs health check', () => {
      generateSchedulerTemplates(testDir);

      const content = fs.readFileSync(
        path.join(testDir, 'systemd', 'ai_sales_health.service'),
        'utf-8'
      );

      expect(content).toContain('run_ops.ts health');
    });

    it('health timer runs every 4 hours', () => {
      generateSchedulerTemplates(testDir);

      const content = fs.readFileSync(
        path.join(testDir, 'systemd', 'ai_sales_health.timer'),
        'utf-8'
      );

      expect(content).toContain('00/4:00:00');
    });

    it('services include security hardening', () => {
      generateSchedulerTemplates(testDir);

      const content = fs.readFileSync(
        path.join(testDir, 'systemd', 'ai_sales_daily.service'),
        'utf-8'
      );

      expect(content).toContain('NoNewPrivileges=true');
      expect(content).toContain('ProtectSystem=strict');
      expect(content).toContain('ProtectHome=true');
      expect(content).toContain('PrivateTmp=true');
    });
  });

  describe('install guide content', () => {
    it('contains prerequisites section', () => {
      generateSchedulerTemplates(testDir);

      const content = fs.readFileSync(
        path.join(testDir, 'systemd', 'INSTALL.md'),
        'utf-8'
      );

      expect(content).toContain('Prerequisites');
      expect(content).toContain('useradd');
      expect(content).toContain('ai_sales');
    });

    it('contains installation instructions', () => {
      generateSchedulerTemplates(testDir);

      const content = fs.readFileSync(
        path.join(testDir, 'systemd', 'INSTALL.md'),
        'utf-8'
      );

      expect(content).toContain('Installation');
      expect(content).toContain('systemctl daemon-reload');
      expect(content).toContain('systemctl enable');
      expect(content).toContain('systemctl start');
    });

    it('contains verification steps', () => {
      generateSchedulerTemplates(testDir);

      const content = fs.readFileSync(
        path.join(testDir, 'systemd', 'INSTALL.md'),
        'utf-8'
      );

      expect(content).toContain('Verification');
      expect(content).toContain('list-timers');
      expect(content).toContain('journalctl');
    });

    it('contains execute mode switching instructions', () => {
      generateSchedulerTemplates(testDir);

      const content = fs.readFileSync(
        path.join(testDir, 'systemd', 'INSTALL.md'),
        'utf-8'
      );

      expect(content).toContain('Execute Mode');
      expect(content).toContain('dry-run');
    });

    it('contains troubleshooting section', () => {
      generateSchedulerTemplates(testDir);

      const content = fs.readFileSync(
        path.join(testDir, 'systemd', 'INSTALL.md'),
        'utf-8'
      );

      expect(content).toContain('Troubleshooting');
      expect(content).toContain('systemctl status');
    });
  });

  describe('result structure', () => {
    it('returns correct outputDir', () => {
      const result = generateSchedulerTemplates(testDir);

      expect(result.outputDir).toBe(testDir);
    });

    it('returns empty errors on success', () => {
      const result = generateSchedulerTemplates(testDir);

      expect(result.errors).toEqual([]);
    });

    it('works with existing directory', () => {
      fs.mkdirSync(testDir, { recursive: true });

      const result = generateSchedulerTemplates(testDir);

      expect(result.success).toBe(true);
    });
  });
});
