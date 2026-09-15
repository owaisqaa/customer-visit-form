-- Run this entire file in the Supabase SQL Editor for project nflrbopsqpjqabnhwstb.
-- First create and confirm your shared login under Authentication > Users.
-- Replace YOUR_LOGIN_EMAIL below inside the SQL Editor only. Keep the quotes.
-- Do not commit the filled-in email to GitHub.
-- No passwords or service-role keys belong in this file or the website.
begin;

create table if not exists public.visit_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.visit_accounts enable row level security;
revoke all on public.visit_accounts from anon, authenticated;
grant select on public.visit_accounts to authenticated;
drop policy if exists "Read own visit access" on public.visit_accounts;
create policy "Read own visit access" on public.visit_accounts for select to authenticated
  using (user_id = (select auth.uid()));

do $$
declare
  account_id uuid;
  login_email text := 'YOUR_LOGIN_EMAIL';
begin
  if login_email = 'YOUR_' || 'LOGIN_EMAIL' then
    raise exception 'Replace the login email placeholder in the SQL Editor, then run this file again.';
  end if;
  select id into account_id from auth.users
    where lower(email) = lower(trim(login_email)) and email_confirmed_at is not null;
  if account_id is null then
    raise exception 'Create and confirm your login email in Authentication > Users, then run this file again.';
  end if;
  insert into public.visit_accounts(user_id) values (account_id) on conflict do nothing;
end $$;

create table if not exists public.visits (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users(id),
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object' and not (answers ? 'photo')),
  visit_date date,
  photo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (photo_path is null or split_part(photo_path, '/', 1) = owner_id::text)
);
create index if not exists visits_visit_date_idx on public.visits(owner_id, visit_date);
create index if not exists visits_created_idx on public.visits(owner_id, created_at, id);
alter table public.visits enable row level security;
revoke all on public.visits from anon, authenticated;
grant select, insert, update, delete on public.visits to authenticated;
drop policy if exists "Shared account visits" on public.visits;
create policy "Shared account visits" on public.visits for all to authenticated
  using (owner_id = (select auth.uid()) and exists (select 1 from public.visit_accounts where user_id = (select auth.uid())))
  with check (owner_id = (select auth.uid()) and exists (select 1 from public.visit_accounts where user_id = (select auth.uid())));

create or replace function public.stamp_visit() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  new.visit_date := nullif(new.answers->>'date', '')::date;
  if TG_OP = 'UPDATE' then
    new.created_at := old.created_at;
    new.owner_id := old.owner_id;
  end if;
  return new;
end $$;
drop trigger if exists stamp_visit on public.visits;
create trigger stamp_visit before insert or update on public.visits
  for each row execute function public.stamp_visit();

create or replace function public.save_visit(
  p_id uuid, p_answers jsonb, p_photo_path text,
  p_expected_updated timestamptz default null, p_created timestamptz default null
) returns public.visits
language plpgsql security invoker set search_path = '' as $$
declare saved public.visits;
begin
  if p_expected_updated is null then
    insert into public.visits(id, answers, photo_path, created_at)
      values (p_id, p_answers, p_photo_path, coalesce(p_created, now()))
      on conflict (id) do nothing returning * into saved;
    if saved.id is not null then return saved; end if;
  else
    update public.visits set answers = p_answers, photo_path = p_photo_path
      where id = p_id and updated_at = p_expected_updated returning * into saved;
    if saved.id is not null then return saved; end if;
  end if;
  -- A retry after a lost response is safe when the same values already exist.
  select * into saved from public.visits
    where id = p_id and answers = p_answers and photo_path is not distinct from p_photo_path;
  if saved.id is not null then return saved; end if;
  raise exception 'VISIT_CONFLICT' using errcode = 'P0001';
end $$;
revoke all on function public.save_visit(uuid, jsonb, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.save_visit(uuid, jsonb, text, timestamptz, timestamptz) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('visit-photos', 'visit-photos', false, 10485760, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['image/jpeg'];
drop policy if exists "Visit photo read" on storage.objects;
create policy "Visit photo read" on storage.objects for select to authenticated
  using (bucket_id = 'visit-photos' and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (select 1 from public.visit_accounts where user_id = (select auth.uid())));
drop policy if exists "Visit photo upload" on storage.objects;
create policy "Visit photo upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'visit-photos' and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (select 1 from public.visit_accounts where user_id = (select auth.uid())));

notify pgrst, 'reload schema';
commit;
