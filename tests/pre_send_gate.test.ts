/**
 * PreSendGate Tests
 */

import {
  PreSendGate,
  createTestPreSendGate,
  getPreSendGate,
} from '../src/domain/PreSendGate';

describe('PreSendGate', () => {
  describe('tracking tag check', () => {
    it('passes when tracking tag in subject', () => {
      const gate = new PreSendGate();
      const result = gate.check({
        subject: '人材のご提案 [CL-AI:a1b2c3d4]',
        body: 'メール本文です。',
      });
      expect(result.ok).toBe(true);
    });

    it('passes when tracking tag in body', () => {
      const gate = new PreSendGate();
      const result = gate.check({
        subject: '人材のご提案',
        body: 'メール本文です。[CL-AI:a1b2c3d4]',
      });
      expect(result.ok).toBe(true);
    });

    it('fails when no tracking tag', () => {
      const gate = new PreSendGate();
      const result = gate.check({
        subject: '人材のご提案',
        body: 'メール本文です。',
      });
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.includes('トラッキングタグ'))).toBe(true);
    });

    it('can skip tracking tag check when configured', () => {
      const gate = createTestPreSendGate({ requireTrackingTag: false });
      const result = gate.check({
        subject: '人材のご提案',
        body: 'メール本文です。',
      });
      expect(result.ok).toBe(true);
    });
  });

  describe('length checks', () => {
    it('passes when within limits', () => {
      const gate = new PreSendGate();
      const result = gate.check({
        subject: '人材のご提案 [CL-AI:a1b2c3d4]',
        body: 'メール本文です。',
      });
      expect(result.ok).toBe(true);
    });

    it('fails when subject too long', () => {
      const gate = createTestPreSendGate({ maxSubjectLength: 20, requireTrackingTag: false });
      const result = gate.check({
        subject: 'この件名は20文字を超えているのでエラーになります',
        body: '本文',
      });
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.includes('件名が長すぎます'))).toBe(true);
    });

    it('fails when body too long', () => {
      const gate = createTestPreSendGate({ maxBodyLength: 20, requireTrackingTag: false });
      const result = gate.check({
        subject: '件名',
        body: 'この本文は20文字を超えているのでエラーになります。',
      });
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.includes('本文が長すぎます'))).toBe(true);
    });
  });

  describe('forbidden expressions', () => {
    it('fails when subject contains forbidden expression', () => {
      const gate = new PreSendGate();
      const result = gate.check({
        subject: '確実に成果が出る人材のご提案 [CL-AI:a1b2c3d4]',
        body: '本文',
      });
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.includes('確実に'))).toBe(true);
    });

    it('fails for 絶対', () => {
      const gate = new PreSendGate();
      const result = gate.check({
        subject: '絶対おすすめ [CL-AI:a1b2c3d4]',
        body: '本文',
      });
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.includes('絶対'))).toBe(true);
    });

    it('fails for 今だけ', () => {
      const gate = new PreSendGate();
      const result = gate.check({
        subject: '今だけ特別オファー [CL-AI:a1b2c3d4]',
        body: '本文',
      });
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.includes('今だけ'))).toBe(true);
    });

    it('can use custom forbidden expressions', () => {
      const gate = createTestPreSendGate({
        forbiddenSubjectExpressions: ['カスタム禁止語'],
        requireTrackingTag: false,
      });
      const result = gate.check({
        subject: 'カスタム禁止語を含む件名',
        body: '本文',
      });
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.includes('カスタム禁止語'))).toBe(true);
    });
  });

  describe('PII detection', () => {
    it('fails when body contains phone number', () => {
      const gate = new PreSendGate();
      const result = gate.check({
        subject: '件名 [CL-AI:a1b2c3d4]',
        body: '連絡先: 090-1234-5678',
      });
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.includes('電話番号'))).toBe(true);
    });

    it('fails when body contains address', () => {
      const gate = new PreSendGate();
      const result = gate.check({
        subject: '件名 [CL-AI:a1b2c3d4]',
        body: '住所: 東京都渋谷区1-2-3',
      });
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.includes('住所') || v.includes('丁目'))).toBe(true);
    });

    it('fails when body contains postal code', () => {
      const gate = new PreSendGate();
      const result = gate.check({
        subject: '件名 [CL-AI:a1b2c3d4]',
        body: '〒150-0001 東京都',
      });
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.includes('郵便番号'))).toBe(true);
    });

    it('passes for clean content', () => {
      const gate = new PreSendGate();
      const result = gate.check({
        subject: '人材のご提案 [CL-AI:a1b2c3d4]',
        body: `
ABC株式会社 御中

お世話になっております。
以下の候補者をご紹介いたします。

【候補者】
・ITエンジニア経験5年
・プロジェクトマネジメント経験あり

ご検討のほど、よろしくお願いいたします。

CareerLink
        `.trim(),
      });
      expect(result.ok).toBe(true);
    });
  });

  describe('multiple violations', () => {
    it('reports all violations', () => {
      const gate = createTestPreSendGate({
        maxSubjectLength: 10,
        maxBodyLength: 20,
        requireTrackingTag: true,
        forbiddenSubjectExpressions: ['確実'],
      });
      const result = gate.check({
        subject: '確実に成果が出る長い件名です',
        body: '本文が長すぎます。住所は1-2-3です。',
      });
      expect(result.ok).toBe(false);
      expect(result.violations.length).toBeGreaterThan(1);
    });
  });

  describe('getConfig', () => {
    it('returns current configuration', () => {
      const gate = createTestPreSendGate({
        maxSubjectLength: 100,
        maxBodyLength: 3000,
      });
      const config = gate.getConfig();
      expect(config.maxSubjectLength).toBe(100);
      expect(config.maxBodyLength).toBe(3000);
    });
  });

  describe('singleton', () => {
    it('getPreSendGate returns same instance', () => {
      const gate1 = getPreSendGate();
      const gate2 = getPreSendGate();
      expect(gate1).toBe(gate2);
    });
  });
});
