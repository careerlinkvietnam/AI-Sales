/**
 * RuntimeKillSwitch Tests
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  RuntimeKillSwitch,
  createTestRuntimeKillSwitch,
  getRuntimeKillSwitch,
  resetRuntimeKillSwitch,
} from '../src/domain/RuntimeKillSwitch';

describe('RuntimeKillSwitch', () => {
  const testDir = path.join(__dirname, 'tmp_kill_switch_test');
  const killSwitchFile = 'kill_switch.json';
  const killSwitchPath = path.join(testDir, killSwitchFile);

  beforeEach(() => {
    // Create test directory
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    // Remove kill switch file if exists
    if (fs.existsSync(killSwitchPath)) {
      fs.unlinkSync(killSwitchPath);
    }
    resetRuntimeKillSwitch();
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    resetRuntimeKillSwitch();
  });

  describe('isEnabled', () => {
    it('returns false when file does not exist', () => {
      const killSwitch = new RuntimeKillSwitch({
        dataDir: testDir,
        fileName: killSwitchFile,
      });

      expect(killSwitch.isEnabled()).toBe(false);
    });

    it('returns true when file exists and enabled=true', () => {
      fs.writeFileSync(
        killSwitchPath,
        JSON.stringify({
          enabled: true,
          reason: 'test',
          set_by: 'tester',
          set_at: new Date().toISOString(),
        })
      );

      const killSwitch = new RuntimeKillSwitch({
        dataDir: testDir,
        fileName: killSwitchFile,
      });

      expect(killSwitch.isEnabled()).toBe(true);
    });

    it('returns false when file exists and enabled=false', () => {
      fs.writeFileSync(
        killSwitchPath,
        JSON.stringify({
          enabled: false,
          reason: 'resumed',
          set_by: 'tester',
          set_at: new Date().toISOString(),
        })
      );

      const killSwitch = new RuntimeKillSwitch({
        dataDir: testDir,
        fileName: killSwitchFile,
      });

      expect(killSwitch.isEnabled()).toBe(false);
    });

    it('returns true (fail-safe) when file is invalid JSON', () => {
      fs.writeFileSync(killSwitchPath, 'not valid json');

      const killSwitch = new RuntimeKillSwitch({
        dataDir: testDir,
        fileName: killSwitchFile,
      });

      // Should return true (fail-safe: block sending when uncertain)
      expect(killSwitch.isEnabled()).toBe(true);
    });
  });

  describe('getState', () => {
    it('returns null when file does not exist', () => {
      const killSwitch = new RuntimeKillSwitch({
        dataDir: testDir,
        fileName: killSwitchFile,
      });

      expect(killSwitch.getState()).toBeNull();
    });

    it('returns state when file exists', () => {
      const state = {
        enabled: true,
        reason: 'incident investigation',
        set_by: 'admin',
        set_at: '2026-01-26T10:00:00Z',
      };
      fs.writeFileSync(killSwitchPath, JSON.stringify(state));

      const killSwitch = new RuntimeKillSwitch({
        dataDir: testDir,
        fileName: killSwitchFile,
      });

      expect(killSwitch.getState()).toEqual(state);
    });

    it('returns null when file is invalid', () => {
      fs.writeFileSync(killSwitchPath, 'invalid');

      const killSwitch = new RuntimeKillSwitch({
        dataDir: testDir,
        fileName: killSwitchFile,
      });

      expect(killSwitch.getState()).toBeNull();
    });
  });

  describe('setEnabled', () => {
    it('creates file with enabled=true', () => {
      const killSwitch = new RuntimeKillSwitch({
        dataDir: testDir,
        fileName: killSwitchFile,
      });

      killSwitch.setEnabled('reply_rate drop', 'operator');

      expect(fs.existsSync(killSwitchPath)).toBe(true);
      const state = JSON.parse(fs.readFileSync(killSwitchPath, 'utf-8'));
      expect(state.enabled).toBe(true);
      expect(state.reason).toBe('reply_rate drop');
      expect(state.set_by).toBe('operator');
      expect(state.set_at).toBeDefined();
    });

    it('creates directory if not exists', () => {
      const newDir = path.join(testDir, 'nested', 'dir');
      const killSwitch = new RuntimeKillSwitch({
        dataDir: newDir,
        fileName: killSwitchFile,
      });

      killSwitch.setEnabled('test', 'tester');

      expect(fs.existsSync(path.join(newDir, killSwitchFile))).toBe(true);
    });
  });

  describe('setDisabled', () => {
    it('creates file with enabled=false', () => {
      const killSwitch = new RuntimeKillSwitch({
        dataDir: testDir,
        fileName: killSwitchFile,
      });

      // First enable
      killSwitch.setEnabled('issue', 'admin');
      expect(killSwitch.isEnabled()).toBe(true);

      // Then disable
      killSwitch.setDisabled('issue resolved', 'admin');
      expect(killSwitch.isEnabled()).toBe(false);

      const state = JSON.parse(fs.readFileSync(killSwitchPath, 'utf-8'));
      expect(state.enabled).toBe(false);
      expect(state.reason).toBe('issue resolved');
    });
  });

  describe('clear', () => {
    it('removes the file', () => {
      const killSwitch = new RuntimeKillSwitch({
        dataDir: testDir,
        fileName: killSwitchFile,
      });

      // Create file
      killSwitch.setEnabled('test', 'tester');
      expect(fs.existsSync(killSwitchPath)).toBe(true);

      // Clear
      killSwitch.clear();
      expect(fs.existsSync(killSwitchPath)).toBe(false);
    });

    it('does nothing if file does not exist', () => {
      const killSwitch = new RuntimeKillSwitch({
        dataDir: testDir,
        fileName: killSwitchFile,
      });

      // Should not throw
      expect(() => killSwitch.clear()).not.toThrow();
    });
  });

  describe('singleton', () => {
    it('getRuntimeKillSwitch returns same instance', () => {
      const ks1 = getRuntimeKillSwitch();
      const ks2 = getRuntimeKillSwitch();
      expect(ks1).toBe(ks2);
    });

    it('resetRuntimeKillSwitch clears singleton', () => {
      const ks1 = getRuntimeKillSwitch();
      resetRuntimeKillSwitch();
      const ks2 = getRuntimeKillSwitch();
      expect(ks1).not.toBe(ks2);
    });
  });

  describe('createTestRuntimeKillSwitch', () => {
    it('creates isolated instance', () => {
      const testKs = createTestRuntimeKillSwitch({
        dataDir: testDir,
        fileName: 'test_ks.json',
      });

      testKs.setEnabled('test', 'tester');
      expect(testKs.isEnabled()).toBe(true);

      // Should not affect default singleton
      const defaultKs = getRuntimeKillSwitch();
      // Default uses data/kill_switch.json which shouldn't exist in test
    });
  });
});
