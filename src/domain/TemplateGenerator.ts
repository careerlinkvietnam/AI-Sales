/**
 * Template Generator Module
 *
 * Generates template improvement proposals based on improvement candidates.
 *
 * 目的:
 * - 改善テンプレートの自動生成
 * - A/Bテスト用の新バリアント作成
 *
 * 制約:
 * - PIIは入力に含めない
 * - 企業固有情報は入力に含めない
 * - 変更点は必ずchangesに明示
 */

import { ImprovementCandidate } from './ImprovementPicker';

/**
 * Template content structure
 */
export interface TemplateContent {
  /** Subject line template (with {{companyName}} placeholder) */
  subjectTemplate: string;
  /** Candidate section header */
  candidateHeader: string;
  /** Call-to-action text */
  ctaText: string;
}

/**
 * Template change description
 */
export interface TemplateChange {
  field: 'subjectTemplate' | 'candidateHeader' | 'ctaText';
  type: 'tone' | 'urgency' | 'question' | 'specificity' | 'personalization' | 'structure';
  description: string;
  before: string;
  after: string;
}

/**
 * Generated template proposal
 */
export interface TemplateProposal {
  /** New template ID */
  templateIdNew: string;
  /** Base template ID this was derived from */
  baseTemplateId: string;
  /** Variant designation */
  variant: 'A' | 'B';
  /** New status (always 'proposed') */
  status: 'proposed';
  /** Changes made */
  changes: TemplateChange[];
  /** Generated content */
  content: TemplateContent;
  /** Target segment info */
  targetSegment: {
    segmentName: string;
    segmentValue: string;
  };
  /** Rationale for changes */
  rationale: string;
}

/**
 * Base template library
 */
const BASE_TEMPLATES: Record<string, TemplateContent> = {
  new_candidates_v1_A: {
    subjectTemplate: '【CareerLink】{{companyName}}様へ人材のご提案',
    candidateHeader: '【ご紹介候補者】',
    ctaText:
      'ご興味をお持ちいただけましたら、ぜひご連絡ください。詳細な履歴書をお送りいたします。',
  },
  new_candidates_v1_B: {
    subjectTemplate: '{{companyName}}様向け 厳選人材のご案内 - CareerLink',
    candidateHeader: '--- 厳選候補者のご紹介 ---',
    ctaText:
      '面談をご希望の場合は、本メールへのご返信で日程調整いたします。まずはお気軽にご連絡ください。',
  },
};

/**
 * Improvement strategies
 */
type ImprovementStrategy =
  | 'add_urgency'
  | 'add_question'
  | 'simplify'
  | 'personalize'
  | 'add_specificity'
  | 'soften_tone';

/**
 * Strategy implementations
 */
const STRATEGIES: Record<
  ImprovementStrategy,
  {
    subjectTransform?: (s: string) => string;
    candidateHeaderTransform?: (s: string) => string;
    ctaTransform?: (s: string) => string;
    changeType: TemplateChange['type'];
    description: string;
  }
> = {
  add_urgency: {
    subjectTransform: (s) => s.replace(/のご提案/, '：今週中にご確認ください'),
    ctaTransform: (s) =>
      s.replace(
        /ぜひご連絡ください/,
        '今週中にご返信いただけますと幸いです'
      ),
    changeType: 'urgency',
    description: 'Added time-sensitive language to encourage quick response',
  },
  add_question: {
    subjectTransform: (s) => s.replace(/のご提案/, '：ご検討いただけませんか？'),
    ctaTransform: (s) =>
      s + ' いかがでしょうか？',
    changeType: 'question',
    description: 'Added question format to encourage engagement',
  },
  simplify: {
    subjectTransform: (s) => s.replace(/【CareerLink】/, '').replace(/ - CareerLink/, ''),
    candidateHeaderTransform: (s) => '■ 候補者情報',
    ctaTransform: (s) => 'ご返信お待ちしております。',
    changeType: 'structure',
    description: 'Simplified language and structure for clarity',
  },
  personalize: {
    subjectTransform: (s) => s.replace(/様へ/, '様 専用：'),
    candidateHeaderTransform: (s) => '【{{companyName}}様向け候補者】',
    ctaTransform: (s) => s.replace(/ご連絡/, '{{companyName}}様からのご連絡'),
    changeType: 'personalization',
    description: 'Added personalization elements',
  },
  add_specificity: {
    ctaTransform: (s) =>
      s.replace(
        /詳細な履歴書/,
        '経歴書・スキルシート・推薦状'
      ),
    changeType: 'specificity',
    description: 'Added specific details about what will be provided',
  },
  soften_tone: {
    subjectTransform: (s) => s.replace(/厳選/, 'おすすめ'),
    ctaTransform: (s) =>
      s.replace(
        /まずはお気軽に/,
        'お忙しいところ恐れ入りますが、'
      ),
    changeType: 'tone',
    description: 'Softened tone for more polite approach',
  },
};

/**
 * Template Generator class
 */
