#!/usr/bin/env ts-node
/**
 * Operations CLI (Unified Command)
 *
 * Provides a unified interface for all operational tasks.
 *
 * Usage:
 *   npx ts-node src/cli/run_ops.ts scan --since "2026-01-15"
 *   npx ts-node src/cli/run_ops.ts report --since "2026-01-15" --markdown
 *   npx ts-node src/cli/run_ops.ts propose --experiment "..." --since "..." [--dry-run]
 *   npx ts-node src/cli/run_ops.ts promote --experiment "..." [--dry-run]
 *   npx ts-node src/cli/run_ops.ts approve --experiment "..." --template-id "..." --approved-by "..." --reason "..."
 *   npx ts-node src/cli/run_ops.ts safety --experiment "..." --since "..."
 *
 * 目的:
 * - 運用コマンドの統一インターフェース
 * - 日次/週次ルーチンの簡素化
 */

import { config } from 'dotenv';
import { Command } from 'commander';
import { spawn, SpawnOptions } from 'child_process';
import * as path from 'path';
import { ExperimentSafetyCheck } from '../jobs/ExperimentSafetyCheck';
import { ExperimentScheduler } from '../domain/ExperimentScheduler';
import { getSendPolicy } from '../domain/SendPolicy';
import { getRuntimeKillSwitch } from '../domain/RuntimeKillSwitch';
import { getMetricsStore } from '../data/MetricsStore';
import { getRampPolicy } from '../domain/RampPolicy';
import { runAutoStopJob } from '../jobs/AutoStopJob';
import {
  getWebhookNotifier,
  getNotificationRouter,
  notifyOpsStopSend,
  notifyOpsResumeSend,
  notifyOpsRollback,
  notifyFixProposalAccepted,
  notifyFixProposalRejected,
  notifyFixProposalImplemented,
  NotificationEvent,
} from '../notifications';
import { getIncidentManager, IncidentManager } from '../domain/IncidentManager';
import { getResumeGate } from '../domain/ResumeGate';

// Load environment variables
config();

// CLI Configuration
const program = new Command();

program
  .name('run_ops')
  .description('Unified operations CLI for AI-Sales')
  .version('0.1.0');

/**
 * Execute another CLI script
 */
