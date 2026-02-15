import Foundation

enum AppLaunchEnvironment {
  static var isUIAutomationMode: Bool {
    ProcessInfo.processInfo.environment["ATTRACTOR_STUDIO_UI_TEST_MODE"] == "1"
  }

  static var isUIAutomationHoldRunningMode: Bool {
    ProcessInfo.processInfo.environment["ATTRACTOR_STUDIO_UI_TEST_HOLD_RUNNING"] == "1"
  }

  static var isUIAutomationApprovalMode: Bool {
    ProcessInfo.processInfo.environment["ATTRACTOR_STUDIO_UI_TEST_REQUIRE_APPROVAL"] == "1"
  }
}

@MainActor
final class InMemoryAppPersistence: AppPersistenceStoring {
  private var state: PersistedWorkspaceState?

  init(state: PersistedWorkspaceState? = nil) {
    self.state = state
  }

  func load() async -> PersistedWorkspaceState? {
    state
  }

  func save(_ state: PersistedWorkspaceState) async {
    self.state = state
  }
}

@MainActor
final class NoopLocalServerController: LocalServerControlling {
  func ensureRunning(for baseURL: URL) async throws -> Bool {
    _ = baseURL
    return false
  }
}

final class UITestAttractorAPI: AttractorAPI, @unchecked Sendable {
  private let lock = NSLock()
  private let holdRunning: Bool
  private let requireApproval: Bool
  private var nextRunOrdinal = 1
  private var statusPollCountByRun: [String: Int] = [:]
  private var cancelledRuns: Set<String> = []
  private var answeredRuns: Set<String> = []

  init(holdRunning: Bool, requireApproval: Bool) {
    self.holdRunning = holdRunning
    self.requireApproval = requireApproval
  }

  func submitPipeline(dot: String) async throws -> CreatePipelineResponse {
    _ = dot
    return withLock {
      let runID = String(format: "ui-run-%03d", nextRunOrdinal)
      nextRunOrdinal += 1
      statusPollCountByRun[runID] = 0

      return CreatePipelineResponse(id: runID, status: .running)
    }
  }

  func fetchPipeline(id: String) async throws -> PipelineStatusResponse {
    withLock {
      if cancelledRuns.contains(id) {
        return PipelineStatusResponse(id: id, status: .cancelled, result: nil)
      }

      if holdRunning {
        return PipelineStatusResponse(id: id, status: .running, result: nil)
      }

      if requireApproval && !answeredRuns.contains(id) {
        return PipelineStatusResponse(id: id, status: .running, result: nil)
      }

      let nextPoll = (statusPollCountByRun[id] ?? 0) + 1
      statusPollCountByRun[id] = nextPoll

      if nextPoll >= 2 {
        return PipelineStatusResponse(
          id: id,
          status: .completed,
          result: PipelineStatusResult(
            status: .success,
            completedNodes: ["start", "review", "exit"],
            failureReason: nil
          )
        )
      }

      return PipelineStatusResponse(id: id, status: .running, result: nil)
    }
  }

  func streamEvents(id: String) -> AsyncThrowingStream<PipelineEventEnvelope, Error> {
    AsyncThrowingStream { continuation in
      let now = Date()
      continuation.yield(
        PipelineEventEnvelope(
          kind: "stage_completed",
          timestamp: now,
          pipelineId: id,
          data: ["status": .string("success")]
        )
      )

      if !holdRunning && !requireApproval {
        continuation.yield(
          PipelineEventEnvelope(
            kind: "pipeline_completed",
            timestamp: now.addingTimeInterval(0.15),
            pipelineId: id,
            data: [:]
          )
        )
      }
      continuation.finish()
    }
  }

  func fetchPendingQuestion(pipelineID: String) async throws -> PipelineQuestionResponse {
    return withLock {
      guard requireApproval, !answeredRuns.contains(pipelineID) else {
        return PipelineQuestionResponse(id: nil, question: nil)
      }

      return PipelineQuestionResponse(
        id: "q-\(pipelineID)",
        question: InterviewQuestion(
          text: "Approve this run?",
          type: .multipleChoice,
          options: [
            InterviewOption(key: "approve", label: "Approve"),
            InterviewOption(key: "revise", label: "Revise"),
          ],
          defaultAnswer: nil,
          timeoutSeconds: nil,
          stage: "review",
          metadata: [:]
        )
      )
    }
  }

  func submitAnswer(
    pipelineID: String,
    questionID: String,
    value: String,
    text: String?
  ) async throws {
    _ = withLock {
      answeredRuns.insert(pipelineID)
    }
    _ = questionID
    _ = value
    _ = text
  }

  func fetchContext(pipelineID: String) async throws -> PipelineContextResponse {
    PipelineContextResponse(
      context: [
        "mode": .string("ui-automation"),
        "pipeline_id": .string(pipelineID),
      ]
    )
  }

  func fetchCheckpoint(pipelineID: String) async throws -> PipelineCheckpointResponse {
    _ = pipelineID
    return PipelineCheckpointResponse(
      checkpoint: PipelineCheckpointSummary(
        completedNodes: ["start", "review", "exit"],
        status: .success
      )
    )
  }

  func fetchGraph(pipelineID: String) async throws -> GraphDocument {
    GraphDocument(
      kind: .dot,
      content: "digraph ui_test { start -> review -> exit }"
    )
  }

  func cancelPipeline(pipelineID: String) async throws {
    _ = withLock {
      cancelledRuns.insert(pipelineID)
    }
  }

  private func withLock<T>(_ work: () -> T) -> T {
    lock.lock()
    defer { lock.unlock() }
    return work()
  }
}

@MainActor
enum UITestStoreFactory {
  static func makeStore() -> AppStore {
    let profile = ServerProfile(name: "UI Test Local", baseURLString: "http://127.0.0.1:3000")
    let state = PersistedWorkspaceState(
      profiles: [profile],
      selectedProfileID: profile.id,
      runs: [],
      draftDOT: PipelineTemplate.codeReview.dot
    )

    let persistence = InMemoryAppPersistence(state: state)
    let api = UITestAttractorAPI(
      holdRunning: AppLaunchEnvironment.isUIAutomationHoldRunningMode,
      requireApproval: AppLaunchEnvironment.isUIAutomationApprovalMode
    )
    let localServer = NoopLocalServerController()

    return AppStore(
      persistence: persistence,
      localServerController: localServer,
      apiFactory: { _ in api }
    )
  }
}
