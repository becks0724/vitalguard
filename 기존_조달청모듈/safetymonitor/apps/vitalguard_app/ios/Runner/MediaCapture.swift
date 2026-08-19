// 현장 사진·서류 촬영 → OCR → 하단 각인 → 관제 캘린더 업로드. 생체 경로와 완전히 분리한다.
//
// ★ 왜 새 파일인가. 생체 업로드(`VitalPipeline.ingest`)에 얹으면 두 가지가 걸린다 —
//   ① 관제웹 가드가 `func ingest(payload:` 앞 **고정 3200자 창**을 검사하는데 이미 두 번 밀렸고
//      주석이 세 번째를 경고한다. ② 사진은 MB 단위라 5초 배치 큐와 성격이 다르다(재시도·유실
//      계약이 다르다). 서로 건드리지 않는 편이 양쪽 다 안전하다.
//
// ★ 서버는 이미 있다 — `POST /api/app-media` 가 Object Storage 업로드 + 캘린더 DB 등록을
//   한 번에 처리한다(2026-08-19 실왕복 실측: HTTP 200 · 버킷 실물 · 프리사인 GET 바이트 일치).
//   **로그인 JWT 를 그대로 받으므로 공유 토큰을 앱에 굽지 않는다** — 서버가 JWT 신원을
//   폼 값보다 강제해 타인 귀속 위조까지 막는다.
import CoreLocation
import Photos
import UIKit
import Vision
import VisionKit

final class MediaCapture: NSObject {
    static let shared = MediaCapture()
    private override init() {}

    enum Mode: String {
        case scan   // 서류 — VisionKit 문서 스캐너(여러 장·자동 보정·원근 교정)
        case photo  // 현장 사진 — 카메라 1장
    }

    /// 각인·업로드 결과. Flutter 로 그대로 넘어간다.
    private var completion: (([String: Any]) -> Void)?
    private let geocoder = CLGeocoder()

    /// 업로드 전 긴 변 상한(px). 4,800만 화소 원본을 그대로 올리면 한 장이 10MB 를 넘고,
    /// 서버가 요청 전체를 메모리에 올려 처리하므로(Cloud Run 1Gi·동시성 80) 동시 업로드에서
    /// 인스턴스가 위험해진다. **OCR 은 원본으로 돌리고 업로드본만 줄인다** — 글자 인식률은
    /// 원본이 결정하고, 사람이 보는 사진은 이 크기로 충분하다.
    private static let maxUploadEdge: CGFloat = 2400
    private static let jpegQuality: CGFloat = 0.85

    // MARK: - 진입점

