/**
 * CRM Client for CareerLink HR Frontend
 *
 * Provides methods to interact with the CRM API:
 * - Authentication via X-Cl-Session-Admin header
 * - Company search by tags (with pagination)
 * - Company detail retrieval
 * - Contact history retrieval
 *
 * Required Environment Variables:
 * - CRM_BASE_URL: CRM API base URL (required)
 * - CRM_AUTH_HOST: Auth service host (optional, defaults to CRM_BASE_URL origin)
 * - CRM_AUTH_PATH: Auth endpoint path (optional, defaults to /siankaan0422/sessions)
 *
 * Authentication (one required):
 * - CRM_SESSION_TOKEN: Pre-existing session token
 * - CRM_LOGIN_EMAIL + CRM_LOGIN_PASSWORD: Credentials for login
 */

import {
  CompanyStub,
  CompanyDetail,
  ContactHistoryItem,
  ContactHistory,
  CrmClientConfig,
  AuthError,
  NetworkError,
  ConfigurationError,
  ContactActionType,
} from '../../types';

// Default configuration
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_PAGE_SIZE = 10;
const DEFAULT_AUTH_PATH = '/siankaan0422/sessions';

/**
 * Validate required environment variables
 * Throws ConfigurationError if missing
 */
export function validateCrmConfig(): void {
  const baseUrl = process.env.CRM_BASE_URL;
  if (!baseUrl) {
    throw new ConfigurationError(
      'CRM_BASE_URL is required. Set it in .env or environment variables.'
    );
  }

  // Validate URL format
  try {
    new URL(baseUrl);
  } catch {
    throw new ConfigurationError(
      `CRM_BASE_URL is not a valid URL: ${baseUrl}`
    );
  }

  // Check auth configuration
  const hasToken = !!process.env.CRM_SESSION_TOKEN;
  const hasCredentials = !!(process.env.CRM_LOGIN_EMAIL && process.env.CRM_LOGIN_PASSWORD);

  if (!hasToken && !hasCredentials) {
    throw new ConfigurationError(
      'Authentication not configured. Set CRM_SESSION_TOKEN, ' +
      'or both CRM_LOGIN_EMAIL and CRM_LOGIN_PASSWORD.'
    );
  }
}

/**
 * Maps CRM action types to our normalized types
 */
function mapActionType(crmType: string): ContactActionType {
  const typeMap: Record<string, ContactActionType> = {
    'Sales::TelAction': 'tel',
    'Sales::VisitAction': 'visit',
    'Sales::ContractAction': 'contract',
    'Sales::OthersAction': 'others',
  };
  return typeMap[crmType] || 'others';
}

/**
 * Masks PII in log content for safe display/logging
 */
