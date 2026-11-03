/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { createI18n } from '../src/i18n/config';
import { CommunityStatistics } from '../src/features/statistics/CommunityStatistics';
import { PlayerStatistics } from '../src/features/statistics/PlayerStatistics';
import { StatisticsChart } from '../src/features/statistics/StatisticsChart';
import {
  StatisticsEmpty,
  StatisticsError,
  StatisticsLoading
} from '../src/features/statistics/StatisticsStates';
import { makeCommunityStatistics } from './helpers/community-statistics-fixtures';
import { makePlayerStatistics } from './helpers/player-statistics-fixtures';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>
}));

afterEach(cleanup);
type Locale = 'en' | 'pt-BR' | 'es';
const wrap = (node: ReactNode, locale: Locale = 'en') => (
  <I18nextProvider i18n={createI18n(locale)}>{node}</I18nextProvider>
);

const points = [
  { key: '2030-01', label: 'Jan 2030', value: 4 },
  { key: '2030-02', label: 'Feb 2030', value: 0 },
  { key: '2030-03', label: 'Mar 2030', value: 7 }
];
const plain = (value: number) => String(value);

describe('statistics chart contract', () => {
  it('names the figure, summarises the numbers and hides the decorative SVG', () => {
    const { container } = render(
      wrap(
        <StatisticsChart
          title="Matches per month"
          headerLabel="Month"
          valueLabel="Matches"
          points={points}
          plotLimit={12}
          formatValue={plain}
        />
      )
    );
    const figure = screen.getByRole('figure', { name: 'Matches per month' });
    expect(within(figure).getByText(/3 periods from Jan 2030 to Mar 2030/)).toBeTruthy();
    expect(
      within(figure).getByText(/11 matches in total; the highest was 7 in Mar 2030/)
    ).toBeTruthy();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('exposes every plotted value, zero included, in a real table', async () => {
    render(
      wrap(
        <StatisticsChart
          title="Matches per month"
          headerLabel="Month"
          valueLabel="Matches"
          points={points}
          plotLimit={2}
          formatValue={plain}
        />
      )
    );
    expect(screen.queryByRole('table')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show data table' }));
    const table = screen.getByRole('table', { name: 'Matches per month' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.getAttribute('scope'))
    ).toEqual(['col', 'col']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual(
      points.map((point) => point.label)
    );
    expect(rows.map((row) => Number(within(row).getByRole('cell').textContent))).toEqual(
      points.map((point) => point.value)
    );
    expect(
      screen.getByText(
        'The chart shows the latest 2 of 3 periods; the data table contains all of them.'
      )
    ).toBeTruthy();
  });

  it('opens and closes the disclosure from the keyboard and keeps focus on its trigger', async () => {
    const user = userEvent.setup();
    const chart = (
      <StatisticsChart
        title="Matches per month"
        headerLabel="Month"
        valueLabel="Matches"
        points={points}
        plotLimit={12}
        formatValue={plain}
      />
    );
    const { rerender } = render(wrap(chart));
    await user.tab();
    const trigger = screen.getByRole('button', { name: 'Show data table' });
    expect(document.activeElement).toBe(trigger);
    await user.keyboard('{Enter}');
    const hide = screen.getByRole('button', { name: 'Hide data table' });
    expect(hide.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(hide);
    // A filter re-render with new data must not reset the disclosure or move focus.
    rerender(
      wrap(
        <StatisticsChart
          title="Matches per month"
          headerLabel="Month"
          valueLabel="Matches"
          points={[...points, { key: '2030-04', label: 'Apr 2030', value: 1 }]}
          plotLimit={12}
          formatValue={plain}
        />
      )
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Hide data table' }));
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(5);
    await user.keyboard(' ');
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show data table' })).toBeTruthy();
  });

  it.each(['en', 'pt-BR', 'es'] as const)('localizes the controls and summary in %s', (locale) => {
    render(
      wrap(
        <StatisticsChart
          title="T"
          headerLabel="H"
          valueLabel="V"
          points={[{ key: 'a', label: 'A', value: 1 }]}
          plotLimit={12}
          formatValue={plain}
        />,
        locale
      )
    );
    const button = screen.getByRole('button');
    expect(button.textContent).not.toMatch(/statistics\./);
    expect(screen.getByRole('figure').textContent).not.toMatch(/{{|statistics\./);
  });
});

describe('statistics states', () => {
  it('announces loading politely, never as an alert', () => {
    render(wrap(<StatisticsLoading />));
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('Loading statistics…');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a localized error with a keyboard-operable retry only when transient', async () => {
    const retry = vi.fn<() => void>();
    const { rerender } = render(
      wrap(<StatisticsError code="STATISTICS_UNAVAILABLE" onRetry={retry} />)
    );
    expect(screen.getByRole('alert').textContent).toContain('Something went wrong. Try again.');
    const button = screen.getByRole('button', { name: 'Try again' });
    button.focus();
    await userEvent.keyboard('{Enter}');
    expect(retry).toHaveBeenCalledTimes(1);
    rerender(wrap(<StatisticsError code="STATISTICS_NOT_FOUND" onRetry={retry} />));
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('does not exist');
  });

  it('shows the empty copy as plain text', () => {
    render(wrap(<StatisticsEmpty />));
    expect(screen.getByText('Nothing to show for this selection yet.')).toBeTruthy();
  });
});

describe('statistics surfaces', () => {
  it('gives the player activity chart a figure, a table and no colour-only meaning', async () => {
    render(wrap(<PlayerStatistics stats={makePlayerStatistics()} />));
    const figure = screen.getByRole('figure', { name: 'Matches played per month' });
    await userEvent.click(within(figure).getByRole('button', { name: 'Show data table' }));
    const values = within(within(figure).getByRole('table'))
      .getAllByRole('row')
      .slice(1)
      .map((row) => Number(within(row).getByRole('cell').textContent));
    expect(values).toEqual(makePlayerStatistics().activity.months.map((month) => month.groups));
    // Outcome badges always carry their word, so colour is never the only signal.
    for (const badge of screen
      .queryAllByLabelText('Recent results')
      .flatMap((list) => within(list).getAllByRole('listitem'))) {
      expect(badge.textContent?.trim()).not.toBe('');
    }
  });

  it('keeps every community figure labelled and explained', () => {
    render(
      wrap(<CommunityStatistics stats={makeCommunityStatistics()} onApply={vi.fn<() => void>()} />)
    );
    const terms = screen.getAllByRole('term');
    expect(terms.length).toBeGreaterThan(10);
    for (const term of terms) {
      const description = term.nextElementSibling;
      expect(description?.tagName).toBe('DD');
      expect(description?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    }
    expect(screen.getByRole('form', { name: 'Statistics filters' })).toBeTruthy();
  });

  it('operates the community filters from the keyboard', async () => {
    const onApply = vi.fn<(filters: unknown) => void>();
    render(wrap(<CommunityStatistics stats={makeCommunityStatistics()} onApply={onApply} />));
    const user = userEvent.setup();
    const from = screen.getByLabelText('From (UTC date)');
    await user.click(from);
    await user.keyboard('2030-01-01');
    await user.tab({ shift: true });
    const apply = screen.getByRole('button', { name: 'Apply filters' });
    apply.focus();
    await user.keyboard('{Enter}');
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('Whole UTC dates, both included.').length).toBe(2);
  });
});
