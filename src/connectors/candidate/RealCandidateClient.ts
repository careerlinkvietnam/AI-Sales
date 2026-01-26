/**
 * Real Candidate Client Implementation
 *
 * Connects to the actual candidate search API.
 * Used when CANDIDATE_MODE=real is set.
 *
 * Environment Variables:
 *   CANDIDATE_API_URL - Base URL for the candidate API
 *   CANDIDATE_API_KEY - API key for authentication
 *
 * B案仕様:
 * - careerSummary必須（APIが返さない場合はテンプレートで合成）
 * - LLM補完禁止（決め打ちテンプレートのみ）
 */

import { Candidate, CompanyProfile, NetworkError, ConfigurationError } from '../../types';
import {
  ICandidateClient,
  CandidateSearchOptions,
  CandidateSearchResult,
  validateCandidateRationale,
} from './CandidateClient';

/**
 * API response candidate (may not have careerSummary)
 */
interface ApiCandidate {
  candidateId: string;
  headline: string;
  careerSummary?: string;
  keySkills: string[];
  location?: string | null;
  availability?: string | null;
  yearsOfExperience?: number | null;
  jobTitle?: string | null;
  industryExperience?: string | null;
  rationale: {
    reasonTags: string[];
    evidenceFields: string[];
  };
}

/**
 * API response types
 */
interface ApiCandidateResponse {
  candidates: ApiCandidate[];
  total: number;
  page: number;
  pageSize: number;
}

/** Maximum length for careerSummary */
const MAX_CAREER_SUMMARY_LENGTH = 400;

/**
 * Real implementation of candidate client
 * Connects to the candidate search API
 */
