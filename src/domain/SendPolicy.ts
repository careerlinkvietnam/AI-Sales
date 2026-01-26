/**
 * Send Policy Module
 *
 * Controls email sending permissions through allowlists, rate limits, and kill switch.
 *
 * 設計原則:
 * - デフォルトは送信しない（ENABLE_AUTO_SEND=false）
 * - 緊急停止スイッチ（KILL_SWITCH=true or RuntimeKillSwitch）で即無効化
 * - allowlistで宛先を限定（未設定なら全て禁止）
 * - 日次レート制限で送信数を制御
 *
 * 環境変数:
 * - ENABLE_AUTO_SEND: 'true' で送信有効（デフォルト: false）
 * - KILL_SWITCH: 'true' で送信無効（デフォルト: false）
 * - SEND_ALLOWLIST_DOMAINS: カンマ区切りのドメイン（例: "example.com,test.co.jp"）
 * - SEND_ALLOWLIST_EMAILS: カンマ区切りのメール（例: "a@x.com,b@y.com"）
 * - SEND_MAX_PER_DAY: 日次最大送信数（デフォルト: 20）
 *
 * ファイルベースキルスイッチ:
 * - data/kill_switch.json が存在し enabled=true なら送信無効
 * - CLI (run_ops stop-send/resume-send) で操作可能
 */

import { getRuntimeKillSwitch } from './RuntimeKillSwitch';

/**
 * Deny reason types
 */
export type SendDenyReason =
  | 'not_enabled'
  | 'kill_switch'
  | 'runtime_kill_switch'
  | 'ramp_limited'
  | 'allowlist'
  | 'rate_limit'
  | 'no_allowlist_configured';

/**
 * Policy check result
 */
export interface SendPolicyResult {
  allowed: boolean;
  reason?: SendDenyReason;
  details?: string;
}

/**
 * Rate limit check result
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
}

/**
 * Send Policy Configuration
 */
export interface SendPolicyConfig {
  /** Override ENABLE_AUTO_SEND (for testing) */
  enableAutoSend?: boolean;
  /** Override KILL_SWITCH (for testing) */
  killSwitch?: boolean;
  /** Override allowlist domains (for testing) */
  allowlistDomains?: string[];
  /** Override allowlist emails (for testing) */
  allowlistEmails?: string[];
  /** Override max sends per day (for testing) */
  maxPerDay?: number;
}

/**
 * Default rate limit
 */
const DEFAULT_MAX_PER_DAY = 20;

/**
 * Send Policy class
 */
export class SendPolicy {
  private readonly enableAutoSend: boolean;
  private readonly killSwitch: boolean;
  private readonly allowlistDomains: Set<string>;
  private readonly allowlistEmails: Set<string>;
  private readonly maxPerDay: number;

  constructor(config?: SendPolicyConfig) {
    // Read from env or config
    this.enableAutoSend =
      config?.enableAutoSend ??
      process.env.ENABLE_AUTO_SEND?.toLowerCase() === 'true';

    this.killSwitch =
      config?.killSwitch ??
      process.env.KILL_SWITCH?.toLowerCase() === 'true';

    // Parse allowlist domains
    const domainList =
      config?.allowlistDomains ??
      this.parseCommaSeparated(process.env.SEND_ALLOWLIST_DOMAINS);
    this.allowlistDomains = new Set(domainList.map((d) => d.toLowerCase()));

    // Parse allowlist emails
    const emailList =
      config?.allowlistEmails ??
      this.parseCommaSeparated(process.env.SEND_ALLOWLIST_EMAILS);
    this.allowlistEmails = new Set(emailList.map((e) => e.toLowerCase()));

    // Rate limit
    this.maxPerDay =
      config?.maxPerDay ??
      (parseInt(process.env.SEND_MAX_PER_DAY || '', 10) || DEFAULT_MAX_PER_DAY);
  }

  /**
   * Check if sending is enabled
   * Requires: ENABLE_AUTO_SEND && !KILL_SWITCH && !RuntimeKillSwitch
   */
  isSendingEnabled(): boolean {
    if (!this.enableAutoSend) return false;
    if (this.killSwitch) return false;
    if (getRuntimeKillSwitch().isEnabled()) return false;
    return true;
  }

  /**
   * Check if runtime kill switch is active (file-based)
   */
  isRuntimeKillSwitchActive(): boolean {
    return getRuntimeKillSwitch().isEnabled();
  }