async function execCli(
  scriptName: string,
  args: string[],
  options?: { json?: boolean }
): Promise<void> {
  const scriptPath = path.join(__dirname, `${scriptName}.ts`);
  const tsNodePath = 'npx';

  return new Promise((resolve, reject) => {
    const spawnArgs = ['ts-node', scriptPath, ...args];
    const spawnOptions: SpawnOptions = {
      stdio: 'inherit',
      shell: true,
    };

    const child = spawn(tsNodePath, spawnArgs, spawnOptions);

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${scriptName} exited with code ${code}`));
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

// ============================================================
// Subcommand: scan
// ============================================================
program
  .command('scan')
  .description('Scan Gmail for sent emails and replies (runs scan_gmail_responses)')
  .option('--since <date>', 'Only scan audit records since this date')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    console.log('Running: scan_gmail_responses');
    console.log('');

    const args: string[] = [];
    if (opts.since) args.push('--since', opts.since);
    if (opts.json) args.push('--json');

    try {
      await execCli('scan_gmail_responses', args);
    } catch (error) {
      console.error('Scan failed:', (error as Error).message);
      process.exit(1);
    }
  });

// ============================================================
// Subcommand: report
// ============================================================
program
  .command('report')
  .description('Generate A/B and segment metrics reports')
  .option('--since <date>', 'Only include events since this date')
  .option('--markdown', 'Output as Markdown')
  .option('--json', 'Output as JSON')
  .option('--include-decision', 'Include statistical decisions')
  .option('--show-templates', 'Show template status')
  .option('--segment', 'Also run segment metrics report')
  .action(async (opts) => {
    console.log('Running: report_ab_metrics');
    console.log('');

    const args: string[] = [];
    if (opts.since) args.push('--since', opts.since);
    if (opts.markdown) args.push('--markdown');
    if (opts.json) args.push('--json');
    if (opts.includeDecision) args.push('--include-decision');
    if (opts.showTemplates) args.push('--show-templates');

    try {
      await execCli('report_ab_metrics', args);

      if (opts.segment) {
        console.log('');
        console.log('Running: report_segment_metrics');
        console.log('');

        const segmentArgs: string[] = [];
        if (opts.since) segmentArgs.push('--since', opts.since);
        if (opts.markdown) segmentArgs.push('--markdown');
        if (opts.json) segmentArgs.push('--json');
        if (opts.includeDecision) segmentArgs.push('--include-decision');

        await execCli('report_segment_metrics', segmentArgs);
      }
    } catch (error) {
      console.error('Report failed:', (error as Error).message);
      process.exit(1);
    }
  });

// ============================================================
// Subcommand: propose
// ============================================================
program
  .command('propose')
  .description('Generate template improvement proposals')
  .requiredOption('--experiment <id>', 'Experiment ID')
  .requiredOption('--since <date>', 'Only include events since this date')
  .option('--segment <filter>', 'Filter to specific segment')
  .option('--max-proposals <n>', 'Maximum proposals to generate')
  .option('--dry-run', 'Do not update files')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    console.log('Running: propose_templates');
    console.log('');

    const args: string[] = [];
    args.push('--experiment', opts.experiment);
    args.push('--since', opts.since);
    if (opts.segment) args.push('--segment', opts.segment);
    if (opts.maxProposals) args.push('--max-proposals', opts.maxProposals);
    if (opts.dryRun) args.push('--dry-run');
    if (opts.json) args.push('--json');

    try {
      await execCli('propose_templates', args);
    } catch (error) {
      console.error('Propose failed:', (error as Error).message);
      process.exit(1);
    }
  });

// ============================================================
// Subcommand: promote
// ============================================================
program
  .command('promote')
  .description('Promote A/B test winner')
  .requiredOption('--experiment <id>', 'Experiment ID')
  .option('--since <date>', 'Only include events since this date')
  .option('--dry-run', 'Do not update files')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    console.log('Running: promote_winner');
    console.log('');

    const args: string[] = [];
    args.push('--experiment', opts.experiment);
    if (opts.since) args.push('--since', opts.since);
    if (opts.dryRun) args.push('--dry-run');
    if (opts.json) args.push('--json');

    try {
      await execCli('promote_winner', args);
    } catch (error) {
      console.error('Promote failed:', (error as Error).message);
      process.exit(1);
    }
  });

// ============================================================
// Subcommand: approve
// ============================================================
program
  .command('approve')
  .description('Approve a proposed template')
  .requiredOption('--experiment <id>', 'Experiment ID')
  .requiredOption('--template-id <id>', 'Template ID to approve')
  .requiredOption('--approved-by <name>', 'Approver name/ID')
  .requiredOption('--reason <reason>', 'Approval reason')
  .option('--ticket <ticket>', 'Reference ticket')
  .option('--dry-run', 'Do not update files')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    console.log('Running: approve_templates');
    console.log('');

    const args: string[] = [];
    args.push('--experiment', opts.experiment);
    args.push('--template-id', opts.templateId);
    args.push('--approved-by', opts.approvedBy);
    args.push('--reason', opts.reason);
    if (opts.ticket) args.push('--ticket', opts.ticket);
    if (opts.dryRun) args.push('--dry-run');
    if (opts.json) args.push('--json');

    try {
      await execCli('approve_templates', args);
    } catch (error) {
      console.error('Approve failed:', (error as Error).message);
      process.exit(1);
    }
  });

// ============================================================
// Subcommand: safety
// ============================================================
program
  .command('safety')
  .description('Check experiment safety (freeze/rollback recommendations)')
  .option('--experiment <id>', 'Specific experiment ID (optional, checks all if not specified)')
  .option('--since <date>', 'Only include events since this date')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const safetyCheck = new ExperimentSafetyCheck();
    const json = opts.json || false;

    let results;
    if (opts.experiment) {
      results = [safetyCheck.check(opts.experiment, opts.since)];
    } else {
      results = safetyCheck.checkAll(opts.since);
    }

    if (json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log('='.repeat(70));
      console.log('Experiment Safety Check');
      console.log('='.repeat(70));
      console.log('');

      if (results.length === 0) {
        console.log('No running experiments to check.');
      } else {
        for (const result of results) {
          console.log(`Experiment: ${result.experimentId}`);
          console.log(`  Action: ${result.action.toUpperCase()}`);
          console.log(`  Reasons:`);
          for (const reason of result.reasons) {
            console.log(`    - ${reason}`);
          }
          console.log(`  Metrics:`);
          console.log(`    - Total Sent: ${result.metrics.totalSent}`);
          console.log(`    - Total Replies: ${result.metrics.totalReplies}`);
          console.log(
            `    - Reply Rate: ${result.metrics.replyRate !== null ? (result.metrics.replyRate * 100).toFixed(1) + '%' : 'N/A'}`
          );
          console.log(
            `    - Days Since Last Reply: ${result.metrics.daysSinceLastReply ?? 'N/A'}`
          );
          console.log(`    - Days Since Start: ${result.metrics.daysSinceStart}`);
          console.log('');
        }
      }
    }
  });

// ============================================================
// Subcommand: status
// ============================================================
program
  .command('status')
  .description('Show current experiment status and schedule')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const scheduler = new ExperimentScheduler();
    const activeResult = scheduler.getActiveExperiment();
    const allStatus = scheduler.getExperimentsStatus();

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            activeExperiment: activeResult,
            allExperiments: allStatus,
          },
          null,
          2
        )
      );
    } else {
      console.log('='.repeat(70));
      console.log('Experiment Status');
      console.log('='.repeat(70));
      console.log('');

      console.log('Active Experiment:');
      if (activeResult.found) {
        console.log(`  ID: ${activeResult.experimentId}`);
        console.log(`  Name: ${activeResult.experiment?.name}`);
        console.log(`  Active Templates: ${activeResult.activeTemplates.length}`);
        for (const t of activeResult.activeTemplates) {
          console.log(`    - ${t.templateId} [${t.variant}]`);
        }
      } else {
        console.log(`  None (${activeResult.reason})`);
      }
      console.log('');

      console.log('All Experiments:');
      console.log('-'.repeat(70));
      console.log(
        'ID                           | Status   | Active | Templates | Start At'
      );
      console.log('-'.repeat(70));
      for (const exp of allStatus) {
        const idPad = exp.experimentId.substring(0, 28).padEnd(28);
        const statusPad = exp.status.padEnd(8);
        const activePad = (exp.isActive ? 'Yes' : 'No').padEnd(6);
        const templatesPad = String(exp.activeTemplateCount).padStart(9);
        const startAt = exp.startAt || '-';
        console.log(
          `${idPad} | ${statusPad} | ${activePad} | ${templatesPad} | ${startAt}`
        );
      }
      console.log('-'.repeat(70));
    }
  });

// ============================================================
// Subcommand: send
// ============================================================
program
  .command('send')
  .description('Send a draft email (requires ENABLE_AUTO_SEND=true)')
  .requiredOption('--draft-id <id>', 'Gmail draft ID')
  .requiredOption('--to <email>', 'Recipient email address')
  .requiredOption('--approval-token <token>', 'Approval token')
  .option('--tracking-id <id>', 'Tracking ID for metrics')
  .option('--company-id <id>', 'Company ID for metrics')
  .option('--template-id <id>', 'Template ID for metrics')
  .option('--ab-variant <variant>', 'A/B variant (A or B)')
  .option('--subject <subject>', 'Email subject for PreSendGate check')
  .option('--body <body>', 'Email body for PreSendGate check')
  .option('--dry-run', 'Check without sending')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    // Quick check: if sending is not enabled, fail fast
    const policy = getSendPolicy();
    if (!policy.isSendingEnabled()) {
      const config = policy.getConfig();
      if (opts.json) {
        console.log(
          JSON.stringify({
            success: false,
            blocked: true,
            reason: config.killSwitch ? 'kill_switch' : 'not_enabled',
            details: config.killSwitch
              ? 'Emergency kill switch is active'
              : 'ENABLE_AUTO_SEND is not set to true',
          }, null, 2)
        );
      } else {
        console.error('Send blocked:');
        console.error(
          config.killSwitch
            ? '  KILL_SWITCH is active - sending disabled'
            : '  ENABLE_AUTO_SEND is not set to true'
        );
        console.error('');
        console.error('To enable sending:');
        console.error('  1. Set ENABLE_AUTO_SEND=true in .env');
        console.error('  2. Configure SEND_ALLOWLIST_DOMAINS or SEND_ALLOWLIST_EMAILS');
        console.error('  3. Optionally set SEND_MAX_PER_DAY (default: 20)');
      }
      process.exit(1);
    }

    console.log('Running: send_draft');
    console.log('');

    const args: string[] = [];
    args.push('--draft-id', opts.draftId);
    args.push('--to', opts.to);
    args.push('--approval-token', opts.approvalToken);
    if (opts.trackingId) args.push('--tracking-id', opts.trackingId);
    if (opts.companyId) args.push('--company-id', opts.companyId);
    if (opts.templateId) args.push('--template-id', opts.templateId);
    if (opts.abVariant) args.push('--ab-variant', opts.abVariant);
    if (opts.subject) args.push('--subject', opts.subject);
    if (opts.body) args.push('--body', opts.body);
    if (opts.dryRun) args.push('--dry-run');
    if (opts.json) args.push('--json');

    try {
      await execCli('send_draft', args);
    } catch (error) {
      console.error('Send failed:', (error as Error).message);
      process.exit(1);
    }
  });

// ============================================================
// Subcommand: approve-send
// ============================================================
program
  .command('approve-send')
  .description('Approve and optionally send a draft (one-command workflow)')
  .requiredOption('--draft-id <id>', 'Gmail draft ID to approve')
  .requiredOption('--approved-by <name>', 'Approver name/ID')
  .requiredOption('--reason <reason>', 'Approval reason')
  .option('--to <email>', 'Recipient email address (required for --execute)')
  .option('--ticket <ticket>', 'Reference ticket (e.g., JIRA-123)')
  .option('--execute', 'Actually send after approval (default: dry-run)')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const { approveSend } = await import('./approve_send');
    const json = opts.json || false;

    // Step 1: Approve
    if (!json) {
      console.log('Step 1: Approving draft...');
    }

    const approvalResult = approveSend({
      draftId: opts.draftId,
      approvedBy: opts.approvedBy,
      reason: opts.reason,
      ticket: opts.ticket,
    });

    if (!approvalResult.success) {
      if (json) {
        console.log(JSON.stringify({
          success: false,
          step: 'approve',
          error: approvalResult.error,
        }, null, 2));
      } else {
        console.error('Approval failed:');
        console.error(`  ${approvalResult.error}`);
      }
      process.exit(1);
    }

    if (!json) {
      console.log(`  Approved! Token fingerprint: ${approvalResult.tokenFingerprint}`);
      console.log(`  Tracking ID: ${approvalResult.trackingId}`);
    }

    // Step 2: Check send policy (even for dry-run)
    if (!json) {
      console.log('');
      console.log('Step 2: Checking send policy...');
    }

    const policy = getSendPolicy();
    if (!policy.isSendingEnabled()) {
      const config = policy.getConfig();
      if (json) {
        console.log(JSON.stringify({
          success: true,
          step: 'policy_check',
          approved: true,
          approvalToken: approvalResult.approvalToken,
          canSend: false,
          reason: config.killSwitch ? 'kill_switch' : 'not_enabled',
          trackingId: approvalResult.trackingId,
        }, null, 2));
      } else {
        console.log('  Send policy check:');
        console.log(`    ENABLE_AUTO_SEND: ${config.enableAutoSend}`);
        console.log(`    KILL_SWITCH: ${config.killSwitch}`);
        console.log('');
        console.log('  Cannot send: Sending is not enabled.');
        console.log('');
        console.log('Approval token (for later use):');
        console.log(approvalResult.approvalToken);
      }
      process.exit(opts.execute ? 1 : 0);
    }

    // Check allowlist if --to provided
    if (opts.to) {
      const policyCheck = policy.checkSendPermission(opts.to, 0);
      if (!policyCheck.allowed) {
        if (json) {
          console.log(JSON.stringify({
            success: true,
            step: 'policy_check',
            approved: true,
            approvalToken: approvalResult.approvalToken,
            canSend: false,
            reason: policyCheck.reason,
            details: policyCheck.details,
            trackingId: approvalResult.trackingId,
          }, null, 2));
        } else {
          console.log(`  Send policy check failed: ${policyCheck.reason}`);
          console.log(`    ${policyCheck.details}`);
          console.log('');
          console.log('Approval token (for later use):');
          console.log(approvalResult.approvalToken);
        }
        process.exit(opts.execute ? 1 : 0);
      }
    }

    if (!json) {
      console.log('  Send policy: OK');
    }

    // Step 3: Execute or dry-run
    if (!opts.execute) {
      // Dry-run: show approval token and exit
      if (json) {
        console.log(JSON.stringify({
          success: true,
          dryRun: true,
          approved: true,
          draftId: approvalResult.draftId,
          trackingId: approvalResult.trackingId,
          companyId: approvalResult.companyId,
          templateId: approvalResult.templateId,
          abVariant: approvalResult.abVariant,
          approvalToken: approvalResult.approvalToken,
          tokenFingerprint: approvalResult.tokenFingerprint,
          canSend: true,
          message: 'Dry run - use --execute to actually send',
        }, null, 2));
      } else {
        console.log('');
        console.log('Dry run - approval successful, not sending.');
        console.log('');
        console.log('To send, use:');
        console.log(`  npx ts-node src/cli/run_ops.ts approve-send \\`);
        console.log(`    --draft-id "${opts.draftId}" \\`);
        console.log(`    --approved-by "${opts.approvedBy}" \\`);
        console.log(`    --reason "${opts.reason}" \\`);
        console.log(`    --to "<recipient@domain.com>" \\`);
        console.log(`    --execute`);
        console.log('');
        console.log('Or use the approval token directly:');
        console.log(`  npx ts-node src/cli/send_draft.ts \\`);
        console.log(`    --draft-id "${opts.draftId}" \\`);
        console.log(`    --to "<recipient@domain.com>" \\`);
        console.log(`    --approval-token "${approvalResult.approvalToken}"`);
      }
      return;
    }

    // Execute: send the draft
    if (!opts.to) {
      if (json) {
        console.log(JSON.stringify({
          success: false,
          step: 'send',
          error: '--to is required when using --execute',
        }, null, 2));
      } else {
        console.error('Error: --to is required when using --execute');
      }
      process.exit(1);
    }

    if (!json) {
      console.log('');
      console.log('Step 3: Sending draft...');
    }

    const args: string[] = [];
    args.push('--draft-id', opts.draftId);
    args.push('--to', opts.to);
    args.push('--approval-token', approvalResult.approvalToken!);
    if (json) args.push('--json');

    try {
      await execCli('send_draft', args);
    } catch (error) {
      if (!json) {
        console.error('Send failed:', (error as Error).message);
      }
      process.exit(1);
    }
  });

// ============================================================
// Subcommand: stop-send
// ============================================================
program
  .command('stop-send')
  .description('Emergency stop: Immediately stop all sending via RuntimeKillSwitch')
  .requiredOption('--reason <reason>', 'Reason for stopping (e.g., "reply_rate drop", "incident")')
  .requiredOption('--set-by <name>', 'Name/ID of operator')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const killSwitch = getRuntimeKillSwitch();
    const metrics = getMetricsStore();
    const incidentManager = getIncidentManager();
    const json = opts.json || false;

    // Enable kill switch
    killSwitch.setEnabled(opts.reason, opts.setBy);

    // Record metrics
    metrics.recordOpsStopSend({
      reason: opts.reason,
      setBy: opts.setBy,
    });

    // Create incident
    const incident = incidentManager.createIncident({
      trigger_type: 'OPS_STOP_SEND',
      created_by: 'operator',
      severity: 'warn',
      reason: opts.reason,
      initial_actions: ['runtime_kill_switch_enabled'],
    });

    // Send notification (best effort)
    notifyOpsStopSend({
      reason: opts.reason,
      setBy: opts.setBy,
    }).catch(() => {});

    const state = killSwitch.getState();

    if (json) {
      console.log(JSON.stringify({
        success: true,
        action: 'stop-send',
        killSwitchEnabled: true,
        reason: opts.reason,
        setBy: opts.setBy,
        setAt: state?.set_at,
        filePath: killSwitch.getFilePath(),
        incident_id: incident.incident_id,
      }, null, 2));
    } else {
      console.log('='.repeat(60));
      console.log('EMERGENCY STOP ACTIVATED');
      console.log('='.repeat(60));
      console.log('');
      console.log('All sending has been stopped.');
      console.log('');
      console.log(`Reason: ${opts.reason}`);
      console.log(`Set by: ${opts.setBy}`);
      console.log(`Set at: ${state?.set_at}`);
      console.log(`File: ${killSwitch.getFilePath()}`);
      console.log('');
      console.log(`Incident created: ${incident.incident_id}`);
      console.log('');
      console.log('Next steps:');
      console.log('  1. Investigate the issue');
      console.log('  2. Add notes: run_ops incident note --id <id> --actor "..." --note "..."');
      console.log('  3. Check resume readiness: run_ops resume-check');
      console.log('  4. Resume sending: run_ops resume-send --reason "..." --set-by "..."');
    }
  });

// ============================================================
// Subcommand: resume-send
// ============================================================
program
  .command('resume-send')
  .description('Resume sending: Disable RuntimeKillSwitch (checks ResumeGate first)')
  .requiredOption('--reason <reason>', 'Reason for resuming (e.g., "issue resolved", "false alarm")')
  .requiredOption('--set-by <name>', 'Name/ID of operator')
  .option('--force', 'Force resume even with blockers (requires reason in incident note)')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const killSwitch = getRuntimeKillSwitch();
    const metrics = getMetricsStore();
    const incidentManager = getIncidentManager();
    const resumeGate = getResumeGate();
    const json = opts.json || false;

    // Check ResumeGate first
    const gateResult = resumeGate.evaluate();

    // If blockers exist and not forcing, abort
    if (!gateResult.ok && !opts.force) {
      if (json) {
        console.log(JSON.stringify({
          success: false,
          action: 'resume-send',
          blocked: true,
          blockers: gateResult.blockers,
          warnings: gateResult.warnings,
          hint: 'Use --force to override (requires justification)',
        }, null, 2));
      } else {
        console.log('='.repeat(60));
        console.log('RESUME BLOCKED');
        console.log('='.repeat(60));
        console.log('');
        console.log('Cannot resume sending. The following blockers must be resolved:');
        console.log('');
        for (const blocker of gateResult.blockers) {
          console.log(`  - ${blocker}`);
        }
        if (gateResult.warnings.length > 0) {
          console.log('');
          console.log('Warnings:');
          for (const warning of gateResult.warnings) {
            console.log(`  - ${warning}`);
          }
        }
        console.log('');
        console.log('To check current status: run_ops resume-check');
        console.log('To force resume (not recommended): add --force');
      }
      process.exit(1);
    }

    // If forcing, add note to open incident
    if (opts.force && !gateResult.ok) {
      const openIncident = incidentManager.findOpenIncident();
      if (openIncident) {
        incidentManager.addNote(
          openIncident.incident_id,
          `FORCED RESUME: ${opts.reason} (blockers overridden: ${gateResult.blockers.join(', ')})`,
          opts.setBy
        );
      }
    }

    const previousState = killSwitch.getState();

    // Disable kill switch
    killSwitch.setDisabled(opts.reason, opts.setBy);

    // Record metrics
    metrics.recordOpsResumeSend({
      reason: opts.reason,
      setBy: opts.setBy,
    });

    // Update open incident status to mitigated
    const openIncident = incidentManager.findOpenIncident();
    if (openIncident) {
      incidentManager.updateStatus(openIncident.incident_id, 'mitigated', opts.setBy);
      incidentManager.addNote(
        openIncident.incident_id,
        `Sending resumed: ${opts.reason}`,
        opts.setBy
      );
    }

    // Send notification (best effort)
    notifyOpsResumeSend({
      reason: opts.reason,
      setBy: opts.setBy,
    }).catch(() => {});

    const newState = killSwitch.getState();

    if (json) {
      console.log(JSON.stringify({
        success: true,
        action: 'resume-send',
        killSwitchEnabled: false,
        previousEnabled: previousState?.enabled ?? false,
        forced: opts.force && !gateResult.ok,
        reason: opts.reason,
        setBy: opts.setBy,
        setAt: newState?.set_at,
        filePath: killSwitch.getFilePath(),
        warnings: gateResult.warnings,
      }, null, 2));
    } else {
      console.log('='.repeat(60));
      console.log('SENDING RESUMED');
      console.log('='.repeat(60));
      console.log('');
      if (opts.force && !gateResult.ok) {
        console.log('WARNING: Resume was FORCED despite blockers.');
        console.log('');
      }
      console.log('Sending has been enabled (RuntimeKillSwitch disabled).');
      console.log('');
      console.log(`Reason: ${opts.reason}`);
      console.log(`Set by: ${opts.setBy}`);
      console.log(`Set at: ${newState?.set_at}`);
      if (gateResult.warnings.length > 0) {
        console.log('');
        console.log('Warnings:');
        for (const warning of gateResult.warnings) {
          console.log(`  - ${warning}`);
        }
      }
      if (openIncident) {
        console.log('');
        console.log(`Incident ${openIncident.incident_id} status updated to: mitigated`);
        console.log('To close the incident: run_ops incident close --id <id> --actor "..." --reason "..."');
      }
      console.log('');
    }
  });

// ============================================================
// Subcommand: stop-status
// ============================================================
program
  .command('stop-status')
  .description('Show current kill switch and send policy status')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const killSwitch = getRuntimeKillSwitch();
    const policy = getSendPolicy();
    const config = policy.getConfig();
    const state = killSwitch.getState();
    const json = opts.json || false;

    const status = {
      sendingEnabled: policy.isSendingEnabled(),
      envEnableAutoSend: config.enableAutoSend,
      envKillSwitch: config.killSwitch,
      runtimeKillSwitch: {
        enabled: killSwitch.isEnabled(),
        reason: state?.reason || null,
        setBy: state?.set_by || null,
        setAt: state?.set_at || null,
        filePath: killSwitch.getFilePath(),
        fileExists: state !== null,
      },
      allowlist: {
        domainsCount: config.allowlistDomains.length,
        emailsCount: config.allowlistEmails.length,
        domains: config.allowlistDomains,
        emails: config.allowlistEmails.map(e => e.replace(/^(.{3}).*@/, '$1***@')), // Mask emails
      },
      rateLimit: {
        maxPerDay: config.maxPerDay,
      },
    };

    if (json) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      console.log('='.repeat(60));
      console.log('Send Policy Status');
      console.log('='.repeat(60));
      console.log('');
      console.log(`Overall Sending: ${status.sendingEnabled ? 'ENABLED' : 'DISABLED'}`);
      console.log('');
      console.log('Kill Switches:');
      console.log(`  Environment (KILL_SWITCH): ${status.envKillSwitch ? 'ACTIVE (blocking)' : 'Inactive'}`);
      console.log(`  Runtime (file-based): ${status.runtimeKillSwitch.enabled ? 'ACTIVE (blocking)' : 'Inactive'}`);
      if (status.runtimeKillSwitch.enabled && state) {
        console.log(`    Reason: ${state.reason}`);
        console.log(`    Set by: ${state.set_by}`);
        console.log(`    Set at: ${state.set_at}`);
      }
      console.log('');
      console.log('Configuration:');
      console.log(`  ENABLE_AUTO_SEND: ${status.envEnableAutoSend}`);
      console.log(`  Allowlist Domains: ${status.allowlist.domainsCount}`);
      console.log(`  Allowlist Emails: ${status.allowlist.emailsCount}`);
      console.log(`  Max Per Day: ${status.rateLimit.maxPerDay}`);
      console.log('');
      if (!status.sendingEnabled) {
        console.log('To enable sending:');
        if (!status.envEnableAutoSend) {
          console.log('  - Set ENABLE_AUTO_SEND=true in .env');
        }
        if (status.envKillSwitch) {
          console.log('  - Set KILL_SWITCH=false in .env');
        }
        if (status.runtimeKillSwitch.enabled) {
          console.log('  - Run: npx ts-node src/cli/run_ops.ts resume-send --reason "..." --set-by "..."');
        }
      }
    }
  });

// ============================================================
// Subcommand: rollback
// ============================================================
program
  .command('rollback')
  .description('Stop an experiment and optionally stop all sending')
  .requiredOption('--experiment <id>', 'Experiment ID to roll back')
  .requiredOption('--reason <reason>', 'Reason for rollback')
  .requiredOption('--set-by <name>', 'Name/ID of operator')
  .option('--stop-send', 'Also stop all sending via RuntimeKillSwitch')
  .option('--dry-run', 'Show what would be done without making changes')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    console.log('Running: rollback_experiment');
    console.log('');

    const args: string[] = [];
    args.push('--experiment', opts.experiment);
    args.push('--reason', opts.reason);
    args.push('--set-by', opts.setBy);
    if (opts.stopSend) args.push('--stop-send');
    if (opts.dryRun) args.push('--dry-run');
    if (opts.json) args.push('--json');

    try {
      await execCli('rollback_experiment', args);
    } catch (error) {
      console.error('Rollback failed:', (error as Error).message);
      process.exit(1);
    }
  });

// ============================================================
// Subcommand: ramp-status
// ============================================================
program
  .command('ramp-status')
  .description('Show current ramp (gradual rollout) policy status')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const rampPolicy = getRampPolicy();
    const metricsStore = getMetricsStore();
    const json = opts.json || false;

    const config = rampPolicy.getConfig();
    const todayCount = metricsStore.countTodaySends();
    const todayCap = rampPolicy.getTodayCap();
    const canSendCheck = rampPolicy.canAutoSendToday(todayCount);

    const status = {
      enabled: rampPolicy.isEnabled(),
      mode: rampPolicy.getMode(),
      percentage: rampPolicy.getPercentage(),
      todayCap,
      todaySent: todayCount,
      canSendMore: canSendCheck.ok,
      remaining: canSendCheck.ok ? (todayCap ?? Infinity) - todayCount : 0,
      config: {
        daily_cap_schedule: config.daily_cap_schedule,
        percentage: config.percentage,
        min_sent_before_increase: config.min_sent_before_increase,
      },
    };

    if (json) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      console.log('='.repeat(60));
      console.log('Ramp Policy Status');
      console.log('='.repeat(60));
      console.log('');
      console.log(`Enabled: ${status.enabled ? 'Yes' : 'No'}`);
      console.log(`Mode: ${status.mode}`);
      console.log('');
      console.log('Today:');
      console.log(`  Sent: ${status.todaySent}`);
      console.log(`  Cap: ${status.todayCap ?? 'No cap (schedule passed)'}`);
      console.log(`  Can send more: ${status.canSendMore ? 'Yes' : 'No'}`);
      if (status.canSendMore && status.todayCap !== null) {
        console.log(`  Remaining: ${status.remaining}`);
      }
      console.log('');
      if (status.mode === 'percentage') {
        console.log(`Percentage: ${(status.percentage * 100).toFixed(0)}%`);
        console.log('');
      }
      if (status.mode === 'daily_cap' && config.daily_cap_schedule.length > 0) {
        console.log('Daily Cap Schedule:');
        for (const entry of config.daily_cap_schedule) {
          const isToday = entry.date === new Date().toISOString().split('T')[0];
          const marker = isToday ? ' <-- today' : '';
          console.log(`  ${entry.date}: ${entry.cap}${marker}`);
        }
      }
    }
  });

// ============================================================
// Subcommand: auto-stop
// ============================================================
program
  .command('auto-stop')
  .description('Execute auto-stop evaluation (checks metrics and may activate kill switch)')
  .option('--execute', 'Actually execute (default is dry-run)')
  .option('--dry-run', 'Run evaluation without stopping (same as not using --execute)')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const json = opts.json || false;
    const dryRun = !opts.execute || opts.dryRun;

    const result = runAutoStopJob({ dryRun });

    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('='.repeat(60));
      console.log('Auto-Stop Evaluation');
      console.log('='.repeat(60));
      console.log('');
      console.log(`Mode: ${dryRun ? 'DRY RUN' : 'EXECUTE'}`);
      console.log(`Window: ${result.windowDays} days`);
      console.log('');

      if (result.already_stopped) {
        console.log('Status: ALREADY STOPPED');
        console.log(`  ${result.reasons[0]}`);
      } else {
        console.log('Metrics:');
        console.log(`  Total Sent: ${result.metrics.totalSent}`);
        console.log(`  Total Replies: ${result.metrics.totalReplies}`);
        console.log(`  Total Blocked: ${result.metrics.totalBlocked}`);
        console.log(`  Reply Rate: ${result.metrics.replyRate !== null ? (result.metrics.replyRate * 100).toFixed(2) + '%' : 'N/A'}`);
        console.log(`  Blocked Rate: ${result.metrics.blockedRate !== null ? (result.metrics.blockedRate * 100).toFixed(1) + '%' : 'N/A'}`);
        console.log(`  Consecutive Bad Days: ${result.metrics.consecutiveBadDays}`);
        console.log('');
        console.log(`Should Stop: ${result.should_stop ? 'YES' : 'No'}`);
        if (result.reasons.length > 0) {
          console.log('Reasons:');
          for (const reason of result.reasons) {
            console.log(`  - ${reason}`);
          }
        }
        console.log('');
        if (result.stopped) {
          console.log('Action: STOPPED SENDING');
          console.log('  RuntimeKillSwitch has been activated.');
          console.log('');
          console.log('To resume, run:');
          console.log('  npx ts-node src/cli/run_ops.ts resume-send --reason "..." --set-by "..."');
        } else if (dryRun && result.should_stop) {
          console.log('Action: WOULD STOP (dry run)');
          console.log('  Use --execute to actually stop sending.');
        } else {
          console.log('Action: No action needed');
        }
      }
    }
  });

// ============================================================
// Subcommand: notify-test
// ============================================================
program
  .command('notify-test')
  .description('Send a test notification to verify webhook configuration')
  .option('--severity <level>', 'Severity level (info, warn, error)', 'info')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const webhookNotifier = getWebhookNotifier();
    const router = getNotificationRouter();
    const json = opts.json || false;
    const severity = opts.severity as 'info' | 'warn' | 'error';

    if (!webhookNotifier.isEnabled()) {
      if (json) {
        console.log(JSON.stringify({
          success: false,
          configured: false,
          message: 'NOTIFY_WEBHOOK_URL is not configured',
        }, null, 2));
      } else {
        console.log('='.repeat(60));
        console.log('Notification Test');
        console.log('='.repeat(60));
        console.log('');
        console.log('Status: NOT CONFIGURED');
        console.log('');
        console.log('NOTIFY_WEBHOOK_URL is not set.');
        console.log('');
        console.log('To configure notifications, set NOTIFY_WEBHOOK_URL in .env:');
        console.log('  NOTIFY_WEBHOOK_URL=https://hooks.slack.com/services/...');
      }
      return;
    }

    // Build test event
    const testEvent: NotificationEvent = {
      timestamp: new Date().toISOString(),
      type: 'OPS_STOP_SEND', // Use a valid type for test
      severity,
      reason: `Test notification (severity: ${severity})`,
      meta: {
        test: true,
        source: 'notify-test',
      },
    };

    try {
      const sent = await router.notify(testEvent);

      if (json) {
        console.log(JSON.stringify({
          success: true,
          configured: true,
          sent,
          webhookUrl: webhookNotifier.getWebhookUrlMasked(),
          event: testEvent,
        }, null, 2));
      } else {
        console.log('='.repeat(60));
        console.log('Notification Test');
        console.log('='.repeat(60));
        console.log('');
        console.log('Status: CONFIGURED');
        console.log(`Webhook URL: ${webhookNotifier.getWebhookUrlMasked()}`);
        console.log('');
        if (sent) {
          console.log('Test notification sent successfully!');
        } else {
          console.log('Test notification was rate-limited (try again later).');
        }
        console.log('');
        console.log('Event details:');
        console.log(`  Type: ${testEvent.type}`);
        console.log(`  Severity: ${testEvent.severity}`);
        console.log(`  Reason: ${testEvent.reason}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      if (json) {
        console.log(JSON.stringify({
          success: false,
          configured: true,
          error: errorMsg,
        }, null, 2));
      } else {
        console.error('Test notification failed:');
        console.error(`  ${errorMsg}`);
      }
      process.exit(1);
    }
  });

