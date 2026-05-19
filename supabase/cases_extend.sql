-- ============================================
-- reference_cases 擴充:加圖類型 / 圖紙時期 / 風格標籤
-- 給 AI 判斷「這是新圖、舊圖、純參考圖」
-- ============================================

alter table reference_cases
  add column if not exists doc_type text,        -- 'reference'|'construction'|'as_built'|'concept'|'inspiration'|'existing'|'demolition'
  add column if not exists era text,             -- 'current'|'historical'|'planned'|'reference'
  add column if not exists project text,         -- 案場名稱,例: "林口 6F 三溫暖"
  add column if not exists year int,             -- 完工/設計年份
  add column if not exists style_tags text[] default '{}',  -- ['日式','禪意','五星']
  add column if not exists ai_summary text,      -- AI Vision 自動生成的描述
  add column if not exists ai_extracted_tags text[] default '{}',  -- AI 自動抽出的標籤
  add column if not exists thumbnail_url text;   -- 縮圖 URL

create index if not exists reference_cases_doc_type_idx on reference_cases(doc_type);
create index if not exists reference_cases_era_idx on reference_cases(era);
create index if not exists reference_cases_year_idx on reference_cases(year);
