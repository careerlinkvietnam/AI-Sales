#!/usr/bin/env ts-node
/**
 * Approve Templates CLI
 *
 * Approves proposed templates by promoting them to active status.
 *
 * Usage:
 *   npx ts-node src/cli/approve_templates.ts --experiment "ab_subject_cta_v1" --template-id "template_add_urgency_abc" --approved-by "Yamada" --reason "Improved reply rate"
 *   npx ts-node src/cli/approve_templates.ts --experiment "ab_subject_cta_v1" --template-id "template_add_urgency_abc" --approved-by "Yamada" --reason "Test" --dry-run
 *   npx ts-node src/cli/approve_templates.ts --experiment "ab_subject_cta_v1" --template-id "template_add_urgency_abc" --approved-by "Yamada" --reason "Test" --ticket "JIRA-123"
 *
 * 制約:
 * - PII保存禁止（承認ログにテンプレ本文は保存しない）
 * - 品質ゲートを通過しないと承認不可
 * - バックアップ必須
 */

import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import {
  ExperimentEvaluator,
  ExperimentsRegistry,
  ExperimentTemplate,
} from '../domain/ExperimentEvaluator';
import {
  TemplateQualityGate,
  TemplateContentForCheck,
  QualityGateResult,
} from '../domain/TemplateQualityGate';

// Load environment variables
config();

// CLI Configuration
const program = new Command();

program
  .name('approve_templates')
  .description('Approve proposed templates and promote to active status')
  .version('0.1.0');

program
  .requiredOption('--experiment <id>', 'Experiment ID')
  .requiredOption('--template-id <id>', 'Template ID to approve')
  .requiredOption('--approved-by <name>', 'Approver name/ID')
  .requiredOption('--reason <reason>', 'Approval reason')
  .option('--ticket <ticket>', 'Reference ticket (e.g., JIRA-123)')
  .option('--dry-run', 'Check without making changes')
  .option('--json', 'Output results as JSON only');

program.parse();

const options = program.opts();

// ============================================================
// Types
// ============================================================

interface ApprovalLogEntry {
  timestamp: string;
  experimentId: string;
  templateId: string;
  previousActiveTemplateId: string | null;
  approvedBy: string;
  reason: string;
  ticket: string | null;
  qualityGateOk: boolean;
  violations: string[];
}

interface ApproveResult {
  experimentId: string;
  templateId: string;
  approved: boolean;
  qualityGateOk: boolean;
  violations: string[];
  previousActiveTemplateId: string | null;
  backupPath: string | null;
  approvalLogPath: string | null;
  dryRun: boolean;
  error: string | null;
}

// ============================================================
// Approval Log
// ============================================================

/**
 * Approval log file path
 */
function getApprovalLogPath(): string {
  return path.join(process.cwd(), 'data', 'approvals.ndjson');
}

/**
 * Ensure data directory exists
 */
