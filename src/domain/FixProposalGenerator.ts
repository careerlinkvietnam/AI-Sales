/**
 * Fix Proposal Generator
 *
 * Generates fix proposals based on incident report analysis.
 * Each category has specific remediation steps.
 *
 * 重要:
 * - PIIは使用しない
 * - 自動適用は禁止（提案のみ）
 * - 提案は人間がレビューして適用する
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  FixProposal,
  FixProposalStore,
  getFixProposalStore,
  ProposalPriority,
  ProposalSource,
  ProposalRationale,
  RelatedArtifacts,
} from '../data/FixProposalStore';
import { IncidentCategory } from './RootCauseClassifier';

/**
 * Category summary from incident report
 */
export interface CategorySummary {
  category_id: string;
  category_name: string;
  category_name_ja: string;
  count: number;
  recommended_actions: string[];
}

/**
 * Input for proposal generation
 */
export interface ProposalGeneratorInput {
  period: {
    start: string;
    end: string;
  };
  total_incidents: number;
  by_category: CategorySummary[];
  open_incidents: Array<{
    incident_id: string;
    category_id: string;
  }>;
}

/**
 * Generated proposal (before storage)
 */
export interface GeneratedProposal {
  category_id: string;
  priority: ProposalPriority;
  title: string;
  recommended_steps: string[];
  related_artifacts: RelatedArtifacts;
  rationale: ProposalRationale;
}

/**
 * Category-specific proposal templates
 */
const PROPOSAL_TEMPLATES: Record<
  string,
  {
    priority_base: ProposalPriority;
    title_template: string;
    steps: string[];
    artifacts: RelatedArtifacts;
  }
