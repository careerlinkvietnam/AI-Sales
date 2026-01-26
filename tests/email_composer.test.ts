/**
 * Tests for EmailComposer
 */

import { EmailComposer } from '../src/domain/EmailComposer';
import { CompanyProfile, Candidate } from '../src/types';

describe('EmailComposer', () => {
  let composer: EmailComposer;

  beforeEach(() => {
    composer = new EmailComposer();
  });

  /**
   * Helper to create a test company profile
   */
  function createTestProfile(overrides: Partial<CompanyProfile['facts']> = {}): CompanyProfile {
    return {
      facts: {
        companyId: 'test-123',
        companyName: 'ABC Manufacturing Co., Ltd.',
        location: {
          region: '南部',
          province: 'Ho Chi Minh',
          address: null,
        },
        industryText: '製造業',
        tags: ['南部・3月連絡', '製造業'],
        contactHistoryExcerpt: {
          lastContactDate: null,
          lastContactType: null,
          recentTopics: [],
          totalContacts: 0,
        },
        ...overrides,
      },
      summaries: {
        industrySummary: '製造業',
        pastContactsSummary: '過去の連絡履歴はありません。',
      },
      assumptions: [],
      sourceRefs: {
        companyId: 'test-123',
        timelineItemIds: [],
      },
    };
  }

  /**
   * Helper to create test candidates (B案仕様: careerSummary含む)
   */
  function createTestCandidates(): Candidate[] {
    return [
      {
        candidateId: 'C001',
        headline: '製造業経験10年のプロダクションマネージャー',
        careerSummary: '日系製造企業にて10年間、生産管理およびプロダクションマネジメントを担当。品質管理システムの導入により不良率を30%削減。',
        keySkills: ['生産管理', '品質管理'],
        location: '南部',
        availability: '即日可能',
        rationale: {
          reasonTags: ['業界経験一致', '勤務地一致'],
          evidenceFields: ['company.industryText', 'candidate.careerSummary'],
        },
      },
      {
        candidateId: 'C002',
        headline: 'IT企業出身のプロジェクトマネージャー',
        careerSummary: 'IT企業にて7年間、システム開発プロジェクトのマネジメントを担当。アジャイル開発手法を導入し、プロジェクト納期遵守率を95%に向上。',
        keySkills: ['プロジェクト管理', 'アジャイル'],
        location: '南部',
        availability: '1ヶ月後',
        rationale: {
          reasonTags: ['マネジメント経験'],
          evidenceFields: ['candidate.careerSummary'],
        },
      },
    ];
  }

  describe('compose', () => {
    it('composes email with subject and body', () => {
      const profile = createTestProfile();
      const candidates = createTestCandidates();

      const email = composer.compose(profile, candidates);

      expect(email.subject).toBeTruthy();
      expect(email.body).toBeTruthy();
      expect(email.to).toBe('test-123'); // companyId as placeholder
    });

    it('includes company name in subject', () => {
      const profile = createTestProfile();
      const candidates = createTestCandidates();

      const email = composer.compose(profile, candidates);

      expect(email.subject).toContain('ABC Manufacturing Co., Ltd.');
      expect(email.subject).toContain('CareerLink');
    });

    it('includes greeting with company name', () => {
      const profile = createTestProfile();
      const candidates = createTestCandidates();

      const email = composer.compose(profile, candidates);

      expect(email.body).toContain('ABC Manufacturing Co., Ltd. ご担当者様');
    });

    it('includes candidates in body', () => {
      const profile = createTestProfile();
      const candidates = createTestCandidates();

      const email = composer.compose(profile, candidates);

      expect(email.body).toContain('製造業経験10年のプロダクションマネージャー');
      expect(email.body).toContain('IT企業出身のプロジェクトマネージャー');
    });

    it('includes candidate skills', () => {
      const profile = createTestProfile();
      const candidates = createTestCandidates();

      const email = composer.compose(profile, candidates);

      expect(email.body).toContain('生産管理');
      expect(email.body).toContain('品質管理');
    });

    it('includes candidate availability', () => {
      const profile = createTestProfile();
      const candidates = createTestCandidates();

      const email = composer.compose(profile, candidates);

      expect(email.body).toContain('即日可能');
      expect(email.body).toContain('1ヶ月後');
    });

    it('includes candidate location', () => {
      const profile = createTestProfile();
      const candidates = createTestCandidates();

      const email = composer.compose(profile, candidates);

      expect(email.body).toContain('勤務地: 南部');
    });

    it('includes match reasons', () => {
      const profile = createTestProfile();
      const candidates = createTestCandidates();

      const email = composer.compose(profile, candidates);

      expect(email.body).toContain('推薦理由:');
      expect(email.body).toContain('業界経験一致');
    });

    it('includes closing and signature', () => {
      const profile = createTestProfile();
      const candidates = createTestCandidates();

      const email = composer.compose(profile, candidates);

      expect(email.body).toContain('ご検討のほど');
      expect(email.body).toContain('CareerLink Vietnam');
    });
  });

  describe('contact context', () => {
    it('uses first contact message for new companies', () => {
      const profile = createTestProfile({
        contactHistoryExcerpt: {
          lastContactDate: null,
          lastContactType: null,
          recentTopics: [],
          totalContacts: 0,
        },
      });
      const candidates = createTestCandidates();

      const email = composer.compose(profile, candidates);

      expect(email.body).toContain('初めてご連絡させていただきます');
    });

    it('uses recent contact message for recent contacts', () => {
      // Create a date within the last month
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 7);

      const profile = createTestProfile({
        contactHistoryExcerpt: {
          lastContactDate: recentDate.toISOString(),
          lastContactType: 'visit',
          recentTopics: [],
          totalContacts: 1,
        },
      });
      const candidates = createTestCandidates();

      const email = composer.compose(profile, candidates);

      expect(email.body).toContain('先日はお時間をいただき');
    });

    it('uses months ago message for contacts 1-3 months ago', () => {
      // Create a date 2 months ago
      const pastDate = new Date();
      pastDate.setMonth(pastDate.getMonth() - 2);

      const profile = createTestProfile({
        contactHistoryExcerpt: {
          lastContactDate: pastDate.toISOString(),
          lastContactType: 'tel',
          recentTopics: [],
          totalContacts: 3,
        },
      });
      const candidates = createTestCandidates();

      const email = composer.compose(profile, candidates);

      expect(email.body).toContain('ヶ月前にご連絡させていただきました');
    });

    it('uses long time no see message for old contacts', () => {
      // Create a date 6 months ago
      const oldDate = new Date();
      oldDate.setMonth(oldDate.getMonth() - 6);

      const profile = createTestProfile({
        contactHistoryExcerpt: {
          lastContactDate: oldDate.toISOString(),
          lastContactType: 'visit',
          recentTopics: [],
          totalContacts: 5,
        },
      });
      const candidates = createTestCandidates();

      const email = composer.compose(profile, candidates);

      expect(email.body).toContain('ご無沙汰しております');
    });
  });

  describe('empty candidates', () => {
    it('handles empty candidate list', () => {
      const profile = createTestProfile();
      const candidates: Candidate[] = [];

      const email = composer.compose(profile, candidates);

      expect(email.subject).toBeTruthy();
      expect(email.body).toBeTruthy();
      // Should not contain candidate section header
      expect(email.body).not.toContain('【ご紹介候補者】');
    });
  });

  describe('candidate formatting', () => {
    it('numbers candidates correctly', () => {
      const profile = createTestProfile();
      const candidates = createTestCandidates();

      const email = composer.compose(profile, candidates);

      expect(email.body).toContain('1. 製造業経験10年');
      expect(email.body).toContain('2. IT企業出身');
    });

    it('handles candidate without location', () => {
      const profile = createTestProfile();
      const candidates: Candidate[] = [
        {
          candidateId: 'C001',
          headline: 'テスト候補者',
          careerSummary: 'テスト用の経歴要約です。',
          keySkills: ['スキル1'],
          location: null,
          availability: '即日可能',
          rationale: {
            reasonTags: ['即戦力'],
            evidenceFields: ['candidate.careerSummary'],
          },
        },
      ];

      const email = composer.compose(profile, candidates);

      // Should not throw and should include the candidate
      expect(email.body).toContain('テスト候補者');
      expect(email.body).not.toContain('勤務地: null');
    });

    it('handles candidate without availability', () => {
      const profile = createTestProfile();
      const candidates: Candidate[] = [
        {
          candidateId: 'C001',
          headline: 'テスト候補者',
          careerSummary: 'テスト用の経歴要約です。',
          keySkills: ['スキル1'],
          location: '南部',
          availability: null,
          rationale: {
            reasonTags: [],
            evidenceFields: ['candidate.careerSummary'],
          },
        },
      ];

      const email = composer.compose(profile, candidates);

      expect(email.body).toContain('テスト候補者');
      expect(email.body).not.toContain('入社可能: null');
    });

    it('handles candidate with empty skills', () => {
      const profile = createTestProfile();
      const candidates: Candidate[] = [
        {
          candidateId: 'C001',
          headline: 'テスト候補者',
          careerSummary: 'テスト用の経歴要約です。',
          keySkills: [],
          location: '南部',
          availability: '即日可能',
          rationale: {
            reasonTags: ['即戦力'],
            evidenceFields: ['candidate.careerSummary'],
          },
        },
      ];

      const email = composer.compose(profile, candidates);

      expect(email.body).toContain('テスト候補者');
      // Should not contain empty skills line
      expect(email.body).not.toContain('スキル: \n');
    });
  });

  describe('custom template', () => {
    it('allows custom greeting', () => {
      const customComposer = new EmailComposer({
        greeting: '{{companyName}} 人事部 ご担当者様',
      });

      const profile = createTestProfile();
      const candidates = createTestCandidates();

      const email = customComposer.compose(profile, candidates);

      expect(email.body).toContain('ABC Manufacturing Co., Ltd. 人事部 ご担当者様');
    });

    it('allows custom subject template', () => {
      const customComposer = new EmailComposer({
        subjectTemplate: '【人材提案】{{companyName}}様向け候補者のご紹介',
      });

      const profile = createTestProfile();
      const candidates = createTestCandidates();

      const email = customComposer.compose(profile, candidates);

      expect(email.subject).toContain('【人材提案】');
      expect(email.subject).toContain('ABC Manufacturing Co., Ltd.');
    });
  });
});
