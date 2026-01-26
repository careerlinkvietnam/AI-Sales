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
    const json = opts.json || false;

    // Enable kill switch
    killSwitch.setEnabled(opts.reason, opts.setBy);

    // Record metrics
    metrics.recordOpsStopSend({
      reason: opts.reason,
      setBy: opts.setBy,
    });

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
      console.log('To resume sending, run:');
      console.log('  npx ts-node src/cli/run_ops.ts resume-send --reason "..." --set-by "..."');
    }
  });

// ============================================================
// Subcommand: resume-send
// ============================================================
program
  .command('resume-send')
  .description('Resume sending: Disable RuntimeKillSwitch')
  .requiredOption('--reason <reason>', 'Reason for resuming (e.g., "issue resolved", "false alarm")')
  .requiredOption('--set-by <name>', 'Name/ID of operator')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const killSwitch = getRuntimeKillSwitch();
    const metrics = getMetricsStore();
    const json = opts.json || false;

    const previousState = killSwitch.getState();

    // Disable kill switch
    killSwitch.setDisabled(opts.reason, opts.setBy);

    // Record metrics
    metrics.recordOpsResumeSend({
      reason: opts.reason,
      setBy: opts.setBy,
    });

    const newState = killSwitch.getState();

    if (json) {
      console.log(JSON.stringify({
        success: true,
        action: 'resume-send',
        killSwitchEnabled: false,
        previousEnabled: previousState?.enabled ?? false,
        reason: opts.reason,
        setBy: opts.setBy,
        setAt: newState?.set_at,
        filePath: killSwitch.getFilePath(),
      }, null, 2));
    } else {
      console.log('='.repeat(60));
      console.log('SENDING RESUMED');
      console.log('='.repeat(60));
      console.log('');
      console.log('Sending has been enabled (RuntimeKillSwitch disabled).');
      console.log('');
      console.log(`Reason: ${opts.reason}`);
      console.log(`Set by: ${opts.setBy}`);
      console.log(`Set at: ${newState?.set_at}`);
      console.log('');
      console.log('Note: Sending will only work if:');
      console.log('  - ENABLE_AUTO_SEND=true');
      console.log('  - KILL_SWITCH=false (or not set)');
      console.log('  - Recipient is in allowlist');
      console.log('');
      console.log('Check status:');
      console.log('  npx ts-node src/cli/run_ops.ts stop-status');
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

// Parse and run
program.parse();

// If no command provided, show help
if (process.argv.length <= 2) {
  program.help();
}
