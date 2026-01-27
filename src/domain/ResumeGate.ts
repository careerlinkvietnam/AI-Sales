/**
 * Resume Gate
 *
 * Evaluates whether it's safe to resume sending after an incident.
 *
 * 重要:
 * - OKでも自動再開しない。人間がrun_ops resume-sendで実行する。
 * - blockersがあれば、resume-sendは中断される（--forceで上書き可）
 * - --force使用時はincident noteに強制理由を残す
 */

import { getSendPolicy } from './SendPolicy';
import { getRuntimeKillSwitch } from './RuntimeKillSwitch';
import { getAutoStopPolicy } from './AutoStopPolicy';
import { getMetricsStore } from '../data/MetricsStore';
import { getIncidentManager } from './IncidentManager';

/**
 * Resume gate result
 */
export interface ResumeGateResult {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  checkResults: {
    runtimeKillSwitch: { blocked: boolean; reason?: string };
    envKillSwitch: { blocked: boolean; reason?: string };
    autoSendEnabled: { blocked: boolean; reason?: string };
    allowlistConfigured: { blocked: boolean; reason?: string };
    cooldownPeriod: { blocked: boolean; reason?: string };
    replyRateRecovered: { blocked: boolean; reason?: string };
    noOpenIncident: { blocked: boolean; reason?: string };
  };
}

/**
 * Resume Gate class
 */
export class ResumeGate {
  private readonly cooldownHours: number;

  constructor(options?: { cooldownHours?: number }) {
    this.cooldownHours = options?.cooldownHours ?? 24;
  }

  /**
   * Evaluate if it's safe to resume sending
   */
  evaluate(): ResumeGateResult {
    const blockers: string[] = [];
    const warnings: string[] = [];

    // Check 1: Runtime kill switch
    const runtimeKillSwitch = getRuntimeKillSwitch();
    const runtimeKillSwitchResult = this.checkRuntimeKillSwitch(runtimeKillSwitch);
    if (runtimeKillSwitchResult.blocked) {
      blockers.push(runtimeKillSwitchResult.reason!);
    }

    // Check 2: Environment kill switch
    const envKillSwitchResult = this.checkEnvKillSwitch();
    if (envKillSwitchResult.blocked) {
      blockers.push(envKillSwitchResult.reason!);
    }

    // Check 3: ENABLE_AUTO_SEND
    const autoSendEnabledResult = this.checkAutoSendEnabled();
    if (autoSendEnabledResult.blocked) {
      blockers.push(autoSendEnabledResult.reason!);
    }

    // Check 4: Allowlist configured
    const allowlistResult = this.checkAllowlistConfigured();
    if (allowlistResult.blocked) {
      blockers.push(allowlistResult.reason!);
    }

    // Check 5: Cooldown period (auto-stop within last N hours)
    const cooldownResult = this.checkCooldownPeriod();
    if (cooldownResult.blocked) {
      blockers.push(cooldownResult.reason!);
    }

    // Check 6: Reply rate recovered
    const replyRateResult = this.checkReplyRateRecovered();
    if (replyRateResult.blocked) {
      // This is a warning, not a blocker (can be overridden with --force)
      warnings.push(replyRateResult.reason!);
    }

    // Check 7: No open incident
    const openIncidentResult = this.checkNoOpenIncident();
    if (openIncidentResult.blocked) {
      // Warning - there's still an open incident
      warnings.push(openIncidentResult.reason!);
    }

    return {
      ok: blockers.length === 0,
      blockers,
      warnings,
      checkResults: {
        runtimeKillSwitch: runtimeKillSwitchResult,
        envKillSwitch: envKillSwitchResult,
        autoSendEnabled: autoSendEnabledResult,
        allowlistConfigured: allowlistResult,
        cooldownPeriod: cooldownResult,
        replyRateRecovered: replyRateResult,
        noOpenIncident: openIncidentResult,
      },
    };
  }

  /**
   * Check runtime kill switch
   */
  private checkRuntimeKillSwitch(
    killSwitch: ReturnType<typeof getRuntimeKillSwitch>
  ): { blocked: boolean; reason?: string } {
    if (killSwitch.isEnabled()) {
      const state = killSwitch.getState();
      return {
        blocked: true,
        reason: `RuntimeKillSwitch is ON: ${state?.reason || 'unknown reason'}`,
      };
    }
    return { blocked: false };
  }

