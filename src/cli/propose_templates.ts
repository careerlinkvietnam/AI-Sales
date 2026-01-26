#!/usr/bin/env ts-node
/**
 * Propose Templates CLI
 *
 * Generates template improvement proposals based on metrics analysis.
 *
 * Usage:
 *   npx ts-node src/cli/propose_templates.ts --experiment "ab_subject_cta_v1" --since "2026-01-15"
 *   npx ts-node src/cli/propose_templates.ts --experiment "ab_subject_cta_v1" --since "2026-01-15" --dry-run
 *   npx ts-node src/cli/propose_templates.ts --experiment "ab_subject_cta_v1" --segment "region=南部"
 *
 * 注意:
 * - PIIは入力に含めない
 * - 自動昇格はしない（提案のみ）
 * - status="proposed" として追加（activeにはしない）
 */

import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { getMetricsStore, MetricsEvent } from '../data/MetricsStore';
import { AuditLogEntry } from '../domain/AuditLogger';
import { Segmenter, SegmentClassification } from '../domain/Segmenter';
import {
  ImprovementPicker,
  ImprovementCandidate,
  SegmentMetricsForPicker,
} from '../domain/ImprovementPicker';
import {
  TemplateGenerator,
  TemplateProposal,
} from '../domain/TemplateGenerator';
import {
  ExperimentEvaluator,
  ExperimentsRegistry,
  ExperimentTemplate,
} from '../domain/ExperimentEvaluator';

// Load environment variables
config();

// CLI Configuration
const program = new Command();

program
  .name('propose_templates')
  .description('Generate template improvement proposals based on metrics')
  .version('0.1.0');

program
  .requiredOption('--experiment <id>', 'Experiment ID to propose for')
  .requiredOption('--since <date>', 'Only include events since this date')
  .option('--segment <filter>', 'Filter to specific segment (e.g., "region=南部")')
  .option('--min-sent <n>', 'Minimum sent for consideration', '50')
  .option('--min-gap <n>', 'Minimum gap vs best to flag', '0.03')
  .option('--max-proposals <n>', 'Maximum proposals to generate', '5')
  .option('--dry-run', 'Output proposals without updating files')
  .option('--json', 'Output results as JSON only');

program.parse();

const options = program.opts();

// ============================================================
// Types
// ============================================================

