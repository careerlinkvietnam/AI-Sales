#!/usr/bin/env npx ts-node
/**
 * Send Draft CLI
 *
 * Sends a previously created Gmail draft with strict safety controls.
 *
 * 必須引数:
 * - --draft-id: Gmail下書きID
 * - --to: 宛先メールアドレス（allowlist判定用、保存しない）
 * - --approval-token: 承認トークン
 *
 * オプション:
 * - --tracking-id: トラッキングID（metrics記録用）
 * - --company-id: 会社ID（metrics記録用）
 * - --template-id: テンプレートID（metrics記録用）
 * - --ab-variant: A/Bバリアント（metrics記録用）
 * - --subject: 件名（PreSendGateチェック用）
 * - --body: 本文（PreSendGateチェック用）
 * - --dry-run: 送信せずに判定のみ表示
 * - --json: JSON出力
 *
 * 安全性:
 * - ENABLE_AUTO_SEND=true かつ KILL_SWITCH=false の場合のみ送信可能
 * - 宛先がallowlistに含まれていること
 * - ApprovalTokenが有効であること
 * - PreSendGateのチェックに通ること（subject/bodyが提供された場合）
 * - 日次レート制限内であること
 */

import { Command } from 'commander';
import { GmailClient } from '../connectors/gmail/GmailClient';
import { getSendPolicy } from '../domain/SendPolicy';
import { getPreSendGate } from '../domain/PreSendGate';
import { getApprovalTokenManager } from '../domain/ApprovalToken';
import { getMetricsStore, SendBlockedReason } from '../data/MetricsStore';
import { getDraftRegistry } from '../data/DraftRegistry';

interface SendDraftOptions {
  draftId: string;
  to: string;
  approvalToken: string;
  trackingId?: string;
  companyId?: string;
  templateId?: string;
  abVariant?: 'A' | 'B';
  subject?: string;
  body?: string;
  dryRun?: boolean;
  json?: boolean;
}

interface SendResult {
  success: boolean;
  sent: boolean;
  dryRun: boolean;
  draftId: string;
  messageId?: string;
  threadId?: string;
  blocked?: boolean;
  reason?: SendBlockedReason;
  details?: string;
  gateViolations?: string[];
}

/**
 * Extract domain from email address (for logging, no PII)
 */
function extractDomain(email: string): string {
  const parts = email.split('@');
  return parts.length === 2 ? parts[1].toLowerCase() : 'unknown';
}

/**
 * Main send draft function
 */
