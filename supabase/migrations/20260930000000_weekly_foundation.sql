-- Apply with a trusted database role. Client API roles receive read-only progress
-- and the two narrowly scoped RPCs at the end of this migration.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  point_balance integer not null default 0 check (point_balance >= 0),
  current_success_streak integer not null default 0 check (current_success_streak >= 0),
  total_successful_weeks integer not null default 0 check (total_successful_weeks >= 0),
  last_success_week_start date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.weekly_cycles (
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  submission_status text not null default 'PENDING'
    check (submission_status in ('PENDING', 'SUCCESS', 'FAILURE')),
  points_awarded integer not null default 0 check (points_awarded between 0 and 15),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, week_start),
  check (
    (submission_status = 'PENDING' and submitted_at is null and points_awarded = 0)
    or (submission_status = 'SUCCESS' and submitted_at is not null and points_awarded between 10 and 15)
    or (submission_status = 'FAILURE' and submitted_at is not null and points_awarded = 0)
  )
);

create table public.daily_reveals (
  user_id uuid not null,
  week_start date not null,
  day_index smallint not null check (day_index between 1 and 6),
  state text not null default 'WAITING'
    check (state in ('WAITING', 'AVAILABLE', 'REVEAL_READY', 'CONSUMED', 'LOCKED', 'EXPIRED')),
  available_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, week_start, day_index),
  foreign key (user_id, week_start)
    references public.weekly_cycles(user_id, week_start) on delete cascade,
  check (available_at < expires_at),
  check (locked_at is null or consumed_at is not null),
  check (state <> 'LOCKED' or (consumed_at is not null and locked_at is not null))
);

create function private.valid_weekly_numbers(p_numbers integer[])
returns boolean
language sql immutable
set search_path = ''
as $$
  select coalesce(pg_catalog.array_ndims(p_numbers) = 1, false)
    and coalesce(pg_catalog.cardinality(p_numbers) = 6, false)
    and (select count(distinct n) = 6 from pg_catalog.unnest(p_numbers) as items(n))
    and not exists (
      select 1 from pg_catalog.unnest(p_numbers) as items(n)
      where n is null or n not between 1 and 45
    );
$$;

create table private.weekly_secrets (
  user_id uuid not null,
  week_start date not null,
  numbers integer[] not null check (private.valid_weekly_numbers(numbers)),
  created_at timestamptz not null default now(),
  primary key (user_id, week_start),
  foreign key (user_id, week_start)
    references public.weekly_cycles(user_id, week_start) on delete cascade
);

create function private.prevent_secret_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Weekly secret numbers are immutable';
end;
$$;

create trigger weekly_secret_immutable
before update on private.weekly_secrets
for each row execute function private.prevent_secret_update();

alter table public.user_profiles enable row level security;
alter table public.weekly_cycles enable row level security;
alter table public.daily_reveals enable row level security;
alter table private.weekly_secrets enable row level security;

revoke all on table public.user_profiles, public.weekly_cycles, public.daily_reveals
  from public, anon, authenticated, service_role;
grant select on table public.user_profiles, public.weekly_cycles, public.daily_reveals
  to authenticated;
revoke all on table private.weekly_secrets
  from public, anon, authenticated, service_role;

create policy user_profiles_select_own on public.user_profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy weekly_cycles_select_own on public.weekly_cycles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy daily_reveals_select_own on public.daily_reveals
  for select to authenticated using ((select auth.uid()) = user_id);

create function private.create_profile_for_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.create_profile_for_new_user();

