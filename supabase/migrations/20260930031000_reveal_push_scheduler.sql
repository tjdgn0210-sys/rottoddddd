-- Supabase ships these extensions. Plain PostgreSQL tests skip installation.
do $$
begin
  if exists(select 1 from pg_catalog.pg_available_extensions where name='pg_cron') then
    create extension if not exists pg_cron;
  end if;
  if exists(select 1 from pg_catalog.pg_available_extensions where name='pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
end;
$$;

create function private.invoke_reveal_push_dispatch()
returns bigint language plpgsql security definer set search_path='' as $$
declare v_url text; v_secret text; v_request bigint;
begin
  -- Fail closed until the operator configures the same dedicated secret in
  -- Vault and the Edge Function. No secrets appear in cron.job or client data.
  if pg_catalog.to_regclass('vault.decrypted_secrets') is null
    or pg_catalog.to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then return null; end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name=$1'
    into v_url using 'reveal_dispatch_url';
  execute 'select decrypted_secret from vault.decrypted_secrets where name=$1'
    into v_secret using 'reveal_dispatch_secret';
  if v_url is null or v_secret is null or length(v_secret)<32 then return null; end if;
  if v_url !~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/dispatch-reveal-notifications$' then
    raise exception 'Invalid dispatch endpoint';
  end if;
  execute 'select net.http_post(url:=$1,body:=$2,headers:=$3,timeout_milliseconds:=10000)'
    into v_request using v_url,'{}'::jsonb,
      pg_catalog.jsonb_build_object('Content-Type','application/json','x-reveal-dispatch-secret',v_secret);
  return v_request;
end;
$$;
revoke execute on function private.invoke_reveal_push_dispatch() from public,anon,authenticated,service_role;
do $$
begin
  if pg_catalog.to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule('dispatch-daily-reveal-pushes','* * * * *','select private.invoke_reveal_push_dispatch();');
  end if;
end;
$$;
