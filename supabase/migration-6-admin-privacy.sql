-- ============================================================
-- 마이그레이션 6: 관리자 열람 범위 제한
-- 관리자도 일반 사용자와 동일하게 '자신에게 나눠진 기록'만 볼 수 있다.
-- 단, 신고가 접수된 게시물은 신고 처리를 위해 예외적으로 열람 가능.
-- ============================================================

drop policy if exists "entries select" on public.entries;
create policy "entries select" on public.entries for select to authenticated using (
  user_id = auth.uid()
  or (
    not public.is_blocked_between(auth.uid(), user_id)
    and (
      (visibility = 'team' and exists (
        select 1 from unnest(shared_team_ids) as t where public.is_team_member(t)
      ))
      or (visibility = 'users' and auth.uid() = any(shared_user_ids))
    )
  )
  -- 관리자는 신고된 게시물만 열람 (신고 처리 목적)
  or (public.is_admin() and exists (
    select 1 from public.reports r where r.entry_id = entries.id
  ))
);
