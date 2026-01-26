/**
 * Content Guards for PII and Prohibited Content Detection
 *
 * Provides validation functions to detect and prevent PII
 * and other prohibited content from being included in emails.
 *
 * 検知対象:
 * - メールアドレス形式
 * - 電話番号らしき形式
 * - 住所らしき語（丁目・番地など）
 * - 生年月日らしき形式
 */

/**
 * Validation result for content checks
 */
export interface ContentValidationResult {
  ok: boolean;
  violations: string[];
}

/**
 * PII patterns for detection (正規表現ベース)
 */
const PII_PATTERNS = {
  // Email addresses
  email: {
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    description: 'メールアドレス',
  },

  // Phone numbers (various formats)
  phone: {
    pattern: /(?:\+?\d{1,4}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{2,4}[-.\s]?\d{2,4}/g,
    description: '電話番号',
  },

  // Japanese address patterns
  japaneseAddress: {
    pattern: /(?:\d+丁目|\d+-\d+-\d+|番地|号室|番\d+号)/g,
    description: '住所（丁目・番地等）',
  },

  // Vietnamese address patterns
  vietnameseAddress: {
    pattern: /(?:Số\s*\d+|Đường|Phường|Quận|P\.\s*\d+|Q\.\s*\d+)/gi,
    description: '住所（ベトナム形式）',
  },

  // Birth date patterns (YYYY-MM-DD, YYYY/MM/DD, etc.)
  birthDate: {
    pattern: /(?:生年月日|DOB|誕生日)[：:]\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}/gi,
    description: '生年月日',
  },

  // Age with specific year (might reveal birth year)
  specificAge: {
    pattern: /(?:\d{4}年生まれ|\d{4}年\d{1,2}月生)/g,
    description: '生年情報',
  },
};

/**
 * Validate candidate summary for PII
 *
 * @param summary - Career summary text to validate
 * @returns Validation result with any violations found
 */
export function validateCandidateSummary(summary: string): ContentValidationResult {
  const violations: string[] = [];

  for (const [key, { pattern, description }] of Object.entries(PII_PATTERNS)) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    if (pattern.test(summary)) {
      violations.push(`${description}が含まれています (${key})`);
    }
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}

/**
 * Validate email body for PII
 *
 * @param body - Email body text to validate
 * @returns Validation result with any violations found
 */
export function validateEmailBody(body: string): ContentValidationResult {
  const violations: string[] = [];

  for (const [key, { pattern, description }] of Object.entries(PII_PATTERNS)) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    const matches = body.match(pattern);
    if (matches && matches.length > 0) {
      // Allow company contact email (typically at the end in signature)
      // But flag if multiple emails are found
      if (key === 'email' && matches.length === 1) {
        // Single email might be company contact, check if it's candidate-related
        const lowerBody = body.toLowerCase();
        if (
          lowerBody.includes('候補者') &&
          body.indexOf(matches[0]) < body.indexOf('CareerLink')
        ) {
          violations.push(`候補者セクションに${description}が含まれています`);
        }
        // Otherwise, single email in signature area is acceptable
      } else if (key === 'email') {
        violations.push(`複数の${description}が含まれています`);
      } else {
        violations.push(`${description}が含まれています (${key})`);
      }
    }
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}

/**
 * Check if a candidate should be excluded based on content validation
 *
 * @param careerSummary - Candidate's career summary
 * @returns Object with exclusion status and reason
 */
export function checkCandidateExclusion(careerSummary: string): {
  excluded: boolean;
  reason?: string;
} {
  const result = validateCandidateSummary(careerSummary);

  if (!result.ok) {
    return {
      excluded: true,
      reason: `PII検出: ${result.violations.join(', ')}`,
    };
  }

  // Check for other prohibited content
  const prohibitedPatterns = [
    { pattern: /社名|会社名/g, reason: '現職/前職の会社名が含まれている可能性' },
    { pattern: /〒\d{3}-?\d{4}/g, reason: '郵便番号が含まれています' },
  ];

  for (const { pattern, reason } of prohibitedPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(careerSummary)) {
      return {
        excluded: true,
        reason,
      };
    }
  }

  return { excluded: false };
}

/**
 * Mask PII in text for safe logging
 *
 * @param text - Text that may contain PII
 * @returns Text with PII masked
 */
export function maskPiiForLogging(text: string): string {
  let masked = text;

  // Mask emails
  masked = masked.replace(PII_PATTERNS.email.pattern, '[EMAIL]');

  // Mask phone numbers
  masked = masked.replace(PII_PATTERNS.phone.pattern, '[PHONE]');

  // Mask addresses
  masked = masked.replace(PII_PATTERNS.japaneseAddress.pattern, '[ADDRESS]');
  masked = masked.replace(PII_PATTERNS.vietnameseAddress.pattern, '[ADDRESS]');

  return masked;
}

/**
 * Candidate exclusion result for audit logging
 */
export interface CandidateExclusionResult {
  candidateId: string;
  included: boolean;
  excludedReason?: string;
}

/**
 * Filter candidates and return exclusion results for audit
 *
 * @param candidates - Array of candidates with careerSummary
 * @returns Filtered candidates and exclusion audit results
 */
export function filterCandidatesWithAudit<
  T extends { candidateId: string; careerSummary: string }
>(
  candidates: T[]
): {
  included: T[];
  exclusions: CandidateExclusionResult[];
} {
  const included: T[] = [];
  const exclusions: CandidateExclusionResult[] = [];

  for (const candidate of candidates) {
    const check = checkCandidateExclusion(candidate.careerSummary);

    if (check.excluded) {
      exclusions.push({
        candidateId: candidate.candidateId,
        included: false,
        excludedReason: check.reason,
      });
    } else {
      included.push(candidate);
      exclusions.push({
        candidateId: candidate.candidateId,
        included: true,
      });
    }
  }

  return { included, exclusions };
}

export default {
  validateCandidateSummary,
  validateEmailBody,
  checkCandidateExclusion,
  maskPiiForLogging,
  filterCandidatesWithAudit,
};
