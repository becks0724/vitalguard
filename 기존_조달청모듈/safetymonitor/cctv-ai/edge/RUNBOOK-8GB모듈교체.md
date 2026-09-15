# 런북 — Jetson Orin Nano 4GB → 8GB 모듈 교체

**시행일 2026-09-07 (월) · 사전조사 2026-09-05 (토)**

교체 대상은 램이 아니라 **260핀 SO-DIMM 모듈(SoM) 통째**다. Orin Nano 는 LPDDR5 가
모듈에 납땜돼 있어 램만 갈아끼우는 구조가 아니다.

```
현재   P3767-0004  Orin Nano 4GB   (EEPROM 699-13767-0004-301 G.1 로 확정)
교체   P3767-0005  Orin Nano 8GB   ★ 개발자 키트 모듈 — 박스 사진으로 확정 (2026-09-07)
```

**★ 교체품은 모듈 단품이 아니라 개발자 키트 박스 통째다** (2026-09-07 사용자 사진 · ROSMASTER
구매). 안에 든 것 = P3768-0000 캐리어 + P3767-0005 모듈 + DC 어댑터. 박스가 microSD 슬롯을
**모듈 항목 아래**에 적고 있으므로 모듈은 0005(개발자 키트용)다 — 양산용 0003·0004 에는 SD
슬롯이 없다. 지금 젯슨에 `mmcblk` 장치가 하나도 없는 것(0004 양산 모듈)과 대칭이다.

---

## 0. 왜 교체가 필요한가 — 소프트웨어로는 못 푼다

`nvpmodel -q --verbose` 의 실제값과 설정값이 어긋나 있다.

```
TPC_PG_MASK   REAL_VAL: 252 (11111100b)   TPC 0,1 만 살아있음 = 2 TPC = 4 SM = 512 CUDA
              CONF_VAL: 240 (11110000b)   TPC 0~3 을 켜라고 요구 = 4 TPC = 8 SM = 1024 CUDA
```

설정은 이미 4개를 요구하는데 2개만 켜진다. **실리콘 퓨즈컷이라 설정으로 되살릴 수 없다.**
커널 부트인자에 `mem=` 캡도 없다 — 3.6GB 는 실제 물리 용량이다.

---

## 1. ★ 우분투 호스트는 필요 없다 (사전조사 결과)

당초 QSPI 플래시에 x86 우분투 호스트가 필요하다고 봤으나, **온디바이스 캡슐 업데이트
경로가 이미 완비돼 있다.** 2026-09-05 무위험 검증 완료.

```
/usr/sbin/nv_update_engine                     업데이트 도구
/opt/ota_package/bl_update_payload             61.8MB  페이로드
/opt/ota_package/t23x/TEGRA_BL_3767.Cap        43.4MB  ★ 3767 = Orin Nano 모듈용 캡슐
/boot/efi/EFI/UpdateCapsule/                   캡슐 투입 경로
/boot/efi                                      63M 중 63M 여유 — 43MB 캡슐 수용 가능
nv-l4t-bootloader-config.service               enabled
nvbootctrl                                     slot 0·1 모두 status: normal · 현재 36.4.3
```

즉 **새 모듈이 리눅스까지만 뜨면 젯슨 자신이 QSPI 를 36.4.3 으로 맞춘다.**
우분투 호스트는 부팅조차 안 되는 최악의 경우(분기 B)에만 쓴다.

---

## 1-b. ★★ 지금 OS 는 이미 이 모듈용으로 구워져 있다 (2026-09-07 확인)

```
/proc/device-tree/model     NVIDIA Jetson Orin Nano Engineering Reference Developer Kit Super
compatible                  nvidia,p3768-0000+p3767-0005-super
                            nvidia,p3767-0005
```

NVMe 의 커널·DTB 가 **P3768-0000 캐리어 + P3767-0005 모듈** 조합으로 플래시돼 있다.
4GB(0004) 모듈 위에 8GB 개발키트(0005) 설정을 구웠던 것이고, 그래서 nvpmodel.conf 도 8GB 표를
가리켰다(§6-③). **박스 안 모듈이 정확히 그 0005 다 — 교체하면 소프트웨어와 하드웨어가 처음으로
일치한다.** DTB·nvpmodel·rootfs 어느 것도 손댈 필요 없다.

