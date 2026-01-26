/**
 * Gmail Client for Draft Creation and Message Search
 *
 * IMPORTANT: This client supports:
 * - Draft creation
 * - Sent/Reply message search (for tracking)
 *
 * Send functionality is intentionally NOT implemented.
 * All emails must be reviewed by humans before sending.
 *
 * Required Environment Variables:
 * - GMAIL_CLIENT_ID: OAuth2 client ID
 * - GMAIL_CLIENT_SECRET: OAuth2 client secret
 * - GMAIL_REFRESH_TOKEN: OAuth2 refresh token
 */

import { GmailDraftResult, ConfigurationError } from '../../types';

/**
 * Gmail message search result
 */
export interface GmailSearchResult {
  /** Thread ID */
  threadId: string;
  /** Message ID */
  messageId: string;
  /** Internal date (Unix timestamp in ms) */
  internalDate: number;
  /** ISO date string */
  dateIso: string;
}

/**
 * Gmail thread metadata
 */
export interface GmailThreadMetadata {
  /** Thread ID */
  threadId: string;
  /** Number of messages in thread */
  messageCount: number;
  /** Last message date (ISO) */
  lastMessageDate: string;
}

/**
 * Validate Gmail configuration
 */
export function validateGmailConfig(): void {
  const required = ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new ConfigurationError(
      `Gmail not configured. Missing: ${missing.join(', ')}. ` +
      'See docs/runbook.md for setup instructions.'
    );
  }
}

/**
 * Check if Gmail is configured (without throwing)
 */
export function isGmailConfigured(): boolean {
  return !!(
    process.env.GMAIL_CLIENT_ID &&
    process.env.GMAIL_CLIENT_SECRET &&
    process.env.GMAIL_REFRESH_TOKEN
  );
}

export class GmailClient {
  private readonly isStub: boolean;
  private accessToken: string | null = null;

  constructor() {
    // Use stub mode if Gmail is not configured
    this.isStub = !isGmailConfigured();
  }

  /**
   * Create a draft email (NO SEND FUNCTIONALITY)
   *
   * @param to - Recipient email address
   * @param subject - Email subject
   * @param body - Email body (plain text)
   * @param threadId - Optional thread ID to reply to
   * @returns Draft creation result with draftId
   */
  async createDraft(
    to: string,
    subject: string,
    body: string,
    threadId?: string
  ): Promise<GmailDraftResult> {
    if (this.isStub) {
      return this.createStubDraft(to, subject, body, threadId);
    }

    // Validate config
    validateGmailConfig();

    // Get access token
    await this.ensureAccessToken();

    // Create the draft
    return this.createRealDraft(to, subject, body, threadId);
  }

  /**
   * Check if running in stub mode
   */
  isStubMode(): boolean {
    return this.isStub;
  }

  /**
   * Search for a sent message by tracking ID
   *
   * @param trackingId - The tracking ID (e.g., "a1b2c3d4")
   * @returns Search result or null if not found
   */
  async searchSentByTrackingId(trackingId: string): Promise<GmailSearchResult | null> {
    if (this.isStub) {
      return this.stubSearchSent(trackingId);
    }

    validateGmailConfig();
    await this.ensureAccessToken();

    // Search in sent folder for the tracking tag
    // Use quotes to search for exact phrase
    const query = `in:sent "[CL-AI:${trackingId}]"`;
    return this.searchMessages(query);
  }

  /**
   * Search for inbox replies by tracking ID
   *
   * @param trackingId - The tracking ID (e.g., "a1b2c3d4")
   * @returns Search result or null if not found
   */
  async searchInboxRepliesByTrackingId(trackingId: string): Promise<GmailSearchResult | null> {
    if (this.isStub) {
      return this.stubSearchReply(trackingId);
    }

    validateGmailConfig();
    await this.ensureAccessToken();

    // Search in inbox for messages containing the tracking tag
    // These would be replies from the recipient
    const query = `in:inbox "[CL-AI:${trackingId}]"`;
    return this.searchMessages(query);
  }