> = {
  policy_config: {
    priority_base: 'P1',
    title_template: 'ポリシー設定の確認と是正',
    steps: [
      '1. run_ops stop-status で現在の停止状態を確認',
      '2. SEND_ALLOWLIST_DOMAINS または SEND_ALLOWLIST_EMAILS が設定されているか確認',
      '3. ENABLE_AUTO_SEND=true が設定されているか確認',
      '4. KILL_SWITCH=false であることを確認',
      '5. 必要に応じて .env を更新し、run_ops resume-send で再開',
    ],
    artifacts: {
      files: ['.env', 'config/auto_send.json'],
      commands: ['run_ops stop-status', 'run_ops resume-send'],
    },
  },
  ramp_limited: {
    priority_base: 'P2',
    title_template: '段階リリース制限の見直し',
    steps: [
      '1. run_ops ramp-status で現在のキャップと使用状況を確認',
      '2. config/auto_send.json の ramp 設定を確認',
      '3. 返信率が安定していれば、段階的にキャップを引き上げ検討',
      '4. RAMP_DAILY_CAP を 10→15→20 のように段階的に増加',
      '5. 変更後は run_ops auto-stop で健全性を監視',
    ],
    artifacts: {
      files: ['config/auto_send.json', '.env'],
      commands: ['run_ops ramp-status', 'run_ops auto-stop'],
    },
  },
  auto_stop_triggered: {
    priority_base: 'P0',
    title_template: '自動停止原因の調査と対策',
    steps: [
      '1. run_ops report --since で直近の送信統計を確認',
      '2. run_ops safety --experiment で実験の健全性を確認',
      '3. 返信率低下の原因を特定（対象企業リスト/テンプレート/時期）',
      '4. 必要に応じて run_ops rollback で問題のある実験を停止',
      '5. ramp cap を縮小（例: 20→10）して慎重に再開',
      '6. run_ops resume-send --reason "調査完了" で再開',
    ],
    artifacts: {
      files: ['config/auto_stop.json', 'config/experiments.json'],
      commands: [
        'run_ops report',
        'run_ops safety',
        'run_ops rollback',
        'run_ops resume-send',
      ],
    },
  },
  content_gate_failed: {
    priority_base: 'P1',
    title_template: 'テンプレートコンテンツの改善',
    steps: [
      '1. TemplateQualityGate の違反内容を確認',
      '2. 違反テンプレートを特定（logs/から検索）',
      '3. テンプレートを修正（PII除去、長さ調整、トラッキングID確認）',
      '4. run_ops propose --experiment で修正テンプレートを提案',
      '5. run_ops approve で承認',
      '6. 修正後のテンプレートでテスト送信',
    ],
    artifacts: {
      files: ['config/experiments.json'],
      commands: ['run_ops propose', 'run_ops approve'],
    },
  },
  token_or_registry: {
    priority_base: 'P1',
    title_template: '承認フロー/レジストリの改善',
    steps: [
      '1. DraftRegistry の状態を確認（data/draft_registry.ndjson）',
      '2. 下書きが正しく登録されているか確認',
      '3. 承認トークンの有効期限を確認',
      '4. 必要に応じて下書きを再作成（run_one_company）',
      '5. run_ops approve-send --help で正しい手順を確認',
      '6. 承認フローのドキュメントを確認（docs/runbook.md）',
    ],
    artifacts: {
      files: ['data/draft_registry.ndjson', 'docs/runbook.md'],
      commands: ['run_one_company', 'run_ops approve-send --help'],
    },
  },
  gmail_api: {
    priority_base: 'P1',
    title_template: 'Gmail API エラーへの対処',
    steps: [
      '1. Gmail API のクォータ状況を確認（Google Cloud Console）',
      '2. GMAIL_REFRESH_TOKEN の有効性を確認',
      '3. 認証エラーの場合は OAuth 再認証を実施',
      '4. レート制限の場合は送信間隔を調整（ramp cap縮小）',
      '5. 一時的エラーの場合はリトライを待つ（通常1時間）',
      '6. 継続する場合は Gmail API のサポートに問い合わせ',
    ],
    artifacts: {
      files: ['.env'],
      commands: ['run_ops ramp-status'],
    },
  },
  experiment_health: {
    priority_base: 'P1',
    title_template: '実験健全性の改善',
    steps: [
      '1. run_ops status --all で全実験の状態を確認',
      '2. run_ops safety --experiment で健全性を評価',
      '3. サンプルサイズ不足の場合は期間延長を検討',
      '4. パフォーマンス不良の場合は run_ops rollback を実行',
      '5. 新しい実験設計を検討（対象絞り込み、テンプレ改善）',
      '6. experiments.json を更新して再開',
    ],
    artifacts: {
      files: ['config/experiments.json'],
      commands: ['run_ops status --all', 'run_ops safety', 'run_ops rollback'],
    },
  },
  unknown: {
    priority_base: 'P2',
    title_template: '未分類インシデントの調査',
    steps: [
      '1. インシデントの詳細を確認（run_ops incident show）',
      '2. 原因を手動で特定',
      '3. 新しいカテゴリが必要か検討',
      '4. config/incident_categories.json にカテゴリ追加を検討',
      '5. incident note でメモを追記',
      '6. incident close で完了',
    ],
    artifacts: {
      files: ['config/incident_categories.json'],
      commands: ['run_ops incident show', 'run_ops incident note', 'run_ops incident close'],
    },
  },
};

/**
 * Fix Proposal Generator class
 */
export class FixProposalGenerator {
  private readonly store: FixProposalStore;
  private readonly maxProposals: number;
  private readonly deduplicationDays: number;

  constructor(options?: {
    store?: FixProposalStore;
    maxProposals?: number;
    deduplicationDays?: number;
  }) {
    this.store = options?.store || getFixProposalStore();
    this.maxProposals = options?.maxProposals ?? 5;
    this.deduplicationDays = options?.deduplicationDays ?? 7;
  }

