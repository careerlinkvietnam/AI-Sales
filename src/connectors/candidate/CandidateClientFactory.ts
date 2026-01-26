/**
 * Candidate Client Factory
 *
 * Creates the appropriate candidate client based on environment configuration.
 * Use CANDIDATE_MODE environment variable to switch between stub and real modes.
 *
 * Environment Variables:
 *   CANDIDATE_MODE - 'stub' (default) or 'real'
 *   CANDIDATE_API_URL - Required for real mode
 *   CANDIDATE_API_KEY - Required for real mode
 */

import { ICandidateClient } from './CandidateClient';
import { StubCandidateClient } from './StubCandidateClient';
import { RealCandidateClient } from './RealCandidateClient';

/**
 * Valid candidate modes
 */
export type CandidateMode = 'stub' | 'real';

/**
 * Factory options for creating a candidate client
 */
export interface CandidateClientFactoryOptions {
  /** Force a specific mode (overrides environment variable) */
  mode?: CandidateMode;
  /** API URL for real mode (overrides environment variable) */
  apiUrl?: string;
  /** API key for real mode (overrides environment variable) */
  apiKey?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
}

/**
 * Create a candidate client based on environment configuration
 *
 * @param options - Optional factory configuration
 * @returns Candidate client instance
 *
 * @example
 * // Default: uses CANDIDATE_MODE env var
 * const client = createCandidateClient();
 *
 * @example
 * // Force stub mode for testing
 * const client = createCandidateClient({ mode: 'stub' });
 *
 * @example
 * // Force real mode with custom API URL
 * const client = createCandidateClient({
 *   mode: 'real',
 *   apiUrl: 'https://api.example.com',
 *   apiKey: 'secret'
 * });
 */
export function createCandidateClient(
  options?: CandidateClientFactoryOptions
): ICandidateClient {
  const mode = options?.mode || getCandidateModeFromEnv();

  if (mode === 'real') {
    return new RealCandidateClient({
      apiUrl: options?.apiUrl,
      apiKey: options?.apiKey,
      timeout: options?.timeout,
    });
  }

  return new StubCandidateClient();
}

/**
 * Get the candidate mode from environment variable
 */
function getCandidateModeFromEnv(): CandidateMode {
  const mode = process.env.CANDIDATE_MODE?.toLowerCase();
  if (mode === 'real') {
    return 'real';
  }
  return 'stub'; // Default to stub mode
}

/**
 * Check if candidate client is configured for real mode
 */
export function isCandidateRealModeConfigured(): boolean {
  return (
    process.env.CANDIDATE_MODE?.toLowerCase() === 'real' &&
    !!process.env.CANDIDATE_API_URL &&
    !!process.env.CANDIDATE_API_KEY
  );
}

/**
 * Get the current candidate mode from environment
 */
export function getCandidateMode(): CandidateMode {
  return getCandidateModeFromEnv();
}
