-- True POS cloud sync: one append-only change log per tenant (a shop chain).
--
-- Devices sign in as Supabase auth users. The service role sets their app_metadata
-- ({tenant, store, counter, label}); a device can never change it, so the tenant in the JWT is trusted.
-- The table is reached only through the two functions below, never directly.

create table public.changes (
  seq         bigint generated always as identity primary key,
  tenant      text        not null,
  client_id   uuid        not null,            -- one device transaction; a resend is ignored
  device_id   uuid        not null,
  at          timestamptz not null,            -- device time of the change
  ops         jsonb       not null,            -- [{tb, t: 'ins'|'put'|'del', v?, k?}]
  received_at timestamptz not null default now(),
  unique (tenant, client_id)
);

create index changes_tenant_seq on public.changes (tenant, seq);

alter table public.changes enable row level security;
revoke all on public.changes from anon, authenticated;

create function public.jwt_tenant() returns text
language sql stable
set search_path = ''
as $$ select nullif(auth.jwt() -> 'app_metadata' ->> 'tenant', '') $$;

-- Pushes of one tenant run one at a time (transaction advisory lock), so seq is handed out in commit
-- order and a puller's cursor can never step over a row that commits later with a lower seq.
create function public.push_changes(batch jsonb) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  t text := public.jwt_tenant();
  n integer;
begin
  if t is null or auth.uid() is null then
    raise exception 'not_a_device' using errcode = '42501';
  end if;
  if jsonb_typeof(batch) <> 'array' or jsonb_array_length(batch) > 500 then
    raise exception 'bad_batch' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(t, 0));
  insert into public.changes (tenant, client_id, device_id, at, ops)
  select t, (e ->> 'id')::uuid, auth.uid(), (e ->> 'at')::timestamptz, e -> 'ops'
  from jsonb_array_elements(batch) as e
  where jsonb_typeof(e -> 'ops') = 'array'
  on conflict (tenant, client_id) do nothing;
  get diagnostics n = row_count;
  return n;
end
$$;

-- Everything of the tenant after `since`, oldest first. `mine` marks the caller's own rows.
create function public.pull_changes(since bigint, lim integer default 500)
returns table (seq bigint, mine boolean, ops jsonb)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  t text := public.jwt_tenant();
begin
  if t is null or auth.uid() is null then
    raise exception 'not_a_device' using errcode = '42501';
  end if;
  return query
    select c.seq, c.device_id = auth.uid(), c.ops
    from public.changes c
    where c.tenant = t and c.seq > since
    order by c.seq
    limit least(greatest(lim, 1), 1000);
end
$$;

revoke all on function public.jwt_tenant() from public, anon;
revoke all on function public.push_changes(jsonb) from public, anon;
revoke all on function public.pull_changes(bigint, integer) from public, anon;
grant execute on function public.jwt_tenant() to authenticated;
grant execute on function public.push_changes(jsonb) to authenticated;
grant execute on function public.pull_changes(bigint, integer) to authenticated;
