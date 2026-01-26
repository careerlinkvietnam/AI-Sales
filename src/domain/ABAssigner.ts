/**
 * A/B Test Assignment Module
 *
 * Provides stable A/B variant assignment based on company ID.
 * Uses deterministic hashing to ensure same company always gets same variant.
 *
 * 目的:
 * - テンプレートのA/Bテスト運用
 * - 効果測定（返信率比較）
 */

import * as crypto from 'crypto';

/**
 * A/B variant type
 */
export type ABVariant = 'A' | 'B';

/**
 * Template definitions for A/B testing
 */
export interface TemplateConfig {
  /** Template identifier */
  templateId: string;
  /** Subject line template */
  subjectTemplate: string;
  /** Candidate section header */
  candidateHeader: string;
  /** Call-to-action text */
  ctaText: string;
}

/**
 * A/B assignment result
 */
export interface ABAssignment {
  /** Assigned variant */
  variant: ABVariant;
  /** Template ID */
  templateId: string;
  /** Full template configuration */
  template: TemplateConfig;
}

/**
 * Default template configurations for A/B testing
 *
 * A: Standard formal style
 * B: More direct style with emphasis on action
 */
const DEFAULT_TEMPLATES: Record<ABVariant, TemplateConfig> = {
  A: {
    templateId: 'new_candidates_v1_A',
    subjectTemplate: '【CareerLink】{{companyName}}様へ人材のご提案',
    candidateHeader: '【ご紹介候補者】',
    ctaText: 'ご興味をお持ちいただけましたら、ぜひご連絡ください。詳細な履歴書をお送りいたします。',
  },
  B: {
    templateId: 'new_candidates_v1_B',
    subjectTemplate: '{{companyName}}様向け 厳選人材のご案内 - CareerLink',
    candidateHeader: '--- 厳選候補者のご紹介 ---',
    ctaText: '面談をご希望の場合は、本メールへのご返信で日程調整いたします。まずはお気軽にご連絡ください。',
  },
};

/**
 * A/B Assigner class
 */
export class ABAssigner {
  private readonly templates: Record<ABVariant, TemplateConfig>;
  private readonly salt: string;

  constructor(options?: {
    templates?: Record<ABVariant, TemplateConfig>;
    salt?: string;
  }) {
    this.templates = options?.templates || DEFAULT_TEMPLATES;
    this.salt = options?.salt || 'careerlink-ab-2026';
  }

  /**
   * Assign A/B variant for a company
   *
   * Uses deterministic hash to ensure stable assignment.
   * Same company ID will always get the same variant.
   *
   * @param companyId - Company identifier
   * @returns A/B assignment with template details
   */
  assign(companyId: string): ABAssignment {
    const variant = this.determineVariant(companyId);
    const template = this.templates[variant];

    return {
      variant,
      templateId: template.templateId,
      template,
    };
  }

  /**
   * Get template for a specific variant
   *
   * @param variant - A or B
   * @returns Template configuration
   */
  getTemplate(variant: ABVariant): TemplateConfig {
    return this.templates[variant];
  }

  /**
   * Determine variant based on company ID hash
   *
   * @param companyId - Company identifier
   * @returns A or B variant
   */
  private determineVariant(companyId: string): ABVariant {
    // Create deterministic hash from company ID + salt
    const hash = crypto
      .createHash('sha256')
      .update(`${this.salt}:${companyId}`)
      .digest('hex');

    // Use first byte of hash to determine variant (50/50 split)
    const firstByte = parseInt(hash.substring(0, 2), 16);
    return firstByte < 128 ? 'A' : 'B';
  }
}

/**
 * Singleton instance
 */
let defaultAssigner: ABAssigner | null = null;

/**
 * Get or create the default A/B assigner
 */
export function getABAssigner(): ABAssigner {
  if (!defaultAssigner) {
    defaultAssigner = new ABAssigner();
  }
  return defaultAssigner;
}

/**
 * Create A/B assigner for testing
 */
export function createTestABAssigner(
  templates?: Record<ABVariant, TemplateConfig>,
  salt?: string
): ABAssigner {
  return new ABAssigner({ templates, salt });
}

export default ABAssigner;
