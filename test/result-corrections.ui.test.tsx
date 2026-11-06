/** @vitest-environment jsdom */
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResultProposal } from '../src/features/matches/match-result-model';
import { parseResultProposals } from '../src/features/matches/match-result-model';
import type { ResultAmendment } from '../src/features/matches/result-amendment-model';
import { createI18n } from '../src/i18n/config';
import { makeMatchDetail } from './helpers/match-fixtures';
import { resultIds, resultProposal } from './helpers/match-result-fixtures';

vi.mock('../src/features/matches/result-amendment.functions', () => ({
  cancelResultAmendment: vi.fn<() => void>(),
  requestResultAmendment: vi.fn<() => void>(),
  resolveResultDispute: vi.fn<() => void>(),
  reviewResultAmendment: vi.fn<() => void>()
}));
vi.mock('../src/features/result-repairs/repair.functions', () => ({
  retryResultRepair: vi.fn<() => void>()
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/matches">{children}</a>
}));

import { MatchResultCorrections } from '../src/features/matches/MatchResultCorrections';

const BASE = '11111111-0000-4000-8000-000000000001';
const CURRENT = '22222222-0000-4000-8000-000000000002';
const event = makeMatchDetail({ creator_id: 'creator-id', timezone: 'UTC' });

function confirmed(): ResultProposal {
  const proposal = parseResultProposals([
    {
      ...resultProposal,
      status: 'confirmed',
      confirmation: {
        confirmation_id: BASE,
        source: 'AUTO_48H',
        confirmed_at: '2026-10-03T12:00:00Z',
        effective_at: '2026-10-03T12:00:00Z',
        actor_id: null
      },
      version_timeline: [
        { ...resultProposal.version_timeline[0], status: 'confirmed', confirmation_id: BASE }
      ]
    }
  ])?.[0];
  if (!proposal) throw new Error('Invalid confirmed fixture');
  return proposal;
}

function amendment(overrides: Partial<ResultAmendment> = {}): ResultAmendment {
  return {
    amendment_id: 'aaaaaaaa-0000-4000-8000-00000000000a',
    event_id: event.event_id,
    proposal_id: resultProposal.proposal_id,
    group_number: 1,
    lifecycle: 'proposal_pending',
    base_confirmation_id: BASE,
    base_version: 1,
    official_confirmation_id: BASE,
    requester_id: resultIds[0]!,
    reason: 'Score recorded backwards',
    requested_at: '2026-10-04T10:00:00Z',
    candidate: {
      version: 2,
      submitted_by: resultIds[0]!,
      submitted_at: '2026-10-04T11:00:00Z',
      review_deadline_at: '2026-10-06T11:00:00Z',
      teams: {
        team_a: [resultIds[0]!, resultIds[1]!],
        team_b: [resultIds[2]!, resultIds[3]!]
      },
      sets: [{ position: 1, team_a_games: 2, team_b_games: 6, completed: true }],
      classification: 'team_b',
      played_at_utc: '2026-10-01T12:00:00Z',
      played_at_local: '2026-10-01 12:00:00',
      played_at_offset_seconds: 0,
      court_label: null,
      team_a_approval_count: 1,
      team_b_approval_count: 0,
      required_team_coverage_count: 2,
      received_team_coverage_count: 1,
      caller_decision: null
    },
    decision: null,
    pending_application: false,
    repair_job_id: null,
    repair: null,
    resolution: null,
    can_resolve: false,
    can_submit_candidate: false,
    can_approve: false,
    can_reject: false,
    can_cancel: false,
    ...overrides
  };
}

