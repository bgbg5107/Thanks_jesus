-- ============================================================
-- 마이그레이션 3: 여러 셀에 동시 나눔
-- entries.shared_team_id(단일) → shared_team_ids(배열).
-- SQL Editor에서 전체 Run 하세요.
-- ============================================================

alter table public.entries add column if not exists shared_team_ids uuid[] not null default '{}';

-- 기존 단일 공유 데이터 이관
update public.entries
set shared_team_ids = array[shared_team_id]
where shared_team_id is not null and shared_team_ids = '{}';

-- 조회 정책 갱신 (배열 중 하나라도 내가 속한 셀이면 노출)
drop policy if exists "entries select" on public.entries;
create policy "entries select" on public.entries for select to authenticated using (
  user_id = auth.uid()
  or public.is_admin()
  or (
    not public.is_blocked_between(auth.uid(), user_id)
    and (
      (visibility = 'team' and exists (
        select 1 from unnest(shared_team_ids) as t where public.is_team_member(t)
      ))
      or (visibility = 'users' and auth.uid() = any(shared_user_ids))
    )
  )
);

-- 이전 컬럼 제거
alter table public.entries drop column if exists shared_team_id;
