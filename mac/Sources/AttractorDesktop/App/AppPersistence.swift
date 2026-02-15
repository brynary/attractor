import Foundation

@MainActor
protocol AppPersistenceStoring {
  func load() async -> PersistedWorkspaceState?
  func save(_ state: PersistedWorkspaceState) async
}

@MainActor
final class AppPersistence: AppPersistenceStoring {
  private let fileURL: URL

  init(filename: String = "workspace-state.json") {
    let fm = FileManager.default
    let appSupport = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
      ?? URL(filePath: NSTemporaryDirectory(), directoryHint: .isDirectory)

    let directory = appSupport
      .appendingPathComponent("AttractorDesktop", isDirectory: true)
      .appendingPathComponent("Store", isDirectory: true)

    do {
      try fm.createDirectory(at: directory, withIntermediateDirectories: true)
    } catch {
      // Ignore persistence directory creation failures; app will continue without persistence.
    }

    self.fileURL = directory.appendingPathComponent(filename)
  }

  func load() async -> PersistedWorkspaceState? {
    guard let data = try? Data(contentsOf: fileURL) else {
      return nil
    }
    return try? JSONDecoder().decode(PersistedWorkspaceState.self, from: data)
  }

  func save(_ state: PersistedWorkspaceState) async {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

    guard let data = try? encoder.encode(state) else {
      return
    }

    try? data.write(to: fileURL, options: .atomic)
  }
}
