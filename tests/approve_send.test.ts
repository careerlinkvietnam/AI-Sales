/**
 * approve_send CLI Tests
 */

import * as fs from 'fs';
import * as path from 'path';
import { approveSend } from '../src/cli/approve_send';
import { resetDraftRegistry, DraftRegistry } from '../src/data/DraftRegistry';
import { resetMetricsStore } from '../src/data/MetricsStore';

describe('approve_send CLI', () => {
  const testDir = path.join(__dirname, 'tmp_approve_send_test');
  const draftsPath = path.join(testDir, 'drafts.ndjson');
  const metricsPath = path.join(testDir, 'metrics.ndjson');
  const approvalsPath = path.join('data', 'approvals.ndjson');
  let registry: DraftRegistry;

  beforeEach(() => {
    // Create test directory
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    // Initialize empty files
    fs.writeFileSync(draftsPath, '');
    fs.writeFileSync(metricsPath, '');

    // Set environment variables
    process.env.APPROVAL_TOKEN_SECRET = 'test-secret-for-approve-send';
    process.env.METRICS_STORE_PATH = metricsPath;

    // Reset singletons
    resetDraftRegistry();
    resetMetricsStore();

    // Create registry pointing to test directory
    registry = new DraftRegistry({
      dataDir: testDir,
      draftsFile: 'drafts.ndjson',
    });

    // Ensure data directory exists for approvals
    if (!fs.existsSync('data')) {
      fs.mkdirSync('data', { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    delete process.env.APPROVAL_TOKEN_SECRET;
    delete process.env.METRICS_STORE_PATH;
    resetDraftRegistry();
    resetMetricsStore();
  });

  describe('draft validation', () => {
    it('rejects draft not in registry', () => {
      const result = approveSend({
        draftId: 'non-existent-draft',
        approvedBy: 'tester',
        reason: 'testing',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found in registry');
    });

    it('approves draft that exists in registry', () => {
      // First register a draft
      registry.registerDraft({
        draftId: 'test-draft-123',
        trackingId: 'track-abc',
        companyId: 'company-xyz',
        templateId: 'template-001',
        abVariant: 'A',
        subject: 'Test Subject',
        body: 'Test Body',
        toEmail: 'user@test.com',
      });

      // Mock the singleton to return our test registry
      jest.doMock('../src/data/DraftRegistry', () => ({
        getDraftRegistry: () => registry,
      }));

      // Now approve it - using the test registry directly
      // Since we can't easily mock the singleton, let's write to the same path
      const realRegistry = new DraftRegistry({
        dataDir: 'data',
        draftsFile: 'drafts.ndjson',
      });
      realRegistry.registerDraft({
        draftId: 'test-draft-456',
        trackingId: 'track-def',
        companyId: 'company-abc',
        templateId: 'template-002',
        abVariant: 'B',
        subject: 'Test Subject 2',
        body: 'Test Body 2',
        toEmail: 'user2@test.com',
      });

      const result = approveSend({
        draftId: 'test-draft-456',
        approvedBy: 'admin',
        reason: 'Approved for pilot',
      });

      expect(result.success).toBe(true);
      expect(result.draftId).toBe('test-draft-456');
      expect(result.trackingId).toBe('track-def');
      expect(result.approvalToken).toBeDefined();
      expect(result.tokenFingerprint).toBeDefined();
      expect(result.tokenFingerprint?.length).toBe(16);
    });
  });

  describe('token generation', () => {
    it('generates approval token with tracking ID', () => {
      // Register draft in default location
      const realRegistry = new DraftRegistry({
        dataDir: 'data',
        draftsFile: 'drafts.ndjson',
      });
      realRegistry.registerDraft({
        draftId: 'token-test-draft',
        trackingId: 'track-token-test',
        companyId: 'company-token',
        templateId: 'template-token',
        abVariant: 'A',
        subject: 'Token Test',
        body: 'Token Body',
        toEmail: 'token@test.com',
      });

      const result = approveSend({
        draftId: 'token-test-draft',
        approvedBy: 'token-tester',
        reason: 'Testing token generation',
      });

      expect(result.success).toBe(true);
      expect(result.approvalToken).toBeDefined();

      // Verify token structure (base64url.signature)
      const parts = result.approvalToken!.split('.');
      expect(parts.length).toBe(2);

      // Decode payload and verify tracking ID
      const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf-8'));
      expect(payload.draftId).toBe('token-test-draft');
      expect(payload.trackingId).toBe('track-token-test');
    });
  });

  describe('approval logging', () => {
    it('logs approval to approvals.ndjson', () => {
      // Register draft
      const realRegistry = new DraftRegistry({
        dataDir: 'data',
        draftsFile: 'drafts.ndjson',
      });
      realRegistry.registerDraft({
        draftId: 'log-test-draft',
        trackingId: 'track-log-test',
        companyId: 'company-log',
        templateId: 'template-log',
        abVariant: 'B',
        subject: 'Log Test',
        body: 'Log Body',
        toEmail: 'log@test.com',
      });

      const result = approveSend({
        draftId: 'log-test-draft',
        approvedBy: 'log-tester',
        reason: 'Testing approval logging',
        ticket: 'JIRA-123',
      });

      expect(result.success).toBe(true);

      // Check approvals log
      const approvalsContent = fs.readFileSync(approvalsPath, 'utf-8');
      expect(approvalsContent).toContain('log-test-draft');
      expect(approvalsContent).toContain('track-log-test');
      expect(approvalsContent).toContain('log-tester');
      expect(approvalsContent).toContain('Testing approval logging');
      expect(approvalsContent).toContain('JIRA-123');
      expect(approvalsContent).toContain('"type":"send"');
      // Token fingerprint should be logged, not full token
      expect(approvalsContent).toContain('tokenFingerprint');
    });

    it('does not log full token (security)', () => {
      const realRegistry = new DraftRegistry({
        dataDir: 'data',
        draftsFile: 'drafts.ndjson',
      });
      realRegistry.registerDraft({
        draftId: 'security-test-draft',
        trackingId: 'track-security',
        companyId: 'company-sec',
        templateId: 'template-sec',
        abVariant: 'A',
        subject: 'Security Test',
        body: 'Security Body',
        toEmail: 'sec@test.com',
      });

      const result = approveSend({
        draftId: 'security-test-draft',
        approvedBy: 'security-tester',
        reason: 'Testing security',
      });

      expect(result.success).toBe(true);

      // Check that full token is NOT in log
      const approvalsContent = fs.readFileSync(approvalsPath, 'utf-8');
      // Full token has format: base64url.signature (usually 100+ chars)
      // Fingerprint is 16 chars
      expect(approvalsContent).not.toContain(result.approvalToken);
      expect(approvalsContent).toContain(result.tokenFingerprint);
    });
  });

  describe('metrics recording', () => {
    it('records SEND_APPROVED event', () => {
      const realRegistry = new DraftRegistry({
        dataDir: 'data',
        draftsFile: 'drafts.ndjson',
      });
      realRegistry.registerDraft({
        draftId: 'metrics-test-draft',
        trackingId: 'track-metrics',
        companyId: 'company-metrics',
        templateId: 'template-metrics',
        abVariant: 'A',
        subject: 'Metrics Test',
        body: 'Metrics Body',
        toEmail: 'metrics@test.com',
      });

      approveSend({
        draftId: 'metrics-test-draft',
        approvedBy: 'metrics-tester',
        reason: 'Testing metrics',
      });

      const metricsContent = fs.readFileSync(metricsPath, 'utf-8');
      expect(metricsContent).toContain('SEND_APPROVED');
      expect(metricsContent).toContain('track-metrics');
      expect(metricsContent).toContain('metrics-tester');
    });
  });

  describe('result structure', () => {
    it('returns complete result on success', () => {
      const realRegistry = new DraftRegistry({
        dataDir: 'data',
        draftsFile: 'drafts.ndjson',
      });
      realRegistry.registerDraft({
        draftId: 'result-test-draft',
        trackingId: 'track-result',
        companyId: 'company-result',
        templateId: 'template-result',
        abVariant: 'B',
        subject: 'Result Test',
        body: 'Result Body',
        toEmail: 'result@test.com',
      });

      const result = approveSend({
        draftId: 'result-test-draft',
        approvedBy: 'result-tester',
        reason: 'Testing result structure',
      });

      expect(result.success).toBe(true);
      expect(result.draftId).toBe('result-test-draft');
      expect(result.trackingId).toBe('track-result');
      expect(result.companyId).toBe('company-result');
      expect(result.templateId).toBe('template-result');
      expect(result.abVariant).toBe('B');
      expect(result.approvalToken).toBeDefined();
      expect(result.tokenFingerprint).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    it('returns error structure on failure', () => {
      const result = approveSend({
        draftId: 'missing-draft',
        approvedBy: 'tester',
        reason: 'Should fail',
      });

      expect(result.success).toBe(false);
      expect(result.draftId).toBe('missing-draft');
      expect(result.error).toBeDefined();
      expect(result.approvalToken).toBeUndefined();
    });
  });
});
