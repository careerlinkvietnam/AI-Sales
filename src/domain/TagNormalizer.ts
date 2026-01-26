/**
 * TagNormalizer - Parses and normalizes contact tags
 *
 * Specification:
 * - Tag format: "地域・N月連絡" (e.g., "南部・3月連絡")
 * - Region extraction: 南部, 北部, 中部, etc.
 * - Month interpretation:
 *   - If specified month >= current month: use current year
 *   - If specified month < current month: use next year
 *   - Example: Today is 2026-01-26, "3月連絡" = 2026-03
 *   - Example: Today is 2026-01-26, "1月連絡" = 2027-01 (already passed)
 */

import { NormalizedTag, TagParseResult } from '../types';

// Known regions
const REGIONS = ['南部', '北部', '中部', '東部', '西部', '全国'] as const;
type Region = typeof REGIONS[number];

// Contact tag pattern: "N月連絡"
const CONTACT_MONTH_PATTERN = /(\d{1,2})月連絡/;

// Tag delimiter (Japanese middle dot or standard delimiter)
const TAG_DELIMITER_PATTERN = /[・／/]/;

export class TagNormalizer {
  private readonly referenceDate: Date;

  /**
   * Create a TagNormalizer instance
   *
   * @param referenceDate - The date to use for year calculation.
   *                        Defaults to current date. Allows injection for testing.
   */
  constructor(referenceDate?: Date) {
    this.referenceDate = referenceDate || new Date();
  }

  /**
   * Parse a raw tag string into normalized form
   *
   * @param rawTag - The raw tag string (e.g., "南部・3月連絡")
   * @returns TagParseResult with success status and normalized data
   */
  parse(rawTag: string): TagParseResult {
    if (!rawTag || typeof rawTag !== 'string') {
      return {
        success: false,
        error: 'Tag is required and must be a string',
      };
    }

    const trimmedTag = rawTag.trim();
    if (trimmedTag.length === 0) {
      return {
        success: false,
        error: 'Tag cannot be empty',
      };
    }

    try {
      const normalized = this.normalizeTag(trimmedTag);
      return {
        success: true,
        normalized,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown parsing error',
      };
    }
  }

  /**
   * Internal normalization logic
   */
  private normalizeTag(rawTag: string): NormalizedTag {
    // Split tag by delimiter
    const parts = rawTag.split(TAG_DELIMITER_PATTERN).map(p => p.trim()).filter(Boolean);

    // Extract region
    const region = this.extractRegion(parts);

    // Extract contact month
    const contactInfo = this.extractContactMonth(rawTag);

    // Collect other attributes (parts that are not region or contact info)
    const otherAttributes: Record<string, string> = {};
    for (const part of parts) {
      if (!this.isRegion(part) && !CONTACT_MONTH_PATTERN.test(part)) {
        // Use index as key for unnamed attributes
        const key = `attr_${Object.keys(otherAttributes).length}`;
        otherAttributes[key] = part;
      }
    }

    return {
      rawTag,
      region,
      contactMonth: contactInfo.month,
      contactYear: contactInfo.year,
      contactDate: contactInfo.date,
      isContactTag: contactInfo.isContact,
      otherAttributes: Object.keys(otherAttributes).length > 0 ? otherAttributes : undefined,
    };
  }

  /**
   * Extract region from tag parts
   */
  private extractRegion(parts: string[]): string | null {
    for (const part of parts) {
      for (const region of REGIONS) {
        if (part.includes(region)) {
          return region;
        }
      }
    }
    return null;
  }

  /**
   * Check if a string is a known region
   */
  private isRegion(text: string): boolean {
    return REGIONS.some(region => text.includes(region));
  }

  /**
   * Extract contact month and calculate target year
   */
  private extractContactMonth(rawTag: string): {
    month: number | null;
    year: number | null;
    date: string | null;
    isContact: boolean;
  } {
    const match = rawTag.match(CONTACT_MONTH_PATTERN);

    if (!match) {
      return { month: null, year: null, date: null, isContact: false };
    }

    const month = parseInt(match[1], 10);

    // Validate month
    if (month < 1 || month > 12) {
      return { month: null, year: null, date: null, isContact: false };
    }

    // Calculate target year based on the rule:
    // - If month >= current month: use current year
    // - If month < current month: use next year
    const currentYear = this.referenceDate.getFullYear();
    const currentMonth = this.referenceDate.getMonth() + 1; // JavaScript months are 0-indexed

    let targetYear: number;
    if (month >= currentMonth) {
      targetYear = currentYear;
    } else {
      targetYear = currentYear + 1;
    }

    // Format date as YYYY-MM-01
    const contactDate = `${targetYear}-${String(month).padStart(2, '0')}-01`;

    return {
      month,
      year: targetYear,
      date: contactDate,
      isContact: true,
    };
  }

  /**
   * Static convenience method for one-off parsing
   */
  static parseTag(rawTag: string, referenceDate?: Date): TagParseResult {
    const normalizer = new TagNormalizer(referenceDate);
    return normalizer.parse(rawTag);
  }

  /**
   * Check if a given date falls within the contact month
   */
  isWithinContactPeriod(normalizedTag: NormalizedTag, checkDate?: Date): boolean {
    if (!normalizedTag.isContactTag || !normalizedTag.contactYear || !normalizedTag.contactMonth) {
      return false;
    }

    const date = checkDate || new Date();
    const checkYear = date.getFullYear();
    const checkMonth = date.getMonth() + 1;

    return checkYear === normalizedTag.contactYear && checkMonth === normalizedTag.contactMonth;
  }

  /**
   * Get tags that should be contacted in the current month
   * Uses the normalizer's reference date for comparison
   */
  filterCurrentMonthTags(tags: string[]): NormalizedTag[] {
    const results: NormalizedTag[] = [];

    for (const tag of tags) {
      const result = this.parse(tag);
      if (result.success && result.normalized && this.isWithinContactPeriod(result.normalized, this.referenceDate)) {
        results.push(result.normalized);
      }
    }

    return results;
  }
}

export default TagNormalizer;
