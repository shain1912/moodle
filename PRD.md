# Moodle 자체 호스팅 패키지 (KODE KOREA)

경상국립대 온라인강의 **납품 + 진도체크** 용도로 만든, 바로 배포 가능한 Moodle 스택입니다.
인프런 같은 마켓플레이스 수수료(50%) 없이, 직접 호스팅해서 진도율·완료 데이터를 엑셀로 뽑아
납품 증빙으로 쓸 수 있습니다.

> Bitnami 무료 Moodle 이미지가 2025년 단종되어, **공식 Moodle 소스로 직접 빌드**하도록 구성했습니다.
> (보안 패치 안 되는 legacy 이미지를 운영에 쓰지 않기 위함)

기본 버전: **Moodle 4.5 LTS** (운영 안정성 우선). `.env`의 `MOODLE_BRANCH`만 바꾸면 5.0/5.1로 올릴 수 있습니다.

---

## 0. 구성 요약

| 컨테이너 | 역할 |
|---|---|
| `moodle` | Moodle 웹앱 (Apache + PHP 8.3, 공식 소스 빌드) |
| `db` | MariaDB 11.4 |
| `redis` | 세션/캐시 |
| `cron` | Moodle 필수 1분 주기 크론 |

```
moodle-stack/
├── Dockerfile              # 공식 소스로 Moodle 이미지 빌드
├── docker-compose.yml      # 4개 컨테이너 스택
├── .env.example            # → .env 로 복사해서 값 채움
├── config/config.php       # 환경변수 주입형 설정 (비번 직접 안 적음)
├── php-moodle.ini          # 대용량 업로드/OPcache 튜닝
├── Caddyfile.example       # 리버스 프록시(자동 HTTPS) 예시
├── backup.sh               # DB + moodledata 백업
└── plugins/                # 추가 플러그인 넣는 곳
```

---

## 1. 사전 준비

- Docker + Docker Compose v2 설치된 리눅스 서버 (R360에 이미 멀티사이트 구성 있으면 그 위에 얹으면 됨)
- 도메인 1개 (예: `lms.kodekorea.kr`) → 서버 IP로 A 레코드
- TLS를 처리할 리버스 프록시 (Caddy 권장, 자동 인증서)

---

## 2. 빠른 시작 (5단계)

```bash
# 1) 환경파일 작성
cp .env.example .env
nano .env          # 도메인(MOODLE_WWWROOT)과 DB 비밀번호 4개를 강력하게 변경

# 2) 이미지 빌드 (Moodle 소스 다운로드 포함, 수 분 소요)
docker compose build

# 3) 스택 기동
docker compose up -d

# 4) DB 설치 (CLI 권장 — 자동/무인 설치)
docker compose exec -u www-data moodle \
  php admin/cli/install_database.php \
  --agree-license \
  --adminuser=admin \
  --adminpass='바꿀_관리자_비번' \
  --adminemail='seongho.cho@kodekorea.kr' \
  --fullname='KODE KOREA LMS' \
  --shortname='KKLMS'

# 5) 리버스 프록시 연결 후 브라우저에서 https://lms.kodekorea.kr 접속
```

> CLI 설치 대신 웹 설치를 원하면 4번을 건너뛰고 도메인에 접속하면 설치 마법사가 DB 채우기 단계부터 진행됩니다.

리버스 프록시(Caddy) 예시는 `Caddyfile.example` 참고. 한 줄 요지:
```
lms.kodekorea.kr {
    request_body { max_size 2GB }
    reverse_proxy 127.0.0.1:8080
}
```

---

## 3. ⭐ 진도체크(완료 추적) 설정 — 이게 핵심

Moodle의 진도체크는 **완료 추적(Completion tracking)** 기능입니다. 2단계로 켭니다.

### 3-1. 사이트 전체 활성화 (관리자, 1회)
`사이트 관리 → 고급 기능(Advanced features)` →
- **완료 추적 사용(Enable completion tracking)** → **예**
- (선택) 조건부 접근(Enable conditional access) → 예 — "앞 강의 완료해야 다음 강의 열림" 같은 잠금 걸 때

