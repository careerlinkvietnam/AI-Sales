/**
 * Pre-Send Gate Module
 *
 * Performs final safety checks before sending an email.
 *
 * チェック内容:
 * - PII検出（本文にPII形式がない）
 * - トラッキングタグの存在確認（subject/bodyに必須）
 * - 禁止表現チェック
 * - 長さ制限チェック
 *
 * 制約:
 * - 1つでも違反があれば送信不可
 * - 違反理由は監査ログに記録
 */

import { validateEmailBody, ContentValidationResult } from './ContentGuards';

/**
 * Pre-send gate check result
 */
export interface PreSendGateResult {
  ok: boolean;
  violations: string[];
}

/**
 * Email content for pre-send check
 */
export interface PreSendEmailContent {
  /** Email subject */
  subject: string;
  /** Email body */
  body: string;
  /** Recipient email (for validation only, not stored) */
  recipientEmail?: string;
}

/**
 * Pre-send gate configuration
 */
export interface PreSendGateConfig {
  /** Maximum subject length */
  maxSubjectLength: number;
  /** Maximum body length */
  maxBodyLength: number;
  /** Require tracking tag */
  requireTrackingTag: boolean;
  /** Forbidden expressions in subject */
  forbiddenSubjectExpressions: string[];
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: PreSendGateConfig = {
  maxSubjectLength: 200,
  maxBodyLength: 5000,
  requireTrackingTag: true,
  forbiddenSubjectExpressions: [
    '確実に',
    '絶対',
    '保証',
    '必ず',
    '100%',
    '今だけ',
    '限定',
    '緊急',
  ],
};

/**
 * Tracking tag pattern
 */
const TRACKING_TAG_PATTERN = /\[CL-AI:[a-fA-F0-9]{8}\]/;

/**
 * PII patterns for additional checks (beyond ContentGuards)
 */
const ADDITIONAL_PII_PATTERNS = [
  {
    pattern: /〒\d{3}-?\d{4}/g,
    description: '郵便番号',
  },
  {
    pattern: /\d{11,13}/g, // Long number sequences (potential ID numbers)
    description: '長い数字列（ID番号の可能性）',
  },
];

/**
 * Pre-Send Gate class
 */
export class PreSendGate {
  private readonly config: PreSendGateConfig;

  constructor(config?: Partial<PreSendGateConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check email content before sending
   *
   * @param content - Email content to check
   * @returns Gate check result
   */
  check(content: PreSendEmailContent): PreSendGateResult {
    const violations: string[] = [];

    // 1. Check for tracking tag (required)
    if (this.config.requireTrackingTag) {
      const trackingViolations = this.checkTrackingTag(content);
      violations.push(...trackingViolations);
    }

    // 2. Check subject length
    if (content.subject.length > this.config.maxSubjectLength) {
      violations.push(
        `件名が長すぎます: ${content.subject.length}文字 (上限: ${this.config.maxSubjectLength}文字)`
      );
    }

    // 3. Check body length
    if (content.body.length > this.config.maxBodyLength) {
      violations.push(
        `本文が長すぎます: ${content.body.length}文字 (上限: ${this.config.maxBodyLength}文字)`
      );
    }

    // 4. Check forbidden expressions in subject
    for (const expr of this.config.forbiddenSubjectExpressions) {
      if (content.subject.includes(expr)) {
        violations.push(`件名に禁止表現「${expr}」が含まれています`);
      }
    }

    // 5. Check for PII in body using ContentGuards
    const bodyValidation = this.checkBodyPii(content.body);
    violations.push(...bodyValidation);

    // 6. Additional PII checks
    const additionalPii = this.checkAdditionalPii(content);
    violations.push(...additionalPii);

    return {
      ok: violations.length === 0,
      violations,
    };
  }

  /**
   * Check for tracking tag in subject and body
   */
  private checkTrackingTag(content: PreSendEmailContent): string[] {
    const violations: string[] = [];

    const hasTagInSubject = TRACKING_TAG_PATTERN.test(content.subject);
    const hasTagInBody = TRACKING_TAG_PATTERN.test(content.body);

    if (!hasTagInSubject && !hasTagInBody) {
      violations.push(
        'トラッキングタグ [CL-AI:xxxxxxxx] が件名または本文に含まれていません（効果測定に必須）'
      );
    }

    return violations;
  }

  /**
   * Check for PII in body using ContentGuards
   */
  private checkBodyPii(body: string): string[] {
    const result: ContentValidationResult = validateEmailBody(body);
    return result.violations.map((v) => `本文PII検出: ${v}`);
  }

  /**
   * Additional PII checks beyond ContentGuards
   */
  private checkAdditionalPii(content: PreSendEmailContent): string[] {
    const violations: string[] = [];
    const allText = `${content.subject} ${content.body}`;

    for (const { pattern, description } of ADDITIONAL_PII_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(allText)) {
        violations.push(`PII検出: ${description}`);
      }
    }

    return violations;
  }

  /**
   * Get current configuration
   */
  getConfig(): PreSendGateConfig {
    return { ...this.config };
  }
}

/**
 * Singleton instance
 */
let defaultGate: PreSendGate | null = null;

/**
 * Get or create the default pre-send gate
 */
export function getPreSendGate(): PreSendGate {
  if (!defaultGate) {
    defaultGate = new PreSendGate();
  }
  return defaultGate;
}

/**
 * Create pre-send gate for testing
 */
export function createTestPreSendGate(
  config?: Partial<PreSendGateConfig>
): PreSendGate {
  return new PreSendGate(config);
}

export default PreSendGate;
