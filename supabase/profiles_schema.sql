-- ============================================
-- profiles 表 + view — 給前端顯示「誰加的」用
-- 因為 auth.users 不能直接被前端 SELECT,需要一個 public 的對應表
-- ============================================

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);

-- 自動把現有 users 灌進來
insert into profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;

-- 註冊新使用者時自動建 profile
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
-- 任何登入使用者都能看 profiles (這是公開資料)
create policy "logged-in read profiles" on profiles for select using (auth.uid() is not null);
create policy "owners update own profile" on profiles for update using (id = auth.uid());
