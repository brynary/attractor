import AppKit
import ApplicationServices
import XCTest
import Darwin

final class MacUIAutomationTests: XCTestCase {
  private static let automationGate = "ATTRACTOR_STUDIO_ENABLE_UI_AUTOMATION"
  private static let appLaunchMode = "ATTRACTOR_STUDIO_UI_TEST_MODE"
  private static let holdRunningMode = "ATTRACTOR_STUDIO_UI_TEST_HOLD_RUNNING"
  private static let requireApprovalMode = "ATTRACTOR_STUDIO_UI_TEST_REQUIRE_APPROVAL"
  private static let appPathOverride = "ATTRACTOR_STUDIO_UI_TEST_APP_PATH"

  override func setUpWithError() throws {
    continueAfterFailure = false

    guard ProcessInfo.processInfo.environment[Self.automationGate] == "1" else {
      throw XCTSkip("Set \(Self.automationGate)=1 to run macOS UI automation tests.")
    }

    guard AXIsProcessTrusted() else {
      throw XCTSkip("macOS Accessibility permission is required for UI automation.")
    }
  }

  func testComposerSurfaceShowsCoreControls() throws {
    let app = try launchTestApp()
    defer { terminateApp(app) }

    let appElement = AXUIElementCreateApplication(pid_t(app.processIdentifier))
    _ = try waitForElement(
      in: appElement,
      timeoutSeconds: 15,
      description: "composer heading"
    ) { element in
      self.identifier(of: element) == "composer.title"
    }

    _ = try waitForElement(
      in: appElement,
      timeoutSeconds: 15,
      description: "template picker"
    ) { element in
      self.identifier(of: element) == "composer.templatePicker"
    }

    _ = try waitForElement(
      in: appElement,
      timeoutSeconds: 15,
      description: "run pipeline button"
    ) { element in
      self.identifier(of: element) == "composer.runPipelineButton"
    }

    _ = try waitForElement(
      in: appElement,
      timeoutSeconds: 15,
      description: "dot editor"
    ) { element in
      self.identifier(of: element) == "composer.dotEditor"
    }
  }

  func testRunPipelineCreatesRunDetail() throws {
    let app = try launchTestApp()
    defer { terminateApp(app) }

    let appElement = AXUIElementCreateApplication(pid_t(app.processIdentifier))
    let runButton = try waitForElement(
      in: appElement,
      timeoutSeconds: 15,
      description: "run pipeline button"
    ) { element in
      let role = self.stringAttribute("AXRole", of: element)
      let identifier = self.identifier(of: element)
      return role == "AXButton" && identifier == "composer.runPipelineButton"
    }

    try press(runButton)

    _ = try waitForElement(
      in: appElement,
      timeoutSeconds: 20,
      description: "first run header in detail view"
    ) { element in
      self.identifier(of: element) == "run.detail.id.ui-run-001"
    }
  }

  func testWorkflowTabsLoadArtifactsAndEvents() throws {
    let app = try launchTestApp()
    defer { terminateApp(app) }

    let appElement = AXUIElementCreateApplication(pid_t(app.processIdentifier))

    let runButton = try waitForElement(
      in: appElement,
      timeoutSeconds: 15,
      description: "run pipeline button"
    ) { element in
      let role = self.stringAttribute("AXRole", of: element)
      let identifier = self.identifier(of: element)
      return role == "AXButton" && identifier == "composer.runPipelineButton"
    }
    try press(runButton)

    _ = try waitForElement(
      in: appElement,
      timeoutSeconds: 20,
      description: "completed run status"
    ) { element in
      self.identifier(of: element) == "run.status.completed"
    }

    try selectTab(named: "Graph", identifier: "run.tab.graph", in: appElement)
    _ = try waitForElement(
      in: appElement,
      timeoutSeconds: 12,
      description: "graph content"
    ) { element in
      self.identifier(of: element) == "run.graph.document"
    }

    try selectTab(named: "Events", identifier: "run.tab.events", in: appElement)
    _ = try waitForElement(
      in: appElement,
      timeoutSeconds: 12,
      description: "events list"
    ) { element in
      self.identifier(of: element) == "run.events.list"
    }

    try selectTab(named: "Context", identifier: "run.tab.context", in: appElement)
    _ = try waitForElement(
      in: appElement,
      timeoutSeconds: 12,
      description: "context table"
    ) { element in
      self.identifier(of: element) == "run.context.table"
    }

    try selectTab(named: "Checkpoint", identifier: "run.tab.checkpoint", in: appElement)
    _ = try waitForElement(
      in: appElement,
      timeoutSeconds: 12,
      description: "checkpoint content"
    ) { element in
      self.identifier(of: element) == "run.checkpoint.content"
    }
  }

