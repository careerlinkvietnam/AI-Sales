/**
 * SendPolicy Tests
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  SendPolicy,
  createTestSendPolicy,
  getSendPolicy,
  resetSendPolicy,
} from '../src/domain/SendPolicy';
import {
  resetRuntimeKillSwitch,
  getRuntimeKillSwitch,
} from '../src/domain/RuntimeKillSwitch';

describe('SendPolicy', () => {
  const killSwitchPath = path.join('data', 'kill_switch.json');

  afterEach(() => {
    resetSendPolicy();
    resetRuntimeKillSwitch();
    delete process.env.ENABLE_AUTO_SEND;
    delete process.env.KILL_SWITCH;
    delete process.env.SEND_ALLOWLIST_DOMAINS;
    delete process.env.SEND_ALLOWLIST_EMAILS;
    delete process.env.SEND_MAX_PER_DAY;

    // Clean up kill switch file
    if (fs.existsSync(killSwitchPath)) {
      fs.unlinkSync(killSwitchPath);
    }
  });

  describe('isSendingEnabled', () => {
    it('returns false by default', () => {
      const policy = new SendPolicy();
      expect(policy.isSendingEnabled()).toBe(false);
    });

    it('returns true when ENABLE_AUTO_SEND is true', () => {
      const policy = createTestSendPolicy({ enableAutoSend: true });
      expect(policy.isSendingEnabled()).toBe(true);
    });

    it('returns false when kill switch is active', () => {
      const policy = createTestSendPolicy({
        enableAutoSend: true,
        killSwitch: true,
      });
      expect(policy.isSendingEnabled()).toBe(false);
    });

    it('reads from environment variables', () => {
      process.env.ENABLE_AUTO_SEND = 'true';
      const policy = new SendPolicy();
      expect(policy.isSendingEnabled()).toBe(true);
    });

    it('reads KILL_SWITCH from environment', () => {
      process.env.ENABLE_AUTO_SEND = 'true';
      process.env.KILL_SWITCH = 'true';
      const policy = new SendPolicy();
      expect(policy.isSendingEnabled()).toBe(false);
    });
  });

  describe('isRecipientAllowed', () => {
    it('returns false when no allowlist configured', () => {
      const policy = createTestSendPolicy({
        enableAutoSend: true,
        allowlistDomains: [],
        allowlistEmails: [],
      });
      expect(policy.isRecipientAllowed('test@example.com')).toBe(false);
    });

    it('returns true for email in allowlist', () => {
      const policy = createTestSendPolicy({
        enableAutoSend: true,
        allowlistEmails: ['allowed@test.com'],
      });
      expect(policy.isRecipientAllowed('allowed@test.com')).toBe(true);
    });

    it('returns true for domain in allowlist', () => {
      const policy = createTestSendPolicy({
        enableAutoSend: true,
        allowlistDomains: ['allowed.com'],
      });
      expect(policy.isRecipientAllowed('anyone@allowed.com')).toBe(true);
    });

    it('is case insensitive for emails', () => {
      const policy = createTestSendPolicy({
        enableAutoSend: true,
        allowlistEmails: ['Test@Example.com'],
      });
      expect(policy.isRecipientAllowed('TEST@EXAMPLE.COM')).toBe(true);
    });

    it('is case insensitive for domains', () => {
      const policy = createTestSendPolicy({
        enableAutoSend: true,
        allowlistDomains: ['Example.Com'],
      });
      expect(policy.isRecipientAllowed('user@EXAMPLE.COM')).toBe(true);
    });

    it('returns false for non-allowed email', () => {
      const policy = createTestSendPolicy({
        enableAutoSend: true,
        allowlistDomains: ['allowed.com'],
        allowlistEmails: ['special@other.com'],
      });
      expect(policy.isRecipientAllowed('user@notallowed.com')).toBe(false);
    });

    it('parses domains from environment', () => {
      process.env.SEND_ALLOWLIST_DOMAINS = 'test.com, example.co.jp';
      const policy = new SendPolicy();
      expect(policy.isRecipientAllowed('user@test.com')).toBe(true);
      expect(policy.isRecipientAllowed('user@example.co.jp')).toBe(true);
      expect(policy.isRecipientAllowed('user@other.com')).toBe(false);
    });

    it('parses emails from environment', () => {
      process.env.SEND_ALLOWLIST_EMAILS = 'a@x.com, b@y.com';
      const policy = new SendPolicy();
      expect(policy.isRecipientAllowed('a@x.com')).toBe(true);
      expect(policy.isRecipientAllowed('c@x.com')).toBe(false);
    });
  });

  describe('checkRateLimit', () => {
    it('allows when under limit', () => {
      const policy = createTestSendPolicy({ maxPerDay: 10 });
      const result = policy.checkRateLimit(5);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5);
      expect(result.limit).toBe(10);
    });

    it('denies when at limit', () => {
      const policy = createTestSendPolicy({ maxPerDay: 10 });
      const result = policy.checkRateLimit(10);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('denies when over limit', () => {
      const policy = createTestSendPolicy({ maxPerDay: 10 });
      const result = policy.checkRateLimit(15);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('uses default limit of 20', () => {
      const policy = new SendPolicy();
      const result = policy.checkRateLimit(19);
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(20);
    });

    it('reads limit from environment', () => {
      process.env.SEND_MAX_PER_DAY = '5';
      const policy = new SendPolicy();
      const result = policy.checkRateLimit(4);
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(5);
    });
  });

  describe('checkSendPermission', () => {
    it('denies when kill switch is active', () => {
      const policy = createTestSendPolicy({
        enableAutoSend: true,
        killSwitch: true,
        allowlistDomains: ['test.com'],
      });
      const result = policy.checkSendPermission('user@test.com', 0);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('kill_switch');
    });

    it('denies when not enabled', () => {
      const policy = createTestSendPolicy({
        enableAutoSend: false,
        allowlistDomains: ['test.com'],
      });
      const result = policy.checkSendPermission('user@test.com', 0);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('not_enabled');
    });

    it('denies when no allowlist configured', () => {
      const policy = createTestSendPolicy({
        enableAutoSend: true,
        allowlistDomains: [],
        allowlistEmails: [],
      });
      const result = policy.checkSendPermission('user@test.com', 0);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('no_allowlist_configured');
    });

    it('denies when recipient not in allowlist', () => {
      const policy = createTestSendPolicy({
        enableAutoSend: true,
        allowlistDomains: ['allowed.com'],
      });
      const result = policy.checkSendPermission('user@notallowed.com', 0);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('allowlist');
    });

    it('denies when rate limit exceeded', () => {
      const policy = createTestSendPolicy({
        enableAutoSend: true,
        allowlistDomains: ['test.com'],
        maxPerDay: 5,
      });
      const result = policy.checkSendPermission('user@test.com', 5);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('rate_limit');
    });

    it('allows when all checks pass', () => {
      const policy = createTestSendPolicy({
        enableAutoSend: true,
        allowlistDomains: ['test.com'],
        maxPerDay: 10,
      });
      const result = policy.checkSendPermission('user@test.com', 5);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  });

  describe('getConfig', () => {
    it('returns current configuration', () => {
      const policy = createTestSendPolicy({
        enableAutoSend: true,
        killSwitch: false,
        allowlistDomains: ['test.com'],
        allowlistEmails: ['special@other.com'],
        maxPerDay: 15,
      });
      const config = policy.getConfig();
      expect(config.enableAutoSend).toBe(true);
      expect(config.killSwitch).toBe(false);
      expect(config.allowlistDomains).toContain('test.com');
      expect(config.allowlistEmails).toContain('special@other.com');
      expect(config.maxPerDay).toBe(15);
    });
  });

  describe('singleton', () => {
    it('getSendPolicy returns same instance', () => {
      const policy1 = getSendPolicy();
      const policy2 = getSendPolicy();
      expect(policy1).toBe(policy2);
    });

    it('resetSendPolicy clears singleton', () => {
      const policy1 = getSendPolicy();
      resetSendPolicy();
      const policy2 = getSendPolicy();
      expect(policy1).not.toBe(policy2);
    });
  });

  describe('RuntimeKillSwitch integration', () => {
    it('isSendingEnabled returns false when RuntimeKillSwitch is active', () => {
      const ks = getRuntimeKillSwitch();
      ks.setEnabled('test', 'tester');

      const policy = createTestSendPolicy({ enableAutoSend: true });
      expect(policy.isSendingEnabled()).toBe(false);
    });

    it('isSendingEnabled returns true when RuntimeKillSwitch is not active', () => {
      // Ensure no kill switch file exists
      const ks = getRuntimeKillSwitch();
      ks.clear();

      const policy = createTestSendPolicy({ enableAutoSend: true });
      expect(policy.isSendingEnabled()).toBe(true);
    });

    it('isRuntimeKillSwitchActive returns correct status', () => {
      const policy = createTestSendPolicy({ enableAutoSend: true });
      expect(policy.isRuntimeKillSwitchActive()).toBe(false);

      const ks = getRuntimeKillSwitch();
      ks.setEnabled('test', 'tester');

      expect(policy.isRuntimeKillSwitchActive()).toBe(true);
    });

    it('checkSendPermission denies with runtime_kill_switch reason', () => {
      const ks = getRuntimeKillSwitch();
      ks.setEnabled('reply_rate drop', 'operator');

      const policy = createTestSendPolicy({
        enableAutoSend: true,
        allowlistDomains: ['test.com'],
      });

      const result = policy.checkSendPermission('user@test.com', 0);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('runtime_kill_switch');
      expect(result.details).toContain('reply_rate drop');
    });

    it('env kill switch takes priority over runtime kill switch', () => {
      // Both are active, env should be checked first
      const ks = getRuntimeKillSwitch();
      ks.setEnabled('runtime reason', 'admin');

      const policy = createTestSendPolicy({
        enableAutoSend: true,
        killSwitch: true,
        allowlistDomains: ['test.com'],
      });

      const result = policy.checkSendPermission('user@test.com', 0);
      expect(result.reason).toBe('kill_switch'); // env kill_switch, not runtime_kill_switch
    });

    it('getConfig includes runtimeKillSwitch status', () => {
      const ks = getRuntimeKillSwitch();
      ks.setEnabled('test', 'tester');

      const policy = createTestSendPolicy({ enableAutoSend: true });
      const config = policy.getConfig();

      expect(config.runtimeKillSwitch).toBe(true);
    });

    it('allows sending after RuntimeKillSwitch is disabled', () => {
      const ks = getRuntimeKillSwitch();

      // Enable
      ks.setEnabled('issue', 'admin');
      const policy = createTestSendPolicy({
        enableAutoSend: true,
        allowlistDomains: ['test.com'],
      });
      expect(policy.isSendingEnabled()).toBe(false);

      // Disable
      ks.setDisabled('issue resolved', 'admin');
      expect(policy.isSendingEnabled()).toBe(true);

      const result = policy.checkSendPermission('user@test.com', 0);
      expect(result.allowed).toBe(true);
    });
  });
});
