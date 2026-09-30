-- Preserve legacy schedules verbatim, but remove exact timing from public data.
-- New cycles use FINAL schedules. No weekly secret or consumption is reset.
alter table public.daily_reveals rename column available_at to public_window_start;
alter table public.daily_reveals rename column expires_at to public_window_end;

create table private.daily_reveal_schedules (
  user_id uuid not null,
  week_start date not null,
  day_index smallint not null check (day_index between 1 and 6),
  exact_available_at timestamptz not null,
  exact_expires_at timestamptz not null,
  schedule_kind text not null default 'FINAL' check (schedule_kind in ('LEGACY', 'FINAL')),
  primary key (user_id, week_start, day_index),
  foreign key (user_id, week_start, day_index)
    references public.daily_reveals(user_id, week_start, day_index) on delete cascade,
  check (exact_available_at < exact_expires_at),
  check (schedule_kind = 'LEGACY' or exact_expires_at = exact_available_at + interval '5 minutes')
);
alter table private.daily_reveal_schedules enable row level security;
revoke all on table private.daily_reveal_schedules from public, anon, authenticated, service_role;

insert into private.daily_reveal_schedules
  (user_id, week_start, day_index, exact_available_at, exact_expires_at, schedule_kind)
select user_id, week_start, day_index, public_window_start, public_window_end, 'LEGACY'
from public.daily_reveals;

create function private.guard_reveal_schedule()
returns trigger language plpgsql set search_path = '' as $$
declare v_public public.daily_reveals%rowtype;
begin
  if tg_op = 'UPDATE' then raise exception 'Daily schedules are immutable'; end if;
  select * into strict v_public from public.daily_reveals
    where user_id = new.user_id and week_start = new.week_start and day_index = new.day_index;
  if new.exact_available_at < v_public.public_window_start
    or new.exact_available_at >= v_public.public_window_end then
    raise exception 'Exact reveal must be inside its public window';
  end if;
  return new;
end;
$$;
create trigger daily_schedule_immutable before insert or update on private.daily_reveal_schedules
  for each row execute function private.guard_reveal_schedule();

create function private.guard_public_reveal_window()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.user_id, new.week_start, new.day_index, new.public_window_start, new.public_window_end)
    is distinct from (old.user_id, old.week_start, old.day_index, old.public_window_start, old.public_window_end) then
    raise exception 'Public reveal windows are immutable';
  end if;
  return new;
end;
$$;
create trigger public_reveal_window_immutable before update on public.daily_reveals
  for each row execute function private.guard_public_reveal_window();

-- UUID randomness is independent of a connection's pseudorandom setseed state.
create function private.random_below(p_limit integer)
returns integer language sql volatile set search_path = '' as $$
  select pg_catalog.floor(
    (('x' || pg_catalog.substr(pg_catalog.gen_random_uuid()::text, 1, 8))::bit(32)::bigint)::numeric
    * p_limit / 4294967296)::integer;
$$;

create function private.effective_reveal_state(
  p_state text, p_consumed_at timestamptz, p_now timestamptz,
  p_available_at timestamptz, p_expires_at timestamptz
)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_consumed_at is not null or p_state in ('REVEAL_READY', 'CONSUMED', 'LOCKED') then 'LOCKED'
    when p_state = 'EXPIRED' or p_now >= p_expires_at then 'EXPIRED'
    when p_now >= p_available_at then 'AVAILABLE'
    else 'WAITING'
  end;
$$;

create function private.server_now()
returns timestamptz language sql volatile set search_path = '' as $$
  select pg_catalog.clock_timestamp();
$$;

