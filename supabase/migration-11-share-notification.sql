-- Migration 11: 감사 공유 알림
-- 기록이 팀/공동체에 처음 공유될 때, 해당 팀 멤버들에게 알림을 발송한다.
-- "오늘 첫 공유" 기준: 같은 user_id + team_id + date 조합의 entry_shared 알림이 없을 때만 발송.

create or replace function public.notify_entry_shared()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_team_id  uuid;
  v_member_id uuid;
  v_display_id text;
  v_new_teams  uuid[];
begin
  -- 공유 상태가 아니거나 팀이 없으면 무시
  if NEW.visibility != 'team' or coalesce(array_length(NEW.shared_team_ids, 1), 0) = 0 then
    return NEW;
  end if;

  -- UPDATE: 이전에도 'team'이었으면 새로 추가된 팀만 처리
  if TG_OP = 'UPDATE' and OLD.visibility = 'team' then
    select array_agg(t) into v_new_teams
    from unnest(NEW.shared_team_ids) t
    where not (t = any(coalesce(OLD.shared_team_ids, '{}'::uuid[])));
  else
    v_new_teams := NEW.shared_team_ids;
  end if;

  -- 새 팀이 없으면 종료
  if coalesce(array_length(v_new_teams, 1), 0) = 0 then
    return NEW;
  end if;

  -- 작성자 이름
  select display_id into v_display_id from public.profiles where id = NEW.user_id;

  -- 각 새 팀에 대해
  foreach v_team_id in array v_new_teams loop
    -- 오늘 이 팀에 이미 알림을 보낸 적 있으면 스킵 (중복 방지)
    if exists (
      select 1 from public.notifications
      where type = 'entry_shared'
        and (payload->>'sender_id')::uuid = NEW.user_id
        and (payload->>'team_id')::uuid = v_team_id
        and payload->>'date' = NEW.date::text
    ) then
      continue;
    end if;

    -- 팀 멤버 + 팀장에게 알림 발송 (본인 제외, 차단 관계 제외)
    for v_member_id in
      select tm.user_id from public.team_members tm
      where tm.team_id = v_team_id and tm.status = 'accepted' and tm.user_id != NEW.user_id
      union
      select t.leader_id from public.teams t
      where t.id = v_team_id and t.leader_id != NEW.user_id
    loop
      if public.is_blocked_between(NEW.user_id, v_member_id) then
        continue;
      end if;
      insert into public.notifications (user_id, type, payload)
      values (v_member_id, 'entry_shared', jsonb_build_object(
        'sender_id',   NEW.user_id::text,
        'sender_name', v_display_id,
        'team_id',     v_team_id::text,
        'date',        NEW.date::text,
        'entry_id',    NEW.id::text
      ));
    end loop;
  end loop;

  return NEW;
end $$;

create trigger on_entry_shared
  after insert or update on public.entries
  for each row execute function public.notify_entry_shared();