    func start(mode: Mode, completion: @escaping ([String: Any]) -> Void) {
        guard AuthStore.token != nil else {
            completion(["ok": false, "error": "로그인이 필요합니다."])
            return
        }
        guard self.completion == nil else {
            completion(["ok": false, "error": "이미 촬영 중입니다."])
            return
        }
        guard let root = Self.rootViewController() else {
            completion(["ok": false, "error": "촬영 화면을 열 수 없습니다."])
            return
        }
        self.completion = completion

        switch mode {
        case .scan:
            // ⚠ 지원 여부를 먼저 본다 — 미지원 기기에서 present 하면 빈 화면이 뜬다.
            guard VNDocumentCameraViewController.isSupported else {
                finish(["ok": false, "error": "이 기기는 문서 스캔을 지원하지 않습니다."])
                return
            }
            let vc = VNDocumentCameraViewController()
            vc.delegate = self
            root.present(vc, animated: true)
        case .photo:
            guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
                finish(["ok": false, "error": "카메라를 쓸 수 없습니다."])
                return
            }
            let vc = UIImagePickerController()
            vc.sourceType = .camera
            vc.delegate = self
            root.present(vc, animated: true)
        }
    }

    private func finish(_ payload: [String: Any]) {
        let done = completion
        completion = nil
        DispatchQueue.main.async { done?(payload) }
    }

    private static func rootViewController() -> UIViewController? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)?
            .rootViewController
    }

    // MARK: - 처리 파이프라인

    /// 촬영본 → (OCR · 좌표 · 주소) → 각인 → 업로드. 페이지마다 캘린더 항목 한 건이 된다.
    private func process(images: [UIImage]) {
        guard !images.isEmpty else {
            finish(["ok": false, "error": "촬영된 이미지가 없습니다."])
            return
        }
        // ★ 좌표를 **촬영 시점에 요청**한다. 정지 상태에서는 `currentFix()` 가 nil 이라
        //   여기서 요청하지 않으면 각인의 위치 두 줄이 통째로 빈다(2026-08-19 실측).
        LocationProvider.shared.requestFreshFix { [weak self] fix in
            guard let self else { return }
            self.resolveAddress(fix) { address in
                DispatchQueue.global(qos: .userInitiated).async {
                    self.stampAndUpload(images: images, fix: fix, address: address)
                }
            }
        }
    }

    /// 좌표 → 도로명 주소. 실패해도 업로드는 계속한다(주소는 있으면 좋은 값이지 조건이 아니다).
    private func resolveAddress(_ fix: [String: Any]?, done: @escaping (String?) -> Void) {
        guard let lat = fix?["latitude"] as? Double, let lon = fix?["longitude"] as? Double else {
            done(nil)
            return
        }
        let loc = CLLocation(latitude: lat, longitude: lon)
        geocoder.reverseGeocodeLocation(loc, preferredLocale: Locale(identifier: "ko_KR")) { marks, _ in
            guard let p = marks?.first else { done(nil); return }
            // 도로명 우선 — 없으면 지번 단위로 떨어진다. 나라별 필드 차이를 여기서 흡수한다.
            //
            // ⚠ **중복을 걷어낸다.** 광역시는 `administrativeArea` 와 `locality` 가 둘 다
            //   `광주광역시` 이고, 동 이름이 도로명과 같으면 `subLocality` 와 `thoroughfare` 도
            //   겹친다. 그대로 이으면 실측처럼
            //   `광주광역시 광주광역시 금남로3가 금남로3가 15-2` 가 찍힌다(2026-08-19 실기기).
            let parts = [p.administrativeArea, p.locality, p.subLocality, p.thoroughfare, p.subThoroughfare]
            var seen: [String] = []
            for part in parts.compactMap({ $0?.trimmingCharacters(in: .whitespaces) }) where !part.isEmpty {
                if !seen.contains(part) { seen.append(part) }
            }
            let text = seen.joined(separator: " ")
            done(text.isEmpty ? nil : text)
        }
    }

    private func stampAndUpload(images: [UIImage], fix: [String: Any]?, address: String?) {
        let capturedAt = Date()
        var uploaded = 0
        var failed = 0
        var saved = 0
        var lastError: String?

        for (index, image) in images.enumerated() {
            // OCR 은 **원본**으로 돌린다 — 줄여서 인식하면 작은 글자가 먼저 사라진다.
            let text = Self.recognizeText(in: image)
            let page = "페이지 \(index + 1)\n\(text.isEmpty ? "[텍스트 미검출]" : text)"

            let lines = Self.stampLines(at: capturedAt, fix: fix, address: address)
            let stamped = Self.stamp(image: Self.downscaled(image), lines: lines)
            guard let jpeg = stamped.jpegData(compressionQuality: Self.jpegQuality) else {
                failed += 1
                lastError = "이미지 변환 실패"
                continue
            }

            let ocrText = ([page] + lines).joined(separator: "\n")
            let result = Self.upload(jpeg: jpeg, capturedAt: capturedAt, fix: fix, address: address, ocrText: ocrText)
            if result == nil { uploaded += 1 } else { failed += 1; lastError = result }

            // ★ 업로드 성패와 무관하게 사진첩에도 남긴다(사용자 요청). 업로드가 실패했을 때
            //   기기에 사본이 없으면 **찍은 것이 통째로 사라진다** — 재촬영 말고는 복구가 없다.
            //   업로드한 바이트를 그대로 넣으므로 각인이 찍힌 같은 사진이다.
            if Self.saveToPhotos(jpeg: jpeg) { saved += 1 }
        }

        finish([
            "ok": failed == 0,
            "uploaded": uploaded,
            "failed": failed,
            "saved": saved,
            "error": lastError as Any,
        ])
    }

    // MARK: - OCR

    /// 온디바이스 Vision OCR. 한국어·영어를 함께 인식한다(현장 서류가 섞여 있다).
    private static func recognizeText(in image: UIImage) -> String {
        guard let cg = image.cgImage else { return "" }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.recognitionLanguages = ["ko-KR", "en-US"]
        let handler = VNImageRequestHandler(cgImage: cg, orientation: .up, options: [:])
        do {
            try handler.perform([request])
        } catch {
            return ""
        }
        let obs = request.results ?? []
        return obs.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
    }

    // MARK: - 각인

    /// 사진 하단에 찍는 4줄. **서버 파서(`lib/ocr-stamp.ts`)가 읽는 형식과 같아야 한다** —
    /// 앱이 구조화 필드를 함께 보내지만, 그 필드가 빠진 경우 서버가 이 스탬프를 파싱해 채운다.
    static func stampLines(at date: Date, fix: [String: Any]?, address: String?) -> [String] {
        var lines = ["[\(kstStamp(date))]"]
        if let address { lines.append(address) }
        if let lat = fix?["latitude"] as? Double, let lon = fix?["longitude"] as? Double {
            lines.append(String(format: "%.6f, %.6f", lat, lon))
        }
        // ★ 위치가 없으면 **없다고 적는다**. 두 줄을 그냥 비우면 "위치가 안 찍히는 사진" 과
        //   "위치를 못 받은 사진" 이 같은 모양이 된다.
        if fix == nil { lines.append("위치 미확보") }
        let name = AuthStore.userName ?? "-"
        let id = AuthStore.workerId ?? "-"
        lines.append("작업자/ID: \(name), \(id)")
        return lines
    }

    /// `2026-08-19 14:07:17` — 서버 파서가 이 형식을 읽는다. KST 고정.
    static func kstStamp(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Asia/Seoul")
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return f.string(from: date)
    }

    /// `2026-08-19T14:07:17+09:00` — 서버 계약이 **KST 로컬 ISO** 다.
    /// ⚠ UTC(`...Z`)로 보내면 화면 시각이 9시간 어긋난다(구 앱이 실제로 그랬다).
    static func kstIso(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Asia/Seoul")
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ssXXXXX"
        return f.string(from: date)
    }

    private static func downscaled(_ image: UIImage) -> UIImage {
        let longest = max(image.size.width, image.size.height)
        guard longest > maxUploadEdge else { return image }
        let scale = maxUploadEdge / longest
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }

    private static func stamp(image: UIImage, lines: [String]) -> UIImage {
        let size = image.size
        // 글자 크기를 폭에 비례시킨다 — 고정 pt 로 두면 축소본에서 읽을 수 없다.
        let fontSize = max(14, size.width * 0.026)
        let pad = fontSize * 0.5
        let lineHeight = fontSize * 1.32
        let barHeight = lineHeight * CGFloat(lines.count) + pad * 2

        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { ctx in
            image.draw(in: CGRect(origin: .zero, size: size))
            let bar = CGRect(x: 0, y: size.height - barHeight, width: size.width, height: barHeight)
            ctx.cgContext.setFillColor(UIColor.black.withAlphaComponent(0.62).cgColor)
            ctx.cgContext.fill(bar)

            let attrs: [NSAttributedString.Key: Any] = [
                .font: UIFont.monospacedDigitSystemFont(ofSize: fontSize, weight: .semibold),
                .foregroundColor: UIColor.white,
            ]
            for (i, line) in lines.enumerated() {
                let y = bar.minY + pad + CGFloat(i) * lineHeight
                (line as NSString).draw(at: CGPoint(x: pad, y: y), withAttributes: attrs)
            }
        }
    }

    // MARK: - 사진첩 저장

    /// 각인본을 기기 사진첩에 남긴다. 성공이면 true.
    ///
    /// ★ **추가 전용 권한**(`.addOnly`)만 쓴다 — 앨범을 만들거나 기존 사진을 읽으려면 전체
    ///   접근이 필요한데, 이 기능에는 필요 없는 권한이다. 최소 권한으로 두면 사용자가
    ///   "내 사진을 다 본다" 를 걱정할 이유가 없다.
    ///
    /// ★ 업로드본과 **같은 바이트**를 넣는다(`addResource(with: .photo, data:)`). UIImage 로
    ///   다시 그리면 재인코딩돼 각인 글자가 뭉개지고 용량도 달라진다.
    ///
    /// ⚠ 실패해도 촬영 전체를 실패로 만들지 않는다 — 업로드는 이미 끝났고, 사진첩은 사본이다.
    private static func saveToPhotos(jpeg: Data) -> Bool {
        let sem = DispatchSemaphore(value: 0)
        var granted = false
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            granted = (status == .authorized || status == .limited)
            sem.signal()
        }
        sem.wait()
        guard granted else { return false }

        var ok = false
        let done = DispatchSemaphore(value: 0)
        PHPhotoLibrary.shared().performChanges({
            let req = PHAssetCreationRequest.forAsset()
            req.addResource(with: .photo, data: jpeg, options: nil)
        }, completionHandler: { success, _ in
            ok = success
            done.signal()
        })
        done.wait()
        return ok
    }

    // MARK: - 업로드

    /// 성공이면 nil, 실패면 사유. 동기 호출이다(호출부가 백그라운드 큐).
    private static func upload(
        jpeg: Data,
        capturedAt: Date,
        fix: [String: Any]?,
        address: String?,
        ocrText: String
    ) -> String? {
        guard let token = AuthStore.token else { return "로그인이 필요합니다." }
        let iso = kstIso(capturedAt)
        var fields: [String: String] = [
            "capturedAt": iso,
            "dateKey": String(iso.prefix(10)),
            "ocrText": ocrText,
        ]
        if let address { fields["roadAddress"] = address }
        if let lat = fix?["latitude"] as? Double { fields["latitude"] = String(format: "%.6f", lat) }
        if let lon = fix?["longitude"] as? Double { fields["longitude"] = String(format: "%.6f", lon) }
        // ⚠ 이름·사번은 보내되 **서버가 JWT 신원으로 덮는다**(위조 방지). 여기 값은 표시 보조다.
        if let name = AuthStore.userName { fields["workerName"] = name }
        if let id = AuthStore.workerId { fields["workerId"] = id }

        let boundary = "vg-\(UUID().uuidString)"
        var body = Data()
        for (k, v) in fields {
            body.append("--\(boundary)\r\n")
            body.append("Content-Disposition: form-data; name=\"\(k)\"\r\n\r\n")
            body.append("\(v)\r\n")
        }
        body.append("--\(boundary)\r\n")
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"capture.jpg\"\r\n")
        body.append("Content-Type: image/jpeg\r\n\r\n")
        body.append(jpeg)
        body.append("\r\n--\(boundary)--\r\n")

        var request = URLRequest(url: VitalPipeline.resolvedBaseURL().appendingPathComponent("api/app-media"))
        request.httpMethod = "POST"
        request.timeoutInterval = 60
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body

        let sem = DispatchSemaphore(value: 0)
        var failure: String?
        URLSession.shared.dataTask(with: request) { data, response, error in
            defer { sem.signal() }
            if let error { failure = error.localizedDescription; return }
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard code == 200 else {
                let detail = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                failure = "업로드 실패(\(code)) \(detail.prefix(120))"
                return
            }
        }.resume()
        sem.wait()
        return failure
    }
}

// MARK: - 촬영 델리게이트

extension MediaCapture: VNDocumentCameraViewControllerDelegate {
    func documentCameraViewController(
        _ controller: VNDocumentCameraViewController,
        didFinishWith scan: VNDocumentCameraScan
    ) {
        controller.dismiss(animated: true)
        let images = (0..<scan.pageCount).map { scan.imageOfPage(at: $0) }
        process(images: images)
    }

    func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
        controller.dismiss(animated: true)
        finish(["ok": false, "cancelled": true])
    }

    func documentCameraViewController(
        _ controller: VNDocumentCameraViewController,
        didFailWithError error: Error
    ) {
        controller.dismiss(animated: true)
        finish(["ok": false, "error": error.localizedDescription])
    }
}

extension MediaCapture: UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    func imagePickerController(
        _ picker: UIImagePickerController,
        didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
    ) {
        picker.dismiss(animated: true)
        guard let image = info[.originalImage] as? UIImage else {
            finish(["ok": false, "error": "사진을 읽지 못했습니다."])
            return
        }
        process(images: [image])
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true)
        finish(["ok": false, "cancelled": true])
    }
}

private extension Data {
    mutating func append(_ string: String) {
        if let d = string.data(using: .utf8) { append(d) }
    }
}
