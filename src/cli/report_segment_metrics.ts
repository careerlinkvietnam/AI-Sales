#!/usr/bin/env ts-node
/**
 * Segment Metrics Report CLI
 *
 * Generates segment-based A/B metrics report.
 *
 * Usage:
 *   npx ts-node src/cli/report_segment_metrics.ts
 *   npx ts-node src/cli/report_segment_metrics.ts --since "2026-01-01"
 *   npx ts-node src/cli/report_segment_metrics.ts --markdown --min-sent 30
 *
 * 注意:
 * - セグメント判定は探索的（多重比較補正なし）
 * - 分母は sent_detected、分子は reply_detected
 * - PIIはログに出さない
 */

import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { getMetricsStore, MetricsEvent } from '../data/MetricsStore';
import { AuditLogEntry } from '../domain/AuditLogger';
import {
  Segmenter,
  SegmentClassification,
  RegionSegment,
  CustomerStateSegment,
  IndustryBucketSegment,
} from '../domain/Segmenter';
import {
  ExperimentEvaluator,
  SegmentedMetrics,
  SegmentedEvaluationDecision,
  VariantMetrics,
} from '../domain/ExperimentEvaluator';

// Load environment variables
config();

// CLI Configuration
const program = new Command();

program
  .name('report_segment_metrics')
  .description('Generate segment-based A/B metrics report')
  .version('0.1.0');

program
  .option('--since <date>', 'Only include events since this date (ISO format)')
  .option('--json', 'Output results as JSON only')
  .option('--markdown', 'Output as Markdown table')
  .option('--min-sent <n>', 'Minimum sent for reliable metrics (default: 30)', '30')
  .option('--include-decision', 'Include exploratory A/B decisions');

program.parse();

const options = program.opts();
const minSent = parseInt(options.minSent, 10) || 30;

// ============================================================
// Types
// ============================================================

interface SegmentMetricsRow {
  segmentName: string;
  segmentValue: string;
  templateId: string;
  variant: 'A' | 'B' | null;
  sent: number;
  replies: number;
  replyRate: number | null;
  medianLatencyHours: number | null;
  latencies: number[];
  isInsufficient: boolean;
}

interface SegmentReport {
  period: {
    since: string | null;
    until: string;
  };
  minSent: number;
  byRegion: SegmentMetricsRow[];
  byCustomerState: SegmentMetricsRow[];
  byIndustryBucket: SegmentMetricsRow[];
  decisions?: SegmentedEvaluationDecision[];
}

// ============================================================
// Helpers
// ============================================================

/**
 * Calculate median
 */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Load audit records from file
 */
function loadAuditRecords(
  auditPath: string,
  since?: string
): AuditLogEntry[] {
  if (!fs.existsSync(auditPath)) {
    return [];
  }

  const content = fs.readFileSync(auditPath, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);

  const records: AuditLogEntry[] = [];
  for (const line of lines) {
    try {
      const record = JSON.parse(line) as AuditLogEntry;
      if (since && record.timestamp < since) {
        continue;
      }
      records.push(record);
    } catch {
      // Skip invalid lines
    }
  }

  return records;
}

/**
 * Build segment map from audit records
 * Key: companyId, Value: SegmentClassification
 */
function buildSegmentMap(
  auditRecords: AuditLogEntry[],
  segmenter: Segmenter
): Map<string, SegmentClassification> {
  const segmentMap = new Map<string, SegmentClassification>();

  for (const record of auditRecords) {
    if (segmentMap.has(record.companyId)) {
      continue;
    }

    // Extract tag region from tag string
    let tagRegion: string | null = null;
    if (record.tag) {
      // Try to extract region from tag like "南部・3月連絡"
      const regionMatch = record.tag.match(/^(南部|中部|北部)/);
      if (regionMatch) {
        tagRegion = regionMatch[1];
      }
    }

    // Classify with limited info (audit records don't have full company data)
    const classification = segmenter.classify({
      tag: tagRegion ? { rawTag: record.tag, region: tagRegion, isContactTag: true } : null,
      // Note: We don't have full company profile in audit records
      // This is by design to avoid additional CRM calls
    });

    segmentMap.set(record.companyId, classification);
  }

  return segmentMap;
}

/**
 * Aggregate metrics by segment
 */
