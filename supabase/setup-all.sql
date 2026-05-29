-- ════════════════════════════════════════════════════════════════════
-- 東森空間規劃實驗室 — 一鍵 setup SQL (合併 10 個 schema 檔)
--
-- 用法:
--   1. 到 https://supabase.com/dashboard 建新 project (Region: Tokyo / Singapore)
--   2. 等專案綠燈亮起 (約 2-3 分鐘)
--   3. 左側選單 → SQL Editor → New query
--   4. 整個檔複製貼上 → Run
--   5. 看到 "Success. No rows returned" 就完成
--
-- 內含:
--   ✓ 10 張 table + RLS policy
--   ✓ touch_updated_at trigger function (共用)
--   ✓ handle_new_user trigger (註冊時自動建 profile)
--   ✓ plan-assets storage bucket + policy (底圖上傳用)
--   ✓ Realtime publication (plans 表多人同步)
--
-- 不含 (要在 Dashboard UI 手動做):
--   ✗ Site URL / Redirect URL 白名單 → Authentication → URL Configuration
--      加 http://localhost:5173 (本機) 跟你 deploy 的網址
-- ════════════════════════════════════════════════════════════════════


-- ─── 1. 核心:plans + plan_collaborators + touch_updated_at ──────────
create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  title text not null default '未命名方案',
  floor_label text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists plans_owner_idx on plans(owner);
create index if not exists plans_updated_idx on plans(updated_at desc);

create table if not exists plan_collaborators (
  plan_id uuid not null references plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('viewer','editor')),
  primary key (plan_id, user_id)
);

create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists plans_touch on plans;
create trigger plans_touch before update on plans
  for each row execute function touch_updated_at();

alter table plans enable row level security;
alter table plan_collaborators enable row level security;

drop policy if exists "owners read own plans"   on plans;
drop policy if exists "owners insert own plans" on plans;
drop policy if exists "owners update own plans" on plans;
drop policy if exists "owners delete own plans" on plans;
drop policy if exists "collab read shared plans" on plans;
drop policy if exists "collab edit shared plans" on plans;
drop policy if exists "owner manages collaborators" on plan_collaborators;

create policy "owners read own plans"   on plans for select using (owner = auth.uid());
create policy "owners insert own plans" on plans for insert with check (owner = auth.uid());
create policy "owners update own plans" on plans for update using (owner = auth.uid());
create policy "owners delete own plans" on plans for delete using (owner = auth.uid());

-- 用 security definer function 包查詢,避免 plans ⇄ plan_collaborators
-- 兩張表 policy 互查造成 infinite recursion
create or replace function is_plan_owner(plan_id_in uuid) returns boolean
  language sql security definer stable
  as $$
    select exists (select 1 from plans where id = plan_id_in and owner = auth.uid());
  $$;

create or replace function is_plan_collaborator(plan_id_in uuid, min_role text default 'viewer')
  returns boolean
  language sql security definer stable
  as $$
    select exists (
      select 1 from plan_collaborators
      where plan_id = plan_id_in
        and user_id = auth.uid()
        and (min_role = 'viewer' or role = 'editor')
    );
  $$;

create policy "collab read shared plans" on plans for select
  using (is_plan_collaborator(id, 'viewer'));

create policy "collab edit shared plans" on plans for update
  using (is_plan_collaborator(id, 'editor'));

create policy "owner manages collaborators" on plan_collaborators for all
  using (is_plan_owner(plan_id))
  with check (is_plan_owner(plan_id));


-- ─── 2. profiles + auth user trigger ────────────────────────────────
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);

insert into profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;

create or replace function handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

alter table profiles enable row level security;
drop policy if exists "logged-in read profiles" on profiles;
drop policy if exists "owners update own profile" on profiles;
create policy "logged-in read profiles" on profiles for select using (auth.uid() is not null);
create policy "owners update own profile" on profiles for update using (id = auth.uid());


