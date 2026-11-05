/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LevelReviewDto } from '../src/features/level-reviews/level-review-contracts';
import { createI18n, type Locale } from '../src/i18n/config';

const mocks = vi.hoisted(() => ({
  submit: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  list: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  get: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  cancel: vi.fn<(...args: unknown[]) => Promise<unknown>>()
}));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  Link: ({ children, to, params, ...rest }: any) => (
    <a href={String(to).replace('$requestId', params?.requestId ?? '')} {...rest}>
      {children}
    </a>
  )
}));
vi.mock('../src/features/level-reviews/level-review.functions', () => ({
  submitLevelReviewRequest: mocks.submit,
  listMyLevelReviewRequests: mocks.list,
  getMyLevelReviewRequest: mocks.get,
  cancelLevelReviewRequest: mocks.cancel
}));
vi.mock('../src/features/player/rating.functions', () => ({
  getMyRatingSummary: vi.fn<() => Promise<unknown>>()
}));

import { LevelReviewLoadError } from '../src/features/level-reviews/LevelReviewStates';
import { PlayerLevelReviewHistory } from '../src/features/level-reviews/PlayerLevelReviewHistory';
import { PlayerLevelReviewRequest } from '../src/features/level-reviews/PlayerLevelReviewRequest';
import { PlayerLevelReviewStatus } from '../src/features/level-reviews/PlayerLevelReviewStatus';
import type { CurrentLevelLoad } from '../src/features/level-reviews/level-review-view';

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

afterEach(cleanup);
beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  vi.restoreAllMocks();
});

const wrap = (node: ReactNode, locale: Locale = 'en') => (
  <I18nextProvider i18n={createI18n(locale)}>{node}</I18nextProvider>
);

const dto = (overrides: Partial<LevelReviewDto> = {}): LevelReviewDto => ({
  id: ID,
  status: 'pending',
  snapshot_display_level: 3.82,
  snapshot_reliability_percent: 76,
  requested_min_level: 4,
  requested_max_level: 4.2,
  reason: 'I beat higher rated players all season.',
  evidence: null,
  created_at: '2026-09-24T10:00:00.000000Z',
  under_review_at: null,
  canceled_at: null,
  decided_at: null,
  decision_note: null,
  approved_level: null,
  adjustment_id: null,
  ...overrides
});

const current: CurrentLevelLoad = {
  status: 'ok',
  current: { display_level: 3.82, reliability_percent: 76 }
};

/** The command id of every submit call, read without assuming the call shape. */
const commandIds = (): unknown[] =>
  mocks.submit.mock.calls.map(([request]) => {
    const data: unknown =
      typeof request === 'object' && request !== null ? Reflect.get(request, 'data') : undefined;
    return typeof data === 'object' && data !== null ? Reflect.get(data, 'command_id') : undefined;
  });

