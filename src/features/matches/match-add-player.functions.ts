import { createServerFn } from '@tanstack/react-start';
import { getRequestUrl } from '@tanstack/react-start/server';
import { getAdminClient } from '../../lib/supabase/admin.server';
import { requireAuthenticatedClient } from '../auth/auth.server';
import {
  addMatchPlayerError,
  parseAddMatchPlayerStatus,
  type AddMatchPlayerResult
} from './match-add-player-model';
import { deliverMatchPlayerAdd } from './match-add-player.server';
import { validateAddMatchPlayer } from './match-add-player.validators';

export const addMatchPlayer = createServerFn({ method: 'POST' })
  .validator(validateAddMatchPlayer)
  .handler(async ({ data }): Promise<AddMatchPlayerResult> => {
    const { client } = await requireAuthenticatedClient();
    const { data: auth, error: claimsError } = await client.auth.getClaims();
    const actorId = auth?.claims?.sub;
    if (claimsError || !actorId || auth.claims.is_anonymous === true)
      throw new Error('UNAUTHENTICATED');
    // Resolve the server-only admin client first: a missing secret fails before any write.
    const admin = getAdminClient();
    const { data: result, error } = await client.rpc('add_match_player', {
      p_match_event_id: data.event_id,
      p_display_name: data.display_name,
      p_email: data.email,
      p_estimated_level: data.estimated_level,
      p_locale: data.locale,
      p_request_id: data.request_id
    });
    if (error) return addMatchPlayerError(error);
    const status = parseAddMatchPlayerStatus(result);
    if (status !== 'ok') return { status: 'error', code: status ?? 'unavailable' };
    return deliverMatchPlayerAdd(admin, {
      actor_id: actorId,
      event_id: data.event_id,
      request_id: data.request_id,
      origin: getRequestUrl().origin
    });
  });
