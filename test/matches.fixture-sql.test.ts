import { describe, expect, it } from 'vitest';
import {
  matchFixtureLock,
  serializeMatchFixtureSql,
  withDeadlockRetry
} from '../e2e/match-fixture-sql';

describe('browser fixture transaction serialization', () => {
  it('takes the same cross-worker transaction lock before any fixture statement', () => {
    const query =
      'do $$ begin alter table public.match_events disable trigger match_event_immutable; end $$;';
    expect(serializeMatchFixtureSql(query)).toBe(
      `do $$ begin\n perform pg_advisory_xact_lock(${matchFixtureLock.namespace}, ${matchFixtureLock.key}); alter table public.match_events disable trigger match_event_immutable; end $$;`
    );
  });
  it('also serializes DML fixture blocks before they retain relation locks', () => {
    expect(serializeMatchFixtureSql('\nDO $$ BEGIN perform 1; END $$;')).toMatch(
      /BEGIN\n perform pg_advisory_xact_lock\(73073, 108\); perform 1;/
    );
  });
  it.each([
    'do $fixture$ begin alter table public.match_events disable trigger match_event_immutable; end $fixture$;',
    'do $proposal$ declare v_id uuid; begin perform 1; end $proposal$;',
    'do $$ declare v_id uuid; begin perform 1; end $$;'
  ])('serializes tagged and declared fixture blocks: %s', (query) => {
    expect(serializeMatchFixtureSql(query)).toMatch(
      /begin\n perform pg_advisory_xact_lock\(73073, 108\);/
    );
  });
  it.each(['select 1', 'update public.community_members set role=role', '-- do $$ begin'])(
    'preserves unwrapped SQL and its result contract: %s',
    (query) => {
      expect(serializeMatchFixtureSql(query)).toBe(query);
    }
  );
});

describe('withDeadlockRetry', () => {
  const deadlock = () => new Error('Local SQL failed (1): deadlock detected SQLSTATE 40P01');

  it('retries a deadlock victim and returns the later success', async () => {
    let calls = 0;
    await expect(
      withDeadlockRetry(async () => {
        if (++calls < 3) throw deadlock();
        return 'ok';
      })
    ).resolves.toBe('ok');
    expect(calls).toBe(3);
  });
  it('stops after three deadlocked attempts', async () => {
    let calls = 0;
    await expect(
      withDeadlockRetry(async () => {
        calls++;
        throw deadlock();
      })
    ).rejects.toThrow(/deadlock detected/);
    expect(calls).toBe(3);
  });
  it('never retries other failures', async () => {
    let calls = 0;
    await expect(
      withDeadlockRetry(async () => {
        calls++;
        throw new Error('syntax error');
      })
    ).rejects.toThrow('syntax error');
    expect(calls).toBe(1);
  });
});
