#!/usr/bin/env npx ts-node
/**
 * Approve Send CLI
 *
 * Issues an approval token for sending a draft.
 * This is the authorization step before send_draft can be called.
 *
 * 必須引数:
 * - --draft-id: 承認対象の下書きID（DraftRegistryに存在すること）
 * - --approved-by: 承認者名/ID
 * - --reason: 承認理由
 *
 * オプション:
 * - --ticket: 参照チケット番号
 * - --json: JSON出力
 *
 * 動作:
 * 1. DraftRegistryからdraft_idを検索し、tracking_id等を取得
 * 2. 存在しなければ拒否
 * 3. ApprovalTokenを発行（ペイロードにtracking_id + draft_id含む）
 * 4. data/approvals.ndjsonに承認ログを追記（type="send"）
 * 5. トークンを標準出力に返す
 *
 * 注意:
 * - トークン全文は保存しない（fingerprintのみ）
 * - この承認がないdraftは送れない運用を強制する
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { getDraftRegistry, DraftEntry } from '../data/DraftRegistry';
import { getApprovalTokenManager } from '../domain/ApprovalToken';
import { getMetricsStore } from '../data/MetricsStore';

/**
 * Approval log entry structure
 */
interface SendApprovalLogEntry {
  timestamp: string;
  type: 'send';
  draftId: string;
  trackingId: string;
  companyId: string;
  templateId: string;
  abVariant: 'A' | 'B' | null;
  approvedBy: string;
  reason: string;
  ticket?: string;
  tokenFingerprint: string;
}

/**
 * Result structure for approve send
 */
interface ApproveSendResult {
  success: boolean;
  draftId: string;
  trackingId?: string;
  companyId?: string;
  templateId?: string;
  abVariant?: 'A' | 'B' | null;
  approvalToken?: string;
  tokenFingerprint?: string;
  error?: string;
}

/**
 * Default data directory for approvals
 */
const DEFAULT_APPROVALS_PATH = path.join('data', 'approvals.ndjson');

/**
 * Append approval log entry
 */
function appendApprovalLog(entry: SendApprovalLogEntry): void {
  const dir = path.dirname(DEFAULT_APPROVALS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(DEFAULT_APPROVALS_PATH, line, 'utf-8');
}

/**
 * Main approve send function
 */
function approveSend(options: {
  draftId: string;
  approvedBy: string;
  reason: string;
  ticket?: string;
}): ApproveSendResult {
  const draftRegistry = getDraftRegistry();
  const tokenManager = getApprovalTokenManager();
  const metricsStore = getMetricsStore();

  // Step 1: Look up draft in registry
  const lookup = draftRegistry.lookupByDraftId(options.draftId);

  if (!lookup.found || !lookup.entry) {
    return {
      success: false,
      draftId: options.draftId,
      error: `Draft ${options.draftId} not found in registry. Only drafts created by this system can be approved.`,
    };
  }

  const entry: DraftEntry = lookup.entry;

  // Step 2: Generate approval token with tracking_id
  const approvalToken = tokenManager.generateToken({
    draftId: entry.draftId,
    companyId: entry.companyId,
    trackingId: entry.trackingId,
    candidateCount: 0, // Not tracked at approval time
    mode: 'real', // Assume real mode for approvals
  });

  // Step 3: Generate token fingerprint (for logging without storing full token)
  const tokenFingerprint = tokenManager.generateTokenFingerprint(approvalToken);

  // Step 4: Append to approvals log
  const logEntry: SendApprovalLogEntry = {
    timestamp: new Date().toISOString(),
    type: 'send',
    draftId: entry.draftId,
    trackingId: entry.trackingId,
    companyId: entry.companyId,
    templateId: entry.templateId,
    abVariant: entry.abVariant,
    approvedBy: options.approvedBy,
    reason: options.reason,
    ticket: options.ticket,
    tokenFingerprint,
  };
  appendApprovalLog(logEntry);

  // Step 5: Record SEND_APPROVED event in metrics
  metricsStore.recordSendApproved({
    trackingId: entry.trackingId,
    companyId: entry.companyId,
    templateId: entry.templateId,
    abVariant: entry.abVariant,
    draftId: entry.draftId,
    approvedBy: options.approvedBy,
    tokenFingerprint,
  });

  return {
    success: true,
    draftId: entry.draftId,
    trackingId: entry.trackingId,
    companyId: entry.companyId,
    templateId: entry.templateId,
    abVariant: entry.abVariant,
    approvalToken,
    tokenFingerprint,
  };
}

/**
 * CLI entry point
 */
async function main(): Promise<void> {
  const program = new Command();

  program
    .name('approve_send')
    .description('Issue approval token for sending a draft')
    .requiredOption('--draft-id <id>', 'Gmail draft ID to approve')
    .requiredOption('--approved-by <name>', 'Approver name/ID')
    .requiredOption('--reason <reason>', 'Approval reason')
    .option('--ticket <ticket>', 'Reference ticket (e.g., JIRA-123)')
    .option('--json', 'Output JSON')
    .parse(process.argv);

  const opts = program.opts();

  const result = approveSend({
    draftId: opts.draftId,
    approvedBy: opts.approvedBy,
    reason: opts.reason,
    ticket: opts.ticket,
  });

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.success) {
      console.log('Approval successful!');
      console.log(`  Draft ID: ${result.draftId}`);
      console.log(`  Tracking ID: ${result.trackingId}`);
      console.log(`  Company ID: ${result.companyId}`);
      console.log(`  Template ID: ${result.templateId}`);
      console.log(`  A/B Variant: ${result.abVariant || 'N/A'}`);
      console.log(`  Token Fingerprint: ${result.tokenFingerprint}`);
      console.log('');
      console.log('Approval Token (use with send_draft --approval-token):');
      console.log(result.approvalToken);
    } else {
      console.error('Approval failed:');
      console.error(`  ${result.error}`);
      process.exit(1);
    }
  }
}

// Export for testing
export { approveSend, ApproveSendResult, SendApprovalLogEntry };

// Run if called directly
if (require.main === module) {
  main();
}
