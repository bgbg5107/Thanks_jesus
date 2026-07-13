-- ============================================================
-- 마이그레이션 8: 우리 셀의 주간 감사 현황
-- 셀 멤버끼리 서로의 '기록한 날짜'만 볼 수 있다 (내용은 비공개 유지).
-- 호출자가 해당 셀의 멤버/리더가 아니면 아무것도 반환하지 않는다.
-- ============================================================

create or replace function public.team_week_activity(p_team_id uuid, p_from date, p_to date)
returns table (user_id uuid, display_id text, dates date[])
language sql security definer set search_path = public as $$
  select p.id, p.display_id,
         coalesce(array_agg(e.date order by e.date) filter (where e.date is not null), '{}')
  from (
    select tm.user_id from public.team_members tm
    where tm.team_id = p_team_id and tm.status = 'accepted'
    union
    select t.leader_id from public.teams t where t.id = p_team_id
  ) m
  join public.profiles p on p.id = m.user_id
  left join public.entries e on e.user_id = m.user_id and e.date between p_from and p_to
  where public.is_team_member(p_team_id)
  group by p.id, p.display_id
  order by p.display_id
$$;
