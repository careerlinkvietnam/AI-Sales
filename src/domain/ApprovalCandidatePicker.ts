/**
 * Approval Candidate Picker
 *
 * Automatically identifies approval candidates for weekly review meetings.
 * Helps speed up decision-making by prioritizing what needs attention.
 *
 * 制約:
 * - PII禁止（本文/宛先/candidate情報は禁止）
 * - 自動承認は禁止。提案（candidate）を提示するだけ
 * - 既存の承認フローを呼ぶ"ガイド"に徹する
 */

import { getExperimentScheduler } from './ExperimentScheduler';
import { getMetricsStore } from '../data/MetricsStore';
import { getIncidentManager } from './IncidentManager';
import { getFixProposalManager } from './FixProposalManager';
import { getRuntimeKillSwitch } from './RuntimeKillSwitch';
import { getSendPolicy } from './SendPolicy';

/**
 * Priority level for candidates
 */
export type CandidatePriority = 'P0' | 'P1' | 'P2';

/**
 * Template approval candidate
 */
export interface TemplateApprovalCandidate {
  id: string;
  templateId: string;
  experimentId: string;
  variant: 'A' | 'B';
  priority: CandidatePriority;
  rationale: string;
  recommendedCommand: string;
  guardrails: string[];
}

/**
 * Fix proposal candidate
 */
export interface FixProposalCandidate {
  id: string;
  proposalId: string;
  categoryId: string;
  priority: CandidatePriority;
  rationale: string;
  recommendedCommand: string;
  guardrails: string[];
}

/**
 * Ops candidate (dead_letter, kill switch, etc.)
 */
export interface OpsCandidate {
  id: string;
  type: 'dead_letter' | 'kill_switch' | 'queue_backlog' | 'data_cleanup' | 'incident_review';
  priority: CandidatePriority;
  rationale: string;
  recommendedCommand: string;
  guardrails: string[];
}

/**
 * Approval candidates result
 */
export interface ApprovalCandidates {
  generatedAt: string;
  period: { from: string; to: string };
  templates: TemplateApprovalCandidate[];
  fixes: FixProposalCandidate[];
  ops: OpsCandidate[];
  summary: {
    totalCandidates: number;
    p0Count: number;
    p1Count: number;
    p2Count: number;
  };
}

/**
 * Picker options
 */
export interface PickerOptions {
  since?: string;
  maxTemplates?: number;
  maxFixes?: number;
  maxOps?: number;
}

/**
 * Default options
 */
const DEFAULT_OPTIONS: Required<PickerOptions> = {
  since: '', // Will be calculated as 7 days ago
  maxTemplates: 3,
  maxFixes: 3,
  maxOps: 3,
};

/**
 * ApprovalCandidatePicker class
 */
export class ApprovalCandidatePicker {
  /**
   * Pick approval candidates
   */
  pick(options: PickerOptions = {}): ApprovalCandidates {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const now = new Date();
    const sinceDate = opts.since
      ? new Date(opts.since)
      : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const period = {
      from: sinceDate.toISOString().split('T')[0],
      to: now.toISOString().split('T')[0],
    };

    // Pick candidates from each category
    const templates = this.pickTemplates(sinceDate, opts.maxTemplates);
    const fixes = this.pickFixes(opts.maxFixes);
    const ops = this.pickOps(opts.maxOps);

    // Calculate summary
    const allCandidates = [...templates, ...fixes, ...ops];
    const summary = {
      totalCandidates: allCandidates.length,
      p0Count: allCandidates.filter(c => c.priority === 'P0').length,
      p1Count: allCandidates.filter(c => c.priority === 'P1').length,
      p2Count: allCandidates.filter(c => c.priority === 'P2').length,
    };

    return {
      generatedAt: now.toISOString(),
      period,
      templates,
      fixes,
      ops,
      summary,
    };
  }

