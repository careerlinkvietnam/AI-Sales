#!/usr/bin/env ts-node
/**
 * Propose Fixes CLI
 *
 * Generates fix proposals based on incident analysis.
 *
 * Usage:
 *   npx ts-node src/cli/propose_fixes.ts
 *   npx ts-node src/cli/propose_fixes.ts --since "2026-01-20" --top 3
 *   npx ts-node src/cli/propose_fixes.ts --dry-run
 *   npx ts-node src/cli/propose_fixes.ts --notify
 *
 * 重要:
 * - 提案は自動適用されません（人間がレビューして適用）
 * - PIIは出力しません
 */

import { config } from 'dotenv';
import { Command } from 'commander';
import { getIncidentStore } from '../data/IncidentStore';
import { RootCauseClassifier, ClassificationResult } from '../domain/RootCauseClassifier';
import {
  FixProposalGenerator,
  ProposalGeneratorInput,
  CategorySummary,
} from '../domain/FixProposalGenerator';
import { FixProposal, getFixProposalStore } from '../data/FixProposalStore';
import { getNotificationRouter, NotificationEvent } from '../notifications';

// Load environment variables
config();

// CLI Configuration
const program = new Command();

program
  .name('propose_fixes')
  .description('Generate fix proposals based on incident analysis')
  .version('0.1.0')
  .option('--since <date>', 'Start date (YYYY-MM-DD), default: 7 days ago')
  .option('--top <n>', 'Top N categories to generate proposals for', '3')
  .option('--dry-run', 'Generate proposals without saving')
  .option('--notify', 'Send notification with proposal summary')
  .option('--json', 'Output as JSON');

/**
 * Proposal generation result
 */
export interface ProposeFixesResult {
  period: {
    start: string;
    end: string;
  };
  total_incidents: number;
  proposals_generated: number;
  proposals: FixProposal[];
  dry_run: boolean;
}

/**
 * Generate incident report input
 */
function generateReportInput(since?: string): ProposalGeneratorInput {
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
  const classifier = new RootCauseClassifier();
  const classified = incidents.map((incident) => ({
    incident,
    classification: classifier.classify(incident),
  }));

  // Aggregate by category
  const categoryMap = new Map<string, { classification: ClassificationResult; count: number }>();
  for (const item of classified) {
    const existing = categoryMap.get(item.classification.category_id);
    if (existing) {
      existing.count++;
    } else {
      categoryMap.set(item.classification.category_id, {
        classification: item.classification,
        count: 1,
      });
    }
  }

  const byCategory: CategorySummary[] = [];
  for (const [categoryId, data] of categoryMap) {
    byCategory.push({
      category_id: categoryId,
      category_name: data.classification.category_name,
      category_name_ja: data.classification.category_name_ja,
      count: data.count,
      recommended_actions: data.classification.recommended_actions,
    });
  }

  // Sort by count descending
  byCategory.sort((a, b) => b.count - a.count);

  // Get open incidents with category
  const openIncidents = classified
    .filter((item) => item.incident.status === 'open' || item.incident.status === 'mitigated')
    .map((item) => ({
      incident_id: item.incident.incident_id,
      category_id: item.classification.category_id,
    }));

  return {
    period: {
      start: startStr.split('T')[0],
      end: endStr.split('T')[0],
    },
    total_incidents: incidents.length,
    by_category: byCategory,
    open_incidents: openIncidents,
  };
}

/**
 * Generate fix proposals
 */
export function proposeFixes(options: {
  since?: string;
  top?: number;
  dryRun?: boolean;
}): ProposeFixesResult {
  const { since, top = 3, dryRun = false } = options;

  // Generate report input
  const input = generateReportInput(since);

  // Limit to top N categories
  input.by_category = input.by_category.slice(0, top);

  // Generate proposals
  const generator = new FixProposalGenerator({ maxProposals: top });
  const proposals = generator.createProposals(input, { dryRun });

  return {
    period: input.period,
    total_incidents: input.total_incidents,
    proposals_generated: proposals.length,
    proposals,
    dry_run: dryRun,
  };
}

/**
 * Send notification with proposal summary
 */
async function sendProposalNotification(result: ProposeFixesResult): Promise<boolean> {
  if (result.proposals.length === 0) {
    return false;
  }

  const router = getNotificationRouter();

  // Build summary (PII-free)
  const topProposals = result.proposals.slice(0, 2).map((p) => `${p.priority}:${p.category_id}`);

  const event: NotificationEvent = {
    timestamp: new Date().toISOString(),
    type: 'INCIDENT_REPORT', // Reuse existing type
    severity: 'info',
    reason: `Fix Proposals Generated: ${result.proposals_generated} proposals`,
    meta: {
      period_start: result.period.start,
      period_end: result.period.end,
      total_incidents: result.total_incidents,
      proposals_count: result.proposals_generated,
      top_proposals: topProposals.join(', '),
      dry_run: result.dry_run,
    },
  };

  return router.notify(event);
}

export { sendProposalNotification };

// Only run if this is the main module
if (require.main === module) {
  program.parse();

  const opts = program.opts();

  const result = proposeFixes({
    since: opts.since,
    top: parseInt(opts.top, 10),
    dryRun: opts.dryRun || false,
  });

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('='.repeat(60));
    console.log('Fix Proposals');
    console.log('='.repeat(60));
    console.log('');
    console.log(`Period: ${result.period.start} ~ ${result.period.end}`);
    console.log(`Total Incidents: ${result.total_incidents}`);
    console.log(`Proposals Generated: ${result.proposals_generated}`);
    if (result.dry_run) {
      console.log('Mode: DRY RUN (not saved)');
    }
    console.log('');

    if (result.proposals.length === 0) {
      console.log('No proposals generated.');
      console.log('(Either no incidents or similar proposals already exist)');
    } else {
      console.log('Generated Proposals:');
      console.log('');
      for (const proposal of result.proposals) {
        console.log(`[${proposal.priority}] ${proposal.title}`);
        console.log(`  ID: ${proposal.proposal_id}`);
        console.log(`  Category: ${proposal.category_id}`);
        console.log(`  Incidents: ${proposal.rationale.incident_count}`);
        console.log('  Steps:');
        for (const step of proposal.recommended_steps.slice(0, 3)) {
          console.log(`    ${step}`);
        }
        if (proposal.recommended_steps.length > 3) {
          console.log(`    ... and ${proposal.recommended_steps.length - 3} more steps`);
        }
        console.log('');
      }

      console.log('IMPORTANT: Proposals are NOT auto-applied.');
      console.log('Review and implement manually:');
      console.log('  run_ops fixes-list');
      console.log('  run_ops fixes-show <proposal_id>');
    }
  }

  // Send notification if requested
  if (opts.notify && result.proposals.length > 0) {
    sendProposalNotification(result)
      .then((success) => {
        if (success && !opts.json) {
          console.log('\nNotification sent successfully.');
        }
      })
      .catch(() => {
        if (!opts.json) {
          console.log('\nNotification failed.');
        }
      });
  }
}
