/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StatisticsFilters } from '../src/features/statistics/StatisticsFilters';
import type { StatisticsFilters as Filters } from '../src/features/statistics/statistics-contracts';
import { createI18n } from '../src/i18n/config';

afterEach(cleanup);

const filters: Filters = {
  communityId: null,
  leagueId: null,
  type: 'all',
  from: null,
  through: null
};

function renderFilters(onApply: (next: Filters) => void, locale: 'en' | 'pt-BR' | 'es' = 'en') {
  return render(
    <I18nextProvider i18n={createI18n(locale)}>
      <StatisticsFilters filters={filters} leagues={[]} activeLeagueId={null} onApply={onApply} />
    </I18nextProvider>
  );
}

describe('statistics filter chips (Clubhouse m8Loju)', () => {
  it('keeps the radio semantics and marks only the selected chip with a decorative check', async () => {
    const user = userEvent.setup();
    renderFilters(vi.fn());
    const group = screen.getByRole('radiogroup', { name: 'Match type' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false'
    ]);
    expect(group.textContent?.match(/✓/g)).toHaveLength(1);
    expect(within(group).getByText('✓').getAttribute('aria-hidden')).toBe('true');
    await user.click(within(group).getByRole('radio', { name: 'Friendly' }));
    expect(
      within(group)
        .getAllByRole('radio')
        .map((radio) => radio.getAttribute('aria-checked'))
    ).toEqual(['false', 'false', 'true']);
    expect(group.textContent?.match(/✓/g)).toHaveLength(1);
    expect(within(group).getByText('✓').getAttribute('aria-hidden')).toBe('true');
  });

  it('writes the same filter values on Apply and clears them on Reset (URL semantics unchanged)', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn<(next: Filters) => void>();
    renderFilters(onApply);
    await user.click(screen.getByRole('radio', { name: 'Competitive' }));
    await user.type(screen.getByLabelText('From (UTC date)'), '2026-09-15');
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(onApply).toHaveBeenLastCalledWith({
      communityId: null,
      leagueId: null,
      type: 'competitive',
      from: '2026-09-15',
      through: null
    });
    await user.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(onApply).toHaveBeenLastCalledWith(filters);
  });

  it.each(['en', 'pt-BR', 'es'] as const)('renders three localized chips in %s', (locale) => {
    renderFilters(vi.fn(), locale);
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });
});
