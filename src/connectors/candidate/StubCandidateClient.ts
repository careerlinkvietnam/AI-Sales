/**
 * Stub Candidate Client Implementation
 *
 * Returns dummy candidates for MVP testing and development.
 * This implementation is used when CANDIDATE_MODE is not set to 'real'.
 */

import { Candidate, CompanyProfile } from '../../types';
import {
  ICandidateClient,
  CandidateSearchOptions,
  CandidateSearchResult,
  validateCandidateRationale,
} from './CandidateClient';

/**
 * Dummy candidates for testing
 * In production, these would come from the candidate search API
 */
const DUMMY_CANDIDATES: Candidate[] = [
  {
    candidateId: 'C001',
    headline: '製造業経験10年のプロダクションマネージャー',
    keySkills: ['生産管理', '品質管理', 'リーンマネジメント', '日本語ビジネスレベル'],
    location: '南部',
    availability: '即日可能',
    rationale: {
      reasonTags: ['業界経験一致', '勤務地一致', '即戦力'],
      evidenceFields: ['company.industryText', 'company.location.region'],
    },
  },
  {
    candidateId: 'C002',
    headline: 'IT企業出身のプロジェクトマネージャー',
    keySkills: ['プロジェクト管理', 'アジャイル', 'ベトナム語・日本語堪能'],
    location: '南部',
    availability: '1ヶ月後',
    rationale: {
      reasonTags: ['マネジメント経験', '言語スキル', '勤務地一致'],
      evidenceFields: ['company.location.region'],
    },
  },
  {
    candidateId: 'C003',
    headline: '営業経験5年の日系企業担当',
    keySkills: ['法人営業', '日系企業対応', '提案型営業', '日本語N1'],
    location: '南部',
    availability: '2週間後',
    rationale: {
      reasonTags: ['営業経験', '日系企業理解', '言語スキル'],
      evidenceFields: ['company.tags'],
    },
  },
];

/**
 * Stub implementation of candidate client for testing
 */
export class StubCandidateClient implements ICandidateClient {
  /**
   * Search for candidates matching a company profile
   * Returns filtered dummy candidates
   */
  async searchCandidates(
    profile: CompanyProfile,
    options?: CandidateSearchOptions
  ): Promise<CandidateSearchResult> {
    let candidates = this.getStubCandidates(profile);

    // Apply region filter from options
    if (options?.region) {
      candidates = candidates.filter(c => c.location === options.region);
    }

    // Apply limit
    const limit = options?.limit ?? candidates.length;
    candidates = candidates.slice(0, limit);

    return {
      candidates,
      totalFound: DUMMY_CANDIDATES.length,
      searchCriteria: {
        companyId: profile.facts.companyId,
        region: options?.region || profile.facts.location.region || undefined,
        industryHint: options?.industryHint,
      },
      mode: 'stub',
    };
  }

  /**
   * Validate a candidate's rationale
   */
  validateRationale(candidate: Candidate): boolean {
    const result = validateCandidateRationale(candidate);
    return result.valid;
  }

  /**
   * Check if running in stub mode
   */
  isStubMode(): boolean {
    return true;
  }

  /**
   * Get the current mode
   */
  getMode(): 'stub' | 'real' {
    return 'stub';
  }

  /**
   * Get stub candidates filtered by profile
   */
  private getStubCandidates(profile: CompanyProfile): Candidate[] {
    // Filter candidates by region if available
    const region = profile.facts.location.region;

    let candidates = [...DUMMY_CANDIDATES];

    if (region) {
      // Prioritize candidates in the same region
      candidates = candidates.map(c => ({
        ...c,
        rationale: {
          ...c.rationale,
          reasonTags:
            c.location === region
              ? this.ensureTag(c.rationale.reasonTags, '勤務地一致')
              : c.rationale.reasonTags.filter(t => t !== '勤務地一致'),
        },
      }));
    }

    // Add company-specific evidence
    return candidates.map(c => ({
      ...c,
      rationale: {
        ...c.rationale,
        evidenceFields: [
          ...c.rationale.evidenceFields,
          `company.companyId=${profile.facts.companyId}`,
        ],
      },
    }));
  }

  /**
   * Ensure a tag exists in the array (no duplicates)
   */
  private ensureTag(tags: string[], tag: string): string[] {
    if (tags.includes(tag)) {
      return tags;
    }
    return [...tags, tag];
  }
}

export default StubCandidateClient;
