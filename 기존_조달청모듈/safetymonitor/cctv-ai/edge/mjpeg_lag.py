# MJPEG 구간 지연을 OCR 없이 잰다 — 스트림 프레임의 해시를 스냅샷 이력에서 역추적한다.
# MJPEG 구간 지연을 OCR 없이 정확히 잰다.
# /snapshot 은 서버의 최신 프레임 바이트를 그대로 준다. 스트림으로 온 프레임의 해시를
# 스냅샷 이력에서 찾으면, 그 프레임이 「언제 서버에 있었는지」를 알 수 있다.
import threading, time, hashlib, urllib.request, collections
BASE="http://yahboom-1:8444"
hist=collections.OrderedDict()   # md5 -> 최초 관측 시각
stop=False
def poller():
    while not stop:
        try:
            with urllib.request.urlopen(BASE+"/snapshot?draw=1", timeout=5) as r:
                b=r.read()
            h=hashlib.md5(b).hexdigest()
            if h not in hist: hist[h]=time.time()
        except Exception: pass
        time.sleep(0.08)
t=threading.Thread(target=poller, daemon=True); t.start()
time.sleep(2.5)   # 이력을 먼저 쌓는다
lags=[]; n=0; t0=time.time(); nbytes=0
req=urllib.request.urlopen(BASE+"/stream", timeout=10)
buf=b""
while time.time()-t0 < 12:
    chunk=req.read(65536)
    if not chunk: break
    buf+=chunk; nbytes+=len(chunk)
    while True:
        i=buf.find(b"\xff\xd8"); j=buf.find(b"\xff\xd9", i+2)
        if i<0 or j<0: break
        jpg=buf[i:j+2]; buf=buf[j+2:]
        n+=1
        h=hashlib.md5(jpg).hexdigest()
        if h in hist: lags.append(time.time()-hist[h])
stop=True
dur=time.time()-t0
print("스트림 %.1f초 · 프레임 %d (%.1f fps) · %.0f KB/s" % (dur, n, n/dur, nbytes/dur/1024))
print("해시 매칭 %d건 / %d" % (len(lags), n))
if lags:
    lags.sort()
    import statistics as st
    print("  ★ MJPEG 구간 지연 — 중앙 %.3f초 · 5%% %.3f · 95%% %.3f · 최대 %.3f" %
          (st.median(lags), lags[int(len(lags)*.05)], lags[int(len(lags)*.95)], lags[-1]))
    print("  (스냅샷 폴링 간격 0.08초가 해상도 하한이다)")
else:
    print("  매칭 실패 — 스트림과 스냅샷이 다른 프레임을 낸다")
