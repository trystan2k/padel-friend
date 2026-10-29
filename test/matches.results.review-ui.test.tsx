/** @vitest-environment jsdom */
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ResultCommandReceipt,
  ResultCommandResponse,
  ResultProposal,
  ResultRejectionReason
} from '../src/features/matches/match-result-model';
import { parseResultProposals } from '../src/features/matches/match-result-model';
import { createI18n } from '../src/i18n/config';
import { resultProposal, resultIds } from './helpers/match-result-fixtures';

type ReviewMutation = (options: {
  data: {
    proposal_id: string;
    expected_version: number;
    decision: 'approve' | 'reject';
    reason_code: ResultRejectionReason | null;
    reason_note: string | null;
    request_id: string;
  };
}) => Promise<ResultCommandResponse<ResultCommandReceipt>>;

const mocks = vi.hoisted(() => ({ review: vi.fn<ReviewMutation>() }));

vi.mock('../src/features/matches/match-result.functions', () => ({
  reviewMatchEventResult: mocks.review
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/matches">{children}</a>
}));

import { MatchResultReview } from '../src/features/matches/MatchResultReview';

function makeProposal(overrides: Record<string, unknown> = {}): ResultProposal {
  const proposal = parseResultProposals([{ ...resultProposal, ...overrides }])?.[0];
  if (!proposal) throw new Error('Invalid review fixture');
  return proposal;
}

function receipt(
  status: ResultProposal['status'] = 'pending'
): ResultCommandResponse<ResultCommandReceipt> {
  return {
    status: 'ok',
    replayed: false,
    value: {
      proposal_id: resultProposal.proposal_id,
      version: 1,
      status,
      confirmation_id: status === 'confirmed' ? resultIds[3]! : null,
      review_deadline_at: resultProposal.review_deadline_at,
      request_id: resultIds[2]!
    }
  };
}

