/**
 * Tracking Module Test Suite
 */

import {
  generateTrackingId,
  formatTrackingTag,
  applyTrackingToEmail,
  extractTrackingId,
  isValidTrackingId,
} from '../src/domain/Tracking';

describe('Tracking', () => {
  describe('generateTrackingId', () => {
    it('generates 8-character hex string', () => {
      const id = generateTrackingId();
      expect(id).toMatch(/^[a-f0-9]{8}$/);
    });

    it('generates unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateTrackingId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('formatTrackingTag', () => {
    it('formats tracking tag correctly', () => {
      const tag = formatTrackingTag('a1b2c3d4');
      expect(tag).toBe('[CL-AI:a1b2c3d4]');
    });
  });

  describe('applyTrackingToEmail', () => {
    it('adds tracking tag to subject', () => {
      const result = applyTrackingToEmail(
        'Test Subject',
        'Test body',
        'a1b2c3d4'
      );

      expect(result.subject).toBe('Test Subject [CL-AI:a1b2c3d4]');
    });

    it('adds tracking tag to body before signature', () => {
      const body = `
Hello,

This is the email body.

---
Signature
      `.trim();

      const result = applyTrackingToEmail('Subject', body, 'a1b2c3d4');

      // Should contain tracking tag before signature
      expect(result.body).toContain('[CL-AI:a1b2c3d4]');
      expect(result.body.indexOf('[CL-AI:a1b2c3d4]')).toBeLessThan(
        result.body.indexOf('---')
      );
    });

    it('adds tracking tag at end if no signature', () => {
      const body = 'Simple body without signature';

      const result = applyTrackingToEmail('Subject', body, 'a1b2c3d4');

      expect(result.body).toContain('[CL-AI:a1b2c3d4]');
      expect(result.body.endsWith('[CL-AI:a1b2c3d4]')).toBe(true);
    });

    it('uses same tracking ID in subject and body', () => {
      const result = applyTrackingToEmail(
        'Subject',
        'Body\n---\nSignature',
        'abcd1234'
      );

      const subjectId = extractTrackingId(result.subject);
      const bodyId = extractTrackingId(result.body);

      expect(subjectId).toBe('abcd1234');
      expect(bodyId).toBe('abcd1234');
      expect(subjectId).toBe(bodyId);
    });
  });

  describe('extractTrackingId', () => {
    it('extracts tracking ID from text', () => {
      const text = 'Subject with [CL-AI:a1b2c3d4] tag';
      expect(extractTrackingId(text)).toBe('a1b2c3d4');
    });

    it('returns null for text without tracking ID', () => {
      expect(extractTrackingId('No tracking here')).toBeNull();
    });

    it('extracts ID regardless of case', () => {
      const text = 'Subject [CL-AI:ABCD1234]';
      expect(extractTrackingId(text)).toBe('ABCD1234');
    });
  });

  describe('isValidTrackingId', () => {
    it('returns true for valid tracking ID', () => {
      expect(isValidTrackingId('a1b2c3d4')).toBe(true);
      expect(isValidTrackingId('ABCD1234')).toBe(true);
      expect(isValidTrackingId('00000000')).toBe(true);
    });

    it('returns false for invalid tracking ID', () => {
      expect(isValidTrackingId('abc')).toBe(false); // too short
      expect(isValidTrackingId('a1b2c3d4e5')).toBe(false); // too long
      expect(isValidTrackingId('ghijklmn')).toBe(false); // invalid chars
    });
  });
});
