/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';
import type {
  MatchEventManagement,
  ManagementParticipant
} from '../src/features/matches/match-management-model';
const mocks = vi.hoisted(() => ({
  transfer: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  cancel: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>()
}));
vi.mock('../src/features/matches/match-management.functions', () => ({
  transferMatchEventOwnership: mocks.transfer,
  cancelMatchEvent: mocks.cancel
}));
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: mocks.invalidate }) }));
import { MatchOrganizerActions } from '../src/features/matches/MatchOrganizerActions';
const id = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const management: MatchEventManagement = {
  version: 1,
  status: 'open',
  phase: 'open',
  as_of: '2030-01-01T00:00:00Z',
  owner_id: id,
  is_organizer: true,
  is_participant: true,
  results_protected: false,
  reconfirmation_generation: 0,
  required_count: 0,
  actions: {
    reconfirm: { allowed: false, reason: 'forbidden' },
    invitation: { allowed: false, reason: 'forbidden' },
    submit: { allowed: false, reason: 'forbidden' },
    decision: { allowed: true, reason: null },
    edit: { allowed: true, reason: null },
    withdraw: { allowed: true, reason: null },
    remove: { allowed: true, reason: null },
    transfer: { allowed: true, reason: null },
    cancel: { allowed: true, reason: null }
  },
  correction: { available: false, reason: 'results_workflow_unavailable' }
};
const player: ManagementParticipant = {
  registration_id: targetId,
  user_id: targetId,
  attempt_id: targetId,
  display_name: 'Alex',
  display_level: null,
  lifecycle: 'accepted',
  participation: 'reserve',
  accepted_order: 2
};
function element(value = management) {
  return (
    <I18nextProvider i18n={createI18n('en')}>
      <MatchOrganizerActions eventId={id} management={value} participants={[player]} />
    </I18nextProvider>
  );
}
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.invalidate.mockResolvedValue();
});
describe('organizer controls', () => {
  it('offers only consent-current playing or reserve transfer targets', async () => {
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <MatchOrganizerActions
          eventId={id}
          management={management}
          participants={[
            player,
            { ...player, user_id: id, display_name: 'Owner', participation: 'playing' },
            {
              ...player,
              user_id: 'awaiting',
              display_name: 'Awaiting',
              participation: null,
              required_generation: 2,
              confirmed_generation: 1
            },
            {
              ...player,
              user_id: 'not-playing',
              display_name: 'Not playing',
              participation: 'reserve_not_playing'
            },
            { ...player, user_id: 'playing', display_name: 'Playing', participation: 'playing' }
          ]}
        />
      </I18nextProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Transfer organization' }));
    await screen.findByRole('dialog');
    expect(screen.getByRole('option', { name: 'Alex' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Playing' })).toBeTruthy();
    for (const name of ['Awaiting', 'Not playing', 'Owner']) {
      expect(screen.queryByRole('option', { name })).toBeNull();
    }
  });
  it('organizer withdrawal does not imply transfer', () => {
    render(element());
    expect(
      screen.getByText(createI18n('en').t('matches.management.leaveKeepOrganizing'))
    ).toBeTruthy();
    expect(mocks.transfer).not.toHaveBeenCalled();
  });
  it('admin gets cancel only', async () => {
    render(
      element({
        ...management,
        is_organizer: false,
        actions: {
          ...management.actions,
          remove: { allowed: false, reason: 'forbidden' },
          transfer: { allowed: false, reason: 'forbidden' }
        }
      })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Cancel match' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Transfer organization' })).toBeNull();
  });
  it('transfer refresh removes former owner controls', async () => {
    const view = render(element());
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Transfer organization' }));
    await screen.findByRole('dialog');
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'New organizer' }),
      targetId
    );
    mocks.transfer.mockResolvedValue({
      status: 'ok',
      value: { owner_id: targetId },
      replayed: false
    });
    await userEvent.click(screen.getByRole('button', { name: 'Transfer organization' }));
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalledOnce());
    expect(mocks.transfer).toHaveBeenCalledWith({
      data: expect.objectContaining({ event_id: id, expected_version: 1, target_user_id: targetId })
    });
    view.rerender(
      element({
        ...management,
        owner_id: targetId,
        is_organizer: false,
        actions: {
          ...management.actions,
          transfer: { allowed: false, reason: 'forbidden' },
          cancel: { allowed: false, reason: 'forbidden' }
        }
      })
    );
    expect(screen.queryByRole('button', { name: 'Actions' })).toBeNull();
  });
  it.each([
    'Court\nclosed',
    'Court\tclosed',
    'Court\u007fclosed',
    'Court\u009fclosed',
    'x'.repeat(501),
    '   '
  ])('rejects invalid cancellation reason %j with inline guidance', async (reason) => {
    render(element());
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Cancel match' }));
    await screen.findByRole('dialog');
    const input = screen.getByRole('textbox', { name: 'Cancellation reason' });
    fireEvent.change(input, { target: { value: reason } });
    expect(screen.getByRole('button', { name: 'Cancel match' }).hasAttribute('disabled')).toBe(
      true
    );
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const error = screen.getByText(createI18n('en').t('matches.management.reasonInvalid'));
    expect(input.getAttribute('aria-describedby')).toBe(error.id);
    fireEvent.submit(input.closest('form')!);
    expect(mocks.cancel).not.toHaveBeenCalled();
    await userEvent.clear(input);
    await userEvent.type(input, 'Court closed');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(input.hasAttribute('aria-describedby')).toBe(false);
    expect(screen.queryByText(createI18n('en').t('matches.management.reasonInvalid'))).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel match' }).hasAttribute('disabled')).toBe(
      false
    );
  });
  it('cancellation requires reason and preserves draft on version conflict', async () => {
    render(element());
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Cancel match' }));
    await screen.findByRole('dialog');
    const input = screen.getByRole('textbox', { name: 'Cancellation reason' });
    await userEvent.type(input, 'Court closed');
    mocks.cancel.mockResolvedValue({
      status: 'conflict',
      code: 'version_conflict',
      current_version: 2
    });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel match' }));
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledOnce());
    expect(input.getAttribute('disabled')).toBeNull();
    expect(input instanceof HTMLTextAreaElement && input.value).toBe('Court closed');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(mocks.invalidate).toHaveBeenCalledOnce();
  });
  it('keeps the committed success outcome when post-mutation invalidation rejects', async () => {
    render(element());
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Cancel match' }));
    await screen.findByRole('dialog');
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Cancellation reason' }),
      'Court closed'
    );
    mocks.cancel.mockResolvedValue({ status: 'ok' });
    mocks.invalidate.mockRejectedValueOnce(new Error('refresh failed'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel match' }));
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      screen.queryByText(createI18n('en').t('matches.management.errors.unavailable'))
    ).toBeNull();
    expect(screen.getByText(createI18n('en').t('matches.management.cancelled'))).toBeTruthy();
  });
});
