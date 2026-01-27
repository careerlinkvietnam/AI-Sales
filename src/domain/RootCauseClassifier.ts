/**
 * Root Cause Classifier
 *
 * Classifies incidents into predefined categories based on
 * reason, snapshot, actions taken, and trigger type.
 *
 * 重要:
 * - PIIは入力しない（Incidentレコードは元々PIIなし）
 * - evidenceにもPIIを含めない
 * - "自動修正"はしない。分類と推奨のみ。
 */

import * as fs from 'fs';
import * as path from 'path';
import { Incident } from '../data/IncidentStore';

/**
 * Classification confidence level
 */
export type ClassificationConfidence = 'high' | 'medium' | 'low';

/**
 * Classification result
 */
export interface ClassificationResult {
  category_id: string;
  category_name: string;
  category_name_ja: string;
  confidence: ClassificationConfidence;
  evidence: string[];
  recommended_actions: string[];
}

/**
 * Detection rule condition for snapshot fields
 */
interface SnapshotCondition {
  field: string;
  value: unknown;
}

/**
 * Detection rules for a category
 */
interface DetectionRules {
  reason_keywords?: string[];
  snapshot_conditions?: SnapshotCondition[];
  trigger_types?: string[];
  actions_taken?: string[];
  blocked_reasons?: string[];
}

/**
 * Incident category definition
 */
export interface IncidentCategory {
  id: string;
  name: string;
  name_ja: string;
  description: string;
  detection_rules: DetectionRules;
  recommended_actions: string[];
  severity_weight: number;
}

/**
 * Categories configuration
 */
interface CategoriesConfig {
  version: string;
  categories: IncidentCategory[];
}

/**
 * Root Cause Classifier class
 */
export class RootCauseClassifier {
  private readonly categories: IncidentCategory[];
  private readonly unknownCategory: IncidentCategory;

  constructor(configPath?: string) {
    const effectivePath = configPath || path.join('config', 'incident_categories.json');

    if (!fs.existsSync(effectivePath)) {
      throw new Error(`Categories config not found: ${effectivePath}`);
    }

    const content = fs.readFileSync(effectivePath, 'utf-8');
    const config: CategoriesConfig = JSON.parse(content);
    this.categories = config.categories;

    // Find or create unknown category
    const unknown = this.categories.find((c) => c.id === 'unknown');
    this.unknownCategory = unknown || {
      id: 'unknown',
      name: 'Unknown/Unclassified',
      name_ja: '分類不能',
      description: 'Incident could not be classified',
      detection_rules: {},
      recommended_actions: ['インシデントの詳細を手動で確認'],
      severity_weight: 1,
    };
  }

  /**
   * Classify an incident
   */
  classify(incident: Incident): ClassificationResult {
    const matches: Array<{
      category: IncidentCategory;
      score: number;
      evidence: string[];
    }> = [];

    for (const category of this.categories) {
      if (category.id === 'unknown') continue;

      const { score, evidence } = this.matchCategory(incident, category);
      if (score > 0) {
        matches.push({ category, score, evidence });
      }
    }

    // Sort by score descending
    matches.sort((a, b) => b.score - a.score);

    if (matches.length === 0) {
      return {
        category_id: this.unknownCategory.id,
        category_name: this.unknownCategory.name,
        category_name_ja: this.unknownCategory.name_ja,
        confidence: 'low',
        evidence: ['No matching rules found'],
        recommended_actions: this.unknownCategory.recommended_actions,
      };
    }

    const best = matches[0];
    const confidence = this.determineConfidence(best.score, matches.length);

    return {
      category_id: best.category.id,
      category_name: best.category.name,
      category_name_ja: best.category.name_ja,
      confidence,
      evidence: best.evidence,
      recommended_actions: best.category.recommended_actions,
    };
  }

