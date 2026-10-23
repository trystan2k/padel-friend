/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it } from 'vitest';
import { createI18n } from '../src/i18n/config';
import * as stylex from '@stylexjs/stylex';
import { matchDetailShellStyles as s } from '../src/features/matches/match-detail-shell.styles';
import {
  MatchStatusBanner,
  type MatchStatusBannerVariant
} from '../src/features/matches/MatchStatusBanner';

afterEach(cleanup);

describe('match status banners', () => {
  it.each(['en', 'pt-BR', 'es'] as const)(
    'renders every translated terminal state in %s',
    (locale) => {
      const i18n = createI18n(locale);
      const expectedCopy = {
        accepted: i18n.t('matches.invitations.accepted'),
        declined: i18n.t('matches.invitations.declined'),
        expired: i18n.t('matches.invitations.expired'),
        closed: i18n.t('matches.management.unavailable.cutoff'),
        started: i18n.t('matches.management.unavailable.started'),
        cancelled: i18n.t('matches.management.unavailable.cancelled'),
        result_protected: ['resultProtected', 'correctionExplanation', 'correctionUnavailable']
          .map((key) => i18n.t(`matches.management.unavailable.${key}`))
          .join(' ')
      };
      const variants: MatchStatusBannerVariant[] = [
        'accepted',
        'declined',
        'expired',
        'closed',
        'started',
        'cancelled',
        'result_protected'
      ];
      for (const variant of variants) {
        const view = render(
          <I18nextProvider i18n={i18n}>
            <MatchStatusBanner variant={variant} />
          </I18nextProvider>
        );
        const title = i18n.t(`matches.detail.statusTitles.${variant}`);
        const banner = screen.getByRole('region', { name: title });
        expect(banner.className).toBe(
          stylex.props(s.banner, variant === 'accepted' && s.positive).className
        );
        expect(banner.firstElementChild?.className).toBe(
          stylex.props(
            s.bannerHeading,
            (variant === 'accepted' || variant === 'result_protected') && s.positiveAccent
          ).className
        );
        expect(within(banner).getByRole('heading', { level: 2, name: title })).toBeTruthy();
        expect(banner.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
        const copy = within(banner).getByRole('status');
        expect(copy.getAttribute('aria-live')).toBe('polite');
        expect(copy.textContent).toBe(expectedCopy[variant]);
        expect(within(banner).queryByRole('button')).toBeNull();
        view.unmount();
      }
    }
  );

  it('preserves truthful approval explanation after invitation acceptance', () => {
    const i18n = createI18n('en');
    render(
      <I18nextProvider i18n={i18n}>
        <MatchStatusBanner variant="accepted" pendingApproval />
      </I18nextProvider>
    );
    expect(screen.getByRole('status').textContent).toBe(
      i18n.t('matches.invitations.pendingApproval')
    );
  });
});
