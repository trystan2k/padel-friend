/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';

vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  Link: ({ children, to, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  )
}));

import { PlatformAdminEntry } from '../src/features/level-reviews/PlatformAdminEntry';

afterEach(cleanup);

function show(allowed: boolean, locale: 'en' | 'pt-BR' = 'en') {
  return render(
    <I18nextProvider i18n={createI18n(locale)}>
      <PlatformAdminEntry allowed={allowed} />
    </I18nextProvider>
  );
}

it('links the queue only when the server context reports platform-admin access', () => {
  show(true);
  const link = screen.getByRole('link', { name: 'Open level review queue' });
  expect(link.getAttribute('href')).toBe('/platform-admin/level-reviews');
  expect(screen.getByRole('region', { name: 'Platform administration' })).toBeTruthy();
});

it('renders nothing for everyone else', () => {
  const view = show(false);
  expect(view.container.innerHTML).toBe('');
  expect(screen.queryByRole('link')).toBeNull();
});

it('removes the link when the server access context flips to non-admin', () => {
  const view = show(true);
  expect(screen.getByRole('link', { name: 'Open level review queue' })).toBeTruthy();
  view.rerender(
    <I18nextProvider i18n={createI18n('en')}>
      <PlatformAdminEntry allowed={false} />
    </I18nextProvider>
  );
  expect(screen.queryByRole('link')).toBeNull();
  expect(view.container.innerHTML).toBe('');
});

it('is translated', () => {
  show(true, 'pt-BR');
  expect(screen.getByRole('link', { name: 'Abrir fila de revisão de nível' })).toBeTruthy();
});
