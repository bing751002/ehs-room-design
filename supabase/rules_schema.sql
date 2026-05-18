-- ============================================
-- 內部規則表 — 東森公司內部規則覆寫公規
-- ============================================

create table if not exists internal_rules (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  title text not null,                       -- 例:「東森酒店客房最低標準」
  category text,                              -- 例: '消防','無障礙','品牌','業態' 等
  content text not null,                      -- 規則本文 (純文字,AI 直接讀)
  attachments text[] not null default '{}',  -- 原始檔 URL (PDF/Word 等)
  is_active boolean not null default true,   -- 啟用中才會餵給 AI
  priority int not null default 5,            -- 1-10,越高越優先(覆寫公規)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists internal_rules_owner_idx on internal_rules(owner);
create index if not exists internal_rules_active_idx on internal_rules(is_active);

drop trigger if exists internal_rules_touch on internal_rules;
create trigger internal_rules_touch before update on internal_rules
  for each row execute function touch_updated_at();

alter table internal_rules enable row level security;
create policy "owners read own rules"   on internal_rules for select using (owner = auth.uid());
create policy "owners insert own rules" on internal_rules for insert with check (owner = auth.uid());
create policy "owners update own rules" on internal_rules for update using (owner = auth.uid());
create policy "owners delete own rules" on internal_rules for delete using (owner = auth.uid());
