/**
 * Fix Proposal Event Store
 *
 * Stores state transition events for fix proposals.
 * Append-only NDJSON format - proposal state is computed by replaying events.
 *
 * 重要:
 * - PIIは保存禁止
 * - イベントは追記のみ（削除・更新禁止）
 * - 状態はイベントのリプレイで算出
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Event action types
 */
export type ProposalEventAction = 'ACCEPT' | 'REJECT' | 'IMPLEMENT' | 'NOTE';

/**
 * Event links (optional references to external resources)
 */
export interface EventLinks {
  ticket?: string;
  pr?: string;
  commit?: string;
}

/**
 * Fix Proposal Event record (PII-free)
 */
export interface FixProposalEvent {
  event_id: string;
  timestamp: string;
  proposal_id: string;
  action: ProposalEventAction;
  actor: string;
  reason: string;
  links?: EventLinks;
}

/**
 * Default data directory and file
 */
const DEFAULT_DATA_DIR = 'data';
const DEFAULT_EVENTS_FILE = 'fix_proposal_events.ndjson';

/**
 * Fix Proposal Event Store class
 */
export class FixProposalEventStore {
  private readonly filePath: string;
  private events: FixProposalEvent[] = [];

  constructor(filePath?: string) {
    this.filePath =
      filePath || path.join(DEFAULT_DATA_DIR, DEFAULT_EVENTS_FILE);
    this.loadFromFile();
  }

  /**
   * Load events from file
   */
  private loadFromFile(): void {
    this.events = [];

    if (!fs.existsSync(this.filePath)) {
      return;
    }

    try {
      const content = fs.readFileSync(this.filePath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());

      for (const line of lines) {
        try {
          const event = JSON.parse(line) as FixProposalEvent;
          this.events.push(event);
        } catch {
          // Skip invalid lines
        }
      }
    } catch {
      // File doesn't exist or can't be read
    }
  }

  /**
   * Append event to file
   */
  private appendToFile(event: FixProposalEvent): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const line = JSON.stringify(event) + '\n';
    fs.appendFileSync(this.filePath, line, 'utf-8');
  }

  /**
   * Generate a new event ID
   */
  generateEventId(): string {
    return crypto.randomUUID();
  }

  /**
   * Add an event
   */
  addEvent(event: FixProposalEvent): void {
    this.events.push(event);
    this.appendToFile(event);
  }

  /**
   * Create and add an event
   */
  createEvent(params: {
    proposal_id: string;
    action: ProposalEventAction;
    actor: string;
    reason: string;
    links?: EventLinks;
  }): FixProposalEvent {
    const event: FixProposalEvent = {
      event_id: this.generateEventId(),
      timestamp: new Date().toISOString(),
      proposal_id: params.proposal_id,
      action: params.action,
      actor: params.actor,
      reason: params.reason,
      links: params.links,
    };

    this.addEvent(event);
    return event;
  }

  /**
   * Get all events for a proposal
   */
  getEventsForProposal(proposalId: string): FixProposalEvent[] {
    return this.events
      .filter((e) => e.proposal_id === proposalId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  /**
   * Get all events
   */
  getAllEvents(): FixProposalEvent[] {
    return [...this.events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  /**
   * Reload from file (for testing)
   */
  reload(): void {
    this.loadFromFile();
  }

  /**
   * Get file path
   */
  getFilePath(): string {
    return this.filePath;
  }
}

/**
 * Singleton instance
 */
let defaultStore: FixProposalEventStore | null = null;

/**
 * Get or create default store
 */
export function getFixProposalEventStore(): FixProposalEventStore {
  if (!defaultStore) {
    defaultStore = new FixProposalEventStore();
  }
  return defaultStore;
}

/**
 * Reset singleton (for testing)
 */
export function resetFixProposalEventStore(): void {
  defaultStore = null;
}

/**
 * Create store for testing
 */
export function createTestFixProposalEventStore(filePath: string): FixProposalEventStore {
  return new FixProposalEventStore(filePath);
}

export default FixProposalEventStore;
