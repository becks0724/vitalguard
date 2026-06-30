// 네이버 클라우드 Object Storage(S3 호환) 어댑터 — 비공개 버킷 전제. 프리사인 업로드(PUT)/조회(GET) URL 발급.
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

type ObjectStorageEnv = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

// 네이버 Object Storage 기본값(한국 리전). 다른 리전·엔드포인트는 NCP_ENDPOINT/NCP_REGION 으로 덮어쓴다.
const DEFAULT_ENDPOINT = "https://kr.object.ncloudstorage.com";
const DEFAULT_REGION = "kr-standard";

// 런타임에만 필요 — 빌드/임포트 시 env 없어도 통과하도록 클라이언트는 첫 호출 시 지연 생성(메모이즈).
let client: S3Client | null = null;

const UPLOAD_TTL = 600; // 10분 — 발급 직후 PUT 전제.
const DOWNLOAD_TTL = 3600; // 1시간 — 캘린더 조회 표시용 만료형 URL.

// 액세스키/시크릿/버킷이 모두 있어야 사용 가능 — 미설정 시 라우트가 503 으로 명확히 응답.
export function isStorageConfigured(): boolean {
  return Boolean(
    process.env.NCP_ACCESS_KEY &&
      process.env.NCP_SECRET_KEY &&
      process.env.NCP_BUCKET,
  );
}

function readEnv(): ObjectStorageEnv {
  const accessKeyId = process.env.NCP_ACCESS_KEY;
  const secretAccessKey = process.env.NCP_SECRET_KEY;
  const bucket = process.env.NCP_BUCKET;
  if (!accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      "Object Storage 미설정 — NCP_ACCESS_KEY/NCP_SECRET_KEY/NCP_BUCKET 확인",
    );
  }
  return {
    endpoint: process.env.NCP_ENDPOINT ?? DEFAULT_ENDPOINT,
    region: process.env.NCP_REGION ?? DEFAULT_REGION,
    accessKeyId,
    secretAccessKey,
    bucket,
  };
}

function getClient(env: ObjectStorageEnv): S3Client {
  if (!client) {
    client = new S3Client({
      region: env.region,
      endpoint: env.endpoint,
      // 네이버 Object Storage 는 path-style 경로(<endpoint>/<bucket>/<key>) 사용.
      forcePathStyle: true,
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

// 서버측 직접 업로드(PUT) — 앱이 바이트를 서버로 보내는 단일 엔드포인트(/api/app-media)에서 사용.
export async function putObject(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  const env = readEnv();
  await getClient(env).send(
    new PutObjectCommand({ Bucket: env.bucket, Key: key, Body: body, ContentType: contentType }),
  );
}
