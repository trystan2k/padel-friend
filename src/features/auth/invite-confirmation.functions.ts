import { createServerFn } from '@tanstack/react-start';
import { appendResponseHeader, getRequest, setResponseHeader } from '@tanstack/react-start/server';
import { readInviteConfirmation } from './invite-confirmation.server';

export const getInviteConfirmation = createServerFn().handler(async () => {
  setResponseHeader('Cache-Control', 'private, no-store');
  setResponseHeader('Referrer-Policy', 'no-referrer');
  const rotated = new Headers();
  const confirmation = await readInviteConfirmation(getRequest(), rotated);
  // Forward refresh-token rotation from the claims check so the browser never keeps a spent token.
  for (const cookie of rotated.getSetCookie()) appendResponseHeader('Set-Cookie', cookie);
  return confirmation;
});
