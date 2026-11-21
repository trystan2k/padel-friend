/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { createI18n } from '../src/i18n/config';
import { LEVEL_REVIEW_STATUSES } from '../src/features/level-reviews/level-review-contracts';
import {
  LevelReviewAvatar,
  LevelReviewStatusChip
} from '../src/features/level-reviews/LevelReviewParts';

afterEach(cleanup);

describe('level review frame parts', () => {
  it.each([
    ['Leo Martín', 'LM'],
    ['Mariana', 'M'],
    ['ana maría de souza', 'AM'],
    ['  Bruno   Silva ', 'BS']
  ])('derives the initials of %s', (name, initials) => {
    const { container } = render(<LevelReviewAvatar name={name} locale="en" />);
    const avatar = container.querySelector('span');
    expect(avatar?.textContent).toBe(initials);
    expect(avatar?.getAttribute('aria-hidden')).toBe('true');
  });

  it('uppercases initials for the viewer locale', () => {
    const { container } = render(<LevelReviewAvatar name="ışık yılmaz" locale="tr" large />);
    expect(container.querySelector('span')?.textContent).toBe('IY');
  });

  it.each(LEVEL_REVIEW_STATUSES)(
    'names the %s status by its label, with a decorative glyph',
    (status) => {
      render(
        <I18nextProvider i18n={createI18n('en')}>
          <LevelReviewStatusChip status={status} />
        </I18nextProvider>
      );
      const label = screen.getByText(
        { under_review: 'Under review', rejected: 'Denied' }[status as string] ??
          status.charAt(0).toUpperCase() + status.slice(1)
      );
      expect(label.querySelector('[aria-hidden="true"]')?.textContent?.length).toBe(1);
    }
  );
});
