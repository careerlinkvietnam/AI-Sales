/**
 * ABAssigner Test Suite
 */

import {
  ABAssigner,
  createTestABAssigner,
  getABAssigner,
} from '../src/domain/ABAssigner';

describe('ABAssigner', () => {
  describe('assign', () => {
    it('returns A or B variant', () => {
      const assigner = createTestABAssigner();
      const result = assigner.assign('company-123');

      expect(['A', 'B']).toContain(result.variant);
    });

    it('returns template ID matching variant', () => {
      const assigner = createTestABAssigner();
      const result = assigner.assign('company-123');

      expect(result.templateId).toContain(result.variant);
    });

    it('returns full template configuration', () => {
      const assigner = createTestABAssigner();
      const result = assigner.assign('company-123');

      expect(result.template).toBeDefined();
      expect(result.template.templateId).toBe(result.templateId);
      expect(result.template.subjectTemplate).toBeDefined();
      expect(result.template.candidateHeader).toBeDefined();
      expect(result.template.ctaText).toBeDefined();
    });

    it('is stable - same company always gets same variant', () => {
      const assigner = createTestABAssigner();

      const results: string[] = [];
      for (let i = 0; i < 10; i++) {
        results.push(assigner.assign('stable-company-id').variant);
      }

      // All results should be the same
      const uniqueResults = new Set(results);
      expect(uniqueResults.size).toBe(1);
    });

    it('is stable across different instances with same salt', () => {
      const salt = 'test-salt-123';
      const assigner1 = createTestABAssigner(undefined, salt);
      const assigner2 = createTestABAssigner(undefined, salt);

      const companyId = 'test-company-456';
      expect(assigner1.assign(companyId).variant).toBe(
        assigner2.assign(companyId).variant
      );
    });

    it('distributes roughly 50/50 across many companies', () => {
      const assigner = createTestABAssigner();
      let countA = 0;
      let countB = 0;

      for (let i = 0; i < 1000; i++) {
        const result = assigner.assign(`company-${i}`);
        if (result.variant === 'A') countA++;
        else countB++;
      }

      // Should be roughly 50/50 (within 10% margin)
      const ratio = countA / (countA + countB);
      expect(ratio).toBeGreaterThan(0.4);
      expect(ratio).toBeLessThan(0.6);
    });

    it('different companies can get different variants', () => {
      const assigner = createTestABAssigner();
      const variants = new Set<string>();

      // Try many companies to find both variants
      for (let i = 0; i < 100; i++) {
        variants.add(assigner.assign(`company-${i}`).variant);
        if (variants.size === 2) break;
      }

      expect(variants.size).toBe(2);
    });
  });

  describe('getTemplate', () => {
    it('returns template for variant A', () => {
      const assigner = createTestABAssigner();
      const template = assigner.getTemplate('A');

      expect(template.templateId).toContain('_A');
    });

    it('returns template for variant B', () => {
      const assigner = createTestABAssigner();
      const template = assigner.getTemplate('B');

      expect(template.templateId).toContain('_B');
    });

    it('A and B templates have different content', () => {
      const assigner = createTestABAssigner();
      const templateA = assigner.getTemplate('A');
      const templateB = assigner.getTemplate('B');

      expect(templateA.subjectTemplate).not.toBe(templateB.subjectTemplate);
      expect(templateA.candidateHeader).not.toBe(templateB.candidateHeader);
      expect(templateA.ctaText).not.toBe(templateB.ctaText);
    });
  });

  describe('custom templates', () => {
    it('uses custom templates when provided', () => {
      const customTemplates = {
        A: {
          templateId: 'custom_A',
          subjectTemplate: 'Custom A Subject',
          candidateHeader: 'Custom A Header',
          ctaText: 'Custom A CTA',
        },
        B: {
          templateId: 'custom_B',
          subjectTemplate: 'Custom B Subject',
          candidateHeader: 'Custom B Header',
          ctaText: 'Custom B CTA',
        },
      };

      const assigner = createTestABAssigner(customTemplates);
      const templateA = assigner.getTemplate('A');
      const templateB = assigner.getTemplate('B');

      expect(templateA.templateId).toBe('custom_A');
      expect(templateB.templateId).toBe('custom_B');
    });
  });

  describe('getABAssigner singleton', () => {
    it('returns an ABAssigner instance', () => {
      const assigner = getABAssigner();
      expect(assigner).toBeInstanceOf(ABAssigner);
    });
  });
});