  /**
   * Generate proposals from incident report
   */
  generate(input: ProposalGeneratorInput): GeneratedProposal[] {
    const proposals: GeneratedProposal[] = [];

    // Process top categories
    const topCategories = input.by_category.slice(0, this.maxProposals);

    for (const category of topCategories) {
      // Skip if no incidents
      if (category.count === 0) continue;

      // Check for recent similar proposals (deduplication)
      if (this.store.hasSimilarProposal(category.category_id, this.deduplicationDays)) {
        continue;
      }

      const proposal = this.generateForCategory(category, input);
      if (proposal) {
        proposals.push(proposal);
      }
    }

    return proposals;
  }

  /**
   * Generate proposal for a specific category
   */
  private generateForCategory(
    category: CategorySummary,
    input: ProposalGeneratorInput
  ): GeneratedProposal | null {
    const template = PROPOSAL_TEMPLATES[category.category_id];

    if (!template) {
      // Use unknown template for unrecognized categories
      return this.generateForCategory(
        { ...category, category_id: 'unknown' },
        input
      );
    }

    // Calculate priority based on incident count
    const priority = this.calculatePriority(template.priority_base, category.count);

    // Get recent incident IDs for this category (PII-free)
    const recentExamples = input.open_incidents
      .filter((inc) => inc.category_id === category.category_id)
      .map((inc) => inc.incident_id)
      .slice(0, 3);

    return {
      category_id: category.category_id,
      priority,
      title: `[${category.category_name_ja}] ${template.title_template}`,
      recommended_steps: template.steps,
      related_artifacts: template.artifacts,
      rationale: {
        incident_count: category.count,
        recent_examples: recentExamples.length > 0 ? recentExamples : undefined,
      },
    };
  }

  /**
   * Calculate priority based on base priority and incident count
   */
  private calculatePriority(
    basePriority: ProposalPriority,
    incidentCount: number
  ): ProposalPriority {
    // Escalate to P0 for very high incident counts
    if (incidentCount >= 10) {
      return 'P0';
    }
    // Escalate by one level for high incident counts
    if (incidentCount >= 5) {
      if (basePriority === 'P2') return 'P1';
      if (basePriority === 'P1') return 'P0';
    }
    return basePriority;
  }

  /**
   * Create and store proposals
   */
  createProposals(
    input: ProposalGeneratorInput,
    options?: { dryRun?: boolean }
  ): FixProposal[] {
    const generated = this.generate(input);
    const proposals: FixProposal[] = [];

    const now = new Date().toISOString();
    const source: ProposalSource = {
      report_since: input.period.start,
      top_categories: input.by_category.slice(0, this.maxProposals).map((c) => c.category_id),
    };

    for (const gen of generated) {
      const proposal: FixProposal = {
        proposal_id: this.store.generateProposalId(),
        created_at: now,
        created_by: 'auto',
        source,
        category_id: gen.category_id,
        priority: gen.priority,
        title: gen.title,
        recommended_steps: gen.recommended_steps,
        related_artifacts: gen.related_artifacts,
        status: 'proposed',
        rationale: gen.rationale,
        updated_at: now,
      };

      if (!options?.dryRun) {
        this.store.createProposal(proposal);
      }

      proposals.push(proposal);
    }

    return proposals;
  }
}

/**
 * Singleton instance
 */
let defaultGenerator: FixProposalGenerator | null = null;

/**
 * Get or create default generator
 */
export function getFixProposalGenerator(): FixProposalGenerator {
  if (!defaultGenerator) {
    defaultGenerator = new FixProposalGenerator();
  }
  return defaultGenerator;
}

/**
 * Reset singleton (for testing)
 */
export function resetFixProposalGenerator(): void {
  defaultGenerator = null;
}

/**
 * Create generator for testing
 */
export function createTestFixProposalGenerator(options: {
  store: FixProposalStore;
  maxProposals?: number;
  deduplicationDays?: number;
}): FixProposalGenerator {
  return new FixProposalGenerator(options);
}

export default FixProposalGenerator;
