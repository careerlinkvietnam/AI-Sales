/**
 * Priority Scorer
 *
 * Scores companies based on various factors to determine outreach priority.
 * Higher scores indicate higher priority for contact.
 */

import {
  PriorityScore,
  PriorityBucket,
  ScoringReason,
  ScoringRulesConfig,
  CompanyForScoring,
  DEFAULT_SCORING_RULES,
} from './PriorityScorerConfig';
import { CompanyDetail, ContactHistory, ContactActionType } from '../types';

/**
 * Priority Scorer class
 * Calculates priority scores for companies based on configurable rules
 */
export class PriorityScorer {
  private readonly rules: ScoringRulesConfig;
  private readonly referenceDate: Date;
  private readonly searchTag?: string;

  /**
   * Create a new PriorityScorer
   *
   * @param rules - Scoring rules configuration (default: DEFAULT_SCORING_RULES)
   * @param referenceDate - Reference date for age calculations (default: now)
   * @param searchTag - Tag used for search (for region matching)
   */
  constructor(
    rules?: ScoringRulesConfig,
    referenceDate?: Date,
    searchTag?: string
  ) {
    this.rules = rules || DEFAULT_SCORING_RULES;
    this.referenceDate = referenceDate || new Date();
    this.searchTag = searchTag;
  }

  /**
   * Score a single company
   */
  score(detail: CompanyDetail, history: ContactHistory): PriorityScore {
    const reasons: ScoringReason[] = [];
    let totalScore = 0;

    // Check for existing contract first
    const hasContract = this.hasExistingContract(history);
    if (hasContract) {
      return this.createResult(detail, history, 0, 'existing_customer', [
        { rule: 'existingContract', description: '既存顧客', points: 0 },
      ]);
    }

    // Check for missing email
    const hasEmail = !!detail.contactEmail;
    if (!hasEmail) {
      const penalty = this.rules.missingEmailPenalty;
      reasons.push({
        rule: 'missingEmail',
        description: 'メールアドレス未登録（要データ整備）',
        points: penalty,
      });
      totalScore += penalty;
    }

    // Calculate last contact age score
    const ageResult = this.scoreLastContactAge(history);
    if (ageResult) {
      reasons.push(ageResult);
      totalScore += ageResult.points;
    }

    // Calculate recent reply score
    const replyResult = this.scoreRecentReply(history);
    if (replyResult) {
      reasons.push(replyResult);
      totalScore += replyResult.points;
    }

    // Calculate region match score
    const regionResult = this.scoreRegionMatch(detail);
    if (regionResult) {
      reasons.push(regionResult);
      totalScore += regionResult.points;
    }

    // Calculate contact frequency score
    const frequencyResult = this.scoreContactFrequency(history);
    if (frequencyResult) {
      reasons.push(frequencyResult);
      totalScore += frequencyResult.points;
    }

    // Ensure score is within bounds
    totalScore = Math.max(0, Math.min(100, totalScore));

    // Determine bucket
    let bucket: PriorityBucket;
    if (!hasEmail) {
      bucket = 'data_cleanup';
    } else if (totalScore >= this.rules.bucketThresholds.highPriority) {
      bucket = 'high_priority';
    } else if (totalScore >= this.rules.bucketThresholds.normal) {
      bucket = 'normal';
    } else {
      bucket = 'low_priority';
    }

    return this.createResult(detail, history, totalScore, bucket, reasons);
  }

  /**
   * Score multiple companies and sort by priority
   */
  scoreBatch(companies: CompanyForScoring[]): PriorityScore[] {
    return companies
      .map(c => this.score(c.detail, c.history))
      .sort((a, b) => {
        // Sort by bucket priority first, then by score
        const bucketOrder: Record<PriorityBucket, number> = {
          high_priority: 0,
          normal: 1,
          low_priority: 2,
          existing_customer: 3,
          data_cleanup: 4,
        };
        const bucketDiff = bucketOrder[a.bucket] - bucketOrder[b.bucket];
        if (bucketDiff !== 0) return bucketDiff;
        return b.score - a.score; // Higher score first within bucket
      });
  }

  /**
   * Get top N companies by priority
   */
  getTopPriority(companies: CompanyForScoring[], limit: number): PriorityScore[] {
    return this.scoreBatch(companies).slice(0, limit);
  }

  /**
   * Filter companies by bucket
   */
  filterByBucket(
    scores: PriorityScore[],
    buckets: PriorityBucket[]
  ): PriorityScore[] {
    return scores.filter(s => buckets.includes(s.bucket));
  }

  // ============================================================
  // Private Scoring Methods
  // ============================================================

