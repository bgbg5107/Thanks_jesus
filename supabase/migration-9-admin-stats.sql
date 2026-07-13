-- ============================================================
-- 마이그레이션 9: 관리자용 공동체 감사 현황 (기간 선택)
-- 관리자만 호출 가능. 기록 '횟수'만 집계하며 내용은 조회하지 않는다.
-- ============================================================

create or replace function public.admin_team_stats(p_from date, p_to date)
returns table (team_id uuid, name text, kind text, member_count bigint, entry_count bigint, active_members bigint)
language sql security definer set search_path = public as $$
  with members as (
    select t.id as tid, t.name, t.kind, m.user_id
    from public.teams t
    join (
      select team_id, user_id from public.team_members where status = 'accepted'
      union
      select id, leader_id from public.teams
    ) m on m.team_id = t.id
  )
  select mem.tid, mem.name, mem.kind,
         count(distinct mem.user_id),
         count(e.id),
         count(distinct e.user_id)
  from members mem
  left join public.entries e
    on e.user_id = mem.user_id and e.date between p_from and p_to
  where public.is_admin()
  group by mem.tid, mem.name, mem.kind
  order by mem.kind, count(e.id) desc
$$;
