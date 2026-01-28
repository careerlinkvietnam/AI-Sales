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
import { EmailComposer, ComposeResult } from '../domain/EmailComposer';
import { TagNormalizer } from '../domain/TagNormalizer';
import { getAuditLogger } from '../domain/AuditLogger';
import { getApprovalTokenManager } from '../domain/ApprovalToken';
import { generateTrackingId, applyTrackingToEmail } from '../domain/Tracking';
import { getABAssigner, ABVariant } from '../domain/ABAssigner';
import { getDraftRegistry } from '../data/DraftRegistry';
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

// Mock data for testing
const MOCK_COMPANIES: CompanyStub[] = [
  { companyId: '1', name: 'ABC Manufacturing Co., Ltd.', region: '南部' },
  { companyId: '2', name: 'XYZ Tech Vietnam', region: '南部' },
  { companyId: '3', name: 'Delta Logistics', region: '南部' },
];

const MOCK_COMPANY_DETAIL: import('../types').CompanyDetail = {
  companyId: '1',
  name: 'ABC Manufacturing Co., Ltd.',
  nameLocal: 'ABC製造株式会社',
  profile: '製造業を営む日系企業。自動車部品の製造を主力とし、ベトナム南部に工場を持つ。',
  size: '100-500名',
  region: '南部',
  province: 'ホーチミン市',
  address: '123 Industrial Zone, District 7',
  contactEmail: 'hr@abc-manufacturing.example.com',
  phone: '+84-28-1234-5678',
  contactPerson: '田中太郎',
  tags: ['南部・3月連絡', '製造業', '日系'],
  createdAt: '2024-01-01',
  updatedAt: '2026-01-15',
};

const MOCK_CONTACT_HISTORY: import('../types').ContactHistory = {
  companyId: '1',
  items: [
    {
      actionId: 'h1',
      actionType: 'tel',
      performedAt: '2026-01-10T10:00:00Z',
      agentName: '佐藤',
      summary: '3月の採用計画について確認。エンジニア2名、営業1名の採用予定。',
    },
    {
      actionId: 'h2',
      actionType: 'visit',
      performedAt: '2025-12-15T14:00:00Z',
      agentName: '佐藤',
      summary: '年末挨拶で訪問。来年の採用予算が増加予定とのこと。',
    },
  ],
  totalCount: 2,
};

// CLI Configuration
const program = new Command();

program
  .name('run_one_company')
  .description('Run full pipeline: tag search → company → candidates → email → Gmail draft')
  .version('0.1.0');

program
  .option('-t, --tag <tag>', 'Raw tag to search (e.g., "南部・3月連絡"). If not specified, uses current month.')
  .option('-r, --region <region>', 'Region for auto tag generation (default: 南部)', '南部')
  .option('-c, --company-id <id>', 'Specific company ID to process (default: first match)')
  .option('--dry-run', 'Skip Gmail draft creation, output email content only')
  .option('--mock', 'Use mock CRM data instead of real API')
  .option('-v, --verbose', 'Show detailed output for each step')
  .option('--json', 'Output results as JSON only (no progress messages)');

program.parse();

const options = program.opts();

