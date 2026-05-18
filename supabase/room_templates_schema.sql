-- ============================================
-- 房間庫 — 使用者自訂的房型模板
-- 跟系統內建的 roomTemplates 共存:使用者可加自己的 + 從 AI 對話「一鍵存」
-- ============================================

create table if not exists room_templates (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  name text not null,                   -- 顯示名 (例:「總經理辦公室」)
  type text not null,                   -- 'office'|'meeting'|...|'custom'
  category text,                        -- '辦公'|'住宅'|...
  width_cm int not null default 400,
  depth_cm int not null default 300,
  height_cm int not null default 280,
  color text not null default '#e2e8f0',
  description text,                     -- 設計考量、特殊需求
  furniture jsonb default '[]'::jsonb,  -- 預設家具配置
  source text default 'manual',         -- 'manual'|'ai_chat'|'system'
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
create policy "owners read own templates"   on room_templates for select using (owner = auth.uid());
create policy "owners insert own templates" on room_templates for insert with check (owner = auth.uid());
create policy "owners update own templates" on room_templates for update using (owner = auth.uid());
create policy "owners delete own templates" on room_templates for delete using (owner = auth.uid());
