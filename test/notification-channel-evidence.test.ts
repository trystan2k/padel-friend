import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_CHANNEL_PROOFS } from './fixtures/notification-channel-proofs';
import { notificationChannelLedger } from './helpers/notification-channel-evidence';
import { analyzeProofSource, proofSourceAnalysis } from './helpers/notification-proof-source';

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
    // The bound test must perform this event's command and assert this event's notification kind
    // (recipients + Push job), not merely mention generic recipient/job text.
    expect(proofSourceAnalysis(row.proof, row.testName, row.evidence)).toMatchObject({
      found: true,
      command: true,
      kind: true,
      silence: true
    });
  });
});

describe('notification channel proof checker rejects mismatched or vacuous bindings', () => {
  const evidence = { kind: 'league_started', command: 'league_process_community_locked' };
  const wellFormed = `describe('x', () => {
    it('starts a league', async () => {
      await executeTrustedSql(\`select public.league_process_community_locked('id', now())\`);
      await channels('league_started', id, [admin.id, owner.id]);
    });
  });`;

  it('accepts a binding that performs the command and asserts the kind with recipients and jobs', () => {
    expect(analyzeProofSource(wellFormed, 'starts a league', evidence).ok).toBe(true);
  });

  it('rejects a binding written to a temp test that never touches the event', () => {
    const directory = mkdtempSync(join(tmpdir(), 'paf15-ledger-'));
    try {
      const file = join(directory, 'wrong.integration.test.ts');
      writeFileSync(
        file,
        `it('starts a league', async () => {
          // league_process_community_locked, 'league_started', recipient, notification_push_jobs
          await expectNotificationPushJobs(rows);
          const note = 'recipient notification_push_jobs league_started';
        });`
      );
      expect(
        analyzeProofSource(readFileSync(file, 'utf8'), 'starts a league', evidence)
      ).toMatchObject({
        found: true,
        command: false,
        kind: false,
        ok: false
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects the right command asserting a different notification kind', () => {
    const wrongKind = wellFormed.replace("channels('league_started'", "channels('league_closed'");
    expect(analyzeProofSource(wrongKind, 'starts a league', evidence)).toMatchObject({
      command: true,
      kind: false,
      ok: false
    });
  });

  it('rejects the right kind when the transition command is never performed', () => {
    const noCommand = wellFormed.replace('league_process_community_locked', 'something_else');
    expect(analyzeProofSource(noCommand, 'starts a league', evidence)).toMatchObject({
      command: false,
      kind: true,
      ok: false
    });
  });

  it('rejects an exclusion row that asserts no silence for the unaffected recipients', () => {
    expect(
      analyzeProofSource(wellFormed, 'starts a league', { ...evidence, silence: true })
    ).toMatchObject({ silence: false, ok: false });
  });

  it('rejects a binding whose recipient and job assertions are attached to a different kind', () => {
    const wrongAttachment = `it('starts a league', async () => {
      await executeTrustedSql(\`select public.league_process_community_locked('id', now())\`);
      await expectNotificationPushJobs(rows);
      const recipient = admin.id;
      await expectNotificationOutcome({ targetId: id, kind: 'league_closed', recipients: [recipient] });
      expect(kinds).toContain('league_started');
    });`;
    expect(analyzeProofSource(wrongAttachment, 'starts a league', evidence)).toMatchObject({
      command: true,
      kind: false,
      ok: false
    });
    // Same shape through the matrix suite's channels() helper.
    const viaChannels = wrongAttachment.replace(
      /await expectNotificationOutcome\(.*\);/,
      "await channels('league_closed', id, [admin.id]);"
    );
    expect(analyzeProofSource(viaChannels, 'starts a league', evidence)).toMatchObject({
      command: true,
      kind: false,
      ok: false
    });
  });

  it('accepts the same shape once the assertion is attached to the bound kind', () => {
    const attached = `it('starts a league', async () => {
      await executeTrustedSql(\`select public.league_process_community_locked('id', now())\`);
      await expectNotificationOutcome({ targetId: id, kind: 'league_started', recipients: [admin.id] });
    });`;
    expect(analyzeProofSource(attached, 'starts a league', evidence).ok).toBe(true);
  });

  it('rejects a missing test', () => {
    expect(analyzeProofSource(wellFormed, 'never written', evidence).found).toBe(false);
  });

  it("rejects every real binding when it is paired with another suite's transition evidence", () => {
    const ledger = notificationChannelLedger();
    for (const row of ledger) {
      const foreign = ledger.find(
        (other) =>
          other.proof !== row.proof &&
          other.evidence.kind !== row.evidence.kind &&
          other.evidence.command !== row.evidence.command
      )!;
      const { ok } = proofSourceAnalysis(row.proof, row.testName, {
        kind: foreign.evidence.kind,
        command: foreign.evidence.command
      });
      expect(ok, `${row.event} must not satisfy ${foreign.event}`).toBe(false);
    }
  });
});
