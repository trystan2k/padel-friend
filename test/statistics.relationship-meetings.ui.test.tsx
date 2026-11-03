/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RelationshipMeetings } from '../src/features/statistics/RelationshipMeetings';
import { createI18n } from '../src/i18n/config';
import { makePair } from './helpers/relationship-statistics-fixtures';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/match">{children}</a>
}));
const mocks = vi.hoisted(() => ({ read: vi.fn<(args: unknown) => Promise<unknown>>() }));
vi.mock('../src/features/statistics/statistics-relationships.functions', () => ({
  getPairStatistics: mocks.read,
  getOpponentStatistics: mocks.read
}));
afterEach(() => {
  cleanup();
  mocks.read.mockReset();
});

describe('relationship meetings', () => {
  it('renders a retryable error when the next page fails', async () => {
    const base = makePair();
    const subject = makePair({
      recent: Array.from({ length: 20 }, (_, index) => ({
        ...base.recent[0]!,
        groupId: String(index)
      })),
      record: { ...base.record, matches: { ...base.record.matches, played: 21 } }
    });
    mocks.read.mockRejectedValue(new Error('network'));
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <RelationshipMeetings subject={subject} kind="pair" offset={20} />
      </I18nextProvider>
    );
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
  it('appends the next page and preserves loaded rows on back/forward', async () => {
    const user = userEvent.setup();
    const base = makePair();
    const rows = Array.from({ length: 21 }, (_, index) => ({
      ...base.recent[0]!,
      groupId: String(index)
    }));
    const subject = makePair({
      recent: rows.slice(0, 20),
      record: { ...base.record, matches: { ...base.record.matches, played: 21 } }
    });
    mocks.read.mockResolvedValue({
      status: 'ok',
      value: { ...subject, recentOffset: 20, recent: rows.slice(20) }
    });
    function Harness() {
      const [offset, setOffset] = useState(0);
      return (
        <>
          <output data-testid="offset">{offset}</output>
          <button onClick={() => setOffset(0)}>Back</button>
          <button onClick={() => setOffset(20)}>Forward</button>
          <RelationshipMeetings
            subject={subject}
            kind="pair"
            offset={offset}
            onOffsetChange={setOffset}
          />
        </>
      );
    }
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <Harness />
      </I18nextProvider>
    );
    expect(screen.getByText('Showing 20 of 21')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(screen.getByText('Showing 21 of 21')).toBeTruthy());
    expect(screen.getByTestId('offset').textContent).toBe('20');
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(22);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(mocks.read).toHaveBeenCalledWith({
      data: {
        playerId: subject.focalId,
        otherId: subject.otherId,
        ...subject.filters,
        recentOffset: 20
      }
    });
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Showing 20 of 21')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Forward' }));
    expect(screen.getByText('Showing 21 of 21')).toBeTruthy();
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });
});
