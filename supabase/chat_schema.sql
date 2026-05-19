-- ============================================
-- AI 對話歷史 — 每個方案一條完整對話
-- ============================================

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id) on delete cascade,
  owner uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  actions jsonb,             -- AI 套用到畫布的 plan-action 陣列
  is_verbose boolean default false,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_plan_idx on chat_messages(plan_id, created_at);
create index if not exists chat_messages_owner_idx on chat_messages(owner);

alter table chat_messages enable row level security;
create policy "owners read own chat" on chat_messages for select using (owner = auth.uid());
create policy "owners insert own chat" on chat_messages for insert with check (owner = auth.uid());
create policy "owners update own chat" on chat_messages for update using (owner = auth.uid());
create policy "owners delete own chat" on chat_messages for delete using (owner = auth.uid());
