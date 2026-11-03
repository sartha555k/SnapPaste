import AppKit
import Vision
import ApplicationServices
import Darwin

func emit(_ value: Any) throws {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
}
func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data(message.utf8)); exit(1)
}
let args = CommandLine.arguments
do {
    guard args.count > 1 else { fail("Missing helper command.") }
    switch args[1] {
    case "watch-clipboard":
        let pasteboard = NSPasteboard.general
        var previous = pasteboard.changeCount
        while true {
            autoreleasepool {
                let current = pasteboard.changeCount
                if current != previous {
                    previous = current
                    if pasteboard.availableType(from: [.png, .tiff]) != nil {
                        try? emit(["imageChanged": true])
                        fflush(stdout)
                    }
                }
            }
            Thread.sleep(forTimeInterval: 0.75)
        }
    case "frontmost":
        try emit(["pid": NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0])
    case "ocr":
        guard args.count == 3 else { fail("An image path is required.") }
        let url = URL(fileURLWithPath: args[2])
        let handler = VNImageRequestHandler(url: url)
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        try handler.perform([request])
        let observations = request.results ?? []
        let sorted = observations.sorted {
            let delta = $0.boundingBox.midY - $1.boundingBox.midY
            return abs(delta) > 0.012 ? delta > 0 : $0.boundingBox.minX < $1.boundingBox.minX
        }
        try emit(["text": sorted.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n"), "lines": sorted.count])
    case "paste":
        guard AXIsProcessTrusted() else { fail("Enable Accessibility for SnapPaste in System Settings, then try Paste again. Copy is available without this permission.") }
        guard args.count == 3, let pid = Int32(args[2]), let target = NSRunningApplication(processIdentifier: pid) else { fail("The destination app is no longer running. Copy the result and paste it manually.") }
        target.activate(options: [])
        for _ in 0..<40 {
            if NSWorkspace.shared.frontmostApplication?.processIdentifier == pid { break }
            Thread.sleep(forTimeInterval: 0.025)
        }
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else { fail("Could not focus the destination. Copy the result and paste it manually.") }
        Thread.sleep(forTimeInterval: 0.12)
        guard let source = CGEventSource(stateID: .combinedSessionState), let down = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: true), let up = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: false) else { fail("Could not create the paste event.") }
        down.flags = .maskCommand; up.flags = .maskCommand
        down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
        try emit(["ok": true])
    case "fixture":
        guard args.count == 3 || args.count == 4 else { fail("An output path is required.") }
        let image = NSImage(size: NSSize(width: 1120, height: 760))
        image.lockFocus()
        NSColor(calibratedRed: 0.97, green: 0.97, blue: 0.96, alpha: 1).setFill()
        NSRect(x: 0, y: 0, width: 1120, height: 760).fill()
        func text(_ value: String, _ x: CGFloat, _ y: CGFloat, _ size: CGFloat, bold: Bool = false, color: NSColor = .labelColor) {
            (value as NSString).draw(at: NSPoint(x: x, y: y), withAttributes: [.font: bold ? NSFont.systemFont(ofSize: size, weight: .semibold) : NSFont.systemFont(ofSize: size), .foregroundColor: color])
        }
        let ink = NSColor(calibratedWhite: 0.13, alpha: 1)
        if args.count == 4 && args[3] == "code" {
            text("GITHUB / SNAPPaste / Pull request #42", 72, 666, 19, bold: true, color: .systemTeal)
            text("Fix checkout crash when cart is empty", 72, 600, 32, bold: true, color: ink)
            text("Open · alex wants to merge 1 commit into main", 72, 552, 20, color: .gray)
            text("src/checkout.ts  +2 -1", 72, 474, 23, bold: true, color: ink)
            text("- const total = cart.items.reduce(sumPrices);", 90, 408, 23, color: .systemRed)
            text("+ const items = cart?.items ?? [];", 90, 360, 23, color: .systemGreen)
            text("+ const total = items.reduce(sumPrices, 0);", 90, 312, 23, color: .systemGreen)
            text("Review: add a regression test for an empty cart.", 72, 208, 23, color: ink)
            text("Example pull request for trying SnapPaste. No private code.", 72, 80, 16, color: .gray)
        } else {
        text("ACME STUDIO", 72, 658, 15, bold: true, color: .systemTeal)
        text("A plan for every idea.", 72, 590, 38, bold: true, color: ink)
        text("Monthly pricing / USD", 72, 550, 18, color: .gray)
        let columns: [CGFloat] = [90, 390, 635, 850]
        let data = [["Plan", "Monthly price", "Projects", "Seats"], ["Starter", "$12", "5", "1"], ["Studio", "$29", "25", "5"], ["Business", "$79", "Unlimited", "20"]]
        for (row, values) in data.enumerated() {
            let y = CGFloat(440 - row * 85)
            if row == 0 { NSColor(calibratedRed: 0.89, green: 0.93, blue: 0.91, alpha: 1).setFill(); NSRect(x: 72, y: y-18, width: 976, height: 68).fill() }
            for (col, value) in values.enumerated() { text(value, columns[col], y, 23, bold: row == 0, color: ink) }
            NSColor(calibratedWhite: 0.85, alpha: 1).setFill(); NSRect(x: 72, y: y-30, width: 976, height: 1).fill()
        }
        text("Example image for trying SnapPaste. Not a real offer.", 72, 80, 16, color: .gray)
        }
        image.unlockFocus()
        guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) else { fail("Could not create the example image.") }
        try png.write(to: URL(fileURLWithPath: args[2])); try emit(["ok": true])
    default: fail("Unknown helper command.")
    }
} catch { fail(error.localizedDescription) }
