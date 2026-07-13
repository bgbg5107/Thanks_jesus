-- 마이그레이션 11: 프로필 사진
-- 프로필에 사진 경로(photos 버킷)를 담는다. 사진이 없으면 이름 첫 글자로 표시.

alter table public.profiles add column if not exists avatar_url text;
