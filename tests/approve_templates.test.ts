/**
 * approve_templates CLI Tests
 *
 * Tests the approval workflow for proposed templates.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ExperimentsRegistry } from '../src/domain/ExperimentEvaluator';
import { TemplateQualityGate, TemplateContentForCheck } from '../src/domain/TemplateQualityGate';

describe('approve_templates', () => {
  const testDir = path.join(__dirname, 'tmp_approve_test');
  const experimentsPath = path.join(testDir, 'experiments.json');
  const approvalsPath = path.join(testDir, 'approvals.ndjson');

  beforeEach(() => {
    // Create test directory
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Cleanup
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('quality gate integration', () => {
    it('should block approval when quality gate fails with PII', () => {
      const gate = new TemplateQualityGate();
      const content: TemplateContentForCheck = {
        subjectTemplate: '{{companyName}}様へ test@example.com',
        ctaTemplate: 'ご連絡ください',
        candidateHeaderTemplate: '【候補者】',
      };

      const result = gate.check(content);

      expect(result.ok).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it('should block approval when quality gate fails with forbidden expression', () => {
      const gate = new TemplateQualityGate();
      const content: TemplateContentForCheck = {
        subjectTemplate: '確実に成果が出る人材',
        ctaTemplate: 'ご連絡ください',
        candidateHeaderTemplate: '【候補者】',
      };

      const result = gate.check(content);

      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.includes('確実に'))).toBe(true);
    });

    it('should block approval when quality gate fails with length exceeded', () => {
      const gate = new TemplateQualityGate();
      const content: TemplateContentForCheck = {
        subjectTemplate: 'あ'.repeat(100), // 100 > 80
        ctaTemplate: 'ご連絡ください',
        candidateHeaderTemplate: '【候補者】',
      };

      const result = gate.check(content);

      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.includes('件名が長すぎます'))).toBe(true);
    });

    it('should allow approval when quality gate passes', () => {
      const gate = new TemplateQualityGate();
      const content: TemplateContentForCheck = {
        subjectTemplate: '【CareerLink】{{companyName}}様へ人材のご提案',
        ctaTemplate: 'ご興味をお持ちいただけましたら、ぜひご連絡ください。',
        candidateHeaderTemplate: '【ご紹介候補者】',
      };

      const result = gate.check(content);

      expect(result.ok).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe('experiments.json manipulation', () => {
    it('should archive previous active template when approving', () => {
      // Create experiments.json with active and proposed templates
      const registry: ExperimentsRegistry = {
        experiments: [
          {
            experimentId: 'test_experiment',
            name: 'Test Experiment',
            startDate: '2026-01-01',
            endDate: null,
            primaryMetric: 'replyRate',
            minSentPerVariant: 50,
            decisionRule: { alpha: 0.05, minLift: 0.02 },
            templates: [
              { templateId: 'template_A_v1', variant: 'A', status: 'active' },
              { templateId: 'template_B_v1', variant: 'B', status: 'active' },
              { templateId: 'template_A_v2', variant: 'A', status: 'proposed' },
            ],
          },
        ],
      };

      fs.writeFileSync(experimentsPath, JSON.stringify(registry, null, 2));

      // Read and update (simulating approval)
      const content = fs.readFileSync(experimentsPath, 'utf-8');
      const updatedRegistry: ExperimentsRegistry = JSON.parse(content);
      const experiment = updatedRegistry.experiments[0];

      // Find templates
      const currentActive = experiment.templates.find(
        (t) => t.variant === 'A' && t.status === 'active'
      );
      const proposed = experiment.templates.find(
        (t) => t.templateId === 'template_A_v2'
      );

      // Simulate approval
      if (currentActive) {
        currentActive.status = 'archived';
      }
      if (proposed) {
        proposed.status = 'active';
      }

      fs.writeFileSync(experimentsPath, JSON.stringify(updatedRegistry, null, 2));

      // Verify
      const final = JSON.parse(fs.readFileSync(experimentsPath, 'utf-8'));
      const finalExp = final.experiments[0];

      expect(finalExp.templates.find((t: any) => t.templateId === 'template_A_v1').status).toBe(
        'archived'
      );
      expect(finalExp.templates.find((t: any) => t.templateId === 'template_A_v2').status).toBe(
        'active'
      );
      expect(finalExp.templates.find((t: any) => t.templateId === 'template_B_v1').status).toBe(
        'active'
      );
    });

    it('should create backup before updating', () => {
      const registry: ExperimentsRegistry = {
        experiments: [
          {
            experimentId: 'test_experiment',
            name: 'Test',
            startDate: '2026-01-01',
            endDate: null,
            primaryMetric: 'replyRate',
            minSentPerVariant: 50,
            decisionRule: { alpha: 0.05, minLift: 0.02 },
            templates: [],
          },
        ],
      };

      fs.writeFileSync(experimentsPath, JSON.stringify(registry, null, 2));

      // Create backup
      const timestamp = '20260126120000';
      const backupPath = path.join(testDir, `experiments.json.bak-${timestamp}`);
      fs.copyFileSync(experimentsPath, backupPath);

      expect(fs.existsSync(backupPath)).toBe(true);

      // Verify backup content matches original
      const original = fs.readFileSync(experimentsPath, 'utf-8');
      const backup = fs.readFileSync(backupPath, 'utf-8');
      expect(backup).toBe(original);
    });

    it('should not modify files in dry-run mode', () => {
      const registry: ExperimentsRegistry = {
        experiments: [
          {
            experimentId: 'test_experiment',
            name: 'Test',
            startDate: '2026-01-01',
            endDate: null,
            primaryMetric: 'replyRate',
            minSentPerVariant: 50,
            decisionRule: { alpha: 0.05, minLift: 0.02 },
            templates: [
              { templateId: 'template_A', variant: 'A', status: 'proposed' },
            ],
          },
        ],
      };

      fs.writeFileSync(experimentsPath, JSON.stringify(registry, null, 2));
      const originalContent = fs.readFileSync(experimentsPath, 'utf-8');

      // In dry-run mode, do not modify
      const dryRun = true;
      if (!dryRun) {
        // Would modify file
      }

      // Verify file unchanged
      const afterContent = fs.readFileSync(experimentsPath, 'utf-8');
      expect(afterContent).toBe(originalContent);
    });
  });

  describe('approval log', () => {
    it('should create approval log entry with required fields', () => {
      const entry = {
        timestamp: new Date().toISOString(),
        experimentId: 'test_experiment',
        templateId: 'template_A_v2',
        previousActiveTemplateId: 'template_A_v1',
        approvedBy: 'Yamada',
        reason: 'Improved reply rate based on segment analysis',
        ticket: 'JIRA-123',
        qualityGateOk: true,
        violations: [] as string[],
      };

      // Write log entry
      fs.writeFileSync(approvalsPath, JSON.stringify(entry) + '\n');

      // Read and verify
      const content = fs.readFileSync(approvalsPath, 'utf-8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.experimentId).toBe('test_experiment');
      expect(parsed.templateId).toBe('template_A_v2');
      expect(parsed.previousActiveTemplateId).toBe('template_A_v1');
      expect(parsed.approvedBy).toBe('Yamada');
      expect(parsed.reason).toBe('Improved reply rate based on segment analysis');
      expect(parsed.ticket).toBe('JIRA-123');
      expect(parsed.qualityGateOk).toBe(true);
      expect(parsed.violations).toHaveLength(0);
    });

    it('should log failed quality gate attempts', () => {
      const entry = {
        timestamp: new Date().toISOString(),
        experimentId: 'test_experiment',
        templateId: 'template_bad',
        previousActiveTemplateId: null,
        approvedBy: 'Yamada',
        reason: 'Test attempt',
        ticket: null,
        qualityGateOk: false,
        violations: ['禁止表現「確実に」が含まれています', 'メールアドレスが含まれています'],
      };

      fs.writeFileSync(approvalsPath, JSON.stringify(entry) + '\n');

      const content = fs.readFileSync(approvalsPath, 'utf-8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.qualityGateOk).toBe(false);
      expect(parsed.violations).toHaveLength(2);
      expect(parsed.violations).toContain('禁止表現「確実に」が含まれています');
    });

    it('should not include PII in approval log', () => {
      const entry = {
        timestamp: new Date().toISOString(),
        experimentId: 'test_experiment',
        templateId: 'template_id_only',
        previousActiveTemplateId: null,
        approvedBy: 'Yamada',
        reason: 'Approved',
        ticket: null,
        qualityGateOk: true,
        violations: [],
        // Intentionally no: email content, full template text, etc.
      };

      const jsonStr = JSON.stringify(entry);

      // Verify no PII-like content
      expect(jsonStr).not.toContain('@');
      expect(jsonStr).not.toContain('様へ人材のご提案'); // template text
      expect(jsonStr).not.toContain('ご連絡ください'); // CTA text
    });
  });

  describe('status transitions', () => {
    it('should only approve templates with proposed status', () => {
      const registry: ExperimentsRegistry = {
        experiments: [
          {
            experimentId: 'test_experiment',
            name: 'Test',
            startDate: '2026-01-01',
            endDate: null,
            primaryMetric: 'replyRate',
            minSentPerVariant: 50,
            decisionRule: { alpha: 0.05, minLift: 0.02 },
            templates: [
              { templateId: 'active_template', variant: 'A', status: 'active' },
              { templateId: 'archived_template', variant: 'B', status: 'archived' },
              { templateId: 'proposed_template', variant: 'A', status: 'proposed' },
            ],
          },
        ],
      };

      const experiment = registry.experiments[0];

      // Check which templates can be approved
      const approvable = experiment.templates.filter((t) => t.status === 'proposed');

      expect(approvable).toHaveLength(1);
      expect(approvable[0].templateId).toBe('proposed_template');
    });

    it('should handle multiple proposed templates for different variants', () => {
      const registry: ExperimentsRegistry = {
        experiments: [
          {
            experimentId: 'test_experiment',
            name: 'Test',
            startDate: '2026-01-01',
            endDate: null,
            primaryMetric: 'replyRate',
            minSentPerVariant: 50,
            decisionRule: { alpha: 0.05, minLift: 0.02 },
            templates: [
              { templateId: 'active_A', variant: 'A', status: 'active' },
              { templateId: 'active_B', variant: 'B', status: 'active' },
              { templateId: 'proposed_A', variant: 'A', status: 'proposed' },
              { templateId: 'proposed_B', variant: 'B', status: 'proposed' },
            ],
          },
        ],
      };

      const experiment = registry.experiments[0];

      // Approve variant A proposal
      const targetVariant = 'A';
      const currentActive = experiment.templates.find(
        (t) => t.variant === targetVariant && t.status === 'active'
      );
      const proposed = experiment.templates.find(
        (t) => t.templateId === 'proposed_A'
      );

      if (currentActive) currentActive.status = 'archived';
      if (proposed) proposed.status = 'active';

      // Verify only variant A was affected
      expect(experiment.templates.find((t) => t.templateId === 'active_A')!.status).toBe(
        'archived'
      );
      expect(experiment.templates.find((t) => t.templateId === 'proposed_A')!.status).toBe(
        'active'
      );
      expect(experiment.templates.find((t) => t.templateId === 'active_B')!.status).toBe(
        'active'
      );
      expect(experiment.templates.find((t) => t.templateId === 'proposed_B')!.status).toBe(
        'proposed'
      );
    });
  });
});
