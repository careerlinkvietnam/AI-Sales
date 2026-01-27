/**
 * Incident Store
 *
 * Stores incident records for operational tracking (PII-free).
 *
 * 設計:
 * - data/incidents.ndjson に追記（append-only）
 * - 競合しても壊れない（各行が独立したJSONレコード）
 * - PIIは一切保存しない
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Incident trigger types
 */
export type IncidentTriggerType = 'AUTO_STOP' | 'OPS_STOP_SEND' | 'OPS_ROLLBACK';

/**
 * Incident creator types
 */
export type IncidentCreator = 'auto_stop' | 'operator';

/**
 * Incident severity
 */
export type IncidentSeverity = 'warn' | 'error';

/**
 * Incident status
 */
export type IncidentStatus = 'open' | 'mitigated' | 'closed';

/**
 * Incident snapshot (PII-free metrics at time of incident)
 */
export interface IncidentSnapshot {
  window_days: number;
  sent: number;
  replies: number;
  reply_rate: number | null;
  blocked: number;
  blocked_rate: number | null;
  ramp_cap_today: number | null;
  kill_switch_state: {
    env: boolean;
    runtime: boolean;
  };
  active_templates: string[];
}

/**
 * Incident action record
 */
export interface IncidentAction {
  timestamp: string;
  action: string;
  actor: string;
}

/**
 * Incident note record
 */
export interface IncidentNote {
  timestamp: string;
  note: string;
  actor: string;
}

/**
 * Incident record (PII-free)
 */
export interface Incident {
  incident_id: string;
  created_at: string;
  created_by: IncidentCreator;
  trigger_type: IncidentTriggerType;
  severity: IncidentSeverity;
  status: IncidentStatus;
  reason: string;
  experiment_id?: string;
  snapshot: IncidentSnapshot;
  actions_taken: IncidentAction[];
  notes: IncidentNote[];
  updated_at: string;
  closed_at?: string;
  closed_by?: string;
  close_reason?: string;
}

/**
 * Incident store record (what's stored in NDJSON)
 */
interface IncidentStoreRecord {
  type: 'incident_created' | 'incident_updated' | 'note_added' | 'action_added';
  timestamp: string;
  incident_id: string;
  data: Partial<Incident> | IncidentNote | IncidentAction;
}

/**
 * Default incidents file path
 */
const DEFAULT_INCIDENTS_PATH = path.join('data', 'incidents.ndjson');

/**
 * Incident Store class
 */