캐리어도 같다. 지금 캐리어가 p3768-0000(NVIDIA 정품 개발자 키트 보드)이고 박스 안 캐리어도
그것이다. 따라서 **모듈만 옮기는 것(§4)이 정답**이고, 남는 새 캐리어는 예비 부품이자 분기 B
전용 실험대가 된다 — 프로덕션 NVMe 는 구 캐리어에 그대로 두고 새 캐리어에서 새 모듈을 따로
다룰 수 있다.

## 1-c. ⚠ 박스는 'Super' 이전 오리지널 개발자 키트다 — 분기 B 확률이 올라갔다

박스 표기 = `1024-core · 32 Tensor Cores · 8GB 128-bit LPDDR5`. **'Super'·'67 TOPS' 표기 없음.**

Super 는 별도 모듈이 아니다. 같은 P3767-0005 실리콘에 JetPack 6.2(L4T 36.4.x) 펌웨어와
`MAXN_SUPER` 전원 모드를 얹은 것이다. 지금 NVMe 가 정확히 그 36.4.3 + `_super` 설정이므로
**새 모듈의 QSPI 가 36.4.3 이 되는 순간 Super 성능이 그대로 나온다.** 하드웨어는 맞다.

문제는 출발점이다. 오리지널 박스 개발키트는 공장에서 **JetPack 5.x(L4T R35) 부트로더**를
싣고 나온 개체가 많다. R35 UEFI 가 36.4.3 rootfs 를 띄워 주는지는 **보장이 없다** — 뜨면
분기 A, 안 뜨면 분기 B 다. 어느 쪽인지는 박스로 알 수 없고(제조 시기·ROSMASTER 가 미리
올려 뒀는지에 달림) **첫 부팅 화면에서만 판별된다.** 그래서 모니터가 필수 준비물이 됐다.

---

## 2. 준비물

```
[ ] 개발자 키트 박스 (P3767-0005 모듈 + P3768-0000 캐리어 + DC 어댑터) ← 모듈만 꺼내 쓴다
[ ] ★ 모니터 + DisplayPort 케이블(또는 DP→HDMI 어댑터) — 캐리어 영상 출력은 DP 하나뿐
    분기 A/B 판별은 화면으로만 가능하다. 없으면 부팅 실패 원인을 볼 수 없다
[ ] ★ USB 키보드 — UEFI 메뉴 진입용
[ ] 써멀패드 — 모듈↔히트싱크 사이. 분리 시 찢어지면 방열 성능이 떨어진다
[ ] 십자 드라이버(정밀) · ESD 손목띠 또는 금속 접지
[ ] 구 4GB 모듈 보관용 정전기 봉투 ← 롤백 수단이므로 버리지 말 것
[ ] (분기 B 대비) microSD 64GB 이상 — 새 캐리어에서 새 모듈을 독립 부팅시키는 데 쓴다
[ ] (분기 B 최후) x86 우분투 22.04 + USB-C 데이터 케이블 + L4T R36.4.3 BSP
```

분기 B 는 §1-c 때문에 확률이 낮지 않다. 대신 **새 캐리어가 통째로 따라와서 비용이 내려갔다** —
프로덕션 NVMe 를 건드리지 않는 실험대가 생겼다(§5 분기 B).

---

## 3. 백업 — 완료됨 (2026-09-05)

```
~/Documents/조달청-공모전 관련자료/YOLO ML DATA/cam03_data_D0_1회차/
  cam03_data/          D-0 1회차 181장 + manifest.jsonl
  cam03_probe.py       ← git 미추적이었음
  voice_ctrl_test.py   ← git 미추적이었음
  phone_ppe_relay.py
```

가중치 v3~v6 `.pt` 는 이미 `YOLO ML DATA/` 에 있다. **젯슨에만 있던 것은 위 넷뿐이고
전부 회수했다.** eMMC 가 없어 OS·CUDA·TensorRT 는 캐리어 보드의 NVMe 에 남는다 —
모듈만 갈면 SSD 는 그대로 따라온다.

---

## 4. 교체 절차

### 4-1. 분리

```
1. sudo poweroff  →  전원 어댑터 분리  →  1분 대기(잔류 전하)
2. ESD 접지
3. 팬 커넥터 분리 → 히트싱크 나사 → 히트싱크 들어올림
   ★ 써멀패드가 모듈에 붙어 올라오는지 히트싱크에 남는지 확인. 찢으면 교체
4. 모듈 고정나사 2개 → 모듈이 30° 로 튀어오름 → 비스듬히 뽑음
5. 구 4GB 모듈을 정전기 봉투에 보관
```