// ============================================================
// Subcommand: incident list
// ============================================================
program
  .command('incident')
  .description('Manage incidents')
  .argument('<action>', 'Action: list, show, note, close')
  .option('--id <id>', 'Incident ID (required for show, note, close)')
  .option('--status <status>', 'Filter by status (open, mitigated, closed) for list')
  .option('--actor <actor>', 'Actor name (required for note, close)')
  .option('--note <note>', 'Note text (required for note action)')
  .option('--reason <reason>', 'Close reason (required for close action)')
  .option('--json', 'Output as JSON')
  .action(async (action: string, opts) => {
    const incidentManager = getIncidentManager();
    const json = opts.json || false;

    switch (action) {
      case 'list': {
        const statusFilter = opts.status as 'open' | 'mitigated' | 'closed' | undefined;
        const incidents = incidentManager.listIncidents(
          statusFilter ? { status: statusFilter } : undefined
        );

        if (json) {
          console.log(JSON.stringify({
            success: true,
            count: incidents.length,
            filter: statusFilter || 'all',
            incidents: incidents.map((i) => ({
              incident_id: i.incident_id,
              status: i.status,
              trigger_type: i.trigger_type,
              severity: i.severity,
              reason: i.reason,
              created_at: i.created_at,
              created_by: i.created_by,
              experiment_id: i.experiment_id,
            })),
          }, null, 2));
        } else {
          console.log('='.repeat(60));
          console.log(`Incidents${statusFilter ? ` (status: ${statusFilter})` : ''}`);
          console.log('='.repeat(60));
          console.log('');
          if (incidents.length === 0) {
            console.log('No incidents found.');
          } else {
            for (const incident of incidents) {
              console.log(`[${incident.status.toUpperCase()}] ${incident.incident_id}`);
              console.log(`  Trigger: ${incident.trigger_type}`);
              console.log(`  Severity: ${incident.severity}`);
              console.log(`  Reason: ${incident.reason}`);
              console.log(`  Created: ${incident.created_at} by ${incident.created_by}`);
              if (incident.experiment_id) {
                console.log(`  Experiment: ${incident.experiment_id}`);
              }
              console.log('');
            }
          }
        }
        break;
      }

      case 'show': {
        if (!opts.id) {
          console.error('Error: --id is required for show action');
          process.exit(1);
        }

        const incident = incidentManager.getIncident(opts.id);
        if (!incident) {
          if (json) {
            console.log(JSON.stringify({ success: false, error: 'Incident not found' }, null, 2));
          } else {
            console.error(`Incident not found: ${opts.id}`);
          }
          process.exit(1);
        }

        if (json) {
          console.log(JSON.stringify({ success: true, incident }, null, 2));
        } else {
          console.log('='.repeat(60));
          console.log(`Incident: ${incident.incident_id}`);
          console.log('='.repeat(60));
          console.log('');
          console.log(`Status: ${incident.status.toUpperCase()}`);
          console.log(`Trigger: ${incident.trigger_type}`);
          console.log(`Severity: ${incident.severity}`);
          console.log(`Reason: ${incident.reason}`);
          console.log(`Created: ${incident.created_at} by ${incident.created_by}`);
          console.log(`Updated: ${incident.updated_at}`);
          if (incident.experiment_id) {
            console.log(`Experiment: ${incident.experiment_id}`);
          }
          if (incident.closed_at) {
            console.log(`Closed: ${incident.closed_at} by ${incident.closed_by}`);
            console.log(`Close reason: ${incident.close_reason}`);
          }
          console.log('');
          console.log('Snapshot:');
          console.log(`  Window: ${incident.snapshot.window_days} days`);
          console.log(`  Sent: ${incident.snapshot.sent}`);
          console.log(`  Replies: ${incident.snapshot.replies}`);
          console.log(`  Reply rate: ${incident.snapshot.reply_rate !== null ? (incident.snapshot.reply_rate * 100).toFixed(1) + '%' : 'N/A'}`);
          console.log(`  Blocked: ${incident.snapshot.blocked}`);
          console.log(`  Kill switch (env): ${incident.snapshot.kill_switch_state.env}`);
          console.log(`  Kill switch (runtime): ${incident.snapshot.kill_switch_state.runtime}`);
          console.log(`  Active templates: ${incident.snapshot.active_templates.join(', ') || 'none'}`);
          console.log('');
          if (incident.actions_taken.length > 0) {
            console.log('Actions taken:');
            for (const action of incident.actions_taken) {
              console.log(`  - [${action.timestamp}] ${action.action} (${action.actor})`);
            }
            console.log('');
          }
          if (incident.notes.length > 0) {
            console.log('Notes:');
            for (const note of incident.notes) {
              console.log(`  - [${note.timestamp}] ${note.note} (${note.actor})`);
            }
            console.log('');
          }
        }
        break;
      }

      case 'note': {
        if (!opts.id) {
          console.error('Error: --id is required for note action');
          process.exit(1);
        }
        if (!opts.actor) {
          console.error('Error: --actor is required for note action');
          process.exit(1);
        }
        if (!opts.note) {
          console.error('Error: --note is required for note action');
          process.exit(1);
        }

        const success = incidentManager.addNote(opts.id, opts.note, opts.actor);
        if (!success) {
          if (json) {
            console.log(JSON.stringify({ success: false, error: 'Incident not found' }, null, 2));
          } else {
            console.error(`Incident not found: ${opts.id}`);
          }
          process.exit(1);
        }

        if (json) {
          console.log(JSON.stringify({
            success: true,
            action: 'note_added',
            incident_id: opts.id,
            note: opts.note,
            actor: opts.actor,
          }, null, 2));
        } else {
          console.log(`Note added to incident ${opts.id}`);
        }
        break;
      }

      case 'close': {
        if (!opts.id) {
          console.error('Error: --id is required for close action');
          process.exit(1);
        }
        if (!opts.actor) {
          console.error('Error: --actor is required for close action');
          process.exit(1);
        }
        if (!opts.reason) {
          console.error('Error: --reason is required for close action');
          process.exit(1);
        }

        const success = incidentManager.closeIncident(opts.id, opts.actor, opts.reason);
        if (!success) {
          if (json) {
            console.log(JSON.stringify({ success: false, error: 'Incident not found' }, null, 2));
          } else {
            console.error(`Incident not found: ${opts.id}`);
          }
          process.exit(1);
        }

        if (json) {
          console.log(JSON.stringify({
            success: true,
            action: 'incident_closed',
            incident_id: opts.id,
            reason: opts.reason,
            actor: opts.actor,
          }, null, 2));
        } else {
          console.log(`Incident ${opts.id} closed.`);
          console.log(`  Reason: ${opts.reason}`);
          console.log(`  Closed by: ${opts.actor}`);
        }
        break;
      }

      default:
        console.error(`Unknown action: ${action}`);
        console.error('Valid actions: list, show, note, close');
        process.exit(1);
    }
  });