-- Retain the private creator's signature; inputs now describe PUBLIC windows.
create or replace function private.create_weekly_cycle(
  p_user_id uuid, p_week_start date, p_available_at timestamptz[], p_expires_at timestamptz[]
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_numbers integer[];
  v_exact timestamptz;
  v_start timestamp;
  v_end timestamp;
begin
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'User not found';
  end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception 'Week start must be Monday';
  end if;
  if coalesce(pg_catalog.array_ndims(p_available_at), 0) <> 1
    or coalesce(pg_catalog.array_ndims(p_expires_at), 0) <> 1
    or coalesce(pg_catalog.cardinality(p_available_at), 0) <> 6
    or coalesce(pg_catalog.cardinality(p_expires_at), 0) <> 6
    or pg_catalog.array_lower(p_available_at, 1) <> 1
    or pg_catalog.array_lower(p_expires_at, 1) <> 1 then
    raise exception 'Exactly six public windows are required';
  end if;
  for d in 1..6 loop
    v_start := p_available_at[d] at time zone 'Asia/Seoul';
    v_end := p_expires_at[d] at time zone 'Asia/Seoul';
    if v_start is null or v_end is null or v_start::date <> p_week_start + d - 1
      or v_end::date <> p_week_start + d - 1
      or (d <= 5 and (v_start::time not in (time '09:00', time '13:00', time '17:00')
        or v_end - v_start <> interval '4 hours'))
      or (d = 6 and (v_start::time <> time '17:00' or v_end::time <> time '19:30')) then
      raise exception 'Invalid public window for day %', d;
    end if;
  end loop;

  insert into public.user_profiles (user_id) values (p_user_id) on conflict (user_id) do nothing;
  insert into public.weekly_cycles (user_id, week_start) values (p_user_id, p_week_start);
  select pg_catalog.array_agg(draw.n order by draw.random_key) into v_numbers from (
    select n, pg_catalog.gen_random_uuid() as random_key
    from pg_catalog.generate_series(1,45) as candidates(n) order by random_key limit 6
  ) as draw;
  insert into private.weekly_secrets (user_id,week_start,numbers) values (p_user_id,p_week_start,v_numbers);

  for d in 1..6 loop
    insert into public.daily_reveals (user_id,week_start,day_index,public_window_start,public_window_end)
      values (p_user_id,p_week_start,d,p_available_at[d],p_expires_at[d]);
    -- Whole-second offsets: lower bound inclusive; public end strictly exclusive.
    v_exact := p_available_at[d] + private.random_below(
      extract(epoch from p_expires_at[d] - p_available_at[d])::integer) * interval '1 second';
    insert into private.daily_reveal_schedules (user_id,week_start,day_index,exact_available_at,exact_expires_at)
      values (p_user_id,p_week_start,d,v_exact,v_exact + interval '5 minutes');
  end loop;
end;
$$;

-- Private snapshot helper accepts a testable clock; no client may call it.
create function private.week_progress(p_user_id uuid, p_now timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_week date := private.week_start_in_seoul(p_now);
  v_day integer := extract(isodow from p_now at time zone 'Asia/Seoul')::integer;
  v_result jsonb;
begin
  -- Lazy synchronization makes expiration permanent without cron. Do not touch
  -- terminal/consumed rows; row updates serialize with consumption.
  update public.daily_reveals r set
    state = private.effective_reveal_state(r.state,r.consumed_at,p_now,s.exact_available_at,s.exact_expires_at),
    updated_at = p_now
  from private.daily_reveal_schedules s
  where r.user_id = p_user_id and r.week_start = v_week
    and (s.user_id,s.week_start,s.day_index) = (r.user_id,r.week_start,r.day_index)
    and r.state in ('WAITING','AVAILABLE') and r.consumed_at is null
    and r.state <> private.effective_reveal_state(r.state,r.consumed_at,p_now,s.exact_available_at,s.exact_expires_at);

  select pg_catalog.jsonb_build_object(
    'weekStart',c.week_start,'currentDayIndex',case when v_day <= 6 then v_day else null end,
    'submissionStatus',c.submission_status,'submittedAt',c.submitted_at,
    'reveals',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'dayIndex',r.day_index,'state',r.state,
      'publicWindowStart',r.public_window_start,'publicWindowEnd',r.public_window_end,'consumedAt',r.consumed_at
    ) order by r.day_index),'[]'::jsonb) from public.daily_reveals r
      where r.user_id=p_user_id and r.week_start=v_week)
  ) into v_result from public.weekly_cycles c where c.user_id=p_user_id and c.week_start=v_week;
  return v_result;
end;
$$;

