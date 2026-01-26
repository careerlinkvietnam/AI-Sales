/**
 * DraftRegistry Tests
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  DraftRegistry,
  createTestDraftRegistry,
  getDraftRegistry,
  resetDraftRegistry,
} from '../src/data/DraftRegistry';

describe('DraftRegistry', () => {
  const testDir = path.join(__dirname, 'tmp_draft_registry_test');
  const draftsPath = path.join(testDir, 'drafts.ndjson');

  beforeEach(() => {
    // Create test directory
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    // Initialize empty drafts file
    fs.writeFileSync(draftsPath, '');
    resetDraftRegistry();
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    resetDraftRegistry();
  });

  describe('registerDraft', () => {
    it('registers a draft with hashed content', () => {
      const registry = new DraftRegistry({
        dataDir: testDir,
        draftsFile: 'drafts.ndjson',
      });

      const entry = registry.registerDraft({
        draftId: 'draft-123',
        trackingId: 'track-456',
        companyId: 'company-789',
        templateId: 'template-abc',
        abVariant: 'A',
        subject: 'Test Subject',
        body: 'Test Body',
        toEmail: 'user@example.com',
      });

      expect(entry.draftId).toBe('draft-123');
      expect(entry.trackingId).toBe('track-456');
      expect(entry.companyId).toBe('company-789');
      expect(entry.templateId).toBe('template-abc');
      expect(entry.abVariant).toBe('A');
      expect(entry.toDomain).toBe('example.com');
      // Check that subject/body are hashed, not stored as-is
      expect(entry.subjectHash).not.toBe('Test Subject');
      expect(entry.subjectHash.length).toBe(64); // SHA-256 hex
      expect(entry.bodyHash.length).toBe(64);
    });

    it('stores only domain, not full email (PII protection)', () => {
      const registry = new DraftRegistry({
        dataDir: testDir,
        draftsFile: 'drafts.ndjson',
      });

      const entry = registry.registerDraft({
        draftId: 'draft-123',
        trackingId: 'track-456',
        companyId: 'company-789',
        templateId: 'template-abc',
        abVariant: 'B',
        subject: 'Test',
        body: 'Test',
        toEmail: 'sensitive-name@company.co.jp',
      });

      expect(entry.toDomain).toBe('company.co.jp');
      // Verify PII is not in file
      const content = fs.readFileSync(draftsPath, 'utf-8');
      expect(content).toContain('company.co.jp');
      expect(content).not.toContain('sensitive-name@company.co.jp');
    });

    it('persists to file', () => {
      const registry = new DraftRegistry({
        dataDir: testDir,
        draftsFile: 'drafts.ndjson',
      });

      registry.registerDraft({
        draftId: 'draft-001',
        trackingId: 'track-001',
        companyId: 'company-001',
        templateId: 'template-001',
        abVariant: 'A',
        subject: 'Subject 1',
        body: 'Body 1',
        toEmail: 'a@x.com',
      });

      const content = fs.readFileSync(draftsPath, 'utf-8');
      expect(content).toContain('draft-001');
      expect(content).toContain('track-001');
    });
  });

  describe('lookupByDraftId', () => {
    it('finds existing draft', () => {
      const registry = new DraftRegistry({
        dataDir: testDir,
        draftsFile: 'drafts.ndjson',
      });

      registry.registerDraft({
        draftId: 'draft-abc',
        trackingId: 'track-xyz',
        companyId: 'company-123',
        templateId: 'template-456',
        abVariant: 'B',
        subject: 'Subject',
        body: 'Body',
        toEmail: 'user@test.com',
      });

      const result = registry.lookupByDraftId('draft-abc');
      expect(result.found).toBe(true);
      expect(result.entry?.draftId).toBe('draft-abc');
      expect(result.entry?.trackingId).toBe('track-xyz');
    });

    it('returns not found for non-existent draft', () => {
      const registry = new DraftRegistry({
        dataDir: testDir,
        draftsFile: 'drafts.ndjson',
      });

      const result = registry.lookupByDraftId('non-existent');
      expect(result.found).toBe(false);
      expect(result.entry).toBeUndefined();
    });
  });

  describe('lookupByTrackingId', () => {
    it('finds draft by tracking ID', () => {
      const registry = new DraftRegistry({
        dataDir: testDir,
        draftsFile: 'drafts.ndjson',
      });

      registry.registerDraft({
        draftId: 'draft-001',
        trackingId: 'my-tracking-id',
        companyId: 'company-001',
        templateId: 'template-001',
        abVariant: 'A',
        subject: 'Subject',
        body: 'Body',
        toEmail: 'user@test.com',
      });

      const result = registry.lookupByTrackingId('my-tracking-id');
      expect(result.found).toBe(true);
      expect(result.entry?.draftId).toBe('draft-001');
    });
  });

  describe('verifyDraft', () => {
    it('validates draft exists and tracking ID matches', () => {
      const registry = new DraftRegistry({
        dataDir: testDir,
        draftsFile: 'drafts.ndjson',
      });

      registry.registerDraft({
        draftId: 'draft-verify',
        trackingId: 'track-verify',
        companyId: 'company-001',
        templateId: 'template-001',
        abVariant: 'A',
        subject: 'Subject',
        body: 'Body',
        toEmail: 'user@test.com',
      });

      const result = registry.verifyDraft('draft-verify', 'track-verify');
      expect(result.valid).toBe(true);
      expect(result.entry?.draftId).toBe('draft-verify');
    });

    it('fails when draft not found', () => {
      const registry = new DraftRegistry({
        dataDir: testDir,
        draftsFile: 'drafts.ndjson',
      });

      const result = registry.verifyDraft('non-existent', 'any-tracking');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('fails when tracking ID mismatch', () => {
      const registry = new DraftRegistry({
        dataDir: testDir,
        draftsFile: 'drafts.ndjson',
      });

      registry.registerDraft({
        draftId: 'draft-mismatch',
        trackingId: 'correct-tracking',
        companyId: 'company-001',
        templateId: 'template-001',
        abVariant: 'A',
        subject: 'Subject',
        body: 'Body',
        toEmail: 'user@test.com',
      });

      const result = registry.verifyDraft('draft-mismatch', 'wrong-tracking');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('mismatch');
    });
  });

  describe('hasDraft', () => {
    it('returns true for existing draft', () => {
      const registry = new DraftRegistry({
        dataDir: testDir,
        draftsFile: 'drafts.ndjson',
      });

      registry.registerDraft({
        draftId: 'draft-exists',
        trackingId: 'track-001',
        companyId: 'company-001',
        templateId: 'template-001',
        abVariant: 'A',
        subject: 'Subject',
        body: 'Body',
        toEmail: 'user@test.com',
      });

      expect(registry.hasDraft('draft-exists')).toBe(true);
    });

    it('returns false for non-existent draft', () => {
      const registry = new DraftRegistry({
        dataDir: testDir,
        draftsFile: 'drafts.ndjson',
      });

      expect(registry.hasDraft('draft-not-exists')).toBe(false);
    });
  });

  describe('readAllEntries', () => {
    it('reads multiple entries', () => {
      const registry = new DraftRegistry({
        dataDir: testDir,
        draftsFile: 'drafts.ndjson',
      });

      registry.registerDraft({
        draftId: 'draft-1',
        trackingId: 'track-1',
        companyId: 'company-1',
        templateId: 'template-1',
        abVariant: 'A',
        subject: 'S1',
        body: 'B1',
        toEmail: 'a@x.com',
      });

      registry.registerDraft({
        draftId: 'draft-2',
        trackingId: 'track-2',
        companyId: 'company-2',
        templateId: 'template-2',
        abVariant: 'B',
        subject: 'S2',
        body: 'B2',
        toEmail: 'b@y.com',
      });

      const entries = registry.readAllEntries();
      expect(entries.length).toBe(2);
      expect(entries[0].draftId).toBe('draft-1');
      expect(entries[1].draftId).toBe('draft-2');
    });
  });

  describe('singleton', () => {
    it('getDraftRegistry returns same instance', () => {
      const registry1 = getDraftRegistry();
      const registry2 = getDraftRegistry();
      expect(registry1).toBe(registry2);
    });

    it('resetDraftRegistry clears singleton', () => {
      const registry1 = getDraftRegistry();
      resetDraftRegistry();
      const registry2 = getDraftRegistry();
      expect(registry1).not.toBe(registry2);
    });
  });
});
