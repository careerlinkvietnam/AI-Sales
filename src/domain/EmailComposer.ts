/**
 * Email Composer for Japanese Sales Emails (B案仕様)
 *
 * Generates email subject and body using template-driven approach.
 * Rules:
 * - Only use facts from CompanyProfile and Candidate rationale
 * - Include career summary in candidate section
 * - Never include assumptions in the main body
 * - Minimize PII (no candidate names or contact info)
 * - Validate content before output
 */

import { CompanyProfile, Candidate, EmailOutput } from '../types';
import {
  filterCandidatesWithAudit,
  validateEmailBody,
  CandidateExclusionResult,
} from './ContentGuards';

/**
 * Email template configuration
 */
interface EmailTemplate {
  subjectTemplate: string;
  greeting: string;
  introduction: string;
  candidateSection: string;
  noCandidateSection: string;
  closing: string;
  signature: string;
}

/**
 * Compose result with audit information
 */
export interface ComposeResult {
  email: EmailOutput;
  candidateExclusions: CandidateExclusionResult[];
  validationResult: {
    ok: boolean;
    violations: string[];
  };
}

/**
 * Maximum reason tags to include in email
 */
const MAX_REASON_TAGS = 3;

/**
 * Default Japanese email template (B案仕様)
 */
const DEFAULT_TEMPLATE: EmailTemplate = {
  subjectTemplate: '【CareerLink】{{companyName}}様へ人材のご提案',
  greeting: '{{companyName}} ご担当者様',
  introduction: `
いつもお世話になっております。
CareerLinkの営業担当でございます。

{{contactContext}}

この度、貴社にマッチする可能性のある人材をご紹介させていただきたく、ご連絡いたしました。
`.trim(),
  candidateSection: `
【ご紹介候補者】
{{candidateList}}
`.trim(),
  noCandidateSection: `
現在、貴社の条件に合致する候補者を探しております。
近日中に適切な候補者が見つかり次第、改めてご連絡させていただきます。

なお、採用に関するご要望やご質問がございましたら、お気軽にお申し付けください。
`.trim(),
  closing: `
上記の候補者について、ご興味がございましたら、詳細な情報をお送りいたします。
ご検討のほど、よろしくお願いいたします。
`.trim(),
  signature: `
---
CareerLink Vietnam
`.trim(),
};

export class EmailComposer {
  private readonly template: EmailTemplate;

  constructor(template?: Partial<EmailTemplate>) {
    this.template = { ...DEFAULT_TEMPLATE, ...template };
  }

  /**
   * Compose email from company profile and candidates
   *
   * @param profile - Company profile with facts
   * @param candidates - Candidate list with rationale
   * @returns Email subject and body
   */
  compose(profile: CompanyProfile, candidates: Candidate[]): EmailOutput {
    const result = this.composeWithAudit(profile, candidates);
    return result.email;
  }

  /**
   * Compose email with full audit information
   *
   * @param profile - Company profile with facts
   * @param candidates - Candidate list with rationale
   * @returns Email output with audit data
   */
  composeWithAudit(profile: CompanyProfile, candidates: Candidate[]): ComposeResult {
    // Filter candidates for PII
    const { included: filteredCandidates, exclusions } =
      filterCandidatesWithAudit(candidates);

    const subject = this.composeSubject(profile);
    const body = this.composeBody(profile, filteredCandidates);

    // Validate final email body
    const validationResult = validateEmailBody(body);

    return {
      email: {
        subject,
        body,
        to: profile.facts.companyId, // Placeholder - actual email from CRM
      },
      candidateExclusions: exclusions,
      validationResult,
    };
  }

  /**
   * Compose email subject
   */
  private composeSubject(profile: CompanyProfile): string {
    return this.template.subjectTemplate.replace(
      '{{companyName}}',
      profile.facts.companyName
    );
  }

  /**
   * Compose email body
   */
  private composeBody(profile: CompanyProfile, candidates: Candidate[]): string {
    const parts: string[] = [];

    // Greeting
    parts.push(
      this.template.greeting.replace('{{companyName}}', profile.facts.companyName)
    );
    parts.push('');

    // Introduction with contact context
    const contactContext = this.buildContactContext(profile);
    parts.push(this.template.introduction.replace('{{contactContext}}', contactContext));
    parts.push('');

    // Candidate section or fallback
    if (candidates.length > 0) {
      const candidateList = this.formatCandidateList(candidates);
      parts.push(
        this.template.candidateSection.replace('{{candidateList}}', candidateList)
      );
      parts.push('');
      // Closing (only when candidates exist)
      parts.push(this.template.closing);
    } else {
      // No candidates fallback
      parts.push(this.template.noCandidateSection);
    }
    parts.push('');

    // Signature
    parts.push(this.template.signature);

    return parts.join('\n');
  }

  /**
   * Build contact context from profile facts
   */
  private buildContactContext(profile: CompanyProfile): string {
    const excerpt = profile.facts.contactHistoryExcerpt;

    if (excerpt.totalContacts === 0) {
      return '初めてご連絡させていただきます。';
    }

    if (excerpt.lastContactDate) {
      const date = new Date(excerpt.lastContactDate);
      const monthsAgo = this.monthsSince(date);

      if (monthsAgo < 1) {
        return '先日はお時間をいただきありがとうございました。';
      } else if (monthsAgo < 3) {
        return `${monthsAgo}ヶ月前にご連絡させていただきました。`;
      } else {
        return 'ご無沙汰しております。';
      }
    }

    return '以前よりお付き合いいただいております。';
  }

  /**
   * Calculate months since a date
   */
  private monthsSince(date: Date): number {
    const now = new Date();
    const months =
      (now.getFullYear() - date.getFullYear()) * 12 +
      (now.getMonth() - date.getMonth());
    return Math.max(0, months);
  }

  /**
   * Format candidate list for email (B案仕様: careerSummary含む)
   * Note: No PII (names, contact info) included
   */
  private formatCandidateList(candidates: Candidate[]): string {
    return candidates
      .map((candidate, index) => {
        const lines: string[] = [];

        // Candidate header: number + headline + job title/years if available
        const headerParts: string[] = [`${index + 1}. ${candidate.headline}`];
        if (candidate.yearsOfExperience) {
          headerParts.push(`（経験${candidate.yearsOfExperience}年）`);
        }
        lines.push(headerParts.join(''));

        // Career summary (B案仕様)
        if (candidate.careerSummary) {
          lines.push(`   経歴要約: ${candidate.careerSummary}`);
        }

        // Key skills
        if (candidate.keySkills.length > 0) {
          lines.push(`   スキル: ${candidate.keySkills.join('、')}`);
        }

        // Location and availability
        const details: string[] = [];
        if (candidate.location) {
          details.push(`勤務地: ${candidate.location}`);
        }
        if (candidate.availability) {
          details.push(`入社可能: ${candidate.availability}`);
        }
        if (details.length > 0) {
          lines.push(`   ${details.join(' / ')}`);
        }

        // Match reasons from rationale (based on facts only, max 3)
        if (candidate.rationale.reasonTags.length > 0) {
          const tags = candidate.rationale.reasonTags.slice(0, MAX_REASON_TAGS);
          lines.push(`   推薦理由: ${tags.join('、')}`);
        }

        return lines.join('\n');
      })
      .join('\n\n');
  }
}

export default EmailComposer;
