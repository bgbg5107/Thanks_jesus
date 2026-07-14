-- migration-10: 하루 다중 감사 기록 허용
-- unique(user_id, date) 제약을 제거하여 같은 날 여러 기록 가능

-- 1. unique 제약 삭제
ALTER TABLE public.entries DROP CONSTRAINT IF EXISTS entries_user_id_date_key;

-- 2. 쿼리 성능을 위한 인덱스 (unique 제약이 만들던 인덱스 대체)
CREATE INDEX IF NOT EXISTS entries_user_date ON public.entries (user_id, date);

-- 3. team_week_activity: 같은 날 여러 기록 시 중복 날짜 방지
CREATE OR REPLACE FUNCTION public.team_week_activity(p_team_id uuid, p_from date, p_to date)
RETURNS TABLE (user_id uuid, display_id text, dates date[])
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.display_id,
         coalesce(array_agg(DISTINCT e.date ORDER BY e.date) FILTER (WHERE e.date IS NOT NULL), '{}')
  FROM (
    SELECT tm.user_id FROM public.team_members tm
    WHERE tm.team_id = p_team_id AND tm.status = 'accepted'
    UNION
    SELECT t.leader_id FROM public.teams t WHERE t.id = p_team_id
  ) m
  JOIN public.profiles p ON p.id = m.user_id
  LEFT JOIN public.entries e ON e.user_id = m.user_id AND e.date BETWEEN p_from AND p_to
  WHERE public.is_team_member(p_team_id)
  GROUP BY p.id, p.display_id
  ORDER BY p.display_id
$$;
