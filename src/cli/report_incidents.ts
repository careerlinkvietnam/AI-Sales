#!/usr/bin/env ts-node
/**
 * Incident Report CLI
 *
 * Generates incident reports with root cause classification.
 *
 * Usage:
 *   npx ts-node src/cli/report_incidents.ts
 *   npx ts-node src/cli/report_incidents.ts --since "2026-01-20" --markdown
 *   npx ts-node src/cli/report_incidents.ts --json
 *
 * 目的:
 * - インシデントをカテゴリ別に集計
 * - 再発防止の推奨アクションを提示
 * - 週次レポートとして運用
 *
 * 制約:
 * - PIIは出力しない
 * - "自動修正"はしない（推奨のみ）
 */

import { config } from 'dotenv';
import { Command } from 'commander';
import { getIncidentStore, Incident } from '../data/IncidentStore';
import {
  RootCauseClassifier,
  ClassificationResult,
  IncidentCategory,
} from '../domain/RootCauseClassifier';
import { getNotificationRouter, NotificationEvent } from '../notifications';

// Load environment variables
config();

// CLI Configuration
const program = new Command();

program
  .name('report_incidents')
  .description('Generate incident reports with root cause classification')
  .version('0.1.0')
  .option('--since <date>', 'Start date (YYYY-MM-DD), default: 7 days ago')
  .option('--markdown', 'Output as markdown')
  .option('--json', 'Output as JSON')
  .option('--notify', 'Send notification with summary (if webhook configured)');

/**
 * Incident with classification
 */
interface ClassifiedIncident {
  incident: Incident;
  classification: ClassificationResult;
}

/**
 * Category summary
 */
interface CategorySummary {
  category_id: string;
  category_name: string;
  category_name_ja: string;
  count: number;
  recommended_actions: string[];
}

/**
 * Severity summary
 */
interface SeveritySummary {
  severity: string;
  count: number;
}

/**
 * Open incident summary (PII-free)
 */
interface OpenIncidentSummary {
  incident_id: string;
  created_at: string;
  category_id: string;
  category_name_ja: string;
  reason_short: string;
  days_open: number;
}

/**
 * Report result
 */
export interface IncidentReportResult {
  period: {
    start: string;
    end: string;
  };
  total_incidents: number;
  by_category: CategorySummary[];
  by_severity: SeveritySummary[];
  open_incidents: OpenIncidentSummary[];
  recommendations: {
    category_id: string;
    category_name_ja: string;
    actions: string[];
  }[];
}

/**
 * Generate incident report
 */
export function generateIncidentReport(options: {
  since?: string;
  configPath?: string;
}): IncidentReportResult {
  const { since } = options;

  // Calculate date range
  const endDate = new Date();
  let startDate: Date;

  if (since) {
    startDate = new Date(since);
  } else {
    startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);
  }

  const startStr = startDate.toISOString();
  const endStr = endDate.toISOString();

  // Get incidents
  const store = getIncidentStore();
  const allIncidents = store.listIncidents();

  // Filter by date
  const incidents = allIncidents.filter((inc) => {
    const createdAt = new Date(inc.created_at);
    return createdAt >= startDate && createdAt <= endDate;
  });

  // Classify incidents
  const classifier = new RootCauseClassifier(options.configPath);
  const classified: ClassifiedIncident[] = incidents.map((incident) => ({
    incident,
    classification: classifier.classify(incident),
  }));

  // Aggregate by category
  const categoryMap = new Map<string, ClassifiedIncident[]>();
  for (const item of classified) {
    const existing = categoryMap.get(item.classification.category_id) || [];
    existing.push(item);
    categoryMap.set(item.classification.category_id, existing);
  }

  const byCategory: CategorySummary[] = [];
  for (const [categoryId, items] of categoryMap) {
    const first = items[0].classification;
    byCategory.push({
      category_id: categoryId,
      category_name: first.category_name,
      category_name_ja: first.category_name_ja,
      count: items.length,
      recommended_actions: first.recommended_actions,
    });
  }

  // Sort by count descending
  byCategory.sort((a, b) => b.count - a.count);

  // Aggregate by severity
  const severityMap = new Map<string, number>();
  for (const item of classified) {
    const severity = item.incident.severity;
    severityMap.set(severity, (severityMap.get(severity) || 0) + 1);
  }

  const bySeverity: SeveritySummary[] = [];
  for (const [severity, count] of severityMap) {
    bySeverity.push({ severity, count });
  }

  // Sort by severity (error > warn > info)
  const severityOrder: Record<string, number> = { error: 0, warn: 1, info: 2 };
  bySeverity.sort((a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3));

  // Get open incidents
  const openIncidents: OpenIncidentSummary[] = classified
    .filter((item) => item.incident.status === 'open' || item.incident.status === 'mitigated')
    .map((item) => {
      const daysOpen = Math.floor(
        (endDate.getTime() - new Date(item.incident.created_at).getTime()) / (1000 * 60 * 60 * 24)
      );

      // Truncate reason to 50 chars (PII-free since Incident already has no PII)
      let reasonShort = item.incident.reason;
      if (reasonShort.length > 50) {
        reasonShort = reasonShort.substring(0, 47) + '...';
      }

      return {
        incident_id: item.incident.incident_id,
        created_at: item.incident.created_at,
        category_id: item.classification.category_id,
        category_name_ja: item.classification.category_name_ja,
        reason_short: reasonShort,
        days_open: daysOpen,
      };
    })
    .sort((a, b) => b.days_open - a.days_open);

  // Generate recommendations (top categories only)
  const recommendations = byCategory.slice(0, 5).map((cat) => ({
    category_id: cat.category_id,
    category_name_ja: cat.category_name_ja,
    actions: cat.recommended_actions,
  }));

  return {
    period: {
      start: startStr.split('T')[0],
      end: endStr.split('T')[0],
    },
    total_incidents: incidents.length,
    by_category: byCategory,
    by_severity: bySeverity,
    open_incidents: openIncidents,
    recommendations,
  };
}

