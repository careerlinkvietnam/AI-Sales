/**
 * AuditLogger Test Suite
 *
 * Tests for audit logging functionality.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AuditLogger, createTestAuditLogger } from '../src/domain/AuditLogger';

describe('AuditLogger', () => {
  const testLogDir = 'logs/test-audit';
  const testLogFile = 'audit-test.ndjson';
  const testLogPath = path.join(testLogDir, testLogFile);

  let logger: AuditLogger;

  beforeEach(() => {
    // Clean up test log file if exists
    if (fs.existsSync(testLogPath)) {
      fs.unlinkSync(testLogPath);
    }

    logger = new AuditLogger({
      logDir: testLogDir,
      logFile: testLogFile,
      enabled: true,
    });
  });

  afterAll(() => {
    // Clean up test directory
    if (fs.existsSync(testLogPath)) {
      fs.unlinkSync(testLogPath);
    }
    if (fs.existsSync(testLogDir)) {
      fs.rmdirSync(testLogDir);
    }
  });

  describe('logPipelineRun', () => {
    it('writes pipeline run entry to log file', () => {
      logger.logPipelineRun({
        tag: '南部・3月連絡',
        companyId: 'company-123',
        companyName: 'Test Company',
        selectedCandidates: [
          { candidateId: 'C001', included: true },
          { candidateId: 'C002', included: false, excludedReason: 'PII検出' },
        ],
        draftCreated: true,
        gmailDraftId: 'draft-abc',
        mode: 'stub',
      });

      const entries = logger.readRecentEntries(1);
      expect(entries).toHaveLength(1);
      expect(entries[0].eventType).toBe('pipeline_run');
      expect(entries[0].tag).toBe('南部・3月連絡');
      expect(entries[0].companyId).toBe('company-123');
      expect(entries[0].draftCreated).toBe(true);
      expect(entries[0].gmailDraftId).toBe('draft-abc');
      expect(entries[0].mode).toBe('stub');
    });

    it('hashes company name for privacy', () => {
      logger.logPipelineRun({
        tag: 'test-tag',
        companyId: 'company-123',
        companyName: 'Sensitive Company Name',
        selectedCandidates: [],
        draftCreated: false,
        mode: 'stub',
      });

      const entries = logger.readRecentEntries(1);
      expect(entries[0].companyNameHash).toBeDefined();
      expect(entries[0].companyNameHash).not.toContain('Sensitive');
      expect(entries[0].companyNameHash?.length).toBe(16); // SHA256 truncated to 16 chars
    });

    it('does not include company name directly', () => {
      logger.logPipelineRun({
        tag: 'test-tag',
        companyId: 'company-123',
        companyName: 'ABC Corporation',
        selectedCandidates: [],
        draftCreated: false,
        mode: 'stub',
      });

      // Read raw log file
      const content = fs.readFileSync(testLogPath, 'utf-8');
      expect(content).not.toContain('ABC Corporation');
    });
  });

  describe('logDraftCreated', () => {
    it('writes draft created entry', () => {
      logger.logDraftCreated({
        tag: 'test-tag',
        companyId: 'company-456',
        gmailDraftId: 'draft-xyz',
        candidateCount: 3,
        mode: 'real',
      });

      const entries = logger.readRecentEntries(1);
      expect(entries).toHaveLength(1);
      expect(entries[0].eventType).toBe('draft_created');
      expect(entries[0].gmailDraftId).toBe('draft-xyz');
      expect(entries[0].metadata?.candidateCount).toBe(3);
    });
  });

  describe('logValidationFailed', () => {
    it('writes validation failure entry', () => {
      logger.logValidationFailed({
        tag: 'test-tag',
        companyId: 'company-789',
        violations: ['メールアドレス検出', '電話番号検出'],
        mode: 'stub',
      });

      const entries = logger.readRecentEntries(1);
      expect(entries).toHaveLength(1);
      expect(entries[0].eventType).toBe('validation_failed');
      expect(entries[0].draftCreated).toBe(false);
      expect(entries[0].metadata?.violations).toEqual(['メールアドレス検出', '電話番号検出']);
    });
  });

  describe('readRecentEntries', () => {
    it('returns entries in order', () => {
      logger.logDraftCreated({
        tag: 'tag1',
        companyId: 'c1',
        gmailDraftId: 'd1',
        candidateCount: 1,
        mode: 'stub',
      });

      logger.logDraftCreated({
        tag: 'tag2',
        companyId: 'c2',
        gmailDraftId: 'd2',
        candidateCount: 2,
        mode: 'stub',
      });

      const entries = logger.readRecentEntries(2);
      expect(entries).toHaveLength(2);
      expect(entries[0].companyId).toBe('c1');
      expect(entries[1].companyId).toBe('c2');
    });

    it('respects limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        logger.logDraftCreated({
          tag: `tag-${i}`,
          companyId: `c${i}`,
          gmailDraftId: `d${i}`,
          candidateCount: i,
          mode: 'stub',
        });
      }

      const entries = logger.readRecentEntries(3);
      expect(entries).toHaveLength(3);
      // Should be the last 3 entries
      expect(entries[0].companyId).toBe('c2');
      expect(entries[1].companyId).toBe('c3');
      expect(entries[2].companyId).toBe('c4');
    });
  });

  describe('disabled logger', () => {
    it('does not write when disabled', () => {
      const disabledLogger = new AuditLogger({
        logDir: testLogDir,
        logFile: 'disabled-test.ndjson',
        enabled: false,
      });

      disabledLogger.logDraftCreated({
        tag: 'test',
        companyId: 'test',
        gmailDraftId: 'test',
        candidateCount: 1,
        mode: 'stub',
      });

      expect(fs.existsSync(path.join(testLogDir, 'disabled-test.ndjson'))).toBe(false);
    });
  });

  describe('createTestAuditLogger', () => {
    it('creates disabled logger by default', () => {
      const testLogger = createTestAuditLogger();
      expect(testLogger.getLogPath()).toContain('logs/test');
    });
  });
});
