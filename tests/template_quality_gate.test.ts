/**
 * TemplateQualityGate Tests
 */

import {
  TemplateQualityGate,
  TemplateContentForCheck,
  createTemplateQualityGate,
  getTemplateQualityGate,
} from '../src/domain/TemplateQualityGate';

describe('TemplateQualityGate', () => {
  let gate: TemplateQualityGate;

  beforeEach(() => {
    gate = new TemplateQualityGate();
  });

  describe('check - PII detection', () => {
    it('should pass for clean template', () => {
      const content: TemplateContentForCheck = {
        subjectTemplate: '【CareerLink】{{companyName}}様へ人材のご提案',
        ctaTemplate: 'ご興味をお持ちいただけましたら、ぜひご連絡ください。',
        candidateHeaderTemplate: '【ご紹介候補者】',
      };

      const result = gate.check(content);

      expect(result.ok).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('should fail for email address in subject', () => {
      const content: TemplateContentForCheck = {
        subjectTemplate: '{{companyName}}様へ test@example.com からのご提案',
        ctaTemplate: 'ご連絡ください。',
        candidateHeaderTemplate: '【候補者】',
      };

      const result = gate.check(content);

      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.includes('メールアドレス'))).toBe(true);
    });

    it('should fail for phone number in CTA', () => {
      const content: TemplateContentForCheck = {
        subjectTemplate: '【CareerLink】ご提案',
        ctaTemplate: 'お電話ください 03-1234-5678',
        candidateHeaderTemplate: '【候補者】',
      };

      const result = gate.check(content);

      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.includes('電話番号'))).toBe(true);
    });

    it('should fail for Japanese address', () => {
      const content: TemplateContentForCheck = {
        subjectTemplate: '【CareerLink】ご提案',
        ctaTemplate: '東京都渋谷区1丁目2番地にお越しください',
        candidateHeaderTemplate: '【候補者】',
      };

      const result = gate.check(content);

      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.includes('住所'))).toBe(true);
    });

    it('should fail for birth date', () => {
      const content: TemplateContentForCheck = {
        subjectTemplate: '【CareerLink】ご提案',
        ctaTemplate: 'ご連絡ください',
        candidateHeaderTemplate: '【候補者】生年月日：1990-01-15',
      };

      const result = gate.check(content);

      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.includes('生年月日'))).toBe(true);
    });
  });

  describe('check - length limits', () => {
    it('should pass for content within limits', () => {
      const content: TemplateContentForCheck = {
        subjectTemplate: '【CareerLink】ご提案', // 13 chars
        ctaTemplate: 'ご連絡ください。', // 9 chars
        candidateHeaderTemplate: '【候補者】', // 5 chars
      };

      const result = gate.check(content);

      expect(result.ok).toBe(true);
    });

    it('should fail for subject exceeding 80 chars', () => {
      const content: TemplateContentForCheck = {
        subjectTemplate: 'あ'.repeat(81), // 81 chars
        ctaTemplate: 'ご連絡ください。',
        candidateHeaderTemplate: '【候補者】',
      };

      const result = gate.check(content);

      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.includes('件名が長すぎます'))).toBe(true);
    });

    it('should fail for CTA exceeding 200 chars', () => {
      const content: TemplateContentForCheck = {
        subjectTemplate: '【CareerLink】ご提案',
        ctaTemplate: 'あ'.repeat(201), // 201 chars
        candidateHeaderTemplate: '【候補者】',
      };

      const result = gate.check(content);

      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.includes('CTAが長すぎます'))).toBe(true);
    });

    it('should fail for header exceeding 80 chars', () => {
      const content: TemplateContentForCheck = {
        subjectTemplate: '【CareerLink】ご提案',
        ctaTemplate: 'ご連絡ください。',
        candidateHeaderTemplate: 'あ'.repeat(81), // 81 chars
      };

      const result = gate.check(content);

      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.includes('候補者見出しが長すぎます'))).toBe(
        true
      );
    });
  });

  describe('check - forbidden expressions', () => {
    it('should fail for "確実に"', () => {
      const content: TemplateContentForCheck = {
        subjectTemplate: '確実に成果が出る人材のご提案',
        ctaTemplate: 'ご連絡ください。',
        candidateHeaderTemplate: '【候補者】',
      };

      const result = gate.check(content);

      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.includes('確実に'))).toBe(true);
    });

    it('should fail for "絶対"', () => {
      const content: TemplateContentForCheck = {
        subjectTemplate: '絶対に満足いただける人材',
        ctaTemplate: 'ご連絡ください。',
        candidateHeaderTemplate: '【候補者】',
      };

      const result = gate.check(content);

      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.includes('絶対'))).toBe(true);
    });

    it('should fail for "保証"', () => {
      const content: TemplateContentForCheck = {
        subjectTemplate: '成果を保証します',
        ctaTemplate: 'ご連絡ください。',
        candidateHeaderTemplate: '【候補者】',
      };

      const result = gate.check(content);

      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.includes('保証'))).toBe(true);
    });

    it('should fail for "今だけ"', () => {
      const content: TemplateContentForCheck = {
        subjectTemplate: '【CareerLink】ご提案',
        ctaTemplate: '今だけの特別オファーです。',
        candidateHeaderTemplate: '【候補者】',
      };

      const result = gate.check(content);

      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.includes('今だけ'))).toBe(true);
    });

    it('should fail for "100%"', () => {
      const content: TemplateContentForCheck = {
        subjectTemplate: '100%マッチする人材',
        ctaTemplate: 'ご連絡ください。',
        candidateHeaderTemplate: '【候補者】',
      };

      const result = gate.check(content);

      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.includes('100%'))).toBe(true);
    });
  });

  describe('check - tracking tags', () => {
    it('should fail if tracking tag is in template', () => {
      const content: TemplateContentForCheck = {
        subjectTemplate: '【CareerLink】ご提案 [CL-AI:abc12345]',
        ctaTemplate: 'ご連絡ください。',
        candidateHeaderTemplate: '【候補者】',
      };

      const result = gate.check(content);

      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.includes('トラッキングタグ'))).toBe(true);
    });

    it('should pass without tracking tag', () => {
      const content: TemplateContentForCheck = {
        subjectTemplate: '【CareerLink】ご提案',
        ctaTemplate: 'ご連絡ください。',
        candidateHeaderTemplate: '【候補者】',
      };

      const result = gate.check(content);

      expect(result.ok).toBe(true);
    });
  });

  describe('check - multiple violations', () => {
    it('should report all violations', () => {
      const content: TemplateContentForCheck = {
        subjectTemplate: '確実に成果が出る [CL-AI:abc12345]', // forbidden + tracking
        ctaTemplate: 'test@example.com に今すぐご連絡ください', // PII + forbidden
        candidateHeaderTemplate: 'あ'.repeat(100), // too long
      };

      const result = gate.check(content);

      expect(result.ok).toBe(false);
      expect(result.violations.length).toBeGreaterThan(1);
    });
  });

  describe('configuration', () => {
    it('should use custom length limits', () => {
      const customGate = new TemplateQualityGate({
        maxSubjectLength: 20,
      });

      const content: TemplateContentForCheck = {
        subjectTemplate: 'あ'.repeat(21), // exceeds custom limit
        ctaTemplate: 'ご連絡ください。',
        candidateHeaderTemplate: '【候補者】',
      };

      const result = customGate.check(content);

      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.includes('件名が長すぎます'))).toBe(true);
    });

    it('should use custom forbidden expressions', () => {
      const customGate = new TemplateQualityGate({
        forbiddenExpressions: ['カスタム禁止語'],
      });

      const content: TemplateContentForCheck = {
        subjectTemplate: 'カスタム禁止語を含む件名',
        ctaTemplate: 'ご連絡ください。',
        candidateHeaderTemplate: '【候補者】',
      };

      const result = customGate.check(content);

      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.includes('カスタム禁止語'))).toBe(true);
    });

    it('getConfig returns current configuration', () => {
      const config = gate.getConfig();

      expect(config.maxSubjectLength).toBe(80);
      expect(config.maxCtaLength).toBe(200);
      expect(config.maxHeaderLength).toBe(80);
      expect(config.forbiddenExpressions).toContain('確実に');
    });
  });

  describe('factory functions', () => {
    it('createTemplateQualityGate creates new instance', () => {
      const newGate = createTemplateQualityGate();
      expect(newGate).toBeInstanceOf(TemplateQualityGate);
    });

    it('getTemplateQualityGate returns singleton', () => {
      const gate1 = getTemplateQualityGate();
      const gate2 = getTemplateQualityGate();
      expect(gate1).toBe(gate2);
    });
  });
});