  func testWorkflowCancelTransitionsRunToCancelled() throws {
    let app = try launchTestApp(additionalEnvironment: [Self.holdRunningMode: "1"])
    defer { terminateApp(app) }

    let appElement = AXUIElementCreateApplication(pid_t(app.processIdentifier))

    let runButton = try waitForElement(
      in: appElement,
      timeoutSeconds: 15,
      description: "run pipeline button"
    ) { element in
      let role = self.stringAttribute("AXRole", of: element)
      let identifier = self.identifier(of: element)
      return role == "AXButton" && identifier == "composer.runPipelineButton"
    }
    try press(runButton)

    _ = try waitForElement(
      in: appElement,
      timeoutSeconds: 15,
      description: "running status"
    ) { element in
      self.identifier(of: element) == "run.status.running"
    }

    let cancelButton = try waitForElement(
      in: appElement,
      timeoutSeconds: 10,
      description: "cancel selected run button"
    ) { element in
      let role = self.stringAttribute("AXRole", of: element)
      let identifier = self.identifier(of: element)
      return role == "AXButton" && identifier == "toolbar.cancelRunButton"
    }
    try press(cancelButton)

    _ = try waitForElement(
      in: appElement,
      timeoutSeconds: 15,
      description: "cancelled status"
    ) { element in
      self.identifier(of: element) == "run.status.cancelled"
    }
  }

  func testWorkflowHumanGateCanBeAnswered() throws {
    let app = try launchTestApp(additionalEnvironment: [Self.requireApprovalMode: "1"])
    defer { terminateApp(app) }

    let appElement = AXUIElementCreateApplication(pid_t(app.processIdentifier))

    let runButton = try waitForElement(
      in: appElement,
      timeoutSeconds: 15,
      description: "run pipeline button"
    ) { element in
      let role = self.stringAttribute("AXRole", of: element)
      let identifier = self.identifier(of: element)
      return role == "AXButton" && identifier == "composer.runPipelineButton"
    }
    try press(runButton)

    _ = try waitForElement(
      in: appElement,
      timeoutSeconds: 20,
      description: "human gate question card"
    ) { element in
      self.identifier(of: element) == "run.question.card"
    }

    let approveButton = try waitForElement(
      in: appElement,
      timeoutSeconds: 12,
      description: "approve question button"
    ) { element in
      let role = self.stringAttribute("AXRole", of: element)
      let identifier = self.identifier(of: element)
      return role == "AXButton" && identifier == "run.question.option.approve"
    }
    try press(approveButton)

    _ = try waitForElement(
      in: appElement,
      timeoutSeconds: 20,
      description: "answer submitted info message"
    ) { element in
      self.identifier(of: element) == "status.info"
    }

    _ = try waitForElement(
      in: appElement,
      timeoutSeconds: 20,
      description: "completed status after answering gate"
    ) { element in
      self.identifier(of: element) == "run.status.completed"
    }
  }

  private func launchTestApp(
    additionalEnvironment: [String: String] = [:]
  ) throws -> Process {
    let process = Process()
    process.executableURL = try executableURL()
    process.currentDirectoryURL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)

    var environment = ProcessInfo.processInfo.environment
    environment[Self.appLaunchMode] = "1"
    for (key, value) in additionalEnvironment {
      environment[key] = value
    }
    process.environment = environment
    process.standardOutput = Pipe()
    process.standardError = Pipe()

    try process.run()

    if let runningApp = NSRunningApplication(processIdentifier: process.processIdentifier) {
      _ = runningApp.activate(options: [])
    }

