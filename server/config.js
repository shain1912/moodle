import 'dotenv/config';

function required(name) {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    console.error(`\n[설정 오류] 환경변수 ${name} 가 비어 있습니다.`);
    console.error(`  → .env.example 을 .env 로 복사한 뒤 값을 채우고 다시 실행하세요.\n`);
    process.exit(1);
  }
  return v.trim();
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  isProd: process.env.NODE_ENV === 'production',

  // Supabase: DB(명단/강의/진도)만 사용. 영상은 Cloudflare R2.
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceKey: required('SUPABASE_SERVICE_ROLE_KEY'),

  // Cloudflare R2 (S3 호환) — 영상 저장/스트리밍. 키는 실행 시점에 검증(없어도 부팅은 됨)
  r2: {
    accountId: (process.env.R2_ACCOUNT_ID || '').trim(),
    accessKeyId: (process.env.R2_ACCESS_KEY_ID || '').trim(),
    secretAccessKey: (process.env.R2_SECRET_ACCESS_KEY || '').trim(),
    bucket: (process.env.R2_BUCKET || 'lectures').trim(),
    uploadTtl: parseInt(process.env.R2_UPLOAD_TTL || '21600', 10), // 업로드 서명 URL 유효시간(초, 기본 6h)
  },

  jwtSecret: required('JWT_SECRET'),
  cookieName: 'lms_session',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  sessionHours: 12,

  admin: {
    username: (process.env.ADMIN_USERNAME || 'admin').trim(),
    password: process.env.ADMIN_PASSWORD || '',
    name: (process.env.ADMIN_NAME || '관리자').trim(),
    // 최초 관리자가 속할 기본 학교(테넌트)
    orgSlug: (process.env.DEFAULT_ORG_SLUG || 'gnu').trim(),
    orgName: (process.env.DEFAULT_ORG_NAME || '경상국립대').trim(),
  },

  completionThreshold: parseFloat(process.env.COMPLETION_THRESHOLD || '90'),
  signedPlayTtl: parseInt(process.env.SIGNED_PLAY_TTL || '7200', 10), // 재생 서명 URL 유효시간(초)
};
