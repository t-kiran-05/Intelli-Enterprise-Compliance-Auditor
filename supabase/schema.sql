-- Run once in the Supabase SQL editor.
-- The Lambda reads with the ANON key (RLS allows SELECT on active rows only).
-- Writes happen only from scripts/embed_regulations.py using the service-role key (bypasses RLS).

create extension if not exists vector;

create table if not exists public.compliance_requirements (
  id              text        not null,
  version         text        not null,
  framework       text        not null check (framework in ('gdpr','ccpa','soc2','iso27701')),
  payload         jsonb       not null,           -- the full requirement object from checklists.json
  active          boolean     not null default true,
  embedding       vector(768),                    -- optional; null unless seeded with --with-embeddings
  embedding_model text,                           -- vectors from different models are NOT comparable
  updated_at      timestamptz not null default now(),
  primary key (id, version)
);

alter table public.compliance_requirements enable row level security;

drop policy if exists "read active requirements" on public.compliance_requirements;
create policy "read active requirements"
  on public.compliance_requirements for select
  to anon, authenticated
  using (active = true);
-- No insert/update/delete policies: only the service role can write.

-- Optional semantic lookup (not used by the Lambda). Always filter by embedding model.
create or replace function public.match_compliance_requirements(
  query_embedding vector(768), model_filter text, match_count int default 5)
returns table (id text, framework text, payload jsonb, similarity double precision)
language sql stable as $$
  select id, framework, payload, 1 - (embedding <=> query_embedding)
  from public.compliance_requirements
  where active and embedding is not null and embedding_model = model_filter
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- Free-tier note: Supabase pauses idle free projects after ~7 days. The Lambda falls back to the
-- bundled checklists.json automatically, so audits keep working while the project is paused.