  /**
   * Check environment kill switch
   */
  private checkEnvKillSwitch(): { blocked: boolean; reason?: string } {
    if (process.env.KILL_SWITCH === 'true') {
      return {
        blocked: true,
        reason: 'Environment KILL_SWITCH=true is set',
      };
    }
    return { blocked: false };
  }

  /**
   * Check ENABLE_AUTO_SEND
   */
  private checkAutoSendEnabled(): { blocked: boolean; reason?: string } {
    if (process.env.ENABLE_AUTO_SEND !== 'true') {
      return {
        blocked: true,
        reason: 'ENABLE_AUTO_SEND is not set to true',
      };
    }
    return { blocked: false };
  }

  /**
   * Check allowlist configured
   */
  private checkAllowlistConfigured(): { blocked: boolean; reason?: string } {
    const sendPolicy = getSendPolicy();
    const config = sendPolicy.getConfig();

    const hasAllowlist =
      (config.allowlistDomains && config.allowlistDomains.length > 0) ||
      (config.allowlistEmails && config.allowlistEmails.length > 0);

    if (!hasAllowlist) {
      return {
        blocked: true,
        reason: 'No allowlist configured (SEND_ALLOWLIST_DOMAINS or SEND_ALLOWLIST_EMAILS)',
      };
    }
    return { blocked: false };
  }

  /**
   * Check cooldown period (auto-stop within last N hours)
   */
  private checkCooldownPeriod(): { blocked: boolean; reason?: string } {
    const metricsStore = getMetricsStore();
    const cooldownStart = new Date();
    cooldownStart.setHours(cooldownStart.getHours() - this.cooldownHours);
    const cooldownStartStr = cooldownStart.toISOString();

    const events = metricsStore.readEventsSince(cooldownStartStr);

    // Check for auto-stop events
    for (const event of events) {
      if (event.eventType === 'OPS_STOP_SEND' && event.meta?.setBy === 'auto_stop') {
        return {
          blocked: true,
          reason: `Auto-stop triggered within last ${this.cooldownHours}h (at ${event.timestamp}). Wait for cooldown.`,
        };
      }
    }

    return { blocked: false };
  }

  /**
   * Check if reply rate has recovered
   */
  private checkReplyRateRecovered(): { blocked: boolean; reason?: string } {
    const autoStopPolicy = getAutoStopPolicy();
    const config = autoStopPolicy.getConfig();
    const metricsStore = getMetricsStore();

    // Get metrics for window
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - config.window_days);
    const windowStartStr = windowStart.toISOString();

    const events = metricsStore.readEventsSince(windowStartStr);

    // Aggregate
    let sent = 0;
    let replies = 0;

    for (const event of events) {
      if (event.eventType === 'AUTO_SEND_SUCCESS') {
        sent++;
      } else if (event.eventType === 'REPLY_DETECTED') {
        replies++;
      }
    }

    // If not enough data, skip this check
    if (sent < config.min_sent_total) {
      return { blocked: false };
    }

    const replyRate = sent > 0 ? replies / sent : 0;

    if (replyRate < config.reply_rate_min) {
      return {
        blocked: true,
        reason: `Reply rate still below threshold: ${(replyRate * 100).toFixed(1)}% (min: ${(config.reply_rate_min * 100).toFixed(1)}%)`,
      };
    }

    return { blocked: false };
  }

  /**
   * Check if there's an open incident
   */
  private checkNoOpenIncident(): { blocked: boolean; reason?: string } {
    const incidentManager = getIncidentManager();
    const openIncident = incidentManager.findOpenIncident();

    if (openIncident) {
      return {
        blocked: true,
        reason: `Open incident exists: ${openIncident.incident_id} (${openIncident.reason})`,
      };
    }

    return { blocked: false };
  }
}

/**
 * Singleton instance
 */
let defaultResumeGate: ResumeGate | null = null;

/**
 * Get or create default resume gate
 */
export function getResumeGate(): ResumeGate {
  if (!defaultResumeGate) {
    defaultResumeGate = new ResumeGate();
  }
  return defaultResumeGate;
}

/**
 * Reset singleton (for testing)
 */
export function resetResumeGate(): void {
  defaultResumeGate = null;
}

/**
 * Create resume gate for testing
 */
export function createTestResumeGate(options?: { cooldownHours?: number }): ResumeGate {
  return new ResumeGate(options);
}

export default ResumeGate;
