/**
 * Tests for CompanyProfileBuilder
 */

import { CompanyProfileBuilder } from '../src/domain/CompanyProfileBuilder';
import { CompanyDetail, ContactHistory, ContactHistoryItem } from '../src/types';

describe('CompanyProfileBuilder', () => {
  let builder: CompanyProfileBuilder;

  beforeEach(() => {
    builder = new CompanyProfileBuilder();
  });

  describe('build', () => {
    it('builds profile from company detail and empty history', () => {
      const detail: CompanyDetail = {
        companyId: '123',
        name: 'ABC Manufacturing Co., Ltd.',
        tags: ['南部・3月連絡', '製造業'],
        profile: 'ベトナム南部で製造業を営む日系企業です。',
        province: 'Ho Chi Minh',
        address: '123 Nguyen Van Linh, District 7',
      };

      const history: ContactHistory = {
        companyId: '123',
        items: [],
        totalCount: 0,
      };

      const profile = builder.build(detail, history);

      expect(profile.facts.companyId).toBe('123');
      expect(profile.facts.companyName).toBe('ABC Manufacturing Co., Ltd.');
      expect(profile.facts.location.region).toBe('南部');
      expect(profile.facts.location.province).toBe('Ho Chi Minh');
      expect(profile.facts.tags).toContain('南部・3月連絡');
      expect(profile.facts.contactHistoryExcerpt.totalContacts).toBe(0);
      expect(profile.assumptions).toEqual([]);
    });

    it('builds profile with contact history', () => {
      const detail: CompanyDetail = {
        companyId: '456',
        name: 'XYZ Tech Vietnam',
        tags: ['北部・5月連絡', 'IT'],
      };

      const history: ContactHistory = {
        companyId: '456',
        items: [
          {
            actionId: 'a1',
            actionType: 'visit',
            performedAt: '2024-01-15T10:00:00Z',
            summary: '新規商談。採用ニーズについてヒアリング。',
          },
          {
            actionId: 'a2',
            actionType: 'tel',
            performedAt: '2024-01-10T09:00:00Z',
            summary: 'フォローアップの電話。',
          },
        ],
        totalCount: 2,
      };

      const profile = builder.build(detail, history);

      expect(profile.facts.contactHistoryExcerpt.totalContacts).toBe(2);
      expect(profile.facts.contactHistoryExcerpt.lastContactDate).toBe('2024-01-15T10:00:00Z');
      expect(profile.facts.contactHistoryExcerpt.lastContactType).toBe('visit');
      expect(profile.facts.contactHistoryExcerpt.recentTopics.length).toBe(2);
    });

    it('extracts region correctly from various tags', () => {
      const testCases: { tags: string[]; expectedRegion: string | null }[] = [
        { tags: ['南部・3月連絡'], expectedRegion: '南部' },
        { tags: ['北部・5月連絡'], expectedRegion: '北部' },
        { tags: ['中部・7月連絡'], expectedRegion: '中部' },
        { tags: ['IT', '製造業'], expectedRegion: null },
      ];

      for (const testCase of testCases) {
        const detail: CompanyDetail = {
          companyId: 'test',
          name: 'Test Company',
          tags: testCase.tags,
        };

        const history: ContactHistory = {
          companyId: 'test',
          items: [],
        };

        const profile = builder.build(detail, history);
        expect(profile.facts.location.region).toBe(testCase.expectedRegion);
      }
    });

    it('truncates long topic excerpts', () => {
      const longSummary = 'あ'.repeat(150); // 150 chars

      const detail: CompanyDetail = {
        companyId: 'test',
        name: 'Test Company',
        tags: [],
      };

      const history: ContactHistory = {
        companyId: 'test',
        items: [
          {
            actionId: 'a1',
            actionType: 'tel',
            performedAt: '2024-01-15T10:00:00Z',
            summary: longSummary,
          },
        ],
        totalCount: 1,
      };

      const profile = builder.build(detail, history);
      const topic = profile.facts.contactHistoryExcerpt.recentTopics[0];

      expect(topic.length).toBeLessThanOrEqual(103); // 100 + '...'
      expect(topic.endsWith('...')).toBe(true);
    });

    it('limits recent topics to MAX_RECENT_TOPICS', () => {
      const detail: CompanyDetail = {
        companyId: 'test',
        name: 'Test Company',
        tags: [],
      };

      const items: ContactHistoryItem[] = [];
      for (let i = 0; i < 10; i++) {
        items.push({
          actionId: `a${i}`,
          actionType: 'tel',
          performedAt: `2024-01-${10 + i}T10:00:00Z`,
          summary: `Topic ${i}`,
        });
      }

      const history: ContactHistory = {
        companyId: 'test',
        items,
        totalCount: 10,
      };

      const profile = builder.build(detail, history);

      // MAX_RECENT_TOPICS is 5
      expect(profile.facts.contactHistoryExcerpt.recentTopics.length).toBeLessThanOrEqual(5);
    });
  });

  describe('summaries', () => {
    it('generates industry summary from profile text', () => {
      const detail: CompanyDetail = {
        companyId: 'test',
        name: 'Test Company',
        tags: [],
        profile: 'ベトナム南部で製造業を営む日系企業です。',
      };

      const history: ContactHistory = {
        companyId: 'test',
        items: [],
      };

      const profile = builder.build(detail, history);

      expect(profile.summaries.industrySummary).toBe('ベトナム南部で製造業を営む日系企業です。');
    });

    it('truncates long industry summary', () => {
      const longProfile = 'あ'.repeat(300);

      const detail: CompanyDetail = {
        companyId: 'test',
        name: 'Test Company',
        tags: [],
        profile: longProfile,
      };

      const history: ContactHistory = {
        companyId: 'test',
        items: [],
      };

      const profile = builder.build(detail, history);

      expect(profile.summaries.industrySummary!.length).toBeLessThanOrEqual(203);
      expect(profile.summaries.industrySummary!.endsWith('...')).toBe(true);
    });

    it('generates contacts summary for companies with no history', () => {
      const detail: CompanyDetail = {
        companyId: 'test',
        name: 'Test Company',
        tags: [],
      };

      const history: ContactHistory = {
        companyId: 'test',
        items: [],
        totalCount: 0,
      };

      const profile = builder.build(detail, history);

      expect(profile.summaries.pastContactsSummary).toBe('過去の連絡履歴はありません。');
    });

    it('generates contacts summary with history', () => {
      const detail: CompanyDetail = {
        companyId: 'test',
        name: 'Test Company',
        tags: [],
      };

      const history: ContactHistory = {
        companyId: 'test',
        items: [
          {
            actionId: 'a1',
            actionType: 'visit',
            performedAt: '2024-03-15T10:00:00Z',
            summary: 'Meeting',
          },
        ],
        totalCount: 5,
      };

      const profile = builder.build(detail, history);

      expect(profile.summaries.pastContactsSummary).toContain('過去5件の連絡履歴');
      expect(profile.summaries.pastContactsSummary).toContain('訪問');
    });
  });

  describe('sourceRefs', () => {
    it('includes company ID and timeline item IDs', () => {
      const detail: CompanyDetail = {
        companyId: '789',
        name: 'Test Company',
        tags: [],
      };

      const history: ContactHistory = {
        companyId: '789',
        items: [
          { actionId: 'act1', actionType: 'tel', performedAt: '2024-01-01T00:00:00Z' },
          { actionId: 'act2', actionType: 'visit', performedAt: '2024-01-02T00:00:00Z' },
        ],
      };

      const profile = builder.build(detail, history);

      expect(profile.sourceRefs.companyId).toBe('789');
      expect(profile.sourceRefs.timelineItemIds).toEqual(['act1', 'act2']);
    });
  });
});
