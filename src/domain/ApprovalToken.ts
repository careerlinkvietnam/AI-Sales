/**
 * Approval Token for Draft Send Authorization
 *
 * Provides HMAC-based token generation and verification for future
 * email send functionality. Currently draft-only (send is not implemented).
 *
 * 設計:
 * - HMAC-SHA256で署名
 * - トークンには: draftId, companyId, timestamp を含む
 * - 有効期限あり（デフォルト24時間）
 * - send実装時の入口として準備
 *
 * 注意: send機能はまだ実装しない（draft作成のみ）
 */

import * as crypto from 'crypto';

/**
 * Token payload structure
 */
export interface ApprovalTokenPayload {
  /** Gmail draft ID */
  draftId: string;
  /** Company ID */
  companyId: string;
  /** Token creation timestamp */
  createdAt: string;
  /** Token expiration timestamp */
  expiresAt: string;
  /** Number of candidates in the email */
  candidateCount: number;
  /** Operation mode */
  mode: 'stub' | 'real';
}

/**
 * Token verification result
 */
export interface TokenVerificationResult {
  valid: boolean;
  expired: boolean;
  payload?: ApprovalTokenPayload;
  error?: string;
}

/**
 * Default token TTL in milliseconds (24 hours)
 */
const DEFAULT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Environment variable for HMAC secret
 */
const SECRET_ENV_VAR = 'APPROVAL_TOKEN_SECRET';

/**
 * Approval Token Manager
 */
export class ApprovalTokenManager {
  private readonly secret: string;
  private readonly ttlMs: number;

  constructor(options?: { secret?: string; ttlMs?: number }) {
    this.secret =
      options?.secret ||
      process.env[SECRET_ENV_VAR] ||
      this.generateDefaultSecret();
    this.ttlMs = options?.ttlMs || DEFAULT_TOKEN_TTL_MS;
  }

  /**
   * Generate an approval token for a draft
   */
  generateToken(data: {
    draftId: string;
    companyId: string;
    candidateCount: number;
    mode: 'stub' | 'real';
  }): string {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.ttlMs);

    const payload: ApprovalTokenPayload = {
      draftId: data.draftId,
      companyId: data.companyId,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      candidateCount: data.candidateCount,
      mode: data.mode,
    };

    // Encode payload as base64
    const payloadStr = JSON.stringify(payload);
    const payloadB64 = Buffer.from(payloadStr).toString('base64url');

    // Generate HMAC signature
    const signature = this.sign(payloadB64);

    // Return token as payload.signature
    return `${payloadB64}.${signature}`;
  }

  /**
   * Verify and decode an approval token
   */
  verifyToken(token: string): TokenVerificationResult {
    const parts = token.split('.');
    if (parts.length !== 2) {
      return {
        valid: false,
        expired: false,
        error: 'Invalid token format',
      };
    }

    const [payloadB64, providedSignature] = parts;

    // Verify signature
    const expectedSignature = this.sign(payloadB64);
    if (!this.secureCompare(providedSignature, expectedSignature)) {
      return {
        valid: false,
        expired: false,
        error: 'Invalid signature',
      };
    }

    // Decode payload
    try {
      const payloadStr = Buffer.from(payloadB64, 'base64url').toString('utf-8');
      const payload = JSON.parse(payloadStr) as ApprovalTokenPayload;

      // Check expiration
      const now = new Date();
      const expiresAt = new Date(payload.expiresAt);
      if (now > expiresAt) {
        return {
          valid: false,
          expired: true,
          payload,
          error: 'Token expired',
        };
      }

      return {
        valid: true,
        expired: false,
        payload,
      };
    } catch {
      return {
        valid: false,
        expired: false,
        error: 'Failed to decode payload',
      };
    }
  }

  /**
   * Extract payload without verification (for inspection only)
   */
  decodePayload(token: string): ApprovalTokenPayload | null {
    const parts = token.split('.');
    if (parts.length !== 2) {
      return null;
    }

    try {
      const payloadStr = Buffer.from(parts[0], 'base64url').toString('utf-8');
      return JSON.parse(payloadStr) as ApprovalTokenPayload;
    } catch {
      return null;
    }
  }

  /**
   * Check if a token is expired (without full verification)
   */
  isExpired(token: string): boolean {
    const payload = this.decodePayload(token);
    if (!payload) {
      return true;
    }

    const now = new Date();
    const expiresAt = new Date(payload.expiresAt);
    return now > expiresAt;
  }

  // ============================================================
  // Private Methods
  // ============================================================

  private sign(data: string): string {
    return crypto
      .createHmac('sha256', this.secret)
      .update(data)
      .digest('base64url');
  }

  /**
   * Timing-safe string comparison to prevent timing attacks
   */
  private secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }

  /**
   * Generate a default secret for development (not for production)
   */
  private generateDefaultSecret(): string {
    // In production, always use APPROVAL_TOKEN_SECRET env var
    console.warn(
      '[ApprovalToken] Using auto-generated secret. ' +
        `Set ${SECRET_ENV_VAR} env var for production.`
    );
    return crypto.randomBytes(32).toString('hex');
  }
}

/**
 * Singleton instance
 */
let defaultManager: ApprovalTokenManager | null = null;

/**
 * Get or create the default token manager
 */
export function getApprovalTokenManager(): ApprovalTokenManager {
  if (!defaultManager) {
    defaultManager = new ApprovalTokenManager();
  }
  return defaultManager;
}

/**
 * Create token manager for testing
 */
export function createTestTokenManager(secret: string = 'test-secret'): ApprovalTokenManager {
  return new ApprovalTokenManager({ secret });
}

export default ApprovalTokenManager;
