-- ============================================
-- Agent 對話歷史 — 給「審圖 Agent」與「設計評估 Agent」用
-- 不綁定 plan_id;以 thread_id + agent_type 分對話
-- 一個 thread = 一次審查 (例如「2026-05-20 某設計師-台中店平面圖」)
-- ============================================

create table if not exists agent_chats (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  agent_type text not null check (agent_type in ('audit', 'critique')),
  thread_id uuid not null,
  thread_title text,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  attachments jsonb,    -- [{filename, signed_url, mime_type, size}]
  metadata jsonb,       -- 評分結果 (scores)、citations 等
  created_at timestamptz not null default now()
);

create index if not exists agent_chats_owner_idx on agent_chats(owner, agent_type, created_at desc);
create index if not exists agent_chats_thread_idx on agent_chats(thread_id, created_at);

alter table agent_chats enable row level security;
create policy "owners read own agent chat" on agent_chats for select using (owner = auth.uid());
create policy "owners insert own agent chat" on agent_chats for insert with check (owner = auth.uid());
create policy "owners update own agent chat" on agent_chats for update using (owner = auth.uid());
create policy "owners delete own agent chat" on agent_chats for delete using (owner = auth.uid());

-- ============================================
-- thread 摘要 view (列表頁用):每個 thread 的標題、最後時間、訊息數
-- ============================================
create or replace view agent_chat_threads as
select
  thread_id,
  agent_type,
  owner,
  max(thread_title) filter (where thread_title is not null) as thread_title,
  min(created_at) as created_at,
  max(created_at) as last_msg_at,
  count(*) as msg_count
from agent_chats
group by thread_id, agent_type, owner;
