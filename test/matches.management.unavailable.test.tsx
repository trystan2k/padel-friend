/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';
import { MatchManagementUnavailable } from '../src/features/matches/MatchManagementUnavailable';
import { MatchParticipantActions } from '../src/features/matches/MatchParticipantActions';
const mocks = vi.hoisted(() => ({
  withdraw: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
}));
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: mocks.invalidate }) }));
vi.mock('../src/features/matches/match-management.functions', () => ({
  withdrawMatchRegistration: mocks.withdraw
}));
afterEach(cleanup);
describe('management unavailable UI', () => {
  it.each(['en', 'pt-BR', 'es'] as const)(
    'result-protected UI directs to correction without nonexistent link (%s)',
    (locale) => {
      const i18n = createI18n(locale);
      render(
        <I18nextProvider i18n={i18n}>
          <MatchManagementUnavailable reason="result_protected" />
        </I18nextProvider>
      );
      expect(screen.getByRole('status').textContent).toContain(
        i18n.t('matches.management.unavailable.correctionExplanation')
      );
      expect(
        screen.getByText(i18n.t('matches.management.unavailable.correctionUnavailable'))
      ).toBeTruthy();
      expect(screen.queryByRole('link')).toBeNull();
      expect(screen.queryByRole('button')).toBeNull();
    }
  );
  it.each(['en', 'pt-BR', 'es'] as const)(
    'started cancelled cutoff reasons translated and announced (%s)',
    (locale) => {
      const i18n = createI18n(locale);
      for (const [reason, key] of [
        ['started', 'started'],
        ['cancelled', 'cancelled'],
        ['closed', 'cutoff']
      ] as const) {
        const view = render(
          <I18nextProvider i18n={i18n}>
            <MatchManagementUnavailable reason={reason} />
          </I18nextProvider>
        );
        expect(screen.getByRole('status').textContent).toContain(
          i18n.t(`matches.management.unavailable.${key}`)
        );
        expect(
          screen.queryByText(i18n.t('matches.management.unavailable.correctionExplanation'))
        ).toBeNull();
        view.unmount();
      }
    }
  );
  it('dialog loses authorization safely after action rejection', async () => {
    mocks.withdraw.mockResolvedValue({ status: 'error', code: 'result_protected' });
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <MatchParticipantActions
          eventId="11111111-1111-4111-8111-111111111111"
          attemptId="22222222-2222-4222-8222-222222222222"
        />
      </I18nextProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Leave match' }));
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status').textContent).toContain('correction');
    expect(document.activeElement).toBe(screen.getByRole('status'));
    expect(screen.queryByRole('button', { name: 'Leave match' })).toBeNull();
    expect(mocks.invalidate).toHaveBeenCalled();
  });
  it('back to match remains usable', async () => {
    const back = vi.fn<() => void>();
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <MatchManagementUnavailable reason="started" onBack={back} />
      </I18nextProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Back to match' }));
    expect(back).toHaveBeenCalledOnce();
  });
});
