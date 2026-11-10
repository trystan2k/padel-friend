import { createServerFn } from '@tanstack/react-start';
import { requireAuthenticatedClient } from '../auth/auth.server';
import type { HomeData } from './home-contracts';
import { readHome } from './home.server';
import { validateHomeInput } from './home.validators';

/**
 * Authenticated, private/no-store Home read. Claims are verified (never a stored session),
 * anonymous identities are rejected, and every read uses the request-local RLS client.
 */
export const getHome = createServerFn({ method: 'GET' })
  .validator(validateHomeInput)
  .handler(async ({ data }): Promise<HomeData> => {
    const { client, userId } = await requireAuthenticatedClient();
    const { data: claims, error } = await client.auth.getClaims();
    if (error || !claims?.claims?.sub || claims.claims.is_anonymous === true)
      throw new Error('UNAUTHENTICATED');
    return readHome(client, userId, data);
  });
