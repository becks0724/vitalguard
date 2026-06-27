// Cloudflare R2(S3 호환) 오브젝트 스토리지 어댑터 — 비공개 버킷 전제. 프리사인 업로드(PUT)/조회(GET) URL 발급.
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

type R2Env = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

// 런타임에만 필요 — 빌드/임포트 시 env 없어도 통과하도록 클라이언트는 첫 호출 시 지연 생성(메모이즈).
let client: S3Client | null = null;

const UPLOAD_TTL = 600; // 10분 — 발급 직후 PUT 전제.
const DOWNLOAD_TTL = 3600; // 1시간 — 캘린더 조회 표시용 만료형 URL.

// 키 4개가 모두 있어야 R2 사용 가능 — 미설정 시 라우트가 503 으로 명확히 응답.
export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET,
  );
}

function readEnv(): R2Env {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      "R2 미설정 — R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET 확인",
    );
  }
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

function getClient(env: R2Env): S3Client {
  if (!client) {
    client = new S3Client({
      region: "auto", // R2 는 region 개념이 없어 'auto'.
      endpoint: `https://${env.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env.accessKeyId, secretAccessKey: env.secretAccessKey },
    });
  }
  return client;
}

// 업로드용 프리사인 PUT URL — 앱/클라가 이 URL로 직접 PUT(서버 경유·바이트 미통과).
export async function presignUpload(key: string, contentType: string): Promise<string> {
  const env = readEnv();
  return getSignedUrl(
    getClient(env),
    new PutObjectCommand({ Bucket: env.bucket, Key: key, ContentType: contentType }),
    { expiresIn: UPLOAD_TTL },
  );
}

// 조회용 프리사인 GET URL — 비공개 버킷이라 표시 시점마다 만료형 URL 발급(저장 키 기준).
export async function presignDownload(key: string): Promise<string> {
  const env = readEnv();
  return getSignedUrl(
    getClient(env),
    new GetObjectCommand({ Bucket: env.bucket, Key: key }),
    { expiresIn: DOWNLOAD_TTL },
  );
}
