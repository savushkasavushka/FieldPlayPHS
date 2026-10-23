-- Таблица общего рейтинга для игры «Месторождение Х».
-- Выполнить: Supabase → SQL Editor → New query → вставить → Run. Скрипт можно запускать повторно.
-- ВАЖНО: перед запуском замените ЗАМЕНИТЕ_ПАРОЛЬ на свой пароль для очистки рейтинга
-- (и не сохраняйте файл с настоящим паролем в публичный репозиторий).

create table if not exists public.scores (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  player text not null check (char_length(player) between 2 and 24),
  scenario text not null check (char_length(scenario) <= 32),
  npv integer not null check (npv between -100000 and 1000000),
  oil_kt integer,
  kin real,
  capex integer,
  wells integer
);

-- Расстановка объектов игрока: по ней из рейтинга открывается его поле
alter table public.scores add column if not exists project jsonb;
alter table public.scores drop constraint if exists scores_project_size;
alter table public.scores add constraint scores_project_size check (project is null or pg_column_size(project) < 30000);

create index if not exists scores_scenario_npv on public.scores (scenario, npv desc);

-- Публичный ключ может только читать и добавлять результаты, но не менять и не удалять их.
alter table public.scores enable row level security;
drop policy if exists "scores_read" on public.scores;
drop policy if exists "scores_insert" on public.scores;
create policy "scores_read" on public.scores for select to anon using (true);
create policy "scores_insert" on public.scores for insert to anon with check (true);
grant select, insert on public.scores to anon;

-- Очистка рейтинга по паролю (кнопка в настройках игры). Пароль проверяется здесь, в базе.
create or replace function public.clear_scores(pin text) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if pin is distinct from 'ЗАМЕНИТЕ_ПАРОЛЬ' then
    raise exception 'wrong pin' using errcode = '28000';
  end if;
  delete from public.scores where true;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.clear_scores(text) from public;
grant execute on function public.clear_scores(text) to anon;

notify pgrst, 'reload schema';
