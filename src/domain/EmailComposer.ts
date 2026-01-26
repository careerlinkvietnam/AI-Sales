/**
 * Email Composer for Japanese Sales Emails
 *
 * Generates email subject and body using template-driven approach.
 * Rules:
 * - Only use facts from CompanyProfile and Candidate rationale
 * - Never include assumptions in the main body
 * - Minimize PII (no candidate names or contact info)
 */

import { CompanyProfile, Candidate, EmailOutput } from '../types';

/**
 * Email template configuration
 */
interface EmailTemplate {
  subjectTemplate: string;
  greeting: string;
  introduction: string;
  candidateSection: string;
  closing: string;
  signature: string;
}

/**
 * Default Japanese email template
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
    const subject = this.composeSubject(profile);
    const body = this.composeBody(profile, candidates);

    return {
      subject,
      body,
      to: profile.facts.companyId, // Placeholder - actual email from CRM
    };
  }

  /**
   * Compose email subject
   */
  private composeSubject(profile: CompanyProfile): string {
    return this.template.subjectTemplate
      .replace('{{companyName}}', profile.facts.companyName);
  }

  /**
   * Compose email body
   */
  private composeBody(profile: CompanyProfile, candidates: Candidate[]): string {
    const parts: string[] = [];

    // Greeting
    parts.push(this.template.greeting
      .replace('{{companyName}}', profile.facts.companyName));
    parts.push('');

    // Introduction with contact context
    const contactContext = this.buildContactContext(profile);
    parts.push(this.template.introduction
      .replace('{{contactContext}}', contactContext));
    parts.push('');

    // Candidate section
    if (candidates.length > 0) {
      const candidateList = this.formatCandidateList(candidates);
      parts.push(this.template.candidateSection
        .replace('{{candidateList}}', candidateList));
      parts.push('');
    }

    // Closing
    parts.push(this.template.closing);
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
    const months = (now.getFullYear() - date.getFullYear()) * 12 +
      (now.getMonth() - date.getMonth());
    return Math.max(0, months);
  }

  /**
   * Format candidate list for email
   * Note: No PII (names, contact info) included
   */
  private formatCandidateList(candidates: Candidate[]): string {
    return candidates.map((candidate, index) => {
      const lines: string[] = [];

      // Candidate number and headline
      lines.push(`${index + 1}. ${candidate.headline}`);

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

      // Match reasons from rationale (based on facts only)
      if (candidate.rationale.reasonTags.length > 0) {
        lines.push(`   推薦理由: ${candidate.rationale.reasonTags.join('、')}`);
      }

      return lines.join('\n');
    }).join('\n\n');
  }
}

export default EmailComposer;
