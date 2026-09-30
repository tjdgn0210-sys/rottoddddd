-- Tokens are opaque delivery capabilities. No client table access is required.
create table public.push_devices (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null check (expo_push_token ~ '^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]{10,200}\]$'),
  installation_id uuid not null,
  platform text not null check (platform in ('android','ios')),
  enabled boolean not null default true,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  last_seen_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (user_id,installation_id)
);
alter table public.push_devices enable row level security;
revoke all on public.push_devices from public,anon,authenticated,service_role;
create index enabled_push_devices on public.push_devices(user_id) where enabled;
create unique index one_enabled_owner_per_push_token on public.push_devices(expo_push_token) where enabled;

create function public.register_push_device(p_token text,p_platform text,p_installation_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_user uuid := auth.uid(); v_now timestamptz := private.server_now();
begin
  if v_user is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if p_token is null or p_token !~ '^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]{10,200}\]$'
    or p_platform is null or p_platform not in ('android','ios') or p_installation_id is null then
    raise exception 'Invalid push registration' using errcode='22023';
  end if;
  -- Serialize transfers/replacements. Never accept a client-supplied user ID.
  perform pg_catalog.pg_advisory_xact_lock(30030001);
  update public.push_devices set enabled=false,updated_at=v_now where expo_push_token=p_token
    and (user_id<>v_user or installation_id<>p_installation_id) and enabled;
  insert into public.push_devices(user_id,expo_push_token,installation_id,platform,last_seen_at,updated_at)
    values(v_user,p_token,p_installation_id,p_platform,v_now,v_now)
  on conflict(user_id,installation_id) do update set expo_push_token=excluded.expo_push_token,
    platform=excluded.platform,enabled=true,
    updated_at=v_now,last_seen_at=v_now;
  return true;
end;
$$;
create function public.unregister_push_device(p_token text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required' using errcode='28000'; end if;
  update public.push_devices set enabled=false,updated_at=private.server_now()
    where user_id=v_user and expo_push_token=p_token;
  return true;
end;
$$;
create function public.get_push_device_status(p_token text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required' using errcode='28000'; end if;
  return exists(select 1 from public.push_devices where user_id=v_user and expo_push_token=p_token and enabled);
end;
$$;

create table private.reveal_push_deliveries (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null,
  week_start date not null,
  day_index smallint not null,
  device_id uuid not null references public.push_devices(id) on delete cascade,
  token_snapshot text not null,
  status text not null default 'PENDING' check(status in ('PENDING','SENDING','SENT','RETRY','FAILED','UNKNOWN','SKIPPED')),
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  ticket_id text,
  receipt_checked_at timestamptz,
  error_code text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(user_id,week_start,day_index,device_id),
  foreign key(user_id,week_start,day_index) references public.daily_reveals(user_id,week_start,day_index) on delete cascade
);
alter table private.reveal_push_deliveries enable row level security;
revoke all on private.reveal_push_deliveries from public,anon,authenticated,service_role;
create index pending_push_receipts on private.reveal_push_deliveries(updated_at) where status='SENT' and receipt_checked_at is null;

-- Only the trusted Edge Function may claim work; no exact times are returned.
create function public.claim_due_reveal_pushes()
returns table(delivery_id uuid) language plpgsql security definer set search_path='' as $$
declare v_now timestamptz := private.server_now();
begin
  perform pg_catalog.pg_advisory_xact_lock(30030002);
  insert into private.reveal_push_deliveries(user_id,week_start,day_index,device_id,token_snapshot)
  select r.user_id,r.week_start,r.day_index,d.id,d.expo_push_token
    from private.daily_reveal_schedules s join public.daily_reveals r using(user_id,week_start,day_index)
    join public.push_devices d on d.user_id=r.user_id and d.enabled
    where s.exact_available_at<=v_now and v_now<s.exact_expires_at
      and s.week_start=private.week_start_in_seoul(v_now)
      and s.day_index=extract(isodow from v_now at time zone 'Asia/Seoul')::integer
      and r.consumed_at is null and r.state in ('WAITING','AVAILABLE')
    on conflict(user_id,week_start,day_index,device_id) do nothing;
  -- PENDING is a durable unsent queue. SENDING/UNKNOWN are never reclaimed:
  -- a crash or timeout can occur after Expo accepts the message.
  return query select q.id from private.reveal_push_deliveries q
    join public.push_devices d on d.id=q.device_id and d.user_id=q.user_id and d.enabled and d.expo_push_token=q.token_snapshot
    join public.daily_reveals r on (r.user_id,r.week_start,r.day_index)=(q.user_id,q.week_start,q.day_index)
    join private.daily_reveal_schedules s on (s.user_id,s.week_start,s.day_index)=(q.user_id,q.week_start,q.day_index)
    where q.status in ('PENDING','RETRY') and q.attempts<3
      and (q.next_attempt_at is null or q.next_attempt_at<=v_now)
      and s.exact_available_at<=v_now and v_now<s.exact_expires_at
      and q.week_start=private.week_start_in_seoul(v_now)
      and q.day_index=extract(isodow from v_now at time zone 'Asia/Seoul')::integer
      and r.consumed_at is null and r.state in ('WAITING','AVAILABLE')
    order by q.created_at limit 100;
end;
$$;
-- Atomically reserve immediately before the HTTP request and recheck all guards.
create function public.prepare_reveal_push(p_id uuid)
returns table(token text,ttl_seconds integer) language plpgsql security definer set search_path='' as $$
declare v_now timestamptz; v_q private.reveal_push_deliveries%rowtype;
begin
  select * into v_q from private.reveal_push_deliveries where id=p_id for update;
  if not found or v_q.status not in ('PENDING','RETRY') or v_q.attempts>=3 then return; end if;
  v_now := private.server_now();
  if v_q.next_attempt_at is not null and v_q.next_attempt_at>v_now then return; end if;
  return query select d.expo_push_token,pg_catalog.floor(extract(epoch from s.exact_expires_at-v_now))::integer
    from public.push_devices d join public.daily_reveals r on r.user_id=v_q.user_id and r.week_start=v_q.week_start and r.day_index=v_q.day_index
    join private.daily_reveal_schedules s on (s.user_id,s.week_start,s.day_index)=(r.user_id,r.week_start,r.day_index)
    where d.id=v_q.device_id and d.user_id=v_q.user_id and d.expo_push_token=v_q.token_snapshot and d.enabled
      and r.consumed_at is null and r.state in ('WAITING','AVAILABLE')
      and s.exact_available_at<=v_now and v_now<s.exact_expires_at-interval '1 second'
      and s.week_start=private.week_start_in_seoul(v_now)
      and s.day_index=extract(isodow from v_now at time zone 'Asia/Seoul')::integer;
  if found then
    update private.reveal_push_deliveries set status='SENDING',attempts=attempts+1,updated_at=v_now where id=p_id;
  else
    update private.reveal_push_deliveries set status='SKIPPED',updated_at=v_now where id=p_id;
  end if;
end;
$$;
create function public.finish_reveal_push(p_id uuid,p_outcome text,p_ticket text default null,p_error text default null)
returns void language plpgsql security definer set search_path='' as $$
declare v_q private.reveal_push_deliveries%rowtype; v_now timestamptz := private.server_now();
begin
  if p_outcome not in ('SENT','RETRY','FAILED','UNKNOWN') or p_outcome is null then raise exception 'Invalid outcome'; end if;
  if p_outcome='SENT' and (p_ticket is null or length(p_ticket)>200) then raise exception 'Missing ticket'; end if;
  select * into v_q from private.reveal_push_deliveries where id=p_id for update;
  if not found or v_q.status<>'SENDING' then return; end if;
  update private.reveal_push_deliveries set status=case when p_outcome='RETRY' and attempts>=3 then 'FAILED' else p_outcome end,
    ticket_id=case when p_outcome='SENT' then p_ticket else null end,error_code=left(p_error,80),
    next_attempt_at=case when p_outcome='RETRY' then v_now+interval '1 minute' else null end,updated_at=v_now where id=p_id;
  if p_error='DeviceNotRegistered' then
    update public.push_devices set enabled=false,updated_at=v_now
      where id=v_q.device_id and user_id=v_q.user_id and expo_push_token=v_q.token_snapshot;
  end if;
end;
$$;
create function public.pending_reveal_push_receipts()
returns table(delivery_id uuid,ticket text) language sql security definer set search_path='' as $$
  select id,ticket_id from private.reveal_push_deliveries where status='SENT' and receipt_checked_at is null
    and updated_at<=private.server_now()-interval '15 minutes' and updated_at>private.server_now()-interval '24 hours'
    order by updated_at limit 100;
$$;
create function public.finish_reveal_push_receipt(p_id uuid,p_error text default null)
returns void language plpgsql security definer set search_path='' as $$
declare v_q private.reveal_push_deliveries%rowtype;
begin
  select * into v_q from private.reveal_push_deliveries where id=p_id for update;
  if not found or v_q.status<>'SENT' or v_q.receipt_checked_at is not null then return; end if;
  update private.reveal_push_deliveries set receipt_checked_at=private.server_now(),error_code=left(p_error,80) where id=p_id;
  if p_error='DeviceNotRegistered' then
    update public.push_devices set enabled=false,updated_at=private.server_now()
      where id=v_q.device_id and user_id=v_q.user_id and expo_push_token=v_q.token_snapshot;
  end if;
end;
$$;
revoke execute on function public.register_push_device(text,text,uuid),public.unregister_push_device(text),public.get_push_device_status(text)
  from public,anon,authenticated,service_role;
grant execute on function public.register_push_device(text,text,uuid),public.unregister_push_device(text),public.get_push_device_status(text) to authenticated;
revoke execute on function public.claim_due_reveal_pushes(),public.prepare_reveal_push(uuid),
  public.finish_reveal_push(uuid,text,text,text),public.pending_reveal_push_receipts(),public.finish_reveal_push_receipt(uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.claim_due_reveal_pushes(),public.prepare_reveal_push(uuid),
  public.finish_reveal_push(uuid,text,text,text),public.pending_reveal_push_receipts(),public.finish_reveal_push_receipt(uuid,text) to service_role;