function mount(
  corrections: Partial<Parameters<typeof MatchResultCorrections>[0]['corrections']> = {},
  proposals = [confirmed()],
  onRefresh = vi.fn<() => void>()
) {
  const view = render(
    <I18nextProvider i18n={createI18n('en')}>
      <MatchResultCorrections
        event={event}
        proposals={proposals}
        corrections={{ amendments: [], amendmentsError: false, isAdmin: false, ...corrections }}
        onRefresh={onRefresh}
      />
    </I18nextProvider>
  );
  return { ...view, onRefresh };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('correction surfaces', () => {
  it('offers the request entry only to original participants, the creator or an Admin', () => {
    const entitled = mount({ callerId: resultIds[0] });
    expect(screen.getByRole('button', { name: 'Request correction' })).toBeTruthy();
    entitled.unmount();
    mount({ callerId: 'unrelated-reader' });
    expect(screen.queryByRole('button', { name: 'Request correction' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Result corrections' })).toBeNull();
  });

  it('keeps the request dialog reason required and associated with its error', async () => {
    const user = userEvent.setup();
    mount({ callerId: resultIds[0] });
    const trigger = screen.getByRole('button', { name: 'Request correction' });
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Request correction' }));
    const reason = within(dialog).getByRole('textbox');
    expect(reason.getAttribute('aria-invalid')).toBe('true');
    const alert = within(dialog).getByRole('alert');
    expect(reason.getAttribute('aria-describedby')).toContain(alert.id);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('shows the review audit chain with the previous official result still current', async () => {
    const user = userEvent.setup();
    mount({ amendments: [amendment()] });
    const card = screen.getByRole('article', { name: /correction/i });
    expect(card.getAttribute('data-pending-application')).toBe('false');
    await user.click(within(card).getByText('Correction history'));
    expect(card.textContent).toContain('Team approvals received: Team A 1 · Team B 0');
    expect(card.textContent).toContain('covering 1 of 2 needed');
    expect(card.textContent).toContain(
      'Official result 11111111 (version 1) stays current until the update publishes'
    );
  });

  it('separates approved-not-applied from applied and names both result revisions', async () => {
    const user = userEvent.setup();
    const applied = amendment({
      lifecycle: 'applied',
      official_confirmation_id: CURRENT,
      decision: {
        source: 'ADMIN_OVERRIDE',
        actor_id: resultIds[1]!,
        decided_at: '2026-10-05T10:00:00Z',
        note: null
      }
    });
    mount({ amendments: [applied] });
    const card = screen.getByRole('article', { name: /correction/i });
    expect(card.getAttribute('data-amendment-lifecycle')).toBe('applied');
    await user.click(within(card).getByText('Correction history'));
    expect(card.textContent).toContain(
      'Official result 11111111 (version 1) replaced by 22222222; the previous result stays inspectable'
    );
    expect(card.textContent).toContain('Admin override');
  });

  it('polls while an approved correction is waiting to be applied, then stops', async () => {
    vi.useFakeTimers();
    const pending = amendment({ lifecycle: 'approved_pending_repair', pending_application: true });
    const view = mount({ amendments: [pending] });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(view.onRefresh).toHaveBeenCalledTimes(1);
    view.rerender(
      <I18nextProvider i18n={createI18n('en')}>
        <MatchResultCorrections
          event={event}
          proposals={[confirmed()]}
          corrections={{
            amendments: [amendment({ lifecycle: 'applied' })],
            amendmentsError: false,
            isAdmin: false
          }}
          onRefresh={view.onRefresh}
        />
      </I18nextProvider>
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(view.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('shows a visible unavailable note when corrections cannot be read', () => {
    mount({ amendmentsError: true });
    expect(screen.getByRole('alert').textContent).toBeTruthy();
  });

  it('offers dispute resolution of a first confirmation to an Admin only', () => {
    const disputed = parseResultProposals([
      {
        ...resultProposal,
        status: 'disputed',
        dispute_evidence: {
          rejector_id: resultIds[2],
          rejector_name: 'Player',
          reason_code: 'SCORE_INCORRECT',
          reason_note: null,
          decided_at: '2026-10-02T10:00:00Z'
        },
        version_timeline: [
          {
            ...resultProposal.version_timeline[0],
            status: 'disputed',
            decisions: [
              {
                reviewer_id: resultIds[2],
                reviewer_name: 'Player',
                decision: 'reject',
                reason_code: 'SCORE_INCORRECT',
                reason_note: null,
                decided_at: '2026-10-02T10:00:00Z'
              }
            ]
          }
        ]
      }
    ]);
    if (!disputed) throw new Error('Invalid disputed fixture');
    const first = mount({ isAdmin: true }, disputed);
    expect(screen.getByRole('button', { name: 'Resolve result' })).toBeTruthy();
    first.unmount();
    mount({ isAdmin: false }, disputed);
    expect(screen.queryByRole('button', { name: 'Resolve result' })).toBeNull();
  });
});