-- A future trusted scheduler can call this with six same-day windows in
-- Asia/Seoul. No client role can execute it or regenerate an existing week.
create function private.create_weekly_cycle(
  p_user_id uuid,
  p_week_start date,
  p_available_at timestamptz[],
  p_expires_at timestamptz[]
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_day integer;
  v_numbers integer[];
begin
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'User not found';
  end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception 'Week start must be Monday';
  end if;
  if coalesce(pg_catalog.array_ndims(p_available_at) = 1, false) is false
    or coalesce(pg_catalog.array_ndims(p_expires_at) = 1, false) is false
    or coalesce(pg_catalog.cardinality(p_available_at) = 6, false) is false
    or coalesce(pg_catalog.cardinality(p_expires_at) = 6, false) is false
    or pg_catalog.array_lower(p_available_at, 1) <> 1
    or pg_catalog.array_lower(p_expires_at, 1) <> 1 then
    raise exception 'Exactly six reveal windows are required';
  end if;

  for v_day in 1..6 loop
    if p_available_at[v_day] is null or p_expires_at[v_day] is null
      or p_available_at[v_day] >= p_expires_at[v_day]
      or (p_available_at[v_day] at time zone 'Asia/Seoul')::date <> p_week_start + (v_day - 1)
      or (p_expires_at[v_day] at time zone 'Asia/Seoul')::date <> p_week_start + (v_day - 1) then
      raise exception 'Invalid reveal window for day %', v_day;
    end if;
  end loop;

  insert into public.user_profiles (user_id) values (p_user_id)
    on conflict (user_id) do nothing;
  insert into public.weekly_cycles (user_id, week_start)
    values (p_user_id, p_week_start);

  select pg_catalog.array_agg(draw.n order by draw.random_key)
    into v_numbers
    from (
      select n, pg_catalog.gen_random_uuid() as random_key
      from pg_catalog.generate_series(1, 45) as candidate(n)
      order by random_key
      limit 6
    ) as draw;
  insert into private.weekly_secrets (user_id, week_start, numbers)
    values (p_user_id, p_week_start, v_numbers);

  for v_day in 1..6 loop
    insert into public.daily_reveals
      (user_id, week_start, day_index, available_at, expires_at)
    values
      (p_user_id, p_week_start, v_day, p_available_at[v_day], p_expires_at[v_day]);
  end loop;
end;
$$;

-- The database clock and Asia/Seoul date select today's slot. There are no
-- client-supplied user, week, day, or number parameters.
create function public.consume_daily_reveal()
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_today date := (pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date;
  v_day integer := extract(isodow from v_today);
  v_week_start date := v_today - (v_day - 1);
  v_reveal public.daily_reveals%rowtype;
  v_now timestamptz;
  v_number integer;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if v_day not between 1 and 6 then raise exception 'No Sunday reveal'; end if;

  select * into v_reveal
  from public.daily_reveals
  where user_id = v_user_id and week_start = v_week_start and day_index = v_day
  for update;
  if not found then raise exception 'Daily reveal not found'; end if;
  if v_reveal.state not in ('WAITING', 'AVAILABLE')
    or v_reveal.consumed_at is not null or v_reveal.locked_at is not null then
    raise exception 'Daily reveal already consumed or unavailable';
  end if;

  v_now := pg_catalog.clock_timestamp();
  if v_now < v_reveal.available_at then
    raise exception 'Daily reveal window has not opened';
  end if;

  if v_reveal.state = 'WAITING' then
    update public.daily_reveals set state = 'AVAILABLE', updated_at = v_now
    where user_id = v_user_id and week_start = v_week_start and day_index = v_day;
  end if;
  if v_now >= v_reveal.expires_at then
    update public.daily_reveals set state = 'EXPIRED', updated_at = v_now
    where user_id = v_user_id and week_start = v_week_start and day_index = v_day;
    return null;
  end if;

  select numbers[v_day] into v_number
  from private.weekly_secrets
  where user_id = v_user_id and week_start = v_week_start;
  if not found or v_number is null then raise exception 'Weekly secret unavailable'; end if;

  update public.daily_reveals set state = 'REVEAL_READY', updated_at = v_now
  where user_id = v_user_id and week_start = v_week_start and day_index = v_day;
  update public.daily_reveals set state = 'CONSUMED', consumed_at = v_now, updated_at = v_now
  where user_id = v_user_id and week_start = v_week_start and day_index = v_day;
  update public.daily_reveals set state = 'LOCKED', locked_at = v_now, updated_at = v_now
  where user_id = v_user_id and week_start = v_week_start and day_index = v_day;
  return v_number;
end;
$$;

create function public.submit_weekly_numbers(p_numbers integer[])
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_today date := (pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date;
  v_day integer := extract(isodow from v_today);
  v_week_start date := v_today - (v_day - 1);
  v_profile public.user_profiles%rowtype;
  v_cycle public.weekly_cycles%rowtype;
  v_secret integer[];
  v_completed_count integer;
  v_success boolean;
  v_streak integer;
  v_points integer := 0;
  v_balance integer;
  v_outcome text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if v_day < 6 then raise exception 'Weekly submission opens after Saturday reveal'; end if;
  if not private.valid_weekly_numbers(p_numbers) then
    raise exception 'Submit six unique integers from 1 through 45';
  end if;

  -- Lock the profile first to serialize all point/streak updates for this user.
  select * into v_profile from public.user_profiles
  where user_id = v_user_id for update;
  if not found then raise exception 'User profile not found'; end if;
  select * into v_cycle from public.weekly_cycles
  where user_id = v_user_id and week_start = v_week_start for update;
  if not found then raise exception 'Weekly cycle not found'; end if;
  if v_cycle.submission_status <> 'PENDING' then
    raise exception 'Weekly submission already used';
  end if;

  select count(*) into v_completed_count from public.daily_reveals
  where user_id = v_user_id and week_start = v_week_start
    and state = 'LOCKED' and consumed_at is not null and locked_at is not null;
  if v_completed_count <> 6 then
    raise exception 'All six reveals must be consumed first';
  end if;

  select numbers into v_secret from private.weekly_secrets
  where user_id = v_user_id and week_start = v_week_start;
  if not found then raise exception 'Weekly secret unavailable'; end if;
  v_success := p_numbers @> v_secret and p_numbers <@ v_secret;
  v_balance := v_profile.point_balance;

  if v_success then
    v_streak := case
      when v_profile.last_success_week_start = v_week_start - 7
        then v_profile.current_success_streak + 1
      else 1
    end;
    v_points := 10 + case
      when v_streak >= 12 then 5
      when v_streak >= 8 then 3
      when v_streak >= 4 then 2
      when v_streak >= 2 then 1
      else 0
    end;
    v_balance := v_balance + v_points;
    v_outcome := 'SUCCESS';
    update public.user_profiles
      set point_balance = v_balance,
          current_success_streak = v_streak,
          total_successful_weeks = total_successful_weeks + 1,
          last_success_week_start = v_week_start,
          updated_at = pg_catalog.clock_timestamp()
      where user_id = v_user_id;
  else
    v_streak := 0;
    v_outcome := 'FAILURE';
    update public.user_profiles
      set current_success_streak = 0,
          last_success_week_start = null,
          updated_at = pg_catalog.clock_timestamp()
      where user_id = v_user_id;
  end if;

  update public.weekly_cycles
    set submission_status = v_outcome,
        points_awarded = v_points,
        submitted_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where user_id = v_user_id and week_start = v_week_start;

  return pg_catalog.jsonb_build_object(
    'outcome', v_outcome,
    'pointsAwarded', v_points,
    'currentSuccessStreak', v_streak,
    'pointBalance', v_balance
  );
end;
$$;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Remove it
-- explicitly for every helper and expose only the two authenticated RPCs.
revoke execute on function private.valid_weekly_numbers(integer[])
  from public, anon, authenticated, service_role;
revoke execute on function private.prevent_secret_update()
  from public, anon, authenticated, service_role;
revoke execute on function private.create_profile_for_new_user()
  from public, anon, authenticated, service_role;
revoke execute on function private.create_weekly_cycle(uuid, date, timestamptz[], timestamptz[])
  from public, anon, authenticated, service_role;
revoke execute on function public.consume_daily_reveal()
  from public, anon, authenticated, service_role;
revoke execute on function public.submit_weekly_numbers(integer[])
  from public, anon, authenticated, service_role;
grant execute on function public.consume_daily_reveal() to authenticated;
grant execute on function public.submit_weekly_numbers(integer[]) to authenticated;
