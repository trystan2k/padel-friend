import { describe, expect, it, vi } from 'vitest';
import {
  assertLoopbackUrl,
  buildMatchFixtureCleanupSql,
  runCleanupTasks
} from '../e2e/match-fixture-cleanup';

const actor = '11111111-1111-4111-8111-111111111111';
const event = '22222222-2222-4222-8222-222222222222';

describe('match fixture cleanup', () => {
  it('deletes only owned result evidence in FK order and restores guards', () => {
    const sql = buildMatchFixtureCleanupSql({ eventIds: [event], actorIds: [actor] });
    const versions =
      'delete from public.match_event_result_proposal_versions where proposal_id in (select id from public.match_event_result_proposals where match_event_id in (select id from owned_match_fixture_events))';
    const proposals =
      'delete from public.match_event_result_proposals where match_event_id in (select id from owned_match_fixture_events)';
    const reviews =
      'delete from public.match_event_result_reviews where proposal_id in (select id from public.match_event_result_proposals where match_event_id in (select id from owned_match_fixture_events))';
    const confirmations =
      'delete from public.match_event_result_confirmations where match_event_id in (select id from owned_match_fixture_events)';
    expect(sql).toContain(versions);
    expect(sql).toContain(proposals);
    expect(sql).toContain(reviews);
    expect(sql).toContain(confirmations);
    expect(sql.indexOf(reviews)).toBeLessThan(sql.indexOf(confirmations));
    expect(sql.indexOf(confirmations)).toBeLessThan(sql.indexOf(versions));
    expect(sql.indexOf(versions)).toBeLessThan(sql.indexOf(proposals));
    expect(sql.indexOf(proposals)).toBeLessThan(sql.indexOf('delete from public.match_events'));
    expect(sql.indexOf(proposals)).toBeLessThan(sql.indexOf('set constraints all immediate'));
    expect(sql.indexOf('set constraints all immediate')).toBeLessThan(
      sql.indexOf('alter table public.match_event_result_proposal_versions enable trigger')
    );
    for (const [table, trigger] of [
      ['match_event_result_proposal_versions', 'match_result_proposal_version_immutable'],
      ['match_event_result_reviews', 'match_result_review_immutable'],
      ['match_event_result_confirmations', 'match_result_confirmation_insert_guard'],
      ['match_event_result_proposals', 'match_result_proposal_transition_guard']
    ]) {
      expect(sql).toContain(`alter table public.${table} disable trigger ${trigger}`);
      expect(sql).toContain(`alter table public.${table} enable trigger ${trigger}`);
    }
  });
  it('materializes only explicit owned events/actors and deletes notification links before results', () => {
    const sql = buildMatchFixtureCleanupSql({ eventIds: [event], actorIds: [actor] });
    expect(sql).toContain(
      `e.id = any(array['${event}'::uuid]) and e.created_by = any(array['${actor}'::uuid])`
    );
    expect(sql).toContain(
      "n.target_type in ('match_event', 'result_available') and n.target_id in (select id from owned_match_fixture_events)"
    );
    expect(sql).toContain(
      "n.category in ('matches', 'results') and n.recipient_user_id = any(array['11111111-1111-4111-8111-111111111111'::uuid])"
    );
    expect(sql.indexOf('delete from public.notifications')).toBeLessThan(
      sql.indexOf('delete from public.match_event_result_proposal_versions')
    );
    expect(sql.indexOf('delete from public.notifications')).toBeLessThan(
      sql.indexOf('delete from public.match_events')
    );
    expect(sql).not.toContain('delete from public.notifications n where true');
    expect(sql).not.toContain('TRUNCATE');
  });

  it('uses fixture ownership selectors for global prune and rejects non-owned IDs', () => {
    expect(buildMatchFixtureCleanupSql()).toContain("u.email ilike '%@test.local'");
    expect(() =>
      buildMatchFixtureCleanupSql({ eventIds: ['not-an-id'], actorIds: [actor] })
    ).toThrow(/non-UUID/);
  });

  it('clears management history references before attempts and restores every bypassed guard', () => {
    const sql = buildMatchFixtureCleanupSql({ eventIds: [event], actorIds: [actor] });
    for (const table of ['match_event_management_commands', 'match_event_audit_log']) {
      expect(sql).toContain(
        `delete from public.${table} where match_event_id in (select id from owned_match_fixture_events)`
      );
    }
    expect(sql.indexOf('set current_attempt_id=null')).toBeLessThan(
      sql.indexOf('delete from public.match_event_registration_attempts')
    );
    for (const trigger of [
      'match_attempt_history_guard',
      'match_attempt_final_state',
      'match_registration_final_state',
      'match_audit_immutable',
      'match_result_review_immutable',
      'match_result_confirmation_insert_guard',
      'match_result_proposal_transition_guard',
      'match_result_proposal_version_immutable'
    ]) {
      expect(sql).toContain(`disable trigger ${trigger}`);
      expect(sql).toContain(`enable trigger ${trigger}`);
    }
  });

  it('requires a loopback Supabase URL', () => {
    expect(() => assertLoopbackUrl('https://localhost:54321')).not.toThrow();
    expect(() => assertLoopbackUrl('https://project.supabase.co')).toThrow(/loopback/);
    expect(() => assertLoopbackUrl(undefined)).toThrow(/loopback/);
  });

  it('runs remaining cleanup tasks and surfaces failures rather than skipping cleanup', async () => {
    const removePhotos = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValue(new Error('photo removal failed'));
    const cleanDatabase = vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined);
    await expect(runCleanupTasks([removePhotos, cleanDatabase])).rejects.toThrow(
      /cleanup tasks failed/
    );
    expect(removePhotos).toHaveBeenCalledOnce();
    expect(cleanDatabase).toHaveBeenCalledOnce();
  });
});