  /**
   * Pick template approval candidates
   *
   * Conditions:
   * - proposed templates exist
   * - segment analysis shows poor performing areas
   * - exclude if min_sent not met
   */
  private pickTemplates(since: Date, max: number): TemplateApprovalCandidate[] {
    const candidates: TemplateApprovalCandidate[] = [];

    try {
      const scheduler = getExperimentScheduler();
      const result = scheduler.getActiveExperiment();

      if (!result.experiment) {
        return candidates;
      }

      const experimentId = result.experiment.experimentId;
      const templates = result.experiment.templates || [];

      // Find proposed templates
      const proposedTemplates = templates.filter(t => t.status === 'proposed');

      if (proposedTemplates.length === 0) {
        return candidates;
      }

      // Get metrics for analysis
      const metricsStore = getMetricsStore();
      const events = metricsStore.readEventsSince(since.toISOString());

      // Count sent and replies per template
      const templateStats: Map<string, { sent: number; replies: number; blocked: number }> = new Map();
      for (const event of events) {
        const templateId = event.templateId;
        if (!templateId) continue;

        const stats = templateStats.get(templateId) || { sent: 0, replies: 0, blocked: 0 };
        if (event.eventType === 'SENT_DETECTED' || event.eventType === 'DRAFT_CREATED') {
          stats.sent++;
        } else if (event.eventType === 'REPLY_DETECTED') {
          stats.replies++;
        } else if (event.eventType === 'AUTO_SEND_BLOCKED') {
          stats.blocked++;
        }
        templateStats.set(templateId, stats);
      }

      // Calculate overall stats
      let totalSent = 0;
      let totalReplies = 0;
      let totalBlocked = 0;
      for (const stats of templateStats.values()) {
        totalSent += stats.sent;
        totalReplies += stats.replies;
        totalBlocked += stats.blocked;
      }

      const overallReplyRate = totalSent > 0 ? totalReplies / totalSent : 0;
      const minSent = result.experiment.minSentPerVariant || 10;

      // Evaluate each proposed template
      for (const template of proposedTemplates) {
        const stats = templateStats.get(template.templateId);
        const sent = stats?.sent || 0;
        const replies = stats?.replies || 0;
        const blocked = stats?.blocked || 0;
        const replyRate = sent > 0 ? replies / sent : 0;

        // Determine priority and rationale
        let priority: CandidatePriority = 'P2';
        let rationale = '';
        const guardrails: string[] = [];

        if (sent < minSent) {
          guardrails.push(`min_sent未満 (${sent}/${minSent})`);
          rationale = `proposed template (sent=${sent}, min_sent未満のため評価保留)`;
        } else if (blocked > sent * 0.3) {
          // High block rate - might indicate content gate issues
          priority = 'P0';
          rationale = `高いブロック率 (blocked=${blocked}, sent=${sent}, rate=${(blocked / (sent + blocked) * 100).toFixed(1)}%)`;
        } else if (replyRate < overallReplyRate * 0.5) {
          // Significantly worse than overall
          priority = 'P0';
          rationale = `返信率が全体平均の50%未満 (rate=${(replyRate * 100).toFixed(1)}% vs avg=${(overallReplyRate * 100).toFixed(1)}%)`;
        } else if (replyRate < overallReplyRate * 0.8) {
          priority = 'P1';
          rationale = `返信率が全体平均の80%未満 (rate=${(replyRate * 100).toFixed(1)}% vs avg=${(overallReplyRate * 100).toFixed(1)}%)`;
        } else {
          rationale = `proposed template (sent=${sent}, replies=${replies}, rate=${(replyRate * 100).toFixed(1)}%)`;
        }

        // Check experiment status
        if (result.experiment.status === 'paused') {
          guardrails.push('experiment is paused');
        }

        candidates.push({
          id: `tmpl-${template.templateId}`,
          templateId: template.templateId,
          experimentId,
          variant: template.variant,
          priority,
          rationale,
          recommendedCommand: `npx ts-node src/cli/run_ops.ts approve --experiment "${experimentId}" --template-id "${template.templateId}" --approved-by "reviewer" --reason "..."`,
          guardrails,
        });
      }
    } catch {
      // Experiment scheduler may fail if no experiments.json
    }

    // Sort by priority and limit
    return this.sortByPriority(candidates).slice(0, max);
  }

  /**
   * Pick fix proposal candidates
   *
   * Conditions:
   * - status=proposed
   * Priority:
   * - P0: auto_stop_triggered
   * - P1: gmail_api / token_or_registry / experiment_health
   * - P2: ramp_limited, others
   */
  private pickFixes(max: number): FixProposalCandidate[] {
    const candidates: FixProposalCandidate[] = [];

    try {
      const fixManager = getFixProposalManager();
      const proposals = fixManager.listProposals({ status: 'proposed' });

      for (const proposal of proposals) {
        const categoryId = proposal.category_id;
        let priority: CandidatePriority = 'P2';

        // Determine priority based on category
        if (categoryId === 'auto_stop_triggered') {
          priority = 'P0';
        } else if (['gmail_api', 'token_or_registry', 'experiment_health'].includes(categoryId)) {
          priority = 'P1';
        }

        const guardrails: string[] = [];

        // Check if there are related open incidents
        const incidentManager = getIncidentManager();
        const openIncidents = incidentManager.listIncidents({ status: 'open' });
        if (openIncidents.length > 0) {
          guardrails.push(`${openIncidents.length} open incident(s) - review incidents first`);
        }

        candidates.push({
          id: `fix-${proposal.proposal_id}`,
          proposalId: proposal.proposal_id,
          categoryId,
          priority,
          rationale: `[${proposal.priority}] ${proposal.title}`,
          recommendedCommand: `npx ts-node src/cli/run_ops.ts fixes-accept ${proposal.proposal_id} --actor "reviewer" --reason "..."`,
          guardrails,
        });
      }
    } catch {
      // FixProposalManager may fail
    }

    // Sort by priority and limit
    return this.sortByPriority(candidates).slice(0, max);
  }

