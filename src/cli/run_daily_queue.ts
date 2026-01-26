#!/usr/bin/env ts-node
/**
 * Run Daily Queue CLI
 *
 * Generates a prioritized list of companies for daily outreach.
 * Uses PriorityScorer to rank companies by contact priority.
 *
 * Usage:
 *   npx ts-node src/cli/run_daily_queue.ts --tag "南部・3月連絡" --top 20
 *   npx ts-node src/cli/run_daily_queue.ts --tag "南部・3月連絡" --json
 *   npx ts-node src/cli/run_daily_queue.ts --tag "南部・3月連絡" --select
 *
 * Environment Variables:
 *   CRM: CRM_BASE_URL, CRM_LOGIN_EMAIL, CRM_LOGIN_PASSWORD (or CRM_SESSION_TOKEN)
 */

import { config } from 'dotenv';
import { Command } from 'commander';
import * as readline from 'readline';
import { spawn } from 'child_process';
import { CrmClient, validateCrmConfig } from '../connectors/crm/CrmClient';
import { PriorityScorer } from '../domain/PriorityScorer';
import {
  PriorityScore,
  PriorityBucket,
  CompanyForScoring,
} from '../domain/PriorityScorerConfig';
import {
  AuthError,
  NetworkError,
  ConfigurationError,
  CompanyDetail,
  ContactHistory,
} from '../types';

// Load environment variables
config();

// CLI Configuration
const program = new Command();

program
  .name('run_daily_queue')
  .description('Generate prioritized company list for daily outreach')
  .version('0.1.0');

program
  .requiredOption('-t, --tag <tag>', 'Raw tag to search (e.g., "南部・3月連絡")')
  .option('--top <n>', 'Number of top companies to show', '20')
  .option('--json', 'Output results as JSON only')
  .option('--select', 'Interactive mode: select a company to run pipeline')
  .option('--show-all', 'Show all companies including special buckets');

program.parse();

const options = program.opts();

/**
 * CLI result structure
 */
interface QueueResult {
  success: boolean;
  tag: string;
  totalCompanies: number;
  scoredCompanies: number;
  queue: PriorityScore[];
  bucketCounts: Record<PriorityBucket, number>;
  errors: string[];
}

/**
 * Logger that respects --json flag
 */
function log(message: string): void {
  if (!options.json) {
    console.log(message);
  }
}

function logError(message: string): void {
  if (!options.json) {
    console.error(message);
  }
}

/**
 * Format bucket name for display
 */
function formatBucket(bucket: PriorityBucket): string {
  const labels: Record<PriorityBucket, string> = {
    high_priority: '🔴 高優先',
    normal: '🟡 通常',
    low_priority: '🟢 低優先',
    existing_customer: '⚪ 既存顧客',
    data_cleanup: '⚠️  要整備',
  };
  return labels[bucket] || bucket;
}

/**
 * Display company list in table format
 */
function displayQueue(queue: PriorityScore[], showAll: boolean): void {
  log('');
  log('='.repeat(80));
  log('優先度順リスト');
  log('='.repeat(80));

  const filtered = showAll
    ? queue
    : queue.filter(s => s.bucket !== 'existing_customer' && s.bucket !== 'data_cleanup');

  if (filtered.length === 0) {
    log('表示対象の企業がありません。--show-all オプションで全件表示できます。');
    return;
  }

  filtered.forEach((score, index) => {
    const rank = String(index + 1).padStart(2, ' ');
    const scoreStr = String(score.score).padStart(3, ' ');
    const bucket = formatBucket(score.bucket);
    // Mask company name for display (show first 10 chars only for privacy)
    const nameDisplay = score.companyName.length > 20
      ? score.companyName.substring(0, 20) + '...'
      : score.companyName.padEnd(23, ' ');

    log(`${rank}. [${scoreStr}点] ${bucket} | ${score.companyId} | ${nameDisplay}`);
    log(`    ${score.summary}`);
    if (score.metadata.lastContactDate) {
      log(`    最終連絡: ${score.metadata.lastContactDate} (${score.metadata.daysSinceContact}日前)`);
    }
    log('');
  });
}

/**
 * Display bucket summary
 */
function displayBucketSummary(counts: Record<PriorityBucket, number>): void {
  log('');
  log('バケット別集計:');
  log('-'.repeat(40));
  log(`  高優先 (70-100点): ${counts.high_priority || 0}社`);
  log(`  通常 (40-69点):    ${counts.normal || 0}社`);
  log(`  低優先 (0-39点):   ${counts.low_priority || 0}社`);
  log(`  既存顧客:          ${counts.existing_customer || 0}社`);
  log(`  要データ整備:      ${counts.data_cleanup || 0}社`);
}

/**
 * Interactive company selection
 */
async function selectCompany(queue: PriorityScore[]): Promise<string | null> {
  const selectable = queue.filter(
    s => s.bucket !== 'existing_customer' && s.bucket !== 'data_cleanup'
  );

  if (selectable.length === 0) {
    log('選択可能な企業がありません。');
    return null;
  }

  log('');
  log('企業を選択してください（番号を入力、Enterでキャンセル）:');
  log('');

  selectable.forEach((score, index) => {
    const num = String(index + 1).padStart(2, ' ');
    const scoreStr = String(score.score).padStart(3, ' ');
    log(`${num}. [${scoreStr}点] ${score.companyId} - ${score.companyName.substring(0, 30)}`);
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    rl.question('\n選択番号: ', answer => {
      rl.close();
      const num = parseInt(answer.trim(), 10);
      if (isNaN(num) || num < 1 || num > selectable.length) {
        resolve(null);
      } else {
        resolve(selectable[num - 1].companyId);
      }
    });
  });
}

