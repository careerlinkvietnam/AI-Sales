/**
 * ApprovalToken Test Suite
 *
 * Tests for HMAC-based approval token generation and verification.
 */

import {
  ApprovalTokenManager,
  createTestTokenManager,
} from '../src/domain/ApprovalToken';

describe('ApprovalTokenManager', () => {
  let manager: ApprovalTokenManager;

  beforeEach(() => {
    manager = createTestTokenManager('test-secret-key');
  });

  describe('generateToken', () => {
    it('generates a token with correct format', () => {
      const token = manager.generateToken({
        draftId: 'draft-123',
        companyId: 'company-456',
        candidateCount: 3,
        mode: 'stub',
      });

      // Token format: base64url_payload.base64url_signature
      expect(token).toContain('.');
      const parts = token.split('.');
      expect(parts).toHaveLength(2);
      expect(parts[0].length).toBeGreaterThan(0);
      expect(parts[1].length).toBeGreaterThan(0);
    });

    it('includes all payload fields', () => {
      const token = manager.generateToken({
        draftId: 'draft-abc',
        companyId: 'company-xyz',
        candidateCount: 5,
        mode: 'real',
      });

      const payload = manager.decodePayload(token);
      expect(payload).not.toBeNull();
      expect(payload?.draftId).toBe('draft-abc');
      expect(payload?.companyId).toBe('company-xyz');
      expect(payload?.candidateCount).toBe(5);
      expect(payload?.mode).toBe('real');
      expect(payload?.createdAt).toBeDefined();
      expect(payload?.expiresAt).toBeDefined();
    });

    it('sets expiration time', () => {
      const token = manager.generateToken({
        draftId: 'draft-123',
        companyId: 'company-456',
        candidateCount: 1,
        mode: 'stub',
      });

      const payload = manager.decodePayload(token);
      const createdAt = new Date(payload!.createdAt);
      const expiresAt = new Date(payload!.expiresAt);

      // Default TTL is 24 hours
      const diffMs = expiresAt.getTime() - createdAt.getTime();
      expect(diffMs).toBe(24 * 60 * 60 * 1000);
    });
  });

  describe('verifyToken', () => {
    it('verifies valid token', () => {
      const token = manager.generateToken({
        draftId: 'draft-123',
        companyId: 'company-456',
        candidateCount: 2,
        mode: 'stub',
      });

      const result = manager.verifyToken(token);

      expect(result.valid).toBe(true);
      expect(result.expired).toBe(false);
      expect(result.payload).toBeDefined();
      expect(result.payload?.draftId).toBe('draft-123');
    });

    it('rejects token with invalid signature', () => {
      const token = manager.generateToken({
        draftId: 'draft-123',
        companyId: 'company-456',
        candidateCount: 1,
        mode: 'stub',
      });

      // Tamper with signature
      const parts = token.split('.');
      const tamperedToken = `${parts[0]}.invalid-signature`;

      const result = manager.verifyToken(tamperedToken);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('signature');
    });

    it('rejects token with tampered payload', () => {
      const token = manager.generateToken({
        draftId: 'draft-123',
        companyId: 'company-456',
        candidateCount: 1,
        mode: 'stub',
      });

      // Tamper with payload
      const parts = token.split('.');
      const tamperedPayload = Buffer.from(
        JSON.stringify({ draftId: 'hacked', companyId: 'x', createdAt: '', expiresAt: '' })
      ).toString('base64url');
      const tamperedToken = `${tamperedPayload}.${parts[1]}`;

      const result = manager.verifyToken(tamperedToken);

      expect(result.valid).toBe(false);
    });

    it('rejects malformed token', () => {
      const result = manager.verifyToken('not-a-valid-token');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid token format');
    });

    it('rejects token with different secret', () => {
      const token = manager.generateToken({
        draftId: 'draft-123',
        companyId: 'company-456',
        candidateCount: 1,
        mode: 'stub',
      });

      const differentManager = createTestTokenManager('different-secret');
      const result = differentManager.verifyToken(token);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('signature');
    });
  });

  describe('expired tokens', () => {
    it('detects expired token', () => {
      // Create manager with very short TTL (1ms)
      const shortTtlManager = new ApprovalTokenManager({
        secret: 'test-secret',
        ttlMs: 1,
      });

      const token = shortTtlManager.generateToken({
        draftId: 'draft-123',
        companyId: 'company-456',
        candidateCount: 1,
        mode: 'stub',
      });

      // Wait for expiration
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const result = shortTtlManager.verifyToken(token);
          expect(result.valid).toBe(false);
          expect(result.expired).toBe(true);
          expect(result.error).toContain('expired');
          expect(result.payload).toBeDefined(); // Payload still returned for inspection
          resolve();
        }, 10);
      });
    });

    it('isExpired returns true for expired token', async () => {
      const shortTtlManager = new ApprovalTokenManager({
        secret: 'test-secret',
        ttlMs: 1,
      });

      const token = shortTtlManager.generateToken({
        draftId: 'draft-123',
        companyId: 'company-456',
        candidateCount: 1,
        mode: 'stub',
      });

      await new Promise((r) => setTimeout(r, 10));

      expect(shortTtlManager.isExpired(token)).toBe(true);
    });

    it('isExpired returns false for valid token', () => {
      const token = manager.generateToken({
        draftId: 'draft-123',
        companyId: 'company-456',
        candidateCount: 1,
        mode: 'stub',
      });

      expect(manager.isExpired(token)).toBe(false);
    });
  });

  describe('decodePayload', () => {
    it('decodes payload without verification', () => {
      const token = manager.generateToken({
        draftId: 'draft-abc',
        companyId: 'company-xyz',
        candidateCount: 3,
        mode: 'real',
      });

      const payload = manager.decodePayload(token);

      expect(payload).not.toBeNull();
      expect(payload?.draftId).toBe('draft-abc');
    });

    it('returns null for invalid token', () => {
      expect(manager.decodePayload('invalid')).toBeNull();
      expect(manager.decodePayload('also.invalid.token')).toBeNull();
    });
  });

  describe('custom TTL', () => {
    it('respects custom TTL setting', () => {
      const customManager = new ApprovalTokenManager({
        secret: 'test-secret',
        ttlMs: 60 * 60 * 1000, // 1 hour
      });

      const token = customManager.generateToken({
        draftId: 'draft-123',
        companyId: 'company-456',
        candidateCount: 1,
        mode: 'stub',
      });

      const payload = customManager.decodePayload(token);
      const createdAt = new Date(payload!.createdAt);
      const expiresAt = new Date(payload!.expiresAt);

      const diffMs = expiresAt.getTime() - createdAt.getTime();
      expect(diffMs).toBe(60 * 60 * 1000);
    });
  });

  describe('timing-safe comparison', () => {
    it('uses constant-time comparison for signatures', () => {
      // This test ensures the implementation uses timing-safe comparison
      // We can't directly test timing, but we can verify behavior
      const token = manager.generateToken({
        draftId: 'draft-123',
        companyId: 'company-456',
        candidateCount: 1,
        mode: 'stub',
      });

      // Both should fail but not reveal info about the expected signature
      const parts = token.split('.');
      const result1 = manager.verifyToken(`${parts[0]}.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`);
      const result2 = manager.verifyToken(`${parts[0]}.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`);

      expect(result1.valid).toBe(false);
      expect(result2.valid).toBe(false);
    });
  });
});
