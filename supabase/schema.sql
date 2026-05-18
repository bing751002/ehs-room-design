-- ============================================
-- 空間規劃-雲端版 v4  資料庫 schema
-- 到 Supabase Dashboard → SQL Editor → 貼上整段執行
-- ============================================

-- 1. 方案表 (一個方案 = 一個樓層 + 一組房間/家具配置)
create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  title text not null default '未命名方案',
  floor_label text,                       -- 例: "6F 三溫暖"
  -- 整個規劃資料用 JSON 存:房間、家具、走道、結構柱、評分結果
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists plans_owner_idx on plans(owner);
create index if not exists plans_updated_idx on plans(updated_at desc);

-- 2. 協作者表 (誰可以看/改某個方案)
create table if not exists plan_collaborators (
  plan_id uuid not null references plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('viewer','editor')),
  primary key (plan_id, user_id)
);

-- 3. updated_at 自動更新
create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists plans_touch on plans;
create trigger plans_touch before update on plans
  for each row execute function touch_updated_at();

-- ============================================
-- Row Level Security (RLS) — 沒設這個誰都能看到別人的方案
-- ============================================
alter table plans enable row level security;
alter table plan_collaborators enable row level security;

-- 自己的方案,自己看/改
create policy "owners read own plans"   on plans for select using (owner = auth.uid());
create policy "owners insert own plans" on plans for insert with check (owner = auth.uid());
create policy "owners update own plans" on plans for update using (owner = auth.uid());
create policy "owners delete own plans" on plans for delete using (owner = auth.uid());

-- 被加入協作的方案,可讀;editor 可改
create policy "collab read shared plans" on plans for select
  using (exists (select 1 from plan_collaborators c
                 where c.plan_id = plans.id and c.user_id = auth.uid()));

create policy "collab edit shared plans" on plans for update
  using (exists (select 1 from plan_collaborators c
                 where c.plan_id = plans.id and c.user_id = auth.uid() and c.role = 'editor'));

-- 協作者表 — 只有方案主可以管理
create policy "owner manages collaborators" on plan_collaborators for all
  using (exists (select 1 from plans p where p.id = plan_collaborators.plan_id and p.owner = auth.uid()));

-- ============================================
-- Realtime 設定 (讓多人即時同步房間拖拉)
-- ============================================
-- 在 Supabase Dashboard → Database → Replication → 開啟 plans 表的 realtime
-- 或執行: alter publication supabase_realtime add table plans;
