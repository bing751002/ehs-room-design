-- ════════════════════════════════════════════════════════════════════
-- 修復 plans / plan_collaborators RLS 互查遞迴
--
-- 用法:Supabase Dashboard → SQL Editor → New query → 整檔貼上 → Run
-- ════════════════════════════════════════════════════════════════════

-- 1. 刪掉互查的 policy
drop policy if exists "collab read shared plans"   on plans;
drop policy if exists "collab edit shared plans"   on plans;
drop policy if exists "owner manages collaborators" on plan_collaborators;

-- 2. 建 security definer function 繞過 RLS (切斷遞迴)
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

-- 3. 用 function 重建 policy (不再直接互查表)
create policy "collab read shared plans" on plans for select
  using (is_plan_collaborator(id, 'viewer'));

create policy "collab edit shared plans" on plans for update
  using (is_plan_collaborator(id, 'editor'));

create policy "owner manages collaborators" on plan_collaborators for all
  using (is_plan_owner(plan_id))
  with check (is_plan_owner(plan_id));
