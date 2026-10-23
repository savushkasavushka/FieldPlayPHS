-- Таблица общего рейтинга для игры «Месторождение Х».
-- Выполнить один раз: Supabase → SQL Editor → New query → вставить → Run.

create table if not exists public.scores (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  player text not null check (char_length(player) between 2 and 24),
  scenario text not null check (char_length(scenario) <= 32),
  npv integer not null,
  oil_kt integer,
  kin real,
  capex integer,
  wells integer
);

create index if not exists scores_scenario_npv on public.scores (scenario, npv desc);

-- Публичный ключ (anon) может только читать и добавлять результаты, но не менять и не удалять их.
alter table public.scores enable row level security;
create policy "scores_read" on public.scores for select to anon using (true);
create policy "scores_insert" on public.scores for insert to anon with check (true);
