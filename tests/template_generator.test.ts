/**
 * TemplateGenerator Tests
 */
import {
  TemplateGenerator,
  TemplateContent,
  TemplateProposal,
  createTemplateGenerator,
} from '../src/domain/TemplateGenerator';
import { ImprovementCandidate } from '../src/domain/ImprovementPicker';

describe('TemplateGenerator', () => {
  let generator: TemplateGenerator;

  beforeEach(() => {
    generator = new TemplateGenerator();
  });

  describe('generate', () => {
    it('should generate proposals for valid candidate', () => {
      const candidate: ImprovementCandidate = {
        segmentKey: 'region:南部',
        segmentName: 'region',
        segmentValue: '南部',
        templateId: 'new_candidates_v1_A',
        variant: 'A',
        sent: 100,
        replyRate: 0.05,
        gapVsBest: 0.10,
        latencyGapVsBest: null,
        reason: 'Reply rate 5.0% is 10.0pp below best',
      };

      const proposals = generator.generate(candidate, 2);

      expect(proposals.length).toBeGreaterThan(0);
      expect(proposals.length).toBeLessThanOrEqual(2);
    });

    it('should include required fields in proposal', () => {
      const candidate: ImprovementCandidate = {
        segmentKey: 'region:南部',
        segmentName: 'region',
        segmentValue: '南部',
        templateId: 'new_candidates_v1_A',
        variant: 'A',
        sent: 100,
        replyRate: 0.05,
        gapVsBest: 0.10,
        latencyGapVsBest: null,
        reason: 'Reply rate 5.0% is 10.0pp below best',
      };

      const proposals = generator.generate(candidate, 1);
      const proposal = proposals[0];

      expect(proposal.templateIdNew).toBeDefined();
      expect(proposal.baseTemplateId).toBe('new_candidates_v1_A');
      expect(proposal.variant).toBe('A');
      expect(proposal.status).toBe('proposed');
      expect(proposal.changes).toBeDefined();
      expect(proposal.changes.length).toBeGreaterThan(0);
      expect(proposal.content).toBeDefined();
      expect(proposal.targetSegment.segmentName).toBe('region');
      expect(proposal.targetSegment.segmentValue).toBe('南部');
      expect(proposal.rationale).toBeDefined();
    });

    it('should track changes with before/after values', () => {
      const candidate: ImprovementCandidate = {
        segmentKey: 'region:南部',
        segmentName: 'region',
        segmentValue: '南部',
        templateId: 'new_candidates_v1_A',
        variant: 'A',
        sent: 100,
        replyRate: 0.05,
        gapVsBest: 0.10,
        latencyGapVsBest: null,
        reason: 'Reply rate 5.0% is 10.0pp below best',
      };

      const proposals = generator.generate(candidate, 1);
      const proposal = proposals[0];
      const change = proposal.changes[0];

      expect(change.field).toBeDefined();
      expect(change.type).toBeDefined();
      expect(change.description).toBeDefined();
      expect(change.before).toBeDefined();
      expect(change.after).toBeDefined();
      expect(change.before).not.toBe(change.after);
    });

    it('should generate unique template IDs', () => {
      const candidate: ImprovementCandidate = {
        segmentKey: 'region:南部',
        segmentName: 'region',
        segmentValue: '南部',
        templateId: 'new_candidates_v1_A',
        variant: 'A',
        sent: 100,
        replyRate: 0.05,
        gapVsBest: 0.10,
        latencyGapVsBest: null,
        reason: 'Reply rate 5.0% is 10.0pp below best',
      };

      const proposals1 = generator.generate(candidate, 2);
      const proposals2 = generator.generate(candidate, 2);

      // Note: Same strategies may be selected for same candidate, but timestamps should differ
      // Verify that at least within a single call, IDs are unique
      const ids1 = proposals1.map(p => p.templateIdNew);
      const uniqueIds1 = new Set(ids1);
      expect(uniqueIds1.size).toBe(ids1.length);

      const ids2 = proposals2.map(p => p.templateIdNew);
      const uniqueIds2 = new Set(ids2);
      expect(uniqueIds2.size).toBe(ids2.length);
    });

    it('should handle B variant templates', () => {
      const candidate: ImprovementCandidate = {
        segmentKey: 'region:南部',
        segmentName: 'region',
        segmentValue: '南部',
        templateId: 'new_candidates_v1_B',
        variant: 'B',
        sent: 100,
        replyRate: 0.05,
        gapVsBest: 0.10,
        latencyGapVsBest: null,
        reason: 'Reply rate 5.0% is 10.0pp below best',
      };

      const proposals = generator.generate(candidate, 2);

      expect(proposals.length).toBeGreaterThan(0);
      expect(proposals[0].variant).toBe('B');
    });

    it('should fall back to default template for unknown template ID', () => {
      const candidate: ImprovementCandidate = {
        segmentKey: 'region:南部',
        segmentName: 'region',
        segmentValue: '南部',
        templateId: 'unknown_template',
        variant: 'A',
        sent: 100,
        replyRate: 0.05,
        gapVsBest: 0.10,
        latencyGapVsBest: null,
        reason: 'Reply rate 5.0% is 10.0pp below best',
      };

      const proposals = generator.generate(candidate, 2);

      expect(proposals.length).toBeGreaterThan(0);
      expect(proposals[0].baseTemplateId).toBe('new_candidates_v1_A');
    });

    it('should respect proposalsPerCandidate limit', () => {
      const candidate: ImprovementCandidate = {
        segmentKey: 'region:南部',
        segmentName: 'region',
        segmentValue: '南部',
        templateId: 'new_candidates_v1_A',
        variant: 'A',
        sent: 100,
        replyRate: 0.05,
        gapVsBest: 0.10,
        latencyGapVsBest: null,
        reason: 'Reply rate 5.0% is 10.0pp below best',
      };

      const proposals1 = generator.generate(candidate, 1);
      const proposals5 = generator.generate(candidate, 5);

      expect(proposals1.length).toBeLessThanOrEqual(1);
      expect(proposals5.length).toBeLessThanOrEqual(5);
    });
  });

  describe('strategy selection', () => {
    it('should select question/urgency strategies for low reply rate', () => {
      const candidate: ImprovementCandidate = {
        segmentKey: 'region:南部',
        segmentName: 'region',
        segmentValue: '南部',
        templateId: 'new_candidates_v1_A',
        variant: 'A',
        sent: 100,
        replyRate: 0.05,
        gapVsBest: 0.10,
        latencyGapVsBest: null,
        reason: 'Reply rate 5.0% is 10.0pp below best',
      };

      const proposals = generator.generate(candidate, 3);

      // Should include engagement-focused strategies
      const changeTypes = proposals.flatMap(p => p.changes.map(c => c.type));
      expect(
        changeTypes.some(t => ['question', 'urgency', 'personalization'].includes(t))
      ).toBe(true);
    });

    it('should select urgency/simplify strategies for high latency', () => {
      const candidate: ImprovementCandidate = {
        segmentKey: 'region:南部',
        segmentName: 'region',
        segmentValue: '南部',
        templateId: 'new_candidates_v1_A',
        variant: 'A',
        sent: 100,
        replyRate: 0.10,
        gapVsBest: 0.05,
        latencyGapVsBest: 12,
        reason: 'Latency 24.0h is 12.0h slower than best',
      };

      const proposals = generator.generate(candidate, 3);

      // Should include urgency or structure strategies
      const changeTypes = proposals.flatMap(p => p.changes.map(c => c.type));
      expect(
        changeTypes.some(t => ['urgency', 'structure'].includes(t))
      ).toBe(true);
    });
  });

  describe('content transformations', () => {
    it('should apply subject transformations correctly', () => {
      const candidate: ImprovementCandidate = {
        segmentKey: 'region:南部',
        segmentName: 'region',
        segmentValue: '南部',
        templateId: 'new_candidates_v1_A',
        variant: 'A',
        sent: 100,
        replyRate: 0.05,
        gapVsBest: 0.10,
        latencyGapVsBest: null,
        reason: 'Reply rate 5.0% is 10.0pp below best',
      };

      const proposals = generator.generate(candidate, 5);

      // Check that subject changes are applied
      const subjectChanges = proposals
        .flatMap(p => p.changes)
        .filter(c => c.field === 'subjectTemplate');

      if (subjectChanges.length > 0) {
        subjectChanges.forEach(change => {
          expect(change.before).not.toBe(change.after);
        });
      }
    });

    it('should apply CTA transformations correctly', () => {
      const candidate: ImprovementCandidate = {
        segmentKey: 'region:南部',
        segmentName: 'region',
        segmentValue: '南部',
        templateId: 'new_candidates_v1_A',
        variant: 'A',
        sent: 100,
        replyRate: 0.05,
        gapVsBest: 0.10,
        latencyGapVsBest: null,
        reason: 'Reply rate 5.0% is 10.0pp below best',
      };

      const proposals = generator.generate(candidate, 5);

      // Check that CTA changes are applied
      const ctaChanges = proposals
        .flatMap(p => p.changes)
        .filter(c => c.field === 'ctaText');

      if (ctaChanges.length > 0) {
        ctaChanges.forEach(change => {
          expect(change.before).not.toBe(change.after);
        });
      }
    });
  });

  describe('custom base templates', () => {
    it('should use custom templates when provided', () => {
      const customTemplates: Record<string, TemplateContent> = {
        custom_A: {
          subjectTemplate: '【Custom】{{companyName}}様へのご提案',
          candidateHeader: '【候補者】',
          ctaText: 'ご連絡ください。',
        },
      };

      const customGenerator = new TemplateGenerator({
        baseTemplates: customTemplates,
      });

      const candidate: ImprovementCandidate = {
        segmentKey: 'region:南部',
        segmentName: 'region',
        segmentValue: '南部',
        templateId: 'custom_A',
        variant: 'A',
        sent: 100,
        replyRate: 0.05,
        gapVsBest: 0.10,
        latencyGapVsBest: null,
        reason: 'Reply rate 5.0% is 10.0pp below best',
      };

      const proposals = customGenerator.generate(candidate, 2);

      expect(proposals.length).toBeGreaterThan(0);
      expect(proposals[0].baseTemplateId).toBe('custom_A');
    });
  });

  describe('getBaseTemplates', () => {
    it('should return available template IDs', () => {
      const templates = generator.getBaseTemplates();

      expect(templates).toContain('new_candidates_v1_A');
      expect(templates).toContain('new_candidates_v1_B');
    });
  });

  describe('createTemplateGenerator factory', () => {
    it('should create generator with default templates', () => {
      const factoryGenerator = createTemplateGenerator();
      const templates = factoryGenerator.getBaseTemplates();

      expect(templates.length).toBe(2);
    });

    it('should create generator with custom templates', () => {
      const customTemplates: Record<string, TemplateContent> = {
        test_A: {
          subjectTemplate: 'Test',
          candidateHeader: 'Test',
          ctaText: 'Test',
        },
      };

      const factoryGenerator = createTemplateGenerator({
        baseTemplates: customTemplates,
      });
      const templates = factoryGenerator.getBaseTemplates();

      expect(templates).toContain('test_A');
      expect(templates).not.toContain('new_candidates_v1_A');
    });
  });
});
