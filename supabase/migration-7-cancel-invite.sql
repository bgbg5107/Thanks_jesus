-- ============================================================
-- 마이그레이션 7: 초대 조용히 거두기
-- 초대 중인 멤버를 내보내면 초대가 취소되고,
-- 초대한 지 1분 이내라면 상대방의 알림도 함께 회수된다.
-- ============================================================

create or replace function public.cancel_team_invite(p_team_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_invited_at timestamptz;
begin
  -- 팀장만 가능
  if not exists (select 1 from public.teams where id = p_team_id and leader_id = auth.uid()) then
    raise exception '권한이 없습니다';
  end if;

  select created_at into v_invited_at from public.team_members
  where team_id = p_team_id and user_id = p_user_id and status = 'invited';
  if v_invited_at is null then
    raise exception '초대 중인 멤버가 아닙니다';
  end if;

  delete from public.team_members where team_id = p_team_id and user_id = p_user_id;

  -- 초대 1분 이내 취소면, 아직 읽지 않은 초대 알림을 조용히 회수
  if now() - v_invited_at < interval '1 minute' then
    delete from public.notifications
    where user_id = p_user_id and type = 'team_invite'
      and payload->>'team_id' = p_team_id::text and read = false;
  end if;
end $$;
