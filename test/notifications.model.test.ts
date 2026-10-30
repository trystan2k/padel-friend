import { describe, expect, it, vi } from 'vitest';
import {
  groupNotifications,
  notificationBadge
} from '../src/features/notifications/notification-model';
import {
  decodeNotificationTarget,
  decodeResultNotificationContext,
  notificationResultHref
} from '../src/features/notifications/notification-target';

const eventId = '123e4567-e89b-12d3-a456-426614174000';
const communityId = '223e4567-e89b-12d3-a456-426614174001';
const proposalId = '323e4567-e89b-12d3-a456-426614174002';
const notificationId = '423e4567-e89b-12d3-a456-426614174003';
const validResultContext = {
  notification_id: notificationId,
  notification_kind: 'result_review_needed',
  match_event_id: eventId,
  community_id: communityId,
  proposal_id: proposalId,
  proposal_version: 2,
  group_number: 3,
  proposal_status: 'pending',
  current_version: 2,
  current_status: 'pending',
  is_current: true,
  classification: 'team_a',
  winner_sets: 2,
  loser_sets: 0,
  score: '6–4, 6–3',
  submitted_by_name: 'Ari',
  review_deadline_at: '2026-10-31T12:00:00.000Z',
  venue: 'Central Court',
  starts_at: '2026-10-29T12:00:00.000Z',
  timezone: 'America/Sao_Paulo',
  entry_ready: false
};

