create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  email text not null,
  name text not null default '',
  age integer,
  income numeric,
  monthly_incomes jsonb not null default '{}'::jsonb,
  strategy_mode text,
  categories jsonb not null default '[]'::jsonb,
  recurring jsonb not null default '[]'::jsonb,
  goals jsonb not null default '[]'::jsonb,
  confirmed boolean not null default false,
  stage text not null default 'onboarding',
  security_question text,
  security_answer text,
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  type text not null default 'expense',
  category_id text,
  sub_id text,
  note text,
  amount numeric not null check (amount >= 0),
  direct_asset boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.transactions add column if not exists direct_asset boolean not null default false;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, email, security_question, security_answer)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data->>'securityQuestion',
    new.raw_user_meta_data->>'securityAnswer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.is_username_available(candidate text)
returns boolean
language sql
security definer set search_path = public
as $$
  select nullif(trim(candidate), '') is not null
    and not exists (
      select 1
      from public.profiles
      where lower(username) = lower(trim(candidate))
    );
$$;

revoke all on function public.is_username_available(text) from public;
grant execute on function public.is_username_available(text) to anon, authenticated;

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

alter table public.profiles enable row level security;
alter table public.transactions enable row level security;

drop policy if exists "Users can read their profile" on public.profiles;
create policy "Users can read their profile"
  on public.profiles for select using (auth.uid() = id);
drop policy if exists "Users can insert their profile" on public.profiles;
create policy "Users can insert their profile"
  on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "Users can update their profile" on public.profiles;
create policy "Users can update their profile"
  on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "Users can delete their profile" on public.profiles;
create policy "Users can delete their profile"
  on public.profiles for delete using (auth.uid() = id);

drop policy if exists "Users can read their transactions" on public.transactions;
create policy "Users can read their transactions"
  on public.transactions for select using (auth.uid() = user_id);
drop policy if exists "Users can insert their transactions" on public.transactions;
create policy "Users can insert their transactions"
  on public.transactions for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update their transactions" on public.transactions;
create policy "Users can update their transactions"
  on public.transactions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users can delete their transactions" on public.transactions;
create policy "Users can delete their transactions"
  on public.transactions for delete using (auth.uid() = user_id);
