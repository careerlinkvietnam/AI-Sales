/**
 * CandidateClient Test Suite
 *
 * Tests for the candidate client interface, validation helpers,
 * and factory functions.
 */

import {
  VALID_REASON_TAGS,
  VALID_EVIDENCE_PATTERNS,
  isValidReasonTag,
  isValidEvidenceField,
  validateCandidateRationale,
} from '../src/connectors/candidate/CandidateClient';
import { Candidate } from '../src/types';

describe('CandidateClient Interface', () => {
  describe('VALID_REASON_TAGS', () => {
    test('contains expected reason tags', () => {
      expect(VALID_REASON_TAGS).toContain('勤務地一致');
      expect(VALID_REASON_TAGS).toContain('業界経験一致');
      expect(VALID_REASON_TAGS).toContain('言語スキル');
      expect(VALID_REASON_TAGS).toContain('即戦力');
      expect(VALID_REASON_TAGS).toContain('営業経験');
    });

    test('has 11 defined tags', () => {
      expect(VALID_REASON_TAGS.length).toBe(11);
    });
  });

  describe('VALID_EVIDENCE_PATTERNS', () => {
    test('contains expected company evidence patterns', () => {
      expect(VALID_EVIDENCE_PATTERNS).toContain('company.location.region');
      expect(VALID_EVIDENCE_PATTERNS).toContain('company.industryText');
      expect(VALID_EVIDENCE_PATTERNS).toContain('company.tags');
      expect(VALID_EVIDENCE_PATTERNS).toContain('company.companyId');
    });

    test('contains candidate evidence patterns for careerSummary', () => {
      expect(VALID_EVIDENCE_PATTERNS).toContain('candidate.careerSummary');
      expect(VALID_EVIDENCE_PATTERNS).toContain('candidate.jobTitle');
      expect(VALID_EVIDENCE_PATTERNS).toContain('candidate.yearsOfExperience');
      expect(VALID_EVIDENCE_PATTERNS).toContain('candidate.keySkills');
    });

    test('has 14 defined patterns (6 company + 8 candidate)', () => {
      expect(VALID_EVIDENCE_PATTERNS.length).toBe(14);
    });
  });

  describe('isValidReasonTag', () => {
    test('returns true for valid reason tags', () => {
      expect(isValidReasonTag('勤務地一致')).toBe(true);
      expect(isValidReasonTag('業界近似')).toBe(true);
      expect(isValidReasonTag('マネジメント経験')).toBe(true);
      expect(isValidReasonTag('日系企業理解')).toBe(true);
    });

    test('returns false for invalid reason tags', () => {
      expect(isValidReasonTag('invalid_tag')).toBe(false);
      expect(isValidReasonTag('')).toBe(false);
      expect(isValidReasonTag('勤務地')).toBe(false); // Partial match should fail
    });
  });

  describe('isValidEvidenceField', () => {
    test('returns true for exact pattern matches', () => {
      expect(isValidEvidenceField('company.location.region')).toBe(true);
      expect(isValidEvidenceField('company.industryText')).toBe(true);
      expect(isValidEvidenceField('company.tags')).toBe(true);
      expect(isValidEvidenceField('candidate.careerSummary')).toBe(true);
    });

    test('returns true for pattern prefix matches', () => {
      expect(isValidEvidenceField('company.companyId=123')).toBe(true);
      expect(isValidEvidenceField('company.location.region=南部')).toBe(true);
      expect(isValidEvidenceField('company.tags[0]')).toBe(true);
      expect(isValidEvidenceField('candidate.keySkills[0]')).toBe(true);
    });

    test('returns false for invalid patterns', () => {
      expect(isValidEvidenceField('invalid.field')).toBe(false);
      expect(isValidEvidenceField('')).toBe(false);
      expect(isValidEvidenceField('unknown.namespace')).toBe(false);
    });
  });

  describe('validateCandidateRationale', () => {
    test('validates correct rationale', () => {
      const candidate: Candidate = {
        candidateId: 'C001',
        headline: 'Test candidate',
        careerSummary: 'テスト候補者の経歴要約。',
        keySkills: ['skill1'],
        rationale: {
          reasonTags: ['勤務地一致', '業界経験一致'],
          evidenceFields: ['company.location.region', 'company.industryText'],
        },
      };

      const result = validateCandidateRationale(candidate);

      expect(result.valid).toBe(true);
      expect(result.invalidReasonTags).toHaveLength(0);
      expect(result.invalidEvidenceFields).toHaveLength(0);
    });

    test('detects invalid reason tags', () => {
      const candidate: Candidate = {
        candidateId: 'C002',
        headline: 'Test candidate',
        careerSummary: 'テスト候補者の経歴要約。',
        keySkills: ['skill1'],
        rationale: {
          reasonTags: ['勤務地一致', 'INVALID_TAG', '業界経験一致'],
          evidenceFields: ['company.location.region'],
        },
      };

      const result = validateCandidateRationale(candidate);

      expect(result.valid).toBe(false);
      expect(result.invalidReasonTags).toContain('INVALID_TAG');
      expect(result.invalidEvidenceFields).toHaveLength(0);
    });

    test('detects invalid evidence fields', () => {
      const candidate: Candidate = {
        candidateId: 'C003',
        headline: 'Test candidate',
        careerSummary: 'テスト候補者の経歴要約。',
        keySkills: ['skill1'],
        rationale: {
          reasonTags: ['勤務地一致'],
          evidenceFields: ['company.location.region', 'invalid.field'],
        },
      };

      const result = validateCandidateRationale(candidate);

      expect(result.valid).toBe(false);
      expect(result.invalidReasonTags).toHaveLength(0);
      expect(result.invalidEvidenceFields).toContain('invalid.field');
    });

    test('detects both invalid tags and fields', () => {
      const candidate: Candidate = {
        candidateId: 'C004',
        headline: 'Test candidate',
        careerSummary: 'テスト候補者の経歴要約。',
        keySkills: ['skill1'],
        rationale: {
          reasonTags: ['BAD_TAG'],
          evidenceFields: ['bad.field'],
        },
      };

      const result = validateCandidateRationale(candidate);

      expect(result.valid).toBe(false);
      expect(result.invalidReasonTags).toContain('BAD_TAG');
      expect(result.invalidEvidenceFields).toContain('bad.field');
    });

    test('handles empty arrays', () => {
      const candidate: Candidate = {
        candidateId: 'C005',
        headline: 'Test candidate',
        careerSummary: 'テスト候補者の経歴要約。',
        keySkills: ['skill1'],
        rationale: {
          reasonTags: [],
          evidenceFields: [],
        },
      };

      const result = validateCandidateRationale(candidate);

      expect(result.valid).toBe(true);
      expect(result.invalidReasonTags).toHaveLength(0);
      expect(result.invalidEvidenceFields).toHaveLength(0);
    });

    test('validates candidate evidence fields', () => {
      const candidate: Candidate = {
        candidateId: 'C006',
        headline: 'Test candidate',
        careerSummary: 'テスト候補者の経歴要約。',
        keySkills: ['skill1'],
        rationale: {
          reasonTags: ['即戦力'],
          evidenceFields: ['candidate.careerSummary', 'candidate.jobTitle'],
        },
      };

      const result = validateCandidateRationale(candidate);

      expect(result.valid).toBe(true);
    });
  });
});