export class RealCandidateClient implements ICandidateClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number;

  constructor(options?: { apiUrl?: string; apiKey?: string; timeout?: number }) {
    this.apiUrl = options?.apiUrl || process.env.CANDIDATE_API_URL || '';
    this.apiKey = options?.apiKey || process.env.CANDIDATE_API_KEY || '';
    this.timeout = options?.timeout || 30000;

    // Validate configuration
    if (!this.apiUrl) {
      throw new ConfigurationError(
        'CANDIDATE_API_URL is required for real mode. Set CANDIDATE_MODE=stub for testing.'
      );
    }
    if (!this.apiKey) {
      throw new ConfigurationError(
        'CANDIDATE_API_KEY is required for real mode. Set CANDIDATE_MODE=stub for testing.'
      );
    }
  }

  /**
   * Search for candidates matching a company profile
   */
  async searchCandidates(
    profile: CompanyProfile,
    options?: CandidateSearchOptions
  ): Promise<CandidateSearchResult> {
    const searchCriteria = {
      companyId: profile.facts.companyId,
      region: options?.region || profile.facts.location.region || undefined,
      industryHint: options?.industryHint || profile.facts.industryText || undefined,
    };

    try {
      const response = await this.callApi('/search', {
        method: 'POST',
        body: JSON.stringify({
          companyProfile: {
            companyId: profile.facts.companyId,
            companyName: profile.facts.companyName,
            region: searchCriteria.region,
            industryText: searchCriteria.industryHint,
            tags: profile.facts.tags,
          },
          limit: options?.limit || 10,
        }),
      });

      const data = (await response.json()) as ApiCandidateResponse;

      // Normalize candidates (ensure careerSummary exists)
      const normalizedCandidates = data.candidates.map(c => this.normalizeCandidate(c));

      // Filter out candidates with invalid rationale
      const validCandidates = normalizedCandidates.filter(candidate => {
        const validation = validateCandidateRationale(candidate);
        if (!validation.valid) {
          // Log warning but don't expose details (PII protection)
          console.warn(
            `Candidate ${this.maskId(candidate.candidateId)} excluded: invalid rationale`
          );
        }
        return validation.valid;
      });

      return {
        candidates: validCandidates,
        totalFound: data.total,
        searchCriteria,
        mode: 'real',
      };
    } catch (error) {
      if (error instanceof NetworkError || error instanceof ConfigurationError) {
        throw error;
      }
      throw new NetworkError(
        `Candidate API error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
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
    return false;
  }

  /**
   * Get the current mode
   */
  getMode(): 'stub' | 'real' {
    return 'real';
  }

  /**
   * Call the candidate API
   */
  private async callApi(
    path: string,
    options: RequestInit
  ): Promise<Response> {
    const url = `${this.apiUrl}${path}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          ...options.headers,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new NetworkError(
          `Candidate API returned ${response.status}: ${response.statusText}`,
          response.status
        );
      }

      return response;
    } catch (error) {
      if (error instanceof NetworkError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new NetworkError('Candidate API request timed out');
      }
      throw new NetworkError(
        `Candidate API request failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Mask candidate ID for logging (PII protection)
   */
  private maskId(id: string): string {
    if (id.length <= 4) {
      return '****';
    }
    return id.substring(0, 2) + '****' + id.substring(id.length - 2);
  }

  /**
   * Normalize API candidate to our Candidate type
   * Ensures careerSummary exists (synthesize if not provided by API)
   */
  private normalizeCandidate(apiCandidate: ApiCandidate): Candidate {
    let careerSummary = apiCandidate.careerSummary;
    const evidenceFields = [...apiCandidate.rationale.evidenceFields];

    // If API doesn't provide careerSummary, synthesize from available fields
    if (!careerSummary) {
      const synthesis = this.synthesizeCareerSummary(apiCandidate);
      careerSummary = synthesis.summary;
      // Add synthesized fields to evidence
      synthesis.usedFields.forEach(field => {
        if (!evidenceFields.includes(field)) {
          evidenceFields.push(field);
        }
      });
    }

    // Truncate if too long
    if (careerSummary.length > MAX_CAREER_SUMMARY_LENGTH) {
      careerSummary = careerSummary.substring(0, MAX_CAREER_SUMMARY_LENGTH - 3) + '...';
    }

    return {
      candidateId: apiCandidate.candidateId,
      headline: apiCandidate.headline,
      careerSummary,
      keySkills: apiCandidate.keySkills,
      location: apiCandidate.location,
      availability: apiCandidate.availability,
      yearsOfExperience: apiCandidate.yearsOfExperience,
      jobTitle: apiCandidate.jobTitle,
      industryExperience: apiCandidate.industryExperience,
      rationale: {
        reasonTags: apiCandidate.rationale.reasonTags,
        evidenceFields,
      },
    };
  }

  /**
   * Synthesize careerSummary from available fields (テンプレートベース、LLM禁止)
   * Returns the synthesized summary and list of fields used
   */
  private synthesizeCareerSummary(candidate: ApiCandidate): {
    summary: string;
    usedFields: string[];
  } {
    const parts: string[] = [];
    const usedFields: string[] = [];

    // Job title + years of experience
    if (candidate.jobTitle && candidate.yearsOfExperience) {
      parts.push(`${candidate.jobTitle}として${candidate.yearsOfExperience}年の経験。`);
      usedFields.push('candidate.jobTitle', 'candidate.yearsOfExperience');
    } else if (candidate.jobTitle) {
      parts.push(`${candidate.jobTitle}としての経験あり。`);
      usedFields.push('candidate.jobTitle');
    } else if (candidate.yearsOfExperience) {
      parts.push(`${candidate.yearsOfExperience}年の実務経験。`);
      usedFields.push('candidate.yearsOfExperience');
    }

    // Industry experience
    if (candidate.industryExperience) {
      parts.push(`${candidate.industryExperience}業界での経験を持つ。`);
      usedFields.push('candidate.industryExperience');
    }

    // Key skills
    if (candidate.keySkills.length > 0) {
      const skills = candidate.keySkills.slice(0, 4).join('、');
      parts.push(`主要スキル：${skills}。`);
      usedFields.push('candidate.keySkills');
    }

    // Location
    if (candidate.location) {
      parts.push(`勤務希望地域：${candidate.location}。`);
      usedFields.push('candidate.location');
    }

    // Availability
    if (candidate.availability) {
      parts.push(`入社可能時期：${candidate.availability}。`);
      usedFields.push('candidate.availability');
    }

    // Fallback to headline if no other info
    if (parts.length === 0) {
      parts.push(candidate.headline);
      usedFields.push('candidate.headline');
    }

    return {
      summary: parts.join(''),
      usedFields,
    };
  }
}

export default RealCandidateClient;