  /**
   * Check if recipient is in allowlist
   *
   * @param toEmail - Recipient email address
   * @returns true if allowed, false if not
   */
  isRecipientAllowed(toEmail: string): boolean {
    const email = toEmail.toLowerCase().trim();

    // Check email allowlist first
    if (this.allowlistEmails.has(email)) {
      return true;
    }

    // Check domain allowlist
    const domain = this.extractDomain(email);
    if (domain && this.allowlistDomains.has(domain)) {
      return true;
    }

    return false;
  }

  /**
   * Check if allowlist is configured
   */
  hasAllowlistConfigured(): boolean {
    return this.allowlistDomains.size > 0 || this.allowlistEmails.size > 0;
  }

  /**
   * Check rate limit
   *
   * @param todayCount - Number of sends already made today
   * @returns Rate limit check result
   */
  checkRateLimit(todayCount: number): RateLimitResult {
    const remaining = Math.max(0, this.maxPerDay - todayCount);
    return {
      allowed: todayCount < this.maxPerDay,
      remaining,
      limit: this.maxPerDay,
    };
  }

  /**
   * Full policy check for sending
   *
   * @param toEmail - Recipient email address
   * @param todayCount - Number of sends already made today
   * @returns Policy check result
   */
  checkSendPermission(toEmail: string, todayCount: number): SendPolicyResult {
    // Check 1: Environment kill switch
    if (this.killSwitch) {
      return {
        allowed: false,
        reason: 'kill_switch',
        details: 'Emergency kill switch is active (env KILL_SWITCH=true)',
      };
    }

    // Check 2: Runtime kill switch (file-based)
    if (getRuntimeKillSwitch().isEnabled()) {
      const state = getRuntimeKillSwitch().getState();
      return {
        allowed: false,
        reason: 'runtime_kill_switch',
        details: `Runtime kill switch is active: ${state?.reason || 'unknown reason'}`,
      };
    }

    // Check 3: Sending enabled
    if (!this.enableAutoSend) {
      return {
        allowed: false,
        reason: 'not_enabled',
        details: 'ENABLE_AUTO_SEND is not set to true',
      };
    }

    // Check 4: Allowlist configured
    if (!this.hasAllowlistConfigured()) {
      return {
        allowed: false,
        reason: 'no_allowlist_configured',
        details: 'No allowlist domains or emails configured',
      };
    }

    // Check 5: Recipient in allowlist
    if (!this.isRecipientAllowed(toEmail)) {
      const domain = this.extractDomain(toEmail) || 'unknown';
      return {
        allowed: false,
        reason: 'allowlist',
        details: `Recipient domain '${domain}' is not in allowlist`,
      };
    }

    // Check 6: Rate limit
    const rateLimit = this.checkRateLimit(todayCount);
    if (!rateLimit.allowed) {
      return {
        allowed: false,
        reason: 'rate_limit',
        details: `Daily limit reached (${this.maxPerDay} per day)`,
      };
    }

    return { allowed: true };
  }

  /**
   * Get current configuration (for debugging/logging)
   */
  getConfig(): {
    enableAutoSend: boolean;
    killSwitch: boolean;
    runtimeKillSwitch: boolean;
    allowlistDomains: string[];
    allowlistEmails: string[];
    maxPerDay: number;
  } {
    return {
      enableAutoSend: this.enableAutoSend,
      killSwitch: this.killSwitch,
      runtimeKillSwitch: getRuntimeKillSwitch().isEnabled(),
      allowlistDomains: Array.from(this.allowlistDomains),
      allowlistEmails: Array.from(this.allowlistEmails),
      maxPerDay: this.maxPerDay,
    };
  }

  /**
   * Extract domain from email address
   */
  private extractDomain(email: string): string | null {
    const parts = email.split('@');
    return parts.length === 2 ? parts[1].toLowerCase() : null;
  }

  /**
   * Parse comma-separated string to array
   */
  private parseCommaSeparated(value: string | undefined): string[] {
    if (!value) return [];
    return value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
}

/**
 * Singleton instance
 */
let defaultPolicy: SendPolicy | null = null;

/**
 * Get or create the default send policy
 */
export function getSendPolicy(): SendPolicy {
  if (!defaultPolicy) {
    defaultPolicy = new SendPolicy();
  }
  return defaultPolicy;
}

/**
 * Reset the singleton (for testing)
 */
export function resetSendPolicy(): void {
  defaultPolicy = null;
}

/**
 * Create send policy for testing
 */
export function createTestSendPolicy(config: SendPolicyConfig): SendPolicy {
  return new SendPolicy(config);
}

export default SendPolicy;
