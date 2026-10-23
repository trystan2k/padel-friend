/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n, type Locale } from '../src/i18n/config';
import { makeMatchDetail } from './helpers/match-fixtures';
const mocks = vi.hoisted(() => ({
  edit: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  close: vi.fn<() => void>()
}));
vi.mock('../src/features/matches/match-management.functions', () => ({
  editMatchEvent: mocks.edit
}));
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: mocks.invalidate }) }));
import { MatchEditDialog } from '../src/features/matches/MatchEditDialog';
const event = makeMatchDetail({
  event_id: '11111111-1111-4111-8111-111111111111',
  venue_name: 'Original court',
  maps_url: 'https://maps.google.com/maps/court',
  starts_at: '2099-01-01T12:00:00Z',
  registration_cutoff_at: '2099-01-01T10:00:00.123456+00:00',
  timezone: 'UTC',
  price_minor: 100,
  currency: 'EUR',
  accepted_count: 3
});
function element(locale: Locale = 'en', version = 1) {
  return (
    <I18nextProvider i18n={createI18n(locale)}>
      <MatchEditDialog
        event={event}
        version={version}
        onClose={mocks.close}
        returnFocus={{ current: null }}
      />
    </I18nextProvider>
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.invalidate.mockResolvedValue();
});
afterEach(cleanup);
describe('minor edit dialog', () => {
  it('conflict retains draft and reload is explicit', async () => {
    const view = render(element());
    await screen.findByRole('dialog');
    expect(
      screen.queryByText(createI18n('en').t('matches.management.edit.conflictHelper'))
    ).toBeNull();
    const venue = screen.getByRole('textbox', { name: 'Venue name' });
    await userEvent.clear(venue);
    await userEvent.type(venue, 'My draft');
    mocks.edit.mockResolvedValue({
      status: 'conflict',
      code: 'version_conflict',
      current_version: 2
    });
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Match changed elsewhere');
    expect(
      screen.getByText(createI18n('en').t('matches.management.edit.conflictHelper'))
    ).toBeTruthy();
    expect(venue instanceof HTMLInputElement && venue.value).toBe('My draft');
    expect(mocks.invalidate).toHaveBeenCalledOnce();
    view.rerender(element('en', 2));
    await userEvent.click(screen.getByRole('button', { name: 'Review my draft' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Start date and time'));
    expect(mocks.edit).toHaveBeenCalledOnce();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save changes' }).disabled).toBe(
      true
    );
    expect(mocks.edit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        expected_version: 1,
        patch: expect.objectContaining({ venue_name: 'My draft' })
      })
    });
    await userEvent.click(screen.getByRole('button', { name: 'Reload details' }));
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalledTimes(2));
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it.each(['en', 'pt-BR', 'es'] as const)(
    'all field labels errors helper and success copy translated: %s',
    async (locale) => {
      const i18n = createI18n(locale);
      render(element(locale));
      await screen.findByRole('dialog');
      expect(screen.getByRole('button', { name: i18n.t('matches.management.close') })).toBeTruthy();
      expect(
        screen.getByLabelText(i18n.t('matchCreate.fields.notes')).getAttribute('placeholder')
      ).toBe(i18n.t('matchCreate.helpers.optional'));
      for (const field of [
        'venueName',
        'mapsUrl',
        'courtNotes',
        'price',
        'currency',
        'paymentNote',
        'notes',
        'maximumRegistrations',
        'cutoff'
      ])
        expect(screen.getByLabelText(i18n.t(`matchCreate.fields.${field}`))).toBeTruthy();
      expect(screen.getByText(i18n.t('matches.reconfirmation.description'))).toBeTruthy();
      expect(screen.getByLabelText(i18n.t('matchCreate.fields.type'))).toBeTruthy();
      const capacity = screen.getByLabelText(i18n.t('matchCreate.fields.maximumRegistrations'));
      await userEvent.clear(capacity);
      await userEvent.type(capacity, '1');
      await userEvent.click(
        screen.getByRole('button', { name: i18n.t('matches.management.edit.save') })
      );
      expect(
        await screen.findByText(i18n.t('matchCreate.errors.capacityBelowAccepted'))
      ).toBeTruthy();
      expect(mocks.edit).not.toHaveBeenCalled();
      await userEvent.clear(capacity);
      await userEvent.type(capacity, '8');
      const cutoff = screen.getByLabelText(i18n.t('matchCreate.fields.cutoff'));
      await userEvent.clear(cutoff);
      await userEvent.type(cutoff, '2099-01-01T13:00');
      await userEvent.click(
        screen.getByRole('button', { name: i18n.t('matches.management.edit.save') })
      );
      expect(await screen.findByText(i18n.t('matchCreate.errors.futureCutoff'))).toBeTruthy();
      await userEvent.clear(cutoff);
      await userEvent.type(cutoff, '2099-01-01T09:00');
      mocks.edit.mockResolvedValue({ status: 'ok', value: { changed: true }, replayed: false });
      await userEvent.click(
        screen.getByRole('button', { name: i18n.t('matches.management.edit.save') })
      );
      expect(await screen.findByText(i18n.t('matches.management.edit.saved'))).toBeTruthy();
      expect(mocks.invalidate).toHaveBeenCalledOnce();
    }
  );
  it('close icon dismisses without saving and preserves semantic field order', async () => {
    render(element());
    const dialog = await screen.findByRole('dialog');
    const labels = [...dialog.querySelectorAll('fieldset label')].map(
      (label) => label.firstChild?.textContent
    );
    const i18n = createI18n('en');
    expect(labels).toEqual(
      [
        'type',
        'startsAt',
        'venueName',
        'mapsUrl',
        'courtNotes',
        'price',
        'currency',
        'paymentNote',
        'notes',
        'maximumRegistrations',
        'cutoff'
      ].map((name) => {
        return i18n.t(`matchCreate.fields.${name}`);
      })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.edit).not.toHaveBeenCalled();
  });
  it('network retry preserves request id while a fresh draft gets a new intent', async () => {
    render(element());
    await screen.findByRole('dialog');
    mocks.edit
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue({ status: 'error', code: 'unavailable' });
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText(createI18n('en').t('matches.management.errors.unavailable'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(2));
    expect(mocks.edit.mock.calls[0]).toEqual(mocks.edit.mock.calls[1]);
    await userEvent.type(screen.getByRole('textbox', { name: 'Venue name' }), ' updated');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(3));
    expect(mocks.edit.mock.calls[2]).not.toEqual(mocks.edit.mock.calls[1]);
  });
});
