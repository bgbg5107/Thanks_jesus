-- 마이그레이션 13: 메모 하루 여러 장
-- 말씀 메모와 할 일 메모처럼 성격이 다른 메모를 같은 날 여러 장 적을 수 있도록
-- 기본 키를 (user_id, date)에서 id(uuid)로 바꾼다. 기존 메모는 그대로 보존된다.

alter table public.memos add column id uuid not null default gen_random_uuid();
alter table public.memos drop constraint memos_pkey;
alter table public.memos add primary key (id);
create index memos_user_date on public.memos (user_id, date);