// ============================================================
// Subcommand: resume-check
// ============================================================
program
  .command('resume-check')
  .description('Check if it is safe to resume sending (evaluate ResumeGate)')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const resumeGate = getResumeGate();
    const json = opts.json || false;

    const result = resumeGate.evaluate();

    if (json) {
      console.log(JSON.stringify({
        success: true,
        ok: result.ok,
        blockers: result.blockers,
        warnings: result.warnings,
        checkResults: result.checkResults,
      }, null, 2));
    } else {
      console.log('='.repeat(60));
      console.log('Resume Gate Check');
      console.log('='.repeat(60));
      console.log('');
      console.log(`Status: ${result.ok ? 'OK - Can resume' : 'BLOCKED - Cannot resume'}`);
      console.log('');

      if (result.blockers.length > 0) {
        console.log('Blockers (must resolve before resuming):');
        for (const blocker of result.blockers) {
          console.log(`  - ${blocker}`);
        }
        console.log('');
      }

      if (result.warnings.length > 0) {
        console.log('Warnings (may proceed with caution):');
        for (const warning of result.warnings) {
          console.log(`  - ${warning}`);
        }
        console.log('');
      }

      console.log('Check details:');
      const checks = result.checkResults;
      console.log(`  Runtime kill switch: ${checks.runtimeKillSwitch.blocked ? 'BLOCKED' : 'OK'}`);
      console.log(`  Env kill switch: ${checks.envKillSwitch.blocked ? 'BLOCKED' : 'OK'}`);
      console.log(`  Auto-send enabled: ${checks.autoSendEnabled.blocked ? 'BLOCKED' : 'OK'}`);
      console.log(`  Allowlist configured: ${checks.allowlistConfigured.blocked ? 'BLOCKED' : 'OK'}`);
      console.log(`  Cooldown period: ${checks.cooldownPeriod.blocked ? 'BLOCKED' : 'OK'}`);
      console.log(`  Reply rate recovered: ${checks.replyRateRecovered.blocked ? 'WARNING' : 'OK'}`);
      console.log(`  No open incident: ${checks.noOpenIncident.blocked ? 'WARNING' : 'OK'}`);
      console.log('');

      if (!result.ok) {
        console.log('To resume anyway (not recommended):');
        console.log('  run_ops resume-send --reason "..." --set-by "..." --force');
      }
    }
  });

