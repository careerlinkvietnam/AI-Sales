/**
 * Template Quality Gate Module
 *
 * Provides validation for template content before approval.
 *
 * 目的:
 * - テンプレート承認前の品質チェック
 * - PII混入防止
 * - 誇大表現の検出
 * - 形式チェック（長さ制限等）
 *
 * 制約:
 * - PIIらしきものの混入禁止
 * - トラッキングタグはテンプレートに含めない（Trackingモジュールが付与するため）
 */

/**
 * Template content for quality check
 */
export interface TemplateContentForCheck {
  subjectTemplate: string;
  ctaTemplate: string;
  candidateHeaderTemplate: string;
}

/**
 * Quality gate result
 */
export interface QualityGateResult {
  ok: boolean;
  violations: string[];
}

/**
 * Quality gate configuration
 */
export interface QualityGateConfig {
  /** Maximum subject length */
  maxSubjectLength: number;
  /** Maximum CTA length */
  maxCtaLength: number;
  /** Maximum candidate header length */
  maxHeaderLength: number;
  /** Forbidden expressions */
  forbiddenExpressions: string[];
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: QualityGateConfig = {
  maxSubjectLength: 80,
  maxCtaLength: 200,
  maxHeaderLength: 80,
  forbiddenExpressions: [
    '確実に',
    '絶対',
    '保証',
    '必ず',
    '100%',
    '間違いなく',
    '失敗しない',
    '今だけ',
    '限定',
    '緊急',
    '残りわずか',
    '最後のチャンス',
    '今すぐ',
    '至急',
  ],
};

/**
 * PII patterns for detection (reusing from ContentGuards)
 */
const PII_PATTERNS = {
  email: {
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    description: 'メールアドレス',
  },
  phone: {
    pattern: /(?:\+?\d{1,4}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{2,4}[-.\s]?\d{2,4}/g,
    description: '電話番号',
  },
  japaneseAddress: {
    pattern: /(?:\d+丁目|\d+-\d+-\d+|番地|号室|番\d+号)/g,
    description: '住所（丁目・番地等）',
  },
  vietnameseAddress: {
    pattern: /(?:Số\s*\d+|Đường|Phường|Quận|P\.\s*\d+|Q\.\s*\d+)/gi,
    description: '住所（ベトナム形式）',
  },
  birthDate: {
    pattern: /(?:生年月日|DOB|誕生日)[：:]\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}/gi,
    description: '生年月日',
  },
  specificAge: {
    pattern: /(?:\d{4}年生まれ|\d{4}年\d{1,2}月生)/g,
    description: '生年情報',
  },
};

/**
 * Tracking tag pattern (should not be in templates)
 */
const TRACKING_TAG_PATTERN = /\[CL-AI:[a-fA-F0-9]+\]/g;

/**
 * Template Quality Gate class
 */
export class TemplateQualityGate {
  private readonly config: QualityGateConfig;

  constructor(config?: Partial<QualityGateConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check template content for quality violations
   *
   * @param content - Template content to check
   * @returns Quality gate result with violations list
   */
  check(content: TemplateContentForCheck): QualityGateResult {
    const violations: string[] = [];

    // 1. PII check
    const piiViolations = this.checkPii(content);
    violations.push(...piiViolations);

    // 2. Length check
    const lengthViolations = this.checkLength(content);
    violations.push(...lengthViolations);

    // 3. Forbidden expressions check
    const forbiddenViolations = this.checkForbiddenExpressions(content);
    violations.push(...forbiddenViolations);

    // 4. Tracking tag check
    const trackingViolations = this.checkTrackingTags(content);
    violations.push(...trackingViolations);

    return {
      ok: violations.length === 0,
      violations,
    };
  }

  /**
   * Check for PII in template content
   */
  private checkPii(content: TemplateContentForCheck): string[] {
    const violations: string[] = [];
    const allText = `${content.subjectTemplate} ${content.ctaTemplate} ${content.candidateHeaderTemplate}`;

    for (const [key, { pattern, description }] of Object.entries(PII_PATTERNS)) {
      // Reset lastIndex for global patterns
      pattern.lastIndex = 0;
      if (pattern.test(allText)) {
        violations.push(`PII検出: ${description}がテンプレートに含まれています (${key})`);
      }
    }

    return violations;
  }

  /**
   * Check length constraints
   */
  private checkLength(content: TemplateContentForCheck): string[] {
    const violations: string[] = [];

    if (content.subjectTemplate.length > this.config.maxSubjectLength) {
      violations.push(
        `件名が長すぎます: ${content.subjectTemplate.length}文字 (上限: ${this.config.maxSubjectLength}文字)`
      );
    }

    if (content.ctaTemplate.length > this.config.maxCtaLength) {
      violations.push(
        `CTAが長すぎます: ${content.ctaTemplate.length}文字 (上限: ${this.config.maxCtaLength}文字)`
      );
    }

    if (content.candidateHeaderTemplate.length > this.config.maxHeaderLength) {
      violations.push(
        `候補者見出しが長すぎます: ${content.candidateHeaderTemplate.length}文字 (上限: ${this.config.maxHeaderLength}文字)`
      );
    }

    return violations;
  }

  /**
   * Check for forbidden expressions
   */
  private checkForbiddenExpressions(content: TemplateContentForCheck): string[] {
    const violations: string[] = [];
    const allText = `${content.subjectTemplate} ${content.ctaTemplate} ${content.candidateHeaderTemplate}`;

    for (const expression of this.config.forbiddenExpressions) {
      if (allText.includes(expression)) {
        violations.push(`禁止表現「${expression}」が含まれています（誇大表現/煽り）`);
      }
    }

    return violations;
  }

  /**
   * Check for tracking tags (should not be in templates)
   */
  private checkTrackingTags(content: TemplateContentForCheck): string[] {
    const violations: string[] = [];
    const allText = `${content.subjectTemplate} ${content.ctaTemplate} ${content.candidateHeaderTemplate}`;

    TRACKING_TAG_PATTERN.lastIndex = 0;
    if (TRACKING_TAG_PATTERN.test(allText)) {
      violations.push(
        'トラッキングタグ [CL-AI:xxxx] がテンプレートに含まれています（Trackingモジュールが自動付与するため、テンプレートには不要）'
      );
    }

    return violations;
  }

  /**
   * Get current configuration
   */
  getConfig(): QualityGateConfig {
    return { ...this.config };
  }
}

/**
 * Create quality gate with default config
 */
export function createTemplateQualityGate(
  config?: Partial<QualityGateConfig>
): TemplateQualityGate {
  return new TemplateQualityGate(config);
}

/**
 * Singleton instance
 */
let defaultQualityGate: TemplateQualityGate | null = null;

/**
 * Get or create the default quality gate
 */
export function getTemplateQualityGate(): TemplateQualityGate {
  if (!defaultQualityGate) {
    defaultQualityGate = new TemplateQualityGate();
  }
  return defaultQualityGate;
}

export default TemplateQualityGate;