function aggregateBySegment(
  events: MetricsEvent[],
  segmentMap: Map<string, SegmentClassification>,
  segmentName: 'region' | 'customerState' | 'industryBucket'
): SegmentMetricsRow[] {
  // Group by segmentValue + templateId + variant
  const groupMap = new Map<string, SegmentMetricsRow>();

  for (const event of events) {
    const segment = segmentMap.get(event.companyId);
    const segmentValue = segment ? segment[segmentName] : (
      segmentName === 'region' ? '不明' :
      segmentName === 'customerState' ? 'unknown' : '不明'
    );

    const key = `${segmentValue}:${event.templateId}:${event.abVariant || 'none'}`;

    if (!groupMap.has(key)) {
      groupMap.set(key, {
        segmentName,
        segmentValue,
        templateId: event.templateId,
        variant: event.abVariant,
        sent: 0,
        replies: 0,
        replyRate: null,
        medianLatencyHours: null,
        latencies: [],
        isInsufficient: false,
      });
    }

    const row = groupMap.get(key)!;

    switch (event.eventType) {
      case 'SENT_DETECTED':
        row.sent++;
        break;
      case 'REPLY_DETECTED':
        row.replies++;
        if (event.replyLatencyHours !== null) {
          row.latencies.push(event.replyLatencyHours);
        }
        break;
    }
  }

  // Calculate derived metrics
  const rows: SegmentMetricsRow[] = [];
  for (const row of groupMap.values()) {
    row.replyRate = row.sent > 0
      ? Math.round((row.replies / row.sent) * 1000) / 10
      : null;
    row.medianLatencyHours = median(row.latencies);
    if (row.medianLatencyHours !== null) {
      row.medianLatencyHours = Math.round(row.medianLatencyHours * 10) / 10;
    }
    row.isInsufficient = row.sent < minSent;
    rows.push(row);
  }

  // Sort by segment value, then template, then variant
  rows.sort((a, b) => {
    const segCompare = a.segmentValue.localeCompare(b.segmentValue);
    if (segCompare !== 0) return segCompare;
    const templateCompare = a.templateId.localeCompare(b.templateId);
    if (templateCompare !== 0) return templateCompare;
    return (a.variant || '').localeCompare(b.variant || '');
  });

  return rows;
}

/**
 * Generate exploratory decisions for segments
 */
function generateSegmentedDecisions(
  rows: SegmentMetricsRow[],
  experimentId: string,
  evaluator: ExperimentEvaluator
): SegmentedEvaluationDecision[] {
  // Group by segment value
  const segmentGroups = new Map<string, SegmentMetricsRow[]>();
  for (const row of rows) {
    const key = row.segmentValue;
    if (!segmentGroups.has(key)) {
      segmentGroups.set(key, []);
    }
    segmentGroups.get(key)!.push(row);
  }

  const segmentedMetrics: SegmentedMetrics[] = [];

  for (const [segmentValue, segmentRows] of segmentGroups) {
    // Find A and B variants
    const variantA = segmentRows.find((r) => r.variant === 'A');
    const variantB = segmentRows.find((r) => r.variant === 'B');

    if (!variantA || !variantB) {
      continue;
    }

    const metricsA: VariantMetrics = {
      variant: 'A',
      sent: variantA.sent,
      replies: variantA.replies,
      replyRate: variantA.sent > 0 ? variantA.replies / variantA.sent : null,
    };

    const metricsB: VariantMetrics = {
      variant: 'B',
      sent: variantB.sent,
      replies: variantB.replies,
      replyRate: variantB.sent > 0 ? variantB.replies / variantB.sent : null,
    };

    segmentedMetrics.push({
      segmentName: variantA.segmentName,
      segmentValue,
      metricsA,
      metricsB,
    });
  }

  if (segmentedMetrics.length === 0) {
    return [];
  }

  try {
    return evaluator.evaluateSegmented(experimentId, segmentedMetrics);
  } catch {
    return [];
  }
}

// ============================================================
// Display Functions
// ============================================================

function displayTable(rows: SegmentMetricsRow[], title: string): void {
  console.log('');
  console.log(title);
  console.log('-'.repeat(90));
  console.log(
    'Segment Value       | Template ID                  | Var | Sent | Replies | Rate   | Status'
  );
  console.log('-'.repeat(90));

  for (const row of rows) {
    const segPad = row.segmentValue.substring(0, 19).padEnd(19);
    const templatePad = row.templateId.substring(0, 28).padEnd(28);
    const varPad = (row.variant || '-').padEnd(3);
    const sentPad = String(row.sent).padStart(4);
    const repliesPad = String(row.replies).padStart(7);
    const ratePad = row.replyRate !== null ? `${row.replyRate}%`.padStart(6) : 'N/A'.padStart(6);
    const status = row.isInsufficient ? 'insufficient_n' : 'OK';

    console.log(
      `${segPad} | ${templatePad} | ${varPad} | ${sentPad} | ${repliesPad} | ${ratePad} | ${status}`
    );
  }
  console.log('-'.repeat(90));
}

function displayMarkdownTable(rows: SegmentMetricsRow[], title: string): void {
  console.log('');
  console.log(`### ${title}`);
  console.log('');
  console.log('| Segment | Template ID | Variant | Sent | Replies | Rate | Latency | Status |');
  console.log('|---------|-------------|---------|------|---------|------|---------|--------|');

  for (const row of rows) {
    const rate = row.replyRate !== null ? `${row.replyRate}%` : 'N/A';
    const latency = row.medianLatencyHours !== null ? `${row.medianLatencyHours}h` : 'N/A';
    const status = row.isInsufficient ? 'insufficient_n' : 'OK';

    console.log(
      `| ${row.segmentValue} | ${row.templateId} | ${row.variant || '-'} | ${row.sent} | ${row.replies} | ${rate} | ${latency} | ${status} |`
    );
  }
}

