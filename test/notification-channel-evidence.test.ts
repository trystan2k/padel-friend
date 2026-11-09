import { describe, expect, it } from 'vitest';
import { NOTIFICATION_CHANNEL_PROOFS } from './fixtures/notification-channel-proofs';
import { notificationChannelLedger } from './helpers/notification-channel-evidence';
import { proofSourceAssertions } from './helpers/notification-proof-source';

describe('notification channel proof ledger', () => {
  const ledger = notificationChannelLedger();
  it('binds all 60 distinct transitions to named domain tests and explicit fixture recipients', () => {
    expect(ledger).toHaveLength(60);
    expect(new Set(ledger.map((row) => row.event)).size).toBe(60);
    expect(new Set(ledger.map((row) => row.category)).size).toBe(5);
  });
  it('has no proof bound to an event outside the matrix', () => {
    const events = new Set(ledger.map((row) => row.event));
    for (const proof of NOTIFICATION_CHANNEL_PROOFS)
      for (const event of proof.events) expect(events.has(event)).toBe(true);
  });
  it.each(ledger)('$event → $proof → $testName → $recipients', (row) => {
    expect(row.recipients.length).toBeGreaterThan(0);
    expect(row.proof).toMatch(/\.integration\.test\.ts$/);
    // The bound test (with its local helpers) must exist and assert both the recipients and the Push job.
    expect(proofSourceAssertions(row.proof, row.testName)).toEqual({
      found: true,
      recipients: true,
      jobs: true
    });
  });
});
