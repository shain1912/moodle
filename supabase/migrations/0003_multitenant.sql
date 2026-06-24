-- ============================================================
-- 멀티테넌트(학교별) 전환
--  - lms_orgs: 학교(테넌트)
--  - lms_students/lms_teachers 에 org_id
--  - lms_org_lectures: 학교별 강의 구독(부분수강) + 섹션 + 순서 + 활성
-- 추가형 마이그레이션(기존 라이브 코드에 무영향). 적용 후 코드 배포.
-- ============================================================

-- 1) 학교(테넌트)
create table if not exists public.lms_orgs (
  id         uuid primary key default gen_random_uuid(),
  slug       text unique not null,            -- 'gnu','pknu' (로그인 식별)
  name       text not null,                   -- '경상국립대','부경대'
  active     boolean not null default true,   -- false면 로그인 학교 목록에서 숨김
  sort       int not null default 0,
  created_at timestamptz not null default now()
);

insert into public.lms_orgs (slug, name, active, sort)
values ('gnu', '경상국립대', true, 0)
on conflict (slug) do nothing;
-- 부경대는 명단/강좌 준비 전까지 숨김(active=false)
insert into public.lms_orgs (slug, name, active, sort)
values ('pknu', '부경대', false, 1)
on conflict (slug) do nothing;

-- 2) 학생/교사에 org_id (먼저 nullable 추가 → 백필 → NOT NULL)
alter table public.lms_students add column if not exists org_id uuid references public.lms_orgs(id);
alter table public.lms_teachers add column if not exists org_id uuid references public.lms_orgs(id);

update public.lms_students set org_id = (select id from public.lms_orgs where slug='gnu') where org_id is null;
update public.lms_teachers set org_id = (select id from public.lms_orgs where slug='gnu') where org_id is null;

alter table public.lms_students alter column org_id set not null;
alter table public.lms_teachers alter column org_id set not null;

-- 3) 이름 고유: 전역 → 학교별(동명이인 학교 간 허용)
drop index if exists public.uq_lms_students_name;
create unique index if not exists uq_lms_students_org_name on public.lms_students (org_id, name);

-- 4) 학교별 강의 구독(부분수강)
create table if not exists public.lms_org_lectures (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.lms_orgs(id) on delete cascade,
  lecture_id    uuid not null references public.lms_lectures(id) on delete cascade,
  section       text not null default '',   -- 섹션(파트) 이름. '' = 미분류
  section_order int  not null default 0,     -- 섹션 정렬
  order_index   int  not null default 0,     -- 섹션 내 강의 정렬
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (org_id, lecture_id)
);
create index if not exists idx_org_lectures_org on public.lms_org_lectures(org_id);
create index if not exists idx_org_lectures_lecture on public.lms_org_lectures(lecture_id);

-- 5) 경상대(gnu)에 현재 활성 강의(13강) 구독 백필
insert into public.lms_org_lectures (org_id, lecture_id, order_index, active)
select (select id from public.lms_orgs where slug='gnu'), id, order_index, true
from public.lms_lectures where active = true
on conflict (org_id, lecture_id) do nothing;

-- 6) RLS(서버는 service_role로 우회). 기존 테이블과 동일 정책.
alter table public.lms_orgs enable row level security;
alter table public.lms_org_lectures enable row level security;
