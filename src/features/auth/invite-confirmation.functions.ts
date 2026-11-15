import { createServerFn } from '@tanstack/react-start';
import { getRequest, setResponseHeader } from '@tanstack/react-start/server';
import { readInviteConfirmation } from './invite-confirmation.server';

export const getInviteConfirmation = createServerFn().handler(async () => {
  setResponseHeader('Cache-Control', 'private, no-store');
  setResponseHeader('Referrer-Policy', 'no-referrer');
  return readInviteConfirmation(getRequest());
});
