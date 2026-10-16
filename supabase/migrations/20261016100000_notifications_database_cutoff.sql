create or replace function public.get_my_notifications_as_of()
returns timestamptz language plpgsql stable security definer set search_path = ''
as $function$
begin
  if (select auth.uid()) is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  return statement_timestamp();
end;
$function$;
revoke execute on function public.get_my_notifications_as_of() from public, anon, authenticated;
grant execute on function public.get_my_notifications_as_of() to authenticated;
