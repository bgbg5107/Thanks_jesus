-- migration-14-admin-tools.sql
-- 관리자 사용자 삭제 RPC + 관리자가 보낸 알림 조회 정책

-- 관리자가 사용자 계정을 영구 삭제 (FK cascade로 전체 데이터 삭제)
create or replace function public.admin_delete_user(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception '관리자 권한이 필요합니다';
  end if;
  if p_user_id = auth.uid() then
    raise exception '자신의 계정은 삭제할 수 없습니다';
  end if;
  if exists (select 1 from public.profiles where id = p_user_id and is_admin = true) then
    raise exception '관리자 계정은 삭제할 수 없습니다';
  end if;
  delete from auth.users where id = p_user_id;  -- FK cascade
end $$;

-- 관리자가 보낸 알림(type='admin') 조회 허용 (알림 이력 확인용)
create policy "notif select admin" on public.notifications
  for select to authenticated
  using (public.is_admin() and type = 'admin');
