import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_CHANNEL_PROOFS } from './fixtures/notification-channel-proofs';
import { notificationChannelLedger } from './helpers/notification-channel-evidence';

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
    const source = readFileSync(new URL('../' + row.proof, import.meta.url), 'utf8');
    expect(source).toContain(row.testName);
    expect(row.recipients.length).toBeGreaterThan(0);
    expect(row.proof).toMatch(/\.integration\.test\.ts$/);
  });
});
