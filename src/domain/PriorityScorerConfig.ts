/**
 * Priority Scorer Configuration Types
 *
 * Defines types and interfaces for the priority scoring system.
 */

import { CompanyDetail, ContactHistory, ContactActionType } from '../types';

// ============================================================
// Scoring Result Types
// ============================================================

/**
 * Reason for a scoring adjustment
 */
export interface ScoringReason {
  /** Rule that triggered this reason */
  rule: string;
  /** Human-readable description */
  description: string;
  /** Points added or subtracted */
  points: number;
}

/**
 * Priority buckets for categorizing companies
 */
export type PriorityBucket =
  | 'high_priority'    // score 70-100
  | 'normal'           // score 40-69
  | 'low_priority'     // score 0-39
  | 'existing_customer' // has contract
  | 'data_cleanup';    // missing data

/**
 * Result of priority scoring for a company
 */
export interface PriorityScore {
  /** Company ID */
  companyId: string;
  /** Company name (for display) */
  companyName: string;
  /** Calculated priority score (0-100) */
  score: number;
  /** Priority bucket classification */
  bucket: PriorityBucket;
  /** Reasons for the score */
  reasons: ScoringReason[];
  /** Human-readable summary */
  summary: string;
  /** Additional metadata */
  metadata: {
    lastContactDate?: string | null;
    daysSinceContact?: number | null;
    totalContacts: number;
    hasContract: boolean;
    hasEmail: boolean;
  };
}

// ============================================================
// Scoring Rule Types
// ============================================================

/**
 * Age-based scoring rule (days since last contact)
 */
export interface AgeScoringRule {
  /** Minimum days since contact */
  minDays: number;
  /** Maximum days since contact (null = infinity) */
  maxDays: number | null;
  /** Points to add */
  points: number;
  /** Description template */
  description: string;
}

/**
 * Reply-based scoring rule
 */
export interface ReplyScoringRule {
  /** Days to look back for replies */
  withinDays: number;
  /** Action types that count as replies */
  actionTypes: ContactActionType[];
  /** Points to add */
  points: number;
  /** Description template */
  description: string;
}

/**
 * Tag matching rule
 */
export interface TagMatchRule {
  /** Tags to match (any match counts) */
  tags: string[];
  /** Points to add */
  points: number;
  /** Description template */
  description: string;
}

/**
 * Contact frequency scoring rule
 */
export interface FrequencyScoringRule {
  /** Minimum contacts */
  minContacts: number;
  /** Maximum contacts (null = infinity) */
  maxContacts: number | null;
  /** Points to add */
  points: number;
  /** Description template */
  description: string;
}

/**
 * Complete scoring rules configuration
 */
export interface ScoringRulesConfig {
  /** Rules for scoring based on contact age */
  lastContactAge: AgeScoringRule[];
  /** Rules for recent replies */
  recentReply: ReplyScoringRule;
  /** Rules for tag matching */
  regionMatch: TagMatchRule;
  /** Rules for contact frequency */
  contactFrequency: FrequencyScoringRule[];
  /** Points to subtract for missing email */
  missingEmailPenalty: number;
  /** Bucket score thresholds */
  bucketThresholds: {
    highPriority: number;  // >= this is high priority
    normal: number;        // >= this is normal
  };
}

// ============================================================
// Input Types
// ============================================================

/**
 * Extended company data for scoring
 */
export interface CompanyForScoring {
  /** Company details from CRM */
  detail: CompanyDetail;
  /** Contact history from CRM */
  history: ContactHistory;
}

// ============================================================
// Default Configuration
// ============================================================

/**
 * Default scoring rules configuration
 */
export const DEFAULT_SCORING_RULES: ScoringRulesConfig = {
  lastContactAge: [
    { minDays: 0, maxDays: 14, points: 10, description: '直近2週間以内に連絡あり' },
    { minDays: 15, maxDays: 30, points: 20, description: '2週間〜1ヶ月前に連絡' },
    { minDays: 31, maxDays: 60, points: 25, description: '1〜2ヶ月前に連絡' },
    { minDays: 61, maxDays: 90, points: 30, description: '2〜3ヶ月前に連絡（フォローアップ推奨）' },
    { minDays: 91, maxDays: null, points: 15, description: '3ヶ月以上連絡なし（要確認）' },
  ],
  recentReply: {
    withinDays: 14,
    actionTypes: ['tel', 'visit'],
    points: 20,
    description: '直近14日以内に反応あり',
  },
  regionMatch: {
    tags: ['南部', '北部', '中部', '東部', '西部'],
    points: 15,
    description: 'タグ地域と一致',
  },
  contactFrequency: [
    { minContacts: 1, maxContacts: 2, points: 5, description: '連絡回数少なめ' },
    { minContacts: 3, maxContacts: 5, points: 10, description: '定期的に連絡' },
    { minContacts: 6, maxContacts: null, points: 15, description: 'アクティブな関係' },
  ],
  missingEmailPenalty: -15,
  bucketThresholds: {
    highPriority: 70,
    normal: 40,
  },
};