function displayDecisions(decisions: SegmentedEvaluationDecision[]): void {
  console.log('');
  console.log('Exploratory Segment Decisions:');
  console.log('-'.repeat(70));
  console.log('NOTE: These are EXPLORATORY results. No multiple comparison correction applied.');
  console.log('');

  for (const decision of decisions) {
    console.log(`  ${decision.segmentName}=${decision.segmentValue}:`);
    console.log(`    Winner: ${decision.winnerVariant || 'None'}`);
    console.log(`    Reason: ${decision.reasonText}`);
    console.log(
      `    P-value: ${decision.stats.pValue !== null ? decision.stats.pValue.toFixed(4) : 'N/A'}`
    );
    console.log('');
  }
}

function displayMarkdownDecisions(decisions: SegmentedEvaluationDecision[]): void {
  console.log('');
  console.log('### Exploratory Segment Decisions');
  console.log('');
  console.log('> **Note**: These are EXPLORATORY results. No multiple comparison correction applied.');
  console.log('');
  console.log('| Segment | Value | Winner | Reason | P-value |');
  console.log('|---------|-------|--------|--------|---------|');

  for (const decision of decisions) {
    const pValue = decision.stats.pValue !== null ? decision.stats.pValue.toFixed(4) : 'N/A';
    console.log(
      `| ${decision.segmentName} | ${decision.segmentValue} | ${decision.winnerVariant || 'None'} | ${decision.reason} | ${pValue} |`
    );
  }
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
  if (!options.json && !options.markdown) {
    console.log('='.repeat(70));
    console.log('Segment Metrics Report');
    console.log('='.repeat(70));
    console.log(`Minimum sent threshold: ${minSent}`);
  }

  // Load metrics
  const metricsStore = getMetricsStore();
  const events = options.since
    ? metricsStore.readEventsSince(options.since)
    : metricsStore.readAllEvents();

  // Load audit records
  const auditPath = path.join(process.cwd(), 'logs', 'audit.ndjson');
  const auditRecords = loadAuditRecords(auditPath, options.since);

  // Build segment map
  const segmenter = new Segmenter();
  const segmentMap = buildSegmentMap(auditRecords, segmenter);

  // Aggregate by segment
  const byRegion = aggregateBySegment(events, segmentMap, 'region');
  const byCustomerState = aggregateBySegment(events, segmentMap, 'customerState');
  const byIndustryBucket = aggregateBySegment(events, segmentMap, 'industryBucket');

  // Build report
  const report: SegmentReport = {
    period: {
      since: options.since || null,
      until: new Date().toISOString(),
    },
    minSent,
    byRegion,
    byCustomerState,
    byIndustryBucket,
  };

  // Add decisions if requested
  if (options.includeDecision) {
    const evaluator = new ExperimentEvaluator();
    try {
      const registry = evaluator.loadRegistry();
      if (registry.experiments.length > 0) {
        const experimentId = registry.experiments[0].experimentId;
        const decisions: SegmentedEvaluationDecision[] = [
          ...generateSegmentedDecisions(byRegion, experimentId, evaluator),
          ...generateSegmentedDecisions(byCustomerState, experimentId, evaluator),
          ...generateSegmentedDecisions(byIndustryBucket, experimentId, evaluator),
        ];
        report.decisions = decisions;
      }
    } catch {
      // Skip if no experiments configured
    }
  }

  // Output
  if (options.json) {
    // Remove latencies array from JSON output
    const jsonReport = {
      ...report,
      byRegion: report.byRegion.map(({ latencies, ...rest }) => rest),
      byCustomerState: report.byCustomerState.map(({ latencies, ...rest }) => rest),
      byIndustryBucket: report.byIndustryBucket.map(({ latencies, ...rest }) => rest),
    };
    console.log(JSON.stringify(jsonReport, null, 2));
  } else if (options.markdown) {
    console.log('# Segment Metrics Report');
    console.log('');
    console.log('## Period');
    console.log('');
    console.log(`- **From**: ${report.period.since || '(all time)'}`);
    console.log(`- **To**: ${report.period.until}`);
    console.log(`- **Min Sent Threshold**: ${minSent}`);

    displayMarkdownTable(byRegion, 'By Region');
    displayMarkdownTable(byCustomerState, 'By Customer State');
    displayMarkdownTable(byIndustryBucket, 'By Industry Bucket');

    if (report.decisions && report.decisions.length > 0) {
      displayMarkdownDecisions(report.decisions);
    }
  } else {
    console.log('');
    console.log('Period:');
    console.log(`  From: ${report.period.since || '(all time)'}`);
    console.log(`  To:   ${report.period.until}`);

    displayTable(byRegion, 'By Region:');
    displayTable(byCustomerState, 'By Customer State:');
    displayTable(byIndustryBucket, 'By Industry Bucket:');

    if (report.decisions && report.decisions.length > 0) {
      displayDecisions(report.decisions);
    }
  }

  process.exit(0);
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