  /**
   * Pick ops candidates
   *
   * P0: dead_letter > 0, kill switch active with open incidents
   * P1: queue backlog, reap issues, data cleanup
   */
  private pickOps(max: number): OpsCandidate[] {
    const candidates: OpsCandidate[] = [];

    // Check dead_letter queue
    try {
      const { getSendQueueManager } = require('./SendQueueManager');
      const manager = getSendQueueManager();
      const counts = manager.getStatusCounts();

      if (counts.dead_letter > 0) {
        candidates.push({
          id: 'ops-dead-letter',
          type: 'dead_letter',
          priority: 'P0',
          rationale: `dead_letter queue has ${counts.dead_letter} job(s) requiring attention`,
          recommendedCommand: 'npx ts-node src/cli/run_ops.ts send-queue dead-letter list',
          guardrails: ['Review each job before retry or cancel'],
        });
      }

      // Check queue backlog
      if (counts.queued > 50) {
        candidates.push({
          id: 'ops-queue-backlog',
          type: 'queue_backlog',
          priority: 'P1',
          rationale: `queue backlog: ${counts.queued} queued, ${counts.in_progress} in_progress`,
          recommendedCommand: 'npx ts-node src/cli/run_ops.ts send-queue status',
          guardrails: ['Check if send policy is enabled', 'Review ramp settings'],
        });
      }
    } catch {
      // SendQueueManager may not be available
    }

    // Check kill switch status
    try {
      const killSwitch = getRuntimeKillSwitch();
      const policy = getSendPolicy();
      const isActive = killSwitch.isEnabled() || policy.getConfig().killSwitch;

      if (isActive) {
        const incidentManager = getIncidentManager();
        const openIncidents = incidentManager.listIncidents({ status: 'open' });

        candidates.push({
          id: 'ops-kill-switch',
          type: 'kill_switch',
          priority: openIncidents.length > 0 ? 'P0' : 'P1',
          rationale: `kill switch is ACTIVE${openIncidents.length > 0 ? ` with ${openIncidents.length} open incident(s)` : ''}`,
          recommendedCommand: 'npx ts-node src/cli/run_ops.ts stop-status',
          guardrails: ['Resolve incidents before resuming', 'Run resume-check before resume-send'],
        });
      }
    } catch {
      // Kill switch check may fail
    }

    // Check open incidents for review
    try {
      const incidentManager = getIncidentManager();
      const openIncidents = incidentManager.listIncidents({ status: 'open' });

      if (openIncidents.length > 0) {
        candidates.push({
          id: 'ops-incident-review',
          type: 'incident_review',
          priority: openIncidents.length >= 3 ? 'P0' : 'P1',
          rationale: `${openIncidents.length} open incident(s) require review`,
          recommendedCommand: 'npx ts-node src/cli/run_ops.ts incidents --status open',
          guardrails: ['Review root cause before closing', 'Document resolution in notes'],
        });
      }
    } catch {
      // Incident manager may fail
    }

    // Check data file sizes
    try {
      const { getDataFileStatus, formatBytes } = require('../data/NdjsonCompactor');
      const path = require('path');
      const dataDir = path.join(process.cwd(), 'data');
      const files = ['send_queue', 'metrics', 'incidents'];
      const largeFiles: string[] = [];

      for (const name of files) {
        const filePath = path.join(dataDir, `${name}.ndjson`);
        const status = getDataFileStatus(filePath);
        if (status.exists && status.sizeBytes > 50 * 1024 * 1024) { // > 50MB
          largeFiles.push(`${name} (${formatBytes(status.sizeBytes)})`);
        }
      }

      if (largeFiles.length > 0) {
        candidates.push({
          id: 'ops-data-cleanup',
          type: 'data_cleanup',
          priority: 'P1',
          rationale: `Large data files: ${largeFiles.join(', ')}`,
          recommendedCommand: 'npx ts-node src/cli/run_ops.ts compact --target all --execute',
          guardrails: ['Backup data before compaction', 'Run in dry-run mode first'],
        });
      }
    } catch {
      // Data file check may fail
    }

    // Sort by priority and limit
    return this.sortByPriority(candidates).slice(0, max);
  }

