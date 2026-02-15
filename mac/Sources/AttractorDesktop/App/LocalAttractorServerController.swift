import Foundation

@MainActor
protocol LocalServerControlling: AnyObject {
  func ensureRunning(for baseURL: URL) async throws -> Bool
}

@MainActor
final class LocalAttractorServerController: LocalServerControlling {
  static let shared = LocalAttractorServerController()

  private var process: Process?
  private var logHandle: FileHandle?

  private init() {}

  func ensureRunning(for baseURL: URL) async throws -> Bool {
    guard Self.isLocalhost(baseURL) else {
      return false
    }

    if await Self.isReachable(baseURL) {
      return false
    }

    if let process, process.isRunning {
      try await waitUntilReachable(baseURL: baseURL, timeoutSeconds: 8)
      return true
    }

    try launch(baseURL)

    do {
      try await waitUntilReachable(baseURL: baseURL, timeoutSeconds: 10)
      return true
    } catch {
      process?.terminate()
      process = nil
      throw error
    }
  }

  static func isLocalhost(_ url: URL) -> Bool {
    let host = (url.host ?? "").lowercased()
    return host == "127.0.0.1" || host == "localhost" || host == "::1"
  }

  private func launch(_ baseURL: URL) throws {
    let repoRoot = try resolveRepoRoot()

    let process = Process()
    process.currentDirectoryURL = repoRoot
    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = ["bun", "run", "attractor/bin/attractor-server.ts"]

    var environment = ProcessInfo.processInfo.environment
    environment["ATTRACTOR_HOST"] = baseURL.host ?? "127.0.0.1"
    environment["ATTRACTOR_PORT"] = String(baseURL.port ?? 3000)
    process.environment = environment

    let logURL = URL(fileURLWithPath: NSTemporaryDirectory())
      .appendingPathComponent("attractor-studio-server.log")

    if !FileManager.default.fileExists(atPath: logURL.path) {
      _ = FileManager.default.createFile(atPath: logURL.path, contents: Data())
    }

    let handle = try FileHandle(forWritingTo: logURL)
    try handle.seekToEnd()

    process.standardOutput = handle
    process.standardError = handle
    process.terminationHandler = { [weak self] _ in
      Task { @MainActor in
        self?.process = nil
        try? self?.logHandle?.close()
        self?.logHandle = nil
      }
    }

    try process.run()

    self.process = process
    self.logHandle = handle
  }

  private func resolveRepoRoot() throws -> URL {
    var cursor = URL(fileURLWithPath: #filePath).deletingLastPathComponent()

    for _ in 0..<10 {
      let serverEntry = cursor.appendingPathComponent("attractor/bin/attractor-server.ts")
      if FileManager.default.fileExists(atPath: serverEntry.path) {
        return cursor
      }
      cursor.deleteLastPathComponent()
    }

    throw LocalAttractorServerError.repoRootNotFound
  }

  private func waitUntilReachable(baseURL: URL, timeoutSeconds: Double) async throws {
    let timeout = max(1.0, timeoutSeconds)
    let deadline = Date().addingTimeInterval(timeout)

    while Date() < deadline {
      if await Self.isReachable(baseURL) {
        return
      }

      try? await Task.sleep(for: .milliseconds(250))
    }

    throw LocalAttractorServerError.startTimedOut
  }

  private static func isReachable(_ baseURL: URL) async -> Bool {
    guard let url = URL(string: "pipelines/nonexistent-id", relativeTo: baseURL)?.absoluteURL else {
      return false
    }

    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    request.timeoutInterval = 1.2

    do {
      let (_, response) = try await URLSession.shared.data(for: request)
      guard let http = response as? HTTPURLResponse else {
        return false
      }
      // Any well-formed HTTP response means the server is up.
      return (200...499).contains(http.statusCode)
    } catch {
      return false
    }
  }
}

enum LocalAttractorServerError: LocalizedError {
  case repoRootNotFound
  case startTimedOut

  var errorDescription: String? {
    switch self {
    case .repoRootNotFound:
      return "Could not locate repository root to launch local Attractor server."
    case .startTimedOut:
      return "Timed out while starting local Attractor server."
    }
  }
}