/**
 * Run the pipeline for a selected company
 */
async function runPipelineForCompany(tag: string, companyId: string): Promise<void> {
  log('');
  log(`==> run_one_company.ts を実行: ${companyId}`);
  log('');

  const child = spawn('npx', [
    'ts-node',
    'src/cli/run_one_company.ts',
    '--tag', tag,
    '--company-id', companyId,
    '--dry-run',
  ], {
    stdio: 'inherit',
    cwd: process.cwd(),
  });

  return new Promise((resolve, reject) => {
    child.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Pipeline exited with code ${code}`));
      }
    });
    child.on('error', reject);
  });
}

/**
 * Main execution
 */
async function main(): Promise<QueueResult> {
  const result: QueueResult = {
    success: false,
    tag: options.tag,
    totalCompanies: 0,
    scoredCompanies: 0,
    queue: [],
    bucketCounts: {
      high_priority: 0,
      normal: 0,
      low_priority: 0,
      existing_customer: 0,
      data_cleanup: 0,
    },
    errors: [],
  };

  try {
    // ============================================================
    // Step 1: Validate CRM config
    // ============================================================
    log('Step 1: CRM設定を確認中...');

    try {
      validateCrmConfig();
    } catch (error) {
      if (error instanceof ConfigurationError) {
        result.errors.push(`CRM config error: ${error.message}`);
        return result;
      }
      throw error;
    }

    // ============================================================
    // Step 2: Search companies by tag
    // ============================================================
    log('Step 2: タグで企業を検索中...');

    const crmClient = CrmClient.createFromEnv();
    await crmClient.login();

    const companies = await crmClient.searchCompaniesByRawTag(options.tag);
    result.totalCompanies = companies.length;

    log(`   ${companies.length}社見つかりました`);

    if (companies.length === 0) {
      result.errors.push('No companies found matching the tag');
      return result;
    }

    // ============================================================
    // Step 3: Fetch details and history for each company
    // ============================================================
    log('Step 3: 企業詳細と連絡履歴を取得中...');

    const companiesForScoring: CompanyForScoring[] = [];
    const topN = parseInt(options.top, 10) || 20;

    // Limit to reasonable batch size
    const fetchLimit = Math.min(companies.length, 100);
    log(`   最大${fetchLimit}社のデータを取得します...`);

    for (let i = 0; i < fetchLimit; i++) {
      const company = companies[i];
      try {
        const [detail, history] = await Promise.all([
          crmClient.getCompanyDetail(company.companyId),
          crmClient.getCompanyContactHistory(company.companyId),
        ]);

        companiesForScoring.push({ detail, history });

        // Progress indicator
        if ((i + 1) % 10 === 0) {
          log(`   ${i + 1}/${fetchLimit} 完了...`);
        }
      } catch (error) {
        // Log error but continue with other companies
        const message = error instanceof Error ? error.message : 'Unknown error';
        logError(`   警告: ${company.companyId} のデータ取得に失敗: ${message}`);
      }
    }

    log(`   ${companiesForScoring.length}社のデータを取得しました`);

    if (companiesForScoring.length === 0) {
      result.errors.push('Failed to fetch company details');
      return result;
    }

    // ============================================================
    // Step 4: Score and rank companies
    // ============================================================
    log('Step 4: 優先度スコアを計算中...');

    const scorer = new PriorityScorer(undefined, new Date(), options.tag);
    const allScored = scorer.scoreBatch(companiesForScoring);

    result.scoredCompanies = allScored.length;

    // Count by bucket
    for (const score of allScored) {
      result.bucketCounts[score.bucket]++;
    }

    // Get top N (excluding special buckets by default)
    const showAll = options.showAll || false;
    const filteredScores = showAll
      ? allScored
      : allScored.filter(s => s.bucket !== 'existing_customer' && s.bucket !== 'data_cleanup');

    result.queue = filteredScores.slice(0, topN);

    log(`   ${result.scoredCompanies}社をスコアリング完了`);

    // ============================================================
    // Step 5: Display or output results
    // ============================================================
    result.success = true;

    if (options.json) {
      // JSON output handled at the end
      return result;
    }

    displayBucketSummary(result.bucketCounts);
    displayQueue(result.queue, showAll);

    // ============================================================
    // Step 6: Interactive selection (if --select)
    // ============================================================
    if (options.select) {
      const selectedId = await selectCompany(allScored);
      if (selectedId) {
        await runPipelineForCompany(options.tag, selectedId);
      } else {
        log('選択がキャンセルされました。');
      }
    }

  } catch (error) {
    if (error instanceof AuthError) {
      result.errors.push(`Authentication error: ${error.message}`);
    } else if (error instanceof NetworkError) {
      result.errors.push(`Network error: ${error.message}`);
    } else if (error instanceof ConfigurationError) {
      result.errors.push(`Configuration error: ${error.message}`);
    } else {
      result.errors.push(`Unexpected error: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
    logError(`Error: ${result.errors[result.errors.length - 1]}`);
  }

  return result;
}

// Entry point
(async () => {
  if (!options.json) {
    console.log('='.repeat(60));
    console.log('AI Sales - 日次優先度キュー生成');
    console.log('='.repeat(60));
    console.log('');
  }

  const result = await main();

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!result.success) {
    console.log('');
    console.log('エラーが発生しました:', result.errors.join(', '));
  }

  process.exit(result.success ? 0 : 1);
})();