async function sendDraft(options: SendDraftOptions): Promise<SendResult> {
  const sendPolicy = getSendPolicy();
  const preSendGate = getPreSendGate();
  const tokenManager = getApprovalTokenManager();
  const metricsStore = getMetricsStore();
  const draftRegistry = getDraftRegistry();

  const recipientDomain = extractDomain(options.to);
  const todayCount = metricsStore.countTodaySends();

  // Look up draft in registry to get metadata (if exists)
  const registryLookup = draftRegistry.lookupByDraftId(options.draftId);

  // Use registry values if available, otherwise use provided options
  const trackingId = registryLookup.entry?.trackingId || options.trackingId || 'unknown';
  const companyId = registryLookup.entry?.companyId || options.companyId || 'unknown';
  const templateId = registryLookup.entry?.templateId || options.templateId || 'unknown';
  const abVariant = registryLookup.entry?.abVariant || options.abVariant || null;

  // Record attempt
  metricsStore.recordAutoSendAttempt({
    trackingId,
    companyId,
    templateId,
    abVariant,
    draftId: options.draftId,
    recipientDomain,
  });

  // Check 1: Draft must exist in registry (security check - only send system-generated drafts)
  if (!registryLookup.found) {
    metricsStore.recordAutoSendBlocked({
      trackingId,
      companyId,
      templateId,
      abVariant,
      draftId: options.draftId,
      reason: 'not_in_registry',
      details: `Draft ${options.draftId} not found in registry. Only drafts created by this system can be sent.`,
      recipientDomain,
    });

    return {
      success: false,
      sent: false,
      dryRun: options.dryRun || false,
      draftId: options.draftId,
      blocked: true,
      reason: 'not_in_registry',
      details: `Draft ${options.draftId} not found in registry. Only drafts created by this system can be sent.`,
    };
  }

  // Check 2: Send policy (enabled, kill switch, allowlist, rate limit)
  const policyResult = sendPolicy.checkSendPermission(options.to, todayCount);
  if (!policyResult.allowed) {
    metricsStore.recordAutoSendBlocked({
      trackingId,
      companyId,
      templateId,
      abVariant,
      draftId: options.draftId,
      reason: policyResult.reason!,
      details: policyResult.details,
      recipientDomain,
    });

    return {
      success: false,
      sent: false,
      dryRun: options.dryRun || false,
      draftId: options.draftId,
      blocked: true,
      reason: policyResult.reason,
      details: policyResult.details,
    };
  }

  // Check 3: Approval token validation
  const tokenResult = tokenManager.verifyToken(options.approvalToken);
  if (!tokenResult.valid) {
    metricsStore.recordAutoSendBlocked({
      trackingId,
      companyId,
      templateId,
      abVariant,
      draftId: options.draftId,
      reason: 'invalid_token',
      details: tokenResult.error,
      recipientDomain,
    });

    return {
      success: false,
      sent: false,
      dryRun: options.dryRun || false,
      draftId: options.draftId,
      blocked: true,
      reason: 'invalid_token',
      details: tokenResult.error,
    };
  }

  // Check 4: Token must match draft_id and tracking_id
  const tokenPayload = tokenResult.payload!;
  if (tokenPayload.draftId !== options.draftId) {
    metricsStore.recordAutoSendBlocked({
      trackingId,
      companyId,
      templateId,
      abVariant,
      draftId: options.draftId,
      reason: 'token_draft_mismatch',
      details: `Token draftId (${tokenPayload.draftId}) does not match requested draftId (${options.draftId})`,
      recipientDomain,
    });

    return {
      success: false,
      sent: false,
      dryRun: options.dryRun || false,
      draftId: options.draftId,
      blocked: true,
      reason: 'token_draft_mismatch',
      details: `Token draftId does not match requested draftId`,
    };
  }

  // Check tracking_id match if token has one
  if (tokenPayload.trackingId && tokenPayload.trackingId !== trackingId) {
    metricsStore.recordAutoSendBlocked({
      trackingId,
      companyId,
      templateId,
      abVariant,
      draftId: options.draftId,
      reason: 'token_draft_mismatch',
      details: `Token trackingId (${tokenPayload.trackingId}) does not match registry trackingId (${trackingId})`,
      recipientDomain,
    });

    return {
      success: false,
      sent: false,
      dryRun: options.dryRun || false,
      draftId: options.draftId,
      blocked: true,
      reason: 'token_draft_mismatch',
      details: `Token trackingId does not match registry trackingId`,
    };
  }

  // Check 5: PreSendGate (if subject/body provided)
  if (options.subject && options.body) {
    const gateResult = preSendGate.check({
      subject: options.subject,
      body: options.body,
      recipientEmail: options.to,
    });

    if (!gateResult.ok) {
      metricsStore.recordAutoSendBlocked({
        trackingId,
        companyId,
        templateId,
        abVariant,
        draftId: options.draftId,
        reason: 'gate_failed',
        details: gateResult.violations.join('; '),
        recipientDomain,
      });

      return {
        success: false,
        sent: false,
        dryRun: options.dryRun || false,
        draftId: options.draftId,
        blocked: true,
        reason: 'gate_failed',
        details: 'PreSendGate check failed',
        gateViolations: gateResult.violations,
      };
    }
  }

  // Dry run: don't actually send
  if (options.dryRun) {
    return {
      success: true,
      sent: false,
      dryRun: true,
      draftId: options.draftId,
      details: 'Dry run - all checks passed, would send',
    };
  }

  // Actually send the draft
  try {
    const gmailClient = new GmailClient();
    const result = await gmailClient.sendDraft(options.draftId);

    // Record success
    metricsStore.recordAutoSendSuccess({
      trackingId,
      companyId,
      templateId,
      abVariant,
      draftId: options.draftId,
      messageId: result.messageId,
      threadId: result.threadId,
      recipientDomain,
    });

    return {
      success: true,
      sent: true,
      dryRun: false,
      draftId: options.draftId,
      messageId: result.messageId,
      threadId: result.threadId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Record as blocked (send failed)
    metricsStore.recordAutoSendBlocked({
      trackingId,
      companyId,
      templateId,
      abVariant,
      draftId: options.draftId,
      reason: 'gate_failed', // Using gate_failed for send errors
      details: `Send failed: ${errorMessage}`,
      recipientDomain,
    });

    return {
      success: false,
      sent: false,
      dryRun: false,
      draftId: options.draftId,
      blocked: true,
      reason: 'gate_failed',
      details: `Send failed: ${errorMessage}`,
    };
  }
}

/**
 * CLI entry point
 */
async function main(): Promise<void> {
  const program = new Command();

  program
    .name('send_draft')
    .description('Send a Gmail draft with safety controls')
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
    .option('--json', 'Output JSON')
    .parse(process.argv);

  const opts = program.opts();

  const options: SendDraftOptions = {
    draftId: opts.draftId,
    to: opts.to,
    approvalToken: opts.approvalToken,
    trackingId: opts.trackingId,
    companyId: opts.companyId,
    templateId: opts.templateId,
    abVariant: opts.abVariant as 'A' | 'B' | undefined,
    subject: opts.subject,
    body: opts.body,
    dryRun: opts.dryRun,
    json: opts.json,
  };

  try {
    const result = await sendDraft(options);

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (result.success) {
        if (result.dryRun) {
          console.log('Dry run: All checks passed');
          console.log(`  Draft ID: ${result.draftId}`);
          console.log('  Would send if --dry-run was not specified');
        } else {
          console.log('Send successful!');
          console.log(`  Draft ID: ${result.draftId}`);
          console.log(`  Message ID: ${result.messageId}`);
          console.log(`  Thread ID: ${result.threadId}`);
        }
      } else {
        console.error('Send blocked:');
        console.error(`  Reason: ${result.reason}`);
        if (result.details) {
          console.error(`  Details: ${result.details}`);
        }
        if (result.gateViolations) {
          console.error('  Gate violations:');
          for (const v of result.gateViolations) {
            console.error(`    - ${v}`);
          }
        }
        process.exit(1);
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (opts.json) {
      console.log(JSON.stringify({ success: false, error: errorMessage }, null, 2));
    } else {
      console.error(`Error: ${errorMessage}`);
    }
    process.exit(1);
  }
}

// Export for testing
export { sendDraft, SendDraftOptions, SendResult };

// Run if called directly
if (require.main === module) {
  main();
}
