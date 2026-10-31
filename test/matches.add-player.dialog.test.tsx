/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';
import { ADD_PLAYER_ERROR_COPY } from '../src/features/matches/match-add-player-error-copy';
import { ADD_MATCH_PLAYER_ERROR_CODES } from '../src/features/matches/match-add-player-model';
import type {
  ManagementParticipant,
  MatchEventManagement
} from '../src/features/matches/match-management-model';
import en from '../src/locales/en/translation.json';

const mocks = vi.hoisted(() => ({
  add: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>()
}));
vi.mock('../src/features/matches/match-add-player.functions', () => ({
  addMatchPlayer: mocks.add
}));
vi.mock('../src/features/matches/match-management.functions', () => ({
  transferMatchEventOwnership: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  cancelMatchEvent: vi.fn<(...args: unknown[]) => Promise<unknown>>()
}));
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: mocks.invalidate }) }));
import { MatchOrganizerActions } from '../src/features/matches/MatchOrganizerActions';

const eventId = '11111111-1111-4111-8111-111111111111';
const management: MatchEventManagement = {
  version: 1,
  status: 'open',
  phase: 'open',
  as_of: '2030-01-01T00:00:00Z',
  owner_id: eventId,
  is_organizer: true,
  is_participant: true,
  results_protected: false,
  reconfirmation_generation: 0,
  required_count: 0,
  actions: {
    reconfirm: { allowed: false, reason: 'forbidden' },
    invitation: { allowed: false, reason: 'forbidden' },
    submit: { allowed: false, reason: 'forbidden' },
    decision: { allowed: false, reason: 'forbidden' },
    edit: { allowed: true, reason: null },
    withdraw: { allowed: true, reason: null },
    remove: { allowed: true, reason: null },
    transfer: { allowed: true, reason: null },
    cancel: { allowed: true, reason: null }
  },
  correction: { available: false, reason: 'results_workflow_unavailable' }
};
const admin: MatchEventManagement = { ...management, is_organizer: false, is_participant: false };
const participant = (overrides: Partial<ManagementParticipant>): ManagementParticipant => ({
  registration_id: 'r',
  user_id: 'u',
  attempt_id: 'a',
  display_name: 'Alex',
  display_level: null,
  is_provisional: false,
  lifecycle: 'accepted',
  participation: 'playing',
  accepted_order: 2,
  ...overrides
});

function mount(
  value: MatchEventManagement = management,
  participants: ManagementParticipant[] = []
) {
  return render(
    <I18nextProvider i18n={createI18n('en')}>
      <MatchOrganizerActions eventId={eventId} management={value} participants={participants} />
    </I18nextProvider>
  );
}
async function openDialog() {
  await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: en.matches.addPlayer.action }));
  return screen.findByRole('dialog', { name: en.matches.addPlayer.title });
}
async function fillValid(email = '  Marta@Example.com ') {
  await userEvent.type(screen.getByLabelText(en.matches.addPlayer.nameLabel), ' Marta Silva ');
  await userEvent.type(screen.getByLabelText(en.matches.addPlayer.emailLabel), email);
  fireEvent.change(screen.getByRole('slider'), { target: { value: '3.5' } });
}
const submit = () =>
  userEvent.click(screen.getByRole('button', { name: en.matches.addPlayer.submit }));

function sentData(index: number): Record<string, unknown> {
  const arg: unknown = mocks.add.mock.calls[index]?.[0];
  const data: unknown = typeof arg === 'object' && arg !== null ? Reflect.get(arg, 'data') : null;
  return typeof data === 'object' && data !== null ? Object.fromEntries(Object.entries(data)) : {};
}

afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.invalidate.mockResolvedValue();
});