    return process
  }

  private func executableURL() throws -> URL {
    if let explicit = ProcessInfo.processInfo.environment[Self.appPathOverride], !explicit.isEmpty {
      let explicitURL = URL(fileURLWithPath: explicit)
      guard FileManager.default.isExecutableFile(atPath: explicitURL.path) else {
        throw XCTSkip("UI app path override is not executable: \(explicitURL.path)")
      }
      return explicitURL
    }

    let cwd = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    let defaultURL = cwd
      .appendingPathComponent(".build", isDirectory: true)
      .appendingPathComponent("debug", isDirectory: true)
      .appendingPathComponent("AttractorDesktop", isDirectory: false)

    guard FileManager.default.isExecutableFile(atPath: defaultURL.path) else {
      throw XCTSkip("Build the app first: expected executable at \(defaultURL.path)")
    }
    return defaultURL
  }

  private func terminateApp(_ process: Process) {
    guard process.isRunning else {
      return
    }

    process.terminate()

    let deadline = Date().addingTimeInterval(2)
    while process.isRunning && Date() < deadline {
      RunLoop.current.run(until: Date().addingTimeInterval(0.05))
    }

    if process.isRunning {
      kill(pid_t(process.processIdentifier), SIGKILL)
    }
  }

  private func waitForElement(
    in root: AXUIElement,
    timeoutSeconds: Double,
    description: String,
    predicate: (AXUIElement) -> Bool
  ) throws -> AXUIElement {
    let deadline = Date().addingTimeInterval(timeoutSeconds)

    while Date() < deadline {
      if let element = findElement(in: root, predicate: predicate) {
        return element
      }
      RunLoop.current.run(until: Date().addingTimeInterval(0.12))
    }

    XCTFail("Timed out waiting for \(description)")
    throw NSError(domain: "MacUIAutomationTests", code: 1)
  }

  private func findElement(in root: AXUIElement, predicate: (AXUIElement) -> Bool) -> AXUIElement? {
    var queue: [AXUIElement] = [root]
    var visited: Set<UInt> = []

    while let current = queue.first {
      queue.removeFirst()

      let pointer = UInt(bitPattern: Unmanaged.passUnretained(current).toOpaque())
      if visited.contains(pointer) {
        continue
      }
      visited.insert(pointer)

      if predicate(current) {
        return current
      }

      queue.append(contentsOf: children(of: current))
    }

    return nil
  }

  private func children(of element: AXUIElement) -> [AXUIElement] {
    let attributes = [
      "AXWindows",
      "AXMainWindow",
      "AXFocusedWindow",
      "AXChildren",
      "AXChildrenInNavigationOrder",
      "AXContents",
      "AXRows",
      "AXColumns",
      "AXCells",
      "AXVisibleChildren",
      "AXVisibleRows",
      "AXSelectedChildren",
      "AXSelectedRows",
      "AXToolbar",
      "AXSplitGroup",
      "AXGroup",
      "AXOutline",
      "AXScrollArea",
      "AXDocument",
      "AXFunctionRowTopLevelElements",
      "AXSheets",
    ]

    var results: [AXUIElement] = []
    for attribute in attributes {
      guard let rawValue = attributeValue(attribute, of: element) else {
        continue
      }

      if CFGetTypeID(rawValue) == AXUIElementGetTypeID() {
        let child = unsafeDowncast(rawValue as AnyObject, to: AXUIElement.self)
        results.append(child)
        continue
      }

      if CFGetTypeID(rawValue) == CFArrayGetTypeID(),
         let values = rawValue as? [CFTypeRef]
      {
        for value in values where CFGetTypeID(value) == AXUIElementGetTypeID() {
          let child = unsafeDowncast(value as AnyObject, to: AXUIElement.self)
          results.append(child)
        }
      }
    }

    return results
  }

  private func identifier(of element: AXUIElement) -> String? {
    stringAttribute("AXIdentifier", of: element)
  }

  private func title(of element: AXUIElement) -> String? {
    stringAttribute("AXTitle", of: element)
  }

  private func valueString(of element: AXUIElement) -> String? {
    guard let value = attributeValue("AXValue", of: element) else {
      return nil
    }

    if let string = value as? String {
      return string
    }

    if CFGetTypeID(value) == CFAttributedStringGetTypeID() {
      return (value as? NSAttributedString)?.string
    }

    return nil
  }

  private func stringAttribute(_ name: String, of element: AXUIElement) -> String? {
    guard let value = attributeValue(name, of: element) else {
      return nil
    }
    return value as? String
  }

  private func attributeValue(_ name: String, of element: AXUIElement) -> CFTypeRef? {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, name as CFString, &value)
    guard result == .success else {
      return nil
    }
    return value
  }

  private func press(_ element: AXUIElement) throws {
    let pressResult = AXUIElementPerformAction(element, "AXPress" as CFString)
    if pressResult == .success {
      return
    }

    let confirmResult = AXUIElementPerformAction(element, "AXConfirm" as CFString)
    guard confirmResult == .success else {
      XCTFail("Could not activate UI element. AXPress=\(pressResult.rawValue) AXConfirm=\(confirmResult.rawValue)")
      throw NSError(domain: "MacUIAutomationTests", code: 2)
    }
  }

  private func selectTab(
    named title: String,
    identifier: String,
    in appElement: AXUIElement
  ) throws {
    let tabElement = try waitForElement(
      in: appElement,
      timeoutSeconds: 12,
      description: "tab \(title)"
    ) { element in
      let role = self.stringAttribute("AXRole", of: element)
      let nameMatch = self.title(of: element) == title
      let identifierMatch = self.identifier(of: element) == identifier

      if role == "AXRadioButton" || role == "AXButton" {
        return nameMatch || identifierMatch
      }
      return false
    }
    try press(tabElement)
  }
}