// ============================================================
// Subcommand: incidents-report
// ============================================================
program
  .command('incidents-report')
  .description('Generate incident report with root cause classification')
  .option('--since <date>', 'Start date (YYYY-MM-DD), default: 7 days ago')
  .option('--markdown', 'Output as markdown')
  .option('--json', 'Output as JSON')
  .option('--notify', 'Send notification with summary (if webhook configured)')
  .action(async (opts) => {
    const args: string[] = [];

    if (opts.since) {
      args.push('--since', opts.since);
    }
    if (opts.markdown) {
      args.push('--markdown');
    }
    if (opts.json) {
      args.push('--json');
    }
    if (opts.notify) {
      args.push('--notify');
    }

    await execCli('report_incidents', args);
  });

// ============================================================
// Subcommand: fixes-propose
// ============================================================
program
  .command('fixes-propose')
  .description('Generate fix proposals based on incident analysis')
  .option('--since <date>', 'Start date (YYYY-MM-DD), default: 7 days ago')
  .option('--top <n>', 'Top N categories to generate proposals for', '3')
  .option('--dry-run', 'Generate proposals without saving')
  .option('--notify', 'Send notification with proposal summary')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const args: string[] = [];

    if (opts.since) {
      args.push('--since', opts.since);
    }
    if (opts.top) {
      args.push('--top', opts.top);
    }
    if (opts.dryRun) {
      args.push('--dry-run');
    }
    if (opts.notify) {
      args.push('--notify');
    }
    if (opts.json) {
      args.push('--json');
    }

    await execCli('propose_fixes', args);
  });

