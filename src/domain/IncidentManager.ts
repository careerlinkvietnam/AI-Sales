/**
 * Incident Manager
 *
 * High-level API for incident management.
 *
 * 機能:
 * - インシデント作成（スナップショット自動収集）
 * - 既存openインシデントの再利用
 * - ノート/アクション追加
 * - ステータス更新
 *
 * 重要:
 * - PIIは一切含めない
 * - 自動再開は行わない（人間がresume-sendで実行）
 */

import {
  IncidentStore,
  getIncidentStore,
  Incident,
  IncidentSnapshot,
  IncidentTriggerType,
  IncidentCreator,
  IncidentSeverity,
  IncidentStatus,
} from '../data/IncidentStore';
import { getMetricsStore } from '../data/MetricsStore';
import { getRuntimeKillSwitch } from './RuntimeKillSwitch';
import { getRampPolicy } from './RampPolicy';
import { ExperimentEvaluator } from './ExperimentEvaluator';
import { getAutoStopPolicy } from './AutoStopPolicy';

/**
 * Incident creation payload
 */
export interface CreateIncidentPayload {
  trigger_type: IncidentTriggerType;
  created_by: IncidentCreator;
  severity: IncidentSeverity;
  reason: string;
  experiment_id?: string;
  initial_actions?: string[];
}

/**
 * Incident Manager class
 */
export class IncidentManager {
  private readonly store: IncidentStore;

  constructor(store?: IncidentStore) {
    this.store = store || getIncidentStore();
  }

  /**
   * Create a new incident with auto-collected snapshot
   *
   * If there's an existing open incident, reuse it and add a note
   */
  createIncident(payload: CreateIncidentPayload): Incident {
    // Check for existing open incident
    const existingOpen = this.store.findOpenIncident();
    if (existingOpen) {
      // Add note about new trigger
      this.store.addNote(
        existingOpen.incident_id,
        `Additional trigger: ${payload.trigger_type} - ${payload.reason}`,
        payload.created_by
      );

      // Add any initial actions
      if (payload.initial_actions) {
        for (const action of payload.initial_actions) {
          this.store.addAction(existingOpen.incident_id, action, payload.created_by);
        }
      }

      // Return the existing incident (re-fetch to get updates)
      return this.store.getIncident(existingOpen.incident_id)!;
    }

    // Collect snapshot
    const snapshot = this.collectSnapshot();

    // Create new incident
    const now = new Date().toISOString();
    const incident: Incident = {
      incident_id: this.store.generateIncidentId(),
      created_at: now,
      created_by: payload.created_by,
      trigger_type: payload.trigger_type,
      severity: payload.severity,
      status: 'open',
      reason: payload.reason,
      experiment_id: payload.experiment_id,
      snapshot,
      actions_taken: [],
      notes: [],
      updated_at: now,
    };

    // Add initial actions
    if (payload.initial_actions) {
      for (const action of payload.initial_actions) {
        incident.actions_taken.push({
          timestamp: now,
          action,
          actor: payload.created_by,
        });
      }
    }

    this.store.createIncident(incident);
    return incident;
  }

  /**
   * Collect current system snapshot (PII-free)
   */
  private collectSnapshot(): IncidentSnapshot {
    const metricsStore = getMetricsStore();
    const runtimeKillSwitch = getRuntimeKillSwitch();
    const rampPolicy = getRampPolicy();
    const autoStopConfig = getAutoStopPolicy().getConfig();

    // Get metrics for window
    const windowDays = autoStopConfig.window_days;
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - windowDays);
    const windowStartStr = windowStart.toISOString();

    const events = metricsStore.readEventsSince(windowStartStr);

    // Aggregate metrics
    let sent = 0;
    let replies = 0;
    let blocked = 0;

    for (const event of events) {
      switch (event.eventType) {
        case 'AUTO_SEND_SUCCESS':
          sent++;
          break;
        case 'REPLY_DETECTED':
          replies++;
          break;
        case 'AUTO_SEND_BLOCKED':
          blocked++;
          break;
      }
    }

    const replyRate = sent > 0 ? replies / sent : null;
    const blockedRate = sent + blocked > 0 ? blocked / (sent + blocked) : null;

    // Get active templates
    const activeTemplates: string[] = [];
    try {
      const evaluator = new ExperimentEvaluator();
      const registry = evaluator.loadRegistry();
      for (const exp of registry.experiments) {
        if (exp.status === 'running') {
          for (const tpl of exp.templates) {
            if (tpl.status === 'active') {
              activeTemplates.push(tpl.templateId);
            }
          }
        }
      }
    } catch {
      // Registry may not exist
    }

    // Get ramp cap
    let rampCapToday: number | null = null;
    if (rampPolicy.isEnabled() && rampPolicy.getMode() === 'daily_cap') {
      rampCapToday = rampPolicy.getTodayCap();
    }

    return {
      window_days: windowDays,
      sent,
      replies,
      reply_rate: replyRate,
      blocked,
      blocked_rate: blockedRate,
      ramp_cap_today: rampCapToday,
      kill_switch_state: {
        env: process.env.KILL_SWITCH === 'true',
        runtime: runtimeKillSwitch.isEnabled(),
      },
      active_templates: activeTemplates,
    };
  }

  /**
   * List incidents with optional status filter
   */
  listIncidents(options?: { status?: IncidentStatus }): Incident[] {
    return this.store.listIncidents(options);
  }

  /**
   * Get an incident by ID
   */
  getIncident(incidentId: string): Incident | null {
    return this.store.getIncident(incidentId);
  }

  /**
   * Add a note to an incident
   */
  addNote(incidentId: string, note: string, actor: string): boolean {
    return this.store.addNote(incidentId, note, actor);
  }

  /**
   * Add an action to an incident
   */
  addAction(incidentId: string, action: string, actor: string): boolean {
    return this.store.addAction(incidentId, action, actor);
  }

  /**
   * Update incident status
   */
  updateStatus(
    incidentId: string,
    status: IncidentStatus,
    actor: string,
    reason?: string
  ): boolean {
    return this.store.updateStatus(incidentId, status, actor, reason);
  }

  /**
   * Close an incident
   */
  closeIncident(incidentId: string, actor: string, reason: string): boolean {
    return this.store.updateStatus(incidentId, 'closed', actor, reason);
  }

  /**
   * Find the most recent open incident
   */
  findOpenIncident(): Incident | null {
    return this.store.findOpenIncident();
  }

  /**
   * Check if there's an active incident (open or mitigated)
   */
  hasActiveIncident(): boolean {
    const open = this.store.listIncidents({ status: 'open' });
    const mitigated = this.store.listIncidents({ status: 'mitigated' });
    return open.length > 0 || mitigated.length > 0;
  }

  /**
   * Get the most recent incident (any status)
   */
  getMostRecentIncident(): Incident | null {
    const all = this.store.listIncidents();
    return all.length > 0 ? all[0] : null;
  }
}

/**
 * Singleton instance
 */
let defaultIncidentManager: IncidentManager | null = null;

/**
 * Get or create default incident manager
 */
export function getIncidentManager(): IncidentManager {
  if (!defaultIncidentManager) {
    defaultIncidentManager = new IncidentManager();
  }
  return defaultIncidentManager;
}

/**
 * Reset singleton (for testing)
 */
export function resetIncidentManager(): void {
  defaultIncidentManager = null;
}

/**
 * Create incident manager for testing
 */
export function createTestIncidentManager(store?: IncidentStore): IncidentManager {
  return new IncidentManager(store);
}

export default IncidentManager;