### 3-2. 과목별 설정
1. 과목 `설정(Settings)` → **완료 추적(Completion tracking) = 예**
2. 각 활동/자료(영상·페이지·과제 등) → **활동 완료(Activity completion)** 에서 조건 지정
   - 영상/자료를 **파일·URL·페이지**로 올린 경우 → "학생이 본 경우 완료로 표시(require view)"
   - 과제·퀴즈 → "제출 시 / 합격점수 도달 시" 완료
3. (선택) `과목 설정 → 과목 이수(Course completion)` 에서 전체 이수 기준 지정

### 3-3. 진도/이수 데이터 보기 & 엑셀 추출 (납품 증빙)
- `과목 → 보고서(Reports) → 활동 완료(Activity completion)`
  → 학생 × 활동 격자표. 우측에서 **엑셀(.xlsx)/CSV 다운로드** 가능
- `보고서 → 과목 이수(Course completion)` → 이수 여부 요약
- 이 파일을 그대로 경상대에 진도/이수 증빙으로 제출하면 됩니다.

### 3-4. 영상 "몇 % 봤는지"까지 필요하면
- 위 기본 방식은 **"열어봤다(viewed)"** 까지만 추적합니다. (실제 시청 비율 X)
- 시청 비율/구간 추적이 필요하면 **H5P Interactive Video**(Moodle 내장) 로 영상을 올리세요.
  재생 완료를 완료 조건으로 걸 수 있어 더 엄격한 진도 인정이 됩니다. 별도 설치 불필요.
- 더 강하게 막대 시각화를 원하면 `plugins/`에 **Completion Progress** 블록 추가.

---

## 4. 영상 업로드 / 용량

- 기본 업로드 한도는 `php-moodle.ini`에서 **2GB**로 설정됨. 더 키우려면 `upload_max_filesize` / `post_max_size`와 `Caddyfile`의 `max_size`를 같이 올리고 재기동.
- 과목 내 한도는 `과목 설정 → 최대 업로드 크기`에서 따로 지정.
- 영상이 많으면 외부(예: 학교가 가진 스토리지/유튜브 비공개)로 빼고 **URL/임베드 + 완료조건**으로 운영하는 것도 방법.

---

## 5. 경상대 납품 관점 운영 팁

- **계정 일괄 생성**: `사이트 관리 → 사용자 → 사용자 업로드(Upload users)` 에서 CSV로 학생 일괄 등록.
- **권한 분리**: 학교 담당자에게는 해당 과목 `교사(Teacher)` 또는 사이트 `관리자(Manager)` 역할만 부여. 성호님은 사이트 관리자.
- **수강 등록**: 과목별 수동 등록 또는 등록키(enrolment key) 배포.
- **납품 산출물 루프**: 영상/자료 업로드 → 완료조건 설정 → 학생 수강 → cron이 진도 집계 → `활동 완료 보고서` 엑셀 추출 → 학교 제출.

---

## 6. 백업 / 복구

```bash
./backup.sh        # ./backups/ 에 db-*.sql.gz, moodledata-*.tgz 생성 (14일 보관)
# 크론 등록 예: 0 3 * * *  cd /opt/moodle-stack && ./backup.sh
```
복구는 DB는 `mariadb` 로 import, `moodledata`는 볼륨에 풀어 넣은 뒤 스택 재기동.

---

## 7. 버전 업그레이드

```bash
# .env 에서 MOODLE_BRANCH 변경 (예: 405 → 500)
docker compose build --no-cache moodle cron
docker compose up -d
docker compose exec -u www-data moodle php admin/cli/upgrade.php --non-interactive
```
> 업그레이드 전 반드시 `./backup.sh` 먼저. 큰 버전 점프는 한 단계씩.

---

## 8. 운영 점검 명령

```bash
docker compose ps                 # 상태
docker compose logs -f moodle     # 웹 로그
docker compose logs -f cron       # 크론 동작 확인
docker compose exec -u www-data moodle php admin/cli/cron.php   # 수동 크론 1회
```

---

## 9. 보안 체크
- `.env`의 비밀번호 4개 전부 강력하게 변경, 외부 공유 금지.
- Moodle 컨테이너는 `127.0.0.1`에만 바인딩되어 외부 직접 노출 안 됨(프록시 경유만).
- `사이트 관리 → 서버 → 환경(Environment)` 에서 빨간 경고 없는지 1회 확인.
- 정기 보안 업데이트: LTS라인 패치 릴리스가 나오면 7번 절차로 재빌드.
```