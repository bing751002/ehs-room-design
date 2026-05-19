-- ============================================
-- 法規庫 — 政府公規 (建築技術規則、消防、無障礙等)
-- 跟 internal_rules (東森內部規定) 並存,但內容通常是整本 PDF 全文
-- ============================================

create table if not exists regulations (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  title text not null,               -- 例: "建築技術規則建築設計施工編"
  authority text,                    -- 主管機關: 內政部、消防署、勞動部...
  category text,                     -- '建築'|'消防'|'無障礙'|'勞安'|'環保'|'室內裝修'|'業態(SPA/餐飲...)'
  version text,                      -- 法規版本/修訂日期 (例: '2024-08-15')
  effective_date date,               -- 生效日
  source_url text,                   -- 原始來源連結
  content text not null,             -- 全文 (供 AI RAG 用)
  summary text,                      -- 精簡摘要 (給 AI 列表參考)
  applies_to_space_types text[] default '{}',  -- 適用空間類型
  attachments text[] default '{}',   -- 原始 PDF/檔案 URL
  is_active boolean default true,
  priority int default 5,            -- 優先度 (公規通常都 5,內裝規定可調 7)
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
-- 團隊共享 (跟 rules/cases/templates 同政策)
create policy "all read regs"     on regulations for select using (auth.uid() is not null);
create policy "all insert regs"   on regulations for insert with check (owner = auth.uid());
create policy "owners update regs" on regulations for update using (owner = auth.uid());
create policy "owners delete regs" on regulations for delete using (owner = auth.uid());
