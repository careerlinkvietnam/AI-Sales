/**
 * Candidate Connector Module
 *
 * Provides candidate search functionality with support for
 * both stub (testing) and real (production) implementations.
 *
 * Usage:
 *   import { createCandidateClient } from './connectors/candidate';
 *   const client = createCandidateClient();
 */

// Interface and types
export {
  ICandidateClient,
  CandidateSearchOptions,
  CandidateSearchResult,
  VALID_REASON_TAGS,
  VALID_EVIDENCE_PATTERNS,
  ValidReasonTag,
  ValidEvidencePattern,
  isValidReasonTag,
  isValidEvidenceField,
  validateCandidateRationale,
} from './CandidateClient';

// Factory (primary export)
export {
  createCandidateClient,
  CandidateClientFactoryOptions,
  CandidateMode,
  isCandidateRealModeConfigured,
  getCandidateMode,
} from './CandidateClientFactory';

// Implementations (for testing/extension)
export { StubCandidateClient } from './StubCandidateClient';
export { RealCandidateClient } from './RealCandidateClient';
