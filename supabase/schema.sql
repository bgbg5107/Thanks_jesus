-- ============================================================
-- 감사 기록 앱 · Supabase 스키마
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
-- ============================================================

-- ── 테이블 ──────────────────────────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  display_id text not null unique,          -- 실명 기반 ID (동명이인 시 A/B 접미사)
  email text,                                -- 로그인(아이디→이메일 변환)·재설정용
  status text not null default 'active' check (status in ('active','suspended')),
  is_admin boolean not null default false,
  is_cell_leader boolean not null default false,  -- 셀 생성 권한 (관리자가 지정)
  reminder_time text,                        -- 'HH:MM' 리마인드 시각 (없으면 비활성)
  avatar_url text,                           -- 프로필 사진 (photos 버킷 경로, 없으면 이름 첫 글자)
  created_at timestamptz not null default now()
);

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  contents jsonb not null default '[]',      -- 감사 항목 문자열 배열
  emotion text not null default '모르겠음',
  photos jsonb not null default '[]',        -- storage 경로 배열
  visibility text not null default 'private' check (visibility in ('private','team','users')),
  shared_team_ids uuid[] not null default '{}',
  shared_user_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
  -- 하루에 여러 기록 허용 (각 기록은 id로 식별, unique(user_id,date) 없음)
);
create index entries_user_date on public.entries (user_id, date);

