-- ============================================================
-- KODE LMS — 초기 스키마 (Supabase = DB만, 영상은 Cloudflare R2)
-- 테이블은 기존 프로젝트와 충돌하지 않도록 lms_ 접두사 사용.
-- ============================================================

create extension if not exists "pgcrypto";

-- 교사(관리자) 계정
create table if not exists public.lms_teachers (
  id            uuid primary key default gen_random_uuid(),
  username      text unique not null,
  name          text not null default '관리자',
  password_hash text not null,
  created_at    timestamptz not null default now()
);

-- 학생 명단(로스터)
create table if not exists public.lms_students (
  id          uuid primary key default gen_random_uuid(),
  student_no  text unique not null,          -- 학번
  name        text not null,                 -- 이름
  pin         text,                          -- (선택) PIN. 값이 있으면 로그인 시 PIN까지 요구
  active      boolean not null default true, -- 비활성화 시 로그인 차단
  created_at  timestamptz not null default now()
);

-- 강의(영상). storage_path = R2 객체 키
create table if not exists public.lms_lectures (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  description      text not null default '',
  order_index      int  not null default 0,
  storage_path     text not null,            -- Cloudflare R2 내 객체 키
  duration_seconds numeric not null default 0,
  size_bytes       bigint  not null default 0,
  mime_type        text not null default 'video/mp4',
  created_at       timestamptz not null default now()
);

-- 진도 (학생 × 강의)
create table if not exists public.lms_progress (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references public.lms_students(id) on delete cascade,
  lecture_id      uuid not null references public.lms_lectures(id) on delete cascade,
  watched_set     jsonb not null default '[]'::jsonb,  -- 실제로 본 정수 초의 집합(합집합) — 빨리감기 구간 제외
  watched_seconds numeric not null default 0,  -- = watched_set 길이(고유 시청 초). 단조 증가
  last_position   numeric not null default 0,  -- 이어보기 위치(초)
  percent         numeric not null default 0,  -- 0~100
  completed       boolean not null default false,
  completed_at    timestamptz,
  updated_at      timestamptz not null default now(),
  unique (student_id, lecture_id)
);

create index if not exists idx_lms_progress_student on public.lms_progress(student_id);
create index if not exists idx_lms_progress_lecture on public.lms_progress(lecture_id);
create index if not exists idx_lms_lectures_order   on public.lms_lectures(order_index);

-- RLS: 모든 테이블 잠금. 서버는 service_role 키로 접근하므로 RLS를 우회함.
-- (브라우저는 절대 DB에 직접 접근하지 않고, 항상 Express API를 거침)
alter table public.lms_teachers enable row level security;
alter table public.lms_students enable row level security;
alter table public.lms_lectures enable row level security;
alter table public.lms_progress enable row level security;
