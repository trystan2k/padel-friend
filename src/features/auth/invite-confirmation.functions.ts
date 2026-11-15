import { createServerFn } from '@tanstack/react-start';
import { appendResponseHeader, getRequest, setResponseHeader } from '@tanstack/react-start/server';
import { readInviteConfirmation } from './invite-confirmation.server';

export const getInviteConfirmation = createServerFn().handler(async () => {
  setResponseHeader('Cache-Control', 'private, no-store');
  // Not no-referrer: Chromium then sends `Origin: null` on the confirm form POST, which the
  // same-origin check rejects. same-origin still sends no referrer to any other site.
  setResponseHeader('Referrer-Policy', 'same-origin');
  const rotated = new Headers();
  const confirmation = await readInviteConfirmation(getRequest(), rotated);
  // Forward refresh-token rotation from the claims check so the browser never keeps a spent token.
  for (const cookie of rotated.getSetCookie()) appendResponseHeader('Set-Cookie', cookie);
  return confirmation;
});
