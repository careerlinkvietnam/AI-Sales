/**
 * send_draft CLI Tests
 */

import * as fs from 'fs';
import * as path from 'path';
import { sendDraft, SendDraftOptions } from '../src/cli/send_draft';
import { resetSendPolicy } from '../src/domain/SendPolicy';
import { resetMetricsStore } from '../src/data/MetricsStore';
import { DraftRegistry, resetDraftRegistry } from '../src/data/DraftRegistry';
import { ApprovalTokenManager } from '../src/domain/ApprovalToken';

describe('send_draft CLI', () => {
  const testDir = path.join(__dirname, 'tmp_send_draft_test');
  const metricsPath = path.join(testDir, 'metrics.ndjson');
  const draftsPath = path.join('data', 'drafts.ndjson');
  let tokenManager: ApprovalTokenManager;
  let validToken: string;
  let draftRegistry: DraftRegistry;

  beforeEach(() => {
    // Create test directory
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    // Initialize empty metrics file
    fs.writeFileSync(metricsPath, '');

    // Ensure data directory exists for draft registry
    if (!fs.existsSync('data')) {
      fs.mkdirSync('data', { recursive: true });
    }
    // Clear drafts file
    fs.writeFileSync(draftsPath, '');

    // Set environment variables
    process.env.METRICS_STORE_PATH = metricsPath;
    process.env.APPROVAL_TOKEN_SECRET = 'test-secret-for-send-draft';

    // Reset singletons
    resetSendPolicy();
    resetMetricsStore();
    resetDraftRegistry();

    // Create draft registry and register test draft
    draftRegistry = new DraftRegistry({
      dataDir: 'data',
      draftsFile: 'drafts.ndjson',
    });
    draftRegistry.registerDraft({
      draftId: 'test-draft-123',
      trackingId: 'test-tracking-id',
      companyId: 'test-company',
      templateId: 'test-template',
      abVariant: 'A',
      subject: 'Test Subject [CL-AI:12345678]',
      body: 'Test Body',
      toEmail: 'user@test.com',
    });

    // Create token manager and valid token with matching draft_id and tracking_id
    tokenManager = new ApprovalTokenManager({ secret: 'test-secret-for-send-draft' });
    validToken = tokenManager.generateToken({
      draftId: 'test-draft-123',
      companyId: 'test-company',
      trackingId: 'test-tracking-id',
      candidateCount: 3,
      mode: 'stub',
    });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    // Clean up drafts file
    if (fs.existsSync(draftsPath)) {
      fs.unlinkSync(draftsPath);
    }
    delete process.env.METRICS_STORE_PATH;
    delete process.env.APPROVAL_TOKEN_SECRET;
    delete process.env.ENABLE_AUTO_SEND;
    delete process.env.KILL_SWITCH;
    delete process.env.SEND_ALLOWLIST_DOMAINS;
    delete process.env.SEND_ALLOWLIST_EMAILS;
    delete process.env.SEND_MAX_PER_DAY;
    resetSendPolicy();
    resetMetricsStore();
    resetDraftRegistry();
  });

  describe('registry checks', () => {
    it('blocks when draft not in registry', async () => {
      process.env.ENABLE_AUTO_SEND = 'true';
      process.env.SEND_ALLOWLIST_DOMAINS = 'test.com';

      // Create token for a draft that's NOT in registry
      const unregisteredToken = tokenManager.generateToken({
        draftId: 'unregistered-draft',
        companyId: 'test-company',
        trackingId: 'unregistered-tracking',
        candidateCount: 1,
        mode: 'stub',
      });

      const options: SendDraftOptions = {
        draftId: 'unregistered-draft',
        to: 'user@test.com',
        approvalToken: unregisteredToken,
      };

      const result = await sendDraft(options);
      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('not_in_registry');
    });

    it('allows draft that exists in registry', async () => {
      process.env.ENABLE_AUTO_SEND = 'true';
      process.env.SEND_ALLOWLIST_DOMAINS = 'test.com';

      const options: SendDraftOptions = {
        draftId: 'test-draft-123',
        to: 'user@test.com',
        approvalToken: validToken,
      };

      const result = await sendDraft(options);
      expect(result.success).toBe(true);
      expect(result.sent).toBe(true);
    });

    it('uses registry values for metrics when available', async () => {
      process.env.ENABLE_AUTO_SEND = 'true';
      process.env.SEND_ALLOWLIST_DOMAINS = 'test.com';

      const options: SendDraftOptions = {
        draftId: 'test-draft-123',
        to: 'user@test.com',
        approvalToken: validToken,
        // Don't provide trackingId - should use registry value
      };

      await sendDraft(options);

      const metricsContent = fs.readFileSync(metricsPath, 'utf-8');
      expect(metricsContent).toContain('test-tracking-id');
      expect(metricsContent).toContain('test-company');
      expect(metricsContent).toContain('test-template');
    });
  });

  describe('token-draft matching', () => {
    it('blocks when token draftId does not match', async () => {
      process.env.ENABLE_AUTO_SEND = 'true';
      process.env.SEND_ALLOWLIST_DOMAINS = 'test.com';

      // Register another draft
      draftRegistry.registerDraft({
        draftId: 'another-draft',
        trackingId: 'another-tracking',
        companyId: 'another-company',
        templateId: 'another-template',
        abVariant: 'B',
        subject: 'Another Subject',
        body: 'Another Body',
        toEmail: 'user@test.com',
      });

      // Use token for 'test-draft-123' but try to send 'another-draft'
      const options: SendDraftOptions = {
        draftId: 'another-draft',
        to: 'user@test.com',
        approvalToken: validToken, // This token is for test-draft-123
      };

      const result = await sendDraft(options);
      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('token_draft_mismatch');
    });

    it('blocks when token trackingId does not match registry', async () => {
      process.env.ENABLE_AUTO_SEND = 'true';
      process.env.SEND_ALLOWLIST_DOMAINS = 'test.com';

      // Create token with mismatched tracking ID
      const mismatchedToken = tokenManager.generateToken({
        draftId: 'test-draft-123',
        companyId: 'test-company',
        trackingId: 'wrong-tracking-id', // Registry has 'test-tracking-id'
        candidateCount: 1,
        mode: 'stub',
      });

      const options: SendDraftOptions = {
        draftId: 'test-draft-123',
        to: 'user@test.com',
        approvalToken: mismatchedToken,
      };

      const result = await sendDraft(options);
      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('token_draft_mismatch');
    });
  });

  describe('policy checks', () => {
    it('blocks when ENABLE_AUTO_SEND is false', async () => {
      process.env.ENABLE_AUTO_SEND = 'false';
      process.env.SEND_ALLOWLIST_DOMAINS = 'test.com';

      const options: SendDraftOptions = {
        draftId: 'test-draft-123',
        to: 'user@test.com',
        approvalToken: validToken,
      };

      const result = await sendDraft(options);
      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      // Registry check happens first now, so it passes
      // Then policy check fails
      expect(result.reason).toBe('not_enabled');
    });

    it('blocks when KILL_SWITCH is true', async () => {
      process.env.ENABLE_AUTO_SEND = 'true';
      process.env.KILL_SWITCH = 'true';
      process.env.SEND_ALLOWLIST_DOMAINS = 'test.com';

      const options: SendDraftOptions = {
        draftId: 'test-draft-123',
        to: 'user@test.com',
        approvalToken: validToken,
      };

      const result = await sendDraft(options);
      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('kill_switch');
    });

    it('blocks when recipient not in allowlist', async () => {
      process.env.ENABLE_AUTO_SEND = 'true';
      process.env.SEND_ALLOWLIST_DOMAINS = 'allowed.com';

      const options: SendDraftOptions = {
        draftId: 'test-draft-123',
        to: 'user@notallowed.com',
        approvalToken: validToken,
      };

      const result = await sendDraft(options);
      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('allowlist');
    });

    it('blocks when no allowlist configured', async () => {
      process.env.ENABLE_AUTO_SEND = 'true';
      // No allowlist configured

      const options: SendDraftOptions = {
        draftId: 'test-draft-123',
        to: 'user@test.com',
        approvalToken: validToken,
      };

      const result = await sendDraft(options);
      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('no_allowlist_configured');
    });
  });

  describe('token validation', () => {
    it('blocks with invalid token', async () => {
      process.env.ENABLE_AUTO_SEND = 'true';
      process.env.SEND_ALLOWLIST_DOMAINS = 'test.com';

      const options: SendDraftOptions = {
        draftId: 'test-draft-123',
        to: 'user@test.com',
        approvalToken: 'invalid-token',
      };

      const result = await sendDraft(options);
      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('invalid_token');
    });

    it('blocks with tampered token', async () => {
      process.env.ENABLE_AUTO_SEND = 'true';
      process.env.SEND_ALLOWLIST_DOMAINS = 'test.com';

      const options: SendDraftOptions = {
        draftId: 'test-draft-123',
        to: 'user@test.com',
        approvalToken: validToken + 'tampered',
      };

      const result = await sendDraft(options);
      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('invalid_token');
    });
  });

  describe('PreSendGate checks', () => {
    it('blocks when no tracking tag in content', async () => {
      process.env.ENABLE_AUTO_SEND = 'true';
      process.env.SEND_ALLOWLIST_DOMAINS = 'test.com';

      const options: SendDraftOptions = {
        draftId: 'test-draft-123',
        to: 'user@test.com',
        approvalToken: validToken,
        subject: '件名（トラッキングタグなし）',
        body: '本文（トラッキングタグなし）',
      };

      const result = await sendDraft(options);
      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('gate_failed');
      expect(result.gateViolations).toBeDefined();
      expect(result.gateViolations!.some((v) => v.includes('トラッキングタグ'))).toBe(true);
    });

    it('blocks when PII detected in body', async () => {
      process.env.ENABLE_AUTO_SEND = 'true';
      process.env.SEND_ALLOWLIST_DOMAINS = 'test.com';

      const options: SendDraftOptions = {
        draftId: 'test-draft-123',
        to: 'user@test.com',
        approvalToken: validToken,
        subject: '件名 [CL-AI:a1b2c3d4]',
        body: '電話番号: 090-1234-5678',
      };

      const result = await sendDraft(options);
      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('gate_failed');
    });

    it('skips gate check when no subject/body provided', async () => {
      process.env.ENABLE_AUTO_SEND = 'true';
      process.env.SEND_ALLOWLIST_DOMAINS = 'test.com';

      const options: SendDraftOptions = {
        draftId: 'test-draft-123',
        to: 'user@test.com',
        approvalToken: validToken,
        // No subject/body provided
      };

      const result = await sendDraft(options);
      // Should proceed to send (stub mode)
      expect(result.success).toBe(true);
      expect(result.sent).toBe(true);
    });
  });

  describe('dry run', () => {
    it('returns success without sending in dry run mode', async () => {
      process.env.ENABLE_AUTO_SEND = 'true';
      process.env.SEND_ALLOWLIST_DOMAINS = 'test.com';

      const options: SendDraftOptions = {
        draftId: 'test-draft-123',
        to: 'user@test.com',
        approvalToken: validToken,
        subject: '件名 [CL-AI:a1b2c3d4]',
        body: '本文です。',
        dryRun: true,
      };

      const result = await sendDraft(options);
      expect(result.success).toBe(true);
      expect(result.sent).toBe(false);
      expect(result.dryRun).toBe(true);
    });

    it('still blocks in dry run if checks fail', async () => {
      process.env.ENABLE_AUTO_SEND = 'true';
      process.env.SEND_ALLOWLIST_DOMAINS = 'other.com'; // not allowed

      const options: SendDraftOptions = {
        draftId: 'test-draft-123',
        to: 'user@test.com',
        approvalToken: validToken,
        dryRun: true,
      };

      const result = await sendDraft(options);
      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('allowlist');
    });
  });

  describe('successful send (stub mode)', () => {
    it('sends successfully when all checks pass', async () => {
      process.env.ENABLE_AUTO_SEND = 'true';
      process.env.SEND_ALLOWLIST_DOMAINS = 'test.com';

      const options: SendDraftOptions = {
        draftId: 'test-draft-123',
        to: 'user@test.com',
        approvalToken: validToken,
        trackingId: 'track123',
        companyId: 'company123',
        templateId: 'template123',
        abVariant: 'A',
        subject: '件名 [CL-AI:a1b2c3d4]',
        body: '本文です。',
      };

      const result = await sendDraft(options);
      expect(result.success).toBe(true);
      expect(result.sent).toBe(true);
      expect(result.messageId).toBeDefined();
      expect(result.threadId).toBeDefined();
    });
  });

  describe('metrics recording', () => {
    it('records AUTO_SEND_ATTEMPT event', async () => {
      process.env.ENABLE_AUTO_SEND = 'true';
      process.env.SEND_ALLOWLIST_DOMAINS = 'test.com';

      const options: SendDraftOptions = {
        draftId: 'test-draft-123',
        to: 'user@test.com',
        approvalToken: validToken,
        // Note: trackingId from registry takes precedence
      };

      await sendDraft(options);

      const metricsContent = fs.readFileSync(metricsPath, 'utf-8');
      expect(metricsContent).toContain('AUTO_SEND_ATTEMPT');
      // Uses registry tracking ID, not provided one
      expect(metricsContent).toContain('test-tracking-id');
    });

    it('records AUTO_SEND_SUCCESS event on success', async () => {
      process.env.ENABLE_AUTO_SEND = 'true';
      process.env.SEND_ALLOWLIST_DOMAINS = 'test.com';

      const options: SendDraftOptions = {
        draftId: 'test-draft-123',
        to: 'user@test.com',
        approvalToken: validToken,
        trackingId: 'track123',
      };

      await sendDraft(options);

      const metricsContent = fs.readFileSync(metricsPath, 'utf-8');
      expect(metricsContent).toContain('AUTO_SEND_SUCCESS');
    });

    it('records AUTO_SEND_BLOCKED event on failure', async () => {
      process.env.ENABLE_AUTO_SEND = 'false';

      const options: SendDraftOptions = {
        draftId: 'test-draft-123',
        to: 'user@test.com',
        approvalToken: validToken,
        trackingId: 'track123',
      };

      await sendDraft(options);

      const metricsContent = fs.readFileSync(metricsPath, 'utf-8');
      expect(metricsContent).toContain('AUTO_SEND_BLOCKED');
      expect(metricsContent).toContain('not_enabled');
    });

    it('records recipient domain (not full email) in metrics', async () => {
      process.env.ENABLE_AUTO_SEND = 'true';
      process.env.SEND_ALLOWLIST_DOMAINS = 'test.com';

      const options: SendDraftOptions = {
        draftId: 'test-draft-123',
        to: 'sensitive-name@test.com',
        approvalToken: validToken,
      };

      await sendDraft(options);

      const metricsContent = fs.readFileSync(metricsPath, 'utf-8');
      expect(metricsContent).toContain('test.com');
      expect(metricsContent).not.toContain('sensitive-name@test.com');
    });
  });

  describe('rate limiting', () => {
    it('SendPolicy correctly enforces rate limit', () => {
      // Test the SendPolicy rate limit logic directly
      const { SendPolicy } = require('../src/domain/SendPolicy');
      const policy = new SendPolicy({
        enableAutoSend: true,
        allowlistDomains: ['test.com'],
        maxPerDay: 2,
      });

      // Under limit - allowed
      const result1 = policy.checkSendPermission('user@test.com', 1);
      expect(result1.allowed).toBe(true);

      // At limit - denied
      const result2 = policy.checkSendPermission('user@test.com', 2);
      expect(result2.allowed).toBe(false);
      expect(result2.reason).toBe('rate_limit');

      // Over limit - denied
      const result3 = policy.checkSendPermission('user@test.com', 5);
      expect(result3.allowed).toBe(false);
      expect(result3.reason).toBe('rate_limit');
    });

    it('MetricsStore countTodaySends counts AUTO_SEND_SUCCESS events', () => {
      const today = new Date().toISOString().split('T')[0];
      const existingMetrics = [
        {
          timestamp: `${today}T10:00:00.000Z`,
          trackingId: 'prev1',
          companyId: 'c1',
          templateId: 't1',
          abVariant: 'A',
          eventType: 'AUTO_SEND_SUCCESS',
          gmailThreadId: 'thread1',
          replyLatencyHours: null,
          meta: {},
        },
        {
          timestamp: `${today}T11:00:00.000Z`,
          trackingId: 'prev2',
          companyId: 'c2',
          templateId: 't2',
          abVariant: 'B',
          eventType: 'AUTO_SEND_SUCCESS',
          gmailThreadId: 'thread2',
          replyLatencyHours: null,
          meta: {},
        },
        {
          timestamp: '2025-01-01T10:00:00.000Z', // Different day
          trackingId: 'old',
          companyId: 'c3',
          templateId: 't3',
          abVariant: 'A',
          eventType: 'AUTO_SEND_SUCCESS',
          gmailThreadId: 'thread3',
          replyLatencyHours: null,
          meta: {},
        },
      ];
      fs.writeFileSync(
        metricsPath,
        existingMetrics.map((e) => JSON.stringify(e)).join('\n') + '\n'
      );

      // Reset to pick up the new metrics file
      // The env var METRICS_STORE_PATH is already set in beforeEach
      resetMetricsStore();

      // Import MetricsStore directly and use getMetricsStore
      const { MetricsStore } = require('../src/data/MetricsStore');
      // Create a direct store pointing to the test metrics path
      const store = new MetricsStore({
        dataDir: testDir,
        metricsFile: 'metrics.ndjson',
      });
      const count = store.countTodaySends();

      expect(count).toBe(2); // Only today's events
    });
  });
});