function maskPii(text: string | null | undefined): string | null {
  if (!text) return null;

  // Mask email addresses
  let masked = text.replace(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    '[EMAIL]'
  );

  // Mask phone numbers (various formats)
  masked = masked.replace(
    /(\+?\d{1,4}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{2,4}[-.\s]?\d{2,4}/g,
    '[PHONE]'
  );

  return masked;
}

export interface SearchOptions {
  /** Fetch all pages (default: true) */
  fetchAll?: boolean;
  /** Maximum pages to fetch when fetchAll is true (default: 100) */
  maxPages?: number;
  /** Tag query type: 'and' or 'or' (default: 'and') */
  tagQueryType?: 'and' | 'or';
}

export class CrmClient {
  private readonly baseUrl: string;
  private readonly authHost: string;
  private readonly authPath: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private sessionToken: string | null = null;
  private hasAttemptedReauth = false;

  constructor(config: CrmClientConfig) {
    // Validate config
    if (!config.baseUrl) {
      throw new ConfigurationError('baseUrl is required in CrmClientConfig');
    }

    this.baseUrl = config.baseUrl.replace(/\/$/, '');

    // Auth host: use CRM_AUTH_HOST env, or extract origin from baseUrl
    const baseUrlObj = new URL(this.baseUrl);
    this.authHost = process.env.CRM_AUTH_HOST || baseUrlObj.origin;

    // Auth path: configurable via environment variable
    this.authPath = process.env.CRM_AUTH_PATH || DEFAULT_AUTH_PATH;

    this.timeout = config.timeout || DEFAULT_TIMEOUT;
    this.maxRetries = config.maxRetries || DEFAULT_MAX_RETRIES;

    if (config.sessionToken) {
      this.sessionToken = config.sessionToken;
    }
  }

  /**
   * Create a CrmClient with environment validation
   * Use this factory method for CLI/production use
   */
  static createFromEnv(): CrmClient {
    validateCrmConfig();

    const baseUrl = process.env.CRM_BASE_URL!;
    return new CrmClient({ baseUrl });
  }

  /**
   * Initialize session - tries multiple authentication methods
   *
   * Priority:
   * 1. Use existing sessionToken from config
   * 2. Use CRM_SESSION_TOKEN from environment
   * 3. Login with CRM_LOGIN_EMAIL + CRM_LOGIN_PASSWORD
   */
  async login(): Promise<void> {
    // 1. Already have token from config
    if (this.sessionToken) {
      return;
    }

    // 2. Try to get token from environment
    const envToken = process.env.CRM_SESSION_TOKEN;
    if (envToken) {
      this.sessionToken = envToken;
      return;
    }

    // 3. Try ID/PASS login
    const email = process.env.CRM_LOGIN_EMAIL;
    const password = process.env.CRM_LOGIN_PASSWORD;

    if (email && password) {
      await this.loginWithCredentials(email, password);
      return;
    }

    // No authentication method available
    throw new AuthError(
      'No authentication method available. Set CRM_SESSION_TOKEN, ' +
      'or CRM_LOGIN_EMAIL + CRM_LOGIN_PASSWORD environment variables.'
    );
  }

  /**
   * Login with email/password to external auth service
   */
  private async loginWithCredentials(email: string, password: string): Promise<void> {
    const loginUrl = `${this.authHost}${this.authPath}`;

    try {
      const response = await fetch(loginUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          admin_session: {
            email,
            password,
          },
        }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new AuthError('Invalid email or password');
        }
        if (response.status === 403) {
          throw new AuthError('Account is locked or disabled');
        }
        if (response.status === 404) {
          throw new AuthError(`Auth endpoint not found: ${this.authPath}`);
        }
        throw new NetworkError(`Login request failed: HTTP ${response.status}`, response.status);
      }

      // Try to extract token from response
      const data = await response.json() as {
        session_token?: string;
        token?: string;
        admin?: Record<string, unknown>;
      };

      // Token might be in response body or set-cookie header
      if (data.session_token) {
        this.sessionToken = data.session_token;
      } else if (data.token) {
        this.sessionToken = data.token;
      } else if (data.admin) {
        // Token might be the base64-encoded admin data itself
        this.sessionToken = Buffer.from(JSON.stringify(data.admin)).toString('base64');
      } else {
        // Check for Set-Cookie header
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) {
          const tokenMatch = setCookie.match(/session[_-]?token=([^;]+)/i);
          if (tokenMatch) {
            this.sessionToken = tokenMatch[1];
          }
        }
      }

      if (!this.sessionToken) {
        throw new AuthError('Login succeeded but no session token received in response');
      }

    } catch (error) {
      if (error instanceof AuthError || error instanceof NetworkError) {
        throw error;
      }
      // Network/fetch errors
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new AuthError(`Login failed: ${message}`);
    }
  }

  /**
   * Search companies by raw tag string with pagination support
   *
   * @param rawTag - Tag to search for (e.g., "南部・3月連絡")
   * @param options - Search options (fetchAll, maxPages, tagQueryType)
   * @returns Array of matching companies (stub info only)
   */
  async searchCompaniesByRawTag(
    rawTag: string,
    options: SearchOptions = {}
  ): Promise<CompanyStub[]> {
    await this.ensureAuthenticated();

    const { fetchAll = true, maxPages = 100, tagQueryType = 'and' } = options;

    if (!fetchAll) {
      // Single page fetch
      const response = await this.request<CrmCompanyListResponse>(
        `/companies/tags?tags=${encodeURIComponent(rawTag)}&tag_query_type=${tagQueryType}&page=1`
      );
      return this.mapCompanyListResponse(response);
    }

    // Fetch all pages
    const allCompanies: CompanyStub[] = [];
    let currentPage = 1;
    let totalCount = 0;

    while (currentPage <= maxPages) {
      const response = await this.request<CrmCompanyListResponse>(
        `/companies/tags?tags=${encodeURIComponent(rawTag)}&tag_query_type=${tagQueryType}&page=${currentPage}`
      );

      const companies = this.mapCompanyListResponse(response);
      allCompanies.push(...companies);

      // Get total count from response (first page)
      if (currentPage === 1) {
        totalCount = response.num_companies || response.total_count || companies.length;
      }

      // Check if we have all companies
      if (companies.length < DEFAULT_PAGE_SIZE || allCompanies.length >= totalCount) {
        break;
      }

      currentPage++;
    }

    return allCompanies;
  }

  /**
   * Get detailed company information
   *
   * @param companyId - Company ID to retrieve
   * @returns Full company details including offices and staff
   */
  async getCompanyDetail(companyId: string): Promise<CompanyDetail> {
    await this.ensureAuthenticated();

    const response = await this.request<CrmCompanyDetailResponse>(
      `/companies/${companyId}`
    );

    return this.mapCompanyDetailResponse(response);
  }

  /**
   * Get contact history for a company
   *
   * @param companyId - Company ID to retrieve history for
   * @returns Contact history items (PII masked)
   */
  async getCompanyContactHistory(companyId: string): Promise<ContactHistory> {
    await this.ensureAuthenticated();

    // Contact history is part of the timeline endpoint
    const response = await this.request<CrmTimelineResponse>(
      `/timeline/companies/${companyId}`
    );

    return this.mapTimelineToContactHistory(companyId, response);
  }

  /**
   * Check if currently authenticated
   */
  isAuthenticated(): boolean {
    return this.sessionToken !== null;
  }

  /**
   * Clear current session (for testing or forced re-auth)
   */
  clearSession(): void {
    this.sessionToken = null;
    this.hasAttemptedReauth = false;
  }

  // ============================================================
  // Private Methods
  // ============================================================

  private async ensureAuthenticated(): Promise<void> {
    if (!this.sessionToken) {
      await this.login();
    }
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };

    if (this.sessionToken) {
      headers['X-Cl-Session-Admin'] = this.sessionToken;
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url, {
          ...options,
          headers,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.status === 401 || response.status === 403) {
          // Auth error - try re-auth once only
          if (!this.hasAttemptedReauth) {
            this.hasAttemptedReauth = true;
            this.sessionToken = null;
            try {
              await this.login();
              // Retry the request with new token
              return this.request<T>(path, options);
            } catch {
              throw new AuthError('Session expired and re-authentication failed');
            }
          }
          throw new AuthError('Session expired or invalid (re-auth already attempted)');
        }

        if (!response.ok) {
          throw new NetworkError(
            `HTTP ${response.status}: ${response.statusText}`,
            response.status
          );
        }

        return await response.json() as T;

      } catch (error) {
        lastError = error as Error;

        if (error instanceof AuthError) {
          throw error;
        }

        // Don't retry on client errors (4xx except 401/403 which are handled above)
        if (error instanceof NetworkError && error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
          throw error;
        }

        // Exponential backoff for retries
        if (attempt < this.maxRetries - 1) {
          await this.delay(Math.pow(2, attempt) * 1000);
        }
      }
    }

    throw lastError || new NetworkError('Request failed after retries');
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================================
  // Response Mapping Methods
  // ============================================================

  private mapCompanyListResponse(response: CrmCompanyListResponse): CompanyStub[] {
    // Handle different response formats
    const companies = response.companies || response.data || [];

    if (!Array.isArray(companies)) {
      return [];
    }

    return companies.map(company => ({
      companyId: String(company.id),
      name: company.name_ja || company.name_en || company.name_local || `Company ${company.id}`,
      region: this.extractRegionFromTags(company.tags_snapshot),
      tags: this.parseTagsSnapshot(company.tags_snapshot),
    }));
  }

  private mapCompanyDetailResponse(response: CrmCompanyDetailResponse): CompanyDetail {
    const company = response.company || response;

    return {
      companyId: String(company.id),
      name: company.name_ja || company.name_en || company.name_local || `Company ${company.id}`,
      nameEn: company.name_en || null,
      nameJa: company.name_ja || null,
      nameLocal: company.name_local || null,
      profile: company.profile || null,
      size: company.size || null,
      url: company.url || null,
      region: this.extractRegionFromTags(company.tags_snapshot),
      province: company.province_name || null,
      address: company.address || null,
      phone: company.phone || null,
      contactEmail: company.contact_email || null,
      contactPerson: company.contact_person || null,
      tags: this.parseTagsSnapshot(company.tags_snapshot),
      offices: (company.offices || []).map((office: CrmOffice) => ({
        officeId: String(office.id),
        name: office.name || null,
        address: office.address || null,
        province: office.province_name || null,
        phone: office.phone || null,
        contactEmail: office.contact_email || null,
        contactPerson: office.contact_person || null,
      })),
      staffs: (company.staffs || []).map((staff: CrmStaff) => ({
        staffId: String(staff.id),
        name: staff.name,
        email: staff.email || null,
        phone: staff.phone || null,
        department: staff.department || null,
        note: maskPii(staff.note),
      })),
      createdAt: company.created_at,
      updatedAt: company.updated_at,
    };
  }

  private mapTimelineToContactHistory(
    companyId: string,
    response: CrmTimelineResponse
  ): ContactHistory {
    const items: ContactHistoryItem[] = [];

    // Extract sales actions from timeline
    const salesActions = response.sales_actions || response.timeline?.sales_actions || [];

    for (const action of salesActions) {
      items.push({
        actionId: String(action.id),
        actionType: mapActionType(action.type),
        performedAt: action.performed_at,
        agentId: action.agent_id ? String(action.agent_id) : null,
        agentName: action.agent_name || null,
        staffId: action.staff_id ? String(action.staff_id) : null,
        staffName: action.staff_name || null,
        place: action.place || null,
        summary: maskPii(action.log),
        createdAt: action.created_at,
      });
    }

    // Sort by performed_at descending
    items.sort((a, b) =>
      new Date(b.performedAt).getTime() - new Date(a.performedAt).getTime()
    );

    return {
      companyId,
      items,
      totalCount: items.length,
    };
  }

  private parseTagsSnapshot(tagsSnapshot: string | null | undefined): string[] {
    if (!tagsSnapshot) return [];
    return tagsSnapshot.split(',').map(tag => tag.trim()).filter(Boolean);
  }

  private extractRegionFromTags(tagsSnapshot: string | null | undefined): string | null {
    const tags = this.parseTagsSnapshot(tagsSnapshot);
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
}

