-- Forward-only addition: keep the foundation, private creator, and RLS intact.
create function private.week_start_in_seoul(p_now timestamptz)
returns date
language sql stable
set search_path = ''
as $$
  select (p_now at time zone 'Asia/Seoul')::date
    - (extract(isodow from p_now at time zone 'Asia/Seoul')::integer - 1);
$$;

revoke execute on function private.week_start_in_seoul(timestamptz)
  from public, anon, authenticated, service_role;

create function public.ensure_current_week()
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz;
  v_week_start date;
  v_day integer;
  v_available_at timestamptz[];
  v_expires_at timestamptz[];
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  -- Repair a missing own profile using only server-controlled defaults.
  insert into public.user_profiles (user_id) values (v_user_id)
    on conflict (user_id) do nothing;

  -- Serialize both first creation and repeat calls across devices. Match the
  -- existing submission RPC's profile-first lock order; release at transaction end.
  perform 1 from public.user_profiles where user_id = v_user_id for update;

  -- Capture time after waiting for the lock so a Monday-boundary wait cannot
  -- initialize an obsolete week. No date or identity arguments are accepted.
  v_now := pg_catalog.clock_timestamp();
  v_week_start := private.week_start_in_seoul(v_now);
  v_day := extract(isodow from v_now at time zone 'Asia/Seoul')::integer;

  if not exists (
    select 1 from public.weekly_cycles
    where user_id = v_user_id and week_start = v_week_start
  ) then
    -- Provisional full-day Seoul windows, Monday through Saturday only.
    -- The private creator requires both endpoints to fall on the same local day.
    -- Use the last microsecond of that day rather than next-day midnight.
    select pg_catalog.array_agg((v_week_start + d)::timestamp at time zone 'Asia/Seoul' order by d),
           pg_catalog.array_agg(((v_week_start + d + 1)::timestamp at time zone 'Asia/Seoul')
             - interval '1 microsecond' order by d)
      into v_available_at, v_expires_at
      from pg_catalog.generate_series(0, 5) as days(d);

    -- Existing trusted helper generates six distinct random integers from 1..45
    -- and creates all public and private rows in this same transaction.
    perform private.create_weekly_cycle(v_user_id, v_week_start, v_available_at, v_expires_at);
  end if;

  -- Explicit whitelist: never select or return private numbers or another user.
  select pg_catalog.jsonb_build_object(
    'weekStart', c.week_start,
    'currentDayIndex', case when v_day <= 6 then v_day else null end,
    'submissionStatus', c.submission_status,
    'submittedAt', c.submitted_at,
    'reveals', (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'dayIndex', r.day_index,
        'state', r.state,
        'availableAt', r.available_at,
        'expiresAt', r.expires_at,
        'consumedAt', r.consumed_at
      ) order by r.day_index), '[]'::jsonb)
      from public.daily_reveals r
      where r.user_id = v_user_id and r.week_start = v_week_start
    )
  ) into v_result
  from public.weekly_cycles c
  where c.user_id = v_user_id and c.week_start = v_week_start;

  return v_result;
end;
$$;

revoke execute on function public.ensure_current_week()
  from public, anon, authenticated, service_role;
grant execute on function public.ensure_current_week() to authenticated;