/**
 * Format report as markdown
 */
export function formatReportMarkdown(report: IncidentReportResult): string {
  const lines: string[] = [];

  lines.push('# Incident Report');
  lines.push('');
  lines.push(`**Period**: ${report.period.start} ~ ${report.period.end}`);
  lines.push(`**Total Incidents**: ${report.total_incidents}`);
  lines.push('');

  // Category breakdown
  lines.push('## Category Breakdown');
  lines.push('');
  if (report.by_category.length === 0) {
    lines.push('No incidents in this period.');
  } else {
    lines.push('| Rank | Category | Count |');
    lines.push('|------|----------|-------|');
    report.by_category.slice(0, 10).forEach((cat, i) => {
      lines.push(`| ${i + 1} | ${cat.category_name_ja} | ${cat.count} |`);
    });
  }
  lines.push('');

  // Severity breakdown
  lines.push('## Severity Breakdown');
  lines.push('');
  if (report.by_severity.length === 0) {
    lines.push('No incidents.');
  } else {
    lines.push('| Severity | Count |');
    lines.push('|----------|-------|');
    for (const sev of report.by_severity) {
      const emoji = sev.severity === 'error' ? '🔴' : sev.severity === 'warn' ? '🟡' : '🔵';
      lines.push(`| ${emoji} ${sev.severity} | ${sev.count} |`);
    }
  }
  lines.push('');

  // Open incidents
  lines.push('## Open Incidents');
  lines.push('');
  if (report.open_incidents.length === 0) {
    lines.push('No open incidents.');
  } else {
    lines.push('| ID | Days Open | Category | Reason |');
    lines.push('|----|-----------|----------|--------|');
    for (const inc of report.open_incidents) {
      lines.push(
        `| ${inc.incident_id.substring(0, 12)}... | ${inc.days_open} | ${inc.category_name_ja} | ${inc.reason_short} |`
      );
    }
  }
  lines.push('');

  // Recommendations
  lines.push('## Recommended Actions');
  lines.push('');
  lines.push('> **Note**: These are recommendations only. No automatic fixes are applied.');
  lines.push('');
  if (report.recommendations.length === 0) {
    lines.push('No recommendations.');
  } else {
    for (const rec of report.recommendations) {
      lines.push(`### ${rec.category_name_ja}`);
      lines.push('');
      for (const action of rec.actions) {
        lines.push(`- ${action}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Send notification with report summary
 */
async function sendReportNotification(report: IncidentReportResult): Promise<boolean> {
  const router = getNotificationRouter();

  // Build summary (PII-free)
  const topCategories = report.by_category.slice(0, 3).map((c) => `${c.category_name_ja}(${c.count})`);

  const event: NotificationEvent = {
    timestamp: new Date().toISOString(),
    type: 'INCIDENT_REPORT',
    severity: 'info',
    reason: `Weekly Incident Report: ${report.total_incidents} incidents, Open: ${report.open_incidents.length}`,
    counters: {
      sent_3d: report.total_incidents,
      reply_3d: report.open_incidents.length,
    },
    meta: {
      period_start: report.period.start,
      period_end: report.period.end,
      total_incidents: report.total_incidents,
      open_count: report.open_incidents.length,
      top_categories: topCategories.join(', '),
    },
  };

  return router.notify(event);
}

export { sendReportNotification };

// Only run if this is the main module
if (require.main === module) {
  program.parse();

  const opts = program.opts();

  const report = generateIncidentReport({
    since: opts.since,
  });

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (opts.markdown) {
    console.log(formatReportMarkdown(report));
  } else {
    // Default: formatted text output
    console.log('='.repeat(60));
    console.log('Incident Report');
    console.log('='.repeat(60));
    console.log('');
    console.log(`Period: ${report.period.start} ~ ${report.period.end}`);
    console.log(`Total Incidents: ${report.total_incidents}`);
    console.log('');

    console.log('Category Breakdown:');
    if (report.by_category.length === 0) {
      console.log('  No incidents in this period.');
    } else {
      report.by_category.slice(0, 10).forEach((cat, i) => {
        console.log(`  ${i + 1}. ${cat.category_name_ja}: ${cat.count}`);
      });
    }
    console.log('');

    console.log('Severity Breakdown:');
    for (const sev of report.by_severity) {
      console.log(`  ${sev.severity}: ${sev.count}`);
    }
    console.log('');

    console.log(`Open Incidents: ${report.open_incidents.length}`);
    for (const inc of report.open_incidents.slice(0, 5)) {
      console.log(`  - ${inc.incident_id.substring(0, 12)}... (${inc.days_open}d): ${inc.reason_short}`);
    }
    if (report.open_incidents.length > 5) {
      console.log(`  ... and ${report.open_incidents.length - 5} more`);
    }
    console.log('');

    console.log('Recommendations:');
    console.log('  (These are recommendations only. No automatic fixes.)');
    for (const rec of report.recommendations.slice(0, 3)) {
      console.log(`  [${rec.category_name_ja}]`);
      for (const action of rec.actions.slice(0, 2)) {
        console.log(`    - ${action}`);
      }
    }
  }

  // Send notification if requested
  if (opts.notify) {
    sendReportNotification(report)
      .then((success) => {
        if (success) {
          console.log('\nNotification sent successfully.');
        } else {
          console.log('\nNotification skipped (webhook not configured or failed).');
        }
      })
      .catch(() => {
        console.log('\nNotification failed.');
      });
  }
}
