/**
 * Review Pack Builder
 *
 * Generates a consolidated weekly review pack (Markdown) for team review meetings.
 * All content is PII-free.
 *
 * 設計:
 * - 既存CLI/モジュールからデータを取得
 * - Markdown形式で出力（最大数百行）
 * - "今週やること"を自動生成
 */

import * as path from 'path';
import { getMetricsStore, MetricsEvent } from '../data/MetricsStore';
import { getIncidentManager } from './IncidentManager';
import { getFixProposalManager } from './FixProposalManager';
import { getExperimentScheduler } from './ExperimentScheduler';
import { getSendPolicy } from './SendPolicy';
import { getRuntimeKillSwitch } from './RuntimeKillSwitch';
import { getDataFileStatus, formatBytes } from '../data/NdjsonCompactor';

/**
 * Review Pack KPI Summary
 */
export interface KPISummary {
  period: { from: string; to: string };
  sent: number;
  replies: number;
  replyRate: number | null;
  blocked: number;
  blockedRate: number | null;
  deadLetter: number;
  queued: number;
  inProgress: number;
}

/**
 * Experiment Status Summary
 */
export interface ExperimentSummary {
  activeExperimentId: string | null;
  activeTemplates: number;
  proposedTemplates: number;
  pausedExperiments: number;
  endedExperiments: number;
  recentWinner?: {
    experimentId: string;
    variant: 'A' | 'B';
    decision?: string;
  };
}

/**
 * Segment Insight
 */
export interface SegmentInsight {
  segmentId: string;
  label: string;
  sent: number;
  replies: number;
  replyRate: number;
  isGood: boolean;
}

/**
 * Incident Summary
 */
export interface IncidentSummary {
  openCount: number;
  mitigatedCount: number;
  closedCount: number;
  topCategories: Array<{ category: string; count: number }>;
  openIncidents: Array<{ id: string; errorCode: string; firstSeen: string }>;
}

/**
 * Fix Proposal Summary
 */
export interface FixProposalSummary {
  proposedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  implementedCount: number;
  proposals: Array<{
    id: string;
    priority: string;
    title: string;
    status: string;
    categoryId: string;
  }>;
}

/**
 * Data File Status
 */
export interface DataStatusSummary {
  files: Array<{
    name: string;
    lines: number;
    size: string;
    sizeBytes: number;
  }>;
}

/**
 * Action Item
 */
export interface ActionItem {
  priority: 'high' | 'medium' | 'low';
  action: string;
  command?: string;
}

/**
 * Review Pack
 */
export interface ReviewPack {
  generatedAt: string;
  period: { from: string; to: string };
  kpi: KPISummary;
  experiments: ExperimentSummary;
  segments: {
    good: SegmentInsight[];
    bad: SegmentInsight[];
  };
  incidents: IncidentSummary;
  fixes: FixProposalSummary;
  dataStatus: DataStatusSummary;
  actions: ActionItem[];
  markdown: string;
}

/**
 * Build Options
 */
export interface ReviewPackBuildOptions {
  since?: string;
  minSent?: number;
}

/**
 * ReviewPackBuilder class
 */
export class ReviewPackBuilder {
  /**
   * Build review pack
   */
  async build(options: ReviewPackBuildOptions = {}): Promise<ReviewPack> {
    const now = new Date();
    const sinceDate = options.since
      ? new Date(options.since)
      : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const minSent = options.minSent ?? 5;

    const period = {
      from: sinceDate.toISOString().split('T')[0],
      to: now.toISOString().split('T')[0],
    };

    // Gather data from various sources
    const kpi = this.gatherKPI(sinceDate, now);
    const experiments = this.gatherExperiments();
    const segments = this.gatherSegments(sinceDate, now, minSent);
    const incidents = this.gatherIncidents();
    const fixes = this.gatherFixes();
    const dataStatus = this.gatherDataStatus();
    const actions = this.generateActions(kpi, experiments, incidents, fixes);

    // Generate markdown
    const markdown = this.generateMarkdown({
      generatedAt: now.toISOString(),
      period,
      kpi,
      experiments,
      segments,
      incidents,
      fixes,
      dataStatus,
      actions,
    });

    return {
      generatedAt: now.toISOString(),
      period,
      kpi,
      experiments,
      segments,
      incidents,
      fixes,
      dataStatus,
      actions,
      markdown,
    };
  }