describe('PlayerLevelReviewRequest', () => {
  const setup = (
    overrides: Partial<Parameters<typeof PlayerLevelReviewRequest>[0]> = {},
    locale: Locale = 'en'
  ) => {
    const onSubmitted = vi.fn<(id: string) => void>();
    const onRetryCurrent = vi.fn<() => void>();
    render(
      wrap(
        <PlayerLevelReviewRequest
          current={current}
          onSubmitted={onSubmitted}
          onRetryCurrent={onRetryCurrent}
          {...overrides}
        />,
        locale
      )
    );
    return { onSubmitted, onRetryCurrent };
  };
  const reason = () =>
    screen.getByRole('textbox', { name: 'Why does your level feel materially incorrect?' });
  const submit = () => screen.getByRole('button', { name: /^Submit request$|^Submitting…$/ });
  const type = (field: HTMLElement, value: string) =>
    fireEvent.change(field, { target: { value } });

  it('shows the current level as read-only server-owned text, never as an input', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Request level review', level: 1 })).toBeTruthy();
    expect(screen.getByText('Your current level is 3.82')).toBeTruthy();
    expect(screen.getByText('3.82 · 76% reliability')).toBeTruthy();
    expect(screen.getByText(/You can't change it here/)).toBeTruthy();
    expect(screen.queryByDisplayValue('3.82')).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull();
    expect(screen.queryByRole('textbox', { name: /Current level/ })).toBeNull();
    expect(screen.getByText(/Approval changes your current level going forward only/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to profile' }).getAttribute('href')).toBe(
      '/dashboard'
    );
  });

  it('submits an exact level with a stable command id and opens the stored request', async () => {
    mocks.submit.mockResolvedValue({ request: dto(), replayed: false });
    const { onSubmitted } = setup();
    type(screen.getByRole('textbox', { name: 'Expected level' }), '3.8');
    type(reason(), '  I play at a higher level now.  ');
    await userEvent.click(submit());
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith(ID));
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(mocks.submit).toHaveBeenCalledWith({
      data: {
        command_id: expect.stringMatching(UUID),
        requested_min_level: 3.8,
        requested_max_level: 3.8,
        reason: 'I play at a higher level now.',
        evidence: null
      }
    });
    expect(screen.getByText('Request received. Opening its status…')).toBeTruthy();
  });

  it('submits a range with localized decimals and optional evidence, sending canonical numbers', async () => {
    mocks.submit.mockResolvedValue({ request: dto(), replayed: false });
    const { onSubmitted } = setup({}, 'pt-BR');
    await userEvent.click(screen.getByRole('radio', { name: 'Faixa' }));
    type(screen.getByRole('textbox', { name: 'Menor nível esperado' }), '3,8');
    type(screen.getByRole('textbox', { name: 'Maior nível esperado' }), '4,25');
    type(screen.getByRole('textbox', { name: 'Por que seu nível parece muito errado?' }), 'Motivo');
    expect(screen.queryByRole('textbox', { name: 'Evidência' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Adicionar evidência opcional/ }));
    type(screen.getByRole('textbox', { name: 'Evidência' }), 'https://exemplo.com/prova');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar solicitação' }));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith(ID));
    expect(mocks.submit).toHaveBeenCalledWith({
      data: {
        command_id: expect.stringMatching(UUID),
        requested_min_level: 3.8,
        requested_max_level: 4.25,
        reason: 'Motivo',
        evidence: 'https://exemplo.com/prova'
      }
    });
  });

  it('rejects a thousands-style or foreign separator instead of guessing', async () => {
    setup({}, 'pt-BR');
    type(screen.getByRole('textbox', { name: 'Nível esperado' }), '3.8');
    type(screen.getByRole('textbox', { name: 'Por que seu nível parece muito errado?' }), 'Motivo');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar solicitação' }));
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/Use dígitos e um separador decimal, por exemplo 3,80/)
    ).toBeTruthy();
  });

  it('validates levels, range order and reason, focuses the first invalid field and sets aria-invalid', async () => {
    setup();
    await userEvent.click(submit());
    const level = screen.getByRole('textbox', { name: 'Expected level' });
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a level.')).toBeTruthy();
    expect(screen.getByText('Enter why your level is incorrect.')).toBeTruthy();
    expect(level.getAttribute('aria-invalid')).toBe('true');
    expect(reason().getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(level);
    // Helper text stays attached to the field next to its error.
    expect(level.getAttribute('aria-describedby')).toContain('-helper');
    expect(level.getAttribute('aria-describedby')).toContain('-error');

    for (const [value, message] of [
      ['3.805', 'Use at most two decimals.'],
      ['7.01', 'Enter a level from 0.00 to 7.00.'],
      ['3,8', 'Use digits and one decimal separator, for example 3.80.'],
      ['abc', 'Use digits and one decimal separator, for example 3.80.']
    ] as const) {
      type(level, value);
      type(reason(), 'ok');
      await userEvent.click(submit());
      expect(screen.getByText(message)).toBeTruthy();
    }
    expect(mocks.submit).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('radio', { name: 'Range' }));
    type(screen.getByRole('textbox', { name: 'Lowest expected level' }), '4.5');
    type(screen.getByRole('textbox', { name: 'Highest expected level' }), '4');
    await userEvent.click(submit());
    expect(screen.getByText("The lowest level can't be above the highest level.")).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: 'Lowest expected level' })
    );
  });

  it.each(['0', '7', '7.00'])('accepts the level bound %s', async (value) => {
    mocks.submit.mockResolvedValue({ request: dto(), replayed: false });
    setup();
    type(reason(), 'bounds');
    type(screen.getByRole('textbox', { name: 'Expected level' }), value);
    await userEvent.click(submit());
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
  });

  it.each([
    ['7.01', 'Enter a level from 0.00 to 7.00.'],
    ['-1', 'Use digits and one decimal separator, for example 3.80.']
  ])('rejects the level %s just outside the bounds', async (value, message) => {
    setup();
    type(reason(), 'bounds');
    type(screen.getByRole('textbox', { name: 'Expected level' }), value);
    await userEvent.click(submit());
    expect(screen.getByText(message)).toBeTruthy();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('bounds the reason at 2000 and the evidence at 4000 code points', async () => {
    mocks.submit.mockResolvedValue({ request: dto(), replayed: false });
    setup();
    type(screen.getByRole('textbox', { name: 'Expected level' }), '4');
    type(reason(), 'a'.repeat(2001));
    await userEvent.click(submit());
    expect(screen.getByText('Keep the reason within 2000 characters.')).toBeTruthy();
    expect(document.activeElement).toBe(reason());
    // Astral characters count as one code point each.
    type(reason(), '🎾'.repeat(2000));
    await userEvent.click(screen.getByRole('button', { name: /Add optional evidence/ }));
    const evidence = screen.getByRole('textbox', { name: 'Evidence' });
    type(evidence, 'e'.repeat(4001));
    await userEvent.click(submit());
    expect(screen.getByText('Keep the evidence within 4000 characters.')).toBeTruthy();
    expect(document.activeElement).toBe(evidence);
    expect(mocks.submit).not.toHaveBeenCalled();
    type(evidence, 'e'.repeat(4000));
    await userEvent.click(submit());
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
  });

  it('opens and closes the optional evidence section from the keyboard', async () => {
    setup();
    const toggle = screen.getByRole('button', { name: /Add optional evidence/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.focus();
    await userEvent.keyboard('{Enter}');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const evidence = screen.getByRole('textbox', { name: 'Evidence' });
    expect(evidence.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText(/Links stay as text and are never opened automatically/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Hide optional evidence/ })).toBe(toggle);
    await userEvent.keyboard(' ');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('textbox', { name: 'Evidence' })).toBeNull();
  });

  it('reopens a collapsed evidence section to focus an evidence error', async () => {
    setup();
    type(screen.getByRole('textbox', { name: 'Expected level' }), '4');
    type(reason(), 'reason');
    const toggle = screen.getByRole('button', { name: /Add optional evidence/ });
    await userEvent.click(toggle);
    type(screen.getByRole('textbox', { name: 'Evidence' }), 'x'.repeat(4001));
    await userEvent.click(toggle);
    expect(screen.queryByRole('textbox', { name: 'Evidence' })).toBeNull();
    await userEvent.click(submit());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Evidence' }))
    );
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('disables duplicate submits while one is pending and sends it once', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    mocks.submit.mockReturnValue(new Promise((done) => (resolve = done)));
    setup();
    type(screen.getByRole('textbox', { name: 'Expected level' }), '4');
    type(reason(), 'reason');
    const form = submit().closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await userEvent.click(submit());
    const pending = screen.getByRole('button', { name: 'Submitting…' });
    expect(pending).toHaveProperty('disabled', true);
    expect(pending.getAttribute('aria-busy')).toBe('true');
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(screen.getByRole('textbox', { name: 'Expected level' })).toHaveProperty(
      'disabled',
      true
    );
    resolve({ request: dto(), replayed: false });
    await waitFor(() => expect(screen.getByText(/Request received/)).toBeTruthy());
  });

  it('shows the existing active request when the server reports a duplicate', async () => {
    mocks.submit.mockRejectedValue(new Error('LEVEL_REVIEW_DUPLICATE_ACTIVE'));
    mocks.list.mockResolvedValue({
      items: [dto({ id: OTHER_ID, status: 'canceled' }), dto({ status: 'under_review' })],
      next_cursor: null
    });
    const { onSubmitted } = setup();
    type(screen.getByRole('textbox', { name: 'Expected level' }), '4');
    type(reason(), 'reason');
    await userEvent.click(submit());
    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByText('You already have an active level review request.')
    ).toBeTruthy();
    const link = await within(alert).findByRole('link', { name: 'View your active request' });
    expect(link.getAttribute('href')).toBe('/level-reviews/' + ID);
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(submit()).toHaveProperty('disabled', false);
  });

  it('keeps the duplicate message even if the active request cannot be looked up', async () => {
    mocks.submit.mockRejectedValue(new Error('LEVEL_REVIEW_DUPLICATE_ACTIVE'));
    mocks.list.mockRejectedValue(new Error('LEVEL_REVIEW_UNAVAILABLE'));
    setup();
    type(screen.getByRole('textbox', { name: 'Expected level' }), '4');
    type(reason(), 'reason');
    await userEvent.click(submit());
    expect(
      await screen.findByText('You already have an active level review request.')
    ).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'View your active request' })).toBeNull();
  });

  it('never claims success when the outcome is unknown and retries with the same command id', async () => {
    mocks.submit
      .mockRejectedValueOnce(new Error('LEVEL_REVIEW_UNAVAILABLE'))
      .mockResolvedValueOnce({ request: dto(), replayed: true });
    const { onSubmitted } = setup();
    type(screen.getByRole('textbox', { name: 'Expected level' }), '4');
    type(reason(), 'reason');
    await userEvent.click(submit());
    expect(
      await screen.findByText(/couldn't confirm your request was saved\. Retrying is safe/)
    ).toBeTruthy();
    expect(screen.queryByText(/Request received/)).toBeNull();
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Check your requests' }).getAttribute('href')).toBe(
      '/level-reviews'
    );
    await userEvent.click(submit());
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith(ID));
    const [first, second] = commandIds();
    expect(first).toMatch(UUID);
    expect(second).toBe(first);
  });

  it('reports an unconfirmed submit when connectivity drops after dispatch', async () => {
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
    mocks.submit.mockImplementation(async () => {
      online.mockReturnValue(false);
      throw new Error('network');
    });
    setup();
    type(screen.getByRole('textbox', { name: 'Expected level' }), '4');
    type(reason(), 'reason');
    await userEvent.click(submit());
    expect((await screen.findByRole('alert')).textContent).toContain(
      "couldn't confirm your request was saved"
    );
    expect(screen.queryByText(/nothing was sent/)).toBeNull();
  });

  it('uses a new command id once the content changes after a failure', async () => {
    mocks.submit
      .mockRejectedValueOnce(new Error('LEVEL_REVIEW_UNAVAILABLE'))
      .mockResolvedValueOnce({ request: dto(), replayed: false });
    setup();
    type(screen.getByRole('textbox', { name: 'Expected level' }), '4');
    type(reason(), 'reason');
    await userEvent.click(submit());
    await screen.findByRole('alert');
    type(reason(), 'a different reason');
    await userEvent.click(submit());
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
    const ids = commandIds();
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('does not send while offline and explains that nothing was sent', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    setup();
    type(screen.getByRole('textbox', { name: 'Expected level' }), '4');
    type(reason(), 'reason');
    await userEvent.click(submit());
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(await screen.findByText(/You're offline, so nothing was sent/)).toBeTruthy();
  });

  it.each([
    ['LEVEL_REVIEW_RATE_LIMITED', "You've sent too many requests recently. Try again later."],
    ['LEVEL_REVIEW_FORBIDDEN', "You can't request or see this review."],
    ['LEVEL_REVIEW_RATING_UNAVAILABLE', "Your current level isn't available yet."],
    ['LEVEL_REVIEW_INVALID_ARGUMENT', "Those details aren't valid. Check the form and try again."],
    ['PROVISIONAL_PLAYER_RESTRICTED', "You can't request or see this review."]
  ])('surfaces %s as an alert', async (code, message) => {
    mocks.submit.mockRejectedValue(new Error(code));
    setup();
    type(screen.getByRole('textbox', { name: 'Expected level' }), '4');
    type(reason(), 'reason');
    await userEvent.click(submit());
    expect((await screen.findByRole('alert')).textContent).toContain(message);
  });

  it('offers sign-in when the session expired', async () => {
    mocks.submit.mockRejectedValue(new Error('UNAUTHENTICATED'));
    setup();
    type(screen.getByRole('textbox', { name: 'Expected level' }), '4');
    type(reason(), 'reason');
    await userEvent.click(submit());
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('explains an unavailable level and offers no form', () => {
    setup({ current: { status: 'ok', current: null } });
    expect(screen.getByRole('alert').textContent).toContain("level isn't available yet");
    expect(screen.queryByRole('button', { name: 'Submit request' })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('surfaces a failed current-level read with retry instead of an empty form', async () => {
    const { onRetryCurrent } = setup({ current: { status: 'error', code: 'unavailable' } });
    expect(screen.getByRole('alert').textContent).toContain("Couldn't load rating information");
    expect(screen.queryByRole('textbox')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetryCurrent).toHaveBeenCalledOnce();
  });

  it('renders every visible string in each locale without leaking keys', () => {
    for (const locale of ['pt-BR', 'es'] as const) {
      cleanup();
      setup({}, locale);
      expect(document.body.textContent).not.toMatch(/levelReview\./);
      expect(document.body.textContent).not.toContain('Request level review');
    }
  });
});

describe('PlayerLevelReviewStatus', () => {
  const setup = (
    request: LevelReviewDto,
    overrides: Partial<Parameters<typeof PlayerLevelReviewStatus>[0]> = {},
    locale: Locale = 'en'
  ) => {
    const onRevalidate = vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined);
    render(
      wrap(
        <PlayerLevelReviewStatus
          request={request}
          current={current}
          onRevalidate={onRevalidate}
          {...overrides}
        />,
        locale
      )
    );
    return { onRevalidate };
  };

  it.each([
    ['pending', 'Pending', 'Waiting for Platform Admin review.', true],
    ['under_review', 'Under review', 'A Platform Admin is reviewing your request.', true],
    [
      'approved',
      'Approved',
      'Current level corrected going forward. Past matches are unchanged.',
      false
    ],
    ['rejected', 'Rejected', 'Request closed. A review note is available.', false],
    ['canceled', 'Canceled', 'You canceled this request.', false]
  ] as const)('shows the %s lifecycle state', (status, label, detail, cancellable) => {
    setup(dto({ status }));
    expect(screen.getByRole('heading', { name: label, level: 2 })).toBeTruthy();
    expect(screen.getByText(detail)).toBeTruthy();
    expect(!!screen.queryByRole('button', { name: 'Cancel request' })).toBe(cancellable);
    // Only the real state is shown, never the other example states of the frame.
    const others = ['Pending', 'Under review', 'Approved', 'Rejected', 'Canceled'].filter(
      (other) => other !== label
    );
    expect(
      others.filter((other) => screen.queryByRole('heading', { name: other, level: 2 }))
    ).toEqual([]);
  });

  it('shows the submission snapshot next to the current level, request id and dates', () => {
    setup(
      dto({
        status: 'under_review',
        under_review_at: '2026-09-25T08:00:00.000000Z',
        snapshot_display_level: 3.82,
        snapshot_reliability_percent: 76
      }),
      { current: { status: 'ok', current: { display_level: 4.05, reliability_percent: 80 } } }
    );
    expect(screen.getByText('Request #11111111 · Submitted Sep 24, 2026')).toBeTruthy();
    const facts = screen.getByText('Level when submitted').closest('dl')!;
    const text = facts.textContent;
    expect(text).toContain('3.82');
    expect(text).toContain('76%');
    expect(text).toContain('4.00 to 4.20');
    expect(text).toContain('4.05 · 80% reliability');
    expect(screen.getByText('Under review since Sep 25, 2026')).toBeTruthy();
    expect(screen.getByText(/Levels can't be edited directly/)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull();
  });

  it('shows an exact request as a single level', () => {
    setup(dto({ requested_min_level: 4, requested_max_level: 4 }));
    expect(screen.getByText('Requested level').nextElementSibling?.textContent).toBe('4.00');
  });

  it('shows the owner the approval note, approved level and applied correction link', () => {
    setup(
      dto({
        status: 'approved',
        decided_at: '2026-09-27T12:00:00.000000Z',
        decision_note: 'Results confirm a 4.10 level.',
        approved_level: 4.1,
        adjustment_id: '33333333-3333-4333-8333-333333333333'
      })
    );
    expect(screen.getByRole('heading', { name: 'Decision' })).toBeTruthy();
    expect(screen.getByText('Results confirm a 4.10 level.')).toBeTruthy();
    expect(screen.getByText('Approved level').nextElementSibling?.textContent).toBe('4.10');
    expect(screen.getByText('Decided Sep 27, 2026')).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'See the correction in your rating history' })
        .getAttribute('href')
    ).toBe('/dashboard');
  });

  it('shows the rejection note without a correction link or approved level', () => {
    setup(
      dto({
        status: 'rejected',
        decided_at: '2026-09-27T12:00:00.000000Z',
        decision_note: 'Not enough evidence.'
      })
    );
    expect(screen.getByText('Not enough evidence.')).toBeTruthy();
    expect(screen.queryByText('Approved level')).toBeNull();
    expect(screen.queryByRole('link', { name: /correction/ })).toBeNull();
  });

  it('does not show a decision card for an owner cancellation', () => {
    setup(dto({ status: 'canceled', canceled_at: '2026-09-26T09:00:00.000000Z' }));
    expect(screen.queryByRole('heading', { name: 'Decision' })).toBeNull();
    expect(screen.getByText('Canceled Sep 26, 2026')).toBeTruthy();
  });

  it('renders reason, evidence and notes as inert text', () => {
    setup(
      dto({
        reason: 'Line one\nLine two <img src=x onerror=alert(1)>',
        evidence: 'See https://example.com/a <script>alert(1)</script>',
        status: 'rejected',
        decision_note: '<b>nope</b> https://example.com/b'
      })
    );
    expect(document.querySelector('img, script, b')).toBeNull();
    expect(screen.getByText(/Line one\s+Line two <img src=x onerror=alert\(1\)>/)).toBeTruthy();
    expect(screen.getByText('See https://example.com/a <script>alert(1)</script>')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /example\.com/ })).toBeNull();
  });

  it('says so when no evidence was added', () => {
    setup(dto());
    expect(screen.getByText('No evidence added.')).toBeTruthy();
  });

  it('surfaces a failed current-level read next to the request instead of hiding it', () => {
    setup(dto(), { current: { status: 'error', code: 'unavailable' } });
    expect(screen.getByRole('alert').textContent).toContain("Couldn't load rating information");
  });

  it('confirms cancellation in a keyboard-operable dialog and restores focus on dismiss', async () => {
    setup(dto());
    const trigger = screen.getByRole('button', { name: 'Cancel request' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    const dialog = await screen.findByRole('alertdialog', { name: 'Cancel this request?' });
    expect(within(dialog).getByText(/You can submit a new request afterwards/)).toBeTruthy();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(mocks.cancel).not.toHaveBeenCalled();
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('button', { name: 'Keep request' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it('cancels, reports only the stored closed state, revalidates and moves focus to the status', async () => {
    mocks.cancel.mockResolvedValue({
      request: dto({ status: 'canceled', canceled_at: '2026-09-26T09:00:00.000000Z' }),
      replayed: false
    });
    const { onRevalidate } = setup(dto({ status: 'under_review' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel request' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(mocks.cancel).toHaveBeenCalledWith({ data: { request_id: ID } });
    expect(onRevalidate).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { name: 'Canceled', level: 2 })).toBeTruthy();
    expect(screen.getByText('Request canceled.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel request' })).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { name: 'Canceled', level: 2 })
      )
    );
  });

  it('keeps the request active and never claims the cancel when the outcome is unknown', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    mocks.cancel.mockRejectedValue(new Error('network'));
    const { onRevalidate } = setup(dto());
    await userEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel request' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      "couldn't confirm your request was saved"
    );
    expect(screen.queryByText('Request canceled.')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Pending', level: 2, hidden: true })).toBeTruthy();
    expect(onRevalidate).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: 'Cancel request' })).toBeTruthy();
  });

  it('reports an already-closed request and re-reads it', async () => {
    mocks.cancel.mockRejectedValue(new Error('LEVEL_REVIEW_INVALID_TRANSITION'));
    const { onRevalidate } = setup(dto());
    await userEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel request' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'This request is already closed.'
    );
    expect(onRevalidate).toHaveBeenCalledOnce();
  });

  it('tells the player the refresh failed after a cancel and offers a refresh', async () => {
    mocks.cancel.mockResolvedValue({
      request: dto({ status: 'canceled', canceled_at: '2026-09-26T09:00:00.000000Z' }),
      replayed: false
    });
    const onRevalidate = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);
    setup(dto(), { onRevalidate });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel request' })
    );
    expect(await screen.findByText(/Couldn't refresh this request/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.queryByText(/Couldn't refresh this request/)).toBeNull());
  });

  it('localizes the status page', () => {
    for (const [locale, label] of [
      ['pt-BR', 'Em análise'],
      ['es', 'En revisión']
    ] as const) {
      cleanup();
      setup(
        dto({ status: 'under_review', requested_min_level: 4.5, requested_max_level: 4.5 }),
        {},
        locale
      );
      expect(screen.getByRole('heading', { name: label, level: 2 })).toBeTruthy();
      expect(document.body.textContent).toContain('4,50');
      expect(document.body.textContent).not.toMatch(/levelReview\./);
    }
  });
});

