create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('bug', 'feedback')),
  description text not null check (char_length(trim(description)) between 1 and 5000),
  attachment_path text,
  attachment_name text,
  attachment_type text check (
    attachment_type is null or attachment_type in ('image/jpeg', 'image/png', 'image/webp')
  ),
  created_at timestamptz not null default now(),
  check (
    (attachment_path is null and attachment_name is null and attachment_type is null)
    or (attachment_path is not null and attachment_name is not null and attachment_type is not null)
  )
);

alter table public.bug_reports enable row level security;
revoke all on public.bug_reports from anon, authenticated;
grant insert on public.bug_reports to authenticated;

drop policy if exists "Authenticated users can submit feedback" on public.bug_reports;
create policy "Authenticated users can submit feedback"
  on public.bug_reports
  for insert
  to authenticated
  with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bug-report-attachments',
  'bug-report-attachments',
  false,
  4194304,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can upload own feedback attachments" on storage.objects;
create policy "Users can upload own feedback attachments"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'bug-report-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
