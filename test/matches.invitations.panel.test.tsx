/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';
import type { MatchInvitation } from '../src/features/matches/match-invitation-model';
const mocks = vi.hoisted(() => ({
  respond: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>()
}));
vi.mock('../src/features/matches/match-invitation.functions', () => ({
  respondMatchEventInvitation: mocks.respond
}));
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: mocks.invalidate }) }));
import { MatchInvitationPanel } from '../src/features/matches/MatchInvitationPanel';
const id = '11111111-1111-4111-8111-111111111111';
const invitation: MatchInvitation = {
  invitation_id: id,
  status: 'pending',
  effective_status: 'pending',
  expires_at: '2030-01-01T00:00:00Z',
  responded_at: null
};
function panel(locale: 'en' | 'pt-BR' | 'es', value = invitation) {
  const i18n = createI18n(locale);
  render(
    <I18nextProvider i18n={i18n}>
      <MatchInvitationPanel eventId={id} invitation={value} timezone="UTC" />
    </I18nextProvider>
  );
  return i18n;
}
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.invalidate.mockResolvedValue(undefined);
});
describe('invitation panel', () => {
  it('announces decline and expiry with translated accessible controls', async () => {
    for (const locale of ['en', 'pt-BR', 'es'] as const) {
      const i18n = panel(locale);
      mocks.respond.mockResolvedValue({
        status: 'declined',
        registration: null,
        replayed: false,
        event_id: id,
        invitation_id: id
      });
      expect(
        screen.getByRole('button', { name: i18n.t('matches.invitations.accept') })
      ).toBeTruthy();
      await userEvent.click(
        screen.getByRole('button', { name: i18n.t('matches.invitations.decline') })
      );
      await waitFor(() =>
        expect(screen.getByRole('status').textContent).toContain(
          i18n.t('matches.invitations.declined')
        )
      );
      expect(screen.queryByRole('button')).toBeNull();
      cleanup();
      panel(locale, { ...invitation, effective_status: 'expired' });
      expect(screen.getByRole('status').textContent).toContain(
        i18n.t('matches.invitations.expired')
      );
      expect(screen.queryByRole('button')).toBeNull();
      cleanup();
    }
  });
  it('shows ordinary pending approval and full feedback without losing response controls', async () => {
    const i18n = panel('en');
    mocks.respond.mockResolvedValueOnce({ status: 'error', code: 'full' });
    await userEvent.click(
      screen.getByRole('button', { name: i18n.t('matches.invitations.accept') })
    );
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain(
        i18n.t('matches.invitations.errors.full')
      )
    );
    mocks.respond.mockResolvedValueOnce({
      status: 'accepted',
      registration: { lifecycle: 'pending' },
      replayed: false
    });
    await userEvent.click(
      screen.getByRole('button', { name: i18n.t('matches.invitations.accept') })
    );
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain(
        i18n.t('matches.invitations.pendingApproval')
      )
    );
    expect(mocks.invalidate).toHaveBeenCalledTimes(2);
  });
  it('announces authoritative expiry when a pending response crosses its deadline', async () => {
    const i18n = panel('en');
    mocks.respond.mockResolvedValue({
      status: 'expired',
      event_id: id,
      invitation_id: id,
      replayed: false,
      registration: null
    });
    await userEvent.click(
      screen.getByRole('button', { name: i18n.t('matches.invitations.accept') })
    );
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain(
        i18n.t('matches.invitations.expired')
      )
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('prefers refreshed registration over original pending submission snapshot', async () => {
    const i18n = createI18n('en');
    const view = render(
      <I18nextProvider i18n={i18n}>
        <MatchInvitationPanel eventId={id} invitation={invitation} timezone="UTC" />
      </I18nextProvider>
    );
    mocks.respond.mockResolvedValue({
      status: 'accepted',
      registration: { lifecycle: 'pending' },
      replayed: true
    });
    await userEvent.click(
      screen.getByRole('button', { name: i18n.t('matches.invitations.accept') })
    );
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain(
        i18n.t('matches.invitations.pendingApproval')
      )
    );
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <MatchInvitationPanel
          eventId={id}
          invitation={{
            ...invitation,
            status: 'accepted',
            effective_status: 'accepted',
            responded_at: '2029-01-01T00:00:00Z'
          }}
          timezone="UTC"
          pendingApproval={false}
        />
      </I18nextProvider>
    );
    expect(screen.getByRole('status').textContent).toContain(
      i18n.t('matches.invitations.accepted')
    );
    expect(screen.getByRole('status').textContent).not.toContain(
      i18n.t('matches.invitations.pendingApproval')
    );
  });
});
