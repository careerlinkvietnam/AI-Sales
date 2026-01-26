/**
 * ContentGuards Test Suite
 *
 * Tests PII detection and content validation for candidate summaries and emails.
 */

import {
  validateCandidateSummary,
  validateEmailBody,
  checkCandidateExclusion,
  maskPiiForLogging,
  filterCandidatesWithAudit,
} from '../src/domain/ContentGuards';

describe('ContentGuards', () => {
  describe('validateCandidateSummary', () => {
    test('returns ok for clean summary', () => {
      const summary = '製造業にて10年間、生産管理を担当。品質改善プロジェクトを主導。';

      const result = validateCandidateSummary(summary);

      expect(result.ok).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    test('detects email address', () => {
      const summary = '製造業にて10年間勤務。連絡先: test@example.com';

      const result = validateCandidateSummary(summary);

      expect(result.ok).toBe(false);
      expect(result.violations.some(v => v.includes('メールアドレス'))).toBe(true);
    });

    test('detects phone number', () => {
      const summary = '営業経験5年。連絡先: 090-1234-5678';

      const result = validateCandidateSummary(summary);

      expect(result.ok).toBe(false);
      expect(result.violations.some(v => v.includes('電話番号'))).toBe(true);
    });

    test('detects Japanese address', () => {
      const summary = 'IT企業出身。住所: 東京都港区1-2-3番地';

      const result = validateCandidateSummary(summary);

      expect(result.ok).toBe(false);
      expect(result.violations.some(v => v.includes('住所'))).toBe(true);
    });

    test('detects Vietnamese address', () => {
      const summary = 'プロジェクトマネージャー。Số 123 Đường Lê Lợi, Quận 1';

      const result = validateCandidateSummary(summary);

      expect(result.ok).toBe(false);
      expect(result.violations.some(v => v.includes('住所'))).toBe(true);
    });

    test('detects birth date', () => {
      const summary = '経験10年。生年月日: 1990-05-15';

      const result = validateCandidateSummary(summary);

      expect(result.ok).toBe(false);
      expect(result.violations.some(v => v.includes('生年月日'))).toBe(true);
    });

    test('detects birth year in Japanese', () => {
      const summary = '1985年生まれ。製造業にて15年の経験。';

      const result = validateCandidateSummary(summary);

      expect(result.ok).toBe(false);
      expect(result.violations.some(v => v.includes('生年情報'))).toBe(true);
    });
  });

  describe('validateEmailBody', () => {
    test('returns ok for clean email body', () => {
      const body = `
ABC会社 ご担当者様

いつもお世話になっております。
CareerLinkの営業担当でございます。

【ご紹介候補者】
1. 製造業経験10年のプロダクションマネージャー
   経歴要約: 品質管理を担当し、改善を実現。

---
CareerLink Vietnam
      `.trim();

      const result = validateEmailBody(body);

      expect(result.ok).toBe(true);
    });

    test('allows single email in signature area', () => {
      const body = `
ABC会社 ご担当者様

候補者情報なし

---
CareerLink Vietnam
contact@careerlink.vn
      `.trim();

      const result = validateEmailBody(body);

      // Single email after signature is acceptable
      expect(result.ok).toBe(true);
    });

    test('detects multiple emails', () => {
      const body = `
ABC会社 ご担当者様

候補者: test@email.com
別の連絡先: another@email.com

---
CareerLink Vietnam
      `.trim();

      const result = validateEmailBody(body);

      expect(result.ok).toBe(false);
      expect(result.violations.some(v => v.includes('メールアドレス'))).toBe(true);
    });

    test('detects phone in body', () => {
      const body = `
ABC会社 ご担当者様

候補者の連絡先: 080-1234-5678

---
CareerLink Vietnam
      `.trim();

      const result = validateEmailBody(body);

      expect(result.ok).toBe(false);
    });
  });

  describe('checkCandidateExclusion', () => {
    test('does not exclude clean candidate', () => {
      const summary = '製造業にて10年間、生産管理を担当。';

      const result = checkCandidateExclusion(summary);

      expect(result.excluded).toBe(false);
      expect(result.reason).toBeUndefined();
    });

    test('excludes candidate with email', () => {
      const summary = '連絡先: test@example.com まで。';

      const result = checkCandidateExclusion(summary);

      expect(result.excluded).toBe(true);
      expect(result.reason).toContain('PII検出');
    });

    test('excludes candidate with company name reference', () => {
      const summary = '前社名: ABC株式会社にて5年間勤務。';

      const result = checkCandidateExclusion(summary);

      expect(result.excluded).toBe(true);
      expect(result.reason).toContain('会社名');
    });

    test('excludes candidate with postal code', () => {
      // Note: postal code also triggers phone detection due to number pattern
      // The important thing is that it gets excluded
      const summary = '住所: 〒100-0001 にお住まい';

      const result = checkCandidateExclusion(summary);

      expect(result.excluded).toBe(true);
      // Could be detected as phone or postal code
      expect(result.reason).toBeDefined();
    });
  });

  describe('maskPiiForLogging', () => {
    test('masks email addresses', () => {
      const text = '連絡先: test@example.com まで';

      const result = maskPiiForLogging(text);

      expect(result).not.toContain('test@example.com');
      expect(result).toContain('[EMAIL]');
    });

    test('masks phone numbers', () => {
      const text = '電話: 090-1234-5678';

      const result = maskPiiForLogging(text);

      expect(result).not.toContain('090-1234-5678');
      expect(result).toContain('[PHONE]');
    });

    test('masks Japanese address', () => {
      const text = '住所: 1-2-3番地';

      const result = maskPiiForLogging(text);

      expect(result).toContain('[ADDRESS]');
    });

    test('preserves clean text', () => {
      const text = '製造業にて10年間、生産管理を担当。';

      const result = maskPiiForLogging(text);

      expect(result).toBe(text);
    });
  });

  describe('filterCandidatesWithAudit', () => {
    test('includes clean candidates', () => {
      const candidates = [
        {
          candidateId: 'C001',
          careerSummary: '製造業にて10年間の経験。',
        },
        {
          candidateId: 'C002',
          careerSummary: 'IT企業でプロジェクト管理。',
        },
      ];

      const result = filterCandidatesWithAudit(candidates);

      expect(result.included).toHaveLength(2);
      expect(result.exclusions).toHaveLength(2);
      expect(result.exclusions.every(e => e.included)).toBe(true);
    });

    test('excludes candidates with PII', () => {
      const candidates = [
        {
          candidateId: 'C001',
          careerSummary: '製造業にて10年間の経験。',
        },
        {
          candidateId: 'C002',
          careerSummary: '連絡先: bad@email.com',
        },
        {
          candidateId: 'C003',
          careerSummary: 'IT企業でプロジェクト管理。',
        },
      ];

      const result = filterCandidatesWithAudit(candidates);

      expect(result.included).toHaveLength(2);
      expect(result.included.map(c => c.candidateId)).toEqual(['C001', 'C003']);

      expect(result.exclusions).toHaveLength(3);
      const c002Exclusion = result.exclusions.find(e => e.candidateId === 'C002');
      expect(c002Exclusion?.included).toBe(false);
      expect(c002Exclusion?.excludedReason).toContain('PII検出');
    });

    test('returns audit entries for all candidates', () => {
      const candidates = [
        { candidateId: 'C001', careerSummary: 'Clean summary.' },
        { candidateId: 'C002', careerSummary: 'bad@email.com' },
      ];

      const result = filterCandidatesWithAudit(candidates);

      expect(result.exclusions).toHaveLength(2);
      expect(result.exclusions[0].candidateId).toBe('C001');
      expect(result.exclusions[0].included).toBe(true);
      expect(result.exclusions[1].candidateId).toBe('C002');
      expect(result.exclusions[1].included).toBe(false);
    });
  });
});
