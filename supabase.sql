-- Huskeliste: felles handleliste og gjøremål for en husstand.
-- Kjør hele filen i Supabase → SQL Editor. Trygt å kjøre på nytt.
-- Bruker samme Supabase-prosjekt som matdagboken; tabellene har prefiks hl_.

create table if not exists public.hl_households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Hjemme',
  invite_code text not null unique,
  ical_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.hl_members (
  household_id uuid not null references public.hl_households(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  display_name text,
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.hl_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.hl_households(id) on delete cascade,
  list text not null check (list in ('handle', 'gjore')),
  text text not null check (char_length(text) between 1 and 200),
  done boolean not null default false,
  done_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists hl_items_household_list on public.hl_items (household_id, list, done);

-- Er innlogget bruker medlem av husstanden?
create or replace function public.hl_is_member(h uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from hl_members where household_id = h and user_id = auth.uid());
$$;

alter table public.hl_households enable row level security;
alter table public.hl_members enable row level security;
alter table public.hl_items enable row level security;

drop policy if exists "hl_households_select" on public.hl_households;
create policy "hl_households_select" on public.hl_households for select to authenticated using (hl_is_member(id));
drop policy if exists "hl_households_update" on public.hl_households;
create policy "hl_households_update" on public.hl_households for update to authenticated
  using (hl_is_member(id)) with check (hl_is_member(id));

drop policy if exists "hl_members_select" on public.hl_members;
create policy "hl_members_select" on public.hl_members for select to authenticated using (hl_is_member(household_id));
drop policy if exists "hl_members_update_self" on public.hl_members;
create policy "hl_members_update_self" on public.hl_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "hl_members_leave" on public.hl_members;
create policy "hl_members_leave" on public.hl_members for delete to authenticated using (user_id = auth.uid());

drop policy if exists "hl_items_all" on public.hl_items;
create policy "hl_items_all" on public.hl_items for all to authenticated
  using (hl_is_member(household_id)) with check (hl_is_member(household_id));

-- Lag en ny husstand med en invitasjonskode, og bli medlem.
create or replace function public.hl_create_household(p_name text, p_display text)
returns public.hl_households
language plpgsql security definer set search_path = public as $$
declare h hl_households; abc text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; c text;
begin
  if auth.uid() is null then raise exception 'Ikke logget inn'; end if;
  loop
    c := '';
    for i in 1..6 loop c := c || substr(abc, 1 + floor(random() * length(abc))::int, 1); end loop;
    exit when not exists (select 1 from hl_households where invite_code = c);
  end loop;
  insert into hl_households (name, invite_code) values (coalesce(nullif(trim(p_name), ''), 'Hjemme'), c) returning * into h;
  insert into hl_members (household_id, user_id, display_name) values (h.id, auth.uid(), nullif(trim(p_display), ''));
  return h;
end $$;

-- Bli med i en husstand med invitasjonskoden.
create or replace function public.hl_join_household(p_code text, p_display text)
returns public.hl_households
language plpgsql security definer set search_path = public as $$
declare h hl_households;
begin
  if auth.uid() is null then raise exception 'Ikke logget inn'; end if;
  select * into h from hl_households where invite_code = upper(trim(p_code));
  if h.id is null then raise exception 'Ukjent kode'; end if;
  insert into hl_members (household_id, user_id, display_name) values (h.id, auth.uid(), nullif(trim(p_display), ''))
    on conflict (household_id, user_id) do update set display_name = excluded.display_name;
  return h;
end $$;

-- Rettigheter (nye Supabase-prosjekter gir ikke dette automatisk)
grant usage on schema public to authenticated;
grant select, update (name, ical_url) on public.hl_households to authenticated;
grant select, update (display_name), delete on public.hl_members to authenticated;
grant select, insert, update, delete on public.hl_items to authenticated;
grant execute on function public.hl_is_member(uuid) to authenticated;
grant execute on function public.hl_create_household(text, text) to authenticated;
grant execute on function public.hl_join_household(text, text) to authenticated;
revoke execute on function public.hl_create_household(text, text) from anon;
revoke execute on function public.hl_join_household(text, text) from anon;

-- Sanntid: endringer dukker opp på den andre telefonen med en gang
do $$ begin
  alter publication supabase_realtime add table public.hl_items;
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
