/**
 * Fix Proposal Manager
 *
 * Manages fix proposal state by replaying events.
 * Provides API for state transitions with validation.
 *
 * 重要:
 * - PIIは使用しない
 * - 状態はeventsをリプレイして算出
 * - 不正な状態遷移は拒否
 */

import {
  FixProposal,
  ProposalStatus,
  getFixProposalStore,
  FixProposalStore,
} from '../data/FixProposalStore';
import {
  FixProposalEvent,
  FixProposalEventStore,
  getFixProposalEventStore,
  ProposalEventAction,
  EventLinks,
} from '../data/FixProposalEventStore';

/**
 * Proposal with computed status and history
 */
export interface ProposalWithHistory {
  proposal: FixProposal;
  status: ProposalStatus;
  history: FixProposalEvent[];
}

/**
 * Proposal summary for listing
 */
export interface ProposalSummary {
  proposal_id: string;
  status: ProposalStatus;
  category_id: string;
  priority: string;
  title: string;
  created_at: string;
  incident_count: number;
}

/**
 * Add event result
 */
export interface AddEventResult {
  success: boolean;
  error?: string;
  event?: FixProposalEvent;
  newStatus?: ProposalStatus;
}

/**
 * Invalid transition error messages
 */
const TRANSITION_ERRORS: Record<string, string> = {
  'rejected_ACCEPT': '却下済みの提案を承認することはできません',
  'rejected_IMPLEMENT': '却下済みの提案を実装済みにすることはできません',
  'implemented_ACCEPT': '実装済みの提案を再度承認することはできません',
  'implemented_REJECT': '実装済みの提案を却下することはできません',
  'accepted_REJECT': '承認済みの提案を却下することはできません',
  'proposed_IMPLEMENT': '承認されていない提案を実装済みにすることはできません',
};

/**
 * Fix Proposal Manager class
 */
export class FixProposalManager {
  private readonly proposalStore: FixProposalStore;
  private readonly eventStore: FixProposalEventStore;

  constructor(options?: {
    proposalStore?: FixProposalStore;
    eventStore?: FixProposalEventStore;
  }) {
    this.proposalStore = options?.proposalStore || getFixProposalStore();
    this.eventStore = options?.eventStore || getFixProposalEventStore();
  }

  /**
   * Compute status from events
   */
  private computeStatus(events: FixProposalEvent[]): ProposalStatus {
    let status: ProposalStatus = 'proposed';

    for (const event of events) {
      switch (event.action) {
        case 'ACCEPT':
          status = 'accepted';
          break;
        case 'REJECT':
          status = 'rejected';
          break;
        case 'IMPLEMENT':
          status = 'implemented';
          break;
        // NOTE does not change status
      }
    }

    return status;
  }

  /**
   * Validate state transition
   */
  private validateTransition(
    currentStatus: ProposalStatus,
    action: ProposalEventAction
  ): { valid: boolean; error?: string } {
    // NOTE is always valid
    if (action === 'NOTE') {
      return { valid: true };
    }

    const key = `${currentStatus}_${action}`;
    if (TRANSITION_ERRORS[key]) {
      return { valid: false, error: TRANSITION_ERRORS[key] };
    }

    return { valid: true };
  }

  /**
   * Get proposal with computed status and history
   */
  getProposal(proposalId: string): ProposalWithHistory | null {
    const proposal = this.proposalStore.getProposal(proposalId);
    if (!proposal) {
      return null;
    }

    const events = this.eventStore.getEventsForProposal(proposalId);
    const status = this.computeStatus(events);

    return {
      proposal,
      status,
      history: events,
    };
  }

  /**
   * List proposals with computed status
   */
  listProposals(filter?: { status?: ProposalStatus }): ProposalSummary[] {
    // Get all proposals
    const proposals = this.proposalStore.listProposals();

    // Compute status for each
    const summaries: ProposalSummary[] = proposals.map((p) => {
      const events = this.eventStore.getEventsForProposal(p.proposal_id);
      const status = this.computeStatus(events);

      return {
        proposal_id: p.proposal_id,
        status,
        category_id: p.category_id,
        priority: p.priority,
        title: p.title,
        created_at: p.created_at,
        incident_count: p.rationale.incident_count,
      };
    });

    // Filter by status if requested
    if (filter?.status) {
      return summaries.filter((s) => s.status === filter.status);
    }

    return summaries;
  }

  /**
   * Add an event (with validation)
   */
  addEvent(
    proposalId: string,
    action: ProposalEventAction,
    actor: string,
    reason: string,
    links?: EventLinks
  ): AddEventResult {
    // Check proposal exists
    const proposal = this.proposalStore.getProposal(proposalId);
    if (!proposal) {
      return { success: false, error: '提案が見つかりません' };
    }

    // Get current status
    const events = this.eventStore.getEventsForProposal(proposalId);
    const currentStatus = this.computeStatus(events);

    // Validate transition
    const validation = this.validateTransition(currentStatus, action);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // Create event
    const event = this.eventStore.createEvent({
      proposal_id: proposalId,
      action,
      actor,
      reason,
      links,
    });

    // Compute new status
    const newEvents = [...events, event];
    const newStatus = this.computeStatus(newEvents);

    return {
      success: true,
      event,
      newStatus,
    };
  }

  /**
   * Accept a proposal
   */
  accept(
    proposalId: string,
    actor: string,
    reason: string,
    links?: EventLinks
  ): AddEventResult {
    return this.addEvent(proposalId, 'ACCEPT', actor, reason, links);
  }

  /**
   * Reject a proposal
   */
  reject(
    proposalId: string,
    actor: string,
    reason: string
  ): AddEventResult {
    return this.addEvent(proposalId, 'REJECT', actor, reason);
  }

  /**
   * Mark proposal as implemented
   */
  implement(
    proposalId: string,
    actor: string,
    reason: string,
    links?: EventLinks
  ): AddEventResult {
    return this.addEvent(proposalId, 'IMPLEMENT', actor, reason, links);
  }

  /**
   * Add a note to a proposal
   */
  addNote(
    proposalId: string,
    actor: string,
    note: string
  ): AddEventResult {
    return this.addEvent(proposalId, 'NOTE', actor, note);
  }

  /**
   * Get proposals by status (convenience method)
   */
  getProposedProposals(): ProposalSummary[] {
    return this.listProposals({ status: 'proposed' });
  }

  /**
   * Get accepted proposals awaiting implementation
   */
  getAcceptedProposals(): ProposalSummary[] {
    return this.listProposals({ status: 'accepted' });
  }
}

/**
 * Singleton instance
 */
let defaultManager: FixProposalManager | null = null;

/**
 * Get or create default manager
 */
export function getFixProposalManager(): FixProposalManager {
  if (!defaultManager) {
    defaultManager = new FixProposalManager();
  }
  return defaultManager;
}

/**
 * Reset singleton (for testing)
 */
export function resetFixProposalManager(): void {
  defaultManager = null;
}

/**
 * Create manager for testing
 */
export function createTestFixProposalManager(options: {
  proposalStore: FixProposalStore;
  eventStore: FixProposalEventStore;
}): FixProposalManager {
  return new FixProposalManager(options);
}

export default FixProposalManager;