export class IncidentStore {
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath || DEFAULT_INCIDENTS_PATH;
  }

  /**
   * Generate a new incident ID
   */
  generateIncidentId(): string {
    return crypto.randomUUID();
  }

  /**
   * Append a record to the store
   */
  private appendRecord(record: IncidentStoreRecord): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.appendFileSync(
      this.filePath,
      JSON.stringify(record) + '\n',
      'utf-8'
    );
  }

  /**
   * Read all records from the store
   */
  private readAllRecords(): IncidentStoreRecord[] {
    if (!fs.existsSync(this.filePath)) {
      return [];
    }

    const content = fs.readFileSync(this.filePath, 'utf-8');
    const lines = content.split('\n').filter((line) => line.trim());
    const records: IncidentStoreRecord[] = [];

    for (const line of lines) {
      try {
        records.push(JSON.parse(line));
      } catch {
        // Skip malformed lines
        continue;
      }
    }

    return records;
  }

  /**
   * Rebuild incidents from records
   */
  private rebuildIncidents(): Map<string, Incident> {
    const records = this.readAllRecords();
    const incidents = new Map<string, Incident>();

    for (const record of records) {
      if (record.type === 'incident_created') {
        const incident = record.data as Incident;
        incidents.set(record.incident_id, incident);
      } else if (record.type === 'incident_updated') {
        const existing = incidents.get(record.incident_id);
        if (existing) {
          Object.assign(existing, record.data);
        }
      } else if (record.type === 'note_added') {
        const existing = incidents.get(record.incident_id);
        if (existing) {
          existing.notes.push(record.data as IncidentNote);
          existing.updated_at = record.timestamp;
        }
      } else if (record.type === 'action_added') {
        const existing = incidents.get(record.incident_id);
        if (existing) {
          existing.actions_taken.push(record.data as IncidentAction);
          existing.updated_at = record.timestamp;
        }
      }
    }

    return incidents;
  }

  /**
   * Create a new incident
   */
  createIncident(incident: Incident): void {
    const record: IncidentStoreRecord = {
      type: 'incident_created',
      timestamp: incident.created_at,
      incident_id: incident.incident_id,
      data: incident,
    };

    this.appendRecord(record);
  }

  /**
   * Get an incident by ID
   */
  getIncident(incidentId: string): Incident | null {
    const incidents = this.rebuildIncidents();
    return incidents.get(incidentId) || null;
  }

  /**
   * List incidents with optional status filter
   */
  listIncidents(options?: { status?: IncidentStatus }): Incident[] {
    const incidents = this.rebuildIncidents();
    let result = Array.from(incidents.values());

    if (options?.status) {
      result = result.filter((i) => i.status === options.status);
    }

    // Sort by created_at descending (newest first)
    result.sort((a, b) => b.created_at.localeCompare(a.created_at));

    return result;
  }

  /**
   * Find the most recent open incident
   */
  findOpenIncident(): Incident | null {
    const openIncidents = this.listIncidents({ status: 'open' });
    return openIncidents.length > 0 ? openIncidents[0] : null;
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
    const incident = this.getIncident(incidentId);
    if (!incident) {
      return false;
    }

    const now = new Date().toISOString();
    const updateData: Partial<Incident> = {
      status,
      updated_at: now,
    };

    if (status === 'closed') {
      updateData.closed_at = now;
      updateData.closed_by = actor;
      if (reason) {
        updateData.close_reason = reason;
      }
    }

    const record: IncidentStoreRecord = {
      type: 'incident_updated',
      timestamp: now,
      incident_id: incidentId,
      data: updateData,
    };

    this.appendRecord(record);
    return true;
  }

  /**
   * Add a note to an incident
   */
  addNote(incidentId: string, note: string, actor: string): boolean {
    const incident = this.getIncident(incidentId);
    if (!incident) {
      return false;
    }

    const now = new Date().toISOString();
    const noteRecord: IncidentNote = {
      timestamp: now,
      note,
      actor,
    };

    const record: IncidentStoreRecord = {
      type: 'note_added',
      timestamp: now,
      incident_id: incidentId,
      data: noteRecord,
    };

    this.appendRecord(record);
    return true;
  }

  /**
   * Add an action to an incident
   */
  addAction(incidentId: string, action: string, actor: string): boolean {
    const incident = this.getIncident(incidentId);
    if (!incident) {
      return false;
    }

    const now = new Date().toISOString();
    const actionRecord: IncidentAction = {
      timestamp: now,
      action,
      actor,
    };

    const record: IncidentStoreRecord = {
      type: 'action_added',
      timestamp: now,
      incident_id: incidentId,
      data: actionRecord,
    };

    this.appendRecord(record);
    return true;
  }

  /**
   * Get file path (for testing)
   */
  getFilePath(): string {
    return this.filePath;
  }
}

/**
 * Singleton instance
 */
let defaultIncidentStore: IncidentStore | null = null;

/**
 * Get or create default incident store
 */
export function getIncidentStore(): IncidentStore {
  if (!defaultIncidentStore) {
    defaultIncidentStore = new IncidentStore();
  }
  return defaultIncidentStore;
}

/**
 * Reset singleton (for testing)
 */
export function resetIncidentStore(): void {
  defaultIncidentStore = null;
}

/**
 * Create incident store for testing
 */
export function createTestIncidentStore(filePath?: string): IncidentStore {
  return new IncidentStore(filePath);
}

export default IncidentStore;