-- 오늘의 메모 — 하루 여러 장, 감사와 별개의 자유 기록 (본인만 접근)
create table public.memos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  title text not null default '',
  subtitle text not null default '',
  content text not null default '',          -- 본문 (굵게·형광펜·인용·말씀 서식 포함)
  photos jsonb not null default '[]',        -- storage 경로 배열
  updated_at timestamptz not null default now()
);
create index memos_user_date on public.memos (user_id, date);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'group' check (kind in ('cell','group')),  -- cell: 교회 셀 / group: 나눔 공동체
  leader_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'invited' check (status in ('invited','accepted','rejected','removed')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table public.likes (
  entry_id uuid not null references public.entries(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (entry_id, user_id)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid references public.entries(id) on delete set null,
  reported_user_id uuid references public.profiles(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null,
  status text not null default 'open' check (status in ('open','warned','suspended','deleted','dismissed')),
  created_at timestamptz not null default now()
);

create table public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,                        -- team_invite / like / report / admin ...
  payload jsonb not null default '{}',
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.verses (
  id serial primary key,
  text text not null,
  reference text not null,
  category text
);

-- ── 실명 기반 ID 자동 생성 (동명이인 A/B 접미사) ─────────────
-- 첫 가입자는 이름 그대로, 동명이인 발생 시 기존 사용자는 'A',
-- 새 사용자는 'B', 'C'... 접미사를 자동 부여.

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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 계정 탈퇴 (모든 데이터 영구 삭제) ────────────────────────
create or replace function public.delete_account()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from auth.users where id = auth.uid();  -- FK cascade 로 전체 삭제
end $$;

-- ── 초대 조용히 거두기 ───────────────────────────────────────
-- 초대 중인 멤버를 내보내면 초대가 취소되고,
-- 초대한 지 1분 이내라면 상대방의 알림도 함께 회수된다.
create or replace function public.cancel_team_invite(p_team_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_invited_at timestamptz;
begin
  if not exists (select 1 from public.teams where id = p_team_id and leader_id = auth.uid()) then
    raise exception '권한이 없습니다';
  end if;
  select created_at into v_invited_at from public.team_members
  where team_id = p_team_id and user_id = p_user_id and status = 'invited';
  if v_invited_at is null then
    raise exception '초대 중인 멤버가 아닙니다';
  end if;
  delete from public.team_members where team_id = p_team_id and user_id = p_user_id;
  if now() - v_invited_at < interval '1 minute' then
    delete from public.notifications
    where user_id = p_user_id and type = 'team_invite'
      and payload->>'team_id' = p_team_id::text and read = false;
  end if;
end $$;

-- ── 우리 셀의 주간 감사 현황 ─────────────────────────────────
-- 셀 멤버끼리 서로의 '기록한 날짜'만 볼 수 있다 (내용은 비공개 유지).
create or replace function public.team_week_activity(p_team_id uuid, p_from date, p_to date)
returns table (user_id uuid, display_id text, dates date[])
language sql security definer set search_path = public as $$
  select p.id, p.display_id,
         coalesce(array_agg(distinct e.date order by e.date) filter (where e.date is not null), '{}')
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

-- ── 관리자용 셀 감사 현황 (기간 선택, 횟수만 집계) ────────────
-- 셀(kind='cell')만 집계한다. 나눔 공동체는 자유 모임이므로
-- 관리자에게도 현황을 노출하지 않는다 (프라이버시).
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

-- ── 헬퍼 ────────────────────────────────────────────────────
create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.can_lead_cell()
returns boolean language sql security definer set search_path = public as $$
  select coalesce(
    (select is_cell_leader or is_admin from public.profiles where id = auth.uid()),
    false
  )
$$;

create or replace function public.is_team_leader(t uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from public.teams where id = t and leader_id = auth.uid())
$$;

create or replace function public.is_team_member(t uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.team_members
    where team_id = t and user_id = auth.uid() and status = 'accepted'
  ) or exists (select 1 from public.teams where id = t and leader_id = auth.uid())
$$;

create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  )
$$;

-- ── RLS ─────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.entries enable row level security;
alter table public.memos enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.likes enable row level security;
alter table public.reports enable row level security;
alter table public.blocks enable row level security;
alter table public.notifications enable row level security;
alter table public.verses enable row level security;

-- profiles: 검색(초대)을 위해 로그인 사용자 전체 조회 허용, 수정은 본인/관리자
create policy "profiles select" on public.profiles for select to authenticated using (true);
create policy "profiles update own" on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin());

-- entries
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
create policy "entries insert own" on public.entries for insert to authenticated
  with check (user_id = auth.uid());
create policy "entries update own" on public.entries for update to authenticated
  using (user_id = auth.uid());
create policy "entries delete" on public.entries for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- memos: 철저히 본인만
create policy "memos select own" on public.memos for select to authenticated using (auth.uid() = user_id);
create policy "memos insert own" on public.memos for insert to authenticated with check (auth.uid() = user_id);
create policy "memos update own" on public.memos for update to authenticated using (auth.uid() = user_id);
create policy "memos delete own" on public.memos for delete to authenticated using (auth.uid() = user_id);

-- teams (주의: teams ↔ team_members 정책이 서로 테이블을 직접 참조하면
-- 무한 재귀가 발생하므로 반드시 security definer 헬퍼 함수만 사용할 것)
create policy "teams select" on public.teams for select to authenticated using (
  leader_id = auth.uid() or public.is_admin() or public.is_team_member(id)
);
create policy "teams insert" on public.teams for insert to authenticated
  with check (
    leader_id = auth.uid()
    and (kind = 'group' or public.can_lead_cell())  -- 셀은 셀리더만 생성
  );
create policy "teams update leader" on public.teams for update to authenticated
  using (leader_id = auth.uid());
create policy "teams delete leader" on public.teams for delete to authenticated
  using (leader_id = auth.uid() or public.is_admin());

-- team_members
create policy "members select" on public.team_members for select to authenticated using (
  user_id = auth.uid() or public.is_admin()
  or public.is_team_leader(team_id) or public.is_team_member(team_id)
);
create policy "members invite by leader" on public.team_members for insert to authenticated
  with check (public.is_team_leader(team_id));
create policy "members update" on public.team_members for update to authenticated using (
  user_id = auth.uid()                      -- 본인: 수락/거절
  or public.is_team_leader(team_id)         -- 팀장: 방출
);
create policy "members delete" on public.team_members for delete to authenticated using (
  user_id = auth.uid() or public.is_team_leader(team_id)
);

-- likes
create policy "likes select" on public.likes for select to authenticated using (true);
create policy "likes insert own" on public.likes for insert to authenticated with check (user_id = auth.uid());
create policy "likes delete own" on public.likes for delete to authenticated using (user_id = auth.uid());

-- reports: 작성은 본인, 열람/처리는 관리자
create policy "reports insert" on public.reports for insert to authenticated with check (reporter_id = auth.uid());
create policy "reports select" on public.reports for select to authenticated using (reporter_id = auth.uid() or public.is_admin());
create policy "reports update admin" on public.reports for update to authenticated using (public.is_admin());

-- blocks
create policy "blocks all own" on public.blocks for all to authenticated
  using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

-- notifications: 열람/읽음은 본인, 생성은 로그인 사용자(좋아요·초대 알림 발송용)
create policy "notif select own" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "notif select admin" on public.notifications for select to authenticated using (public.is_admin() and type = 'admin');
create policy "notif update own" on public.notifications for update to authenticated using (user_id = auth.uid());
create policy "notif insert" on public.notifications for insert to authenticated with check (true);
create policy "notif delete own" on public.notifications for delete to authenticated using (user_id = auth.uid());

-- verses: 모두 열람 가능
create policy "verses select" on public.verses for select to authenticated using (true);

-- ── 스토리지 (사진) ──────────────────────────────────────────
insert into storage.buckets (id, name, public) values ('photos', 'photos', true)
on conflict (id) do nothing;

create policy "photos upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos read" on storage.objects for select using (bucket_id = 'photos');

-- ── 감사 말씀 시드 (개역개정, 50구절) ────────────────────────
insert into public.verses (text, reference, category) values
('감사함으로 그의 문에 들어가며 찬송함으로 그의 궁정에 들어가서 그에게 감사하며 그의 이름을 송축할지어다', '시편 100:4', '감사'),
('범사에 감사하라 이것이 그리스도 예수 안에서 너희를 향하신 하나님의 뜻이니라', '데살로니가전서 5:18', '감사'),
('감사로 제사를 드리는 자가 나를 영화롭게 하나니 그의 행위를 옳게 하는 자에게 내가 하나님의 구원을 보이리라', '시편 50:23', '감사'),
('또 무엇을 하든지 말에나 일에나 다 주 예수의 이름으로 하고 그를 힘입어 하나님 아버지께 감사하라', '골로새서 3:17', '감사'),
('아무 것도 염려하지 말고 다만 모든 일에 기도와 간구로, 너희 구할 것을 감사함으로 하나님께 아뢰라', '빌립보서 4:6', '평안'),
('여호와께 감사하라 그는 선하시며 그 인자하심이 영원함이로다', '시편 107:1', '감사'),
('여호와께 감사하라 그는 선하시며 그의 인자하심이 영원함이로다', '시편 118:1', '감사'),
('여호와께 감사하라 그는 선하시며 그 인자하심이 영원함이로다', '시편 136:1', '감사'),
('그 안에 뿌리를 박으며 세움을 받아 교훈을 받은 대로 믿음에 굳게 서서 감사함을 넘치게 하라', '골로새서 2:7', '감사'),
('그리스도의 평강이 너희 마음을 주장하게 하라 너희는 평강을 위하여 한 몸으로 부르심을 받았나니 너희는 또한 감사하는 자가 되라', '골로새서 3:15', '평안'),
('범사에 우리 주 예수 그리스도의 이름으로 항상 아버지 하나님께 감사하며', '에베소서 5:20', '감사'),
('우리가 감사함으로 그 앞에 나아가며 시를 지어 즐거이 그를 노래하자', '시편 95:2', '찬양'),
('내가 전심으로 여호와께 감사하오며 주의 모든 기이한 일들을 전하리이다', '시편 9:1', '감사'),
('여호와께 감사하라 그는 선하시며 그의 인자하심이 영원함이로다', '역대상 16:34', '감사'),
('여호와는 나의 힘과 나의 방패이시니 내 마음이 그를 의지하여 도움을 얻었도다 그러므로 내 마음이 크게 기뻐하며 내 노래로 그를 찬송하리로다', '시편 28:7', '찬양'),
('이는 잠잠하지 아니하고 내 영광으로 주를 찬송하게 하심이니 여호와 나의 하나님이여 내가 주께 영원히 감사하리이다', '시편 30:12', '감사'),
('그러므로 우리는 예수로 말미암아 항상 찬송의 제사를 하나님께 드리자 이는 그 이름을 증언하는 입술의 열매니라', '히브리서 13:15', '찬양'),
('내 영혼아 여호와를 송축하며 그의 모든 은택을 잊지 말지어다', '시편 103:2', '은혜'),
('내게 주신 모든 은혜를 내가 여호와께 무엇으로 보답할까', '시편 116:12', '은혜'),
('말할 수 없는 그의 은사로 말미암아 하나님께 감사하노라', '고린도후서 9:15', '은혜'),
('지존자여 여호와께 감사하며 주의 이름을 찬양하는 것이 좋으니이다', '시편 92:1', '찬양'),
('항상 기뻐하라 쉬지 말고 기도하라 범사에 감사하라 이것이 그리스도 예수 안에서 너희를 향하신 하나님의 뜻이니라', '데살로니가전서 5:16-18', '기쁨'),
('내가 여호와를 항상 송축함이여 내 입술로 항상 주를 찬양하리이다', '시편 34:1', '찬양'),
('여호와의 인자와 긍휼이 무궁하시므로 우리가 진멸되지 아니함이니이다 이것들이 아침마다 새로우니 주의 성실하심이 크시도소이다', '예레미야애가 3:22-23', '은혜'),
('이 날은 여호와께서 정하신 것이라 이 날에 우리가 즐거워하고 기뻐하리로다', '시편 118:24', '기쁨'),
('주 안에서 항상 기뻐하라 내가 다시 말하노니 기뻐하라', '빌립보서 4:4', '기쁨'),
('여호와는 나의 목자시니 내게 부족함이 없으리로다', '시편 23:1', '평안'),
('주께서 생명의 길을 내게 보이시리니 주의 앞에는 충만한 기쁨이 있고 주의 오른쪽에는 영원한 즐거움이 있나이다', '시편 16:11', '기쁨'),
('온갖 좋은 은사와 온전한 선물이 다 위로부터 빛들의 아버지께로부터 내려오나니 그는 변함도 없으시고 회전하는 그림자도 없으시니라', '야고보서 1:17', '은혜'),
('주의 은택으로 한 해를 관 씌우시니 주의 길에는 기름 방울이 떨어지며', '시편 65:11', '은혜'),
('그 날에 너희가 또 말하기를 여호와께 감사하라 그의 이름을 부르며 그의 행하심을 만국 중에 선포하며 그의 이름이 높다 하라', '이사야 12:4', '감사'),
('나는 감사하는 목소리로 주께 제사를 드리며 나의 서원을 주께 갚겠나이다 구원은 여호와께 속하였나이다', '요나 2:9', '감사'),
('다니엘이 이 조서에 왕의 도장이 찍힌 것을 알고도 자기 집에 돌아가서는 윗방에 올라가 예루살렘으로 향한 창문을 열고 전에 하던 대로 하루 세 번씩 무릎을 꿇고 기도하며 그의 하나님께 감사하였더라', '다니엘 6:10', '감사'),
('하나님이여 우리가 주께 감사하고 감사함은 주의 이름이 가까움이라 사람들이 주의 기이한 일들을 전파하나이다', '시편 75:1', '감사'),
('여호와께 감사하고 그의 이름을 불러 아뢰며 그가 하는 일을 만민 중에 알게 할지어다', '시편 105:1', '감사'),
('할렐루야, 내가 정직한 자들의 모임과 회중 가운데에서 전심으로 여호와께 감사하리로다', '시편 111:1', '감사'),
('내가 전심으로 주께 감사하며 신들 앞에서 주께 찬송하리이다', '시편 138:1', '감사'),
('감사함으로 여호와께 노래하며 수금으로 하나님께 찬양할지어다', '시편 147:7', '찬양'),
('우리 주 예수 그리스도로 말미암아 우리에게 승리를 주시는 하나님께 감사하노니', '고린도전서 15:57', '감사'),
('항상 우리를 그리스도 안에서 이기게 하시고 우리로 말미암아 각처에서 그리스도를 아는 냄새를 나타내시는 하나님께 감사하노라', '고린도후서 2:14', '감사'),
('우리가 알거니와 하나님을 사랑하는 자 곧 그의 뜻대로 부르심을 입은 자들에게는 모든 것이 합력하여 선을 이루느니라', '로마서 8:28', '은혜'),
('여호와께서 우리를 위하여 큰 일을 행하셨으니 우리는 기쁘도다', '시편 126:3', '기쁨'),
('네가 먹어서 배부르고 네 하나님 여호와께서 옥토를 네게 주셨음으로 말미암아 그를 찬송하리라', '신명기 8:10', '감사'),
('내가 노래로 하나님의 이름을 찬송하며 감사함으로 하나님을 위대하시다 하리니', '시편 69:30', '찬양'),
('기도를 계속하고 기도에 감사함으로 깨어 있으라', '골로새서 4:2', '기도'),
('하나님께서 지으신 모든 것이 선하매 감사함으로 받으면 버릴 것이 없나니', '디모데전서 4:4', '감사'),
('할렐루야 여호와께 감사하라 그는 선하시며 그 인자하심이 영원함이로다', '시편 106:1', '감사'),
('이르되 아멘 찬송과 영광과 지혜와 감사와 존귀와 권능과 힘이 우리 하나님께 세세토록 있을지어다 아멘 하더라', '요한계시록 7:12', '찬양'),
('온 땅이여 여호와께 즐거운 찬송을 부를지어다 기쁨으로 여호와를 섬기며 노래하면서 그의 앞에 나아갈지어다', '시편 100:1-2', '기쁨'),
('날마다 우리 짐을 지시는 주 곧 우리의 구원이신 하나님을 찬송할지로다', '시편 68:19', '찬양');

-- ── 관리자 사용자 삭제 ─────────────────────────────────────────
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

-- ── 감사 공유 알림 트리거 ─────────────────────────────────────
-- 기록이 팀/공동체에 처음 공유될 때 팀원들에게 알림을 발송한다.
-- 같은 user_id + team_id + date 조합이면 하루에 한 번만 발송.

create or replace function public.notify_entry_shared()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_team_id    uuid;
  v_member_id  uuid;
  v_display_id text;
  v_new_teams  uuid[];
begin
  if NEW.visibility != 'team' or coalesce(array_length(NEW.shared_team_ids, 1), 0) = 0 then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and OLD.visibility = 'team' then
    select array_agg(t) into v_new_teams
    from unnest(NEW.shared_team_ids) t
    where not (t = any(coalesce(OLD.shared_team_ids, '{}'::uuid[])));
  else
    v_new_teams := NEW.shared_team_ids;
  end if;
  if coalesce(array_length(v_new_teams, 1), 0) = 0 then return NEW; end if;
  select display_id into v_display_id from public.profiles where id = NEW.user_id;
  foreach v_team_id in array v_new_teams loop
    if exists (
      select 1 from public.notifications
      where type = 'entry_shared'
        and (payload->>'sender_id')::uuid = NEW.user_id
        and (payload->>'team_id')::uuid = v_team_id
        and payload->>'date' = NEW.date::text
    ) then continue; end if;
    for v_member_id in
      select tm.user_id from public.team_members tm
      where tm.team_id = v_team_id and tm.status = 'accepted' and tm.user_id != NEW.user_id
      union
      select t.leader_id from public.teams t
      where t.id = v_team_id and t.leader_id != NEW.user_id
    loop
      if public.is_blocked_between(NEW.user_id, v_member_id) then continue; end if;
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

-- ── 관리자 지정 ──────────────────────────────────────────────
-- 앱에서 관리자용 계정을 먼저 회원가입한 뒤, 아래를 이메일만 바꿔 실행하세요.
-- (기획서의 고정 ID/PW 방식 대신, 보안 권고에 따라 계정 플래그 방식을 사용합니다)
--
-- update public.profiles set is_admin = true
-- where id = (select id from auth.users where email = '관리자이메일@example.com');
