/**
 * Segmenter Module
 *
 * Classifies records into segments based on available facts.
 *
 * 目的:
 * - セグメント別の返信率・返信速度を可視化
 * - A/Bテストのセグメント別評価
 *
 * 制約:
 * - PIIは使用しない
 * - 推定できない場合は「不明/unknown」に落とす
 * - LLMは禁止、ルールベース（辞書/正規表現）のみ
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  CompanyProfile,
  CompanyDetail,
  ContactHistoryItem,
  NormalizedTag,
} from '../types';

// ============================================================
// Types
// ============================================================

/**
 * Region segment values
 */
export type RegionSegment = '南部' | '中部' | '北部' | '不明';

/**
 * Customer state segment values
 */
export type CustomerStateSegment = 'existing' | 'new' | 'unknown';

/**
 * Industry bucket segment values
 */
export type IndustryBucketSegment = 'IT' | '製造' | 'サービス' | 'その他' | '不明';

/**
 * Complete segment classification
 */
export interface SegmentClassification {
  region: RegionSegment;
  customerState: CustomerStateSegment;
  industryBucket: IndustryBucketSegment;
}

/**
 * Input data for segmentation
 */
export interface SegmentInput {
  /** Normalized tag (from TagNormalizer) */
  tag?: NormalizedTag | null;
  /** Company profile with facts */
  companyProfile?: CompanyProfile | null;
  /** Company detail (alternative to profile) */
  companyDetail?: CompanyDetail | null;
  /** Contact history items */
  contactHistory?: ContactHistoryItem[] | null;
}

/**
 * Segments configuration file structure
 */
export interface SegmentsConfig {
  segments: {
    region: {
      description: string;
      values: string[];
      default: string;
    };
    customer_state: {
      description: string;
      values: string[];
      default: string;
    };
    industry_bucket: {
      description: string;
      values: string[];
      default: string;
    };
  };
  rules: {
    region: {
      source: string[];
      mappings: Record<string, string[]>;
    };
    customer_state: {
      source: string[];
      existing_if: string;
    };
    industry_bucket: {
      source: string[];
      mappings: Record<string, string[]>;
    };
  };
}

// ============================================================
// Segmenter Class
// ============================================================

export class Segmenter {
  private config: SegmentsConfig | null = null;
  private readonly configPath: string;

  // Region keywords (case-insensitive)
  private readonly regionKeywords: Record<RegionSegment, RegExp[]> = {
    '南部': [
      /南部/i,
      /ho\s*chi\s*minh/i,
      /hcm/i,
      /hcmc/i,
      /binh\s*duong/i,
      /dong\s*nai/i,
      /vung\s*tau/i,
      /long\s*an/i,
    ],
    '中部': [
      /中部/i,
      /da\s*nang/i,
      /danang/i,
      /hue/i,
      /quang\s*nam/i,
    ],
    '北部': [
      /北部/i,
      /hanoi/i,
      /ha\s*noi/i,
      /hai\s*phong/i,
      /bac\s*ninh/i,
      /hai\s*duong/i,
    ],
    '不明': [],
  };

  // Industry keywords (case-insensitive)
  private readonly industryKeywords: Record<IndustryBucketSegment, RegExp[]> = {
    'IT': [
      /\bIT\b/i,
      /software/i,
      /ソフトウェア/,
      /システム/,
      /テクノロジー/,
      /\btech\b/i,
      /digital/i,
      /\bweb\b/i,
      /アプリ/,
      /\bsaas\b/i,
      /インターネット/,
      /クラウド/,
      /cloud/i,
      /データ/,
      /AI/i,
      /プログラ/,
      /エンジニア/,
    ],
    '製造': [
      /製造/,
      /manufacturing/i,
      /メーカー/,
      /工場/,
      /factory/i,
      /生産/,
      /機械/,
      /電子/,
      /部品/,
      /自動車/,
      /automotive/i,
      /産業/,
      /industrial/i,
      /金属/,
      /プラスチック/,
      /化学/,
      /chemical/i,
    ],
    'サービス': [
      /サービス/,
      /service/i,
      /コンサル/,
      /consulting/i,
      /人材/,
      /\bhr\b/i,
      /物流/,
      /logistics/i,
      /商社/,
      /trading/i,
      /小売/,
      /retail/i,
      /飲食/,
      /restaurant/i,
      /ホテル/,
      /hotel/i,
      /不動産/,
      /real\s*estate/i,
      /金融/,
      /finance/i,
      /銀行/,
      /bank/i,
      /教育/,
      /education/i,
    ],
    'その他': [],
    '不明': [],
  };

  constructor(options?: { configPath?: string }) {
    this.configPath =
      options?.configPath ||
      path.join(process.cwd(), 'config', 'segments.json');
  }

  /**
   * Load configuration from file
   */
  loadConfig(): SegmentsConfig {
    if (this.config) {
      return this.config;
    }

    if (fs.existsSync(this.configPath)) {
      const content = fs.readFileSync(this.configPath, 'utf-8');
      this.config = JSON.parse(content) as SegmentsConfig;
    } else {
      // Use default config
      this.config = this.getDefaultConfig();
    }

    return this.config;
  }

