/**
 * Candidate Search Client (Stub Implementation)
 *
 * This is a stub that returns dummy candidates for MVP testing.
 * Will be replaced with actual candidate search API integration.
 */

import { Candidate, CompanyProfile } from '../../types';

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

export class CandidateClient {
  private readonly isStub: boolean;

  constructor() {
    // Currently always stub mode
    this.isStub = true;
  }

  /**
   * Search for candidates matching a company profile
   *
   * @param profile - Company profile to match against
   * @returns Array of matching candidates with rationale
   */
  async searchCandidates(profile: CompanyProfile): Promise<Candidate[]> {
    if (this.isStub) {
      return this.getStubCandidates(profile);
    }

    // TODO: Implement actual candidate search API
    throw new Error('Real candidate search not implemented');
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
          reasonTags: c.location === region
            ? [...c.rationale.reasonTags, '勤務地一致']
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
   * Check if running in stub mode
   */
  isStubMode(): boolean {
    return this.isStub;
  }
}

export default CandidateClient;
