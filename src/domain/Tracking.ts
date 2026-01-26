/**
 * Tracking Module for Email Correlation
 *
 * Provides tracking ID generation and email tagging for
 * measuring reply rates and conversion tracking.
 *
 * 目的:
 * - 返信率/商談化の効果測定
 * - 企業・候補者・テンプレートの紐付け
 */

import * as crypto from 'crypto';

/**
 * Tracking tag prefix
 */
const TRACKING_PREFIX = 'CL-AI';

/**
 * Tracking ID length (8 hex chars = 4 bytes)
 */
const TRACKING_ID_LENGTH = 8;

/**
 * Generate a unique tracking ID
 *
 * Format: 8-character hex string (e.g., "a1b2c3d4")
 */
export function generateTrackingId(): string {
  return crypto.randomBytes(4).toString('hex');
}

/**
 * Format tracking tag for display
 *
 * @param trackingId - The tracking ID
 * @returns Formatted tag like "[CL-AI:a1b2c3d4]"
 */
export function formatTrackingTag(trackingId: string): string {
  return `[${TRACKING_PREFIX}:${trackingId}]`;
}

/**
 * Apply tracking ID to email subject and body
 *
 * - Subject: Appends tracking tag at the end
 * - Body: Inserts tracking tag before the signature (after closing)
 *
 * @param subject - Original email subject
 * @param body - Original email body
 * @param trackingId - The tracking ID to apply
 * @returns Modified subject and body with tracking
 */
export function applyTrackingToEmail(
  subject: string,
  body: string,
  trackingId: string
): { subject: string; body: string } {
  const tag = formatTrackingTag(trackingId);

  // Apply to subject (append at end)
  const trackedSubject = `${subject} ${tag}`;

  // Apply to body (insert before signature line "---")
  // If no signature delimiter, append at end
  const signatureMarker = '\n---\n';
  let trackedBody: string;

  const signatureIndex = body.lastIndexOf(signatureMarker);
  if (signatureIndex !== -1) {
    // Insert tracking ID before signature
    const beforeSig = body.substring(0, signatureIndex);
    const afterSig = body.substring(signatureIndex);
    trackedBody = `${beforeSig}\n\n${tag}${afterSig}`;
  } else {
    // No signature, append at end
    trackedBody = `${body}\n\n${tag}`;
  }

  return {
    subject: trackedSubject,
    body: trackedBody,
  };
}

/**
 * Extract tracking ID from subject or body
 *
 * @param text - Text containing tracking tag
 * @returns Tracking ID if found, null otherwise
 */
export function extractTrackingId(text: string): string | null {
  const pattern = new RegExp(`\\[${TRACKING_PREFIX}:([a-f0-9]{${TRACKING_ID_LENGTH}})\\]`, 'i');
  const match = text.match(pattern);
  return match ? match[1] : null;
}

/**
 * Validate tracking ID format
 *
 * @param trackingId - The tracking ID to validate
 * @returns true if valid format
 */
export function isValidTrackingId(trackingId: string): boolean {
  const pattern = new RegExp(`^[a-f0-9]{${TRACKING_ID_LENGTH}}$`, 'i');
  return pattern.test(trackingId);
}

export default {
  generateTrackingId,
  formatTrackingTag,
  applyTrackingToEmail,
  extractTrackingId,
  isValidTrackingId,
};
