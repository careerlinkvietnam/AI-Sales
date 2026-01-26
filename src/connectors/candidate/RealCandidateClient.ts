/**
 * Real Candidate Client Implementation
 *
 * Connects to the actual candidate search API.
 * Used when CANDIDATE_MODE=real is set.
 *
 * Environment Variables:
 *   CANDIDATE_API_URL - Base URL for the candidate API
 *   CANDIDATE_API_KEY - API key for authentication
 */

import { Candidate, CompanyProfile, NetworkError, ConfigurationError } from '../../types';
import {
  ICandidateClient,
  CandidateSearchOptions,
  CandidateSearchResult,
  validateCandidateRationale,
} from './CandidateClient';

/**
 * API response types
 */
interface ApiCandidateResponse {
  candidates: Candidate[];
  total: number;
  page: number;
  pageSize: number;
}

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

      // Filter out candidates with invalid rationale
      const validCandidates = data.candidates.filter(candidate => {
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
}

export default RealCandidateClient;