  /**
   * Gather KPI summary
   */
  private gatherKPI(since: Date, until: Date): KPISummary {
    const metricsStore = getMetricsStore();
    const events = metricsStore.readEventsSince(since.toISOString());

    let sent = 0;
    let replies = 0;
    let blocked = 0;

    for (const event of events) {
      if (event.eventType === 'SENT_DETECTED' || event.eventType === 'DRAFT_CREATED') {
        sent++;
      } else if (event.eventType === 'REPLY_DETECTED') {
        replies++;
      } else if (event.eventType === 'AUTO_SEND_BLOCKED') {
        blocked++;
      }
    }

    // Get queue status
    let queued = 0;
    let inProgress = 0;
    let deadLetter = 0;
    try {
      const { getSendQueueManager } = require('./SendQueueManager');
      const manager = getSendQueueManager();
      const counts = manager.getStatusCounts();
      queued = counts.queued;
      inProgress = counts.in_progress;
      deadLetter = counts.dead_letter;
    } catch {
      // SendQueueManager may not be available
    }

    const totalAttempts = sent + blocked;
    const replyRate = sent > 0 ? replies / sent : null;
    const blockedRate = totalAttempts > 0 ? blocked / totalAttempts : null;

    return {
      period: {
        from: since.toISOString().split('T')[0],
        to: until.toISOString().split('T')[0],
      },
      sent,
      replies,
      replyRate,
      blocked,
      blockedRate,
      deadLetter,
      queued,
      inProgress,
    };
  }

  /**
   * Gather experiment status
   */
  private gatherExperiments(): ExperimentSummary {
    const scheduler = getExperimentScheduler();
    const result = scheduler.getActiveExperiment();

    let activeTemplates = 0;
    let proposedTemplates = 0;
    let pausedExperiments = 0;
    let endedExperiments = 0;

    if (result.experiment) {
      // Count templates
      const templates = result.experiment.templates;
      if (templates && Array.isArray(templates)) {
        for (const template of templates) {
          if (template.status === 'active') {
            activeTemplates++;
          } else if (template.status === 'proposed') {
            proposedTemplates++;
          }
        }
      }
      // Check experiment status
      if (result.experiment.status === 'paused') {
        pausedExperiments = 1;
      } else if (result.experiment.status === 'ended') {
        endedExperiments = 1;
      }
    }

    return {
      activeExperimentId: result.experiment?.experimentId || null,
      activeTemplates,
      proposedTemplates,
      pausedExperiments,
      endedExperiments,
    };
  }

  /**
   * Gather segment insights
   */
  private gatherSegments(since: Date, until: Date, minSent: number): { good: SegmentInsight[]; bad: SegmentInsight[] } {
    const metricsStore = getMetricsStore();
    const events = metricsStore.readEventsSince(since.toISOString());

    // Group by segment
    const segmentStats: Map<string, { sent: number; replies: number; label: string }> = new Map();

    for (const event of events) {
      const segment = (event as MetricsEvent & { segment_id?: string; segment_label?: string }).segment_id;
      const label = (event as MetricsEvent & { segment_label?: string }).segment_label || segment || 'unknown';

      if (!segment) continue;

      const stats = segmentStats.get(segment) || { sent: 0, replies: 0, label };

      if (event.eventType === 'SENT_DETECTED' || event.eventType === 'DRAFT_CREATED') {
        stats.sent++;
      } else if (event.eventType === 'REPLY_DETECTED') {
        stats.replies++;
      }

      segmentStats.set(segment, stats);
    }

    // Calculate reply rates and filter by minSent
    const insights: SegmentInsight[] = [];
    for (const [segmentId, stats] of segmentStats) {
      if (stats.sent >= minSent) {
        const replyRate = stats.sent > 0 ? stats.replies / stats.sent : 0;
        insights.push({
          segmentId,
          label: stats.label,
          sent: stats.sent,
          replies: stats.replies,
          replyRate,
          isGood: replyRate >= 0.10, // 10% is considered good
        });
      }
    }

    // Sort and pick top 3 good and bad
    const sortedByRate = [...insights].sort((a, b) => b.replyRate - a.replyRate);
    const good = sortedByRate.filter(s => s.isGood).slice(0, 3);
    const bad = sortedByRate.filter(s => !s.isGood).slice(-3).reverse();

    return { good, bad };
  }

