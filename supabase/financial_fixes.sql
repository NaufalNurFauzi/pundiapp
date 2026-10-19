begin;

alter table public.transactions
  add column if not exists goal_id text;

alter table public.profiles
  drop column if exists security_question,
  drop column if exists security_answer;

create or replace function public.replace_my_financial_data(
  p_profile jsonb,
  p_transactions jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  transaction_count integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;
  if coalesce(jsonb_typeof(p_profile), '') <> 'object'
     or coalesce(jsonb_typeof(p_transactions), '') <> 'array' then
    raise exception 'Invalid financial data format.';
  end if;
  if jsonb_array_length(p_transactions) > 10000 then
    raise exception 'Too many transactions in import.';
  end if;

  select count(*) into transaction_count
  from jsonb_to_recordset(p_transactions) as imported(
    id text,
    date date,
    type text,
    amount numeric
  )
  where imported.id is null
     or imported.date is null
     or imported.date > current_date + 1
     or imported.type is null
     or imported.type not in ('expense', 'topup', 'withdraw', 'asset_topup', 'asset_opening')
     or imported.amount is null
     or imported.amount <= 0
     or imported.amount > 1000000000000;
  if transaction_count > 0 then
    raise exception 'Imported transactions contain invalid values.';
  end if;

  update public.profiles
  set name = coalesce(p_profile->>'name', ''),
      age = nullif(p_profile->>'age', '')::integer,
      income = nullif(p_profile->>'income', '')::numeric,
      monthly_incomes = coalesce(p_profile->'monthly_incomes', '{}'::jsonb),
      monthly_income_prompt_dismissed = coalesce(p_profile->'monthly_income_prompt_dismissed', '{}'::jsonb),
      strategy_mode = p_profile->>'strategy_mode',
      categories = coalesce(p_profile->'categories', '[]'::jsonb),
      recurring = coalesce(p_profile->'recurring', '[]'::jsonb),
      goals = coalesce(p_profile->'goals', '[]'::jsonb),
      confirmed = coalesce((p_profile->>'confirmed')::boolean, false),
      stage = coalesce(p_profile->>'stage', 'onboarding'),
      pay_day = least(31, greatest(1, coalesce(
        nullif(p_profile->'monthly_incomes'->>'__pundi_pay_day', '')::integer,
        1
      )))
  where id = current_user_id;

  if not found then
    raise exception 'Account profile not found.';
  end if;

  delete from public.transactions where user_id = current_user_id;

  insert into public.transactions (
    id, user_id, date, type, category_id, sub_id, note, amount, direct_asset, goal_id
  )
  select
    imported.id,
    current_user_id,
    imported.date,
    imported.type,
    imported.category_id,
    imported.sub_id,
    imported.note,
    imported.amount,
    coalesce(imported.direct_asset, false),
    imported.goal_id
  from jsonb_to_recordset(p_transactions) as imported(
    id text,
    date date,
    type text,
    category_id text,
    sub_id text,
    note text,
    amount numeric,
    direct_asset boolean,
    goal_id text
  );
end;
$$;

revoke all on function public.replace_my_financial_data(jsonb, jsonb) from public, anon;
grant execute on function public.replace_my_financial_data(jsonb, jsonb) to authenticated;

commit;