### 4-2. 장착

```
6. 8GB 모듈을 30° 로 슬롯에 끝까지 삽입 → 눌러 눕힘 → 나사 2개 조임
7. 써멀패드 정위치 → 히트싱크 → 팬 커넥터
8. ★ 모니터(DP)·키보드 연결 → 전원 연결 → 부팅
   화면 없이 켜면 분기 A/B 를 구별할 수 없다. SSH 가 안 붙는 이유가 펌웨어인지
   조립 실수인지 네트워크인지 화면이 말해 준다
```

---

## 5. 부팅 결과에 따라 분기

### ★ 분기 A — 부팅 성공 (예상 경로)

```bash
# ① 지금 QSPI 가 몇인지 본다. 이미 36.4.3 이면 ②는 건너뛴다
sudo nvbootctrl dump-slots-info

# ② A·B 슬롯 모두에 36.4.3 부트로더를 쓴다 (새 모듈은 두 슬롯 다 공장 펌웨어다)
sudo nv_update_engine -f --payload /opt/ota_package/bl_update_payload

# ③ 재부팅으로 캡슐 적용
sudo reboot

# ④ 적용 확인 — Current version 36.4.3 / Capsule update status 0
sudo nvbootctrl dump-slots-info
```

⚠ **②~③ 진행 중 전원을 끊지 말 것.** 부트로더를 쓰는 중이다.

### 분기 B — 부팅 실패 (공장 펌웨어가 R35.x 등으로 너무 낮은 경우 · §1-c)

리눅스가 안 뜨면 캡슐 경로를 못 쓴다. **바로 플래시로 가지 말고 B-0 부터.**

```
B-0. ★ 구 4GB 모듈을 되꽂아 부팅을 확인한다.
     → 뜬다   : 문제는 새 모듈 펌웨어다. 분기 B 확정. 시스템은 무사하다.
     → 안 뜬다 : 조립 문제다(써멀·팬 커넥터·나사·모듈 안착). 새 모듈 탓이 아니다. 재조립.
     이 한 단계가 "내가 망가뜨렸나" 와 "새 모듈 펌웨어인가" 를 갈라준다. 건너뛰면
     두 원인을 동시에 쫓게 된다.
```

```
B-1. 새 캐리어(박스 것)에 새 모듈을 얹는다. 프로덕션 NVMe 는 구 캐리어에 그대로 둔다.
     이 조합에는 NVMe 가 물리적으로 없으므로 무엇을 해도 데이터가 날아갈 수 없다 —
     종전 "SSD 를 뽑아라" 규칙이 구조로 충족된다.
B-2. 모니터로 UEFI 버전을 읽는다 (부팅 로고 화면 · ESC 로 UEFI 메뉴).
     35.x 면 §1-c 의 예상대로다. 이 숫자를 기록한다.
B-3. 펌웨어를 36.x 로 올리는 절차는 NVIDIA 공식 문서에서 확인한다.
     ⚠ 검색: "Jetson Orin Nano Developer Kit" + "firmware update" / "Initial Firmware Update"
     ⚠ R35 UEFI 가 36.x SD 이미지를 곧바로 부팅한다는 보장이 없다 — 중간 단계가
       요구될 수 있다. 문서가 시키는 순서를 따른다.
     ⚠ 기억으로 친 명령을 쓰지 말 것 (종전 규칙 그대로).
     경로 후보 = ⓐ microSD 에 JetPack SD 이미지 → 새 캐리어에서 부팅 → 캡슐 업데이트
                ⓑ x86 우분투 + SDK Manager 또는 BSP flash.sh (QSPI 전용 설정)
B-4. 새 모듈 QSPI 가 36.4.3 이 되면 → 구 캐리어(NVMe)로 옮겨 장착 → 분기 A ④ 로 합류.
```

ⓑ 를 구 캐리어에서 할 수밖에 없는 상황이라면 종전 규칙이 되살아난다.

```
★★ 플래시 전에 M.2 SSD 를 물리적으로 뽑을 것 ★★
   플래시 설정을 잘못 줘도 NVMe 를 지울 수 없게 만드는 하드웨어 보증이다.
   QSPI 플래시는 모듈 내장 플래시만 건드리므로 SSD 없이 진행된다.
   REC 버튼(또는 FC REC 점퍼) 누른 채 전원 → 호스트 lsusb 에 0955:7523 (NVIDIA APX).
```

