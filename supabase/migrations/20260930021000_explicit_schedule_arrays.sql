-- Explicit types remove SQL-lint warnings; scheduling behavior is unchanged.
create or replace function public.ensure_current_week()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz;
  v_week date;
  v_starts timestamptz[] := '{}'::timestamptz[];
  v_ends timestamptz[] := '{}'::timestamptz[];
  v_hour integer;
  v_start timestamptz;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode='28000'; end if;
  insert into public.user_profiles (user_id) values(v_user_id) on conflict(user_id) do nothing;
  perform 1 from public.user_profiles where user_id=v_user_id for update;
  v_now := private.server_now();
  v_week := private.week_start_in_seoul(v_now);
  if not exists(select 1 from public.weekly_cycles where user_id=v_user_id and week_start=v_week) then
    for d in 1..6 loop
      v_hour := case when d=6 then 17 else 9 + 4 * private.random_below(3) end;
      v_start := ((v_week+d-1)::timestamp + v_hour * interval '1 hour') at time zone 'Asia/Seoul';
      v_starts := pg_catalog.array_append(v_starts,v_start);
      v_ends := pg_catalog.array_append(v_ends,v_start + case when d=6 then interval '150 minutes' else interval '4 hours' end);
    end loop;
    perform private.create_weekly_cycle(v_user_id,v_week,v_starts,v_ends);
  end if;
  return private.week_progress(v_user_id,v_now);
end;
$$;
