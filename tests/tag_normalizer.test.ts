/**
 * TagNormalizer Test Suite
 *
 * Tests the tag parsing and normalization logic with various inputs.
 * Reference date for tests: 2026-01-26
 */

import { TagNormalizer } from '../src/domain/TagNormalizer';

describe('TagNormalizer', () => {
  // Fixed reference date for all tests: 2026-01-26
  const referenceDate = new Date('2026-01-26T00:00:00Z');
  let normalizer: TagNormalizer;

  beforeEach(() => {
    normalizer = new TagNormalizer(referenceDate);
  });

  describe('Basic Parsing', () => {
    // Test 1: Standard format with region and month
    test('parses "南部・3月連絡" correctly', () => {
      const result = normalizer.parse('南部・3月連絡');

      expect(result.success).toBe(true);
      expect(result.normalized).toBeDefined();
      expect(result.normalized!.rawTag).toBe('南部・3月連絡');
      expect(result.normalized!.region).toBe('南部');
      expect(result.normalized!.contactMonth).toBe(3);
      expect(result.normalized!.contactYear).toBe(2026); // March >= January, so 2026
      expect(result.normalized!.contactDate).toBe('2026-03-01');
      expect(result.normalized!.isContactTag).toBe(true);
    });

    // Test 2: Different region
    test('parses "中部・3月連絡" correctly', () => {
      const result = normalizer.parse('中部・3月連絡');

      expect(result.success).toBe(true);
      expect(result.normalized!.region).toBe('中部');
      expect(result.normalized!.contactMonth).toBe(3);
      expect(result.normalized!.contactYear).toBe(2026);
    });

    // Test 3: Northern region
    test('parses "北部・5月連絡" correctly', () => {
      const result = normalizer.parse('北部・5月連絡');

      expect(result.success).toBe(true);
      expect(result.normalized!.region).toBe('北部');
      expect(result.normalized!.contactMonth).toBe(5);
      expect(result.normalized!.contactYear).toBe(2026);
    });

    // Test 4: Month only (no region)
    test('parses "3月連絡" correctly (no region)', () => {
      const result = normalizer.parse('3月連絡');

      expect(result.success).toBe(true);
      expect(result.normalized!.region).toBeNull();
      expect(result.normalized!.contactMonth).toBe(3);
      expect(result.normalized!.contactYear).toBe(2026);
      expect(result.normalized!.isContactTag).toBe(true);
    });
  });

  describe('Year Calculation', () => {
    // Test 5: Month in past (should be next year)
    test('parses "南部・1月連絡" as next year when current month is January', () => {
      // Current date is 2026-01-26, so January is the current month
      // But since it's already January, "1月連絡" means next January
      // Wait - the rule is: if month >= current month, this year
      // So 1 >= 1, this should be 2026, but we're already in January
      // Actually the rule says "指定月が現在月以上なら今年"
      // 1月 >= 1月 (current), so it should be 2026
      // But if we're in January 26, should "1月連絡" be 2026-01 or 2027-01?
      // The spec says "直近の" which means "the next coming"
      // For consistency, let's interpret it as:
      // - If month >= current_month: use this year
      // - If month < current_month: use next year
      // So 1 >= 1, this should be 2026-01
      const result = normalizer.parse('南部・1月連絡');

      expect(result.success).toBe(true);
      expect(result.normalized!.contactMonth).toBe(1);
      expect(result.normalized!.contactYear).toBe(2026); // 1月 >= 1月, so 2026
      expect(result.normalized!.contactDate).toBe('2026-01-01');
    });

    // Test 6: December (definitely future within this year)
    test('parses "南部・12月連絡" as current year', () => {
      const result = normalizer.parse('南部・12月連絡');

      expect(result.success).toBe(true);
      expect(result.normalized!.contactMonth).toBe(12);
      expect(result.normalized!.contactYear).toBe(2026); // 12 >= 1, so 2026
      expect(result.normalized!.contactDate).toBe('2026-12-01');
    });

    // Test 7: Test from March perspective (month in past should be next year)
    test('interprets past month as next year from March reference', () => {
      const marchNormalizer = new TagNormalizer(new Date('2026-03-15T00:00:00Z'));
      const result = marchNormalizer.parse('南部・2月連絡');

      expect(result.success).toBe(true);
      expect(result.normalized!.contactMonth).toBe(2);
      expect(result.normalized!.contactYear).toBe(2027); // 2 < 3, so next year
      expect(result.normalized!.contactDate).toBe('2027-02-01');
    });

    // Test 8: Test from December perspective
    test('interprets future month correctly from December reference', () => {
      const decNormalizer = new TagNormalizer(new Date('2026-12-15T00:00:00Z'));
      const result = decNormalizer.parse('南部・1月連絡');

      expect(result.success).toBe(true);
      expect(result.normalized!.contactMonth).toBe(1);
      expect(result.normalized!.contactYear).toBe(2027); // 1 < 12, so next year
      expect(result.normalized!.contactDate).toBe('2027-01-01');
    });
  });

  describe('Edge Cases', () => {
    // Test 9: Empty string
    test('rejects empty string', () => {
      const result = normalizer.parse('');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    // Test 10: Non-contact tag (region only)
    test('parses region-only tag correctly', () => {
      const result = normalizer.parse('南部');

      expect(result.success).toBe(true);
      expect(result.normalized!.region).toBe('南部');
      expect(result.normalized!.isContactTag).toBe(false);
      expect(result.normalized!.contactMonth).toBeNull();
    });

    // Test 11: Different delimiter (slash)
    test('parses tags with slash delimiter', () => {
      const result = normalizer.parse('南部/3月連絡');

      expect(result.success).toBe(true);
      expect(result.normalized!.region).toBe('南部');
      expect(result.normalized!.contactMonth).toBe(3);
    });

    // Test 12: Multi-part tag with additional attributes
    test('parses multi-part tag with extra attributes', () => {
      const result = normalizer.parse('南部・IT業界・3月連絡');

      expect(result.success).toBe(true);
      expect(result.normalized!.region).toBe('南部');
      expect(result.normalized!.contactMonth).toBe(3);
      expect(result.normalized!.otherAttributes).toBeDefined();
      expect(result.normalized!.otherAttributes!['attr_0']).toBe('IT業界');
    });

    // Test 13: Invalid month (13)
    test('handles invalid month gracefully', () => {
      const result = normalizer.parse('南部・13月連絡');

      expect(result.success).toBe(true);
      expect(result.normalized!.region).toBe('南部');
      expect(result.normalized!.isContactTag).toBe(false);
      expect(result.normalized!.contactMonth).toBeNull();
    });

    // Test 14: Whitespace handling
    test('handles extra whitespace', () => {
      const result = normalizer.parse('  南部 ・ 3月連絡  ');

      expect(result.success).toBe(true);
      expect(result.normalized!.region).toBe('南部');
      expect(result.normalized!.contactMonth).toBe(3);
    });

    // Test 15: Two-digit month
    test('parses two-digit month correctly', () => {
      const result = normalizer.parse('南部・11月連絡');

      expect(result.success).toBe(true);
      expect(result.normalized!.contactMonth).toBe(11);
      expect(result.normalized!.contactYear).toBe(2026);
    });
  });

  describe('Static Method', () => {
    // Test 16: Static parseTag method
    test('static parseTag method works correctly', () => {
      const result = TagNormalizer.parseTag('中部・6月連絡', referenceDate);

      expect(result.success).toBe(true);
      expect(result.normalized!.region).toBe('中部');
      expect(result.normalized!.contactMonth).toBe(6);
      expect(result.normalized!.contactYear).toBe(2026);
    });
  });

  describe('Contact Period Check', () => {
    // Test 17: isWithinContactPeriod - matching
    test('isWithinContactPeriod returns true for matching month', () => {
      const januaryNormalizer = new TagNormalizer(new Date('2026-03-15T00:00:00Z'));
      const result = januaryNormalizer.parse('南部・3月連絡');

      expect(result.success).toBe(true);
      expect(januaryNormalizer.isWithinContactPeriod(
        result.normalized!,
        new Date('2026-03-20T00:00:00Z')
      )).toBe(true);
    });

    // Test 18: isWithinContactPeriod - not matching
    test('isWithinContactPeriod returns false for non-matching month', () => {
      const result = normalizer.parse('南部・3月連絡');

      expect(result.success).toBe(true);
      expect(normalizer.isWithinContactPeriod(
        result.normalized!,
        new Date('2026-04-01T00:00:00Z')
      )).toBe(false);
    });
  });

  describe('All Regions', () => {
    // Test 19: All supported regions
    test.each([
      ['南部', '南部・3月連絡'],
      ['北部', '北部・3月連絡'],
      ['中部', '中部・3月連絡'],
      ['東部', '東部・3月連絡'],
      ['西部', '西部・3月連絡'],
      ['全国', '全国・3月連絡'],
    ])('extracts region "%s" correctly', (expectedRegion, tag) => {
      const result = normalizer.parse(tag);

      expect(result.success).toBe(true);
      expect(result.normalized!.region).toBe(expectedRegion);
    });
  });

  describe('All Months', () => {
    // Test 20: All 12 months
    test.each([
      [1, '1月連絡', 2026],
      [2, '2月連絡', 2026],
      [3, '3月連絡', 2026],
      [4, '4月連絡', 2026],
      [5, '5月連絡', 2026],
      [6, '6月連絡', 2026],
      [7, '7月連絡', 2026],
      [8, '8月連絡', 2026],
      [9, '9月連絡', 2026],
      [10, '10月連絡', 2026],
      [11, '11月連絡', 2026],
      [12, '12月連絡', 2026],
    ])('parses month %i correctly from "%s"', (expectedMonth, tag, expectedYear) => {
      const result = normalizer.parse(tag);

      expect(result.success).toBe(true);
      expect(result.normalized!.contactMonth).toBe(expectedMonth);
      expect(result.normalized!.contactYear).toBe(expectedYear);
    });
  });

  describe('filterCurrentMonthTags', () => {
    // Test 21: Filter tags for current month
    test('filters tags for current contact period', () => {
      const marchNormalizer = new TagNormalizer(new Date('2026-03-15T00:00:00Z'));
      const tags = [
        '南部・3月連絡',
        '中部・4月連絡',
        '北部・3月連絡',
        '製造業',
      ];

      const results = marchNormalizer.filterCurrentMonthTags(tags);

      expect(results).toHaveLength(2);
      expect(results[0].rawTag).toBe('南部・3月連絡');
      expect(results[1].rawTag).toBe('北部・3月連絡');
    });
  });
});