interface ProposeResult {
  experimentId: string;
  period: {
    since: string;
    until: string;
  };
  segmentFilter: string | null;
  candidatesFound: number;
  proposalsGenerated: number;
  proposals: TemplateProposal[];
  updatedFile: boolean;
  backupPath: string | null;
  error: string | null;
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
 * Load audit records
 */
function loadAuditRecords(auditPath: string, since: string): AuditLogEntry[] {
  if (!fs.existsSync(auditPath)) {
    return [];
  }

  const content = fs.readFileSync(auditPath, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);

  const records: AuditLogEntry[] = [];
  for (const line of lines) {
    try {
      const record = JSON.parse(line) as AuditLogEntry;
      if (record.timestamp >= since) {
        records.push(record);
      }
    } catch {
      // Skip invalid lines
    }
  }

  return records;
}

/**
 * Build segment map from audit records
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

    let tagRegion: string | null = null;
    if (record.tag) {
      const regionMatch = record.tag.match(/^(南部|中部|北部)/);
      if (regionMatch) {
        tagRegion = regionMatch[1];
      }
    }

    const classification = segmenter.classify({
      tag: tagRegion
        ? { rawTag: record.tag, region: tagRegion, isContactTag: true }
        : null,
    });

    segmentMap.set(record.companyId, classification);
  }

  return segmentMap;
}

/**
 * Aggregate metrics for picker
 */
function aggregateMetricsForPicker(
  events: MetricsEvent[],
  segmentMap: Map<string, SegmentClassification>,
  segmentFilter: { name: string; value: string } | null
): SegmentMetricsForPicker[] {
  // Group by segment + template + variant
  const groupMap = new Map<
    string,
    {
      segmentName: string;
      segmentValue: string;
      templateId: string;
      variant: 'A' | 'B' | null;
      sent: number;
      replies: number;
      latencies: number[];
    }
  >();

  for (const event of events) {
    const segment = segmentMap.get(event.companyId);

    // Process each segment type
    const segmentTypes: Array<{
      name: string;
      value: string;
    }> = [
      { name: 'region', value: segment?.region || '不明' },
      { name: 'customerState', value: segment?.customerState || 'unknown' },
      { name: 'industryBucket', value: segment?.industryBucket || '不明' },
    ];

    for (const seg of segmentTypes) {
      // Apply filter if specified
      if (segmentFilter && segmentFilter.name !== seg.name) {
        continue;
      }
      if (segmentFilter && segmentFilter.value !== seg.value) {
        continue;
      }

      const key = `${seg.name}:${seg.value}:${event.templateId}:${event.abVariant || 'none'}`;

      if (!groupMap.has(key)) {
        groupMap.set(key, {
          segmentName: seg.name,
          segmentValue: seg.value,
          templateId: event.templateId,
          variant: event.abVariant,
          sent: 0,
          replies: 0,
          latencies: [],
        });
      }

      const group = groupMap.get(key)!;

      if (event.eventType === 'SENT_DETECTED') {
        group.sent++;
      } else if (event.eventType === 'REPLY_DETECTED') {
        group.replies++;
        if (event.replyLatencyHours !== null) {
          group.latencies.push(event.replyLatencyHours);
        }
      }
    }
  }

  // Convert to picker format
  const result: SegmentMetricsForPicker[] = [];
  for (const group of groupMap.values()) {
    result.push({
      segmentName: group.segmentName,
      segmentValue: group.segmentValue,
      templateId: group.templateId,
      variant: group.variant,
      sent: group.sent,
      replies: group.replies,
      replyRate: group.sent > 0 ? group.replies / group.sent : null,
      medianLatencyHours: median(group.latencies),
    });
  }

  return result;
}

/**
 * Add proposals to experiments.json
 */
function addProposalsToExperiments(
  experimentsPath: string,
  experimentId: string,
  proposals: TemplateProposal[],
  backupPath: string
): void {
  // Read current registry
  const content = fs.readFileSync(experimentsPath, 'utf-8');
  const registry: ExperimentsRegistry = JSON.parse(content);

  // Create backup
  fs.writeFileSync(backupPath, content, 'utf-8');

  // Find experiment
  const experiment = registry.experiments.find(
    (e) => e.experimentId === experimentId
  );
  if (!experiment) {
    throw new Error(`Experiment not found: ${experimentId}`);
  }

  // Add proposed templates
  for (const proposal of proposals) {
    const newTemplate: ExperimentTemplate & {
      proposedAt?: string;
      baseTemplateId?: string;
      changes?: unknown;
      targetSegment?: unknown;
      content?: unknown;
    } = {
      templateId: proposal.templateIdNew,
      variant: proposal.variant,
      status: 'proposed' as 'active' | 'archived' | 'inactive',
      proposedAt: new Date().toISOString(),
      baseTemplateId: proposal.baseTemplateId,
      changes: proposal.changes,
      targetSegment: proposal.targetSegment,
      content: proposal.content,
    };

    experiment.templates.push(newTemplate as ExperimentTemplate);
  }

  // Save updated registry
  fs.writeFileSync(experimentsPath, JSON.stringify(registry, null, 2), 'utf-8');
}

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
  const since = options.since as string;
  const minSent = parseInt(options.minSent, 10) || 50;
  const minGap = parseFloat(options.minGap) || 0.03;
  const maxProposals = parseInt(options.maxProposals, 10) || 5;

  // Parse segment filter
  let segmentFilter: { name: string; value: string } | null = null;
  if (options.segment) {
    const [name, value] = (options.segment as string).split('=');
    if (name && value) {
      segmentFilter = { name, value };
    }
  }

  const result: ProposeResult = {
    experimentId,
    period: {
      since,
      until: new Date().toISOString(),
    },
    segmentFilter: options.segment || null,
    candidatesFound: 0,
    proposalsGenerated: 0,
    proposals: [],
    updatedFile: false,
    backupPath: null,
    error: null,
  };

  if (!options.json) {
    console.log('='.repeat(70));
    console.log('Template Proposal Generator');
    console.log('='.repeat(70));
    console.log(`Experiment: ${experimentId}`);
    console.log(`Since: ${since}`);
    console.log(`Min Sent: ${minSent}`);
    console.log(`Min Gap: ${(minGap * 100).toFixed(1)}%`);
    if (segmentFilter) {
      console.log(`Segment Filter: ${segmentFilter.name}=${segmentFilter.value}`);
    }
    console.log('');
  }

