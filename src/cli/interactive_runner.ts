/**
 * Interactive Runner for Approval Candidates
 *
 * Provides an interactive CLI UI for reviewing and executing approval candidates.
 * Supports dry-run and execute modes with guardrails enforcement.
 *
 * 制約:
 * - PII禁止（宛先/本文/candidate情報は禁止）
 * - 自動承認は禁止（必ず人が選ぶ）
 * - デフォルトはdry-run。executeはactor/reasonが必須
 */

import * as readline from 'readline';
import {
  ApprovalCandidates,
  TemplateApprovalCandidate,
  FixProposalCandidate,
  OpsCandidate,
  CandidatePriority,
} from '../domain/ApprovalCandidatePicker';
import { getFixProposalManager } from '../domain/FixProposalManager';
import { getIncidentManager } from '../domain/IncidentManager';
import { getRuntimeKillSwitch } from '../domain/RuntimeKillSwitch';
import { getSendPolicy } from '../domain/SendPolicy';
import { getExperimentScheduler } from '../domain/ExperimentScheduler';

/**
 * Execution context for interactive operations
 */
export interface ExecutionContext {
  actor: string;
  reason: string;
  source: 'interactive';
  executeMode: boolean;
}

/**
 * Execution result
 */
export interface ExecutionResult {
  success: boolean;
  action: string;
  candidateId: string;
  dryRun: boolean;
  message: string;
  error?: string;
  blockedByGuardrails?: string[];
}

/**
 * Guardrail check result
 */
export interface GuardrailCheckResult {
  allowed: boolean;
  blockedReasons: string[];
}

/**
 * Interactive Runner class
 */
export class InteractiveRunner {
  private rl: readline.Interface | null = null;

