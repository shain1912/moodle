# KODE LMS — 영상 강의 + 진도체크

경상국립대 온라인강의 **납품 + 진도체크** 용도의 경량 LMS.

- ✅ **영상 시청 % 진도체크** — 실제 재생된 구간(초)만 인정 (빨리감기/건너뛰기 제외, 단조 증가, 이어보기)
- ✅ **학생 로그인** — 명단(로스터) 검증: 학번+이름 (선택적으로 PIN)
- ✅ **웹에서 영상 업로드** — 관리자 페이지에서 R2로 직접 업로드(진행률 표시)
- ✅ **진도 한 번에 파일로** — 학생×강의 진도율 CSV(엑셀) 원클릭 다운로드
- ✅ **명단 관리** — 학번/이름/PIN, 엑셀 복붙 일괄등록

**스택:** Node.js + Express · **Supabase**(Postgres = DB/명단/진도) · **Cloudflare R2**(영상, egress 무료) · 순수 HTML/CSS/JS

> 💡 영상을 R2(대역폭 무료)에 두기 때문에 학생이 많아져도 비용이 거의 고정됩니다.
> 45시간(~30GB) + 45명 기준 월 ~₩1천 수준. (영상을 Supabase Storage에 두면 egress로 월 ₩17만+)

---

## 0. 현재 상태 (이미 완료된 것)

- Supabase **TEAMKODEKOREA** 프로젝트에 `lms_` 테이블 4개 생성됨 (다른 테이블과 격리).
- `.env` 생성됨 (SUPABASE_URL, JWT_SECRET, 관리자 비번 자동 채움).
- **남은 건 `.env`에 ① service_role 키, ② R2 키 4개 붙여넣기뿐.**

---

## 1. Supabase service_role 키 넣기

1. Supabase 대시보드 → **TEAMKODEKOREA** 프로젝트 → `Project Settings → API`
2. **service_role** (secret) 키 복사
3. `.env` 의 `SUPABASE_SERVICE_ROLE_KEY=` 뒤에 붙여넣기 (⚠️ 외부 노출 금지)

---

## 2. Cloudflare R2 설정 (영상 저장소)

1. Cloudflare 대시보드 → **R2** → 버킷 생성: 이름 **`lectures`** (비공개로 둠)
2. **R2 → Manage R2 API Tokens → Create API Token**
   - 권한: **Object Read & Write**, 대상 버킷: `lectures`
   - 발급되면 **Access Key ID / Secret Access Key** 복사
3. **Account ID** 확인: R2 개요 페이지 우측, 또는 S3 endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` 의 그 부분
4. `.env` 에 채우기:
   ```
   R2_ACCOUNT_ID=...
   R2_ACCESS_KEY_ID=...
   R2_SECRET_ACCESS_KEY=...
   R2_BUCKET=lectures
   ```
5. ⭐ **CORS 설정 (필수)** — 브라우저에서 R2로 직접 업로드하려면 버킷에 CORS 허용이 필요합니다.
   R2 → `lectures` 버킷 → **Settings → CORS Policy → Edit** 에 아래 입력:
   ```json
   [
     {
       "AllowedOrigins": ["http://localhost:3000"],
       "AllowedMethods": ["PUT", "GET"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
   > 나중에 도메인으로 배포하면 `AllowedOrigins` 에 그 주소(예: `https://lms.kodekorea.kr`)도 추가하세요.

> **용량 메모:** R2 단일 PUT 업로드는 파일당 최대 5GB. 보통 1강(1~3시간)은 그 안에 들어옵니다.
> 한 파일이 5GB를 넘으면 강을 분할해 올리세요.

---

## 3. 실행

```powershell
npm install
npm start          # 개발 모드: npm run dev
```

- 학생 페이지 : <http://localhost:3000/>
- 관리자 페이지 : <http://localhost:3000/admin.html>
- 관리자 로그인: 아이디 `admin` / 비번은 `.env` 의 `ADMIN_PASSWORD` (첫 실행 시 계정 자동 생성)

---

## 4. 사용 흐름

**관리자:** `/admin.html` 로그인 → ① 학생 명단 탭에서 학생 추가(엑셀 `학번,이름` 복붙 일괄등록) → ② 강의 관리 탭에서 영상 업로드 → ③ 진도 대시보드에서 진도 확인 + **CSV 다운로드**.

**학생:** `/` 에서 학번+이름(+PIN) 로그인 → 강의 시청(진도 자동 저장·이어보기) → 시청 90%+ 면 완료 인정.

---

## 5. 진도 인정 방식

- 영상의 **실제 재생된 초(1초 단위 고유 구간)** 만 누적 → `시청초 / 전체길이` 로 % 계산.
- **빨리감기/스크롤로 건너뛴 구간은 진도에 미포함.** 여러 기기/세션 시청분은 합집합으로 누적(단조 증가).
- 완료 기준은 `.env` 의 `COMPLETION_THRESHOLD`(기본 90%).
- 업로드 시 영상 길이를 못 읽어도, 학생이 처음 재생할 때 실제 길이로 자동 보정됩니다.

---

## 6. 진도 CSV

`progress_YYYY-MM-DD.csv` (UTF-8 BOM, 엑셀 한글 OK). 학번·이름·강의별 %/완료·평균진도율·완료강의수·전체이수. 그대로 학교 증빙 제출.

---

## 7. 보안 메모

- 브라우저는 DB·영상에 **직접 접근하지 않습니다.** 모든 접근은 Express가 발급하는 **짧은 유효시간 서명 URL**을 통해서만.
- 세션은 httpOnly JWT 쿠키. 운영(HTTPS) 시 `.env` 에서 `COOKIE_SECURE=true`.
- `.env`(특히 `SUPABASE_SERVICE_ROLE_KEY`, R2 시크릿, `JWT_SECRET`)는 절대 외부 공유 금지. (git에는 `.gitignore`로 제외됨)

---

## 8. 폴더 구조

```
moodle/
├── server/                 # Express 백엔드
│   ├── index.js · config.js · supabase.js · storage.js(R2) · auth.js
│   ├── lib/csv.js
│   └── routes/ auth · lectures · progress · admin
├── public/                 # 프론트엔드(무빌드: HTML/CSS/JS)
│   ├── index.html · student.html · admin.html
│   ├── css/style.css
│   └── js/ api · login · student · admin
├── supabase/migrations/0001_init.sql   # (참고용 — 이미 적용됨)
├── .env (생성됨, git 제외) · .env.example
└── package.json
```
