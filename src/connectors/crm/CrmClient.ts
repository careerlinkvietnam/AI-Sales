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
 * - CRM_AUTH_PATH: Auth endpoint path (optional, defaults to /siankaan0422/login_check)
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
const DEFAULT_AUTH_PATH = '/siankaan0422/login_check';

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
  private sessionCookies: string | null = null;
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
   *
   * Authentication flow (2026-01-27 confirmed):
   * 1. GET /siankaan0421/login to get CSRF token (authenticity_token)
   * 2. POST /siankaan0421/login_check with form data including CSRF token
   * 3. On success: redirects to dashboard (302), session cookies set
   * 4. Store cookies for subsequent API requests
   */
  private async loginWithCredentials(email: string, password: string): Promise<void> {
    // Derive login page URL from auth path (login_check -> login)
    const loginPagePath = this.authPath.replace('_check', '');
    const loginPageUrl = `${this.authHost}${loginPagePath}`;
    const loginCheckUrl = `${this.authHost}${this.authPath}`;

    try {
      // Step 1: GET login page to extract CSRF token
      const loginPageResponse = await fetch(loginPageUrl, {
        method: 'GET',
        headers: {
          'Accept': 'text/html',
        },
      });

      if (!loginPageResponse.ok) {
        throw new AuthError(`Failed to load login page: HTTP ${loginPageResponse.status}`);
      }

      const loginPageHtml = await loginPageResponse.text();

      // Extract CSRF token (authenticity_token)
      const csrfMatch = loginPageHtml.match(/authenticity_token[^>]*value="([^"]+)"/);
      if (!csrfMatch) {
        throw new AuthError('CSRF token not found on login page');
      }
      const csrfToken = csrfMatch[1];

      // Extract initial cookies
      const initialCookies = this.getAllSetCookies(loginPageResponse);

      // Step 2: POST login form with CSRF token
      const formData = new URLSearchParams();
      formData.append('_username', email);
      formData.append('_password', password);
      formData.append('authenticity_token', csrfToken);
      formData.append('target_path', '');

      const loginResponse = await fetch(loginCheckUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Cookie': this.extractCookieString(initialCookies),
        },
        body: formData.toString(),
        redirect: 'manual',
      });

      // Step 3: Check response
      if (loginResponse.status === 302) {
        const location = loginResponse.headers.get('location') || '';

        // If redirecting back to login page, credentials are invalid
        if (location.includes('/login')) {
          throw new AuthError('Invalid email or password');
        }

        // Success! Extract session cookies (new cookies override old)
        const newCookies = this.getAllSetCookies(loginResponse);
        this.sessionCookies = this.mergeCookies(initialCookies, newCookies);

        // Mark as authenticated (use cookie string as "token" indicator)
        if (this.sessionCookies) {
          this.sessionToken = 'cookie-auth';
        }
      } else if (loginResponse.status === 422) {
        throw new AuthError('Login failed: CSRF token invalid or missing');
      } else if (loginResponse.status === 200) {
        // Check if error message in response
        const text = await loginResponse.text();
        if (text.includes('パスワードが違います') || text.includes('invalid')) {
          throw new AuthError('Invalid email or password');
        }
        throw new AuthError('Login failed: unexpected response');
      } else {
        throw new NetworkError(`Login request failed: HTTP ${loginResponse.status}`, loginResponse.status);
      }

      if (!this.sessionCookies) {
        throw new AuthError('Login succeeded but no session cookies received');
      }

      // Step 4: Access executive-search to get _hr_frontend_session cookie
      // This is required for creating sales actions
      await this.initializeHrFrontendSession();

    } catch (error) {
      if (error instanceof AuthError || error instanceof NetworkError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new AuthError(`Login failed: ${message}`);
    }
  }

  /**
   * Initialize HR Frontend session by accessing executive-search pages
   * This sets the _hr_frontend_session cookie required for sales actions
   */
  private async initializeHrFrontendSession(): Promise<void> {
    if (!this.sessionCookies) return;

    try {
      // Access executive-search dashboard
      const esResponse = await fetch(`${this.baseUrl}`, {
        method: 'GET',
        headers: {
          'Accept': 'text/html',
          'Cookie': this.sessionCookies,
        },
        redirect: 'follow',
      });

      const esCookies = this.getAllSetCookies(esResponse);
      if (esCookies) {
        this.sessionCookies = this.mergeCookies(this.sessionCookies, esCookies);
      }
    } catch {
      // Non-fatal: session may still work for some operations
    }
  }

  /**
   * Extract cookie key=value pairs from Set-Cookie header(s)
   * Handles both single header and multiple Set-Cookie headers
   */
  private extractCookieString(setCookieHeader: string | null): string {
    if (!setCookieHeader) return '';

    const cookies: string[] = [];

    // Split by newline or comma (for multiple Set-Cookie values)
    // Be careful not to split on commas within cookie values
    const lines = setCookieHeader.split(/\n|(?<=;\s*),(?=\s*[^;]+=[^;]+)/);

    for (const line of lines) {
      // Extract just the cookie name=value part (before the first semicolon)
      const cookiePart = line.split(';')[0].trim();
      if (cookiePart && cookiePart.includes('=')) {
        cookies.push(cookiePart);
      }
    }

    return cookies.join('; ');
  }

  /**
   * Get all Set-Cookie headers from response
   * Node.js fetch may combine headers differently
   */
  private getAllSetCookies(response: Response): string {
    // Try to get all cookies using getSetCookie if available (Node 18+)
    const headers = response.headers as unknown as { getSetCookie?: () => string[] };
    if (typeof headers.getSetCookie === 'function') {
      return headers.getSetCookie().join('\n');
    }

    // Fallback to standard get
    return response.headers.get('set-cookie') || '';
  }

  /**
   * Merge cookies, with new cookies overriding old ones with the same key
   */
  private mergeCookies(oldCookies: string, newCookies: string): string {
    const cookieMap = new Map<string, string>();

    // Parse old cookies
    for (const part of oldCookies.split(/[;\n]/)) {
      const trimmed = part.trim();
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex);
        const value = trimmed.substring(eqIndex + 1);
        // Skip cookie attributes
        if (!['path', 'domain', 'expires', 'max-age', 'secure', 'httponly', 'samesite'].includes(key.toLowerCase())) {
          cookieMap.set(key, value);
        }
      }
    }

    // Parse new cookies (overriding old)
    for (const line of newCookies.split('\n')) {
      const cookiePart = line.split(';')[0].trim();
      const eqIndex = cookiePart.indexOf('=');
      if (eqIndex > 0) {
        const key = cookiePart.substring(0, eqIndex);
        const value = cookiePart.substring(eqIndex + 1);
        cookieMap.set(key, value);
      }
    }

    return Array.from(cookieMap.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  /**
   * Search companies by raw tag string with pagination support
   *
   * Note: The /companies/tags endpoint returns HTML, not JSON.
   * We parse the HTML to extract company IDs and names.
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
      // Single page fetch (HTML response)
      const html = await this.requestHtml(
        `/companies/tags?tags=${encodeURIComponent(rawTag)}&tag_query_type=${tagQueryType}&page=1`
      );
      return this.parseCompanyListHtml(html);
    }

    // Fetch all pages
    const allCompanies: CompanyStub[] = [];
    let currentPage = 1;

    while (currentPage <= maxPages) {
      const html = await this.requestHtml(
        `/companies/tags?tags=${encodeURIComponent(rawTag)}&tag_query_type=${tagQueryType}&page=${currentPage}`
      );

      const companies = this.parseCompanyListHtml(html);
      allCompanies.push(...companies);

      // Check if we got any companies (less than page size means last page)
      if (companies.length < DEFAULT_PAGE_SIZE) {
        break;
      }

      currentPage++;
    }

    return allCompanies;
  }

  /**
   * Make an HTML request (for endpoints that only return HTML)
   */
  private async requestHtml(path: string): Promise<string> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };

    if (this.sessionCookies) {
      headers['Cookie'] = this.sessionCookies;
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.status === 401 || response.status === 403) {
          if (!this.hasAttemptedReauth) {
            this.hasAttemptedReauth = true;
            this.sessionToken = null;
            this.sessionCookies = null;
            try {
              await this.login();
              return this.requestHtml(path);
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

        return await response.text();

      } catch (error) {
        lastError = error as Error;

        if (error instanceof AuthError) {
          throw error;
        }

        if (error instanceof NetworkError && error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
          throw error;
        }

        if (attempt < this.maxRetries - 1) {
          await this.delay(Math.pow(2, attempt) * 1000);
        }
      }
    }

    throw lastError || new NetworkError('Request failed after retries');
  }

  /**
   * Parse HTML response to extract company list
   * The endpoint returns an HTML page with company links
   */
  private parseCompanyListHtml(html: string): CompanyStub[] {
    const companies: CompanyStub[] = [];

    // Pattern to match company links: /executive-search/vn/companies/{id}">Company Name</a>
    const pattern = /<a[^>]*href="\/executive-search\/vn\/companies\/(\d+)"[^>]*>([^<]+)<\/a>/g;

    let match;
    const seenIds = new Set<string>();

    while ((match = pattern.exec(html)) !== null) {
      const companyId = match[1];
      const fullName = match[2].trim();

      // Skip duplicates (same company may appear multiple times in HTML)
      if (seenIds.has(companyId)) {
        continue;
      }
      seenIds.add(companyId);

      // Parse name (format: "English Name / Japanese Name / Local Name")
      const nameParts = fullName.split(/\s*\/\s*/);
      const name = nameParts[0] || fullName;

      // Extract region from the name or page context if possible
      const region = this.extractRegionFromName(fullName);

      companies.push({
        companyId,
        name,
        region,
        tags: [], // Tags will be populated when fetching details
      });
    }

    return companies;
  }

  /**
   * Extract region from company name if it contains region keywords
   */
  private extractRegionFromName(name: string): string | null {
    const regionPatterns = ['南部', '北部', '中部', '東部', '西部', 'Ho Chi Minh', 'Hanoi', 'Da Nang'];
    for (const region of regionPatterns) {
      if (name.includes(region)) {
        if (region === 'Ho Chi Minh') return '南部';
        if (region === 'Hanoi') return '北部';
        if (region === 'Da Nang') return '中部';
        return region;
      }
    }
    return null;
  }

  /**
   * Get detailed company information
   *
   * Note: The JSON API does not include staff email addresses.
   * We also fetch the HTML page to extract contact emails.
   *
   * @param companyId - Company ID to retrieve
   * @returns Full company details including offices and staff
   */
  async getCompanyDetail(companyId: string): Promise<CompanyDetail> {
    await this.ensureAuthenticated();

    // Get JSON response for basic company data
    const response = await this.request<CrmCompanyDetailResponse>(
      `/companies/${companyId}`
    );

    const detail = this.mapCompanyDetailResponse(response);

    // Also fetch HTML page to extract staff emails (not included in JSON API)
    try {
      const html = await this.requestHtml(`/companies/${companyId}`);
      const staffEmails = this.extractEmailsFromHtml(html);

      // If no contactEmail from JSON but found emails in HTML, use the first one
      if (!detail.contactEmail && staffEmails.length > 0) {
        detail.contactEmail = staffEmails[0];
      }

      // Store all found emails in staffs if empty
      if (detail.staffs && detail.staffs.length === 0 && staffEmails.length > 0) {
        detail.staffs = staffEmails.map((email, idx) => ({
          staffId: `html-${idx}`,
          name: email.split('@')[0], // Use email prefix as name
          email,
          phone: null,
          department: null,
          note: null,
        }));
      }
    } catch {
      // HTML fetch failed, continue with JSON data only
    }

    return detail;
  }

  /**
   * Extract email addresses from HTML page
   * Filters out system emails (careerlink.vn) and cleans up encoded characters
   */
  private extractEmailsFromHtml(html: string): string[] {
    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const allEmails = html.match(emailPattern) || [];

    // Filter out system emails, clean up, and deduplicate
    const cleanedEmails = allEmails
      .map(email => email.replace(/^u003e/i, '')) // Remove HTML encoded '>'
      .filter(email => !email.includes('careerlink.vn'))
      .filter(email => !email.includes('example.com'))
      .filter(email => email.includes('@')); // Ensure still valid

    // Deduplicate
    return [...new Set(cleanedEmails)];
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
   * Create a Tel Action (コールメモ) for a company
   *
   * @param companyId - Company ID
   * @param staffName - Contact person name (e.g., "武井 順也")
   * @param log - Action memo/notes
   * @param place - Office name (optional, e.g., "日本本社")
   * @param performedAt - When the action was performed (default: now)
   * @returns Created action details
   */
  async createTelAction(
    companyId: string,
    staffName: string,
    log: string,
    place?: string,
    performedAt?: Date
  ): Promise<{ id: number; companyId: number; log: string; performedAt: string }> {
    await this.ensureAuthenticated();

    // Get fresh CSRF token from company page
    const companyPageHtml = await this.requestHtml(`/companies/${companyId}`);
    const csrfMatch = companyPageHtml.match(/<meta[^>]*name="csrf-token"[^>]*content="([^"]+)"/);
    if (!csrfMatch) {
      throw new AuthError('CSRF token not found on company page');
    }
    const csrfToken = csrfMatch[1];

    // Build form data
    const timestamp = performedAt
      ? Math.floor(performedAt.getTime() / 1000)
      : Math.floor(Date.now() / 1000);

    const formData = new URLSearchParams();
    formData.append('sales_tel_action[id]', 'new');
    formData.append('sales_tel_action[company_id]', companyId);
    formData.append('sales_tel_action[performed_at]', timestamp.toString());
    formData.append('sales_tel_action[staff_name]', staffName);
    formData.append('sales_tel_action[place]', place || '');
    formData.append('sales_tel_action[add_as_new_office]', '');
    formData.append('sales_tel_action[log]', log);

    const url = `${this.baseUrl}/companies/${companyId}/sales_actions`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'x-csrf-token': csrfToken,
      'x-requested-with': 'XMLHttpRequest',
    };

    if (this.sessionCookies) {
      headers['Cookie'] = this.sessionCookies;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData.toString(),
    });

    if (response.status === 201) {
      const data = await response.json() as {
        id: number;
        company_id: number;
        log: string;
        performed_at: string;
      };
      return {
        id: data.id,
        companyId: data.company_id,
        log: data.log,
        performedAt: data.performed_at,
      };
    } else if (response.status === 422) {
      throw new NetworkError('Failed to create tel action: validation error', 422);
    } else {
      throw new NetworkError(`Failed to create tel action: HTTP ${response.status}`, response.status);
    }
  }

  /**
   * Update a Tel Action (コールメモ)
   *
   * @param companyId - Company ID
   * @param actionId - Action ID to update
   * @param staffName - Contact person name
   * @param log - Updated memo/notes
   * @param place - Office name (optional)
   * @param performedAt - When the action was performed (optional, keeps original if not specified)
   * @returns Updated action details
   */
  async updateTelAction(
    companyId: string,
    actionId: string,
    staffName: string,
    log: string,
    place?: string,
    performedAt?: Date
  ): Promise<{ id: number; companyId: number; log: string; performedAt: string }> {
    await this.ensureAuthenticated();

    // Get fresh CSRF token from company page
    const companyPageHtml = await this.requestHtml(`/companies/${companyId}`);
    const csrfMatch = companyPageHtml.match(/<meta[^>]*name="csrf-token"[^>]*content="([^"]+)"/);
    if (!csrfMatch) {
      throw new AuthError('CSRF token not found on company page');
    }
    const csrfToken = csrfMatch[1];

    // Build form data
    const timestamp = performedAt
      ? Math.floor(performedAt.getTime() / 1000)
      : Math.floor(Date.now() / 1000);

    const formData = new URLSearchParams();
    formData.append('sales_tel_action[id]', actionId);
    formData.append('sales_tel_action[company_id]', companyId);
    formData.append('sales_tel_action[performed_at]', timestamp.toString());
    formData.append('sales_tel_action[staff_name]', staffName);
    formData.append('sales_tel_action[place]', place || '');
    formData.append('sales_tel_action[add_as_new_office]', '');
    formData.append('sales_tel_action[log]', log);

    const url = `${this.baseUrl}/companies/${companyId}/sales_actions/${actionId}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'x-csrf-token': csrfToken,
      'x-requested-with': 'XMLHttpRequest',
    };

    if (this.sessionCookies) {
      headers['Cookie'] = this.sessionCookies;
    }

    const response = await fetch(url, {
      method: 'PATCH',
      headers,
      body: formData.toString(),
    });

    if (response.status === 200) {
      const data = await response.json() as {
        id: number;
        company_id: number;
        log: string;
        performed_at: string;
      };
      return {
        id: data.id,
        companyId: data.company_id,
        log: data.log,
        performedAt: data.performed_at,
      };
    } else if (response.status === 422) {
      throw new NetworkError('Failed to update tel action: validation error', 422);
    } else {
      throw new NetworkError(`Failed to update tel action: HTTP ${response.status}`, response.status);
    }
  }

  /**
   * Get company tags from HTML page
   * Note: JSON API doesn't include tags, so we scrape from HTML
   *
   * @param companyId - Company ID
   * @returns Array of tag strings
   */
  async getCompanyTags(companyId: string): Promise<string[]> {
    await this.ensureAuthenticated();

    const html = await this.requestHtml(`/companies/${companyId}`);
    const tags: string[] = [];

    // Tags are displayed in <span class="tagit-label"> elements
    const tagPattern = /class="tagit-label">([^<]+)</g;
    let match;
    while ((match = tagPattern.exec(html)) !== null) {
      const tag = match[1].trim();
      if (tag && !tags.includes(tag)) {
        tags.push(tag);
      }
    }

    return tags;
  }

  /**
   * Update company month tag (e.g., "南部・1月連絡" → "南部・4月連絡")
   * Adds 3 months to the current month tag
   *
   * @param companyId - Company ID
   * @returns Updated tag info or null if no month tag found
   */
  async updateMonthTag(
    companyId: string
  ): Promise<{ oldTag: string; newTag: string; allTags: string[] } | null> {
    const currentTags = await this.getCompanyTags(companyId);

    // Find month tag pattern: 南部・X月連絡, 北部・X月連絡, 中部・X月連絡
    const monthTagPattern = /^(南部|北部|中部)・(\d{1,2})月連絡$/;
    let oldTag: string | null = null;
    let newTag: string | null = null;

    for (const tag of currentTags) {
      const match = tag.match(monthTagPattern);
      if (match) {
        const region = match[1];
        const currentMonth = parseInt(match[2], 10);
        const newMonth = ((currentMonth - 1 + 3) % 12) + 1; // Add 3 months
        oldTag = tag;
        newTag = `${region}・${newMonth}月連絡`;
        break;
      }
    }

    if (!oldTag || !newTag) {
      return null;
    }

    // Replace old tag with new
    const newTags = currentTags.map(t => (t === oldTag ? newTag! : t));
    await this.updateCompanyTags(companyId, newTags);

    return { oldTag, newTag, allTags: newTags };
  }

  /**
   * Update company tags
   *
   * @param companyId - Company ID
   * @param tags - Array of tag strings (replaces all existing tags)
   * @returns Updated company info
   */
  async updateCompanyTags(
    companyId: string,
    tags: string[]
  ): Promise<{ companyId: string; tags: string[] }> {
    await this.ensureAuthenticated();

    // Get CSRF token from edit page
    const editPageHtml = await this.requestHtml(`/companies/${companyId}/edit`);
    const csrfMatch = editPageHtml.match(/<input[^>]*name="authenticity_token"[^>]*value="([^"]+)"/);
    if (!csrfMatch) {
      throw new AuthError('CSRF token not found on edit page');
    }
    const csrfToken = csrfMatch[1];

    // Build form data
    const formData = new URLSearchParams();
    formData.append('_method', 'patch');
    formData.append('authenticity_token', csrfToken);
    formData.append('company[vn_tag_list]', tags.join(','));

    const url = `${this.baseUrl}/companies/${companyId}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };

    if (this.sessionCookies) {
      headers['Cookie'] = this.sessionCookies;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData.toString(),
      redirect: 'manual',
    });

    // Rails returns 302 redirect on successful update
    if (response.status === 302 || response.status === 200) {
      return {
        companyId,
        tags,
      };
    } else if (response.status === 422) {
      const text = await response.text();
      throw new NetworkError(`Failed to update tags: validation error - ${text.substring(0, 200)}`, 422);
    } else {
      throw new NetworkError(`Failed to update tags: HTTP ${response.status}`, response.status);
    }
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

    // Use cookie-based auth if available, otherwise use token header
    if (this.sessionCookies) {
      headers['Cookie'] = this.sessionCookies;
    } else if (this.sessionToken && this.sessionToken !== 'cookie-auth') {
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
            this.sessionCookies = null;
            try {
              await this.login();
              // Retry the request with new credentials
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
