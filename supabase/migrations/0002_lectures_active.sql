-- 강의 활성/비활성 플래그. false면 학생 목록·대시보드·CSV에서 제외(숨김).
alter table public.lms_lectures add column if not exists active boolean not null default true;
create index if not exists idx_lms_lectures_active on public.lms_lectures(active);