describe('notification display model', () => {
  it('groups dates in UTC and formats with the requested locale', () => {
    const grouped = groupNotifications(
      [
        {
          id: '1',
          kind: 'x',
          category: 'community',
          created_at: '2026-10-15T02:00:00Z',
          read_at: null
        },
        {
          id: '2',
          kind: 'x',
          category: 'community',
          created_at: '2026-10-14T23:00:00Z',
          read_at: null
        }
      ],
      new Date('2026-10-15T10:00:00Z'),
      'en'
    );
    expect(grouped.today).toHaveLength(1);
    expect(grouped.earlier).toHaveLength(1);
    expect(grouped.format('2026-10-15T02:00:00Z')).toContain('Oct');
  });

  it('partitions the sequence-ordered feed without reordering or splitting a transaction', () => {
    const transactionTimestamp = '2026-10-15T10:00:00Z';
    const items = [
      {
        id: 'same-transaction-z',
        kind: 'x',
        category: 'community' as const,
        created_at: transactionTimestamp,
        read_at: null
      },
      {
        id: 'earlier-newer-date',
        kind: 'x',
        category: 'community' as const,
        created_at: '2026-10-14T20:00:00Z',
        read_at: null
      },
      {
        id: 'today-older-date',
        kind: 'x',
        category: 'community' as const,
        created_at: '2026-10-15T09:00:00Z',
        read_at: null
      },
      {
        id: 'same-transaction-a',
        kind: 'x',
        category: 'community' as const,
        created_at: transactionTimestamp,
        read_at: null
      },
      {
        id: 'earlier-older-date',
        kind: 'x',
        category: 'community' as const,
        created_at: '2026-10-13T20:00:00Z',
        read_at: null
      }
    ];

    const grouped = groupNotifications(items, new Date('2026-10-15T12:00:00Z'), 'en');

    expect(grouped.today.map(({ id }) => id)).toEqual([
      'same-transaction-z',
      'today-older-date',
      'same-transaction-a'
    ]);
    expect(grouped.earlier.map(({ id }) => id)).toEqual([
      'earlier-newer-date',
      'earlier-older-date'
    ]);
    const transactionSections = items
      .filter(({ created_at }) => created_at === transactionTimestamp)
      .map(({ id }) =>
        grouped.today.some((item) => item.id === id)
          ? 'today'
          : grouped.earlier.some((item) => item.id === id)
            ? 'earlier'
            : 'missing'
      );
    expect(transactionSections).toEqual(['today', 'today']);
  });

  it('constructs one UTC day formatter per grouping call regardless of item count', () => {
    const dateTimeFormat = vi.spyOn(Intl, 'DateTimeFormat');
    const items = Array.from({ length: 25 }, (_, index) => ({
      id: String(index),
      kind: 'x',
      category: 'community' as const,
      created_at: '2026-10-15T02:00:00Z',
      read_at: null
    }));

    try {
      groupNotifications(items, new Date('2026-10-15T10:00:00Z'), 'en');

      const dayFormatterCalls = dateTimeFormat.mock.calls.filter(
        ([, options]) =>
          options?.year === 'numeric' &&
          options.month === '2-digit' &&
          options.day === '2-digit' &&
          options.timeZone === 'UTC'
      );
      expect(dayFormatterCalls).toHaveLength(1);
    } finally {
      dateTimeFormat.mockRestore();
    }
  });

  it('caps only visual badge and preserves full count in label', () => {
    expect(notificationBadge(125, (key) => key)).toEqual({
      visual: '99+',
      label: 'notifications.badge_other'
    });
    expect(notificationBadge(null, (key) => key).visual).toBeNull();
  });

  it('builds a validated result deep link with event identity separate from proposal identity', () => {
    const context = decodeResultNotificationContext(validResultContext);

    const href = notificationResultHref(context);
    const url = new URL(href, 'https://example.test');
    expect(url.pathname).toBe(`/matches/${eventId}`);
    expect(url.searchParams.get('result_group')).toBe('3');
    expect(url.searchParams.get('result_proposal')).toBe(proposalId);
    expect(url.searchParams.get('result_version')).toBe('2');
    expect(url.hash).toBe('#result-group-3');
    expect(context.winner_sets).toBe(2);
    expect(context.loser_sets).toBe(0);
  });

  it('keeps superseded notifications historical and points only to the selected group', () => {
    const context = decodeResultNotificationContext({
      notification_id: notificationId,
      notification_kind: 'result_added',
      match_event_id: eventId,
      community_id: communityId,
      proposal_id: proposalId,
      proposal_version: 1,
      group_number: 1,
      proposal_status: 'superseded',
      current_version: 2,
      current_status: 'pending',
      is_current: false,
      classification: 'team_b',
      winner_sets: 2,
      loser_sets: 1,
      score: '4–6, 6–4, 4–6',
      submitted_by_name: 'Ari',
      review_deadline_at: '2026-10-30T12:00:00.000Z',
      venue: 'Central Court',
      starts_at: '2026-10-29T12:00:00.000Z',
      timezone: 'UTC',
      entry_ready: false
    });

    expect(context.proposal_version).toBe(1);
    expect(context.current_version).toBe(2);
    expect(context.is_current).toBe(false);
    expect(notificationResultHref(context)).toContain('#result-group-1');
    expect(() => decodeResultNotificationContext({ ...context, is_current: true })).toThrow(
      'INVALID_NOTIFICATION_RESULT_CONTEXT'
    );
  });

  it.each([
    { winner_sets: undefined },
    { winner_sets: null },
    { winner_sets: 0 },
    { winner_sets: 1.5 },
    { loser_sets: null },
    { loser_sets: -1 },
    { loser_sets: 0.5 },
    { classification: 'draw', winner_sets: 2, loser_sets: 0 },
    { classification: 'incomplete', winner_sets: null, loser_sets: 0 }
  ])('rejects malformed or inconsistent set counts: %o', (overrides) => {
    expect(() => decodeResultNotificationContext({ ...validResultContext, ...overrides })).toThrow(
      'INVALID_NOTIFICATION_RESULT_CONTEXT'
    );
  });

  it.each(['draw', 'incomplete'] as const)(
    'accepts null set counts for %s outcomes',
    (classification) => {
      const context = decodeResultNotificationContext({
        ...validResultContext,
        classification,
        winner_sets: null,
        loser_sets: null
      });

      expect(context.classification).toBe(classification);
      expect(context.winner_sets).toBeNull();
      expect(context.loser_sets).toBeNull();
    }
  );

  it('accepts event-ready contexts but rejects a proposal UUID used as an event target', () => {
    const context = decodeResultNotificationContext({
      notification_id: notificationId,
      notification_kind: 'result_entry_ready',
      match_event_id: eventId,
      community_id: communityId,
      proposal_id: null,
      proposal_version: null,
      group_number: null,
      proposal_status: null,
      current_version: null,
      current_status: null,
      is_current: true,
      classification: null,
      winner_sets: null,
      loser_sets: null,
      score: null,
      submitted_by_name: null,
      review_deadline_at: null,
      venue: 'Central Court',
      starts_at: '2026-10-29T12:00:00.000Z',
      timezone: 'UTC',
      entry_ready: true
    });
    expect(notificationResultHref(context)).toBe(`/matches/${eventId}`);
    expect(() =>
      decodeNotificationTarget({
        target_status: 'result_available',
        community_id: communityId,
        community_name: null,
        invitation_id: null,
        membership_status: null,
        match_event_id: proposalId,
        match_available: true,
        result_context: context
      })
    ).toThrow('INVALID_NOTIFICATION_TARGET');
  });
});
