import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';

import { config } from './config.js';
import { supabase } from './supabase.js';
import { authenticate, attachOrg } from './auth.js';
import { authRouter } from './routes/auth.js';
import { lecturesRouter } from './routes/lectures.js';
import { progressRouter } from './routes/progress.js';
import { missionsRouter } from './routes/missions.js';
import { materialsRouter } from './routes/materials.js';
import { adminRouter } from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

const app = express();
app.disable('x-powered-by');
if (config.isProd) {
  app.set('trust proxy', 1); // 리버스 프록시(Caddy/Nginx) 뒤에서 secure 쿠키 동작
  if (!config.cookieSecure) {
    console.warn('[경고] 운영(NODE_ENV=production) 환경인데 COOKIE_SECURE=false 입니다. HTTPS 사용 시 .env에서 COOKIE_SECURE=true 로 설정하세요. (세션 쿠키 탈취 위험)');
  }
}
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(authenticate);
app.use(attachOrg);

// 브라우저용 공개 설정 (영상은 서버가 발급하는 presigned URL로만 접근 — 키 노출 없음)
app.get('/api/public-config', (_req, res) => {
  res.json({ completionThreshold: config.completionThreshold });
});
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// 로그인 화면 학교(테넌트) 선택용 — 활성 학교만 공개
app.get('/api/orgs', async (_req, res) => {
  const { data, error } = await supabase
    .from('lms_orgs').select('slug,name').eq('active', true).order('sort', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ orgs: data || [] });
});

app.use('/api/auth', authRouter);
app.use('/api/lectures', lecturesRouter);
app.use('/api/progress', progressRouter);
app.use('/api/missions', missionsRouter);
app.use('/api/materials', materialsRouter);
app.use('/api/admin', adminRouter);

// API 404
app.use('/api', (_req, res) => res.status(404).json({ error: '없는 API 입니다.' }));

// 정적 파일(프론트엔드)
app.use(express.static(publicDir));

// 공통 에러 핸들러
app.use((err, _req, res, _next) => {
  console.error('[server error]', err);
  if (res.headersSent) return;
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

// 최초 관리자 계정 자동 생성
async function seedAdmin() {
  if (!config.admin.password) {
    console.warn('[경고] ADMIN_PASSWORD 미설정 → 관리자 자동 생성을 건너뜁니다. .env 설정 후 재시작하세요.');
    return;
  }
  const { data: existing, error } = await supabase
    .from('lms_teachers').select('id').eq('username', config.admin.username).maybeSingle();
  if (error) {
    console.error('[seed] 관리자 조회 실패 — Supabase 연결/마이그레이션을 확인하세요:', error.message);
    return;
  }
  if (existing) return;

  // 기본 학교(테넌트) 보장 후 그 학교 소속으로 관리자 생성 (org_id 는 NOT NULL)
  let { data: org } = await supabase
    .from('lms_orgs').select('id').eq('slug', config.admin.orgSlug).maybeSingle();
  if (!org) {
    const { data: created, error: oe } = await supabase
      .from('lms_orgs').insert({ slug: config.admin.orgSlug, name: config.admin.orgName }).select('id').single();
    if (oe) { console.error('[seed] 기본 학교 생성 실패:', oe.message); return; }
    org = created;
  }

  const hash = await bcrypt.hash(config.admin.password, 10);
  const { error: e2 } = await supabase.from('lms_teachers').insert({
    username: config.admin.username, name: config.admin.name, password_hash: hash, org_id: org.id,
  });
  if (e2) console.error('[seed] 관리자 생성 실패:', e2.message);
  else console.log(`[seed] 관리자 계정 생성됨 → 아이디: ${config.admin.username}`);
}

app.listen(config.port, () => {
  console.log('\n  ┌───────────────────────────────────────────┐');
  console.log('  │   KODE LMS — 영상 강의 + 진도체크            │');
  console.log('  └───────────────────────────────────────────┘');
  console.log(`   학생 페이지 :  http://localhost:${config.port}/`);
  console.log(`   관리자 페이지:  http://localhost:${config.port}/admin.html`);
  console.log(`   완료 기준   :  시청 ${config.completionThreshold}% 이상\n`);
  seedAdmin().catch((e) => console.error('[seed] 오류:', e.message));
});