// ============================================================
// CRM Response Types (internal)
// ============================================================

interface CrmCompanyListResponse {
  companies?: CrmCompanyStub[];
  data?: CrmCompanyStub[];
  num_companies?: number;
  total_count?: number;
  page?: number;
  per_page?: number;
}

interface CrmCompanyStub {
  id: number;
  name_en?: string;
  name_ja?: string;
  name_local?: string;
  tags_snapshot?: string;
}

interface CrmCompanyDetailResponse {
  company?: CrmCompanyFull;
  id?: number;
  name_en?: string;
  name_ja?: string;
  name_local?: string;
  profile?: string;
  size?: string;
  url?: string;
  province_name?: string;
  address?: string;
  phone?: string;
  contact_email?: string;
  contact_person?: string;
  tags_snapshot?: string;
  offices?: CrmOffice[];
  staffs?: CrmStaff[];
  created_at?: string;
  updated_at?: string;
}

interface CrmCompanyFull {
  id: number;
  name_en?: string;
  name_ja?: string;
  name_local?: string;
  profile?: string;
  size?: string;
  url?: string;
  province_name?: string;
  address?: string;
  phone?: string;
  contact_email?: string;
  contact_person?: string;
  tags_snapshot?: string;
  offices?: CrmOffice[];
  staffs?: CrmStaff[];
  created_at?: string;
  updated_at?: string;
}

interface CrmOffice {
  id: number;
  name?: string;
  address?: string;
  province_name?: string;
  phone?: string;
  contact_email?: string;
  contact_person?: string;
}

interface CrmStaff {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  department?: string;
  note?: string;
}

interface CrmTimelineResponse {
  sales_actions?: CrmSalesAction[];
  timeline?: {
    sales_actions?: CrmSalesAction[];
  };
}

interface CrmSalesAction {
  id: number;
  type: string;
  performed_at: string;
  agent_id?: number;
  agent_name?: string;
  staff_id?: number;
  staff_name?: string;
  place?: string;
  log?: string;
  created_at?: string;
}

export default CrmClient;