create or replace function public.ensure_current_week()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz;
  v_week date;
  v_starts timestamptz[] := '{}';
  v_ends timestamptz[] := '{}';
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

create function private.current_reveal_status(p_user_id uuid, p_now timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_progress jsonb := private.week_progress(p_user_id,p_now);
  v_day integer := extract(isodow from p_now at time zone 'Asia/Seoul')::integer;
  v_reveal jsonb;
  v_remaining integer;
begin
  if v_day<=6 then
    v_reveal := v_progress->'reveals'->(v_day-1);
    if v_reveal->>'state' = 'AVAILABLE' then
      select pg_catalog.ceil(extract(epoch from exact_expires_at-p_now))::integer into v_remaining
      from private.daily_reveal_schedules
      where user_id=p_user_id and week_start=private.week_start_in_seoul(p_now) and day_index=v_day;
    end if;
  end if;
  return pg_catalog.jsonb_build_object('weekStart',v_progress->'weekStart',
    'currentDayIndex',case when v_day<=6 then v_day else null end,
    'reveal',v_reveal,'remainingSeconds',v_remaining);
end;
$$;

create function public.get_current_reveal_status()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode='28000'; end if;
  perform public.ensure_current_week();
  return private.current_reveal_status(v_user_id,private.server_now());
end;
$$;

create or replace function public.consume_daily_reveal()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz;
  v_week date;
  v_day integer;
  v_reveal public.daily_reveals%rowtype;
  v_schedule private.daily_reveal_schedules%rowtype;
  v_number integer;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode='28000'; end if;
  -- Profile-first locking agrees with initialization/status/submission.
  perform public.ensure_current_week();
  v_now := private.server_now();
  v_week := private.week_start_in_seoul(v_now);
  v_day := extract(isodow from v_now at time zone 'Asia/Seoul')::integer;
  if v_day=7 then raise exception 'No Sunday reveal'; end if;
  select * into strict v_reveal from public.daily_reveals
    where user_id=v_user_id and week_start=v_week and day_index=v_day for update;
  select * into strict v_schedule from private.daily_reveal_schedules
    where user_id=v_user_id and week_start=v_week and day_index=v_day;
  -- Re-read the clock after any lock wait. Closed-app consumption cannot replay.
  v_now := private.server_now();
  if v_reveal.consumed_at is not null or v_reveal.state in ('REVEAL_READY','CONSUMED','LOCKED') then
    raise exception 'Daily reveal already consumed';
  end if;
  if v_reveal.state='EXPIRED' or v_now>=v_schedule.exact_expires_at then
    update public.daily_reveals set state='EXPIRED',updated_at=v_now
      where user_id=v_user_id and week_start=v_week and day_index=v_day;
    return null; -- Existing API: expired opportunity returns no number, commits EXPIRED.
  end if;
  if v_now<v_schedule.exact_available_at then raise exception 'Daily reveal is not available'; end if;
  select numbers[v_day] into v_number from private.weekly_secrets where user_id=v_user_id and week_start=v_week;
  if v_number is null then raise exception 'Weekly secret unavailable'; end if;
  update public.daily_reveals set state='LOCKED',consumed_at=v_now,locked_at=v_now,updated_at=v_now
    where user_id=v_user_id and week_start=v_week and day_index=v_day;
  return v_number;
end;
$$;

revoke execute on function private.guard_reveal_schedule(), private.guard_public_reveal_window(),
  private.random_below(integer), private.server_now(), private.effective_reveal_state(text,timestamptz,timestamptz,timestamptz,timestamptz),
  private.week_progress(uuid,timestamptz), private.current_reveal_status(uuid,timestamptz)
  from public,anon,authenticated,service_role;
revoke execute on function private.create_weekly_cycle(uuid,date,timestamptz[],timestamptz[])
  from public,anon,authenticated,service_role;
revoke execute on function public.ensure_current_week(), public.get_current_reveal_status(), public.consume_daily_reveal()
  from public,anon,authenticated,service_role;
grant execute on function public.ensure_current_week(), public.get_current_reveal_status(), public.consume_daily_reveal() to authenticated;
