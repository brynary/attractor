import SwiftUI

@main
struct AttractorDesktopApp: App {
  @StateObject private var store: AppStore

  init() {
    if AppLaunchEnvironment.isUIAutomationMode {
      _store = StateObject(wrappedValue: UITestStoreFactory.makeStore())
    } else {
      _store = StateObject(wrappedValue: AppStore())
    }
  }

  var body: some Scene {
    WindowGroup("Attractor Studio") {
      RootWorkspaceView()
        .environmentObject(store)
        .task {
          await store.bootstrap()
        }
        .frame(minWidth: 1280, minHeight: 820)
    }
    .windowResizability(.contentMinSize)
    .commands {
      CommandMenu("Pipeline") {
        Button("Run Draft Pipeline") {
          Task {
            await store.submitDraftPipeline()
          }
        }
        .keyboardShortcut("r", modifiers: [.command])

        Button("Refresh Selected Run") {
          if case .run(let runID) = store.selection {
            Task {
              await store.refreshNow(runID: runID)
            }
          }
        }
        .keyboardShortcut("k", modifiers: [.command])

        Button("Cancel Selected Run") {
          if case .run(let runID) = store.selection {
            Task {
              await store.cancel(runID: runID)
            }
          }
        }
        .keyboardShortcut(".", modifiers: [.command])
      }
    }
  }
}