  try {
    // Verify experiment exists
    const evaluator = new ExperimentEvaluator();
    const experiment = evaluator.getExperiment(experimentId);
    if (!experiment) {
      throw new Error(`Experiment not found: ${experimentId}`);
    }

    // Load metrics
    const metricsStore = getMetricsStore();
    const events = metricsStore.readEventsSince(since);

    // Load audit records
    const auditPath = path.join(process.cwd(), 'logs', 'audit.ndjson');
    const auditRecords = loadAuditRecords(auditPath, since);

    // Build segment map
    const segmenter = new Segmenter();
    const segmentMap = buildSegmentMap(auditRecords, segmenter);

    // Aggregate metrics
    const metrics = aggregateMetricsForPicker(events, segmentMap, segmentFilter);

    log(`Loaded ${events.length} metric events`);
    log(`Aggregated into ${metrics.length} segment/template groups`);
    log('');

    // Pick improvement candidates
    const picker = new ImprovementPicker({
      minSent,
      minGap,
      maxCandidates: maxProposals,
    });
    const candidates = picker.pick(metrics);

    result.candidatesFound = candidates.length;
    log(`Found ${candidates.length} improvement candidates`);

    if (candidates.length === 0) {
      log('No improvement candidates found. Try lowering --min-sent or --min-gap.');
    } else {
      // Generate proposals
      const generator = new TemplateGenerator();
      const allProposals: TemplateProposal[] = [];

      for (const candidate of candidates) {
        const proposals = generator.generate(candidate, 2);
        allProposals.push(...proposals);

        if (!options.json) {
          console.log(`\nCandidate: ${candidate.segmentKey}`);
          console.log(`  Template: ${candidate.templateId} (${candidate.variant})`);
          console.log(`  Reply Rate: ${candidate.replyRate !== null ? (candidate.replyRate * 100).toFixed(1) + '%' : 'N/A'}`);
          console.log(`  Gap vs Best: ${candidate.gapVsBest !== null ? (candidate.gapVsBest * 100).toFixed(1) + 'pp' : 'N/A'}`);
          console.log(`  Reason: ${candidate.reason}`);
          console.log(`  Generated ${proposals.length} proposals`);
        }
      }

      // Limit total proposals
      const finalProposals = allProposals.slice(0, maxProposals);
      result.proposals = finalProposals;
      result.proposalsGenerated = finalProposals.length;

      log(`\nGenerated ${finalProposals.length} total proposals`);

      // Display proposals
      if (!options.json && finalProposals.length > 0) {
        console.log('\n' + '='.repeat(70));
        console.log('Generated Proposals');
        console.log('='.repeat(70));

        for (const proposal of finalProposals) {
          console.log(`\nTemplate ID: ${proposal.templateIdNew}`);
          console.log(`  Base: ${proposal.baseTemplateId}`);
          console.log(`  Variant: ${proposal.variant}`);
          console.log(`  Target: ${proposal.targetSegment.segmentName}=${proposal.targetSegment.segmentValue}`);
          console.log(`  Changes:`);
          for (const change of proposal.changes) {
            console.log(`    - ${change.field}: ${change.type}`);
            console.log(`      "${change.before.substring(0, 50)}..." → "${change.after.substring(0, 50)}..."`);
          }
        }
      }

      // Update experiments.json (unless dry-run)
      if (!options.dryRun && finalProposals.length > 0) {
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

        addProposalsToExperiments(
          experimentsPath,
          experimentId,
          finalProposals,
          backupPath
        );

        result.updatedFile = true;
        result.backupPath = backupPath;

        log(`\nUpdated: ${experimentsPath}`);
        log(`Backup: ${backupPath}`);
      } else if (options.dryRun) {
        log('\n[DRY RUN] No files updated');
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

  process.exit(result.error ? 1 : 0);
}

// Run
main().catch((error) => {
  if (options.json) {
    console.log(
      JSON.stringify({
        experimentId: options.experiment,
        error: error.message,
      })
    );
  } else {
    console.error('Fatal error:', error.message);
  }
  process.exit(1);
});
