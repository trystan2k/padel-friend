-- Option (a): only the verified, server-only service-role finalizer writes avatar_url.
-- Revoke table UPDATE too: a table grant overrides a revoked column grant.
-- Table-level REVOKE also removes column grants; restore only the safe profile allowlist.
revoke update on public.player_profiles from public, anon, authenticated;
revoke update (avatar_url) on public.player_profiles from public, anon, authenticated;
grant update (display_name, preferred_side, dominant_hand, bio,
  preferred_playing_days, preferred_playing_times)
  on public.player_profiles to authenticated;

-- No browser deletion/reinsertion or overwrite between verification and the CAS write.
-- Clients already upload unique keys with upsert:false; unused keys remain GC candidates.
-- Rejected candidates are deleted only by the narrow server-side cleanup path.
drop policy if exists "avatar owner delete" on storage.objects;
create policy "avatar immutable update" on storage.objects
  as restrictive for update to authenticated
  using (bucket_id <> 'player-avatars')
  with check (bucket_id <> 'player-avatars');
create policy "avatar immutable delete" on storage.objects
  as restrictive for delete to authenticated
  using (bucket_id <> 'player-avatars');
