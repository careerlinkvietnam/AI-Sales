/**
 * Segmenter Test Suite
 */

import {
  Segmenter,
  createTestSegmenter,
  SegmentInput,
  RegionSegment,
  CustomerStateSegment,
  IndustryBucketSegment,
} from '../src/domain/Segmenter';
import { ContactHistoryItem, CompanyProfile, CompanyDetail } from '../src/types';

describe('Segmenter', () => {
  let segmenter: Segmenter;

  beforeEach(() => {
    segmenter = createTestSegmenter();
  });

  describe('classifyRegion', () => {
    it('classifies 南部 from tag', () => {
      const input: SegmentInput = {
        tag: { rawTag: '南部・3月連絡', region: '南部', isContactTag: true },
      };
      expect(segmenter.classifyRegion(input)).toBe('南部');
    });

    it('classifies 中部 from tag', () => {
      const input: SegmentInput = {
        tag: { rawTag: '中部・4月連絡', region: '中部', isContactTag: true },
      };
      expect(segmenter.classifyRegion(input)).toBe('中部');
    });

    it('classifies 北部 from tag', () => {
      const input: SegmentInput = {
        tag: { rawTag: '北部・5月連絡', region: '北部', isContactTag: true },
      };
      expect(segmenter.classifyRegion(input)).toBe('北部');
    });

    it('classifies Ho Chi Minh as 南部', () => {
      const input: SegmentInput = {
        companyProfile: {
          facts: {
            companyId: '1',
            companyName: 'Test',
            location: { region: 'Ho Chi Minh' },
            tags: [],
            contactHistoryExcerpt: { recentTopics: [], totalContacts: 0 },
          },
          summaries: {},
          assumptions: [],
          sourceRefs: { companyId: '1' },
        },
      };
      expect(segmenter.classifyRegion(input)).toBe('南部');
    });

    it('classifies Hanoi as 北部', () => {
      const input: SegmentInput = {
        companyDetail: {
          companyId: '1',
          name: 'Test',
          region: 'Hanoi',
        },
      };
      expect(segmenter.classifyRegion(input)).toBe('北部');
    });

    it('classifies Da Nang as 中部', () => {
      const input: SegmentInput = {
        companyDetail: {
          companyId: '1',
          name: 'Test',
          province: 'Da Nang',
        },
      };
      expect(segmenter.classifyRegion(input)).toBe('中部');
    });

    it('returns 不明 when no region info', () => {
      const input: SegmentInput = {};
      expect(segmenter.classifyRegion(input)).toBe('不明');
    });

    it('returns 不明 for unrecognized region', () => {
      const input: SegmentInput = {
        companyDetail: {
          companyId: '1',
          name: 'Test',
          region: 'Unknown City',
        },
      };
      expect(segmenter.classifyRegion(input)).toBe('不明');
    });

    it('prioritizes tag over company profile', () => {
      const input: SegmentInput = {
        tag: { rawTag: '南部・3月連絡', region: '南部', isContactTag: true },
        companyProfile: {
          facts: {
            companyId: '1',
            companyName: 'Test',
            location: { region: 'Hanoi' }, // Would be 北部
            tags: [],
            contactHistoryExcerpt: { recentTopics: [], totalContacts: 0 },
          },
          summaries: {},
          assumptions: [],
          sourceRefs: { companyId: '1' },
        },
      };
      expect(segmenter.classifyRegion(input)).toBe('南部');
    });
  });

  describe('classifyCustomerState', () => {
    it('returns existing when contract action exists', () => {
      const history: ContactHistoryItem[] = [
        {
          actionId: '1',
          actionType: 'tel',
          performedAt: '2026-01-01T10:00:00Z',
        },
        {
          actionId: '2',
          actionType: 'contract',
          performedAt: '2026-01-15T10:00:00Z',
        },
      ];
      const input: SegmentInput = { contactHistory: history };
      expect(segmenter.classifyCustomerState(input)).toBe('existing');
    });

    it('returns new when has history but no contract', () => {
      const history: ContactHistoryItem[] = [
        {
          actionId: '1',
          actionType: 'tel',
          performedAt: '2026-01-01T10:00:00Z',
        },
        {
          actionId: '2',
          actionType: 'visit',
          performedAt: '2026-01-15T10:00:00Z',
        },
      ];
      const input: SegmentInput = { contactHistory: history };
      expect(segmenter.classifyCustomerState(input)).toBe('new');
    });

    it('returns unknown when no history', () => {
      const input: SegmentInput = { contactHistory: [] };
      expect(segmenter.classifyCustomerState(input)).toBe('unknown');
    });

    it('returns unknown when history is null', () => {
      const input: SegmentInput = { contactHistory: null };
      expect(segmenter.classifyCustomerState(input)).toBe('unknown');
    });

    it('returns unknown when no contact history provided', () => {
      const input: SegmentInput = {};
      expect(segmenter.classifyCustomerState(input)).toBe('unknown');
    });
  });

  describe('classifyIndustryBucket', () => {
    it('classifies IT industry', () => {
      const input: SegmentInput = {
        companyProfile: {
          facts: {
            companyId: '1',
            companyName: 'Test',
            location: {},
            industryText: 'IT Software Development',
            tags: [],
            contactHistoryExcerpt: { recentTopics: [], totalContacts: 0 },
          },
          summaries: {},
          assumptions: [],
          sourceRefs: { companyId: '1' },
        },
      };
      expect(segmenter.classifyIndustryBucket(input)).toBe('IT');
    });

    it('classifies 製造 industry', () => {
      const input: SegmentInput = {
        companyProfile: {
          facts: {
            companyId: '1',
            companyName: 'Test',
            location: {},
            industryText: '自動車部品製造',
            tags: [],
            contactHistoryExcerpt: { recentTopics: [], totalContacts: 0 },
          },
          summaries: {},
          assumptions: [],
          sourceRefs: { companyId: '1' },
        },
      };
      expect(segmenter.classifyIndustryBucket(input)).toBe('製造');
    });

    it('classifies サービス industry', () => {
      const input: SegmentInput = {
        companyProfile: {
          facts: {
            companyId: '1',
            companyName: 'Test',
            location: {},
            industryText: '人材コンサルティング',
            tags: [],
            contactHistoryExcerpt: { recentTopics: [], totalContacts: 0 },
          },
          summaries: {},
          assumptions: [],
          sourceRefs: { companyId: '1' },
        },
      };
      expect(segmenter.classifyIndustryBucket(input)).toBe('サービス');
    });

    it('returns その他 for unrecognized industry with text', () => {
      const input: SegmentInput = {
        companyProfile: {
          facts: {
            companyId: '1',
            companyName: 'Test',
            location: {},
            industryText: '農業',
            tags: [],
            contactHistoryExcerpt: { recentTopics: [], totalContacts: 0 },
          },
          summaries: {},
          assumptions: [],
          sourceRefs: { companyId: '1' },
        },
      };
      expect(segmenter.classifyIndustryBucket(input)).toBe('その他');
    });

    it('returns 不明 when no industry text', () => {
      const input: SegmentInput = {};
      expect(segmenter.classifyIndustryBucket(input)).toBe('不明');
    });

    it('uses company detail profile as fallback', () => {
      const input: SegmentInput = {
        companyDetail: {
          companyId: '1',
          name: 'Test',
          profile: 'We are a manufacturing company',
        },
      };
      expect(segmenter.classifyIndustryBucket(input)).toBe('製造');
    });

    it('uses tags as last resort', () => {
      const input: SegmentInput = {
        companyProfile: {
          facts: {
            companyId: '1',
            companyName: 'Test',
            location: {},
            tags: ['IT', 'startup'],
            contactHistoryExcerpt: { recentTopics: [], totalContacts: 0 },
          },
          summaries: {},
          assumptions: [],
          sourceRefs: { companyId: '1' },
        },
      };
      expect(segmenter.classifyIndustryBucket(input)).toBe('IT');
    });
  });

  describe('classify (full)', () => {
    it('returns complete classification', () => {
      const history: ContactHistoryItem[] = [
        {
          actionId: '1',
          actionType: 'contract',
          performedAt: '2026-01-01T10:00:00Z',
        },
      ];

      const input: SegmentInput = {
        tag: { rawTag: '南部・3月連絡', region: '南部', isContactTag: true },
        companyProfile: {
          facts: {
            companyId: '1',
            companyName: 'Test',
            location: { region: 'Ho Chi Minh' },
            industryText: 'Software Development',
            tags: [],
            contactHistoryExcerpt: { recentTopics: [], totalContacts: 1 },
          },
          summaries: {},
          assumptions: [],
          sourceRefs: { companyId: '1' },
        },
        contactHistory: history,
      };

      const result = segmenter.classify(input);

      expect(result.region).toBe('南部');
      expect(result.customerState).toBe('existing');
      expect(result.industryBucket).toBe('IT');
    });

    it('returns defaults when no info available', () => {
      const result = segmenter.classify({});

      expect(result.region).toBe('不明');
      expect(result.customerState).toBe('unknown');
      expect(result.industryBucket).toBe('不明');
    });
  });

  describe('keyword matching', () => {
    it('matches HCMC variations', () => {
      const variations = ['HCMC', 'HCM', 'Ho Chi Minh City', 'ho chi minh'];
      for (const v of variations) {
        const input: SegmentInput = {
          companyDetail: { companyId: '1', name: 'Test', region: v },
        };
        expect(segmenter.classifyRegion(input)).toBe('南部');
      }
    });

    it('matches Hanoi variations', () => {
      const variations = ['Hanoi', 'Ha Noi', 'HANOI'];
      for (const v of variations) {
        const input: SegmentInput = {
          companyDetail: { companyId: '1', name: 'Test', region: v },
        };
        expect(segmenter.classifyRegion(input)).toBe('北部');
      }
    });

    it('matches industry variations', () => {
      const itTerms = ['IT', 'Software', 'SaaS', 'クラウド', 'システム開発'];
      for (const term of itTerms) {
        const input: SegmentInput = {
          companyProfile: {
            facts: {
              companyId: '1',
              companyName: 'Test',
              location: {},
              industryText: term,
              tags: [],
              contactHistoryExcerpt: { recentTopics: [], totalContacts: 0 },
            },
            summaries: {},
            assumptions: [],
            sourceRefs: { companyId: '1' },
          },
        };
        expect(segmenter.classifyIndustryBucket(input)).toBe('IT');
      }
    });
  });
});
