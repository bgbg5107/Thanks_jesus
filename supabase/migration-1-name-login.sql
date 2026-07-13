-- ============================================================
-- 마이그레이션 1: 이름(아이디) + 비밀번호 로그인
-- 이미 schema.sql을 실행한 프로젝트에서 이것만 추가로 Run 하세요.
-- ============================================================

-- profiles에 이메일 저장 (로그인 시 이름→이메일 변환용)
alter table public.profiles add column if not exists email text;

-- 기존 가입자 이메일 백필
update public.profiles p
set email = (select u.email from auth.users u where u.id = p.id)
where p.email is null;

-- 신규 가입 시 이메일도 함께 저장하도록 트리거 함수 갱신
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text := coalesce(new.raw_user_meta_data->>'name', '이름없음');
  v_count int;
  v_display text;
begin
  select count(*) into v_count from public.profiles where name = v_name;
  if v_count = 0 then
    v_display := v_name;
  else
    if v_count = 1 then
      update public.profiles set display_id = name || 'A'
      where name = v_name and display_id = v_name;
    end if;
    v_display := v_name || chr(65 + v_count);   -- B, C, D ...
  end if;
  insert into public.profiles (id, name, display_id, email)
  values (new.id, v_name, v_display, new.email);
  return new;
end $$;

-- 로그인용: 아이디(이름) → 이메일 조회 (로그인 전이므로 anon 허용)
create or replace function public.email_for_login(p_display_id text)
returns text language sql security definer set search_path = public as $$
  select email from public.profiles where display_id = p_display_id
$$;
grant execute on function public.email_for_login(text) to anon, authenticated;