// ============================================================
// Subcommand: fixes-list
// ============================================================
program
  .command('fixes-list')
  .description('List fix proposals (status computed from events)')
  .option('--status <status>', 'Filter by status (proposed, accepted, rejected, implemented)')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const { getFixProposalManager } = require('../domain/FixProposalManager');
    const manager = getFixProposalManager();
    const json = opts.json || false;
    const statusFilter = opts.status as 'proposed' | 'accepted' | 'rejected' | 'implemented' | undefined;

    const proposals = manager.listProposals(statusFilter ? { status: statusFilter } : undefined);

    if (json) {
      console.log(JSON.stringify({
        success: true,
        count: proposals.length,
        filter: statusFilter || 'all',
        proposals,
      }, null, 2));
    } else {
      console.log('='.repeat(60));
      console.log(`Fix Proposals${statusFilter ? ` (status: ${statusFilter})` : ''}`);
      console.log('='.repeat(60));
      console.log('');

      if (proposals.length === 0) {
        console.log('No proposals found.');
      } else {
        for (const proposal of proposals) {
          const statusIcon = {
            proposed: '📋',
            accepted: '✅',
            rejected: '❌',
            implemented: '✨',
          }[proposal.status] || '?';

          console.log(`${statusIcon} [${proposal.priority}] ${proposal.title}`);
          console.log(`  ID: ${proposal.proposal_id}`);
          console.log(`  Category: ${proposal.category_id}`);
          console.log(`  Status: ${proposal.status}`);
          console.log(`  Incidents: ${proposal.incident_count}`);
          console.log(`  Created: ${proposal.created_at}`);
          console.log('');
        }
      }
    }
  });

