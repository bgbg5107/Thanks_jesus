-- ============================================================
-- 마이그레이션 5: 셀 / 나눔 공동체 구분 + 셀리더 권한
-- · 셀(cell): 교회에서 정해진 셀 — 셀리더 권한자만 생성 가능
-- · 나눔 공동체(group): 누구나 자유롭게 생성
-- ============================================================

-- 셀리더 권한 (관리자가 지정)
alter table public.profiles add column if not exists is_cell_leader boolean not null default false;

-- 공동체 종류
alter table public.teams add column if not exists kind text not null default 'group'
  check (kind in ('cell', 'group'));

-- 기존에 만들어진 방들은 교회 셀로 간주
update public.teams set kind = 'cell';

-- 셀리더(또는 관리자) 여부
create or replace function public.can_lead_cell()
returns boolean language sql security definer set search_path = public as $$
  select coalesce(
    (select is_cell_leader or is_admin from public.profiles where id = auth.uid()),
    false
  )
$$;

-- 셀 생성은 셀리더만, 나눔 공동체는 누구나
drop policy if exists "teams insert" on public.teams;
create policy "teams insert" on public.teams for insert to authenticated
  with check (
    leader_id = auth.uid()
    and (kind = 'group' or public.can_lead_cell())
  );
