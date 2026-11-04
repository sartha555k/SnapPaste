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
// MARK: - Insertion point
// Screen rectangles use the global top-left origin shared by Accessibility and Electron.
func primaryHeight() -> CGFloat { NSScreen.screens.first?.frame.height ?? 0 }
func onScreen(_ rect: CGRect) -> Bool {
    let height = primaryHeight()
    return NSScreen.screens.contains { screen in
        let f = screen.frame
        return CGRect(x: f.minX, y: height - f.maxY, width: f.width, height: f.height).intersects(rect.insetBy(dx: -1, dy: -1))
    }
}
func axElement(_ value: CFTypeRef?) -> AXUIElement? {
    guard let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return (value as! AXUIElement)
}
func axCopy(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success ? value : nil
}
func axGet<T: BitwiseCopyable>(_ value: CFTypeRef?, _ type: AXValueType, _ empty: T) -> T? {
    guard let value, CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
    var result = empty
    return AXValueGetValue(value as! AXValue, type, &result) ? result : nil
}
func boundsFor(_ element: AXUIElement, _ range: CFRange) -> CGRect? {
    var r = range
    guard let axRange = AXValueCreate(.cfRange, &r) else { return nil }
    var value: CFTypeRef?
    guard AXUIElementCopyParameterizedAttributeValue(element, kAXBoundsForRangeParameterizedAttribute as CFString, axRange, &value) == .success,
          let rect = axGet(value, .cgRect, CGRect.zero),
          rect.height > 2, rect.height < 400, rect.origin != .zero, onScreen(rect) else { return nil }
    return rect
}
/// Where the user is typing: the caret when the app reports it, else the focused field.
/// Many apps report no or bogus caret bounds, so every step validates and falls through.
func insertionAnchor(pid: pid_t) -> [String: Any]? {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 0.3)
    // Chromium/Electron apps (Slack, Discord, VS Code) build their tree only when asked.
    AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    guard let focused = axElement(axCopy(app, kAXFocusedUIElementAttribute)) else { return nil }
    func anchor(_ rect: CGRect, _ source: String) -> [String: Any] {
        ["x": rect.minX, "y": rect.minY, "width": rect.width, "height": rect.height, "source": source]
    }
    if let range = axGet(axCopy(focused, kAXSelectedTextRangeAttribute), .cfRange, CFRange()) {
        if range.length > 0, let rect = boundsFor(focused, range) {
            // A multi-line selection is tall; anchor at its last line.
            return anchor(CGRect(x: rect.minX, y: rect.maxY - min(rect.height, 22), width: 1, height: min(rect.height, 22)), "caret")
        }
        if range.location > 0, let rect = boundsFor(focused, CFRange(location: range.location - 1, length: 1)) {
            return anchor(CGRect(x: rect.maxX, y: rect.minY, width: 1, height: rect.height), "caret")
        }
        if let rect = boundsFor(focused, CFRange(location: range.location, length: 1)) {
            return anchor(CGRect(x: rect.minX, y: rect.minY, width: 1, height: rect.height), "caret")
        }
    }
    if let origin = axGet(axCopy(focused, kAXPositionAttribute), .cgPoint, CGPoint.zero),
       let size = axGet(axCopy(focused, kAXSizeAttribute), .cgSize, CGSize.zero),
       size.width > 8, size.height > 8, size.height < primaryHeight() * 0.8 {
        let rect = CGRect(origin: origin, size: size)
        if onScreen(rect) { return anchor(rect, "field") }
    }
    return nil
}

