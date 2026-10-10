-- audit_results table for the failover secondary server.
-- Run once in the Supabase SQL editor.
-- Only the service-role key (used by the FastAPI server and Next.js server-side code) can write.
-- Authenticated users can read only their own results via owner_id.

create table if not exists public.audit_results (
  document_id   text        primary key,
  owner_id      uuid        references auth.users(id),
  status        text        not null default 'AWAITING_UPLOAD'
                            check (status in ('AWAITING_UPLOAD','PENDING','PROCESSING','COMPLETED','FAILED')),
  result        jsonb,                           -- full audit result (backward-compatible shape)
  error         text,                            -- error message when status = FAILED
  backend       text        default 'server'     -- 'aws' or 'server', for traceability
                            check (backend in ('aws','server')),
  doc_type_hint text,                            -- privacy_notice | dpa | security_policy
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Enable RLS
alter table public.audit_results enable row level security;

-- Policy: authenticated users can SELECT only their own results
drop policy if exists "users read own results" on public.audit_results;
create policy "users read own results"
  on public.audit_results for select
  to authenticated
  using (owner_id = auth.uid());

-- No INSERT/UPDATE/DELETE policies for anon or authenticated:
-- only the service-role key (which bypasses RLS) can write.
-- This ensures the server is the sole writer.

-- Index for owner lookups
create index if not exists idx_audit_results_owner_id on public.audit_results (owner_id);

-- Index for status polling
create index if not exists idx_audit_results_status on public.audit_results (status)
  where status in ('PROCESSING', 'AWAITING_UPLOAD');

-- Create the private Storage bucket (run in dashboard or via API)
-- insert into storage.buckets (id, name, public) values ('audit-uploads', 'audit-uploads', false)
--   on conflict (id) do nothing;
