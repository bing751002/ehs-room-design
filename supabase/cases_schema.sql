-- ============================================
-- 案例庫表 — 沉澱東森歷年規劃 Know-how
-- 到 Supabase SQL Editor 貼上整段執行
-- ============================================

create table if not exists reference_cases (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  title text not null,                       -- 例:「6F 五星級三溫暖」
  space_types text[] not null default '{}',  -- 例: ['sauna','locker','lounge']
  tags text[] not null default '{}',         -- 例: ['日式禪意','高端','男賓']
  area_ping numeric,                          -- 估算坪數
  -- 規劃內容 (圖檔 URL、AI 摘要、設計重點)
  description text,                          -- 文字敘述
  image_urls text[] not null default '{}',   -- 多張參考圖 (Supabase Storage 路徑)
  boss_notes text,                           -- 老闆說過的偏好/否決原因
  what_worked text,                          -- 事後檢討:做對的地方
  what_failed text,                          -- 事後檢討:踩到的雷
  source_plan_id uuid references plans(id) on delete set null,  -- 可選:從哪個 plan 衍生
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reference_cases_owner_idx on reference_cases(owner);
create index if not exists reference_cases_types_idx on reference_cases using gin(space_types);
create index if not exists reference_cases_tags_idx  on reference_cases using gin(tags);

drop trigger if exists reference_cases_touch on reference_cases;
create trigger reference_cases_touch before update on reference_cases
  for each row execute function touch_updated_at();

-- RLS
alter table reference_cases enable row level security;

create policy "owners read own cases"   on reference_cases for select using (owner = auth.uid());
create policy "owners insert own cases" on reference_cases for insert with check (owner = auth.uid());
create policy "owners update own cases" on reference_cases for update using (owner = auth.uid());
create policy "owners delete own cases" on reference_cases for delete using (owner = auth.uid());