function ensureDataDirectory(): void {
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

/**
 * Append approval log entry
 */
function appendApprovalLog(entry: ApprovalLogEntry): void {
  ensureDataDirectory();
  const logPath = getApprovalLogPath();
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(logPath, line, 'utf-8');
}

// ============================================================
// Template Content Loader
// ============================================================

/**
 * Load template content from experiments.json extended fields
 * or from TemplateGenerator base templates
 */
function loadTemplateContent(
  registry: ExperimentsRegistry,
  experimentId: string,
  templateId: string
): TemplateContentForCheck | null {
  const experiment = registry.experiments.find(
    (e) => e.experimentId === experimentId
  );
  if (!experiment) {
    return null;
  }

  const template = experiment.templates.find(
    (t) => t.templateId === templateId
  ) as ExperimentTemplate & {
    content?: {
      subjectTemplate?: string;
      ctaText?: string;
      candidateHeader?: string;
    };
  };

  if (!template) {
    return null;
  }

  // If template has content field (from propose_templates)
  if (template.content) {
    return {
      subjectTemplate: template.content.subjectTemplate || '',
      ctaTemplate: template.content.ctaText || '',
      candidateHeaderTemplate: template.content.candidateHeader || '',
    };
  }

  // Fallback: Try to load from base templates
  // For existing templates without content field, use defaults
  const BASE_TEMPLATES: Record<string, TemplateContentForCheck> = {
    new_candidates_v1_A: {
      subjectTemplate: '【CareerLink】{{companyName}}様へ人材のご提案',
      candidateHeaderTemplate: '【ご紹介候補者】',
      ctaTemplate:
        'ご興味をお持ちいただけましたら、ぜひご連絡ください。詳細な履歴書をお送りいたします。',
    },
    new_candidates_v1_B: {
      subjectTemplate: '{{companyName}}様向け 厳選人材のご案内 - CareerLink',
      candidateHeaderTemplate: '--- 厳選候補者のご紹介 ---',
      ctaTemplate:
        '面談をご希望の場合は、本メールへのご返信で日程調整いたします。まずはお気軽にご連絡ください。',
    },
  };

  return BASE_TEMPLATES[templateId] || null;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Logger that respects --json flag
 */
function log(message: string): void {
  if (!options.json) {
    console.log(message);
  }
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
  const experimentId = options.experiment as string;
  const templateId = options.templateId as string;
  const approvedBy = options.approvedBy as string;
  const reason = options.reason as string;
  const ticket = (options.ticket as string) || null;
  const dryRun = options.dryRun || false;

  const result: ApproveResult = {
    experimentId,
    templateId,
    approved: false,
    qualityGateOk: false,
    violations: [],
    previousActiveTemplateId: null,
    backupPath: null,
    approvalLogPath: null,
    dryRun,
    error: null,
  };

  if (!options.json) {
    console.log('='.repeat(70));
    console.log('Template Approval');
    console.log('='.repeat(70));
    console.log(`Experiment: ${experimentId}`);
    console.log(`Template: ${templateId}`);
    console.log(`Approved by: ${approvedBy}`);
    console.log(`Reason: ${reason}`);
    if (ticket) {
      console.log(`Ticket: ${ticket}`);
    }
    if (dryRun) {
      console.log('[DRY RUN MODE]');
    }
    console.log('');
  }

  try {
    // Load experiments registry
    const evaluator = new ExperimentEvaluator();
    const registry = evaluator.loadRegistry();

    // Find experiment
    const experiment = registry.experiments.find(
      (e) => e.experimentId === experimentId
    );
    if (!experiment) {
      throw new Error(`Experiment not found: ${experimentId}`);
    }

    // Find template
    const template = experiment.templates.find(
      (t) => t.templateId === templateId
    );
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    // Verify template is proposed
    if (template.status !== 'proposed') {
      throw new Error(
        `Template is not in proposed status (current: ${template.status})`
      );
    }

    // Load template content for quality check
    const content = loadTemplateContent(registry, experimentId, templateId);
    if (!content) {
      throw new Error(
        `Could not load template content for: ${templateId}. Ensure content field exists in experiments.json.`
      );
    }

    // Run quality gate
    log('Running quality gate check...');
    const qualityGate = new TemplateQualityGate();
    const gateResult: QualityGateResult = qualityGate.check(content);

    result.qualityGateOk = gateResult.ok;
    result.violations = gateResult.violations;

    if (!gateResult.ok) {
      log('');
      log('Quality gate FAILED:');
      for (const violation of gateResult.violations) {
        log(`  - ${violation}`);
      }
      log('');
      log('Template cannot be approved due to quality gate violations.');

      // Log the failed attempt
      if (!dryRun) {
        const logEntry: ApprovalLogEntry = {
          timestamp: new Date().toISOString(),
          experimentId,
          templateId,
          previousActiveTemplateId: null,
          approvedBy,
          reason,
          ticket,
          qualityGateOk: false,
          violations: gateResult.violations,
        };
        appendApprovalLog(logEntry);
        result.approvalLogPath = getApprovalLogPath();
      }

      result.error = 'Quality gate failed';
    } else {
      log('Quality gate passed.');
      log('');

      // Find current active template of same variant
      const currentActive = experiment.templates.find(
        (t) => t.variant === template.variant && t.status === 'active'
      );
      result.previousActiveTemplateId = currentActive?.templateId || null;

      if (currentActive) {
        log(`Current active template (${template.variant}): ${currentActive.templateId}`);
        log(`Will be archived.`);
      }

      if (dryRun) {
        log('');
        log('[DRY RUN] No changes made.');
        result.approved = false;
      } else {
        // Create backup
        const timestamp = new Date()
          .toISOString()
          .replace(/[-:]/g, '')
          .replace('T', '')
          .split('.')[0];
        const experimentsPath = path.join(
          process.cwd(),
          'config',
          'experiments.json'
        );
        const backupPath = path.join(
          process.cwd(),
          'config',
          `experiments.json.bak-${timestamp}`
        );

        const content = fs.readFileSync(experimentsPath, 'utf-8');
        fs.writeFileSync(backupPath, content, 'utf-8');
        result.backupPath = backupPath;
        log(`Backup created: ${backupPath}`);

        // Update statuses
        if (currentActive) {
          currentActive.status = 'archived';
        }
        template.status = 'active';

        // Save updated registry
        fs.writeFileSync(
          experimentsPath,
          JSON.stringify(registry, null, 2),
          'utf-8'
        );
        log(`Updated: ${experimentsPath}`);

        // Append approval log
        const logEntry: ApprovalLogEntry = {
          timestamp: new Date().toISOString(),
          experimentId,
          templateId,
          previousActiveTemplateId: result.previousActiveTemplateId,
          approvedBy,
          reason,
          ticket,
          qualityGateOk: true,
          violations: [],
        };
        appendApprovalLog(logEntry);
        result.approvalLogPath = getApprovalLogPath();
        log(`Approval logged: ${result.approvalLogPath}`);

        result.approved = true;
        log('');
        log('Template approved and activated successfully.');
      }
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Unknown error';
    if (!options.json) {
      console.error('Error:', result.error);
    }
  }

  // Output JSON if requested
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  }

  process.exit(result.error && !result.qualityGateOk ? 1 : 0);
}

// Run
main().catch((error) => {
  if (options.json) {
    console.log(
      JSON.stringify({
        experimentId: options.experiment,
        templateId: options.templateId,
        error: error.message,
      })
    );
  } else {
    console.error('Fatal error:', error.message);
  }
  process.exit(1);
});
