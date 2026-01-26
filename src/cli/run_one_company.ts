#!/usr/bin/env ts-node
/**
 * Run One Company Pipeline CLI
 *
 * Full pipeline: Tag search → Company selection → Candidates → Email → Gmail Draft
 *
 * Usage:
 *   npx ts-node src/cli/run_one_company.ts --tag "南部・3月連絡"
 *   npx ts-node src/cli/run_one_company.ts --tag "南部・3月連絡" --company-id 123
 *   npx ts-node src/cli/run_one_company.ts --tag "南部・3月連絡" --dry-run
 *
 * Environment Variables:
 *   CRM: CRM_BASE_URL, CRM_LOGIN_EMAIL, CRM_LOGIN_PASSWORD (or CRM_SESSION_TOKEN)
 *   Gmail: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
 *
 * Output:
 *   JSON summary of the pipeline result (minimal PII)
 */

import { config } from 'dotenv';
import { Command } from 'commander';
import { CrmClient, validateCrmConfig } from '../connectors/crm/CrmClient';
import { createCandidateClient, ICandidateClient } from '../connectors/candidate';
import { GmailClient, isGmailConfigured } from '../connectors/gmail/GmailClient';
import { CompanyProfileBuilder } from '../domain/CompanyProfileBuilder';
import { EmailComposer } from '../domain/EmailComposer';
import { TagNormalizer } from '../domain/TagNormalizer';
import {
  AuthError,
  NetworkError,
  ConfigurationError,
  CompanyStub,
  CompanyProfile,
  Candidate,
  EmailOutput,
  GmailDraftResult,
} from '../types';

// Load environment variables
config();

// CLI Configuration
const program = new Command();

program
  .name('run_one_company')
  .description('Run full pipeline: tag search → company → candidates → email → Gmail draft')
  .version('0.1.0');

program
  .requiredOption('-t, --tag <tag>', 'Raw tag to search (e.g., "南部・3月連絡")')
  .option('-c, --company-id <id>', 'Specific company ID to process (default: first match)')
  .option('--dry-run', 'Skip Gmail draft creation, output email content only')
  .option('-v, --verbose', 'Show detailed output for each step')
  .option('--json', 'Output results as JSON only (no progress messages)');

program.parse();

const options = program.opts();

/**
 * Pipeline result structure
 */
interface PipelineResult {
  success: boolean;
  tag: string;
  tagNormalized: {
    region: string | null;
    contactMonth: number | null;
    contactYear: number | null;
  };
  company: {
    id: string;
    name: string;
    region: string | null;
  } | null;
  searchResultCount: number;
  candidatesCount: number;
  email: {
    subject: string;
    bodyPreview: string;
    bodyLength: number;
  } | null;
  gmailDraft: {
    draftId: string;
    isStub: boolean;
  } | null;
  errors: string[];
  mode: {
    dryRun: boolean;
    gmailConfigured: boolean;
    candidateStub: boolean;
  };
}

/**
 * Logger that respects --json flag
 */
function log(message: string): void {
  if (!options.json) {
    console.log(message);
  }
}

function logVerbose(message: string): void {
  if (options.verbose && !options.json) {
    console.log(message);
  }
}

function logError(message: string): void {
  if (!options.json) {
    console.error(message);
  }
}

/**
 * Main pipeline execution
 */
