/**
 * AI-Sales CRM Connector
 *
 * Main entry point for the CRM connector library.
 */

// Types
export * from './types';

// Domain
export { TagNormalizer } from './domain/TagNormalizer';

// Connectors
export { CrmClient } from './connectors/crm/CrmClient';