  /**
   * Get thread metadata (message count, last message date)
   *
   * @param threadId - Gmail thread ID
   * @returns Thread metadata or null if not found
   */
  async getThreadMetadata(threadId: string): Promise<GmailThreadMetadata | null> {
    if (this.isStub) {
      return this.stubGetThreadMetadata(threadId);
    }

    validateGmailConfig();
    await this.ensureAccessToken();

    try {
      const response = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=metadata&metadataHeaders=Date`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
          },
        }
      );

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`Failed to get thread: HTTP ${response.status}`);
      }

      const data = await response.json() as {
        id: string;
        messages: Array<{ id: string; internalDate: string }>;
      };

      const messageCount = data.messages.length;
      const lastMessage = data.messages[data.messages.length - 1];
      const lastMessageDate = new Date(parseInt(lastMessage.internalDate, 10)).toISOString();

      return {
        threadId: data.id,
        messageCount,
        lastMessageDate,
      };
    } catch {
      return null;
    }
  }

  // ============================================================
  // Private Methods
  // ============================================================

  /**
   * Search messages using Gmail API query
   */
  private async searchMessages(query: string): Promise<GmailSearchResult | null> {
    try {
      const encodedQuery = encodeURIComponent(query);
      const response = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodedQuery}&maxResults=1`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Search failed: HTTP ${response.status}`);
      }

      const data = await response.json() as {
        messages?: Array<{ id: string; threadId: string }>;
      };

      if (!data.messages || data.messages.length === 0) {
        return null;
      }

      // Get message metadata (NOT body) for the internal date
      const messageId = data.messages[0].id;
      const metadataResponse = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=metadata`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
          },
        }
      );

      if (!metadataResponse.ok) {
        throw new Error(`Failed to get message metadata: HTTP ${metadataResponse.status}`);
      }

      const messageData = await metadataResponse.json() as {
        id: string;
        threadId: string;
        internalDate: string;
      };

      const internalDate = parseInt(messageData.internalDate, 10);

      return {
        threadId: messageData.threadId,
        messageId: messageData.id,
        internalDate,
        dateIso: new Date(internalDate).toISOString(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Stub: Search sent by tracking ID
   */
  private stubSearchSent(trackingId: string): GmailSearchResult | null {
    // In stub mode, simulate not finding sent messages
    // Tests can override this behavior
    console.log(`[Gmail Stub] searchSentByTrackingId: ${trackingId}`);
    return null;
  }

  /**
   * Stub: Search reply by tracking ID
   */
  private stubSearchReply(trackingId: string): GmailSearchResult | null {
    // In stub mode, simulate not finding replies
    console.log(`[Gmail Stub] searchInboxRepliesByTrackingId: ${trackingId}`);
    return null;
  }

  /**
   * Stub: Get thread metadata
   */
  private stubGetThreadMetadata(threadId: string): GmailThreadMetadata | null {
    console.log(`[Gmail Stub] getThreadMetadata: ${threadId}`);
    return {
      threadId,
      messageCount: 1,
      lastMessageDate: new Date().toISOString(),
    };
  }

  /**
   * Create a stub draft (for testing without Gmail)
   */
  private createStubDraft(
    to: string,
    subject: string,
    body: string,
    threadId?: string
  ): GmailDraftResult {
    // Generate a fake draft ID
    const timestamp = Date.now();
    const draftId = `stub-draft-${timestamp}`;
    const messageId = `stub-msg-${timestamp}`;

    // Log the draft details (for debugging)
    console.log('[Gmail Stub] Draft created:');
    console.log(`  To: ${to}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Body length: ${body.length} chars`);
    if (threadId) {
      console.log(`  Thread: ${threadId}`);
    }

    return {
      draftId,
      messageId,
      threadId: threadId || `stub-thread-${timestamp}`,
    };
  }

  /**
   * Ensure we have a valid access token
   */
  private async ensureAccessToken(): Promise<void> {
    if (this.accessToken) {
      return;
    }

    await this.refreshAccessToken();
  }

  /**
   * Refresh the OAuth2 access token
   */
  private async refreshAccessToken(): Promise<void> {
    const clientId = process.env.GMAIL_CLIENT_ID!;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET!;
    const refreshToken = process.env.GMAIL_REFRESH_TOKEN!;

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to refresh Gmail token: HTTP ${response.status}`);
    }

    const data = await response.json() as { access_token: string };
    this.accessToken = data.access_token;
  }

  /**
   * Create a real draft via Gmail API
   */
  private async createRealDraft(
    to: string,
    subject: string,
    body: string,
    threadId?: string
  ): Promise<GmailDraftResult> {
    // Build the email in RFC 2822 format
    const email = this.buildRfc2822Email(to, subject, body);

    // Base64url encode the email
    const encodedEmail = Buffer.from(email)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // Build the request body
    const requestBody: {
      message: { raw: string; threadId?: string };
    } = {
      message: {
        raw: encodedEmail,
      },
    };

    if (threadId) {
      requestBody.message.threadId = threadId;
    }

    // Call Gmail API
    const response = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/drafts',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create draft: HTTP ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      id: string;
      message: { id: string; threadId: string };
    };

    return {
      draftId: data.id,
      messageId: data.message.id,
      threadId: data.message.threadId,
    };
  }

  /**
   * Build an RFC 2822 formatted email
   */
  private buildRfc2822Email(to: string, subject: string, body: string): string {
    const lines: string[] = [];

    lines.push(`To: ${to}`);
    lines.push(`Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`);
    lines.push('MIME-Version: 1.0');
    lines.push('Content-Type: text/plain; charset=UTF-8');
    lines.push('');
    lines.push(body);

    return lines.join('\r\n');
  }

  // ============================================================
  // INTENTIONALLY NOT IMPLEMENTED: send()
  // All emails must be reviewed by humans before sending.
  // ============================================================
}

export default GmailClient;
