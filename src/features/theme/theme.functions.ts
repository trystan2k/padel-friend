import { createServerFn } from '@tanstack/react-start';
import { getCookie, setCookie } from '@tanstack/react-start/server';

export const getInitialTheme = createServerFn().handler(() =>
  getCookie('theme') === 'dark' ? ('dark' as const) : ('light' as const)
);

export const saveTheme = createServerFn({ method: 'POST' })
  .validator((theme: string) => (theme === 'dark' ? ('dark' as const) : ('light' as const)))
  .handler(({ data }) => {
    setCookie('theme', data, { path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
  });
