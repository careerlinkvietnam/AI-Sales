/**
 * Runtime Kill Switch Module
 *
 * Provides file-based emergency stop functionality without requiring .env changes.
 * This allows immediate send suspension via CLI commands.
 *
 * File location: data/kill_switch.json
 *
 * 設計方針:
 * - ファイルが存在しない場合: 送信許可（safe-to-send）
 * - ファイルが存在し enabled=true: 送信停止
 * - ファイル読み込み失敗: 安全側で停止（enabled=true扱い）
 *
 * JSON構造:
 * {
 *   "enabled": true,
 *   "reason": "reply_rate drop",
 *   "set_by": "operator_name",
 *   "set_at": "2026-01-26T10:00:00Z"
 * }
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Kill switch file structure
 */
export interface KillSwitchState {
  enabled: boolean;
  reason: string;
  set_by: string;
  set_at: string;
}

/**
 * Default data directory and file
 */
const DEFAULT_DATA_DIR = 'data';
const DEFAULT_KILL_SWITCH_FILE = 'kill_switch.json';

/**
 * Runtime Kill Switch class
 */
export class RuntimeKillSwitch {
  private readonly filePath: string;

  constructor(options?: { dataDir?: string; fileName?: string }) {
    const dataDir = options?.dataDir || DEFAULT_DATA_DIR;
    const fileName = options?.fileName || DEFAULT_KILL_SWITCH_FILE;
    this.filePath = path.join(dataDir, fileName);
  }

  /**
   * Check if kill switch is enabled
   *
   * Returns true (block sending) if:
   * - File exists and enabled=true
   * - File read/parse fails (fail-safe: block sending)
   *
   * Returns false (allow sending) if:
   * - File does not exist
   * - File exists and enabled=false
   */
  isEnabled(): boolean {
    try {
      if (!fs.existsSync(this.filePath)) {
        return false;
      }

      const content = fs.readFileSync(this.filePath, 'utf-8');
      const state = JSON.parse(content) as KillSwitchState;
      return state.enabled === true;
    } catch (error) {
      // Fail-safe: if we can't read/parse the file, assume kill switch is active
      console.error(
        `[RuntimeKillSwitch] Failed to read kill switch file, defaulting to ENABLED (safe): ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
      return true;
    }
  }

  /**
   * Get current kill switch state
   *
   * Returns null if file doesn't exist or can't be read
   */
  getState(): KillSwitchState | null {
    try {
      if (!fs.existsSync(this.filePath)) {
        return null;
      }

      const content = fs.readFileSync(this.filePath, 'utf-8');
      return JSON.parse(content) as KillSwitchState;
    } catch {
      return null;
    }
  }

  /**
   * Enable the kill switch (stop sending)
   *
   * @param reason - Reason for stopping (e.g., "reply_rate drop", "incident investigation")
   * @param setBy - Name/ID of operator enabling the switch
   */
  setEnabled(reason: string, setBy: string): void {
    const state: KillSwitchState = {
      enabled: true,
      reason,
      set_by: setBy,
      set_at: new Date().toISOString(),
    };

    this.writeState(state);
  }

  /**
   * Disable the kill switch (resume sending)
   *
   * @param reason - Reason for resuming (e.g., "issue resolved", "false alarm")
   * @param setBy - Name/ID of operator disabling the switch
   */
  setDisabled(reason: string, setBy: string): void {
    const state: KillSwitchState = {
      enabled: false,
      reason,
      set_by: setBy,
      set_at: new Date().toISOString(),
    };

    this.writeState(state);
  }

  /**
   * Clear the kill switch file entirely
   *
   * This removes the file, returning to default state (sending allowed)
   */
  clear(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        fs.unlinkSync(this.filePath);
      }
    } catch (error) {
      console.error(
        `[RuntimeKillSwitch] Failed to clear kill switch file: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  /**
   * Get the file path (for debugging/logging)
   */
  getFilePath(): string {
    return this.filePath;
  }

  /**
   * Write state to file
   */
  private writeState(state: KillSwitchState): void {
    // Ensure data directory exists
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.filePath, JSON.stringify(state, null, 2), 'utf-8');
  }
}

/**
 * Singleton instance
 */
let defaultKillSwitch: RuntimeKillSwitch | null = null;

/**
 * Get or create the default runtime kill switch
 */
export function getRuntimeKillSwitch(): RuntimeKillSwitch {
  if (!defaultKillSwitch) {
    defaultKillSwitch = new RuntimeKillSwitch();
  }
  return defaultKillSwitch;
}

/**
 * Reset the singleton (for testing)
 */
export function resetRuntimeKillSwitch(): void {
  defaultKillSwitch = null;
}

/**
 * Create runtime kill switch for testing
 */
export function createTestRuntimeKillSwitch(options?: {
  dataDir?: string;
  fileName?: string;
}): RuntimeKillSwitch {
  return new RuntimeKillSwitch(options);
}

export default RuntimeKillSwitch;