function mount(proposal = makeProposal(), onRefresh = vi.fn<() => void>(), compact = false) {
  return render(
    <I18nextProvider i18n={createI18n('en')}>
      <MatchResultReview
        eventId={proposal.event_id}
        proposal={proposal}
        timezone="UTC"
        asOf={resultProposal.submitted_at}
        compact={compact}
        onRefresh={onRefresh}
      />
    </I18nextProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('result lifecycle review UI', () => {
  it('renders only SQL-authorized actions and records approval once per version', async () => {
    const onRefresh = vi.fn<() => void>();
    mocks.review.mockResolvedValue(receipt());
    mount(makeProposal({ can_approve: true, can_reject: false }), onRefresh);

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/Approval recorded for this version/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
    expect(mocks.review).toHaveBeenCalledTimes(1);
    expect(mocks.review.mock.calls[0]?.[0].data).toEqual({
      proposal_id: resultProposal.proposal_id,
      expected_version: 1,
      decision: 'approve',
      reason_code: null,
      reason_note: null,
      request_id: expect.any(String)
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('hides both decisions when SQL returns neither review capability', () => {
    mount(makeProposal({ can_approve: false, can_reject: false }));

    expect(screen.getByRole('heading', { name: 'Result proposal' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
    expect(screen.getByText('PENDING · NOT CONFIRMED')).toBeTruthy();
    expect(screen.getByRole('timer', { name: 'AUTO-CONFIRMS IN 48H' })).toBeTruthy();
    expect(
      screen.getByText(
        'No rating or League stats apply yet. Eligible players may approve or reject.'
      )
    ).toBeTruthy();
  });

  it('labels confirmed non-ratable facts without implying rating effects', () => {
    mount(
      makeProposal({
        status: 'confirmed',
        rating_effective: false,
        received_team_coverage_count: 1,
        team_b_approval_count: 1,
        confirmation: {
          confirmation_id: resultIds[3]!,
          source: 'MANUAL',
          confirmed_at: '2026-10-01T12:00:01Z',
          effective_at: '2026-10-01T12:00:01Z',
          actor_id: resultIds[2]!
        },
        version_timeline: [
          {
            version: 1,
            status: 'confirmed',
            submitted_by: resultIds[0]!,
            submitted_by_name: 'Player',
            submitted_at: resultProposal.submitted_at,
            review_deadline_at: resultProposal.review_deadline_at,
            decisions: [],
            confirmation_id: resultIds[3]!
          }
        ]
      })
    );

    expect(screen.getByText('Confirmed · Manual')).toBeTruthy();
    expect(screen.getByText('Friendly · no rating effect')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
  });

  it('keeps multi-group pending facts, countdown, and eligible actions in compact cards', () => {
    mount(makeProposal({ can_approve: true, can_reject: true }), vi.fn(), true);

    expect(screen.getByRole('heading', { name: 'Group 1' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Set scores' })).toBeTruthy();
    expect(screen.getByRole('timer', { name: 'AUTO-CONFIRMS IN 48H' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeTruthy();
  });

  it('keeps countdown anchored to asOf when the device wall clock jumps', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(resultProposal.submitted_at));
    mount(makeProposal(), vi.fn(), true);

    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    vi.setSystemTime(new Date('2036-10-01T12:00:00.000Z'));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));

    expect(screen.getByRole('timer', { name: 'AUTO-CONFIRMS IN 48H' })).toBeTruthy();
  });

  it('preserves approval announcement after authoritative status becomes confirmed', async () => {
    mocks.review.mockResolvedValue(receipt('confirmed'));
    const initial = makeProposal({ can_approve: true });
    const view = mount(initial);

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(
      await screen.findByText(/Approval recorded\. The server confirmed this result/)
    ).toBeTruthy();

    view.rerender(
      <I18nextProvider i18n={createI18n('en')}>
        <MatchResultReview
          eventId={initial.event_id}
          proposal={makeProposal({
            status: 'confirmed',
            can_approve: false,
            team_b_approval_count: 1,
            received_team_coverage_count: 1,
            version_timeline: [
              {
                version: 1,
                submitted_by: resultIds[0]!,
                submitted_by_name: 'Player',
                submitted_at: resultProposal.submitted_at,
                review_deadline_at: resultProposal.review_deadline_at,
                status: 'confirmed',
                confirmation_id: resultIds[3]!,
                decisions: []
              }
            ],
            confirmation: {
              confirmation_id: resultIds[3]!,
              source: 'MANUAL',
              confirmed_at: '2026-10-02T12:00:00.000Z',
              effective_at: '2026-10-02T12:00:00.000Z',
              actor_id: resultIds[2]!
            }
          })}
          timezone="UTC"
          asOf={resultProposal.submitted_at}
          onRefresh={vi.fn<() => void>()}
        />
      </I18nextProvider>
    );

    expect(screen.getByRole('status').textContent).toMatch(
      /Approval recorded\. The server confirmed this result/
    );
  });

  it('preserves rejection announcement after proposal becomes disputed', async () => {
    mocks.review.mockResolvedValue(receipt('disputed'));
    const initial = makeProposal({ can_reject: true });
    const view = mount(initial);
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog', { name: 'Dispute result' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Score incorrect' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit dispute' }));
    expect(await screen.findByText(/Result disputed/)).toBeTruthy();

    view.rerender(
      <I18nextProvider i18n={createI18n('en')}>
        <MatchResultReview
          eventId={initial.event_id}
          proposal={makeProposal({
            status: 'disputed',
            can_reject: false,
            dispute_evidence: {
              rejector_id: resultIds[1]!,
              rejector_name: 'Player',
              reason_code: 'SCORE_INCORRECT',
              reason_note: null,
              decided_at: resultProposal.submitted_at
            },
            version_timeline: [
              {
                version: 1,
                submitted_by: resultIds[0]!,
                submitted_by_name: 'Player',
                submitted_at: resultProposal.submitted_at,
                review_deadline_at: resultProposal.review_deadline_at,
                confirmation_id: null,
                status: 'disputed',
                decisions: [
                  {
                    reviewer_id: resultIds[1]!,
                    reviewer_name: 'Player',
                    decision: 'reject',
                    reason_code: 'SCORE_INCORRECT',
                    reason_note: null,
                    decided_at: resultProposal.submitted_at
                  }
                ]
              }
            ]
          })}
          timezone="UTC"
          asOf={resultProposal.submitted_at}
          onRefresh={vi.fn<() => void>()}
        />
      </I18nextProvider>
    );
    expect(screen.getByRole('status').textContent).toMatch(/Result disputed/);
  });

  it('opens a named rejection dialog, validates Other, submits note, and returns focus', async () => {
    mocks.review.mockResolvedValue(receipt('disputed'));
    mount(makeProposal({ can_reject: true }));

    const reject = screen.getByRole('button', { name: 'Reject' });
    await userEvent.click(reject);
    const dialog = await screen.findByRole('dialog', { name: 'Dispute result' });
    const other = within(dialog).getByRole('radio', { name: 'Other' });
    expect(other).toBeTruthy();

    await userEvent.click(other);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit dispute' }));
    const note = within(dialog).getByRole('textbox', { name: /Add a note/ });
    expect(note.getAttribute('aria-invalid')).toBe('true');
    expect(within(dialog).getByText('Add a note when selecting Other.')).toBeTruthy();
    expect(document.activeElement).toBe(note);

    await userEvent.type(note, 'The match was stopped before play.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit dispute' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.review).toHaveBeenCalledWith({
      data: {
        proposal_id: resultProposal.proposal_id,
        expected_version: 1,
        decision: 'reject',
        reason_code: 'OTHER',
        reason_note: 'The match was stopped before play.',
        request_id: expect.any(String)
      }
    });
    expect(document.activeElement).toBe(screen.getByRole('article', { name: 'Group 1' }));
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
  });

  it('supports Escape close and restores focus to the action that opened the dialog', async () => {
    mount(makeProposal({ can_reject: true }));
    const reject = screen.getByRole('button', { name: 'Reject' });

    await userEvent.click(reject);
    expect(await screen.findByRole('dialog', { name: 'Dispute result' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(reject);
  });

  it('does not submit a second command while the first request is pending', async () => {
    let resolve!: (value: ResultCommandResponse<ResultCommandReceipt>) => void;
    mocks.review.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    mount(makeProposal({ can_approve: true }));

    const approve = screen.getByRole('button', { name: 'Approve' });
    await userEvent.click(approve);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Recording approval…' }).disabled
    ).toBe(true);
    expect(mocks.review).toHaveBeenCalledTimes(1);
    await act(async () => resolve(receipt()));
  });
});