  /**
   * Gather incident summary
   */
  private gatherIncidents(): IncidentSummary {
    const incidentManager = getIncidentManager();

    const openIncidents = incidentManager.listIncidents({ status: 'open' });
    const mitigatedIncidents = incidentManager.listIncidents({ status: 'mitigated' });
    const closedIncidents = incidentManager.listIncidents({ status: 'closed' });

    // Get top categories by trigger_type
    const categoryCounts: Map<string, number> = new Map();
    for (const incident of [...openIncidents, ...mitigatedIncidents]) {
      const category = incident.trigger_type || 'uncategorized';
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    }

    const topCategories = Array.from(categoryCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, count]) => ({ category, count }));

    return {
      openCount: openIncidents.length,
      mitigatedCount: mitigatedIncidents.length,
      closedCount: closedIncidents.length,
      topCategories,
      openIncidents: openIncidents.slice(0, 10).map(i => ({
        id: i.incident_id,
        errorCode: i.severity,
        firstSeen: i.created_at,
      })),
    };
  }

  /**
   * Gather fix proposals
   */
  private gatherFixes(): FixProposalSummary {
    const fixManager = getFixProposalManager();

    const proposed = fixManager.listProposals({ status: 'proposed' });
    const accepted = fixManager.listProposals({ status: 'accepted' });
    const rejected = fixManager.listProposals({ status: 'rejected' });
    const implemented = fixManager.listProposals({ status: 'implemented' });

    // Combine proposed and accepted for display
    const displayProposals = [...proposed, ...accepted].slice(0, 10).map(p => ({
      id: p.proposal_id,
      priority: p.priority,
      title: p.title,
      status: p.status,
      categoryId: p.category_id,
    }));

    return {
      proposedCount: proposed.length,
      acceptedCount: accepted.length,
      rejectedCount: rejected.length,
      implementedCount: implemented.length,
      proposals: displayProposals,
    };
  }

  /**
   * Gather data file status
   */
  private gatherDataStatus(): DataStatusSummary {
    const dataDir = path.join(process.cwd(), 'data');
    const fileNames = ['send_queue', 'metrics', 'incidents', 'fix_proposals', 'approvals'];

    const files: DataStatusSummary['files'] = [];
    for (const name of fileNames) {
      const filePath = path.join(dataDir, `${name}.ndjson`);
      const status = getDataFileStatus(filePath);
      if (status.exists) {
        files.push({
          name,
          lines: status.lines,
          size: formatBytes(status.sizeBytes),
          sizeBytes: status.sizeBytes,
        });
      }
    }

    return { files };
  }

  /**
   * Generate action items based on current state
   */
  private generateActions(
    kpi: KPISummary,
    experiments: ExperimentSummary,
    incidents: IncidentSummary,
    fixes: FixProposalSummary
  ): ActionItem[] {
    const actions: ActionItem[] = [];

    // Dead letter queue
    if (kpi.deadLetter > 0) {
      actions.push({
        priority: 'high',
        action: `Dead letter queue has ${kpi.deadLetter} job(s) - review and retry/cancel`,
        command: 'npx ts-node src/cli/run_ops.ts send-queue status',
      });
    }

    // Open incidents
    if (incidents.openCount > 0) {
      actions.push({
        priority: 'high',
        action: `${incidents.openCount} open incident(s) - investigate and mitigate/close`,
        command: 'npx ts-node src/cli/run_ops.ts incidents --status open',
      });
    }

    // Proposed templates
    if (experiments.proposedTemplates > 0) {
      actions.push({
        priority: 'medium',
        action: `${experiments.proposedTemplates} proposed template(s) - review and approve/reject`,
        command: 'npx ts-node src/cli/run_ops.ts status',
      });
    }

    // Proposed fixes
    if (fixes.proposedCount > 0) {
      actions.push({
        priority: 'medium',
        action: `${fixes.proposedCount} proposed fix(es) - review and accept/reject`,
        command: 'npx ts-node src/cli/run_ops.ts fixes --status proposed',
      });
    }

    // Accepted fixes not implemented
    if (fixes.acceptedCount > 0) {
      actions.push({
        priority: 'medium',
        action: `${fixes.acceptedCount} accepted fix(es) pending implementation`,
        command: 'npx ts-node src/cli/run_ops.ts fixes --status accepted',
      });
    }

    // Low reply rate warning
    if (kpi.replyRate !== null && kpi.replyRate < 0.05 && kpi.sent >= 10) {
      actions.push({
        priority: 'medium',
        action: `Low reply rate (${(kpi.replyRate * 100).toFixed(1)}%) - review templates and targeting`,
        command: 'npx ts-node src/cli/run_ops.ts safety',
      });
    }

    // High blocked rate
    if (kpi.blockedRate !== null && kpi.blockedRate > 0.3) {
      actions.push({
        priority: 'low',
        action: `High blocked rate (${(kpi.blockedRate * 100).toFixed(1)}%) - review allowlist/ramp settings`,
        command: 'npx ts-node src/cli/run_ops.ts ramp-status',
      });
    }

    // Sort by priority and limit to 5
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return actions.slice(0, 5);
  }

  /**
   * Generate Markdown report
   */
  private generateMarkdown(pack: Omit<ReviewPack, 'markdown'>): string {
    const lines: string[] = [];

    // Header
    lines.push('# Weekly Review Pack');
    lines.push('');
    lines.push(`**Period**: ${pack.period.from} ~ ${pack.period.to}`);
    lines.push(`**Generated**: ${pack.generatedAt}`);
    lines.push('');

    // 今週やること (Actions)
    lines.push('## 今週やること');
    lines.push('');
    if (pack.actions.length === 0) {
      lines.push('- No immediate actions required');
    } else {
      for (const action of pack.actions) {
        const priorityBadge = action.priority === 'high' ? '[HIGH]' : action.priority === 'medium' ? '[MED]' : '[LOW]';
        lines.push(`- ${priorityBadge} ${action.action}`);
        if (action.command) {
          lines.push(`  - \`${action.command}\``);
        }
      }
    }
    lines.push('');

    // KPI Summary
    lines.push('## 1. KPI Summary');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Sent | ${pack.kpi.sent} |`);
    lines.push(`| Replies | ${pack.kpi.replies} |`);
    lines.push(`| Reply Rate | ${pack.kpi.replyRate !== null ? (pack.kpi.replyRate * 100).toFixed(1) + '%' : 'N/A'} |`);
    lines.push(`| Blocked | ${pack.kpi.blocked} |`);
    lines.push(`| Blocked Rate | ${pack.kpi.blockedRate !== null ? (pack.kpi.blockedRate * 100).toFixed(1) + '%' : 'N/A'} |`);
    lines.push(`| Queue (queued) | ${pack.kpi.queued} |`);
    lines.push(`| Queue (in_progress) | ${pack.kpi.inProgress} |`);
    lines.push(`| Queue (dead_letter) | ${pack.kpi.deadLetter} |`);
    lines.push('');

    // Experiment Status
    lines.push('## 2. Experiment Status');
    lines.push('');
    if (pack.experiments.activeExperimentId) {
      lines.push(`**Active Experiment**: ${pack.experiments.activeExperimentId}`);
    } else {
      lines.push('**Active Experiment**: None');
    }
    lines.push('');
    lines.push('| Status | Count |');
    lines.push('|--------|-------|');
    lines.push(`| Active Templates | ${pack.experiments.activeTemplates} |`);
    lines.push(`| Proposed Templates | ${pack.experiments.proposedTemplates} |`);
    lines.push(`| Paused Experiments | ${pack.experiments.pausedExperiments} |`);
    lines.push(`| Ended Experiments | ${pack.experiments.endedExperiments} |`);
    lines.push('');

    // Segment Insights
    lines.push('## 3. Segment Insights');
    lines.push('');
    lines.push('> Note: Based on exploratory analysis. Use with caution.');
    lines.push('');

    if (pack.segments.good.length > 0) {
      lines.push('### High-Performing Segments');
      lines.push('');
      lines.push('| Segment | Sent | Replies | Rate |');
      lines.push('|---------|------|---------|------|');
      for (const seg of pack.segments.good) {
        lines.push(`| ${seg.label} | ${seg.sent} | ${seg.replies} | ${(seg.replyRate * 100).toFixed(1)}% |`);
      }
      lines.push('');
    }

    if (pack.segments.bad.length > 0) {
      lines.push('### Low-Performing Segments');
      lines.push('');
      lines.push('| Segment | Sent | Replies | Rate |');
      lines.push('|---------|------|---------|------|');
      for (const seg of pack.segments.bad) {
        lines.push(`| ${seg.label} | ${seg.sent} | ${seg.replies} | ${(seg.replyRate * 100).toFixed(1)}% |`);
      }
      lines.push('');
    }

    if (pack.segments.good.length === 0 && pack.segments.bad.length === 0) {
      lines.push('No segment data available (min-sent threshold not met).');
      lines.push('');
    }

    // Incidents
    lines.push('## 4. Incidents');
    lines.push('');
    lines.push(`**Open**: ${pack.incidents.openCount} | **Mitigated**: ${pack.incidents.mitigatedCount} | **Closed**: ${pack.incidents.closedCount}`);
    lines.push('');

    if (pack.incidents.topCategories.length > 0) {
      lines.push('### Top Categories');
      lines.push('');
      lines.push('| Category | Count |');
      lines.push('|----------|-------|');
      for (const cat of pack.incidents.topCategories) {
        lines.push(`| ${cat.category} | ${cat.count} |`);
      }
      lines.push('');
    }

    if (pack.incidents.openIncidents.length > 0) {
      lines.push('### Open Incidents');
      lines.push('');
      lines.push('| ID | Error Code | First Seen |');
      lines.push('|----|------------|------------|');
      for (const inc of pack.incidents.openIncidents) {
        lines.push(`| ${inc.id} | ${inc.errorCode} | ${inc.firstSeen.split('T')[0]} |`);
      }
      lines.push('');
    }

    // Fix Proposals
    lines.push('## 5. Fix Proposals');
    lines.push('');
    lines.push(`**Proposed**: ${pack.fixes.proposedCount} | **Accepted**: ${pack.fixes.acceptedCount} | **Rejected**: ${pack.fixes.rejectedCount} | **Implemented**: ${pack.fixes.implementedCount}`);
    lines.push('');

    if (pack.fixes.proposals.length > 0) {
      lines.push('### Pending Review');
      lines.push('');
      lines.push('| Priority | Status | Title | Category |');
      lines.push('|----------|--------|-------|----------|');
      for (const fix of pack.fixes.proposals) {
        lines.push(`| ${fix.priority} | ${fix.status} | ${fix.title} | ${fix.categoryId} |`);
      }
      lines.push('');
    }

    // Data Status
    lines.push('## 6. Data Files');
    lines.push('');
    if (pack.dataStatus.files.length > 0) {
      lines.push('| File | Lines | Size |');
      lines.push('|------|-------|------|');
      for (const file of pack.dataStatus.files) {
        lines.push(`| ${file.name} | ${file.lines.toLocaleString()} | ${file.size} |`);
      }
      lines.push('');
    } else {
      lines.push('No data files found.');
      lines.push('');
    }

    // Footer
    lines.push('---');
    lines.push('');
    lines.push('**Next Steps**:');
    lines.push('1. Review "今週やること" actions above');
    lines.push('2. Check proposed fixes and templates');
    lines.push('3. Consider winner promotion if experiments are mature');
    lines.push('');

    return lines.join('\n');
  }
}

/**
 * Default builder instance
 */
let defaultBuilder: ReviewPackBuilder | null = null;

/**
 * Get default ReviewPackBuilder
 */
export function getReviewPackBuilder(): ReviewPackBuilder {
  if (!defaultBuilder) {
    defaultBuilder = new ReviewPackBuilder();
  }
  return defaultBuilder;
}

/**
 * Reset default builder (for testing)
 */
export function resetReviewPackBuilder(): void {
  defaultBuilder = null;
}

export default ReviewPackBuilder;
