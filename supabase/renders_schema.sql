-- ============================================
-- 渲染圖記錄表 — 存使用者跑過的所有 AI 渲染
-- ============================================

create table if not exists renders (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  plan_id uuid references plans(id) on delete cascade,
  prompt text not null,
  style text,
  image_url text not null,                     -- Replicate 回傳的圖片 URL
  thumbnail_url text,                          -- 縮圖 (Sprint 4 加)
  cost_usd numeric,                            -- 預估花費
  status text not null default 'completed',
  created_at timestamptz not null default now()
);

create index if not exists renders_owner_idx on renders(owner);
create index if not exists renders_plan_idx on renders(plan_id);

alter table renders enable row level security;
create policy "owners read own renders"   on renders for select using (owner = auth.uid());
create policy "owners insert own renders" on renders for insert with check (owner = auth.uid());
create policy "owners delete own renders" on renders for delete using (owner = auth.uid());
