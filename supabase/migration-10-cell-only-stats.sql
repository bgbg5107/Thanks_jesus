-- migration-10: 관리자 셀 현황 — 셀만 집계 + 감사 횟수 내림차순
-- 나눔 공동체(kind='group')는 자유 모임이므로 관리자에게도
-- 현황을 노출하지 않는다 (프라이버시).

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
    where t.kind = 'cell'
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
  order by count(e.id) desc, mem.name
$$;