  private scoreLastContactAge(history: ContactHistory): ScoringReason | null {
    const lastContactDate = this.getLastContactDate(history);
    if (!lastContactDate) {
      return {
        rule: 'lastContactAge',
        description: '連絡履歴なし（新規開拓対象）',
        points: 20, // New prospects get moderate priority
      };
    }

    const daysSince = this.daysBetween(lastContactDate, this.referenceDate);

    for (const rule of this.rules.lastContactAge) {
      if (daysSince >= rule.minDays && (rule.maxDays === null || daysSince <= rule.maxDays)) {
        return {
          rule: 'lastContactAge',
          description: rule.description,
          points: rule.points,
        };
      }
    }

    return null;
  }

  private scoreRecentReply(history: ContactHistory): ScoringReason | null {
    const rule = this.rules.recentReply;
    const cutoffDate = new Date(this.referenceDate);
    cutoffDate.setDate(cutoffDate.getDate() - rule.withinDays);

    const hasRecentReply = history.items.some(item => {
      const itemDate = new Date(item.performedAt);
      return (
        itemDate >= cutoffDate &&
        rule.actionTypes.includes(item.actionType as ContactActionType)
      );
    });

    if (hasRecentReply) {
      return {
        rule: 'recentReply',
        description: rule.description,
        points: rule.points,
      };
    }

    return null;
  }

  private scoreRegionMatch(detail: CompanyDetail): ScoringReason | null {
    if (!this.searchTag) return null;

    const rule = this.rules.regionMatch;
    const companyTags = detail.tags || [];

    // Extract region from search tag
    const searchRegion = rule.tags.find(region => this.searchTag!.includes(region));
    if (!searchRegion) return null;

    // Check if company tags contain the same region
    const hasMatchingRegion = companyTags.some(tag =>
      tag.includes(searchRegion)
    ) || detail.region === searchRegion;

    if (hasMatchingRegion) {
      return {
        rule: 'regionMatch',
        description: `${rule.description}（${searchRegion}）`,
        points: rule.points,
      };
    }

    return null;
  }

  private scoreContactFrequency(history: ContactHistory): ScoringReason | null {
    const totalContacts = history.totalCount || history.items.length;

    if (totalContacts === 0) return null;

    for (const rule of this.rules.contactFrequency) {
      if (
        totalContacts >= rule.minContacts &&
        (rule.maxContacts === null || totalContacts <= rule.maxContacts)
      ) {
        return {
          rule: 'contactFrequency',
          description: `${rule.description}（${totalContacts}回）`,
          points: rule.points,
        };
      }
    }

    return null;
  }

  // ============================================================
  // Helper Methods
  // ============================================================

  private hasExistingContract(history: ContactHistory): boolean {
    return history.items.some(item => item.actionType === 'contract');
  }

  private getLastContactDate(history: ContactHistory): Date | null {
    if (history.items.length === 0) return null;

    // Items should be sorted by date descending, but let's be safe
    const dates = history.items
      .map(item => new Date(item.performedAt))
      .filter(d => !isNaN(d.getTime()));

    if (dates.length === 0) return null;

    return new Date(Math.max(...dates.map(d => d.getTime())));
  }

  private daysBetween(date1: Date, date2: Date): number {
    const diff = Math.abs(date2.getTime() - date1.getTime());
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  private createResult(
    detail: CompanyDetail,
    history: ContactHistory,
    score: number,
    bucket: PriorityBucket,
    reasons: ScoringReason[]
  ): PriorityScore {
    const lastContactDate = this.getLastContactDate(history);
    const daysSinceContact = lastContactDate
      ? this.daysBetween(lastContactDate, this.referenceDate)
      : null;

    // Generate summary
    const summaryParts: string[] = [];
    if (bucket === 'existing_customer') {
      summaryParts.push('既存顧客のため営業対象外');
    } else if (bucket === 'data_cleanup') {
      summaryParts.push('データ整備が必要');
    } else {
      const topReasons = reasons
        .filter(r => r.points > 0)
        .sort((a, b) => b.points - a.points)
        .slice(0, 2)
        .map(r => r.description);
      if (topReasons.length > 0) {
        summaryParts.push(topReasons.join('、'));
      }
    }

    return {
      companyId: detail.companyId,
      companyName: this.getDisplayName(detail),
      score,
      bucket,
      reasons,
      summary: summaryParts.join('。') || '評価理由なし',
      metadata: {
        lastContactDate: lastContactDate?.toISOString().split('T')[0] || null,
        daysSinceContact,
        totalContacts: history.totalCount || history.items.length,
        hasContract: this.hasExistingContract(history),
        hasEmail: !!detail.contactEmail,
      },
    };
  }

  private getDisplayName(detail: CompanyDetail): string {
    return detail.nameJa || detail.nameEn || detail.name || `Company ${detail.companyId}`;
  }
}

export default PriorityScorer;
