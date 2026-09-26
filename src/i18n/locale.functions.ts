import { createServerFn } from '@tanstack/react-start';
import { getCookie, getRequestHeader, setCookie } from '@tanstack/react-start/server';
import { resolveLocale } from './config';

export const getInitialLocale = createServerFn().handler(() => {
  const preferred = getCookie('locale') ?? getRequestHeader('accept-language')?.split(',')[0];
  return resolveLocale(preferred);
});

export const saveLocale = createServerFn({ method: 'POST' })
  .validator((locale: string) => resolveLocale(locale))
  .handler(({ data }) => {
    setCookie('locale', data, { path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
  });
