/**
 * NDJSON Compactor Tests
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  compactLatestByKey,
  rotate,
  getDataFileStatus,
  createBackup,
  countLines,
  getFileSize,
  formatBytes,
  loadRetentionConfig,
} from '../src/data/NdjsonCompactor';

describe('NdjsonCompactor', () => {
  const testDir = path.join(__dirname, 'tmp_ndjson_compactor_test');

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('compactLatestByKey', () => {
    it('returns error for non-existent file', () => {
      const result = compactLatestByKey(
        path.join(testDir, 'nonexistent.ndjson'),
        ['id'],
        { execute: false }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('does not exist');
    });

    it('keeps only latest record for each key in dry-run', () => {
      const filePath = path.join(testDir, 'test.ndjson');
      const records = [
        { id: '1', value: 'first', last_updated_at: '2026-01-01T00:00:00Z' },
        { id: '2', value: 'second', last_updated_at: '2026-01-01T00:00:00Z' },
        { id: '1', value: 'updated', last_updated_at: '2026-01-02T00:00:00Z' },
        { id: '3', value: 'third', last_updated_at: '2026-01-01T00:00:00Z' },
        { id: '2', value: 'updated2', last_updated_at: '2026-01-03T00:00:00Z' },
      ];
      fs.writeFileSync(filePath, records.map(r => JSON.stringify(r)).join('\n') + '\n');

      const result = compactLatestByKey(filePath, ['id'], { execute: false });

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.inputLines).toBe(5);
      expect(result.outputLines).toBe(3); // 3 unique IDs
      expect(result.reduction.lines).toBe(2);
    });

    it('actually compacts file when execute=true', () => {
      const filePath = path.join(testDir, 'test.ndjson');
      const records = [
        { id: '1', value: 'first', last_updated_at: '2026-01-01T00:00:00Z' },
        { id: '1', value: 'updated', last_updated_at: '2026-01-02T00:00:00Z' },
      ];
      fs.writeFileSync(filePath, records.map(r => JSON.stringify(r)).join('\n') + '\n');

      const result = compactLatestByKey(filePath, ['id'], { execute: true });

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(false);
      expect(result.backupPath).toBeDefined();

      // Check backup was created
      expect(fs.existsSync(result.backupPath!)).toBe(true);

      // Check output file
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      expect(lines.length).toBe(1);
      expect(JSON.parse(lines[0]).value).toBe('updated');
    });

    it('preserves all records with different keys', () => {
      const filePath = path.join(testDir, 'test.ndjson');
      const records = [
        { id: '1', value: 'a', last_updated_at: '2026-01-01T00:00:00Z' },
        { id: '2', value: 'b', last_updated_at: '2026-01-01T00:00:00Z' },
        { id: '3', value: 'c', last_updated_at: '2026-01-01T00:00:00Z' },
      ];
      fs.writeFileSync(filePath, records.map(r => JSON.stringify(r)).join('\n') + '\n');

      const result = compactLatestByKey(filePath, ['id'], { execute: false });

      expect(result.inputLines).toBe(3);
      expect(result.outputLines).toBe(3);
      expect(result.reduction.lines).toBe(0);
    });

    it('handles composite keys', () => {
      const filePath = path.join(testDir, 'test.ndjson');
      const records = [
        { type: 'A', id: '1', value: 'first', last_updated_at: '2026-01-01T00:00:00Z' },
        { type: 'A', id: '1', value: 'updated', last_updated_at: '2026-01-02T00:00:00Z' },
        { type: 'B', id: '1', value: 'different', last_updated_at: '2026-01-01T00:00:00Z' },
      ];
      fs.writeFileSync(filePath, records.map(r => JSON.stringify(r)).join('\n') + '\n');

      const result = compactLatestByKey(filePath, ['type', 'id'], { execute: false });

      expect(result.inputLines).toBe(3);
      expect(result.outputLines).toBe(2); // A:1 and B:1 are different keys
    });

    it('handles empty file', () => {
      const filePath = path.join(testDir, 'test.ndjson');
      fs.writeFileSync(filePath, '');

      const result = compactLatestByKey(filePath, ['id'], { execute: false });

      expect(result.success).toBe(true);
      expect(result.inputLines).toBe(0);
      expect(result.outputLines).toBe(0);
    });

    it('skips invalid JSON lines', () => {
      const filePath = path.join(testDir, 'test.ndjson');
      const content = `{"id": "1", "value": "valid", "last_updated_at": "2026-01-01T00:00:00Z"}
not valid json
{"id": "2", "value": "also valid", "last_updated_at": "2026-01-01T00:00:00Z"}
`;
      fs.writeFileSync(filePath, content);

      const result = compactLatestByKey(filePath, ['id'], { execute: false });

      expect(result.success).toBe(true);
      expect(result.outputLines).toBe(2);
    });
  });

  describe('rotate', () => {
    it('returns error for non-existent file', () => {
      const result = rotate(path.join(testDir, 'nonexistent.ndjson'), { execute: false });

      expect(result.success).toBe(false);
      expect(result.error).toContain('does not exist');
    });

    it('calculates rotation path in dry-run', () => {
      const filePath = path.join(testDir, 'test.ndjson');
      fs.writeFileSync(filePath, '{"test": 1}\n');

      const result = rotate(filePath, {
        execute: false,
        dateSuffix: '20260127',
      });

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.rotatedPath).toBe(filePath + '.20260127');

      // Original file should still exist
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('rotates file when execute=true', () => {
      const filePath = path.join(testDir, 'test.ndjson');
      fs.writeFileSync(filePath, '{"test": 1}\n{"test": 2}\n');

      const result = rotate(filePath, {
        execute: true,
        dateSuffix: '20260127',
      });

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(false);

      // Rotated file should exist with content
      expect(fs.existsSync(result.rotatedPath!)).toBe(true);
      const rotatedContent = fs.readFileSync(result.rotatedPath!, 'utf-8');
      expect(rotatedContent).toContain('{"test": 1}');

      // Original file should be empty
      expect(fs.existsSync(filePath)).toBe(true);
      const originalContent = fs.readFileSync(filePath, 'utf-8');
      expect(originalContent).toBe('');
    });

    it('fails if rotated file already exists', () => {
      const filePath = path.join(testDir, 'test.ndjson');
      const rotatedPath = filePath + '.20260127';
      fs.writeFileSync(filePath, '{"test": 1}\n');
      fs.writeFileSync(rotatedPath, 'existing\n');

      const result = rotate(filePath, {
        execute: true,
        dateSuffix: '20260127',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });
  });

  describe('getDataFileStatus', () => {
    it('returns not exists for missing file', () => {
      const status = getDataFileStatus(path.join(testDir, 'nonexistent.ndjson'));

      expect(status.exists).toBe(false);
      expect(status.lines).toBe(0);
      expect(status.sizeBytes).toBe(0);
    });

    it('returns correct status for existing file', () => {
      const filePath = path.join(testDir, 'test.ndjson');
      const records = [
        { timestamp: '2026-01-01T00:00:00Z', value: 1 },
        { timestamp: '2026-01-15T00:00:00Z', value: 2 },
        { timestamp: '2026-01-10T00:00:00Z', value: 3 },
      ];
      fs.writeFileSync(filePath, records.map(r => JSON.stringify(r)).join('\n') + '\n');

      const status = getDataFileStatus(filePath);

      expect(status.exists).toBe(true);
      expect(status.lines).toBe(3);
      expect(status.sizeBytes).toBeGreaterThan(0);
      expect(status.oldestRecord).toBe('2026-01-01T00:00:00Z');
      expect(status.newestRecord).toBe('2026-01-15T00:00:00Z');
    });
  });

  describe('helper functions', () => {
    it('createBackup creates backup file', () => {
      const filePath = path.join(testDir, 'test.ndjson');
      fs.writeFileSync(filePath, 'test content\n');

      const backupPath = createBackup(filePath, 'test');

      expect(backupPath).toBeDefined();
      expect(fs.existsSync(backupPath!)).toBe(true);
      expect(fs.readFileSync(backupPath!, 'utf-8')).toBe('test content\n');
    });

    it('createBackup returns null for non-existent file', () => {
      const backupPath = createBackup(path.join(testDir, 'nonexistent.ndjson'));
      expect(backupPath).toBeNull();
    });

    it('countLines counts correctly', () => {
      const filePath = path.join(testDir, 'test.ndjson');
      fs.writeFileSync(filePath, 'line1\nline2\nline3\n');

      expect(countLines(filePath)).toBe(3);
    });

    it('countLines returns 0 for empty file', () => {
      const filePath = path.join(testDir, 'test.ndjson');
      fs.writeFileSync(filePath, '');

      expect(countLines(filePath)).toBe(0);
    });

    it('getFileSize returns correct size', () => {
      const filePath = path.join(testDir, 'test.ndjson');
      fs.writeFileSync(filePath, 'test content');

      expect(getFileSize(filePath)).toBe(12);
    });

    it('formatBytes formats correctly', () => {
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(1024 * 1024)).toBe('1 MB');
      expect(formatBytes(1536)).toBe('1.5 KB');
    });
  });

  describe('loadRetentionConfig', () => {
    it('returns empty object for non-existent file', () => {
      const config = loadRetentionConfig('/nonexistent/path.json');
      expect(config).toEqual({});
    });

    it('loads config from file', () => {
      const configPath = path.join(testDir, 'retention.json');
      fs.writeFileSync(configPath, JSON.stringify({
        send_queue: { compact: true, key: ['job_id'] },
        metrics: { rotate: true, keep_days: 90 },
      }));

      const config = loadRetentionConfig(configPath);

      expect(config.send_queue.compact).toBe(true);
      expect(config.send_queue.key).toEqual(['job_id']);
      expect(config.metrics.rotate).toBe(true);
      expect(config.metrics.keep_days).toBe(90);
    });
  });
});