---

## 6. 교체 성공 판정 — 이 셋이 다 맞아야 완료

### ① TPC 마스크가 일치하는가 ← 가장 확실한 증거

```bash
sudo nvpmodel -q --verbose | grep TPC_POWER_GATING
```

```
교체 전   REAL_VAL: 252   CONF_VAL: 240    ← 어긋남 (4GB)
교체 후   REAL_VAL: 240   CONF_VAL: 240    ← 일치해야 함 (8GB)
```

### ② 메모리·SM 이 두 배인가

```bash
free -m | head -2          # total 이 ~7400 대로
python3 -c "import torch;p=torch.cuda.get_device_properties(0);print(p.name,'SM',p.multi_processor_count,round(p.total_memory/1e9,2),'GB')"
```

```
교체 전   SM 4  3.78 GB
교체 후   SM 8  ~7.4 GB
```

### ③ nvpmodel 이 MAXN_SUPER 인가

```bash
sudo nvpmodel -q
```

`/etc/nvpmodel.conf` 는 **이미 `nvpmodel_p3767_0003_super.conf`(8GB 표)를 가리키고 있다.**
플래시 당시 8GB 개발키트 설정으로 구워진 4GB 모듈이었기 때문이다. → **교체 후 이 심링크는
저절로 맞는다. 손댈 것 없다.**

---

## 7. 교체 후 필수 작업

### 7-1. TensorRT 엔진 재빌드 ← 건너뛰지 말 것

지금도 TRT 가 경고를 뱉는다.

```
[TRT] [W] Using an engine plan file across different models of devices is not
          recommended and is likely to affect performance or even cause errors.
```

현재 엔진은 다른 기기에서 구워진 것이다. SM 이 4→8 로 바뀌면 **반드시 다시 굽는다.**
`.pt` 는 맥(`YOLO ML DATA/`)과 젯슨 양쪽에 있다.

### 7-2. 성능 비교

```bash
python3 /home/jetson/bench_engine.py ppe_yolo26s_640_v5_nc.engine
```

교체 전 기준선 (2026-09-05 실측 · 640x360 · 150회).

```
전처리         3.22 ms
★ 추론        15.32 ms  (p95 23.38)   → 65.3 fps
후처리         1.39 ms
전체(벽시계)   20.84 ms               → 48.0 fps
```

⚠ **2026-09-07 실측 정정 — 지연은 거의 안 내려간다**(15.32 → 14.47 ms · −5.5% · 벽시계 20.84 → 20.24).
배치 1 yolo26s@640 은 SM 4 도 못 채우는 작업이라 GPU 가 2배가 돼도 지연이 비례하지 않고, 전·후처리는
CPU(불변)다. **8GB 가 붙었다는 증거는 지연이 아니라 §6-① TPC 마스크(240/240)와 §6-② SM 8 / 7.99 GB 다.**
"내려가지 않으면 잘못 붙은 것" 이라던 사전 판정 기준은 틀렸다. 얻은 것은 지연이 아니라 **여유**(추론 중
6GB · 엔진 2개 · yolo26m · 960 입력 · 다중 스트림)다.
⚠ 오후 정정 — 위 두 값 모두 DVFS 가 풀린 상태다. `sudo jetson_clocks`(1020 MHz 고정) 후 같은 640 엔진이
**7.41 ms**. 재부팅하면 풀리므로 영속화 필요(리서치 문서 ④). 4GB 고정값은 미측정이라 하드웨어 이득 폭은
미확정.

### 7-3. 문서 갱신

```
ml/ppe-detection/README.md 208행    "⚠️ 배포 타깃 제약 — 4GB" 절 전면 수정
                                     "8GB 기준 벤치마크 쓰면 안 된다" 경고 해소
ml/ppe-detection/context-notes.md   트랙 H-5 에 교체 후 실측값 추가
cctv-ai/cctv-최적설정-리서치.md      35행·244행 4GB 기재 재검토
```

---

## 8. 롤백

구 4GB 모듈을 되꽂으면 원상복구된다. NVMe 는 건드리지 않았으므로 OS·데이터 그대로다.
단 분기 A 를 이미 실행했다면 새 모듈의 QSPI 만 36.4.3 이 된 것이고, **구 모듈의 QSPI 는
원래 36.4.3 이라 그대로 돌아온다.** 그래서 구 모듈을 버리지 않는 것이 롤백의 전부다.

