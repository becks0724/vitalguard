const receiverUrl =
  process.env.MOCK_RECEIVER_URL ?? "http://localhost:3000/api/mock/vital";

const workers = [
  { workerId: "demo_ios_01", heartRate: 78, spo2: 98, skinTempC: 36.4 },
  { workerId: "demo_and_01", heartRate: 84, spo2: 97, skinTempC: 36.6 },
  { workerId: "demo_mock_01", heartRate: 138, spo2: 94, skinTempC: 36.9 },
  { workerId: "demo_mock_02", heartRate: 92, spo2: 86, skinTempC: 37.6 },
  { workerId: "demo_mock_03", heartRate: 88, spo2: 96, skinTempC: 36.5 },
];

let tick = 0;

function sampleFor(worker) {
  const wave = Math.round(Math.sin(tick / 3) * 3);

  return {
    ...worker,
    ts: new Date().toISOString(),
    heartRate: worker.heartRate + wave,
    batteryPct: 92 - (tick % 20),
  };
}

async function publish(sample) {
  const response = await fetch(receiverUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sample),
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
}

async function publishBatch() {
  tick += 1;
  await Promise.all(workers.map((worker) => publish(sampleFor(worker))));
  console.log(`[mock] published ${workers.length} samples -> ${receiverUrl}`);
}

// 최초 배치 실패가 unhandled rejection 으로 죽지 않게 로그 후 진행(interval 은 계속 재시도).
await publishBatch().catch((error) => {
  console.error("[mock] initial publish failed", error);
});
if (process.argv.includes("--once")) {
  process.exit(0);
}

setInterval(() => {
  publishBatch().catch((error) => {
    console.error("[mock] publish failed", error);
  });
}, 5000);