  /**
   * Sort candidates by priority (P0 > P1 > P2)
   */
  private sortByPriority<T extends { priority: CandidatePriority }>(candidates: T[]): T[] {
    const priorityOrder = { P0: 0, P1: 1, P2: 2 };
    return [...candidates].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  }

  /**
   * Generate markdown report
   */
  generateMarkdown(result: ApprovalCandidates): string {
    const lines: string[] = [];

    lines.push('# Approval Candidates');
    lines.push('');
    lines.push(`**Period**: ${result.period.from} ~ ${result.period.to}`);
    lines.push(`**Generated**: ${result.generatedAt}`);
    lines.push('');
    lines.push(`**Summary**: ${result.summary.totalCandidates} candidate(s) - P0: ${result.summary.p0Count}, P1: ${result.summary.p1Count}, P2: ${result.summary.p2Count}`);
    lines.push('');

    // Templates section
    lines.push('## 1. Template Approval Candidates');
    lines.push('');
    if (result.templates.length === 0) {
      lines.push('No template approval candidates.');
    } else {
      for (const t of result.templates) {
        lines.push(`### [${t.priority}] ${t.templateId}`);
        lines.push('');
        lines.push(`- **Experiment**: ${t.experimentId}`);
        lines.push(`- **Variant**: ${t.variant}`);
        lines.push(`- **Rationale**: ${t.rationale}`);
        if (t.guardrails.length > 0) {
          lines.push(`- **Guardrails**: ${t.guardrails.join(', ')}`);
        }
        lines.push(`- **Command**:`);
        lines.push(`  \`\`\`bash`);
        lines.push(`  ${t.recommendedCommand}`);
        lines.push(`  \`\`\``);
        lines.push('');
      }
    }
    lines.push('');

    // Fixes section
    lines.push('## 2. Fix Proposal Candidates');
    lines.push('');
    if (result.fixes.length === 0) {
      lines.push('No fix proposal candidates.');
    } else {
      for (const f of result.fixes) {
        lines.push(`### [${f.priority}] ${f.proposalId}`);
        lines.push('');
        lines.push(`- **Category**: ${f.categoryId}`);
        lines.push(`- **Rationale**: ${f.rationale}`);
        if (f.guardrails.length > 0) {
          lines.push(`- **Guardrails**: ${f.guardrails.join(', ')}`);
        }
        lines.push(`- **Command**:`);
        lines.push(`  \`\`\`bash`);
        lines.push(`  ${f.recommendedCommand}`);
        lines.push(`  \`\`\``);
        lines.push('');
      }
    }
    lines.push('');

    // Ops section
    lines.push('## 3. Ops Candidates');
    lines.push('');
    if (result.ops.length === 0) {
      lines.push('No ops candidates.');
    } else {
      for (const o of result.ops) {
        lines.push(`### [${o.priority}] ${o.type}`);
        lines.push('');
        lines.push(`- **Rationale**: ${o.rationale}`);
        if (o.guardrails.length > 0) {
          lines.push(`- **Guardrails**: ${o.guardrails.join(', ')}`);
        }
        lines.push(`- **Command**:`);
        lines.push(`  \`\`\`bash`);
        lines.push(`  ${o.recommendedCommand}`);
        lines.push(`  \`\`\``);
        lines.push('');
      }
    }
    lines.push('');

    // Footer
    lines.push('---');
    lines.push('');
    lines.push('**Note**: This is a guide only. No automatic approvals are performed.');
    lines.push('Review each candidate and run the recommended commands manually.');
    lines.push('');

    return lines.join('\n');
  }
}

/**
 * Default picker instance
 */
let defaultPicker: ApprovalCandidatePicker | null = null;

/**
 * Get default ApprovalCandidatePicker
 */
export function getApprovalCandidatePicker(): ApprovalCandidatePicker {
  if (!defaultPicker) {
    defaultPicker = new ApprovalCandidatePicker();
  }
  return defaultPicker;
}

/**
 * Reset default picker (for testing)
 */
export function resetApprovalCandidatePicker(): void {
  defaultPicker = null;
}

export default ApprovalCandidatePicker;