-- ─── 3. reference_cases + 擴充欄位 ──────────────────────────────────
create table if not exists reference_cases (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  title text not null,
  space_types text[] not null default '{}',
  tags text[] not null default '{}',
  area_ping numeric,
  description text,
  image_urls text[] not null default '{}',
  boss_notes text,
  what_worked text,
  what_failed text,
  source_plan_id uuid references plans(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table reference_cases
  add column if not exists doc_type text,
  add column if not exists era text,
  add column if not exists project text,
  add column if not exists year int,
  add column if not exists style_tags text[] default '{}',
  add column if not exists ai_summary text,
  add column if not exists ai_extracted_tags text[] default '{}',
  add column if not exists thumbnail_url text;

create index if not exists reference_cases_owner_idx on reference_cases(owner);
create index if not exists reference_cases_types_idx on reference_cases using gin(space_types);
create index if not exists reference_cases_tags_idx  on reference_cases using gin(tags);
create index if not exists reference_cases_doc_type_idx on reference_cases(doc_type);
create index if not exists reference_cases_era_idx on reference_cases(era);
create index if not exists reference_cases_year_idx on reference_cases(year);

drop trigger if exists reference_cases_touch on reference_cases;
create trigger reference_cases_touch before update on reference_cases
  for each row execute function touch_updated_at();

alter table reference_cases enable row level security;
drop policy if exists "owners read own cases"   on reference_cases;
drop policy if exists "owners insert own cases" on reference_cases;
drop policy if exists "owners update own cases" on reference_cases;
drop policy if exists "owners delete own cases" on reference_cases;
create policy "owners read own cases"   on reference_cases for select using (owner = auth.uid());
create policy "owners insert own cases" on reference_cases for insert with check (owner = auth.uid());
create policy "owners update own cases" on reference_cases for update using (owner = auth.uid());
create policy "owners delete own cases" on reference_cases for delete using (owner = auth.uid());


-- ─── 4. internal_rules (內部規則) ────────────────────────────────────
create table if not exists internal_rules (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  title text not null,
  category text,
  content text not null,
  attachments text[] not null default '{}',
  is_active boolean not null default true,
  priority int not null default 5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists internal_rules_owner_idx on internal_rules(owner);
create index if not exists internal_rules_active_idx on internal_rules(is_active);

drop trigger if exists internal_rules_touch on internal_rules;
create trigger internal_rules_touch before update on internal_rules
  for each row execute function touch_updated_at();

alter table internal_rules enable row level security;
drop policy if exists "owners read own rules"   on internal_rules;
drop policy if exists "owners insert own rules" on internal_rules;
drop policy if exists "owners update own rules" on internal_rules;
drop policy if exists "owners delete own rules" on internal_rules;
create policy "owners read own rules"   on internal_rules for select using (owner = auth.uid());
create policy "owners insert own rules" on internal_rules for insert with check (owner = auth.uid());
create policy "owners update own rules" on internal_rules for update using (owner = auth.uid());
create policy "owners delete own rules" on internal_rules for delete using (owner = auth.uid());


-- ─── 5. renders (AI 渲染圖記錄) ──────────────────────────────────────
create table if not exists renders (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  plan_id uuid references plans(id) on delete cascade,
  prompt text not null,
  style text,
  image_url text not null,
  thumbnail_url text,
  cost_usd numeric,
  status text not null default 'completed',
  created_at timestamptz not null default now()
);

create index if not exists renders_owner_idx on renders(owner);
create index if not exists renders_plan_idx on renders(plan_id);

alter table renders enable row level security;
drop policy if exists "owners read own renders"   on renders;
drop policy if exists "owners insert own renders" on renders;
drop policy if exists "owners delete own renders" on renders;
create policy "owners read own renders"   on renders for select using (owner = auth.uid());
create policy "owners insert own renders" on renders for insert with check (owner = auth.uid());
create policy "owners delete own renders" on renders for delete using (owner = auth.uid());


-- ─── 6. room_templates (使用者自訂房型) ──────────────────────────────
create table if not exists room_templates (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null,
  category text,
  width_cm int not null default 400,
  depth_cm int not null default 300,
  height_cm int not null default 280,
  color text not null default '#e2e8f0',
  description text,
  furniture jsonb default '[]'::jsonb,
  source text default 'manual',
  is_favorite boolean default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists room_templates_owner_idx on room_templates(owner);
create index if not exists room_templates_category_idx on room_templates(category);

drop trigger if exists room_templates_touch on room_templates;
create trigger room_templates_touch before update on room_templates
  for each row execute function touch_updated_at();

alter table room_templates enable row level security;
drop policy if exists "owners read own templates"   on room_templates;
drop policy if exists "owners insert own templates" on room_templates;
drop policy if exists "owners update own templates" on room_templates;
drop policy if exists "owners delete own templates" on room_templates;
create policy "owners read own templates"   on room_templates for select using (owner = auth.uid());
create policy "owners insert own templates" on room_templates for insert with check (owner = auth.uid());
create policy "owners update own templates" on room_templates for update using (owner = auth.uid());
create policy "owners delete own templates" on room_templates for delete using (owner = auth.uid());


-- ─── 7. chat_messages (AI 對話歷史) ─────────────────────────────────
create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id) on delete cascade,
  owner uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  actions jsonb,
  is_verbose boolean default false,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_plan_idx on chat_messages(plan_id, created_at);
create index if not exists chat_messages_owner_idx on chat_messages(owner);

alter table chat_messages enable row level security;
drop policy if exists "owners read own chat" on chat_messages;
drop policy if exists "owners insert own chat" on chat_messages;
drop policy if exists "owners update own chat" on chat_messages;
drop policy if exists "owners delete own chat" on chat_messages;
create policy "owners read own chat" on chat_messages for select using (owner = auth.uid());
create policy "owners insert own chat" on chat_messages for insert with check (owner = auth.uid());
create policy "owners update own chat" on chat_messages for update using (owner = auth.uid());
create policy "owners delete own chat" on chat_messages for delete using (owner = auth.uid());


-- ─── 8. agent_chats (審圖/評圖 Agent 對話) + view ───────────────────
create table if not exists agent_chats (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  agent_type text not null check (agent_type in ('audit', 'critique')),
  thread_id uuid not null,
  thread_title text,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  attachments jsonb,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists agent_chats_owner_idx on agent_chats(owner, agent_type, created_at desc);
create index if not exists agent_chats_thread_idx on agent_chats(thread_id, created_at);

alter table agent_chats enable row level security;
drop policy if exists "owners read own agent chat" on agent_chats;
drop policy if exists "owners insert own agent chat" on agent_chats;
drop policy if exists "owners update own agent chat" on agent_chats;
drop policy if exists "owners delete own agent chat" on agent_chats;
create policy "owners read own agent chat" on agent_chats for select using (owner = auth.uid());
create policy "owners insert own agent chat" on agent_chats for insert with check (owner = auth.uid());
create policy "owners update own agent chat" on agent_chats for update using (owner = auth.uid());
create policy "owners delete own agent chat" on agent_chats for delete using (owner = auth.uid());

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


-- ─── 9. regulations (政府公規法規庫) ──────────────────────────────────
create table if not exists regulations (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  title text not null,
  authority text,
  category text,
  version text,
  effective_date date,
  source_url text,
  content text not null,
  summary text,
  applies_to_space_types text[] default '{}',
  attachments text[] default '{}',
  is_active boolean default true,
  priority int default 5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists regulations_category_idx on regulations(category);
create index if not exists regulations_active_idx on regulations(is_active);
create index if not exists regulations_authority_idx on regulations(authority);

drop trigger if exists regulations_touch on regulations;
create trigger regulations_touch before update on regulations
  for each row execute function touch_updated_at();

alter table regulations enable row level security;
drop policy if exists "all read regs"     on regulations;
drop policy if exists "all insert regs"   on regulations;
drop policy if exists "owners update regs" on regulations;
drop policy if exists "owners delete regs" on regulations;
create policy "all read regs"     on regulations for select using (auth.uid() is not null);
create policy "all insert regs"   on regulations for insert with check (owner = auth.uid());
create policy "owners update regs" on regulations for update using (owner = auth.uid());
create policy "owners delete regs" on regulations for delete using (owner = auth.uid());


-- ─── 10. Storage bucket:plan-assets (底圖上傳) ──────────────────────
insert into storage.buckets (id, name, public)
values ('plan-assets', 'plan-assets', true)
on conflict (id) do nothing;

drop policy if exists "auth users upload plan-assets" on storage.objects;
drop policy if exists "public read plan-assets"       on storage.objects;
drop policy if exists "auth users update own plan-assets" on storage.objects;
drop policy if exists "auth users delete own plan-assets" on storage.objects;

create policy "auth users upload plan-assets" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'plan-assets');

create policy "public read plan-assets" on storage.objects
  for select to public
  using (bucket_id = 'plan-assets');

create policy "auth users update own plan-assets" on storage.objects
  for update to authenticated
  using (bucket_id = 'plan-assets' and owner = auth.uid());

create policy "auth users delete own plan-assets" on storage.objects
  for delete to authenticated
  using (bucket_id = 'plan-assets' and owner = auth.uid());


-- ─── 11. Realtime publication (多人同步 plans 表) ───────────────────
do $$
begin
  alter publication supabase_realtime add table plans;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;


-- ════════════════════════════════════════════════════════════════════
-- 完成!還有一件事要去 Dashboard UI 設:
--
-- Authentication → URL Configuration
--   - Site URL:        http://localhost:5173
--   - Redirect URLs:   http://localhost:5173/**
--                      (有 deploy Vercel 的話再加你的 vercel URL)
-- ════════════════════════════════════════════════════════════════════
