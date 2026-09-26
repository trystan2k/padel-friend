import { createServerFn } from '@tanstack/react-start';
import { setResponseHeader } from '@tanstack/react-start/server';
import { getServerClient } from '../../lib/supabase/server';

async function authenticatedClient() {
  setResponseHeader('Cache-Control', 'private, no-store');
  const client = getServerClient();
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims?.sub) throw new Error('Unauthorized');
  return { client, userId: data.claims.sub };
}

export const getIdentity = createServerFn().handler(async () => {
  setResponseHeader('Cache-Control', 'private, no-store');
  const client = getServerClient();
  const { data } = await client.auth.getClaims();
  return data?.claims?.sub ?? null;
});

export const listNotes = createServerFn().handler(async () => {
  const { client } = await authenticatedClient();
  const { data, error } = await client
    .from('notes')
    .select('id, body')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
});

export const addNote = createServerFn({ method: 'POST' })
  .validator((body: string) => {
    const trimmed = body.trim();
    if (!trimmed || trimmed.length > 500) throw new Error('Note length must be 1–500 characters');
    return trimmed;
  })
  .handler(async ({ data: body }) => {
    const { client, userId } = await authenticatedClient();
    const { error } = await client.from('notes').insert({ body, user_id: userId });
    if (error) throw error;
  });
