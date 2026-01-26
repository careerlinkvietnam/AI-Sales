/**
 * StubCandidateClient Test Suite
 *
 * Tests the stub implementation of the candidate client.
 */

import { StubCandidateClient } from '../src/connectors/candidate/StubCandidateClient';
import { CompanyProfile } from '../src/types';

describe('StubCandidateClient', () => {
  let client: StubCandidateClient;

  // Test company profile
  const mockProfile: CompanyProfile = {
    facts: {
      companyId: 'TEST001',
      companyName: 'Test Company',
      location: {
        region: '南部',
        province: 'Ho Chi Minh',
        address: '123 Test Street',
      },
      industryText: '製造業',
      tags: ['南部・3月連絡'],
      contactHistoryExcerpt: {
        lastContactDate: '2026-01-15',
        lastContactType: 'tel',
        recentTopics: ['採用相談'],
        totalContacts: 5,
      },
    },
    summaries: {
      industrySummary: 'Manufacturing company',
      pastContactsSummary: 'Regular contact',
    },
    assumptions: [],
    sourceRefs: {
      companyId: 'TEST001',
    },
  };

  beforeEach(() => {
    client = new StubCandidateClient();
  });

  describe('Mode', () => {
    test('isStubMode returns true', () => {
      expect(client.isStubMode()).toBe(true);
    });

    test('getMode returns "stub"', () => {
      expect(client.getMode()).toBe('stub');
    });
  });

  describe('searchCandidates', () => {
    test('returns candidates with correct structure', async () => {
      const result = await client.searchCandidates(mockProfile);

      expect(result.candidates).toBeDefined();
      expect(Array.isArray(result.candidates)).toBe(true);
      expect(result.candidates.length).toBeGreaterThan(0);
      expect(result.mode).toBe('stub');
    });

    test('returns totalFound count', async () => {
      const result = await client.searchCandidates(mockProfile);

      expect(result.totalFound).toBeGreaterThan(0);
      expect(typeof result.totalFound).toBe('number');
    });

    test('includes search criteria in result', async () => {
      const result = await client.searchCandidates(mockProfile);

      expect(result.searchCriteria).toBeDefined();
      expect(result.searchCriteria.companyId).toBe('TEST001');
      expect(result.searchCriteria.region).toBe('南部');
    });

    test('candidates have required fields including careerSummary', async () => {
      const result = await client.searchCandidates(mockProfile);

      result.candidates.forEach(candidate => {
        expect(candidate.candidateId).toBeDefined();
        expect(candidate.headline).toBeDefined();
        expect(candidate.careerSummary).toBeDefined();
        expect(candidate.careerSummary.length).toBeGreaterThan(0);
        expect(candidate.careerSummary.length).toBeLessThanOrEqual(400);
        expect(candidate.keySkills).toBeDefined();
        expect(Array.isArray(candidate.keySkills)).toBe(true);
        expect(candidate.rationale).toBeDefined();
        expect(candidate.rationale.reasonTags).toBeDefined();
        expect(candidate.rationale.evidenceFields).toBeDefined();
      });
    });

    test('adds company ID to evidence fields', async () => {
      const result = await client.searchCandidates(mockProfile);

      result.candidates.forEach(candidate => {
        const hasCompanyId = candidate.rationale.evidenceFields.some(
          field => field.includes('company.companyId')
        );
        expect(hasCompanyId).toBe(true);
      });
    });

    test('adds 勤務地一致 tag for matching region', async () => {
      const result = await client.searchCandidates(mockProfile);

      // At least one candidate should have location matching region
      const matchingCandidate = result.candidates.find(
        c => c.location === '南部' && c.rationale.reasonTags.includes('勤務地一致')
      );
      expect(matchingCandidate).toBeDefined();
    });

    test('respects limit option', async () => {
      const result = await client.searchCandidates(mockProfile, { limit: 1 });

      expect(result.candidates.length).toBe(1);
    });

    test('respects region filter option', async () => {
      const result = await client.searchCandidates(mockProfile, { region: '南部' });

      result.candidates.forEach(candidate => {
        expect(candidate.location).toBe('南部');
      });
    });
  });

  describe('validateRationale', () => {
    test('returns true for valid rationale', async () => {
      const result = await client.searchCandidates(mockProfile);

      result.candidates.forEach(candidate => {
        expect(client.validateRationale(candidate)).toBe(true);
      });
    });

    test('returns false for invalid reason tag', () => {
      const invalidCandidate = {
        candidateId: 'INVALID',
        headline: 'Test',
        careerSummary: 'テスト経歴要約',
        keySkills: [],
        rationale: {
          reasonTags: ['INVALID_TAG'],
          evidenceFields: ['company.tags'],
        },
      };

      expect(client.validateRationale(invalidCandidate)).toBe(false);
    });
  });

  describe('Region handling', () => {
    test('handles profile without region', async () => {
      const profileWithoutRegion: CompanyProfile = {
        ...mockProfile,
        facts: {
          ...mockProfile.facts,
          location: {
            region: null,
            province: null,
            address: null,
          },
        },
      };

      const result = await client.searchCandidates(profileWithoutRegion);

      expect(result.candidates.length).toBeGreaterThan(0);
      expect(result.searchCriteria.region).toBeUndefined();
    });
  });
});
