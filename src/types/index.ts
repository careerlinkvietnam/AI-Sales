/**
 * Core type definitions for AI-Sales CRM Connector
 * These types correspond to the JSON Schemas in src/schemas/
 */

// ============================================================
// Company Types
// ============================================================

export interface CompanyStub {
  companyId: string;
  name: string;
  region?: string | null;
  tags?: string[];
}

export interface Office {
  officeId: string;
  name?: string | null;
  address?: string | null;
  province?: string | null;
  phone?: string | null;
  contactEmail?: string | null;
  contactPerson?: string | null;
}

export interface Staff {
  staffId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  department?: string | null;
  note?: string | null;
}

export interface CompanyDetail {
  companyId: string;
  name: string;
  nameEn?: string | null;
  nameJa?: string | null;
  nameLocal?: string | null;
  profile?: string | null;
  size?: string | null;
  url?: string | null;
  region?: string | null;
  province?: string | null;
  address?: string | null;
  phone?: string | null;
  contactEmail?: string | null;
  contactPerson?: string | null;
  tags?: string[];
  offices?: Office[];
  staffs?: Staff[];
  createdAt?: string;
  updatedAt?: string;
}

// ============================================================
// Contact History Types
// ============================================================

export type ContactActionType = 'tel' | 'visit' | 'contract' | 'others';

export interface ContactHistoryItem {
  actionId: string;
  actionType: ContactActionType;
  performedAt: string;
  agentId?: string | null;
  agentName?: string | null;
  staffId?: string | null;
  staffName?: string | null;
  place?: string | null;
  summary?: string | null;
  createdAt?: string;
}

export interface ContactHistory {
  companyId: string;
  items: ContactHistoryItem[];
  totalCount?: number;
}

// ============================================================
// Tag Types
// ============================================================

export interface NormalizedTag {
  rawTag: string;
  region?: string | null;
  contactMonth?: number | null;
  contactYear?: number | null;
  contactDate?: string | null;
  isContactTag: boolean;
  otherAttributes?: Record<string, string>;
}

export interface TagParseResult {
  success: boolean;
  normalized?: NormalizedTag;
  error?: string | null;
}

// ============================================================
// Error Types
// ============================================================

export class CrmError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'CrmError';
  }
}

export class AuthError extends CrmError {
  constructor(message: string = 'Authentication failed') {
    super(message, 'AUTH_ERROR');
    this.name = 'AuthError';
  }
}

export class ValidationError extends CrmError {
  constructor(message: string, public readonly details?: Record<string, string[]>) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class NetworkError extends CrmError {
  constructor(message: string, public readonly statusCode?: number) {
    super(message, 'NETWORK_ERROR');
    this.name = 'NetworkError';
  }
}

export class ConfigurationError extends CrmError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigurationError';
  }
}

// ============================================================
// CRM Client Configuration
// ============================================================

export interface CrmClientConfig {
  baseUrl: string;
  sessionToken?: string;
  timeout?: number;
  maxRetries?: number;
}

// ============================================================
// Company Profile Types (facts/assumptions separation)
// ============================================================

export interface CompanyProfileFacts {
  companyId: string;
  companyName: string;
  location: {
    region?: string | null;
    province?: string | null;
    address?: string | null;
  };
  industryText?: string | null;
  tags: string[];
  contactHistoryExcerpt: {
    lastContactDate?: string | null;
    lastContactType?: ContactActionType | null;
    recentTopics: string[];
    totalContacts: number;
  };
}

export interface CompanyProfileSummaries {
  industrySummary?: string | null;
  pastContactsSummary?: string | null;
}

export interface CompanyProfile {
  facts: CompanyProfileFacts;
  summaries: CompanyProfileSummaries;
  assumptions: string[];
  sourceRefs: {
    companyId: string;
    timelineItemIds?: string[];
  };
}

// ============================================================
// Candidate Types (B案仕様: career_summary含む)
// ============================================================

export interface CandidateRationale {
  reasonTags: string[];
  evidenceFields: string[];
}

export interface Candidate {
  candidateId: string;
  headline: string;
  /** 経歴要約（200-300文字程度、最大400文字）。PIIを含めない */
  careerSummary: string;
  keySkills: string[];
  location?: string | null;
  availability?: string | null;
  /** 経験年数 */
  yearsOfExperience?: number | null;
  /** 現職/直近の職種（会社名は含めない） */
  jobTitle?: string | null;
  /** 業界経験 */
  industryExperience?: string | null;
  rationale: CandidateRationale;
}

// ============================================================
// Email Types
// ============================================================

export interface EmailOutput {
  subject: string;
  body: string;
  to?: string;
}

// ============================================================
// Gmail Types
// ============================================================

export interface GmailDraftResult {
  draftId: string;
  messageId?: string;
  threadId?: string;
}