async function runPipeline(): Promise<PipelineResult> {
  const result: PipelineResult = {
    success: false,
    tag: options.tag,
    tagNormalized: {
      region: null,
      contactMonth: null,
      contactYear: null,
    },
    company: null,
    searchResultCount: 0,
    candidatesCount: 0,
    email: null,
    gmailDraft: null,
    errors: [],
    mode: {
      dryRun: options.dryRun || false,
      gmailConfigured: isGmailConfigured(),
      candidateStub: true, // Always stub for now
    },
  };

  try {
    // ============================================================
    // Step 1: Normalize tag
    // ============================================================
    log('Step 1: Normalizing tag...');

    const normalizer = new TagNormalizer();
    const parseResult = normalizer.parse(options.tag);

    if (!parseResult.success || !parseResult.normalized) {
      result.errors.push(`Tag parse error: ${parseResult.error}`);
      return result;
    }

    const normalized = parseResult.normalized;
    result.tagNormalized = {
      region: normalized.region || null,
      contactMonth: normalized.contactMonth || null,
      contactYear: normalized.contactYear || null,
    };

    logVerbose(`   Region: ${normalized.region || '(none)'}`);
    logVerbose(`   Contact: ${normalized.contactMonth}/${normalized.contactYear}`);

    // ============================================================
    // Step 2: Validate CRM config and search
    // ============================================================
    log('Step 2: Searching CRM for companies...');

    try {
      validateCrmConfig();
    } catch (error) {
      if (error instanceof ConfigurationError) {
        result.errors.push(`CRM config error: ${error.message}`);
        return result;
      }
      throw error;
    }

    const crmClient = CrmClient.createFromEnv();

    // Login
    logVerbose('   Authenticating...');
    await crmClient.login();
    logVerbose('   Authentication successful');

    // Search
    logVerbose(`   Searching for tag: ${options.tag}`);
    const companies = await crmClient.searchCompaniesByRawTag(options.tag);
    result.searchResultCount = companies.length;

    log(`   Found ${companies.length} companies`);

    if (companies.length === 0) {
      result.errors.push('No companies found matching the tag');
      return result;
    }

    // ============================================================
    // Step 3: Select company
    // ============================================================
    log('Step 3: Selecting company...');

    let selectedCompany: CompanyStub | undefined;

    if (options.companyId) {
      selectedCompany = companies.find(c => c.companyId === options.companyId);
      if (!selectedCompany) {
        result.errors.push(`Company ID ${options.companyId} not found in search results`);
        return result;
      }
      logVerbose(`   Selected by ID: ${selectedCompany.companyId}`);
    } else {
      selectedCompany = companies[0];
      logVerbose(`   Selected first match: ${selectedCompany.companyId}`);
    }

    log(`   Company: [${selectedCompany.companyId}] ${selectedCompany.name}`);

    // ============================================================
    // Step 4: Get company details and contact history
    // ============================================================
    log('Step 4: Fetching company details...');

    const [companyDetail, contactHistory] = await Promise.all([
      crmClient.getCompanyDetail(selectedCompany.companyId),
      crmClient.getCompanyContactHistory(selectedCompany.companyId),
    ]);

    logVerbose(`   Profile length: ${companyDetail.profile?.length || 0} chars`);
    logVerbose(`   Contact history: ${contactHistory.totalCount || 0} records`);

    // ============================================================
    // Step 5: Build company profile
    // ============================================================
    log('Step 5: Building company profile...');

    const profileBuilder = new CompanyProfileBuilder();
    const companyProfile: CompanyProfile = profileBuilder.build(companyDetail, contactHistory);

    result.company = {
      id: companyProfile.facts.companyId,
      name: companyProfile.facts.companyName,
      region: companyProfile.facts.location.region || null,
    };

    logVerbose(`   Profile built with ${companyProfile.assumptions.length} assumptions`);
    logVerbose(`   Industry summary: ${companyProfile.summaries.industrySummary?.substring(0, 50) || '(none)'}...`);

    // ============================================================
    // Step 6: Search candidates
    // ============================================================
    log('Step 6: Searching candidates...');

    const candidateClient: ICandidateClient = createCandidateClient();
    const searchResult = await candidateClient.searchCandidates(companyProfile);
    const candidates: Candidate[] = searchResult.candidates;

    result.candidatesCount = candidates.length;
    result.mode.candidateStub = candidateClient.isStubMode();

    log(`   Found ${candidates.length} candidates${candidateClient.isStubMode() ? ' (stub mode)' : ''}`);

    if (candidates.length === 0) {
      result.errors.push('No candidates found for this company');
      return result;
    }

    // ============================================================
    // Step 7: Compose email
    // ============================================================
    log('Step 7: Composing email...');

    const emailComposer = new EmailComposer();
    const email: EmailOutput = emailComposer.compose(companyProfile, candidates);

    result.email = {
      subject: email.subject,
      bodyPreview: email.body.substring(0, 100) + (email.body.length > 100 ? '...' : ''),
      bodyLength: email.body.length,
    };

    log(`   Subject: ${email.subject}`);
    logVerbose(`   Body length: ${email.body.length} chars`);

    // ============================================================
    // Step 8: Create Gmail draft
    // ============================================================
    log('Step 8: Creating Gmail draft...');

    if (options.dryRun) {
      log('   Dry run mode - skipping Gmail draft');
      log('');
      log('--- Email Preview ---');
      log(`Subject: ${email.subject}`);
      log('---');
      log(email.body);
      log('--- End Preview ---');
    } else {
      const gmailClient = new GmailClient();

      // Use company email if available, otherwise placeholder
      const recipientEmail = companyDetail.contactEmail || `company-${companyDetail.companyId}@placeholder.local`;

      const draftResult: GmailDraftResult = await gmailClient.createDraft(
        recipientEmail,
        email.subject,
        email.body
      );

      result.gmailDraft = {
        draftId: draftResult.draftId,
        isStub: gmailClient.isStubMode(),
      };

      log(`   Draft created: ${draftResult.draftId}${gmailClient.isStubMode() ? ' (stub mode)' : ''}`);
    }

    // ============================================================
    // Success
    // ============================================================
    result.success = true;
    log('');
    log('Pipeline completed successfully!');

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

/**
 * Main entry point
 */
async function main(): Promise<void> {
  if (!options.json) {
    console.log('='.repeat(60));
    console.log('AI Sales - One Company Pipeline');
    console.log('='.repeat(60));
    console.log('');
  }

  const result = await runPipeline();

  if (options.json) {
    // JSON output only
    console.log(JSON.stringify(result, null, 2));
  } else {
    // Summary output
    console.log('');
    console.log('='.repeat(60));
    console.log('Pipeline Summary');
    console.log('='.repeat(60));
    console.log(JSON.stringify(result, null, 2));
  }

  // Exit with appropriate code
  process.exit(result.success ? 0 : 1);
}

// Run
main().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
