import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  DUE_EVENT_COUNT,
  GUARD_TRIGGERS,
  insertProductFixtures,
  productAbsent,
  productOwnership,
  removeProductFixtures,
  snapshotProduct
} from '../scripts/isolation-proof-product-fixtures.mjs';
import { productWorld } from './helpers/isolation-product-world';

function fixture() {
  const world = productWorld();
  const db = {
    query: vi.fn<
      (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>
    >(async (sql, params = []) => {
      if (sql.startsWith('select proposal_id::text'))
        return {
          rows: world.state.versions.filter(
            (row) => Array.isArray(params[0]) && params[0].includes(row.proposal_id)
          )
        };
      const result = world.query(sql, params) ?? { rows: [] };
      if (sql.startsWith('select (select count(*) from public.communities'))
        result.rows[0]!.versions = world.state.versions.filter(
          (row) => Array.isArray(params[5]) && params[5].includes(row.proposal_id)
        ).length;
      return result;
    }),
    end: async () => undefined
  };
  const owned = productOwnership(
    'abcdef01',
    [0, 1, 2, 3].map((n) => '00000000-0000-4000-8000-00000000000' + n)
  );
  const upload = vi.fn<(name: string) => Promise<void>>(async (name) => {
    world.state.photos.set(name, 'photo-bytes');
  });
  const create = async () => {
    await db.query('begin');
    await insertProductFixtures(db, owned, upload);
    await db.query('commit');
    owned.committed = true;
    world.state.log.length = 0;
  };
  return { ...world, db, owned, upload, create };
}

describe('real isolation proof product fixtures', () => {
  it('creates 60 due product events with uploaded photos and a valid pending proposal/version chain', async () => {
    const w = fixture();
    await w.db.query('begin');
    await insertProductFixtures(w.db, w.owned, w.upload);
    expect(w.state.events).toHaveLength(60);
    expect(w.upload).toHaveBeenCalledTimes(60);
    expect(w.state.proposals).toHaveLength(1);
    expect(w.state.versions).toHaveLength(1);
    expect(w.state.communities[0]).toMatchObject({ name: 'isolation_proof_abcdef01' });
    for (const event of w.state.events)
      expect(event).toMatchObject({
        community_id: w.owned.communityId,
        created_by: w.owned.userIds[0],
        venue_name: w.owned.communityName
      });
    expect(w.owned.uploadedPhotos).toEqual(w.owned.photoPaths);
    expect(
      w.state.log.some(
        ({ sql }) =>
          sql.includes('registration_cutoff_at <= clock_timestamp()') &&
          sql.includes('cutoff_processed_at is null')
      )
    ).toBe(true);
    expect(w.state.log.some(({ sql }) => sql.includes('disable trigger'))).toBe(false);
    expect(await snapshotProduct(w.db, w.owned)).toMatchObject({
      communityPresent: true,
      eventCount: 60,
      photoCount: 60,
      proposalCount: 1
    });
  });

  it('documents that trigger DDL stalls both dev reads and writes', () => {
    const setup = readFileSync(new URL('../INITIAL_SETUP.md', import.meta.url), 'utf8');
    const helper = readFileSync(
      new URL('../scripts/isolation-proof-product-fixtures.mjs', import.meta.url),
      'utf8'
    );
    expect(setup).toContain('concurrent dev reads and writes stall');
    expect(helper).toContain('concurrent dev reads and writes stall');
  });

  it('includes proposal version identity in survival and absence snapshots', async () => {
    const w = fixture();
    await w.create();
    const before = await snapshotProduct(w.db, w.owned);
    expect(before).toMatchObject({ versionCount: 1 });
    w.state.versions[0]!.version = 2;
    expect(await snapshotProduct(w.db, w.owned)).not.toEqual(before);
    w.state.versions.length = 0;
    expect(await snapshotProduct(w.db, w.owned)).toMatchObject({ versionCount: 0 });
    w.state.versions.push({ proposal_id: w.owned.proposalIds[0], version: 1 });
    await removeProductFixtures(w.db, w.owned);
    expect(w.state.versions).toHaveLength(0);
    expect(await productAbsent(w.db, w.owned)).toMatchObject({ versionsAbsent: true });
    w.state.versions.push({ proposal_id: w.owned.proposalIds[0], version: 1 });
    expect(await productAbsent(w.db, w.owned)).toMatchObject({ versionsAbsent: false });
  });

  it('rejects fewer than 60 scheduler-visible due events before committing', async () => {
    const w = fixture();
    w.state.dueCount = 49;
    await w.db.query('begin');
    await expect(insertProductFixtures(w.db, w.owned, w.upload)).rejects.toThrow('due-event count');
    await w.db.query('rollback');
    expect(w.state.events).toHaveLength(0);
    // HTTP uploads are outside SQL: the caller retains their exact names for API cleanup.
    expect(w.owned.uploadedPhotos).toHaveLength(60);
  });

  it('registers an ambiguous upload before requesting it and rolls back all relational setup', async () => {
    const w = fixture();
    let count = 0;
    const upload = async (name: string) => {
      w.state.photos.set(name, 'photo-bytes');
      if (++count === 3) throw new Error('upload failed');
    };
    await w.db.query('begin');
    await expect(insertProductFixtures(w.db, w.owned, upload)).rejects.toThrow('upload failed');
    await w.db.query('rollback');
    expect(w.state.communities).toHaveLength(0);
    expect(w.state.events).toHaveLength(0);
    expect(w.owned.uploadedPhotos).toEqual(w.owned.photoPaths.slice(0, 3));
  });

  it('locks before disabling, scopes every delete, verifies inside the transaction, and enables before commit on ONE session', async () => {
    const w = fixture();
    await w.create();
    w.state.communities.push({ id: 'other-community', name: 'other', created_by: 'other-user' });
    w.state.events.push({ id: 'other-event', community_id: 'other-community' });
    await removeProductFixtures(w.db, w.owned);
    const sql = w.state.log.map((entry) => entry.sql);
    const begin = sql.indexOf('begin');
    const lock = sql.findIndex((s) => s.startsWith('lock table'));
    const disable = sql.findIndex((s) => s.includes(' disable trigger '));
    const firstDelete = sql.findIndex((s) => s.startsWith('delete from'));
    const insideVerify = sql.findIndex((s) =>
      s.startsWith('select count(*)::int as n from public.')
    );
    const enable = sql.findIndex((s) => s.includes(' enable trigger '));
    const commit = sql.indexOf('commit');
    expect(sql.filter((s) => s === 'begin')).toHaveLength(1);
    expect(begin).toBeLessThan(lock);
    expect(lock).toBeLessThan(disable);
    expect(disable).toBeLessThan(firstDelete);
    expect(firstDelete).toBeLessThan(insideVerify);
    expect(insideVerify).toBeLessThan(enable);
    expect(enable).toBeLessThan(commit);
    expect(sql[lock]).toContain('in exclusive mode');
    const allowed = new Set([
      ...w.owned.eventIds,
      ...w.owned.proposalIds,
      ...w.owned.userIds,
      w.owned.communityId
    ]);
    for (const entry of w.state.log.filter(({ sql: s }) => s.startsWith('delete from'))) {
      expect(entry.sql).toMatch(/where \w+ = any\(\$1::uuid\[\]\)$/);
      expect(Array.isArray(entry.params[0])).toBe(true);
      const ids = entry.params[0];
      if (!Array.isArray(ids)) throw new Error('expected scoped ids');
      for (const id of ids) {
        if (typeof id !== 'string') throw new Error('expected string id');
        expect(allowed.has(id)).toBe(true);
      }
    }
    for (const [table, trigger] of GUARD_TRIGGERS) {
      expect(sql).toContain('alter table public.' + table + ' enable trigger ' + trigger);
      expect(w.state.guards.get(table + '.' + trigger)).toBe('O');
    }
    expect(sql.slice(commit + 1).some((s) => s.includes('pg_catalog.pg_trigger'))).toBe(true);
    expect(sql.slice(commit + 1).some((s) => s.startsWith('select count(*)'))).toBe(true);
    expect(w.state.communities).toEqual([
      { id: 'other-community', name: 'other', created_by: 'other-user' }
    ]);
    expect(w.state.events).toEqual([{ id: 'other-event', community_id: 'other-community' }]);
    // Bytes/metadata retained until the caller removes them using Storage API after commit.
    expect(w.state.photos.size).toBe(60);
  });

  it('flushes only the deferred version FK before guard restoration (Postgres 55006)', async () => {
    const w = fixture();
    await w.create();
    const query = w.db.query.getMockImplementation()!;
    let pending = false;
    w.db.query.mockImplementation(async (sql, params = []) => {
      if (sql.startsWith('delete from public.match_event_result_proposal_versions')) pending = true;
      if (sql === 'set constraints public.match_result_proposal_active_version_fk immediate')
        pending = false;
      if (
        pending &&
        sql.startsWith('alter table public.match_event_result_proposal_versions enable')
      )
        throw Object.assign(new Error('cannot ALTER TABLE because it has pending trigger events'), {
          code: '55006'
        });
      return query(sql, params);
    });
    await removeProductFixtures(w.db, w.owned);
    expect(pending).toBe(false);
    expect(w.state.versions).toHaveLength(0);
    expect(w.state.log.map(({ sql }) => sql)).not.toContain('set constraints all immediate');
  });

  it('rolls back deletes AND all disabled guards on a mid-delete error, then verifies restored guards', async () => {
    const w = fixture();
    await w.create();
    w.state.failSql = 'delete from public.match_event_result_proposals';
    await expect(removeProductFixtures(w.db, w.owned)).rejects.toThrow(
      'injected product SQL failure'
    );
    const sql = w.state.log.map(({ sql: s }) => s);
    expect(sql).toContain('rollback');
    expect(sql).not.toContain('commit');
    expect(w.state.events).toHaveLength(60);
    expect(w.state.proposals).toHaveLength(1);
    expect([...w.state.guards.values()].every((v) => v === 'O')).toBe(true);
    expect(
      sql.slice(sql.indexOf('rollback') + 1).some((s) => s.includes('pg_catalog.pg_trigger'))
    ).toBe(true);
  });

  it('deletes only proof-linked dirty rows without invoking the global deferred drain', async () => {
    const w = fixture();
    await w.create();
    const unrelated = { id: 1, event_id: 'unrelated-committed-event' };
    const dirty = [
      unrelated,
      { id: 2, event_id: w.owned.eventIds[0] },
      { id: 3, event_id: w.owned.eventIds[0] },
      { id: 4, event_id: w.owned.eventIds[1] }
    ];
    let pendingDrain = false;
    const drain = vi.fn<() => void>(() => {
      dirty.splice(0);
    });
    const checkedDirty: Array<typeof dirty> = [];
    const query = w.db.query.getMockImplementation()!;
    w.db.query.mockImplementation(async (sql, params = []) => {
      const result = await query(sql, params);
      const mark = sql.startsWith('update public.match_event_registrations ')
        ? 'match_event_registrations.statistics_lifecycle_registration_mark'
        : sql.startsWith('delete from public.match_event_result_proposals ')
          ? 'match_event_result_proposals.statistics_lifecycle_proposal_mark'
          : sql.startsWith('delete from public.match_events ')
            ? 'match_events.statistics_lifecycle_event_mark'
            : undefined;
      if (mark && w.state.guards.get(mark) !== 'D') {
        dirty.push({ id: 5 + dirty.length, event_id: w.owned.eventIds[0] });
        pendingDrain = true;
      }
      if (
        sql === 'delete from public.statistics_lifecycle_dirty where event_id = any($1::uuid[])'
      ) {
        const ids = params[0];
        if (!Array.isArray(ids)) throw new Error('expected proof-scoped IDs');
        for (let index = dirty.length - 1; index >= 0; index -= 1)
          if (ids.includes(dirty[index]!.event_id)) dirty.splice(index, 1);
      }
      if (sql === 'set constraints all immediate' || sql === 'commit') {
        if (pendingDrain) drain();
        pendingDrain = false;
      }
      if (sql.startsWith('select count(*)::int as n from public.statistics_lifecycle_dirty')) {
        checkedDirty.push(dirty.slice());
        const ids = params[0];
        if (!Array.isArray(ids)) throw new Error('expected proof-scoped IDs');
        return { rows: [{ n: dirty.filter((row) => ids.includes(row.event_id)).length }] };
      }
      return result;
    });
    await removeProductFixtures(w.db, w.owned);
    expect(dirty).toEqual([unrelated]);
    expect(dirty[0]).toBe(unrelated);
    expect(checkedDirty).toEqual([[unrelated], [unrelated]]);
    expect(drain).not.toHaveBeenCalled();
    const statements = w.state.log.map(({ sql }) => sql);
    expect(statements).not.toContain('set constraints all immediate');
    expect(statements.some((sql) => sql.includes('statistics_lifecycle_drain'))).toBe(false);
    expect(
      statements.filter(
        (sql) =>
          sql === 'begin' ||
          sql === 'commit' ||
          sql.startsWith('delete from public.match_events ') ||
          sql.startsWith('delete from public.community_audit_log ') ||
          sql.startsWith('delete from public.communities ') ||
          sql.includes('from public.statistics_lifecycle_dirty ')
      )
    ).toEqual([
      'begin',
      'delete from public.match_events where id = any($1::uuid[])',
      'delete from public.community_audit_log where community_id = any($1::uuid[])',
      'delete from public.communities where id = any($1::uuid[])',
      'delete from public.statistics_lifecycle_dirty where event_id = any($1::uuid[])',
      'select count(*)::int as n from public.statistics_lifecycle_dirty where event_id = any($1::uuid[])',
      'commit',
      'select count(*)::int as n from public.statistics_lifecycle_dirty where event_id = any($1::uuid[])'
    ]);
    const dirtyDelete = w.state.log.find(({ sql }) =>
      sql.startsWith('delete from public.statistics_lifecycle_dirty ')
    );
    expect(dirtyDelete!.params).toEqual([w.owned.eventIds]);
  });

  it.each(['statistics_lifecycle_dirty', 'notifications'])(
    'rejects proof-owned %s residue after deferred work',
    async (table) => {
      const w = fixture();
      await w.create();
      w.state.residue = table;
      await expect(removeProductFixtures(w.db, w.owned)).rejects.toThrow('proof rows remain');
      expect(w.state.log.some(({ sql }) => sql === 'commit')).toBe(false);
    }
  );

  it('rolls back when scoped residue remains, before enabling/committing', async () => {
    const w = fixture();
    await w.create();
    w.state.residue = 'match_events';
    await expect(removeProductFixtures(w.db, w.owned)).rejects.toThrow('proof rows remain');
    expect(w.state.log.some(({ sql }) => sql === 'commit')).toBe(false);
    expect([...w.state.guards.values()].every((v) => v === 'O')).toBe(true);
  });

  it.each(['missing', 'disabled', 'owner', 'foreign-event'])(
    'fails closed before disabling guards on %s mismatch',
    async (kind) => {
      const w = fixture();
      await w.create();
      if (kind === 'missing') w.state.missingGuard = true;
      if (kind === 'disabled') w.state.guards.set(GUARD_TRIGGERS[0]!.join('.'), 'D');
      if (kind === 'owner') w.state.communities[0]!.created_by = 'other';
      if (kind === 'foreign-event')
        w.state.events.push({ id: 'other-event', community_id: w.owned.communityId });
      await expect(removeProductFixtures(w.db, w.owned)).rejects.toThrow(
        /guard|identity|unexpected/
      );
      expect(w.state.log.some(({ sql }) => sql.includes(' disable trigger '))).toBe(false);
    }
  );

  it('rejects post-commit trigger state drift', async () => {
    const w = fixture();
    await w.create();
    w.state.tamperAfterCommit = true;
    await expect(removeProductFixtures(w.db, w.owned)).rejects.toThrow(
      'guard trigger state differs'
    );
  });

  it('checks exact event/proposal IDs even when they are moved out of the community', async () => {
    const w = fixture();
    expect(Object.values(await productAbsent(w.db, w.owned)).every(Boolean)).toBe(true);
    w.state.events.push({ id: w.owned.eventIds[0], community_id: 'somewhere-else' });
    w.state.proposals.push({ id: w.owned.proposalIds[0], match_event_id: 'somewhere-else' });
    expect(await productAbsent(w.db, w.owned)).toMatchObject({
      eventsAbsent: false,
      proposalsAbsent: false
    });
  });

  it('exposes immutable identity, not mutable cron business fields', async () => {
    const w = fixture();
    await w.create();
    const before = await snapshotProduct(w.db, w.owned);
    for (const row of w.state.events) row.status = 'cancelled';
    for (const row of w.state.proposals) row.status = 'pending';
    expect(await snapshotProduct(w.db, w.owned)).toEqual(before);
    w.state.events.pop();
    expect(await snapshotProduct(w.db, w.owned)).not.toEqual(before);
    expect(DUE_EVENT_COUNT).toBeGreaterThan(50);
  });
});
