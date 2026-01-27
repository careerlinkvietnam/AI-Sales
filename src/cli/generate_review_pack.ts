#!/usr/bin/env npx ts-node
/**
 * Generate Review Pack CLI
 *
 * Generates a consolidated weekly review pack (Markdown) for team review meetings.
 *
 * Usage:
 *   npx ts-node src/cli/generate_review_pack.ts [--since YYYY-MM-DD] [--out path] [--notify] [--json]
 */

import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';
import { getReviewPackBuilder, ReviewPack } from '../domain/ReviewPackBuilder';
import { notifyOpsWeeklyReviewPack } from '../notifications';

// Load environment variables
config();

/**
 * CLI Options
 */
interface CLIOptions {
  since?: string;
  out?: string;
  notify: boolean;
  json: boolean;
}

/**
 * Parse CLI arguments
 */
function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {
    notify: false,
    json: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--since' && args[i + 1]) {
      options.since = args[++i];
    } else if (arg === '--out' && args[i + 1]) {
      options.out = args[++i];
    } else if (arg === '--notify') {
      options.notify = true;
    } else if (arg === '--json') {
      options.json = true;
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
Usage: npx ts-node src/cli/generate_review_pack.ts [options]

Options:
  --since <date>    Start date (YYYY-MM-DD, default: 7 days ago)
  --out <path>      Output file path (default: docs/reviews/review_YYYYMMDD.md)
  --notify          Send notification (requires NOTIFY_WEBHOOK_URL)
  --json            Also output summary as JSON
  --help            Show this help message

Examples:
  npx ts-node src/cli/generate_review_pack.ts
  npx ts-node src/cli/generate_review_pack.ts --since 2026-01-20 --out report.md
  npx ts-node src/cli/generate_review_pack.ts --notify --json
`);
}

/**
 * Generate default output path
 */
function getDefaultOutputPath(): string {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  return path.join(process.cwd(), 'docs', 'reviews', `review_${today}.md`);
}

/**
 * Ensure directory exists
 */
function ensureDirectoryExists(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Determine severity from pack
 */
function determineSeverity(pack: ReviewPack): 'info' | 'warn' | 'error' {
  // Error if high priority actions
  if (pack.actions.some(a => a.priority === 'high')) {
    return 'error';
  }
  // Warn if medium priority actions
  if (pack.actions.some(a => a.priority === 'medium')) {
    return 'warn';
  }
  return 'info';
}

/**
 * Build KPI summary string
 */
function buildKPISummary(pack: ReviewPack): string {
  const parts: string[] = [];
  parts.push(`sent=${pack.kpi.sent}`);
  parts.push(`replies=${pack.kpi.replies}`);
  if (pack.kpi.replyRate !== null) {
    parts.push(`rate=${(pack.kpi.replyRate * 100).toFixed(1)}%`);
  }
  if (pack.kpi.deadLetter > 0) {
    parts.push(`dead_letter=${pack.kpi.deadLetter}`);
  }
  return parts.join(', ');
}

/**
 * Main function
 */
async function main(): Promise<void> {
  const options = parseArgs();
  const builder = getReviewPackBuilder();

  console.log('Generating weekly review pack...');
  console.log('');

  // Build review pack
  const pack = await builder.build({
    since: options.since,
  });

  // Determine output path
  const outputPath = options.out || getDefaultOutputPath();

  // Ensure output directory exists
  ensureDirectoryExists(outputPath);

  // Write markdown file
  fs.writeFileSync(outputPath, pack.markdown, 'utf-8');
  console.log(`Review pack saved to: ${outputPath}`);
  console.log('');

  // Print summary
  console.log('Summary:');
  console.log(`  Period: ${pack.period.from} ~ ${pack.period.to}`);
  console.log(`  KPI: ${buildKPISummary(pack)}`);
  console.log(`  Actions: ${pack.actions.length}`);
  console.log(`  Incidents (open): ${pack.incidents.openCount}`);
  console.log(`  Fixes (proposed): ${pack.fixes.proposedCount}`);
  console.log('');

  // Print actions
  if (pack.actions.length > 0) {
    console.log('Top Actions:');
    for (const action of pack.actions.slice(0, 3)) {
      const badge = action.priority === 'high' ? '[HIGH]' : action.priority === 'medium' ? '[MED]' : '[LOW]';
      console.log(`  ${badge} ${action.action}`);
    }
    console.log('');
  }

  // Send notification if requested
  if (options.notify) {
    try {
      const severity = determineSeverity(pack);
      await notifyOpsWeeklyReviewPack({
        severity,
        outputPath,
        kpiSummary: buildKPISummary(pack),
        topActions: pack.actions.map(a => a.action),
        meta: {
          period: pack.period,
          actionsCount: pack.actions.length,
          openIncidents: pack.incidents.openCount,
          proposedFixes: pack.fixes.proposedCount,
        },
      });
      console.log('Notification sent.');
    } catch (error) {
      console.log(`Notification failed: ${(error as Error).message}`);
    }
  }

  // Output JSON if requested
  if (options.json) {
    const jsonOutput = {
      generatedAt: pack.generatedAt,
      period: pack.period,
      kpi: pack.kpi,
      experiments: pack.experiments,
      incidents: {
        openCount: pack.incidents.openCount,
        mitigatedCount: pack.incidents.mitigatedCount,
        closedCount: pack.incidents.closedCount,
        topCategories: pack.incidents.topCategories,
      },
      fixes: {
        proposedCount: pack.fixes.proposedCount,
        acceptedCount: pack.fixes.acceptedCount,
      },
      actions: pack.actions,
      outputPath,
    };
    console.log('');
    console.log('JSON Summary:');
    console.log(JSON.stringify(jsonOutput, null, 2));
  }
}

// Run main
main().catch((error) => {
  console.error('Error generating review pack:', error.message);
  process.exit(1);
});
