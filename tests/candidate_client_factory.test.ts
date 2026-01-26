/**
 * CandidateClientFactory Test Suite
 *
 * Tests the factory function and environment variable handling.
 */

import {
  createCandidateClient,
  getCandidateMode,
  isCandidateRealModeConfigured,
} from '../src/connectors/candidate/CandidateClientFactory';
import { StubCandidateClient } from '../src/connectors/candidate/StubCandidateClient';
import { RealCandidateClient } from '../src/connectors/candidate/RealCandidateClient';
import { ConfigurationError } from '../src/types';

describe('CandidateClientFactory', () => {
  // Store original env vars
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore original env vars
    process.env = { ...originalEnv };
  });

  describe('createCandidateClient', () => {
    test('creates StubCandidateClient by default', () => {
      delete process.env.CANDIDATE_MODE;

      const client = createCandidateClient();

      expect(client).toBeInstanceOf(StubCandidateClient);
      expect(client.isStubMode()).toBe(true);
    });

    test('creates StubCandidateClient when CANDIDATE_MODE=stub', () => {
      process.env.CANDIDATE_MODE = 'stub';

      const client = createCandidateClient();

      expect(client).toBeInstanceOf(StubCandidateClient);
      expect(client.getMode()).toBe('stub');
    });

    test('creates StubCandidateClient when mode option is stub', () => {
      process.env.CANDIDATE_MODE = 'real'; // Should be overridden

      const client = createCandidateClient({ mode: 'stub' });

      expect(client).toBeInstanceOf(StubCandidateClient);
    });

    test('creates RealCandidateClient when mode is real with options', () => {
      const client = createCandidateClient({
        mode: 'real',
        apiUrl: 'https://api.test.com',
        apiKey: 'test-key',
      });

      expect(client).toBeInstanceOf(RealCandidateClient);
      expect(client.isStubMode()).toBe(false);
      expect(client.getMode()).toBe('real');
    });

    test('throws ConfigurationError when real mode without URL', () => {
      delete process.env.CANDIDATE_API_URL;
      delete process.env.CANDIDATE_API_KEY;

      expect(() => {
        createCandidateClient({ mode: 'real' });
      }).toThrow(ConfigurationError);
    });

    test('throws ConfigurationError when real mode without API key', () => {
      expect(() => {
        createCandidateClient({
          mode: 'real',
          apiUrl: 'https://api.test.com',
          // apiKey missing
        });
      }).toThrow(ConfigurationError);
    });

    test('uses environment variables for real mode', () => {
      process.env.CANDIDATE_MODE = 'real';
      process.env.CANDIDATE_API_URL = 'https://api.test.com';
      process.env.CANDIDATE_API_KEY = 'test-key';

      const client = createCandidateClient();

      expect(client).toBeInstanceOf(RealCandidateClient);
    });

    test('handles case-insensitive CANDIDATE_MODE', () => {
      process.env.CANDIDATE_MODE = 'REAL';
      process.env.CANDIDATE_API_URL = 'https://api.test.com';
      process.env.CANDIDATE_API_KEY = 'test-key';

      const client = createCandidateClient();

      expect(client).toBeInstanceOf(RealCandidateClient);
    });

    test('handles mixed case CANDIDATE_MODE', () => {
      process.env.CANDIDATE_MODE = 'ReAl';
      process.env.CANDIDATE_API_URL = 'https://api.test.com';
      process.env.CANDIDATE_API_KEY = 'test-key';

      const client = createCandidateClient();

      expect(client).toBeInstanceOf(RealCandidateClient);
    });
  });

  describe('getCandidateMode', () => {
    test('returns stub by default', () => {
      delete process.env.CANDIDATE_MODE;

      expect(getCandidateMode()).toBe('stub');
    });

    test('returns stub when set to stub', () => {
      process.env.CANDIDATE_MODE = 'stub';

      expect(getCandidateMode()).toBe('stub');
    });

    test('returns real when set to real', () => {
      process.env.CANDIDATE_MODE = 'real';

      expect(getCandidateMode()).toBe('real');
    });

    test('returns stub for invalid values', () => {
      process.env.CANDIDATE_MODE = 'invalid';

      expect(getCandidateMode()).toBe('stub');
    });
  });

  describe('isCandidateRealModeConfigured', () => {
    test('returns false when mode is stub', () => {
      process.env.CANDIDATE_MODE = 'stub';
      process.env.CANDIDATE_API_URL = 'https://api.test.com';
      process.env.CANDIDATE_API_KEY = 'test-key';

      expect(isCandidateRealModeConfigured()).toBe(false);
    });

    test('returns false when URL is missing', () => {
      process.env.CANDIDATE_MODE = 'real';
      delete process.env.CANDIDATE_API_URL;
      process.env.CANDIDATE_API_KEY = 'test-key';

      expect(isCandidateRealModeConfigured()).toBe(false);
    });

    test('returns false when API key is missing', () => {
      process.env.CANDIDATE_MODE = 'real';
      process.env.CANDIDATE_API_URL = 'https://api.test.com';
      delete process.env.CANDIDATE_API_KEY;

      expect(isCandidateRealModeConfigured()).toBe(false);
    });

    test('returns true when fully configured', () => {
      process.env.CANDIDATE_MODE = 'real';
      process.env.CANDIDATE_API_URL = 'https://api.test.com';
      process.env.CANDIDATE_API_KEY = 'test-key';

      expect(isCandidateRealModeConfigured()).toBe(true);
    });
  });
});
