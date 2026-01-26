/**
 * Company Profile Builder
 *
 * Builds CompanyProfile from CRM data with strict facts/assumptions separation.
 *
 * Field Mappings (from CRM to CompanyProfile):
 * - companyId: Company.id
 * - companyName: Company.name_ja || name_en || name_local
 * - location.region: Extracted from Company.tags_snapshot
 * - location.province: Company.province_name
 * - location.address: Company.address
 * - industryText: Company.profile
 * - tags: Company.tags_snapshot (split by comma)
 * - contactHistoryExcerpt: SalesAction records (via Timeline)
 */

import {
  CompanyDetail,
  ContactHistory,
  CompanyProfile,
  CompanyProfileFacts,
  CompanyProfileSummaries,
  ContactActionType,
} from '../types';

/**
 * Maximum number of recent topics to include
 */
const MAX_RECENT_TOPICS = 5;

/**
 * Maximum length for topic excerpts
 */
const MAX_TOPIC_LENGTH = 100;

export class CompanyProfileBuilder {
  /**
   * Build a CompanyProfile from CRM company detail and contact history
   *
   * @param detail - Company detail from CRM
   * @param history - Contact history from CRM
   * @returns CompanyProfile with facts/assumptions separated
   */
  build(detail: CompanyDetail, history: ContactHistory): CompanyProfile {
    const facts = this.buildFacts(detail, history);
    const summaries = this.buildSummaries(facts);
    const sourceRefs = this.buildSourceRefs(detail, history);

    return {
      facts,
      summaries,
      assumptions: [], // No assumptions by default - only facts
      sourceRefs,
    };
  }

  /**
   * Build facts section from CRM data
   */
  private buildFacts(detail: CompanyDetail, history: ContactHistory): CompanyProfileFacts {
    // Extract region from tags
    const region = this.extractRegion(detail.tags || []);

    // Build contact history excerpt
    const contactExcerpt = this.buildContactExcerpt(history);

    return {
      companyId: detail.companyId,
      companyName: detail.name,
      location: {
        region,
        province: detail.province || null,
        address: detail.address || null,
      },
      industryText: detail.profile || null,
      tags: detail.tags || [],
      contactHistoryExcerpt: contactExcerpt,
    };
  }

  /**
   * Extract region from tags
   */
  private extractRegion(tags: string[]): string | null {
    const regionPatterns = ['南部', '北部', '中部', '東部', '西部'];

    for (const tag of tags) {
      for (const region of regionPatterns) {
        if (tag.includes(region)) {
          return region;
        }
      }
    }

    return null;
  }

  /**
   * Build contact history excerpt
   */
  private buildContactExcerpt(history: ContactHistory): CompanyProfileFacts['contactHistoryExcerpt'] {
    const items = history.items || [];

    // Get most recent contact
    const mostRecent = items[0]; // Already sorted by date desc

    // Extract recent topics from summaries (PII already masked)
    const recentTopics: string[] = [];
    for (const item of items.slice(0, MAX_RECENT_TOPICS)) {
      if (item.summary) {
        const excerpt = item.summary.length > MAX_TOPIC_LENGTH
          ? item.summary.substring(0, MAX_TOPIC_LENGTH) + '...'
          : item.summary;
        recentTopics.push(excerpt);
      }
    }

    return {
      lastContactDate: mostRecent?.performedAt || null,
      lastContactType: mostRecent?.actionType || null,
      recentTopics,
      totalContacts: history.totalCount || items.length,
    };
  }

  /**
   * Build summaries from facts
   * Currently generates simple summaries - can be enhanced with LLM later
   */
  private buildSummaries(facts: CompanyProfileFacts): CompanyProfileSummaries {
    return {
      industrySummary: this.summarizeIndustry(facts),
      pastContactsSummary: this.summarizeContacts(facts),
    };
  }

  /**
   * Generate industry summary from industryText
   */
  private summarizeIndustry(facts: CompanyProfileFacts): string | null {
    if (!facts.industryText) {
      return null;
    }

    // Simple truncation for now - can be replaced with LLM summarization
    const text = facts.industryText;
    if (text.length <= 200) {
      return text;
    }

    return text.substring(0, 200) + '...';
  }

  /**
   * Generate contacts summary
   */
  private summarizeContacts(facts: CompanyProfileFacts): string | null {
    const excerpt = facts.contactHistoryExcerpt;

    if (excerpt.totalContacts === 0) {
      return '過去の連絡履歴はありません。';
    }

    const parts: string[] = [];

    parts.push(`過去${excerpt.totalContacts}件の連絡履歴があります。`);

    if (excerpt.lastContactDate) {
      const date = new Date(excerpt.lastContactDate);
      const dateStr = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
      const typeStr = this.formatContactType(excerpt.lastContactType);
      parts.push(`最終連絡: ${dateStr}（${typeStr}）`);
    }

    return parts.join(' ');
  }

  /**
   * Format contact type in Japanese
   */
  private formatContactType(type: ContactActionType | null | undefined): string {
    const typeMap: Record<ContactActionType, string> = {
      tel: '電話',
      visit: '訪問',
      contract: '契約',
      others: 'その他',
    };
    return type ? typeMap[type] || 'その他' : '不明';
  }

  /**
   * Build source references
   */
  private buildSourceRefs(
    detail: CompanyDetail,
    history: ContactHistory
  ): CompanyProfile['sourceRefs'] {
    return {
      companyId: detail.companyId,
      timelineItemIds: history.items.map(item => item.actionId),
    };
  }
}

export default CompanyProfileBuilder;