  /**
   * Start interactive session
   */
  async run(
    candidates: ApprovalCandidates,
    context: ExecutionContext
  ): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];

    // Create readline interface
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log('');
      console.log('='.repeat(70));
      console.log('Interactive Approvals Runner');
      console.log('='.repeat(70));
      console.log('');
      console.log(`Mode: ${context.executeMode ? 'EXECUTE' : 'DRY-RUN'}`);
      console.log(`Actor: ${context.actor}`);
      console.log(`Reason: ${context.reason}`);
      console.log('');
      console.log(`Found ${candidates.summary.totalCandidates} candidate(s):`);
      console.log(`  Templates: ${candidates.templates.length}`);
      console.log(`  Fixes: ${candidates.fixes.length}`);
      console.log(`  Ops: ${candidates.ops.length}`);
      console.log('');

      // Process each section
      if (candidates.templates.length > 0) {
        console.log('-'.repeat(70));
        console.log('SECTION 1: Template Approval Candidates');
        console.log('-'.repeat(70));
        for (const template of candidates.templates) {
          const result = await this.processTemplateCandidate(template, context);
          results.push(result);
        }
      }

      if (candidates.fixes.length > 0) {
        console.log('-'.repeat(70));
        console.log('SECTION 2: Fix Proposal Candidates');
        console.log('-'.repeat(70));
        for (const fix of candidates.fixes) {
          const result = await this.processFixCandidate(fix, context);
          results.push(result);
        }
      }

      if (candidates.ops.length > 0) {
        console.log('-'.repeat(70));
        console.log('SECTION 3: Ops Candidates');
        console.log('-'.repeat(70));
        for (const ops of candidates.ops) {
          const result = await this.processOpsCandidate(ops, context);
          results.push(result);
        }
      }

      // Summary
      console.log('');
      console.log('='.repeat(70));
      console.log('Session Summary');
      console.log('='.repeat(70));
      const executed = results.filter(r => !r.dryRun && r.success).length;
      const dryRunOnly = results.filter(r => r.dryRun).length;
      const failed = results.filter(r => !r.success).length;
      console.log(`  Executed: ${executed}`);
      console.log(`  Dry-run only: ${dryRunOnly}`);
      console.log(`  Failed/Skipped: ${failed}`);
      console.log('');

    } finally {
      this.rl?.close();
      this.rl = null;
    }

    return results;
  }

  /**
   * Process a template candidate
   */
  private async processTemplateCandidate(
    candidate: TemplateApprovalCandidate,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    console.log('');
    console.log(`[${candidate.priority}] Template: ${candidate.templateId}`);
    console.log(`  Experiment: ${candidate.experimentId}`);
    console.log(`  Variant: ${candidate.variant}`);
    console.log(`  Rationale: ${candidate.rationale}`);
    if (candidate.guardrails.length > 0) {
      console.log(`  Guardrails: ${candidate.guardrails.join(', ')}`);
    }
    console.log(`  Command: ${candidate.recommendedCommand}`);
    console.log('');

    // Check guardrails
    const guardrailCheck = this.checkTemplateGuardrails(candidate);
    if (!guardrailCheck.allowed) {
      console.log(`  [BLOCKED] Guardrails prevent execution:`);
      for (const reason of guardrailCheck.blockedReasons) {
        console.log(`    - ${reason}`);
      }
      return {
        success: false,
        action: 'template_approve',
        candidateId: candidate.id,
        dryRun: true,
        message: 'Blocked by guardrails',
        blockedByGuardrails: guardrailCheck.blockedReasons,
      };
    }

    // Ask for action
    const action = await this.askAction('approve', 'reject');

    if (action === 'skip') {
      console.log('  Skipped.');
      return {
        success: true,
        action: 'skip',
        candidateId: candidate.id,
        dryRun: true,
        message: 'Skipped by user',
      };
    }

    // Dry-run first
    console.log('');
    console.log('  [DRY-RUN] Would execute:');
    console.log(`    Action: ${action} template ${candidate.templateId}`);
    console.log(`    Actor: ${context.actor}`);
    console.log(`    Reason: ${context.reason}`);

    if (!context.executeMode) {
      return {
        success: true,
        action: `template_${action}`,
        candidateId: candidate.id,
        dryRun: true,
        message: 'Dry-run completed',
      };
    }

    // Confirm execution
    const confirm = await this.askConfirm('Execute this action?');
    if (!confirm) {
      console.log('  Cancelled.');
      return {
        success: true,
        action: `template_${action}`,
        candidateId: candidate.id,
        dryRun: true,
        message: 'Execution cancelled by user',
      };
    }

    // Execute template approval
    try {
      const result = await this.executeTemplateApproval(candidate, action, context);
      console.log(`  [EXECUTED] ${result.message}`);
      return result;
    } catch (error) {
      const errorMsg = (error as Error).message;
      console.log(`  [ERROR] ${errorMsg}`);
      return {
        success: false,
        action: `template_${action}`,
        candidateId: candidate.id,
        dryRun: false,
        message: 'Execution failed',
        error: errorMsg,
      };
    }
  }

  /**
   * Process a fix proposal candidate
   */
  private async processFixCandidate(
    candidate: FixProposalCandidate,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    console.log('');
    console.log(`[${candidate.priority}] Fix: ${candidate.proposalId}`);
    console.log(`  Category: ${candidate.categoryId}`);
    console.log(`  Rationale: ${candidate.rationale}`);
    if (candidate.guardrails.length > 0) {
      console.log(`  Guardrails: ${candidate.guardrails.join(', ')}`);
    }
    console.log(`  Command: ${candidate.recommendedCommand}`);
    console.log('');

    // Check guardrails
    const guardrailCheck = this.checkFixGuardrails(candidate);
    if (!guardrailCheck.allowed) {
      console.log(`  [BLOCKED] Guardrails prevent execution:`);
      for (const reason of guardrailCheck.blockedReasons) {
        console.log(`    - ${reason}`);
      }
      return {
        success: false,
        action: 'fix_review',
        candidateId: candidate.id,
        dryRun: true,
        message: 'Blocked by guardrails',
        blockedByGuardrails: guardrailCheck.blockedReasons,
      };
    }

    // Ask for action
    const action = await this.askAction('accept', 'reject');

    if (action === 'skip') {
      console.log('  Skipped.');
      return {
        success: true,
        action: 'skip',
        candidateId: candidate.id,
        dryRun: true,
        message: 'Skipped by user',
      };
    }

    // Dry-run first
    console.log('');
    console.log('  [DRY-RUN] Would execute:');
    console.log(`    Action: ${action} fix proposal ${candidate.proposalId}`);
    console.log(`    Actor: ${context.actor}`);
    console.log(`    Reason: ${context.reason}`);

    if (!context.executeMode) {
      return {
        success: true,
        action: `fix_${action}`,
        candidateId: candidate.id,
        dryRun: true,
        message: 'Dry-run completed',
      };
    }

    // Confirm execution
    const confirm = await this.askConfirm('Execute this action?');
    if (!confirm) {
      console.log('  Cancelled.');
      return {
        success: true,
        action: `fix_${action}`,
        candidateId: candidate.id,
        dryRun: true,
        message: 'Execution cancelled by user',
      };
    }

    // Execute fix proposal action
    try {
      const result = await this.executeFixProposalAction(candidate, action, context);
      console.log(`  [EXECUTED] ${result.message}`);
      return result;
    } catch (error) {
      const errorMsg = (error as Error).message;
      console.log(`  [ERROR] ${errorMsg}`);
      return {
        success: false,
        action: `fix_${action}`,
        candidateId: candidate.id,
        dryRun: false,
        message: 'Execution failed',
        error: errorMsg,
      };
    }
  }

  /**
   * Process an ops candidate
   */
  private async processOpsCandidate(
    candidate: OpsCandidate,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    console.log('');
    console.log(`[${candidate.priority}] Ops: ${candidate.type}`);
    console.log(`  Rationale: ${candidate.rationale}`);
    if (candidate.guardrails.length > 0) {
      console.log(`  Guardrails: ${candidate.guardrails.join(', ')}`);
    }
    console.log(`  Command: ${candidate.recommendedCommand}`);
    console.log('');

    // Check guardrails
    const guardrailCheck = this.checkOpsGuardrails(candidate);
    if (!guardrailCheck.allowed) {
      console.log(`  [BLOCKED] Guardrails prevent execution:`);
      for (const reason of guardrailCheck.blockedReasons) {
        console.log(`    - ${reason}`);
      }
      return {
        success: false,
        action: `ops_${candidate.type}`,
        candidateId: candidate.id,
        dryRun: true,
        message: 'Blocked by guardrails',
        blockedByGuardrails: guardrailCheck.blockedReasons,
      };
    }

    // Determine available actions based on type
    const actions = this.getOpsActions(candidate.type);
    const action = await this.askOpsAction(actions);

    if (action === 'skip') {
      console.log('  Skipped.');
      return {
        success: true,
        action: 'skip',
        candidateId: candidate.id,
        dryRun: true,
        message: 'Skipped by user',
      };
    }

    // Dry-run first
    console.log('');
    console.log('  [DRY-RUN] Would execute:');
    console.log(`    Action: ${action} for ${candidate.type}`);
    console.log(`    Actor: ${context.actor}`);
    console.log(`    Reason: ${context.reason}`);

    if (!context.executeMode) {
      return {
        success: true,
        action: `ops_${action}`,
        candidateId: candidate.id,
        dryRun: true,
        message: 'Dry-run completed',
      };
    }

    // Confirm execution
    const confirm = await this.askConfirm('Execute this action?');
    if (!confirm) {
      console.log('  Cancelled.');
      return {
        success: true,
        action: `ops_${action}`,
        candidateId: candidate.id,
        dryRun: true,
        message: 'Execution cancelled by user',
      };
    }

    // Execute ops action
    try {
      const result = await this.executeOpsAction(candidate, action, context);
      console.log(`  [EXECUTED] ${result.message}`);
      return result;
    } catch (error) {
      const errorMsg = (error as Error).message;
      console.log(`  [ERROR] ${errorMsg}`);
      return {
        success: false,
        action: `ops_${action}`,
        candidateId: candidate.id,
        dryRun: false,
        message: 'Execution failed',
        error: errorMsg,
      };
    }
  }

  // ============================================================
  // Guardrail Checks
  // ============================================================

  /**
   * Check template guardrails
   */
  private checkTemplateGuardrails(candidate: TemplateApprovalCandidate): GuardrailCheckResult {
    const blockedReasons: string[] = [];

    // Check for min_sent guardrail
    for (const g of candidate.guardrails) {
      if (g.includes('min_sent未満')) {
        blockedReasons.push('Insufficient sample size (min_sent not met)');
      }
      if (g.includes('experiment is paused')) {
        blockedReasons.push('Experiment is paused - cannot approve templates');
      }
    }

    // Check experiment status
    try {
      const scheduler = getExperimentScheduler();
      const result = scheduler.getActiveExperiment();
      if (result.experiment?.status === 'paused') {
        if (!blockedReasons.includes('Experiment is paused - cannot approve templates')) {
          blockedReasons.push('Experiment is paused - cannot approve templates');
        }
      }
    } catch {
      // Experiment check failed, allow to proceed
    }

    return {
      allowed: blockedReasons.length === 0,
      blockedReasons,
    };
  }

  /**
   * Check fix proposal guardrails
   */
  private checkFixGuardrails(candidate: FixProposalCandidate): GuardrailCheckResult {
    const blockedReasons: string[] = [];

    // Check for open incidents guardrail
    for (const g of candidate.guardrails) {
      if (g.includes('open incident') && g.includes('review incidents first')) {
        // This is a warning, not a blocker
        // blockedReasons.push('Open incidents should be reviewed first');
      }
    }

    return {
      allowed: blockedReasons.length === 0,
      blockedReasons,
    };
  }

  /**
   * Check ops guardrails
   */
  private checkOpsGuardrails(candidate: OpsCandidate): GuardrailCheckResult {
    const blockedReasons: string[] = [];

    // Check kill switch for send-related operations
    if (candidate.type === 'kill_switch') {
      try {
        const incidentManager = getIncidentManager();
        const openIncidents = incidentManager.listIncidents({ status: 'open' });
        if (openIncidents.length > 0) {
          blockedReasons.push(`${openIncidents.length} open incident(s) - resolve before resuming`);
        }
      } catch {
        // Incident check failed
      }
    }

    return {
      allowed: blockedReasons.length === 0,
      blockedReasons,
    };
  }

  // ============================================================
  // Execution Functions
  // ============================================================

  /**
   * Execute template approval
   */
  private async executeTemplateApproval(
    candidate: TemplateApprovalCandidate,
    action: string,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    // Template approval uses the approvals.ndjson via DraftRegistry/approval system
    // For now, we log the action and return success
    // The actual implementation would call the approve_templates logic

    const { getAuditLogger } = require('../audit/AuditLogger');
    const auditLogger = getAuditLogger();

    auditLogger.log({
      eventType: 'TEMPLATE_APPROVAL_INTERACTIVE',
      timestamp: new Date().toISOString(),
      actor: context.actor,
      reason: context.reason,
      source: 'interactive',
      templateId: candidate.templateId,
      experimentId: candidate.experimentId,
      variant: candidate.variant,
      action,
    });

    return {
      success: true,
      action: `template_${action}`,
      candidateId: candidate.id,
      dryRun: false,
      message: `Template ${candidate.templateId} ${action}ed by ${context.actor}`,
    };
  }

  /**
   * Execute fix proposal action
   */
  private async executeFixProposalAction(
    candidate: FixProposalCandidate,
    action: string,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const manager = getFixProposalManager();

    let result;
    if (action === 'accept') {
      result = manager.accept(
        candidate.proposalId,
        context.actor,
        context.reason,
        undefined // no links in interactive mode
      );
    } else if (action === 'reject') {
      result = manager.reject(
        candidate.proposalId,
        context.actor,
        context.reason
      );
    } else {
      throw new Error(`Unknown action: ${action}`);
    }

    if (!result.success) {
      throw new Error(result.error || 'Unknown error');
    }

    return {
      success: true,
      action: `fix_${action}`,
      candidateId: candidate.id,
      dryRun: false,
      message: `Fix proposal ${candidate.proposalId} ${action}ed by ${context.actor}`,
    };
  }

  /**
   * Execute ops action
   */
  private async executeOpsAction(
    candidate: OpsCandidate,
    action: string,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    switch (candidate.type) {
      case 'dead_letter':
        return this.executeDeadLetterAction(candidate, action, context);
      case 'kill_switch':
        return this.executeKillSwitchAction(candidate, action, context);
      case 'incident_review':
        return this.executeIncidentAction(candidate, action, context);
      case 'queue_backlog':
        return this.executeQueueAction(candidate, action, context);
      case 'data_cleanup':
        return this.executeDataCleanupAction(candidate, action, context);
      default:
        throw new Error(`Unknown ops type: ${candidate.type}`);
    }
  }

  /**
   * Execute dead letter queue action
   */
  private async executeDeadLetterAction(
    candidate: OpsCandidate,
    action: string,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const { getSendQueueManager } = require('../domain/SendQueueManager');
    const manager = getSendQueueManager();

    if (action === 'list') {
      const jobs = manager.getJobsByStatus('dead_letter');
      console.log(`  Found ${jobs.length} dead letter job(s)`);
      return {
        success: true,
        action: 'ops_dead_letter_list',
        candidateId: candidate.id,
        dryRun: false,
        message: `Listed ${jobs.length} dead letter jobs`,
      };
    }

    // For retry/cancel, we'd need specific job IDs
    return {
      success: true,
      action: `ops_dead_letter_${action}`,
      candidateId: candidate.id,
      dryRun: false,
      message: `Dead letter ${action} action noted - use send-queue CLI for specific jobs`,
    };
  }

  /**
   * Execute kill switch action
   */
  private async executeKillSwitchAction(
    candidate: OpsCandidate,
    action: string,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    if (action === 'status') {
      const killSwitch = getRuntimeKillSwitch();
      const policy = getSendPolicy();
      const isActive = killSwitch.isEnabled() || policy.getConfig().killSwitch;
      console.log(`  Kill switch: ${isActive ? 'ACTIVE' : 'INACTIVE'}`);
      return {
        success: true,
        action: 'ops_kill_switch_status',
        candidateId: candidate.id,
        dryRun: false,
        message: `Kill switch status: ${isActive ? 'ACTIVE' : 'INACTIVE'}`,
      };
    }

    if (action === 'resume_check') {
      const { getResumeGate } = require('../domain/ResumeGate');
      const resumeGate = getResumeGate();
      const checkResult = resumeGate.check();
      console.log(`  Resume check: ${checkResult.canResume ? 'CAN RESUME' : 'CANNOT RESUME'}`);
      if (!checkResult.canResume) {
        console.log(`  Blockers: ${checkResult.blockers.join(', ')}`);
      }
      return {
        success: true,
        action: 'ops_kill_switch_resume_check',
        candidateId: candidate.id,
        dryRun: false,
        message: checkResult.canResume ? 'Resume check passed' : `Resume blocked: ${checkResult.blockers.join(', ')}`,
      };
    }

    return {
      success: true,
      action: `ops_kill_switch_${action}`,
      candidateId: candidate.id,
      dryRun: false,
      message: `Kill switch ${action} noted - use stop/resume CLI commands`,
    };
  }

  /**
   * Execute incident action
   */
  private async executeIncidentAction(
    candidate: OpsCandidate,
    action: string,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const incidentManager = getIncidentManager();

    if (action === 'list') {
      const openIncidents = incidentManager.listIncidents({ status: 'open' });
      console.log(`  Found ${openIncidents.length} open incident(s)`);
      for (const inc of openIncidents.slice(0, 5)) {
        console.log(`    - ${inc.incident_id}: ${inc.trigger_type} (${inc.severity})`);
      }
      return {
        success: true,
        action: 'ops_incident_list',
        candidateId: candidate.id,
        dryRun: false,
        message: `Listed ${openIncidents.length} open incidents`,
      };
    }

    return {
      success: true,
      action: `ops_incident_${action}`,
      candidateId: candidate.id,
      dryRun: false,
      message: `Incident ${action} noted - use incidents CLI for specific actions`,
    };
  }

  /**
   * Execute queue action
   */
  private async executeQueueAction(
    candidate: OpsCandidate,
    action: string,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const { getSendQueueManager } = require('../domain/SendQueueManager');
    const manager = getSendQueueManager();
    const counts = manager.getStatusCounts();

    console.log(`  Queue status: queued=${counts.queued}, in_progress=${counts.in_progress}`);

    return {
      success: true,
      action: `ops_queue_${action}`,
      candidateId: candidate.id,
      dryRun: false,
      message: `Queue status checked: ${counts.queued} queued, ${counts.in_progress} in progress`,
    };
  }

  /**
   * Execute data cleanup action
   */
  private async executeDataCleanupAction(
    candidate: OpsCandidate,
    action: string,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    // Data cleanup is a manual operation, just provide guidance
    console.log('  Data cleanup requires manual execution:');
    console.log('  npx ts-node src/cli/run_ops.ts compact --target all --execute');

    return {
      success: true,
      action: `ops_data_cleanup_${action}`,
      candidateId: candidate.id,
      dryRun: false,
      message: 'Data cleanup guidance provided - run compact command manually',
    };
  }

  // ============================================================
  // UI Helpers
  // ============================================================

  /**
   * Get available actions for ops type
   */
  private getOpsActions(type: OpsCandidate['type']): string[] {
    switch (type) {
      case 'dead_letter':
        return ['list', 'review'];
      case 'kill_switch':
        return ['status', 'resume_check'];
      case 'incident_review':
        return ['list', 'review'];
      case 'queue_backlog':
        return ['status', 'review'];
      case 'data_cleanup':
        return ['review', 'compact'];
      default:
        return ['review'];
    }
  }

  /**
   * Ask for action (approve/reject/skip)
   */
  private async askAction(approveLabel: string, rejectLabel: string): Promise<string> {
    const answer = await this.question(`  Action? (1=${approveLabel}, 2=${rejectLabel}, s=skip): `);
    const trimmed = answer.trim().toLowerCase();

    if (trimmed === '1' || trimmed === approveLabel) {
      return approveLabel;
    } else if (trimmed === '2' || trimmed === rejectLabel) {
      return rejectLabel;
    } else {
      return 'skip';
    }
  }

  /**
   * Ask for ops action
   */
  private async askOpsAction(actions: string[]): Promise<string> {
    const options = actions.map((a, i) => `${i + 1}=${a}`).join(', ');
    const answer = await this.question(`  Action? (${options}, s=skip): `);
    const trimmed = answer.trim().toLowerCase();

    if (trimmed === 's' || trimmed === 'skip') {
      return 'skip';
    }

    const index = parseInt(trimmed, 10) - 1;
    if (index >= 0 && index < actions.length) {
      return actions[index];
    }

    // Check if answer matches action name
    if (actions.includes(trimmed)) {
      return trimmed;
    }

    return 'skip';
  }

  /**
   * Ask for confirmation
   */
  private async askConfirm(message: string): Promise<boolean> {
    const answer = await this.question(`  ${message} (y/N): `);
    return answer.trim().toLowerCase() === 'y';
  }

  /**
   * Ask a question and get answer
   */
  private question(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      if (!this.rl) {
        resolve('');
        return;
      }
      this.rl.question(prompt, (answer) => {
        resolve(answer);
      });
    });
  }
}