  /**
   * Match an incident against a category's detection rules
   */
  private matchCategory(
    incident: Incident,
    category: IncidentCategory
  ): { score: number; evidence: string[] } {
    const rules = category.detection_rules;
    let score = 0;
    const evidence: string[] = [];

    // Check reason keywords
    if (rules.reason_keywords && rules.reason_keywords.length > 0) {
      const reasonLower = incident.reason.toLowerCase();
      for (const keyword of rules.reason_keywords) {
        if (reasonLower.includes(keyword.toLowerCase())) {
          score += 2;
          evidence.push(`reason contains "${keyword}"`);
        }
      }
    }

    // Check trigger types
    if (rules.trigger_types && rules.trigger_types.length > 0) {
      if (rules.trigger_types.includes(incident.trigger_type)) {
        score += 3;
        evidence.push(`trigger_type=${incident.trigger_type}`);
      }
    }

    // Check actions taken
    if (rules.actions_taken && rules.actions_taken.length > 0) {
      for (const actionName of rules.actions_taken) {
        const found = incident.actions_taken.some((a) => a.action === actionName);
        if (found) {
          score += 2;
          evidence.push(`action_taken=${actionName}`);
        }
      }
    }

    // Check snapshot conditions
    if (rules.snapshot_conditions && rules.snapshot_conditions.length > 0) {
      for (const condition of rules.snapshot_conditions) {
        const value = this.getNestedValue(
          incident.snapshot as unknown as Record<string, unknown>,
          condition.field
        );
        if (value === condition.value) {
          score += 2;
          evidence.push(`snapshot.${condition.field}=${String(condition.value)}`);
        }
      }
    }

    // Check blocked reasons (from meta or reason text)
    if (rules.blocked_reasons && rules.blocked_reasons.length > 0) {
      const reasonLower = incident.reason.toLowerCase();
      for (const blockedReason of rules.blocked_reasons) {
        if (reasonLower.includes(blockedReason.toLowerCase())) {
          score += 2;
          evidence.push(`blocked_reason=${blockedReason}`);
        }
      }
    }

    return { score, evidence };
  }

  /**
   * Get nested value from an object using dot notation
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      if (typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  /**
   * Determine confidence based on score and number of matches
   */
  private determineConfidence(score: number, matchCount: number): ClassificationConfidence {
    // High confidence: high score and clear winner
    if (score >= 5 && matchCount === 1) {
      return 'high';
    }
    // High confidence: very high score
    if (score >= 7) {
      return 'high';
    }
    // Medium confidence: moderate score
    if (score >= 3) {
      return 'medium';
    }
    // Low confidence: low score or many competing matches
    return 'low';
  }

  /**
   * Get all categories
   */
  getCategories(): IncidentCategory[] {
    return [...this.categories];
  }

  /**
   * Get a category by ID
   */
  getCategory(categoryId: string): IncidentCategory | null {
    return this.categories.find((c) => c.id === categoryId) || null;
  }

  /**
   * Classify multiple incidents and aggregate by category
   */
  classifyBatch(incidents: Incident[]): Map<string, ClassificationResult[]> {
    const byCategory = new Map<string, ClassificationResult[]>();

    for (const incident of incidents) {
      const result = this.classify(incident);
      const existing = byCategory.get(result.category_id) || [];
      existing.push(result);
      byCategory.set(result.category_id, existing);
    }

    return byCategory;
  }
}

/**
 * Singleton instance
 */
let defaultClassifier: RootCauseClassifier | null = null;

/**
 * Get or create default classifier
 */
export function getRootCauseClassifier(): RootCauseClassifier {
  if (!defaultClassifier) {
    defaultClassifier = new RootCauseClassifier();
  }
  return defaultClassifier;
}

/**
 * Reset singleton (for testing)
 */
export function resetRootCauseClassifier(): void {
  defaultClassifier = null;
}

/**
 * Create classifier for testing
 */
export function createTestRootCauseClassifier(configPath: string): RootCauseClassifier {
  return new RootCauseClassifier(configPath);
}

export default RootCauseClassifier;
