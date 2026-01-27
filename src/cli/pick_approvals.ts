#!/usr/bin/env npx ts-node
/**
 * Pick Approvals CLI
 *
 * Identifies approval candidates for weekly review meetings.
 * No automatic approvals - only provides recommendations.
 *
 * Usage:
 *   npx ts-node src/cli/pick_approvals.ts [--since YYYY-MM-DD] [--markdown] [--json] [--notify]
 */

import { config } from 'dotenv';
import {
  getApprovalCandidatePicker,
  ApprovalCandidates,
} from '../domain/ApprovalCandidatePicker';
import { notifyOpsWeeklyApprovalsPick } from '../notifications';

// Load environment variables
config();

/**
 * CLI Options
 */
interface CLIOptions {
  since?: string;
  maxTemplates: number;
  maxFixes: number;
  maxOps: number;
  markdown: boolean;
  json: boolean;
  notify: boolean;
}

/**
 * Parse CLI arguments
 */
function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {
    maxTemplates: 3,
    maxFixes: 3,
    maxOps: 3,
    markdown: false,
    json: false,
    notify: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--since' && args[i + 1]) {
      options.since = args[++i];
    } else if (arg === '--max-templates' && args[i + 1]) {
      options.maxTemplates = parseInt(args[++i], 10);
    } else if (arg === '--max-fixes' && args[i + 1]) {
      options.maxFixes = parseInt(args[++i], 10);
    } else if (arg === '--max-ops' && args[i + 1]) {
      options.maxOps = parseInt(args[++i], 10);
    } else if (arg === '--markdown') {
      options.markdown = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--notify') {
      options.notify = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
  }

  return options;
}

/**
 * Print usage
 */
function printUsage(): void {
  console.log(`
Usage: npx ts-node src/cli/pick_approvals.ts [options]

Options:
  --since <date>         Start date (YYYY-MM-DD, default: 7 days ago)
  --max-templates <n>    Max template candidates (default: 3)
  --max-fixes <n>        Max fix proposal candidates (default: 3)
  --max-ops <n>          Max ops candidates (default: 3)
  --markdown             Output as Markdown
  --json                 Output as JSON
  --notify               Send notification (requires NOTIFY_WEBHOOK_URL)
  --help                 Show this help message

Examples:
  npx ts-node src/cli/pick_approvals.ts
  npx ts-node src/cli/pick_approvals.ts --since 2026-01-20 --markdown
  npx ts-node src/cli/pick_approvals.ts --notify --json

Note:
  This tool only provides recommendations. No automatic approvals are performed.
  Review each candidate and run the recommended commands manually.
`);
}

/**
 * Determine notification severity based on candidates
 */
function determineSeverity(result: ApprovalCandidates): 'info' | 'warn' | 'error' {
  if (result.summary.p0Count > 0) {
    return 'error';
  }
  if (result.summary.p1Count > 0) {
    return 'warn';
  }
  return 'info';
}

/**
 * Print console output
 */
function printConsoleOutput(result: ApprovalCandidates): void {
  console.log('='.repeat(70));
  console.log('Approval Candidates');
  console.log('='.repeat(70));
  console.log('');
  console.log(`Period: ${result.period.from} ~ ${result.period.to}`);
  console.log(`Summary: ${result.summary.totalCandidates} candidate(s) - P0: ${result.summary.p0Count}, P1: ${result.summary.p1Count}, P2: ${result.summary.p2Count}`);
  console.log('');

  // Templates
  console.log('-'.repeat(70));
  console.log('1. Template Approval Candidates');
  console.log('-'.repeat(70));
  if (result.templates.length === 0) {
    console.log('  No template approval candidates.');
  } else {
    for (const t of result.templates) {
      console.log(`  [${t.priority}] ${t.templateId}`);
      console.log(`      Experiment: ${t.experimentId}, Variant: ${t.variant}`);
      console.log(`      Rationale: ${t.rationale}`);
      if (t.guardrails.length > 0) {
        console.log(`      Guardrails: ${t.guardrails.join(', ')}`);
      }
      console.log(`      Command: ${t.recommendedCommand}`);
      console.log('');
    }
  }
  console.log('');

  // Fixes
  console.log('-'.repeat(70));
  console.log('2. Fix Proposal Candidates');
  console.log('-'.repeat(70));
  if (result.fixes.length === 0) {
    console.log('  No fix proposal candidates.');
  } else {
    for (const f of result.fixes) {
      console.log(`  [${f.priority}] ${f.proposalId}`);
      console.log(`      Category: ${f.categoryId}`);
      console.log(`      Rationale: ${f.rationale}`);
      if (f.guardrails.length > 0) {
        console.log(`      Guardrails: ${f.guardrails.join(', ')}`);
      }
      console.log(`      Command: ${f.recommendedCommand}`);
      console.log('');
    }
  }
  console.log('');

  // Ops
  console.log('-'.repeat(70));
  console.log('3. Ops Candidates');
  console.log('-'.repeat(70));
  if (result.ops.length === 0) {
    console.log('  No ops candidates.');
  } else {
    for (const o of result.ops) {
      console.log(`  [${o.priority}] ${o.type}`);
      console.log(`      Rationale: ${o.rationale}`);
      if (o.guardrails.length > 0) {
        console.log(`      Guardrails: ${o.guardrails.join(', ')}`);
      }
      console.log(`      Command: ${o.recommendedCommand}`);
      console.log('');
    }
  }
  console.log('');

  console.log('='.repeat(70));
  console.log('Note: This is a guide only. No automatic approvals are performed.');
  console.log('='.repeat(70));
}

/**
 * Main function
 */
async function main(): Promise<void> {
  const options = parseArgs();
  const picker = getApprovalCandidatePicker();

  const result = picker.pick({
    since: options.since,
    maxTemplates: options.maxTemplates,
    maxFixes: options.maxFixes,
    maxOps: options.maxOps,
  });

  // Output based on format
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (options.markdown) {
    console.log(picker.generateMarkdown(result));
  } else {
    printConsoleOutput(result);
  }

  // Send notification if requested
  if (options.notify) {
    try {
      const severity = determineSeverity(result);

      // Build notification content
      const topTemplate = result.templates[0];
      const topFix = result.fixes[0];
      const topOps = result.ops[0];

      await notifyOpsWeeklyApprovalsPick({
        severity,
        summary: {
          total: result.summary.totalCandidates,
          p0: result.summary.p0Count,
          p1: result.summary.p1Count,
          p2: result.summary.p2Count,
        },
        topTemplate: topTemplate ? {
          templateId: topTemplate.templateId,
          priority: topTemplate.priority,
        } : undefined,
        topFix: topFix ? {
          proposalId: topFix.proposalId,
          priority: topFix.priority,
        } : undefined,
        topOps: topOps ? {
          type: topOps.type,
          priority: topOps.priority,
        } : undefined,
        recommendedCommand: topOps?.recommendedCommand || topFix?.recommendedCommand || topTemplate?.recommendedCommand,
      });

      if (!options.json && !options.markdown) {
        console.log('');
        console.log('Notification sent.');
      }
    } catch (error) {
      if (!options.json && !options.markdown) {
        console.log('');
        console.log(`Notification failed: ${(error as Error).message}`);
      }
    }
  }
}

// Run main
main().catch((error) => {
  console.error('Error picking approvals:', error.message);
  process.exit(1);
});
