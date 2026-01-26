#!/usr/bin/env ts-node
/**
 * CRM Debug CLI
 *
 * Usage:
 *   npx ts-node src/cli/crm_debug.ts --tag "南部・3月連絡"
 *   npx ts-node src/cli/crm_debug.ts --tag "南部・3月連絡" --mock
 *
 * Environment Variables (see docs/runbook.md):
 *   CRM_BASE_URL - CRM API base URL
 *   CRM_SESSION_TOKEN - Pre-existing session token (optional)
 *   CRM_LOGIN_EMAIL - Login email (if no token)
 *   CRM_LOGIN_PASSWORD - Login password (if no token)
 *
 * Output:
 *   - Tag normalization result
 *   - List of matching companies (ID and name only, minimal PII)
 */

import { config } from 'dotenv';
import { Command } from 'commander';
import { TagNormalizer } from '../domain/TagNormalizer';
import { CrmClient, SearchOptions } from '../connectors/crm/CrmClient';
import { AuthError, NetworkError, CompanyStub } from '../types';

// Load environment variables from .env
config();

// CLI Configuration
const program = new Command();

program
  .name('crm_debug')
  .description('Debug CLI for CRM tag search and company lookup')
  .version('0.1.0');

program
  .option('-t, --tag <tag>', 'Raw tag to search (e.g., "南部・3月連絡")')
  .option('--mock', 'Use mock data instead of real API')
  .option('-v, --verbose', 'Show verbose output')
  .option('--limit <n>', 'Limit display to first N companies', '10')
  .option('--base-url <url>', 'CRM API base URL', process.env.CRM_BASE_URL);

program.parse();

const options = program.opts();

// Mock data for testing without API
const MOCK_COMPANIES: CompanyStub[] = [
  { companyId: '1', name: 'ABC Manufacturing Co., Ltd.', region: '南部', tags: ['南部・3月連絡', '製造業'] },
  { companyId: '2', name: 'XYZ Tech Vietnam', region: '南部', tags: ['南部・3月連絡', 'IT'] },
  { companyId: '3', name: 'Delta Logistics', region: '南部', tags: ['南部・3月連絡', '物流'] },
  { companyId: '4', name: 'North Star Industries', region: '北部', tags: ['北部・4月連絡', '製造業'] },
  { companyId: '5', name: 'Central Trading Co.', region: '中部', tags: ['中部・3月連絡', '商社'] },
];

/**
 * Format company for display (minimal PII)
 */
function formatCompany(company: CompanyStub, index: number): string {
  return `  ${index + 1}. [ID:${company.companyId}] ${company.name}${company.region ? ` (${company.region})` : ''}`;
}

/**
 * Mock search implementation
 */
function mockSearch(rawTag: string): CompanyStub[] {
  return MOCK_COMPANIES.filter(company =>
    company.tags?.some(tag => tag.includes(rawTag) || rawTag.includes(tag.split('・')[0]))
  );
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  const { tag, mock, verbose, limit, baseUrl } = options;
  const displayLimit = parseInt(limit, 10) || 10;

  // Validate required options
  if (!tag) {
    console.error('Error: --tag option is required');
    console.error('Usage: npx ts-node src/cli/crm_debug.ts --tag "南部・3月連絡"');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('CRM Debug CLI');
  console.log('='.repeat(60));
  console.log();

  // Step 1: Normalize tag
  console.log('1. Tag Normalization');
  console.log('-'.repeat(40));

  const normalizer = new TagNormalizer();
  const parseResult = normalizer.parse(tag);

  if (!parseResult.success) {
    console.error(`   Error: ${parseResult.error}`);
    process.exit(1);
  }

  const normalized = parseResult.normalized!;
  console.log(`   Raw Tag:       ${normalized.rawTag}`);
  console.log(`   Region:        ${normalized.region || '(none)'}`);
  console.log(`   Contact Month: ${normalized.contactMonth || '(none)'}`);
  console.log(`   Contact Year:  ${normalized.contactYear || '(none)'}`);
  console.log(`   Contact Date:  ${normalized.contactDate || '(none)'}`);
  console.log(`   Is Contact:    ${normalized.isContactTag}`);

  if (verbose && normalized.otherAttributes) {
    console.log(`   Other Attrs:   ${JSON.stringify(normalized.otherAttributes)}`);
  }

  console.log();

  // Step 2: Search companies
  console.log('2. Company Search');
  console.log('-'.repeat(40));

  let companies: CompanyStub[] = [];
  let searchMethod = 'mock';

  if (mock) {
    console.log('   Mode: Mock data');
    companies = mockSearch(tag);
  } else {
    // Real API mode
    if (!baseUrl) {
      console.error('   Error: CRM_BASE_URL not set');
      console.error('   Set CRM_BASE_URL in .env or use --base-url option');
      console.error('   Or use --mock flag for testing');
      process.exit(1);
    }

    console.log(`   Mode: Real API`);
    console.log(`   Base URL: ${baseUrl}`);

    // Check authentication
    const hasToken = !!process.env.CRM_SESSION_TOKEN;
    const hasCredentials = !!(process.env.CRM_LOGIN_EMAIL && process.env.CRM_LOGIN_PASSWORD);

    if (!hasToken && !hasCredentials) {
      console.error('   Error: No authentication configured');
      console.error('   Set CRM_SESSION_TOKEN or (CRM_LOGIN_EMAIL + CRM_LOGIN_PASSWORD) in .env');
      process.exit(1);
    }

    console.log(`   Auth: ${hasToken ? 'Token' : 'Credentials'}`);

    try {
      const client = new CrmClient({ baseUrl });

      // Login
      console.log('   Authenticating...');
      await client.login();
      console.log('   Authentication successful');

      // Search
      console.log(`   Searching for tag: ${tag}`);
      const searchOptions: SearchOptions = {
        fetchAll: true,
        maxPages: 100,
      };

      companies = await client.searchCompaniesByRawTag(tag, searchOptions);
      searchMethod = 'api';

    } catch (error) {
      if (error instanceof AuthError) {
        console.error(`   Auth Error: ${error.message}`);
        console.error('   Check your credentials in .env');
        process.exit(1);
      } else if (error instanceof NetworkError) {
        console.error(`   Network Error: ${error.message}`);
        if (error.statusCode === 404) {
          console.error('   The endpoint may not exist or the URL is incorrect');
        }
        process.exit(1);
      } else {
        console.error(`   Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        process.exit(1);
      }
    }
  }

  console.log();

  // Step 3: Display results
  console.log('3. Results');
  console.log('-'.repeat(40));
  console.log(`   Total found: ${companies.length} companies`);
  console.log(`   Source: ${searchMethod}`);
  console.log();

  if (companies.length === 0) {
    console.log('   No companies found matching the tag.');
  } else {
    const displayCount = Math.min(companies.length, displayLimit);
    console.log(`   Showing first ${displayCount} of ${companies.length}:`);
    console.log();

    for (let i = 0; i < displayCount; i++) {
      console.log(formatCompany(companies[i], i));
    }

    if (companies.length > displayLimit) {
      console.log();
      console.log(`   ... and ${companies.length - displayLimit} more`);
      console.log(`   Use --limit <n> to show more`);
    }
  }

  console.log();
  console.log('='.repeat(60));
  console.log('Done');
}

// Run main
main().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
