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
 * Dummy candidates for testing (B案仕様: careerSummary含む)
 * In production, these would come from the candidate search API
 */
const DUMMY_CANDIDATES: Candidate[] = [
  {
    candidateId: 'C001',
    headline: '製造業経験10年のプロダクションマネージャー',
    careerSummary:
      '日系製造企業にて10年間、生産管理およびプロダクションマネジメントを担当。' +
      '品質管理システムの導入により不良率を30%削減。リーンマネジメント手法を活用した' +
      '生産効率改善プロジェクトを複数主導。日本語ビジネスレベルで日系企業との折衝経験豊富。',
    keySkills: ['生産管理', '品質管理', 'リーンマネジメント', '日本語ビジネスレベル'],
    location: '南部',
    availability: '即日可能',
    yearsOfExperience: 10,
    jobTitle: 'プロダクションマネージャー',
    industryExperience: '製造業',
    rationale: {
      reasonTags: ['業界経験一致', '勤務地一致', '即戦力'],
      evidenceFields: ['company.industryText', 'company.location.region', 'candidate.careerSummary'],
    },
  },
  {
    candidateId: 'C002',
    headline: 'IT企業出身のプロジェクトマネージャー',
    careerSummary:
      'IT企業にて7年間、システム開発プロジェクトのマネジメントを担当。' +
      'アジャイル開発手法を導入し、プロジェクト納期遵守率を95%に向上。' +
      'ベトナム語・日本語のバイリンガルとして、日越間のブリッジSEも経験。' +
      'チームマネジメント経験あり（最大15名）。',
    keySkills: ['プロジェクト管理', 'アジャイル', 'ベトナム語・日本語堪能'],
    location: '南部',
    availability: '1ヶ月後',
    yearsOfExperience: 7,
    jobTitle: 'プロジェクトマネージャー',
    industryExperience: 'IT・ソフトウェア',
    rationale: {
      reasonTags: ['マネジメント経験', '言語スキル', '勤務地一致'],
      evidenceFields: ['company.location.region', 'candidate.careerSummary'],
    },
  },
  {
    candidateId: 'C003',
    headline: '営業経験5年の日系企業担当',
    careerSummary:
      '人材紹介会社にて5年間、法人営業として日系企業を担当。' +
      '新規開拓から既存顧客フォローまで一貫して対応し、年間売上目標を3年連続達成。' +
      '日本語能力試験N1取得。提案型営業を得意とし、顧客の潜在ニーズを引き出す' +
      'ヒアリング力に定評あり。',
    keySkills: ['法人営業', '日系企業対応', '提案型営業', '日本語N1'],
    location: '南部',
    availability: '2週間後',
    yearsOfExperience: 5,
    jobTitle: '法人営業担当',
    industryExperience: '人材サービス',
    rationale: {
      reasonTags: ['営業経験', '日系企業理解', '言語スキル'],
      evidenceFields: ['company.tags', 'candidate.careerSummary'],
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
