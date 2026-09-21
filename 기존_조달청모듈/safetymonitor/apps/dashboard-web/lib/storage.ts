// 네이버 클라우드 Object Storage(S3 호환) 어댑터 — 비공개 버킷 전제. 프리사인 업로드(PUT)/조회(GET) URL 발급.
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
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

// (프리사인 PUT 발급은 2026-08-21 업로드 다리 철거와 함께 제거 — 유일 호출자가 upload-url
//  라우트였다. 업로드는 putObject(서버 직접)만 남는다. docs/seam-contracts/findings.md H.)

// 조회용 프리사인 GET URL — 비공개 버킷이라 표시 시점마다 만료형 URL 발급(저장 키 기준).
export async function presignDownload(key: string): Promise<string> {
  const env = readEnv();
  return getSignedUrl(
    getClient(env),
    new GetObjectCommand({ Bucket: env.bucket, Key: key }),
    { expiresIn: DOWNLOAD_TTL },
  );
}

// 다운로드용 프리사인 GET URL — Content-Disposition: attachment 로 브라우저가 저장하게 강제.
// 한글 파일명은 RFC5987(filename*)로 보존 + ASCII 폴백 동봉.
export async function presignDownloadAttachment(key: string, filename: string): Promise<string> {
  const env = readEnv();
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const disposition = `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
  return getSignedUrl(
    getClient(env),
    new GetObjectCommand({ Bucket: env.bucket, Key: key, ResponseContentDisposition: disposition }),
    { expiresIn: DOWNLOAD_TTL },
  );
}

// 서버측 객체 본문 읽기(텍스트) — 브라우저가 직접 읽을 수 없는 작은 JSON(캘린더 표시본)을
// 라우트가 대신 받아 같은 오리진으로 내려줄 때 쓴다. 프리사인 GET 응답에는
// Access-Control-Allow-Origin 이 없어 cross-origin fetch/XHR 이 막힌다(2026-09-21 실측).
// 전량을 메모리에 올리므로 큰 파일(사진·영상)에는 쓰지 않는다 — 그쪽은 프리사인 그대로 둔다.
export async function getObjectText(key: string): Promise<string> {
  const env = readEnv();
  const res = await getClient(env).send(
    new GetObjectCommand({ Bucket: env.bucket, Key: key }),
  );
  if (!res.Body) throw new Error("객체 본문 없음");
  return res.Body.transformToString("utf-8");
}

// 객체 삭제 — DB 행을 지운 **뒤에** 부른다. 순서를 뒤집으면 권한이 없어 행이 안 지워졌을 때
// 파일만 사라진다(남의 증빙을 파괴한다). 없는 키를 지워도 S3 는 성공을 돌려준다.
export async function deleteObject(key: string): Promise<void> {
  const env = readEnv();
  await getClient(env).send(new DeleteObjectCommand({ Bucket: env.bucket, Key: key }));
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