export class TemplateGenerator {
  private readonly baseTemplates: Record<string, TemplateContent>;
  private versionCounter: number = 0;

  constructor(options?: { baseTemplates?: Record<string, TemplateContent> }) {
    this.baseTemplates = options?.baseTemplates || BASE_TEMPLATES;
  }

  /**
   * Generate template proposals for an improvement candidate
   *
   * @param candidate - Improvement candidate
   * @param proposalsPerCandidate - Number of proposals to generate (default: 2)
   * @returns Array of template proposals
   */
  generate(
    candidate: ImprovementCandidate,
    proposalsPerCandidate: number = 2
  ): TemplateProposal[] {
    const baseContent = this.baseTemplates[candidate.templateId];
    if (!baseContent) {
      // If base template not found, use default A
      return this.generateFromDefault(candidate, proposalsPerCandidate);
    }

    const proposals: TemplateProposal[] = [];
    const strategies = this.selectStrategies(candidate, proposalsPerCandidate);

    for (const strategy of strategies) {
      const proposal = this.applyStrategy(candidate, baseContent, strategy);
      if (proposal) {
        proposals.push(proposal);
      }
    }

    return proposals;
  }

  /**
   * Generate proposals from default template
   */
  private generateFromDefault(
    candidate: ImprovementCandidate,
    count: number
  ): TemplateProposal[] {
    const defaultContent = this.baseTemplates['new_candidates_v1_A'];
    if (!defaultContent) {
      return [];
    }

    return this.generate(
      { ...candidate, templateId: 'new_candidates_v1_A' },
      count
    );
  }

  /**
   * Select strategies based on candidate characteristics
   */
  private selectStrategies(
    candidate: ImprovementCandidate,
    count: number
  ): ImprovementStrategy[] {
    const strategies: ImprovementStrategy[] = [];

    // Based on gap reason, select appropriate strategies
    if (candidate.reason.includes('Reply rate')) {
      // Low reply rate - try engagement strategies
      strategies.push('add_question', 'add_urgency', 'personalize');
    }

    if (candidate.reason.includes('Latency')) {
      // Slow response - try urgency
      strategies.push('add_urgency', 'simplify');
    }

    // Add some general strategies
    strategies.push('add_specificity', 'soften_tone');

    // Dedupe and limit
    const unique = [...new Set(strategies)];
    return unique.slice(0, count);
  }

  /**
   * Apply a strategy to generate a proposal
   */
  private applyStrategy(
    candidate: ImprovementCandidate,
    baseContent: TemplateContent,
    strategy: ImprovementStrategy
  ): TemplateProposal | null {
    const strategyConfig = STRATEGIES[strategy];
    if (!strategyConfig) {
      return null;
    }

    const changes: TemplateChange[] = [];
    const newContent: TemplateContent = { ...baseContent };

    // Apply subject transform
    if (strategyConfig.subjectTransform) {
      const before = baseContent.subjectTemplate;
      const after = strategyConfig.subjectTransform(before);
      if (after !== before) {
        newContent.subjectTemplate = after;
        changes.push({
          field: 'subjectTemplate',
          type: strategyConfig.changeType,
          description: strategyConfig.description,
          before,
          after,
        });
      }
    }

    // Apply candidate header transform
    if (strategyConfig.candidateHeaderTransform) {
      const before = baseContent.candidateHeader;
      const after = strategyConfig.candidateHeaderTransform(before);
      if (after !== before) {
        newContent.candidateHeader = after;
        changes.push({
          field: 'candidateHeader',
          type: strategyConfig.changeType,
          description: strategyConfig.description,
          before,
          after,
        });
      }
    }

    // Apply CTA transform
    if (strategyConfig.ctaTransform) {
      const before = baseContent.ctaText;
      const after = strategyConfig.ctaTransform(before);
      if (after !== before) {
        newContent.ctaText = after;
        changes.push({
          field: 'ctaText',
          type: strategyConfig.changeType,
          description: strategyConfig.description,
          before,
          after,
        });
      }
    }

    // Must have at least one change
    if (changes.length === 0) {
      return null;
    }

    // Generate new template ID
    this.versionCounter++;
    const timestamp = Date.now().toString(36);
    const templateIdNew = `${candidate.templateId}_${strategy}_${timestamp}`;

    return {
      templateIdNew,
      baseTemplateId: candidate.templateId,
      variant: candidate.variant || 'A',
      status: 'proposed',
      changes,
      content: newContent,
      targetSegment: {
        segmentName: candidate.segmentName,
        segmentValue: candidate.segmentValue,
      },
      rationale: `Generated to improve ${candidate.segmentName}=${candidate.segmentValue} performance. ${strategyConfig.description}`,
    };
  }

  /**
   * Get available base templates
   */
  getBaseTemplates(): string[] {
    return Object.keys(this.baseTemplates);
  }
}

/**
 * Create template generator with default config
 */
export function createTemplateGenerator(options?: {
  baseTemplates?: Record<string, TemplateContent>;
}): TemplateGenerator {
  return new TemplateGenerator(options);
}

export default TemplateGenerator;
