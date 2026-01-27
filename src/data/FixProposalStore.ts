/**
 * Fix Proposal Store
 *
 * Stores fix proposals generated from incident analysis.
 * Append-only NDJSON format for durability.
 *
 * 重要:
 * - PIIは保存禁止
 * - 自動適用は禁止（提案のみ）
 * - proposal_id, incident_id などの識別子のみ
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Proposal priority
 */
export type ProposalPriority = 'P0' | 'P1' | 'P2';

/**
 * Proposal status
 */
export type ProposalStatus = 'proposed' | 'accepted' | 'rejected' | 'implemented';

/**
 * Proposal source (what triggered the proposal)
 */
export interface ProposalSource {
  report_since: string;
  top_categories: string[];
}

/**
 * Proposal rationale (why this proposal)
 */
export interface ProposalRationale {
  incident_count: number;
  recent_examples?: string[]; // incident IDs only (no PII)
}

/**
 * Related artifacts (files and commands to check/modify)
 */
export interface RelatedArtifacts {
  files?: string[];
  commands?: string[];
}

/**
 * Fix Proposal record (PII-free)
 */
export interface FixProposal {
  proposal_id: string;
  created_at: string;
  created_by: 'auto' | 'operator';
  source: ProposalSource;
  category_id: string;
  priority: ProposalPriority;
  title: string;
  recommended_steps: string[];
  related_artifacts: RelatedArtifacts;
  status: ProposalStatus;
  rationale: ProposalRationale;
  updated_at: string;
  accepted_by?: string;
  accepted_at?: string;
  rejected_by?: string;
  rejected_at?: string;
  rejection_reason?: string;
  implemented_by?: string;
  implemented_at?: string;
}

/**
 * Default data directory and file
 */
const DEFAULT_DATA_DIR = 'data';
const DEFAULT_PROPOSALS_FILE = 'fix_proposals.ndjson';

/**
 * Fix Proposal Store class
 */
export class FixProposalStore {
  private readonly filePath: string;
  private proposals: Map<string, FixProposal> = new Map();

  constructor(filePath?: string) {
    this.filePath =
      filePath || path.join(DEFAULT_DATA_DIR, DEFAULT_PROPOSALS_FILE);
    this.loadFromFile();
  }

  /**
   * Load proposals from file
   */
  private loadFromFile(): void {
    this.proposals.clear();

    if (!fs.existsSync(this.filePath)) {
      return;
    }

    try {
      const content = fs.readFileSync(this.filePath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());

      for (const line of lines) {
        try {
          const proposal = JSON.parse(line) as FixProposal;
          // Always use the latest version of each proposal (append-only)
          this.proposals.set(proposal.proposal_id, proposal);
        } catch {
          // Skip invalid lines
        }
      }
    } catch {
      // File doesn't exist or can't be read
    }
  }

  /**
   * Append proposal to file
   */
  private appendToFile(proposal: FixProposal): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const line = JSON.stringify(proposal) + '\n';
    fs.appendFileSync(this.filePath, line, 'utf-8');
  }

  /**
   * Generate a new proposal ID
   */
  generateProposalId(): string {
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const uuid = crypto.randomUUID().substring(0, 8);
    return `FIX-${date}-${uuid}`;
  }

  /**
   * Create a new proposal
   */
  createProposal(proposal: FixProposal): void {
    this.proposals.set(proposal.proposal_id, proposal);
    this.appendToFile(proposal);
  }

  /**
   * Get a proposal by ID
   */
  getProposal(proposalId: string): FixProposal | null {
    return this.proposals.get(proposalId) || null;
  }

  /**
   * List all proposals
   */
  listProposals(filter?: { status?: ProposalStatus }): FixProposal[] {
    let result = Array.from(this.proposals.values());

    if (filter?.status) {
      result = result.filter((p) => p.status === filter.status);
    }

    // Sort by created_at descending
    result.sort((a, b) => b.created_at.localeCompare(a.created_at));

    return result;
  }

  /**
   * Update proposal status
   */
  updateStatus(
    proposalId: string,
    status: ProposalStatus,
    actor: string,
    reason?: string
  ): boolean {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      return false;
    }

    const now = new Date().toISOString();
    const updated: FixProposal = {
      ...proposal,
      status,
      updated_at: now,
    };

    // Set status-specific fields
    switch (status) {
      case 'accepted':
        updated.accepted_by = actor;
        updated.accepted_at = now;
        break;
      case 'rejected':
        updated.rejected_by = actor;
        updated.rejected_at = now;
        updated.rejection_reason = reason;
        break;
      case 'implemented':
        updated.implemented_by = actor;
        updated.implemented_at = now;
        break;
    }

    this.proposals.set(proposalId, updated);
    this.appendToFile(updated);

    return true;
  }

  /**
   * Find recent proposals for a category
   */
  findRecentProposals(categoryId: string, days: number = 7): FixProposal[] {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString();

    return this.listProposals().filter(
      (p) => p.category_id === categoryId && p.created_at >= cutoffStr
    );
  }

  /**
   * Check if a similar proposal already exists (to avoid duplicates)
   */
  hasSimilarProposal(categoryId: string, days: number = 7): boolean {
    const recent = this.findRecentProposals(categoryId, days);
    return recent.some((p) => p.status === 'proposed' || p.status === 'accepted');
  }
}

/**
 * Singleton instance
 */
let defaultStore: FixProposalStore | null = null;

/**
 * Get or create default store
 */
export function getFixProposalStore(): FixProposalStore {
  if (!defaultStore) {
    defaultStore = new FixProposalStore();
  }
  return defaultStore;
}

/**
 * Reset singleton (for testing)
 */
export function resetFixProposalStore(): void {
  defaultStore = null;
}

/**
 * Create store for testing
 */
export function createTestFixProposalStore(filePath: string): FixProposalStore {
  return new FixProposalStore(filePath);
}

export default FixProposalStore;