  /**
   * Classify input into segments
   */
  classify(input: SegmentInput): SegmentClassification {
    return {
      region: this.classifyRegion(input),
      customerState: this.classifyCustomerState(input),
      industryBucket: this.classifyIndustryBucket(input),
    };
  }

  /**
   * Classify region
   */
  classifyRegion(input: SegmentInput): RegionSegment {
    // Priority 1: Tag region
    if (input.tag?.region) {
      const matched = this.matchRegion(input.tag.region);
      if (matched !== '不明') {
        return matched;
      }
    }

    // Priority 2: Company profile location
    if (input.companyProfile?.facts?.location?.region) {
      const matched = this.matchRegion(input.companyProfile.facts.location.region);
      if (matched !== '不明') {
        return matched;
      }
    }

    // Priority 3: Company profile province
    if (input.companyProfile?.facts?.location?.province) {
      const matched = this.matchRegion(input.companyProfile.facts.location.province);
      if (matched !== '不明') {
        return matched;
      }
    }

    // Priority 4: Company detail region
    if (input.companyDetail?.region) {
      const matched = this.matchRegion(input.companyDetail.region);
      if (matched !== '不明') {
        return matched;
      }
    }

    // Priority 5: Company detail province
    if (input.companyDetail?.province) {
      const matched = this.matchRegion(input.companyDetail.province);
      if (matched !== '不明') {
        return matched;
      }
    }

    return '不明';
  }

  /**
   * Classify customer state
   */
  classifyCustomerState(input: SegmentInput): CustomerStateSegment {
    const history = input.contactHistory;

    if (!history || history.length === 0) {
      return 'unknown';
    }

    // Check for contract action
    const hasContract = history.some((item) => item.actionType === 'contract');
    if (hasContract) {
      return 'existing';
    }

    // Has contact history but no contract = new prospect
    return 'new';
  }

  /**
   * Classify industry bucket
   */
  classifyIndustryBucket(input: SegmentInput): IndustryBucketSegment {
    // Priority 1: Company profile industry text
    if (input.companyProfile?.facts?.industryText) {
      const matched = this.matchIndustry(input.companyProfile.facts.industryText);
      if (matched !== '不明') {
        return matched;
      }
    }

    // Priority 2: Company detail profile
    if (input.companyDetail?.profile) {
      const matched = this.matchIndustry(input.companyDetail.profile);
      if (matched !== '不明') {
        return matched;
      }
    }

    // Priority 3: Tags (search for industry hints)
    const tags = input.companyProfile?.facts?.tags || input.companyDetail?.tags || [];
    for (const tag of tags) {
      const matched = this.matchIndustry(tag);
      if (matched !== '不明' && matched !== 'その他') {
        return matched;
      }
    }

    return '不明';
  }

  /**
   * Match text to region
   */
  private matchRegion(text: string): RegionSegment {
    const regions: RegionSegment[] = ['南部', '中部', '北部'];

    for (const region of regions) {
      for (const pattern of this.regionKeywords[region]) {
        if (pattern.test(text)) {
          return region;
        }
      }
    }

    return '不明';
  }

  /**
   * Match text to industry bucket
   */
  private matchIndustry(text: string): IndustryBucketSegment {
    const industries: IndustryBucketSegment[] = ['IT', '製造', 'サービス'];

    for (const industry of industries) {
      for (const pattern of this.industryKeywords[industry]) {
        if (pattern.test(text)) {
          return industry;
        }
      }
    }

    // If text exists but no match, classify as その他
    if (text && text.trim().length > 0) {
      return 'その他';
    }

    return '不明';
  }

  /**
   * Get default configuration
   */
  private getDefaultConfig(): SegmentsConfig {
    return {
      segments: {
        region: {
          description: 'Geographic region',
          values: ['南部', '中部', '北部', '不明'],
          default: '不明',
        },
        customer_state: {
          description: 'Customer relationship state',
          values: ['existing', 'new', 'unknown'],
          default: 'unknown',
        },
        industry_bucket: {
          description: 'Industry classification',
          values: ['IT', '製造', 'サービス', 'その他', '不明'],
          default: '不明',
        },
      },
      rules: {
        region: {
          source: ['tag.region', 'company.location.region'],
          mappings: {},
        },
        customer_state: {
          source: ['contactHistory.actionTypes'],
          existing_if: 'has_contract_action',
        },
        industry_bucket: {
          source: ['company.facts.industryText'],
          mappings: {},
        },
      },
    };
  }
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Singleton instance
 */
let defaultSegmenter: Segmenter | null = null;

/**
 * Get or create the default segmenter
 */
export function getSegmenter(): Segmenter {
  if (!defaultSegmenter) {
    defaultSegmenter = new Segmenter();
  }
  return defaultSegmenter;
}

/**
 * Create segmenter for testing
 */
export function createTestSegmenter(configPath?: string): Segmenter {
  return new Segmenter({ configPath });
}

export default Segmenter;