describe('PlayerLevelReviewHistory', () => {
  const setup = (
    items: LevelReviewDto[],
    nextCursor: { created_at: string; id: string } | null = null,
    locale: Locale = 'en'
  ) => render(wrap(<PlayerLevelReviewHistory initial={items} nextCursor={nextCursor} />, locale));
  const cursor = { created_at: '2026-09-20T10:00:00.000000Z', id: ID };

  it('shows an explicit empty state with the way to request a review', () => {
    setup([]);
    expect(screen.getByRole('heading', { name: 'No requests yet' })).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByRole('link', { name: 'Request level review' }).getAttribute('href')).toBe(
      '/level-reviews/new'
    );
    expect(screen.queryByText(/Showing/)).toBeNull();
  });

  it('lists requests with status, requested level and date, linking to each status page', () => {
    setup([
      dto({ status: 'approved' }),
      dto({ id: OTHER_ID, status: 'rejected', requested_min_level: 5, requested_max_level: 5 })
    ]);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText('Approved')).toBeTruthy();
    expect(within(items[0]!).getByText('Requested 4.00 to 4.20')).toBeTruthy();
    expect(within(items[0]!).getByText('Submitted Sep 24, 2026')).toBeTruthy();
    expect(within(items[0]!).getByRole('link').getAttribute('href')).toBe('/level-reviews/' + ID);
    expect(within(items[1]!).getByText('Requested 5.00')).toBeTruthy();
    expect(screen.getByText('Showing 2 requests')).toBeTruthy();
    // No active request: the primary action starts a new one.
    expect(screen.getByRole('link', { name: 'Request level review' })).toBeTruthy();
  });

  it('points to the active request instead of a new form while one is open', () => {
    setup([dto({ status: 'pending' }), dto({ id: OTHER_ID, status: 'canceled' })]);
    expect(screen.getByRole('link', { name: 'View active request' }).getAttribute('href')).toBe(
      '/level-reviews/' + ID
    );
    expect(screen.queryByRole('link', { name: 'Request level review' })).toBeNull();
  });

  it('paginates with the keyset cursor and stops when the last page arrives', async () => {
    mocks.list.mockResolvedValue({
      items: [dto({ id: OTHER_ID, status: 'canceled' })],
      next_cursor: null
    });
    setup([dto({ status: 'approved' })], cursor);
    expect(screen.getByText('Showing 1 request')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Load more requests' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    expect(mocks.list).toHaveBeenCalledWith({ data: { limit: 20, cursor } });
    expect(screen.queryByRole('button', { name: 'Load more requests' })).toBeNull();
    expect(screen.getByText('Showing 2 requests')).toBeTruthy();
  });

  it('keeps the rows and offers retry when a page fails', async () => {
    mocks.list
      .mockRejectedValueOnce(new Error('LEVEL_REVIEW_UNAVAILABLE'))
      .mockResolvedValueOnce({ items: [dto({ id: OTHER_ID })], next_cursor: null });
    setup([dto({ status: 'approved' })], cursor);
    await userEvent.click(screen.getByRole('button', { name: 'Load more requests' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Something went wrong');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not start a second page load while one is pending', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    mocks.list.mockReturnValue(new Promise((done) => (resolve = done)));
    setup([dto()], cursor);
    await userEvent.click(screen.getByRole('button', { name: 'Load more requests' }));
    const busy = screen.getByRole('button', { name: 'Loading requests…' });
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(busy).toHaveProperty('disabled', true);
    resolve({ items: [], next_cursor: null });
    await waitFor(() => expect(mocks.list).toHaveBeenCalledOnce());
  });

  it('localizes statuses and dates', () => {
    setup([dto({ status: 'under_review' })], null, 'pt-BR');
    expect(screen.getByText('Em análise')).toBeTruthy();
    expect(screen.getByText('Solicitado 4,00 a 4,20')).toBeTruthy();
    expect(screen.getByText('Mostrando 1 solicitação')).toBeTruthy();
  });
});

describe('LevelReviewLoadError', () => {
  it('is explicit about each failure and only retries transient ones', async () => {
    const onRetry = vi.fn<() => void>();
    render(wrap(<LevelReviewLoadError code="LEVEL_REVIEW_NOT_FOUND" onRetry={onRetry} />));
    expect(screen.getByRole('alert').textContent).toContain(
      "This request doesn't exist or you can't see it."
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    cleanup();
    render(wrap(<LevelReviewLoadError code="LEVEL_REVIEW_UNAVAILABLE" onRetry={onRetry} />));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
    cleanup();
    render(wrap(<LevelReviewLoadError code="UNAUTHENTICATED" />));
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
    cleanup();
    render(wrap(<LevelReviewLoadError code="LEVEL_REVIEW_FORBIDDEN" backTo="/level-reviews" />));
    expect(screen.getByRole('link', { name: 'Back to requests' }).getAttribute('href')).toBe(
      '/level-reviews'
    );
  });
});