// Auto-generate tag from current month if not specified
if (!options.tag) {
  const currentMonth = new Date().getMonth() + 1; // 1-12
  options.tag = `${options.region}・${currentMonth}月連絡`;
}

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
  candidatesIncluded: number;
  candidatesExcluded: number;
  email: {
    subject: string;
    bodyPreview: string;
    bodyLength: number;
    validationOk: boolean;
    trackingId: string;
    templateId: string;
    abVariant: ABVariant | null;
  } | null;
  gmailDraft: {
    draftId: string;
    isStub: boolean;
    approvalToken?: string;
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
    candidatesIncluded: 0,
    candidatesExcluded: 0,
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

    let companies: CompanyStub[];
    let crmClient: CrmClient | null = null;

    if (options.mock) {
      // Use mock data
      logVerbose('   Using mock data');
      companies = MOCK_COMPANIES.filter(c =>
        normalized.region ? c.region === normalized.region : true
      );
    } else {
      // Use real CRM
      try {
        validateCrmConfig();
      } catch (error) {
        if (error instanceof ConfigurationError) {
          result.errors.push(`CRM config error: ${error.message}`);
          return result;
        }
        throw error;
      }

      crmClient = CrmClient.createFromEnv();

      // Login
      logVerbose('   Authenticating...');
      await crmClient.login();
      logVerbose('   Authentication successful');

      // Search
      logVerbose(`   Searching for tag: ${options.tag}`);
      companies = await crmClient.searchCompaniesByRawTag(options.tag);
    }

    result.searchResultCount = companies.length;
    log(`   Found ${companies.length} companies${options.mock ? ' (mock)' : ''}`);

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

    let companyDetail;
    let contactHistory;

    if (options.mock) {
      // Use mock detail and history
      companyDetail = MOCK_COMPANY_DETAIL;
      contactHistory = MOCK_CONTACT_HISTORY;
    } else {
      // Get company detail (required)
      companyDetail = await crmClient!.getCompanyDetail(selectedCompany.companyId);

      // Try to get contact history (optional - may fail due to server issues)
      try {
        contactHistory = await crmClient!.getCompanyContactHistory(selectedCompany.companyId);
      } catch (historyError) {
        logVerbose(`   Warning: Could not fetch contact history: ${historyError instanceof Error ? historyError.message : 'Unknown error'}`);
        // Use empty history as fallback
        contactHistory = {
          companyId: selectedCompany.companyId,
          items: [],
          totalCount: 0,
        };
      }
    }

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
    // Step 7: Compose email with A/B assignment and tracking
    // ============================================================
    log('Step 7: Composing email...');

    // Generate tracking ID
    const trackingId = generateTrackingId();
    logVerbose(`   Tracking ID: ${trackingId}`);

    // Get A/B assignment for this company
    const abAssigner = getABAssigner();
    const abAssignment = abAssigner.assign(companyProfile.facts.companyId);
    logVerbose(`   A/B Variant: ${abAssignment.variant} (${abAssignment.templateId})`);

    // Compose email with A/B template
    const emailComposer = new EmailComposer({ abAssignment });
    const composeResult: ComposeResult = emailComposer.composeWithAudit(companyProfile, candidates);

    // Apply tracking to email
    const trackedEmail = applyTrackingToEmail(
      composeResult.email.subject,
      composeResult.email.body,
      trackingId
    );
    const email: EmailOutput = {
      ...composeResult.email,
      subject: trackedEmail.subject,
      body: trackedEmail.body,
    };

    // Count included/excluded candidates
    const includedCount = composeResult.candidateExclusions.filter(e => e.included).length;
    const excludedCount = composeResult.candidateExclusions.filter(e => !e.included).length;
    result.candidatesIncluded = includedCount;
    result.candidatesExcluded = excludedCount;

    result.email = {
      subject: email.subject,
      bodyPreview: email.body.substring(0, 100) + (email.body.length > 100 ? '...' : ''),
      bodyLength: email.body.length,
      validationOk: composeResult.validationResult.ok,
      trackingId,
      templateId: composeResult.templateId,
      abVariant: composeResult.abVariant,
    };

    log(`   Subject: ${email.subject}`);
    log(`   Template: ${composeResult.templateId} (Variant ${abAssignment.variant})`);
    logVerbose(`   Body length: ${email.body.length} chars`);
    if (excludedCount > 0) {
      log(`   Warning: ${excludedCount} candidate(s) excluded due to PII`);
    }

    // Log validation issues if any
    if (!composeResult.validationResult.ok) {
      logError(`   Email validation failed: ${composeResult.validationResult.violations.join(', ')}`);
    }

    // ============================================================
    // Step 8: Create Gmail draft
    // ============================================================
    log('Step 8: Creating Gmail draft...');

    const auditLogger = getAuditLogger();
    const tokenManager = getApprovalTokenManager();
    const draftRegistry = getDraftRegistry();
    const mode = candidateClient.isStubMode() ? 'stub' : 'real';

    if (options.dryRun) {
      log('   Dry run mode - skipping Gmail draft');
      log('');
      log('--- Email Preview ---');
      log(`Tracking ID: ${trackingId}`);
      log(`Template: ${composeResult.templateId}`);
      log(`A/B Variant: ${abAssignment.variant}`);
      log(`Subject: ${email.subject}`);
      log('---');
      log(email.body);
      log('--- End Preview ---');

      // Log pipeline run without draft
      auditLogger.logPipelineRun({
        tag: options.tag,
        companyId: companyProfile.facts.companyId,
        companyName: companyProfile.facts.companyName,
        selectedCandidates: composeResult.candidateExclusions,
        draftCreated: false,
        mode,
        trackingId,
        templateId: composeResult.templateId,
        abVariant: composeResult.abVariant,
        metadata: { dryRun: true },
      });
    } else {
      const gmailClient = new GmailClient();

      // Use company email if available, otherwise placeholder
      const recipientEmail = companyDetail.contactEmail || `company-${companyDetail.companyId}@placeholder.local`;

      const draftResult: GmailDraftResult = await gmailClient.createDraft(
        recipientEmail,
        email.subject,
        email.body
      );

      // Generate approval token for future send authorization
      const approvalToken = tokenManager.generateToken({
        draftId: draftResult.draftId,
        companyId: companyProfile.facts.companyId,
        candidateCount: includedCount,
        mode,
        trackingId,
      });

      // Register draft in DraftRegistry (for send_draft verification)
      draftRegistry.registerDraft({
        draftId: draftResult.draftId,
        trackingId,
        companyId: companyProfile.facts.companyId,
        templateId: composeResult.templateId,
        abVariant: composeResult.abVariant,
        subject: email.subject,
        body: email.body,
        toEmail: recipientEmail,
      });

      logVerbose(`   Draft registered in DraftRegistry`);

      result.gmailDraft = {
        draftId: draftResult.draftId,
        isStub: gmailClient.isStubMode(),
        approvalToken,
      };

      log(`   Draft created: ${draftResult.draftId}${gmailClient.isStubMode() ? ' (stub mode)' : ''}`);

      // Log pipeline run with draft
      auditLogger.logPipelineRun({
        tag: options.tag,
        companyId: companyProfile.facts.companyId,
        companyName: companyProfile.facts.companyName,
        selectedCandidates: composeResult.candidateExclusions,
        draftCreated: true,
        gmailDraftId: draftResult.draftId,
        mode,
        trackingId,
        templateId: composeResult.templateId,
        abVariant: composeResult.abVariant,
      });

      // Log draft created event
      auditLogger.logDraftCreated({
        tag: options.tag,
        companyId: companyProfile.facts.companyId,
        gmailDraftId: draftResult.draftId,
        candidateCount: includedCount,
        mode,
        trackingId,
        templateId: composeResult.templateId,
        abVariant: composeResult.abVariant,
      });
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
