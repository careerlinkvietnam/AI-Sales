/**
 * Candidate Client Interface Definition
 *
 * Defines the contract for candidate search implementations.
 * Supports both stub (testing) and real (production) modes.
 */

import { Candidate, CompanyProfile } from '../../types';

// ============================================================
// Valid Reason Tags
// ============================================================

/**
 * Valid reasonTags for candidate rationale
 * Used to explain why a candidate matches a company
 */
export const VALID_REASON_TAGS = [
  '勤務地一致',
  '業界近似',
  '業界経験一致',
  '職種一致',
  '日本語可',
  '言語スキル',
  'マネジメント経験',
  '即戦力',
  '営業経験',
  '日系企業理解',
  '技術スキル一致',
] as const;

export type ValidReasonTag = (typeof VALID_REASON_TAGS)[number];

// ============================================================
// Valid Evidence Patterns
// ============================================================

/**
 * Valid evidenceFields patterns for candidate rationale
 * References fields from company profile used as matching evidence
 */
export const VALID_EVIDENCE_PATTERNS = [
  'company.location.region',
  'company.location.province',
  'company.industryText',
  'company.tags',
  'company.companyId',
  'company.profile',
] as const;

export type ValidEvidencePattern = (typeof VALID_EVIDENCE_PATTERNS)[number];

// ============================================================
// Search Options and Result Types
// ============================================================

/**
 * Options for candidate search
 */
export interface CandidateSearchOptions {
  /** Maximum number of candidates to return */
  limit?: number;
  /** Filter by region */
  region?: string;
  /** Industry hint for matching */
  industryHint?: string;
}

/**
 * Result of a candidate search operation
 */
export interface CandidateSearchResult {
  /** List of matching candidates */
  candidates: Candidate[];
  /** Total number of candidates found (may be more than returned) */
  totalFound: number;
  /** Criteria used for the search */
  searchCriteria: {
    companyId: string;
    region?: string;
    industryHint?: string;
  };
  /** Mode indicator */
  mode: 'stub' | 'real';
}

// ============================================================
// Candidate Client Interface
// ============================================================

/**
 * Interface for candidate search client implementations
 */
export interface ICandidateClient {
  /**
   * Search for candidates matching a company profile
   *
   * @param profile - Company profile to match against
   * @param options - Optional search parameters
   * @returns Search result with candidates and metadata
   */
  searchCandidates(
    profile: CompanyProfile,
    options?: CandidateSearchOptions
  ): Promise<CandidateSearchResult>;

  /**
   * Validate a candidate's rationale for quality
   * Checks if reasonTags and evidenceFields are valid
   *
   * @param candidate - Candidate to validate
   * @returns true if rationale is valid
   */
  validateRationale(candidate: Candidate): boolean;

  /**
   * Check if running in stub mode
   */
  isStubMode(): boolean;

  /**
   * Get the current mode
   */
  getMode(): 'stub' | 'real';
}

// ============================================================
// Validation Helpers
// ============================================================

/**
 * Check if a reason tag is valid
 */
export function isValidReasonTag(tag: string): tag is ValidReasonTag {
  return (VALID_REASON_TAGS as readonly string[]).includes(tag);
}

/**
 * Check if an evidence field matches valid patterns
 */
export function isValidEvidenceField(field: string): boolean {
  // Exact match
  if ((VALID_EVIDENCE_PATTERNS as readonly string[]).includes(field)) {
    return true;
  }

  // Pattern match (e.g., "company.companyId=123" matches "company.companyId")
  return VALID_EVIDENCE_PATTERNS.some(pattern => field.startsWith(pattern));
}

/**
 * Validate a candidate's rationale
 * Returns validation result with details
 */
export function validateCandidateRationale(candidate: Candidate): {
  valid: boolean;
  invalidReasonTags: string[];
  invalidEvidenceFields: string[];
} {
  const invalidReasonTags = candidate.rationale.reasonTags.filter(
    tag => !isValidReasonTag(tag)
  );

  const invalidEvidenceFields = candidate.rationale.evidenceFields.filter(
    field => !isValidEvidenceField(field)
  );

  return {
    valid: invalidReasonTags.length === 0 && invalidEvidenceFields.length === 0,
    invalidReasonTags,
    invalidEvidenceFields,
  };
}