롤백해도 새 모듈은 새 캐리어에서 따로 다룰 수 있다(§5 B-1). 프로덕션을 되살린 뒤 시간을
들여 새 모듈 펌웨어를 올리고, 준비가 끝난 날 다시 교체하면 된다 — 하루에 끝내야 할 이유가
없어졌다.

---

## 9. 변하지 않는 것

```
DLA        없음 → 없음.  Orin Nano 는 4GB·8GB 모두 DLA 가 없다(Orin NX 부터).
                        /dev/nvhost-nvdla* 부재로 2026-09-05 확정.
CC         8.7 → 8.7.   엔진 재빌드는 SM 수 변화 때문이지 아키텍처 변경 때문이 아니다.
데이터     NVMe 유지.   eMMC 가 없어 모듈에는 부트로더(QSPI)만 있다.
```

## 10. 미해결 (참고)

`trtexec` 이 `LLVM ERROR: out of memory` 로 죽는다. 4GB 여유 2.7GB 에서 재현됐고,
**2026-09-07 8GB · 여유 6GB 에서도 똑같이 죽는다 → 메모리와 무관 확정.** JetPack 6.2 동봉
`trtexec` 바이너리 자체 문제다. 성능 측정은 `bench_engine.py` 로 고정한다.

---

## 11. 실행 기록 — 2026-09-07 (월) · 분기 A · 성공

```
10:34  sudo poweroff → 17초 뒤 SSH 끊김 (가동 35일 · tj 48.3 °C · 추론 프로세스 0)
~11:00 모듈 교체(사용자) · 모니터 DP 연결 · 전원 → 텍스트 로그인 화면 = 분기 A
11:02  첫 SSH — DTB p3767-0005 · QSPI 36.4.7 · TPC 240/240 · 7,619 MB · SM 8 · MAXN_SUPER
11:04  구 엔진 백업(ppe_yolo26s_640_v5_nc.engine.4gb-bak) · 엔진 재빌드 시작
11:13  Engine generation 522.5 s · export 538.1 s · 21.4 MB
11:14  bench_engine.py — 추론 14.47 ms (p95 20.06) · 69.1 fps · 벽시계 20.24 ms · 49.4 fps
11:15  trtexec 재시도 → 8GB 에서도 LLVM OOM (§10 확정)
```

**분기 A-② 는 실행하지 않았다.** 새 모듈 QSPI(36.4.7)가 rootfs(36.4.3)보다 새로워 캡슐을 쓰면
다운그레이드가 된다. 부팅 시 `nv-l4t-bootloader-config` 도 "QSPI 2360327 > deb 2360323" 을 보고
예약하지 않았다(`UpdateCapsule/` 비어 있음). 마이너 차이는 그대로 둔다.

"로그인 화면" 은 텍스트 콘솔이었다 — gdm/lightdm 이 설치·가동돼 있지 않다(07-27 헤드리스 전환의
결과). §4-2 ⑧ 의 모니터는 그래도 필요했다 — 분기 판별은 그 화면이 했다. GUI 내리기는 무동작.

⚠ 빌드 감시 함정 — ultralytics 로그에 `export success` 가 **두 번** 찍힌다(ONNX 6초 · TensorRT 538초).
첫 번째를 완료로 잡으면 옛 엔진으로 벤치하게 된다. `.engine` 이 붙은 줄만 성공으로 본다.

**구 4GB 모듈 + 박스 캐리어 + 어댑터 = 두 번째 젯슨의 재료다.** 빠진 것은 **저장장치뿐** —
0004 는 eMMC·SD 슬롯이 없어 저장장치 0 이면 못 켠다(모듈엔 부트로더만 있고 커널·OS 는 외부 드라이브).
8GB 쪽 NVMe 를 나눠 쓸 방법도 없다. NVMe 256GB(현재 사용 103GB)를 넣고 8GB 젯슨에서 `dd` 로
통째 복제하면 우분투 호스트 없이 뜬다 — 복제 후 hostname·`/etc/machine-id`·`/var/lib/tailscale`·
SSH host key 를 반드시 바꾼다. UEFI 는 USB 저장장치도 부팅 후보로 잡으므로 USB SSD 로도 임시 가동은
된다. 4GB 용 엔진은 `.4gb-bak` 그대로 쓴다.