describe('add player entry point', () => {
  it('is offered to the current owner and to a community admin inside the window', async () => {
    const view = mount();
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    expect(await screen.findByRole('menuitem', { name: en.matches.addPlayer.action })).toBeTruthy();
    view.unmount();
    mount(admin);
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    expect(await screen.findByRole('menuitem', { name: en.matches.addPlayer.action })).toBeTruthy();
  });

  it('is hidden for non-managers, after the roster window and for protected results', async () => {
    const nonManager = {
      ...admin,
      actions: { ...admin.actions, cancel: { allowed: false, reason: 'forbidden' as const } }
    };
    const view = mount(nonManager);
    expect(screen.queryByRole('button', { name: 'Actions' })).toBeNull();
    view.unmount();
    for (const closed of [
      { ...management, phase: 'awaiting_results' as const },
      { ...management, phase: 'incomplete' as const }
    ]) {
      const closedView = mount(closed);
      await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
      expect(await screen.findAllByRole('menuitem')).not.toHaveLength(0);
      expect(screen.queryByRole('menuitem', { name: en.matches.addPlayer.action })).toBeNull();
      closedView.unmount();
    }
  });

  it('renders no management controls once the match has started', () => {
    mount({ ...management, phase: 'started' });
    expect(screen.queryByRole('button', { name: 'Actions' })).toBeNull();
  });

  it('never offers a provisional player as an ownership transfer target', async () => {
    mount(management, [
      participant({ user_id: 'p', display_name: 'Pending Pat', is_provisional: true }),
      participant({ user_id: 'q', display_name: 'Registered Quinn' })
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Transfer organization' }));
    await screen.findByRole('dialog');
    expect(screen.getByRole('option', { name: 'Registered Quinn' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Pending Pat' })).toBeNull();
  });
});

describe('add player dialog', () => {
  it('labels fields, describes the level and mirrors validation before any request', async () => {
    mount();
    const dialog = await openDialog();
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    const email = screen.getByLabelText(en.matches.addPlayer.emailLabel);
    expect(email.getAttribute('type')).toBe('email');
    expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe(
      en.matches.addPlayer.levelUnset
    );
    await submit();
    const alerts = (await screen.findAllByRole('alert')).map((node) => node.textContent);
    expect(alerts).toEqual(
      expect.arrayContaining([
        en.matches.addPlayer.validation.name,
        en.matches.addPlayer.validation.email,
        en.matches.addPlayer.validation.level
      ])
    );
    // First invalid field receives focus.
    expect(document.activeElement).toBe(screen.getByLabelText(en.matches.addPlayer.nameLabel));
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it('counts the name limit in code points, not UTF-16 units', async () => {
    mocks.add.mockResolvedValue({ status: 'ok' });
    mount();
    await openDialog();
    await fillValid();
    const name = screen.getByLabelText<HTMLInputElement>(en.matches.addPlayer.nameLabel);
    fireEvent.change(name, { target: { value: '😀'.repeat(81) } });
    expect(screen.getByText(en.matches.addPlayer.validation.name)).toBeTruthy();
    await submit();
    expect(mocks.add).not.toHaveBeenCalled();
    // 80 emoji are 160 UTF-16 units: accepted, never truncated.
    fireEvent.change(name, { target: { value: '😀'.repeat(80) } });
    expect(screen.queryByText(en.matches.addPlayer.validation.name)).toBeNull();
    expect(name.value).toBe('😀'.repeat(80));
    await submit();
    await waitFor(() => expect(mocks.add).toHaveBeenCalledTimes(1));
    expect(sentData(0).display_name).toBe('😀'.repeat(80));
  });

  it('sends normalized input, closes on the uniform success and refreshes projections', async () => {
    mocks.add.mockResolvedValue({ status: 'ok' });
    mount();
    await openDialog();
    await fillValid();
    await submit();
    await waitFor(() => expect(mocks.add).toHaveBeenCalledTimes(1));
    const data = sentData(0);
    expect(data).toMatchObject({
      event_id: eventId,
      display_name: 'Marta Silva',
      email: 'marta@example.com',
      estimated_level: 3.5,
      locale: 'en'
    });
    expect(String(data.request_id)).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const status = screen.getByText('Marta Silva was added and invited.');
    expect(status.tagName).toBe('OUTPUT');
    expect(status.textContent).not.toContain('marta@example.com');
    expect(mocks.invalidate).toHaveBeenCalled();
  });

  it('shows byte-identical success copy whatever email was submitted', async () => {
    const texts: string[] = [];
    for (const email of ['new@x.co', 'provisional@x.co', 'registered@x.co']) {
      mocks.add.mockResolvedValue({ status: 'ok' });
      const view = mount();
      await openDialog();
      await fillValid(email);
      await submit();
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      texts.push(screen.getByText(/was added and invited/).textContent ?? '');
      view.unmount();
    }
    expect(new Set(texts).size).toBe(1);
  });

  it.each([...ADD_MATCH_PLAYER_ERROR_CODES])(
    'maps stable code %s to localized copy',
    async (code) => {
      mocks.add.mockResolvedValue({ status: 'error', code });
      mount();
      await openDialog();
      await fillValid();
      await submit();
      const key = ADD_PLAYER_ERROR_COPY[code].replace('matches.addPlayer.errors.', '');
      const copy: Record<string, string> = en.matches.addPlayer.errors;
      const alert = await screen.findByText(copy[key] ?? '');
      expect(alert.getAttribute('role')).toBe('alert');
      // Failure keeps the dialog and the typed input so the organizer can retry.
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(screen.getByLabelText(en.matches.addPlayer.nameLabel)).toHaveProperty(
        'value',
        ' Marta Silva '
      );
    }
  );

  it('reuses the request id for a retry after a transient failure, not for edited input', async () => {
    mocks.add
      .mockResolvedValueOnce({ status: 'error', code: 'unavailable' })
      .mockResolvedValueOnce({ status: 'error', code: 'unavailable' })
      .mockResolvedValueOnce({ status: 'ok' });
    mount();
    await openDialog();
    await fillValid();
    await submit();
    await screen.findByText(en.matches.addPlayer.errors.unavailable);
    await submit();
    await waitFor(() => expect(mocks.add).toHaveBeenCalledTimes(2));
    await userEvent.type(screen.getByLabelText(en.matches.addPlayer.nameLabel), 'x');
    await submit();
    await waitFor(() => expect(mocks.add).toHaveBeenCalledTimes(3));
    const ids = [0, 1, 2].map((index) => sentData(index).request_id);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[1]);
  });

  it('treats a thrown request as unavailable and reports offline without calling the server', async () => {
    mocks.add.mockRejectedValue(new Error('network'));
    mount();
    await openDialog();
    await fillValid();
    await submit();
    expect(await screen.findByText(en.matches.addPlayer.errors.unavailable)).toBeTruthy();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    mocks.add.mockClear();
    await submit();
    expect(await screen.findByText(en.matches.addPlayer.offline)).toBeTruthy();
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it('cancels with the dialog action and returns focus to the actions trigger', async () => {
    mount();
    await openDialog();
    await userEvent.click(screen.getByRole('button', { name: en.matches.addPlayer.cancel }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Actions' }))
    );
  });
});
