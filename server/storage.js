// Cloudflare R2 (S3 호환) 영상 저장소.
//  - 업로드: 브라우저가 presigned PUT URL 로 R2에 직접 올림(서버 메모리 안 거침)
//  - 재생  : presigned GET URL (짧은 유효시간, range 요청 지원 → seek 가능)
//  - egress 무료라 학생이 아무리 많이 봐도 대역폭 비용이 들지 않음
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config.js';

let _client = null;

export function r2Configured() {
  const r = config.r2;
  return !!(r.accountId && r.accessKeyId && r.secretAccessKey && r.bucket);
}

function client() {
  if (!r2Configured()) {
    throw new Error('R2 설정이 비어 있습니다. .env 에 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET 를 채워주세요.');
  }
  if (!_client) {
    _client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.r2.accessKeyId,
        secretAccessKey: config.r2.secretAccessKey,
      },
    });
  }
  return _client;
}

// 업로드용 presigned PUT URL (content-type은 서명에 넣지 않아 브라우저가 자유롭게 전송)
export function createUploadUrl(key) {
  return getSignedUrl(client(), new PutObjectCommand({ Bucket: config.r2.bucket, Key: key }), {
    expiresIn: config.r2.uploadTtl,
  });
}

// 재생용 presigned GET URL
export function createPlaybackUrl(key) {
  return getSignedUrl(client(), new GetObjectCommand({ Bucket: config.r2.bucket, Key: key }), {
    expiresIn: config.signedPlayTtl,
  });
}

export function deleteObject(key) {
  return client().send(new DeleteObjectCommand({ Bucket: config.r2.bucket, Key: key }));
}
