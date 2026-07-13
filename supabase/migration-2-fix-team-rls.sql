-- ============================================================
-- 마이그레이션 2: 팀 RLS 무한 재귀 수정
-- teams 정책 ↔ team_members 정책이 서로를 참조해 조회가 실패하던 문제.
-- security definer 함수로 참조를 끊는다. SQL Editor에서 전체 Run 하세요.
-- ============================================================

create or replace function public.is_team_leader(t uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from public.teams where id = t and leader_id = auth.uid())
$$;

-- teams
drop policy if exists "teams select" on public.teams;
create policy "teams select" on public.teams for select to authenticated using (
  leader_id = auth.uid() or public.is_admin() or public.is_team_member(id)
);

-- team_members
drop policy if exists "members select" on public.team_members;
create policy "members select" on public.team_members for select to authenticated using (
  user_id = auth.uid() or public.is_admin()
  or public.is_team_leader(team_id) or public.is_team_member(team_id)
);

drop policy if exists "members invite by leader" on public.team_members;
create policy "members invite by leader" on public.team_members for insert to authenticated
  with check (public.is_team_leader(team_id));

drop policy if exists "members update" on public.team_members;
create policy "members update" on public.team_members for update to authenticated using (
  user_id = auth.uid() or public.is_team_leader(team_id)
);

drop policy if exists "members delete" on public.team_members;
create policy "members delete" on public.team_members for delete to authenticated using (
  user_id = auth.uid() or public.is_team_leader(team_id)
);
