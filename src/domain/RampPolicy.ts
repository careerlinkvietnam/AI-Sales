/**
 * Ramp Policy Module
 *
 * Controls gradual rollout of auto-send functionality.
 *
 * 設計原則:
 * - 段階的に送信数を増やす（daily_cap モード）
 * - または一定割合の企業のみ対象（percentage モード）
 * - min_sent_before_increase で安全確認後に上限を引き上げ
 *
 * 設定ファイル: config/auto_send.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Daily cap schedule entry
 */
export interface DailyCapEntry {
  date: string;
  cap: number;
}

/**
 * Ramp policy configuration
 */
export interface RampPolicyConfig {
  enabled: boolean;
  mode: 'daily_cap' | 'percentage';
  daily_cap_schedule: DailyCapEntry[];
  percentage: number;
  min_sent_before_increase: number;
}

/**
 * Result of canAutoSendToday check
 */
export interface RampCheckResult {
  ok: boolean;
  reason?: string;
  cap?: number;
  current?: number;
}

/**
 * Default config path
 */
const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'config', 'auto_send.json');

/**
 * Default configuration (conservative)
 */
const DEFAULT_CONFIG: RampPolicyConfig = {
  enabled: false,
  mode: 'daily_cap',
  daily_cap_schedule: [],
  percentage: 0.05,
  min_sent_before_increase: 50,
};

/**
 * Ramp Policy class
 */
export class RampPolicy {
  private config: RampPolicyConfig;
  private readonly configPath: string;
  private readonly now: Date;

  constructor(options?: { configPath?: string; config?: Partial<RampPolicyConfig>; now?: Date }) {
    this.configPath = options?.configPath || DEFAULT_CONFIG_PATH;
    this.now = options?.now || new Date();

    if (options?.config) {
      this.config = { ...DEFAULT_CONFIG, ...options.config };
    } else {
      this.config = this.loadConfig();
    }
  }

  /**
   * Load configuration from file
   */
  private loadConfig(): RampPolicyConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = JSON.parse(content);
        return { ...DEFAULT_CONFIG, ...parsed };
      }
    } catch (error) {
      console.error(
        `[RampPolicy] Failed to load config from ${this.configPath}: ${
          error instanceof Error ? error.message : 'Unknown'
        }`
      );
    }
    return DEFAULT_CONFIG;
  }

  /**
   * Check if auto-send is allowed today based on current count
   *
   * @param todaySentCount - Number of auto-sends already done today
   * @returns Check result with ok flag, reason, and cap
   */
  canAutoSendToday(todaySentCount: number): RampCheckResult {
    // Check if ramp is enabled
    if (!this.config.enabled) {
      return {
        ok: false,
        reason: 'Ramp policy is disabled',
      };
    }

    if (this.config.mode === 'daily_cap') {
      return this.checkDailyCap(todaySentCount);
    }

    // Percentage mode doesn't limit daily count
    return {
      ok: true,
      reason: 'Percentage mode - no daily limit',
    };
  }

  /**
   * Check daily cap schedule
   */
  private checkDailyCap(todaySentCount: number): RampCheckResult {
    const todayStr = this.now.toISOString().split('T')[0];
    const schedule = this.config.daily_cap_schedule;

    // Find today's cap or the most recent applicable cap
    let applicableCap: number | null = null;

    // Sort by date descending to find the most recent entry <= today
    const sortedSchedule = [...schedule].sort((a, b) => b.date.localeCompare(a.date));

    for (const entry of sortedSchedule) {
      if (entry.date <= todayStr) {
        applicableCap = entry.cap;
        break;
      }
    }

    // If no schedule applies, default to 0 (no auto-send)
    if (applicableCap === null) {
      return {
        ok: false,
        reason: 'No daily cap schedule applies to today',
        cap: 0,
        current: todaySentCount,
      };
    }

    // Check if we've reached the cap
    if (todaySentCount >= applicableCap) {
      return {
        ok: false,
        reason: `Daily cap reached (${todaySentCount}/${applicableCap})`,
        cap: applicableCap,
        current: todaySentCount,
      };
    }

    return {
      ok: true,
      cap: applicableCap,
      current: todaySentCount,
    };
  }

  /**
   * Check if a specific company should be included in auto-send (percentage mode)
   *
   * Uses hash of company_id for stable, deterministic assignment.
   *
   * @param companyId - Company ID to check
   * @returns true if company is in the percentage group
   */
  shouldAutoSendForCompany(companyId: string): boolean {
    if (!this.config.enabled) {
      return false;
    }

    if (this.config.mode !== 'percentage') {
      // In daily_cap mode, all companies are eligible (subject to cap)
      return true;
    }

    // Hash company ID and convert to percentage (0-1)
    const hash = crypto.createHash('sha256').update(companyId).digest('hex');
    const hashValue = parseInt(hash.substring(0, 8), 16);
    const normalizedValue = hashValue / 0xffffffff;

    return normalizedValue < this.config.percentage;
  }

  /**
   * Get current configuration
   */
  getConfig(): RampPolicyConfig {
    return { ...this.config };
  }

  /**
   * Get today's effective cap (for display purposes)
   */
  getTodayCap(): number | null {
    if (!this.config.enabled || this.config.mode !== 'daily_cap') {
      return null;
    }

    const todayStr = this.now.toISOString().split('T')[0];
    const sortedSchedule = [...this.config.daily_cap_schedule].sort((a, b) =>
      b.date.localeCompare(a.date)
    );

    for (const entry of sortedSchedule) {
      if (entry.date <= todayStr) {
        return entry.cap;
      }
    }

    return 0;
  }

  /**
   * Check if ramp is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get mode
   */
  getMode(): 'daily_cap' | 'percentage' {
    return this.config.mode;
  }

  /**
   * Get percentage (for percentage mode)
   */
  getPercentage(): number {
    return this.config.percentage;
  }
}

/**
 * Singleton instance
 */
let defaultRampPolicy: RampPolicy | null = null;

/**
 * Get or create the default ramp policy
 */
export function getRampPolicy(): RampPolicy {
  if (!defaultRampPolicy) {
    defaultRampPolicy = new RampPolicy();
  }
  return defaultRampPolicy;
}

/**
 * Reset singleton (for testing)
 */
export function resetRampPolicy(): void {
  defaultRampPolicy = null;
}

/**
 * Create ramp policy for testing
 */
export function createTestRampPolicy(config: Partial<RampPolicyConfig>): RampPolicy {
  return new RampPolicy({ config });
}

export default RampPolicy;
