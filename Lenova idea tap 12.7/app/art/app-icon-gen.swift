import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
let srcPath = args[1], outDir = args[2]
let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: srcPath) as CFURL, nil)!
let image = CGImageSourceCreateImageAtIndex(src, 0, nil)!
let cs = CGColorSpaceCreateDeviceRGB()

func bitmap(_ w: Int, _ h: Int) -> CGContext {
    let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.interpolationQuality = .high
    return ctx
}
func save(_ img: CGImage, _ path: String) {
    let url = URL(fileURLWithPath: path)
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, img, nil); CGImageDestinationFinalize(dest)
}
// 원본 픽셀 읽기 (RGBA)
let W = image.width, H = image.height
let rawCtx = bitmap(W, H); rawCtx.draw(image, in: CGRect(x: 0, y: 0, width: W, height: H))
let raw = rawCtx.data!.bindMemory(to: UInt8.self, capacity: W * H * 4)
func px(_ x: Int, _ y: Int) -> (Int, Int, Int) { let i = (y * W + x) * 4; return (Int(raw[i]), Int(raw[i+1]), Int(raw[i+2])) }
// 배경색 표본: 모서리(어두운 파랑)와 방패 안쪽 상단(밝은 파랑)
let edge = px(20, 20), inner = px(W/2, Int(Double(H) * 0.36))
// 방패 마스크: 흰색(고휘도·저채도) 픽셀만 알파로
let maskCtx = bitmap(W, H); let m = maskCtx.data!.bindMemory(to: UInt8.self, capacity: W * H * 4)
for y in 0..<H { for x in 0..<W {
    let (r, g, b) = px(x, y)
    let mn = min(r, min(g, b)), mx = max(r, max(g, b))
    // 흰색은 R,G,B 모두 높고 차이가 작다. 파랑은 R이 낮다.
    // 배경 파랑은 R 이 10 안팎, 방패는 흰색~연한 청록이라 R 이 120 이상. R 만으로 가른다.
    _ = mn; _ = mx
    var a = (Double(r) - 85.0) / 90.0   // 방패 아래 연한 파랑 광택(R 40~80)은 뺀다
    a = max(0, min(1, a))
    let i = (y * W + x) * 4
    let v = UInt8(255 * a)
    m[i] = v; m[i+1] = v; m[i+2] = v; m[i+3] = v   // premultiplied white
}}
let shield = maskCtx.makeImage()!
// 방패 실제 경계 상자
var minX = W, minY = H, maxX = 0, maxY = 0
for y in 0..<H { for x in 0..<W { if m[(y*W+x)*4+3] > 40 { minX = min(minX,x); maxX = max(maxX,x); minY = min(minY,y); maxY = max(maxY,y) } } }
let box = CGRect(x: minX, y: minY, width: maxX-minX+1, height: maxY-minY+1)
print("shield box", box)
// CGImage 는 위가 0, 버퍼는 아래가 0 → 세로를 뒤집어 자른다
let boxImg = CGRect(x: box.minX, y: Double(H) - box.maxY, width: box.width, height: box.height)
print("box in image coords", boxImg)
for band in stride(from: 0, to: H, by: 100) {
    var n = 0
    for y in band..<min(H, band+100) { for x in 0..<W { if m[(y*W+x)*4+3] > 40 { n += 1 } } }
    print("buffer rows \(band)-\(band+99) (source yTop \(H-band-100)..\(H-band-1)) mask px:", n)
}
let shieldCrop = shield.cropping(to: boxImg)!

func radial(_ ctx: CGContext, _ size: Int) {
    let colors = [CGColor(red: CGFloat(inner.0)/255, green: CGFloat(inner.1)/255, blue: CGFloat(inner.2)/255, alpha: 1),
                  CGColor(red: CGFloat(edge.0)/255, green: CGFloat(edge.1)/255, blue: CGFloat(edge.2)/255, alpha: 1)] as CFArray
    let grad = CGGradient(colorsSpace: cs, colors: colors, locations: [0, 1])!
    let c = CGPoint(x: Double(size)/2, y: Double(size)*0.55)
    ctx.drawRadialGradient(grad, startCenter: c, startRadius: 0, endCenter: c, endRadius: Double(size)*0.75, options: [.drawsAfterEndLocation])
}
// 적응형 아이콘: 108dp 캔버스, 안전영역 66dp(61%). 방패 높이를 캔버스의 52%로.
let dens: [(String, Double)] = [("mdpi",1),("hdpi",1.5),("xhdpi",2),("xxhdpi",3),("xxxhdpi",4)]
for (name, d) in dens {
    let s = Int(108 * d)
    // foreground (투명 배경 + 흰 방패)
    let fg = bitmap(s, s)
    let targetH = Double(s) * 0.52
    let scale = targetH / Double(box.height)
    let tw = Double(box.width) * scale, th = targetH
    fg.draw(shieldCrop, in: CGRect(x: (Double(s)-tw)/2, y: (Double(s)-th)/2, width: tw, height: th))
    save(fg.makeImage()!, "\(outDir)/mipmap-\(name)/ic_launcher_foreground.png")
    // background (파랑 방사 그라데이션)
    let bg = bitmap(s, s); radial(bg, s)
    save(bg.makeImage()!, "\(outDir)/mipmap-\(name)/ic_launcher_background.png")
    // legacy 48dp: 그라데이션 + 방패 70%
    let l = Int(48 * d); let lg = bitmap(l, l); radial(lg, l)
    let lh = Double(l) * 0.62, ls = lh / Double(box.height), lw = Double(box.width) * ls
    lg.draw(shieldCrop, in: CGRect(x: (Double(l)-lw)/2, y: (Double(l)-lh)/2, width: lw, height: lh))
    let legacy = lg.makeImage()!
    save(legacy, "\(outDir)/mipmap-\(name)/ic_launcher.png")
    // round: 원형 클립
    let rc = bitmap(l, l); rc.addEllipse(in: CGRect(x: 0, y: 0, width: l, height: l)); rc.clip(); rc.draw(legacy, in: CGRect(x: 0, y: 0, width: l, height: l))
    save(rc.makeImage()!, "\(outDir)/mipmap-\(name)/ic_launcher_round.png")
}
// 미리보기용 512
let pv = bitmap(512, 512); radial(pv, 512)
let ph = 512.0 * 0.62, ps = ph / Double(box.height), pw = Double(box.width) * ps
pv.draw(shieldCrop, in: CGRect(x: (512-pw)/2, y: (512-ph)/2, width: pw, height: ph))
save(pv.makeImage()!, "\(outDir)/preview-512.png")
print("edge", edge, "inner", inner)
