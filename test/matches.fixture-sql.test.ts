import { describe, expect, it } from 'vitest';
import { matchFixtureLock, serializeMatchFixtureSql } from '../e2e/match-fixture-sql';

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
  it.each(['select 1', 'update public.community_members set role=role', '-- do $$ begin'])(
    'preserves unwrapped SQL and its result contract: %s',
    (query) => {
      expect(serializeMatchFixtureSql(query)).toBe(query);
    }
  );
});
