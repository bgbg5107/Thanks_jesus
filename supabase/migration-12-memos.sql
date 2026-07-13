-- 마이그레이션 12: 오늘의 메모
-- 하루 한 장, 감사와 별개로 적어 두는 메모 (본인만 접근).
-- 제목/부제목/본문(서식 포함)/사진.

create table public.memos (
  user_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  title text not null default '',
  subtitle text not null default '',
  content text not null default '',          -- 본문 (굵게·형광펜·인용 서식 포함)
  photos jsonb not null default '[]',        -- storage 경로 배열
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

alter table public.memos enable row level security;

create policy "memos select own" on public.memos for select to authenticated using (auth.uid() = user_id);
create policy "memos insert own" on public.memos for insert to authenticated with check (auth.uid() = user_id);
create policy "memos update own" on public.memos for update to authenticated using (auth.uid() = user_id);
create policy "memos delete own" on public.memos for delete to authenticated using (auth.uid() = user_id);
