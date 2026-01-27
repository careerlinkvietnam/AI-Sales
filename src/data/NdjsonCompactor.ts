/**
 * NDJSON Compactor
 *
 * Utilities for compacting and rotating NDJSON data files.
 *
 * Strategies:
 * - compactLatestByKey: Keep only the latest record for each key (e.g., job_id)
 * - rotate: Rename file with date suffix for archival
 * - vacuumOld: Remove old rotated files (optional, future use)
 *
 * 重要:
 * - 破壊的な削除は行わない（バックアップを作成）
 * - エラー時は元ファイルを維持
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Retention configuration for a data file
 */
export interface RetentionConfig {
  compact?: boolean;
  key?: string[];
  rotate?: boolean;
  keep_days?: number;
  keep_status?: string[];
  comment?: string;
}

/**
 * Compaction result
 */
export interface CompactionResult {
  success: boolean;
  dryRun: boolean;
  inputPath: string;
  outputPath?: string;
  backupPath?: string;
  inputLines: number;
  outputLines: number;
  inputSizeBytes: number;
  outputSizeBytes: number;
  reduction: {
    lines: number;
    bytes: number;
    percentage: number;
  };
  error?: string;
}

/**
 * Rotation result
 */
export interface RotationResult {
  success: boolean;
  dryRun: boolean;
  inputPath: string;
  rotatedPath?: string;
  rotatedSizeBytes?: number;
  error?: string;
}

/**
 * Data file status
 */
export interface DataFileStatus {
  path: string;
  exists: boolean;
  lines: number;
  sizeBytes: number;
  lastModified?: string;
  oldestRecord?: string;
  newestRecord?: string;
}

/**
 * Load retention configuration from file
 */
export function loadRetentionConfig(configPath?: string): Record<string, RetentionConfig> {
  const filePath = configPath || path.join(process.cwd(), 'config', 'retention.json');

  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // Use defaults
  }

  return {};
}

/**
 * Create a backup of a file
 */
export function createBackup(filePath: string, suffix?: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '').replace('T', '').substring(0, 14);
  const backupPath = `${filePath}.bak-${suffix || timestamp}`;

  try {
    fs.copyFileSync(filePath, backupPath);
    return backupPath;
  } catch {
    return null;
  }
}

/**
 * Count lines in a file
 */
export function countLines(filePath: string): number {
  if (!fs.existsSync(filePath)) {
    return 0;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.split('\n').filter((line) => line.trim()).length;
  } catch {
    return 0;
  }
}

/**
 * Get file size in bytes
 */
export function getFileSize(filePath: string): number {
  if (!fs.existsSync(filePath)) {
    return 0;
  }

  try {
    const stats = fs.statSync(filePath);
    return stats.size;
  } catch {
    return 0;
  }
}

/**
 * Compact NDJSON file by keeping only the latest record for each key
 *
 * @param inputPath - Path to input NDJSON file
 * @param keyFields - Fields to use as key (e.g., ['job_id'])
 * @param options - Compaction options
 * @returns Compaction result
 */