// ============================================================
// Subcommand: fixes-show
// ============================================================
program
  .command('fixes-show')
  .description('Show fix proposal details with event history')
  .argument('<proposal_id>', 'Proposal ID')
  .option('--json', 'Output as JSON')
  .action(async (proposalId: string, opts) => {
    const { getFixProposalManager } = require('../domain/FixProposalManager');
    const manager = getFixProposalManager();
    const json = opts.json || false;

    const result = manager.getProposal(proposalId);

    if (!result) {
      if (json) {
        console.log(JSON.stringify({ success: false, error: 'Proposal not found' }, null, 2));
      } else {
        console.error(`Proposal not found: ${proposalId}`);
      }
      process.exit(1);
    }

    const { proposal, status, history } = result;

    if (json) {
      console.log(JSON.stringify({ success: true, proposal, status, history }, null, 2));
    } else {
      console.log('='.repeat(60));
      console.log('Fix Proposal Details');
      console.log('='.repeat(60));
      console.log('');
      console.log(`ID: ${proposal.proposal_id}`);
      console.log(`Priority: ${proposal.priority}`);
      console.log(`Title: ${proposal.title}`);
      console.log(`Category: ${proposal.category_id}`);
      console.log(`Status: ${status.toUpperCase()}`);
      console.log(`Created: ${proposal.created_at} by ${proposal.created_by}`);
      console.log('');
      console.log('Rationale:');
      console.log(`  Incident Count: ${proposal.rationale.incident_count}`);
      if (proposal.rationale.recent_examples && proposal.rationale.recent_examples.length > 0) {
        console.log(`  Recent Examples: ${proposal.rationale.recent_examples.join(', ')}`);
      }
      console.log('');
      console.log('Recommended Steps:');
      for (const step of proposal.recommended_steps) {
        console.log(`  ${step}`);
      }
      console.log('');
      if (proposal.related_artifacts.files && proposal.related_artifacts.files.length > 0) {
        console.log(`Related Files: ${proposal.related_artifacts.files.join(', ')}`);
      }
      if (proposal.related_artifacts.commands && proposal.related_artifacts.commands.length > 0) {
        console.log(`Related Commands: ${proposal.related_artifacts.commands.join(', ')}`);
      }
      console.log('');
      console.log('Source:');
      console.log(`  Report Since: ${proposal.source.report_since}`);
      console.log(`  Top Categories: ${proposal.source.top_categories.join(', ')}`);

      if (history.length > 0) {
        console.log('');
        console.log('Event History:');
        for (const event of history) {
          const actionIcon = {
            ACCEPT: '✅',
            REJECT: '❌',
            IMPLEMENT: '✨',
            NOTE: '📝',
          }[event.action] || '?';
          console.log(`  ${actionIcon} [${event.timestamp}] ${event.action} by ${event.actor}`);
          console.log(`     ${event.reason}`);
          if (event.links) {
            const links: string[] = [];
            if (event.links.ticket) links.push(`ticket=${event.links.ticket}`);
            if (event.links.pr) links.push(`PR=${event.links.pr}`);
            if (event.links.commit) links.push(`commit=${event.links.commit}`);
            if (links.length > 0) {
              console.log(`     Links: ${links.join(', ')}`);
            }
          }
        }
      }

      console.log('');
      console.log('IMPORTANT: Proposals are NOT auto-applied.');
      console.log('Review steps and implement manually.');

      if (status === 'proposed') {
        console.log('');
        console.log('Actions:');
        console.log(`  Accept: run_ops fixes-accept ${proposalId} --actor "..." --reason "..."`);
        console.log(`  Reject: run_ops fixes-reject ${proposalId} --actor "..." --reason "..."`);
      } else if (status === 'accepted') {
        console.log('');
        console.log('Actions:');
        console.log(`  Implement: run_ops fixes-implement ${proposalId} --actor "..." --reason "..." [--pr ...]`);
      }
    }
  });

// ============================================================
// Subcommand: fixes-accept
// ============================================================
program
  .command('fixes-accept')
  .description('Accept a fix proposal (marks for implementation)')
  .argument('<proposal_id>', 'Proposal ID')
  .requiredOption('--actor <actor>', 'Name/ID of the person accepting')
  .requiredOption('--reason <reason>', 'Reason for accepting')
  .option('--ticket <ticket>', 'Related ticket (e.g., JIRA-123)')
  .option('--pr <pr>', 'Related PR number')
  .option('--commit <commit>', 'Related commit hash')
  .option('--notify', 'Send notification')
  .option('--json', 'Output as JSON')
  .action(async (proposalId: string, opts) => {
    const { getFixProposalManager, ProposalWithHistory } = require('../domain/FixProposalManager');
    const manager = getFixProposalManager();
    const json = opts.json || false;

    // Get proposal info for notification
    const proposalInfo = manager.getProposal(proposalId);
    if (!proposalInfo) {
      if (json) {
        console.log(JSON.stringify({ success: false, error: 'Proposal not found' }, null, 2));
      } else {
        console.error(`Proposal not found: ${proposalId}`);
      }
      process.exit(1);
    }

    const links = opts.ticket || opts.pr || opts.commit
      ? { ticket: opts.ticket, pr: opts.pr, commit: opts.commit }
      : undefined;

    const result = manager.accept(proposalId, opts.actor, opts.reason, links);

    if (!result.success) {
      if (json) {
        console.log(JSON.stringify({ success: false, error: result.error }, null, 2));
      } else {
        console.error(`Error: ${result.error}`);
      }
      process.exit(1);
    }

    // Send notification if requested
    if (opts.notify) {
      notifyFixProposalAccepted({
        proposalId,
        categoryId: proposalInfo.proposal.category_id,
        priority: proposalInfo.proposal.priority,
        title: proposalInfo.proposal.title,
        actor: opts.actor,
      }).catch(() => {});
    }

    if (json) {
      console.log(JSON.stringify({
        success: true,
        action: 'accepted',
        proposal_id: proposalId,
        new_status: result.newStatus,
        event: result.event,
      }, null, 2));
    } else {
      console.log(`Proposal ${proposalId} accepted.`);
      console.log(`  Actor: ${opts.actor}`);
      console.log(`  Reason: ${opts.reason}`);
      console.log(`  New status: ${result.newStatus}`);
      if (links) {
        const linkParts: string[] = [];
        if (links.ticket) linkParts.push(`ticket=${links.ticket}`);
        if (links.pr) linkParts.push(`PR=${links.pr}`);
        if (links.commit) linkParts.push(`commit=${links.commit}`);
        console.log(`  Links: ${linkParts.join(', ')}`);
      }
      console.log('');
      console.log('Next: Implement the fix and then run:');
      console.log(`  run_ops fixes-implement ${proposalId} --actor "..." --reason "..." --pr "..."`);
    }
  });

// ============================================================
// Subcommand: fixes-reject
// ============================================================
program
  .command('fixes-reject')
  .description('Reject a fix proposal')
  .argument('<proposal_id>', 'Proposal ID')
  .requiredOption('--actor <actor>', 'Name/ID of the person rejecting')
  .requiredOption('--reason <reason>', 'Reason for rejecting')
  .option('--notify', 'Send notification')
  .option('--json', 'Output as JSON')
  .action(async (proposalId: string, opts) => {
    const { getFixProposalManager } = require('../domain/FixProposalManager');
    const manager = getFixProposalManager();
    const json = opts.json || false;

    // Get proposal info for notification
    const proposalInfo = manager.getProposal(proposalId);
    if (!proposalInfo) {
      if (json) {
        console.log(JSON.stringify({ success: false, error: 'Proposal not found' }, null, 2));
      } else {
        console.error(`Proposal not found: ${proposalId}`);
      }
      process.exit(1);
    }

    const result = manager.reject(proposalId, opts.actor, opts.reason);

    if (!result.success) {
      if (json) {
        console.log(JSON.stringify({ success: false, error: result.error }, null, 2));
      } else {
        console.error(`Error: ${result.error}`);
      }
      process.exit(1);
    }

    // Send notification if requested
    if (opts.notify) {
      notifyFixProposalRejected({
        proposalId,
        categoryId: proposalInfo.proposal.category_id,
        priority: proposalInfo.proposal.priority,
        title: proposalInfo.proposal.title,
        actor: opts.actor,
        reason: opts.reason,
      }).catch(() => {});
    }

    if (json) {
      console.log(JSON.stringify({
        success: true,
        action: 'rejected',
        proposal_id: proposalId,
        new_status: result.newStatus,
        event: result.event,
      }, null, 2));
    } else {
      console.log(`Proposal ${proposalId} rejected.`);
      console.log(`  Actor: ${opts.actor}`);
      console.log(`  Reason: ${opts.reason}`);
      console.log(`  New status: ${result.newStatus}`);
    }
  });

// ============================================================
// Subcommand: fixes-implement
// ============================================================
program
  .command('fixes-implement')
  .description('Mark a fix proposal as implemented')
  .argument('<proposal_id>', 'Proposal ID')
  .requiredOption('--actor <actor>', 'Name/ID of the person implementing')
  .requiredOption('--reason <reason>', 'Implementation notes/summary')
  .option('--ticket <ticket>', 'Related ticket (e.g., JIRA-123)')
  .option('--pr <pr>', 'Related PR number')
  .option('--commit <commit>', 'Related commit hash')
  .option('--notify', 'Send notification')
  .option('--json', 'Output as JSON')
  .action(async (proposalId: string, opts) => {
    const { getFixProposalManager } = require('../domain/FixProposalManager');
    const manager = getFixProposalManager();
    const json = opts.json || false;

    // Get proposal info for notification
    const proposalInfo = manager.getProposal(proposalId);
    if (!proposalInfo) {
      if (json) {
        console.log(JSON.stringify({ success: false, error: 'Proposal not found' }, null, 2));
      } else {
        console.error(`Proposal not found: ${proposalId}`);
      }
      process.exit(1);
    }

    const links = opts.ticket || opts.pr || opts.commit
      ? { ticket: opts.ticket, pr: opts.pr, commit: opts.commit }
      : undefined;

    const result = manager.implement(proposalId, opts.actor, opts.reason, links);

    if (!result.success) {
      if (json) {
        console.log(JSON.stringify({ success: false, error: result.error }, null, 2));
      } else {
        console.error(`Error: ${result.error}`);
      }
      process.exit(1);
    }

    // Send notification if requested
    if (opts.notify) {
      notifyFixProposalImplemented({
        proposalId,
        categoryId: proposalInfo.proposal.category_id,
        priority: proposalInfo.proposal.priority,
        title: proposalInfo.proposal.title,
        actor: opts.actor,
        links,
      }).catch(() => {});
    }

    if (json) {
      console.log(JSON.stringify({
        success: true,
        action: 'implemented',
        proposal_id: proposalId,
        new_status: result.newStatus,
        event: result.event,
      }, null, 2));
    } else {
      console.log(`Proposal ${proposalId} marked as implemented.`);
      console.log(`  Actor: ${opts.actor}`);
      console.log(`  Reason: ${opts.reason}`);
      console.log(`  New status: ${result.newStatus}`);
      if (links) {
        const linkParts: string[] = [];
        if (links.ticket) linkParts.push(`ticket=${links.ticket}`);
        if (links.pr) linkParts.push(`PR=${links.pr}`);
        if (links.commit) linkParts.push(`commit=${links.commit}`);
        console.log(`  Links: ${linkParts.join(', ')}`);
      }
    }
  });