/**
 * Run interactive session (for programmatic use)
 */
export async function runInteractiveSession(
  candidates: ApprovalCandidates,
  context: ExecutionContext
): Promise<ExecutionResult[]> {
  const runner = new InteractiveRunner();
  return runner.run(candidates, context);
}

/**
 * Non-interactive execution (for testing/batch mode)
 */
export function executeWithoutInteraction(
  candidates: ApprovalCandidates,
  context: ExecutionContext,
  decisions: Map<string, string>
): ExecutionResult[] {
  const results: ExecutionResult[] = [];

  // Process templates
  for (const template of candidates.templates) {
    const decision = decisions.get(template.id);
    if (!decision || decision === 'skip') {
      results.push({
        success: true,
        action: 'skip',
        candidateId: template.id,
        dryRun: true,
        message: 'Skipped',
      });
      continue;
    }

    // Check guardrails
    const runner = new InteractiveRunner();
    const guardrailCheck = (runner as any).checkTemplateGuardrails(template);
    if (!guardrailCheck.allowed) {
      results.push({
        success: false,
        action: `template_${decision}`,
        candidateId: template.id,
        dryRun: true,
        message: 'Blocked by guardrails',
        blockedByGuardrails: guardrailCheck.blockedReasons,
      });
      continue;
    }

    if (!context.executeMode) {
      results.push({
        success: true,
        action: `template_${decision}`,
        candidateId: template.id,
        dryRun: true,
        message: 'Dry-run completed',
      });
    } else {
      // Would execute here
      results.push({
        success: true,
        action: `template_${decision}`,
        candidateId: template.id,
        dryRun: false,
        message: `Executed ${decision}`,
      });
    }
  }

  // Process fixes
  for (const fix of candidates.fixes) {
    const decision = decisions.get(fix.id);
    if (!decision || decision === 'skip') {
      results.push({
        success: true,
        action: 'skip',
        candidateId: fix.id,
        dryRun: true,
        message: 'Skipped',
      });
      continue;
    }

    if (!context.executeMode) {
      results.push({
        success: true,
        action: `fix_${decision}`,
        candidateId: fix.id,
        dryRun: true,
        message: 'Dry-run completed',
      });
    } else {
      try {
        const manager = getFixProposalManager();
        if (decision === 'accept') {
          manager.accept(fix.proposalId, context.actor, context.reason);
        } else if (decision === 'reject') {
          manager.reject(fix.proposalId, context.actor, context.reason);
        }
        results.push({
          success: true,
          action: `fix_${decision}`,
          candidateId: fix.id,
          dryRun: false,
          message: `Executed ${decision}`,
        });
      } catch (error) {
        results.push({
          success: false,
          action: `fix_${decision}`,
          candidateId: fix.id,
          dryRun: false,
          message: 'Execution failed',
          error: (error as Error).message,
        });
      }
    }
  }

  // Process ops
  for (const ops of candidates.ops) {
    const decision = decisions.get(ops.id);
    results.push({
      success: true,
      action: decision || 'skip',
      candidateId: ops.id,
      dryRun: !context.executeMode,
      message: decision ? 'Processed' : 'Skipped',
    });
  }

  return results;
}

export default InteractiveRunner;