// MARK: - Clipboard-preserving paste
typealias Snapshot = [[NSPasteboard.PasteboardType: Data]]
func snapshot(_ pasteboard: NSPasteboard) -> Snapshot {
    (pasteboard.pasteboardItems ?? []).map { item in
        var data: [NSPasteboard.PasteboardType: Data] = [:]
        for type in item.types { if let value = item.data(forType: type) { data[type] = value } }
        return data
    }
}
func restore(_ saved: Snapshot, _ pasteboard: NSPasteboard) {
    pasteboard.clearContents()
    let items = saved.map { values -> NSPasteboardItem in
        let item = NSPasteboardItem()
        for (type, data) in values { item.setData(data, forType: type) }
        return item
    }
    if !items.isEmpty { pasteboard.writeObjects(items) }
}
func write(text: String, html: String, transient: Bool, _ pasteboard: NSPasteboard) -> Int {
    pasteboard.clearContents()
    let item = NSPasteboardItem()
    item.setString(text, forType: .string)
    if !html.isEmpty { item.setString(html, forType: .html) }
    if transient {
        // nspasteboard.org markers: clipboard managers skip this short-lived entry.
        item.setData(Data(), forType: NSPasteboard.PasteboardType("org.nspasteboard.TransientType"))
        item.setData(Data(), forType: NSPasteboard.PasteboardType("org.nspasteboard.AutoGeneratedType"))
    }
    pasteboard.writeObjects([item])
    return pasteboard.changeCount
}
func sendCommandV() -> Bool {
    guard let source = CGEventSource(stateID: .combinedSessionState),
          let down = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: true),
          let up = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: false) else { return false }
    down.flags = .maskCommand; up.flags = .maskCommand
    down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
    return true
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
    case "unhide":
        // Unhide SnapPaste without activating it, so the destination app keeps focus.
        guard args.count == 3, let pid = Int32(args[2]), let target = NSRunningApplication(processIdentifier: pid) else { fail("Invalid unhide request.") }
        if target.isHidden { _ = target.unhide() }
        for _ in 0..<20 where target.isHidden { Thread.sleep(forTimeInterval: 0.01) }
        try emit(["ok": !target.isHidden])
    case "context":
        // Everything the inline menu needs at shortcut time, in one fast call.
        let front = NSWorkspace.shared.frontmostApplication
        let pasteboard = NSPasteboard.general
        var result: [String: Any] = [
            "pid": front?.processIdentifier ?? 0,
            "app": front?.localizedName ?? "",
            "trusted": AXIsProcessTrusted(),
            "clipboardChange": pasteboard.changeCount,
            "clipboardImage": pasteboard.availableType(from: [.png, .tiff]) != nil,
        ]
        if AXIsProcessTrusted(), let pid = front?.processIdentifier, let anchor = insertionAnchor(pid: pid) {
            result["anchor"] = anchor
        }
        try emit(result)
    case "paste-restore":
        // paste-restore <destination pid> <payload.json> <own pid>
        // Writes the result, pastes into the destination, then restores the previous clipboard.
        guard args.count == 5, let pid = Int32(args[2]), let own = Int32(args[4]) else { fail("Invalid paste request.") }
        let payload = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: args[3]))) as? [String: Any] ?? [:]
        let text = payload["text"] as? String ?? "", html = payload["html"] as? String ?? ""
        let pasteboard = NSPasteboard.general
        let front = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0
        // Never yank the user back: if they moved to another app meanwhile, leave the result on the clipboard.
        guard AXIsProcessTrusted(), front == pid || front == own, let target = NSRunningApplication(processIdentifier: pid) else {
            _ = write(text: text, html: html, transient: false, pasteboard)
            try emit(["ok": false, "reason": AXIsProcessTrusted() ? "focus-changed" : "untrusted", "front": front, "frontName": NSWorkspace.shared.frontmostApplication?.localizedName ?? "", "dest": pid, "own": own])
            break
        }
        let saved = snapshot(pasteboard)
        let written = write(text: text, html: html, transient: true, pasteboard)
        if front != pid {
            target.activate(options: [])
            for _ in 0..<60 where NSWorkspace.shared.frontmostApplication?.processIdentifier != pid { Thread.sleep(forTimeInterval: 0.025) }
        }
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else {
            pasteboard.clearContents(); _ = write(text: text, html: html, transient: false, pasteboard)
            try emit(["ok": false, "reason": "focus-changed", "stage": "after-activate", "front": NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0, "frontName": NSWorkspace.shared.frontmostApplication?.localizedName ?? "", "dest": pid, "own": own, "startFront": front]); break
        }
        Thread.sleep(forTimeInterval: 0.05)
        guard sendCommandV() else { fail("Could not create the paste event.") }
        // Apps read the pasteboard asynchronously after Cmd+V; wait before restoring.
        Thread.sleep(forTimeInterval: 0.6)
        var restored = false
        if pasteboard.changeCount == written { restore(saved, pasteboard); restored = true }
        try emit(["ok": true, "restored": restored])
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