// ============================================================
// Subcommand: fixes-note
// ============================================================
program
  .command('fixes-note')
  .description('Add a note to a fix proposal')
  .argument('<proposal_id>', 'Proposal ID')
  .requiredOption('--actor <actor>', 'Name/ID of the person adding the note')
  .requiredOption('--note <note>', 'Note text')
  .option('--json', 'Output as JSON')
  .action(async (proposalId: string, opts) => {
    const { getFixProposalManager } = require('../domain/FixProposalManager');
    const manager = getFixProposalManager();
    const json = opts.json || false;

    const result = manager.addNote(proposalId, opts.actor, opts.note);

    if (!result.success) {
      if (json) {
        console.log(JSON.stringify({ success: false, error: result.error }, null, 2));
      } else {
        console.error(`Error: ${result.error}`);
      }
      process.exit(1);
    }

    if (json) {
      console.log(JSON.stringify({
        success: true,
        action: 'note_added',
        proposal_id: proposalId,
        event: result.event,
      }, null, 2));
    } else {
      console.log(`Note added to proposal ${proposalId}.`);
      console.log(`  Actor: ${opts.actor}`);
      console.log(`  Note: ${opts.note}`);
    }
  });

// ============================================================
// Subcommand: send-queue (with subactions)
// ============================================================
program
  .command('send-queue')
  .description('Manage send queue')
  .argument('<action>', 'Action: status, process, dead-letter, retry')
  .argument('[job_id]', 'Job ID (for retry, dead-letter show)')
  .option('--max-jobs <n>', 'Maximum jobs to process', '10')
  .option('--execute', 'Actually process/send (default is dry-run)')
  .option('--actor <actor>', 'Actor name (for retry)')
  .option('--reason <reason>', 'Reason (for retry)')
  .option('--json', 'Output as JSON')
  .action(async (action: string, jobId: string | undefined, opts) => {
    const { getSendQueueManager } = require('../domain/SendQueueManager');
    const manager = getSendQueueManager();
    const json = opts.json || false;

    switch (action) {
      case 'status': {
        const counts = manager.getStatusCounts();
        const total = Object.values(counts).reduce((a: number, b: number) => a + b, 0);

        if (json) {
          console.log(JSON.stringify({
            success: true,
            total,
            counts,
          }, null, 2));
        } else {
          console.log('='.repeat(60));
          console.log('Send Queue Status');
          console.log('='.repeat(60));
          console.log('');
          console.log(`Total: ${total}`);
          console.log(`  Queued: ${counts.queued}`);
          console.log(`  In Progress: ${counts.in_progress}`);
          console.log(`  Sent: ${counts.sent}`);
          console.log(`  Failed: ${counts.failed}`);
          console.log(`  Dead Letter: ${counts.dead_letter}`);
          console.log(`  Cancelled: ${counts.cancelled}`);
        }
        break;
      }

      case 'process': {
        const maxJobs = parseInt(opts.maxJobs || '10', 10);
        const execute = opts.execute || false;

        const args: string[] = [];
        args.push('--max-jobs', String(maxJobs));
        if (execute) args.push('--execute');
        if (json) args.push('--json');

        await execCli('process_send_queue', args);
        break;
      }

      case 'dead-letter': {
        // If no job_id, list dead letters
        if (!jobId || jobId === 'list') {
          const jobs = manager.getDeadLetterJobs();

          if (json) {
            console.log(JSON.stringify({
              success: true,
              count: jobs.length,
              jobs: jobs.map((j: any) => ({
                job_id: j.job_id,
                tracking_id: j.tracking_id,
                to_domain: j.to_domain,
                template_id: j.template_id,
                attempts: j.attempts,
                last_error_code: j.last_error_code,
                created_at: j.created_at,
              })),
            }, null, 2));
          } else {
            console.log('='.repeat(60));
            console.log('Dead Letter Queue');
            console.log('='.repeat(60));
            console.log('');

            if (jobs.length === 0) {
              console.log('No dead letter jobs.');
            } else {
              for (const job of jobs) {
                console.log(`💀 ${job.job_id}`);
                console.log(`  Tracking: ${job.tracking_id}`);
                console.log(`  Domain: ${job.to_domain}`);
                console.log(`  Attempts: ${job.attempts}`);
                console.log(`  Error: ${job.last_error_code || 'unknown'}`);
                console.log(`  Created: ${job.created_at}`);
                console.log('');
              }
              console.log(`Total: ${jobs.length}`);
              console.log('');
              console.log('To retry: run_ops send-queue retry <job_id> --actor "..." --reason "..."');
            }
          }
        } else if (jobId === 'show') {
          console.error('Usage: run_ops send-queue dead-letter show <job_id>');
          process.exit(1);
        } else {
          // Show specific dead letter
          const job = manager.getJob(jobId);
          if (!job || job.status !== 'dead_letter') {
            if (json) {
              console.log(JSON.stringify({ success: false, error: 'Dead letter job not found' }, null, 2));
            } else {
              console.error(`Dead letter job not found: ${jobId}`);
            }
            process.exit(1);
          }

          if (json) {
            console.log(JSON.stringify({ success: true, job }, null, 2));
          } else {
            console.log('='.repeat(60));
            console.log('Dead Letter Job Details');
            console.log('='.repeat(60));
            console.log('');
            console.log(`Job ID: ${job.job_id}`);
            console.log(`Status: ${job.status}`);
            console.log(`Draft ID: ${job.draft_id}`);
            console.log(`Tracking ID: ${job.tracking_id}`);
            console.log(`Company ID: ${job.company_id}`);
            console.log(`Template ID: ${job.template_id}`);
            console.log(`Domain: ${job.to_domain}`);
            console.log(`Attempts: ${job.attempts}`);
            console.log(`Error Code: ${job.last_error_code || 'N/A'}`);
            console.log(`Created: ${job.created_at}`);
            console.log(`Updated: ${job.last_updated_at}`);
            console.log('');
            console.log('To retry: run_ops send-queue retry ' + job.job_id + ' --actor "..." --reason "..."');
          }
        }
        break;
      }

      case 'retry': {
        if (!jobId) {
          console.error('Error: job_id is required for retry');
          process.exit(1);
        }
        if (!opts.actor) {
          console.error('Error: --actor is required for retry');
          process.exit(1);
        }
        if (!opts.reason) {
          console.error('Error: --reason is required for retry');
          process.exit(1);
        }

        const result = manager.retryDeadLetter(jobId, opts.actor, opts.reason);

        if (!result.success) {
          if (json) {
            console.log(JSON.stringify({ success: false, error: result.error }, null, 2));
          } else {
            console.error(`Error: ${result.error}`);
          }
          process.exit(1);
        }

        if (json) {
          console.log(JSON.stringify({
            success: true,
            action: 'retried',
            job_id: jobId,
          }, null, 2));
        } else {
          console.log(`Job ${jobId} re-queued for retry.`);
          console.log(`  Actor: ${opts.actor}`);
          console.log(`  Reason: ${opts.reason}`);
          console.log('');
          console.log('Process the queue: run_ops send-queue process --execute');
        }
        break;
      }

      default:
        console.error(`Unknown action: ${action}`);
        console.error('Valid actions: status, process, dead-letter, retry');
        process.exit(1);
    }
  });

// Parse and run
program.parse();

// If no command provided, show help
if (process.argv.length <= 2) {
  program.help();
}
