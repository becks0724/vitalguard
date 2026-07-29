// C2 — features.py 의 88 핸드크래프트 피처를 수치 동일하게 Swift 포팅.
// 채널 7개(accel xyz + gyro xyz + |accel|) × 12 시간/주파수 피처 + 도메인 4개 = 88.
// v5에서는 MLSelfCheck가 88개 특성 스키마와 Core ML 입출력을 검증한다.
//
// ponytail: DFT는 O(n²) 나이브 구현 — n≤150·이벤트 시에만 실행이라 ~ms, vDSP 세팅 비용이 더 큼.
import Foundation

enum FeatureExtractor {
    static let count = 88

    /// samples: 시간순 [ax,ay,az,gx,gy,gz], fs: 샘플레이트 → 88피처 (features.py extract 와 동일 순서)
    static func extract(_ samples: [[Double]], fs: Double) -> [Double] {
        let n = samples.count
        precondition(n > 1, "빈 윈도")
        // 채널 분해 + accel magnitude
        var chans = [[Double]](repeating: [Double](repeating: 0, count: n), count: 7)
        for i in 0..<n {
            for c in 0..<6 { chans[c][i] = samples[i][c] }
            let a = samples[i]
            chans[6][i] = (a[0]*a[0] + a[1]*a[1] + a[2]*a[2]).squareRoot()
        }
        var f: [Double] = []
        f.reserveCapacity(count)
        for c in chans { f += channelFeatures(c, fs: fs) }

        // 도메인 4개 (mag = chans[6])
        let mag = chans[6]
        f.append(mag.max()!)                                   // 최대 충격 G
        f.append(Double(mag.filter { $0 < 0.5 }.count) / Double(n))  // 자유낙하 비율
        let win = max(2, Int(0.4 * fs))
        var mv: [Double] = []
        var i = 0
        let stop = max(1, n - win)                             // python range(0, max(1, n-win), win)
        while i < stop { mv.append(std(Array(mag[i..<min(i+win, n)]))); i += win }
        f.append(mv.isEmpty ? 0 : Double(mv.filter { $0 < 0.1 }.count) / Double(mv.count))  // 무활동 비율
        var jerk = 0.0                                          // 평균 jerk
        for i in 1..<n { jerk += abs(mag[i] - mag[i-1]) }
        f.append(jerk / Double(n - 1) * fs)

        // nan_to_num 방어 (features.py 와 동일)
        return f.map { v in
            if v.isNaN { return 0 }
            if v.isInfinite { return v > 0 ? 1e6 : -1e6 }
            return v
        }
    }

    /// features.py _chan 과 동일: [mean, std, min, max, rms, mad, iqr, zcr, skew, kurt, domfreq, entropy]
    private static func channelFeatures(_ x: [Double], fs: Double) -> [Double] {
        let n = x.count
        let m = x.reduce(0, +) / Double(n)
        let s = std(x)
        let xc = x.map { $0 - m }
        let sd = s + 1e-9
        var rms = 0.0, mad = 0.0, m3 = 0.0, m4 = 0.0
        for i in 0..<n {
            rms += x[i] * x[i]
            mad += abs(xc[i])
            m3 += xc[i] * xc[i] * xc[i]
            m4 += xc[i] * xc[i] * xc[i] * xc[i]
        }
        rms = (rms / Double(n)).squareRoot(); mad /= Double(n); m3 /= Double(n); m4 /= Double(n)
        var zc = 0
        for i in 0..<(n-1) where xc[i] * xc[i+1] < 0 { zc += 1 }
        let skew = min(max(m3 / (sd*sd*sd), -50), 50)
        let kurt = min(max(m4 / (sd*sd*sd*sd), -50), 200)

        // rfft power spectrum (xc 기준, numpy 와 동일)
        let sp = rfftPower(xc)
        var dom = 0.0, ent = 0.0
        let total = sp.reduce(0, +)
        if total > 0 {
            var kmax = 0
            for k in 1..<sp.count where sp[k] > sp[kmax] { kmax = k }   // 첫 최대(numpy argmax)
            dom = Double(kmax) * fs / Double(n)                          // rfftfreq
            for p in sp {
                let pf = p / total
                ent -= pf * log(pf + 1e-12)
            }
        }
        return [m, s, x.min()!, x.max()!, rms, mad,
                percentile(x, 75) - percentile(x, 25),
                Double(zc) / Double(n - 1), skew, kurt, dom, ent]
    }

    private static func std(_ x: [Double]) -> Double {   // 모집단 std (numpy ddof=0)
        let m = x.reduce(0, +) / Double(x.count)
        return (x.reduce(0) { $0 + ($1-m)*($1-m) } / Double(x.count)).squareRoot()
    }

    private static func percentile(_ x: [Double], _ q: Double) -> Double {  // numpy 선형보간
        let a = x.sorted()
        let pos = q / 100 * Double(a.count - 1)
        let lo = Int(pos)
        if lo >= a.count - 1 { return a[a.count - 1] }
        return a[lo] + (pos - Double(lo)) * (a[lo+1] - a[lo])
    }

    /// |rfft(x)|² — 나이브 DFT, k = 0...n/2 (numpy rfft 출력 길이 n/2+1)
    private static func rfftPower(_ x: [Double]) -> [Double] {
        let n = x.count
        let half = n / 2
        var sp = [Double](repeating: 0, count: half + 1)
        let w = -2.0 * Double.pi / Double(n)
        for k in 0...half {
            var re = 0.0, im = 0.0
            for j in 0..<n {
                let a = w * Double(j) * Double(k)
                re += x[j] * cos(a)
                im += x[j] * sin(a)
            }
            sp[k] = re*re + im*im
        }
        return sp
    }
}
