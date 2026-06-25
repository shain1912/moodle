-- ============================================================
-- 주차별 팀 미션 공지
--  - lms_missions: 학교(org)별 미션 공지(모든 팀 공통). 제출은 앱이 아니라
--    이메일(제목 "팀명_주차", 받는사람 submit_email)로 — 앱은 안내만 표시.
-- 추가형 마이그레이션(기존 라이브 코드에 무영향). 적용 후 코드 배포.
-- ============================================================

create table if not exists public.lms_missions (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.lms_orgs(id) on delete cascade,
  round        int  not null,                  -- 1·2·3 (정렬 + 주차)
  week_label   text not null,                  -- 메일 제목/표시용. 예 '1주차'
  title        text not null,
  body         text not null default '',       -- 본문(줄바꿈 보존)
  due_at       timestamptz,                    -- 마감일(선택)
  submit_email text,                           -- 예 'sh.cho@pusan.ac.kr'
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists idx_missions_org_round on public.lms_missions(org_id, round);

-- RLS(서버는 service_role로 우회). 기존 테이블과 동일.
alter table public.lms_missions enable row level security;
