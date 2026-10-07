import json, urllib.request, time, sys
port = sys.argv[1]
def h():
    return json.load(urllib.request.urlopen("http://127.0.0.1:%s/health" % port, timeout=6))
sf = []
d0 = h(); i0, t0 = d0["infers"], time.monotonic()
for _ in range(10):
    time.sleep(3)
    d = h(); sf.append(d["stream_fps"])
d1 = h(); i1, t1 = d1["infers"], time.monotonic()
sf.sort()
print("stream_fps  n=%d  min %.2f  median %.2f  max %.2f  폭 %.1f%%" % (
    len(sf), sf[0], sf[len(sf)//2], sf[-1], (sf[-1]-sf[0])/sf[len(sf)//2]*100))
print("추론 실측    %.2f fps  (infers %d건 / %.1f초)  · 설정 상한 %.1f · infer_ms %.2f" % (
    (i1-i0)/(t1-t0), i1-i0, t1-t0, d1["cfg"]["infer_fps"], d1["infer_ms"]))
print("GPU 점유     %.1f%%  (추론fps × infer_ms)" % ((i1-i0)/(t1-t0)*d1["infer_ms"]/10.0))