export function compactLatestByKey(
  inputPath: string,
  keyFields: string[],
  options?: {
    execute?: boolean;
    outputPath?: string;
    timestampField?: string;
  }
): CompactionResult {
  const execute = options?.execute ?? false;
  const outputPath = options?.outputPath ?? inputPath;
  const timestampField = options?.timestampField ?? 'last_updated_at';

  const result: CompactionResult = {
    success: false,
    dryRun: !execute,
    inputPath,
    outputPath: execute ? outputPath : undefined,
    inputLines: 0,
    outputLines: 0,
    inputSizeBytes: 0,
    outputSizeBytes: 0,
    reduction: { lines: 0, bytes: 0, percentage: 0 },
  };

  if (!fs.existsSync(inputPath)) {
    result.error = 'Input file does not exist';
    return result;
  }

  try {
    const inputContent = fs.readFileSync(inputPath, 'utf-8');
    const inputLines = inputContent.split('\n').filter((line) => line.trim());
    result.inputLines = inputLines.length;
    result.inputSizeBytes = Buffer.byteLength(inputContent, 'utf-8');

    // Build map of key -> latest record
    const latestByKey = new Map<string, { record: any; timestamp: string; line: string }>();

    for (const line of inputLines) {
      try {
        const record = JSON.parse(line);
        const keyParts = keyFields.map((f) => record[f] ?? '');
        const key = keyParts.join(':');
        const timestamp = record[timestampField] || record.created_at || '';

        const existing = latestByKey.get(key);
        if (!existing || timestamp >= existing.timestamp) {
          latestByKey.set(key, { record, timestamp, line });
        }
      } catch {
        // Skip invalid lines
      }
    }

    // Build output
    const outputLines = Array.from(latestByKey.values())
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .map((v) => v.line);

    result.outputLines = outputLines.length;
    const outputContent = outputLines.join('\n') + (outputLines.length > 0 ? '\n' : '');
    result.outputSizeBytes = Buffer.byteLength(outputContent, 'utf-8');

    // Calculate reduction
    result.reduction.lines = result.inputLines - result.outputLines;
    result.reduction.bytes = result.inputSizeBytes - result.outputSizeBytes;
    result.reduction.percentage =
      result.inputSizeBytes > 0
        ? Math.round((result.reduction.bytes / result.inputSizeBytes) * 100)
        : 0;

    if (execute) {
      // Create backup
      const backupPath = createBackup(inputPath);
      result.backupPath = backupPath || undefined;

      // Write output
      fs.writeFileSync(outputPath, outputContent, 'utf-8');
    }

    result.success = true;
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Unknown error';
    return result;
  }
}

/**
 * Rotate a file by renaming it with a date suffix
 *
 * @param inputPath - Path to input file
 * @param options - Rotation options
 * @returns Rotation result
 */
export function rotate(
  inputPath: string,
  options?: {
    execute?: boolean;
    dateSuffix?: string;
  }
): RotationResult {
  const execute = options?.execute ?? false;
  const dateSuffix = options?.dateSuffix ?? new Date().toISOString().split('T')[0].replace(/-/g, '');

  const result: RotationResult = {
    success: false,
    dryRun: !execute,
    inputPath,
  };

  if (!fs.existsSync(inputPath)) {
    result.error = 'Input file does not exist';
    return result;
  }

  const rotatedPath = `${inputPath}.${dateSuffix}`;
  result.rotatedPath = rotatedPath;

  try {
    result.rotatedSizeBytes = getFileSize(inputPath);

    if (execute) {
      // Check if rotated file already exists
      if (fs.existsSync(rotatedPath)) {
        result.error = `Rotated file already exists: ${rotatedPath}`;
        return result;
      }

      // Rename file
      fs.renameSync(inputPath, rotatedPath);

      // Create empty file
      fs.writeFileSync(inputPath, '', 'utf-8');
    }

    result.success = true;
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Unknown error';
    return result;
  }
}

/**
 * Get status of a data file
 *
 * @param filePath - Path to data file
 * @returns File status
 */
export function getDataFileStatus(filePath: string): DataFileStatus {
  const status: DataFileStatus = {
    path: filePath,
    exists: false,
    lines: 0,
    sizeBytes: 0,
  };

  if (!fs.existsSync(filePath)) {
    return status;
  }

  try {
    const stats = fs.statSync(filePath);
    status.exists = true;
    status.sizeBytes = stats.size;
    status.lastModified = stats.mtime.toISOString();

    // Count lines and find oldest/newest timestamps
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter((line) => line.trim());
    status.lines = lines.length;

    let oldest: string | undefined;
    let newest: string | undefined;

    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        const timestamp = record.timestamp || record.created_at || record.last_updated_at;
        if (timestamp) {
          if (!oldest || timestamp < oldest) oldest = timestamp;
          if (!newest || timestamp > newest) newest = timestamp;
        }
      } catch {
        // Skip invalid lines
      }
    }

    status.oldestRecord = oldest;
    status.newestRecord = newest;
  } catch {
    // Return partial status
  }

  return status;
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default {
  loadRetentionConfig,
  createBackup,
  countLines,
  getFileSize,
  compactLatestByKey,
  rotate,
  getDataFileStatus,
  formatBytes,
};
