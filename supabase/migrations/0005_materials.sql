-- ============================================================
-- 강의자료(PDF 등) 다운로드
--  - lms_materials: 학교(org)별 자료. 파일은 Cloudflare R2(영상과 동일),
--    학생은 presigned GET(attachment)로 다운로드. 진도/시청과 무관한 단순 배포물.
-- 추가형 마이그레이션(기존 라이브 코드에 무영향). 적용 후 코드 배포.
-- ============================================================

create table if not exists public.lms_materials (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.lms_orgs(id) on delete cascade,
  title      text not null,
  r2_key     text not null,                 -- R2 객체 키(storage path)
  filename   text not null default '',      -- 원본 파일명(다운로드 시 사용)
  size_bytes bigint not null default 0,
  mime_type  text not null default 'application/pdf',
  sort       int  not null default 0,       -- 노출 순서
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_materials_org on public.lms_materials(org_id, sort);

-- RLS(서버는 service_role로 우회). 기존 테이블과 동일.
alter table public.lms_materials enable row level security;
