import Foundation
import XCTest
@testable import AttractorDesktop

@MainActor
final class E2EAppStoreTests: XCTestCase {
  func testSubmitPipelineAutoStartsLocalServerWhenDown() async throws {
    let profile = ServerProfile(name: "Local", baseURLString: "http://127.0.0.1:3000")
    let persistence = InMemoryPersistence(
      state: PersistedWorkspaceState(
        profiles: [profile],
        selectedProfileID: profile.id,
        runs: [],
        draftDOT: sampleDOT
      )
    )

    let api = MockAttractorAPI()
    api.submitResults = [
      .failure(URLError(.cannotConnectToHost)),
      .success(CreatePipelineResponse(id: "run-local-1", status: .running)),
    ]
    api.pipelineResponses = [
      PipelineStatusResponse(
        id: "run-local-1",
        status: .completed,
        result: PipelineStatusResult(status: .success, completedNodes: ["start", "exit"], failureReason: nil)
      ),
    ]
    api.questionResponses = [PipelineQuestionResponse(id: nil, question: nil)]
    api.contextResponse = PipelineContextResponse(context: ["outcome": .string("success")])
    api.checkpointResponse = PipelineCheckpointResponse(
      checkpoint: PipelineCheckpointSummary(completedNodes: ["start", "exit"], status: .success)
    )
    api.graphResponse = GraphDocument(kind: .dot, content: "digraph G { start -> exit }")

    let localServer = MockLocalServerController(result: .success(true))

    let store = AppStore(
      persistence: persistence,
      localServerController: localServer,
      apiFactory: { _ in api }
    )

    await store.bootstrap()
    await store.submitDraftPipeline()

    XCTAssertEqual(localServer.ensureRunningCalls.count, 1)
    XCTAssertEqual(store.runs.count, 1)
    XCTAssertEqual(store.runs.first?.id, "run-local-1")
    XCTAssertTrue(store.lastInfoMessage?.contains("Started local server") ?? false)
    XCTAssertNil(store.lastErrorMessage)
  }

  func testSubmitPipelineRemoteFailureDoesNotAutoStartLocalServer() async throws {
    let profile = ServerProfile(name: "Remote", baseURLString: "https://example.com")
    let persistence = InMemoryPersistence(
      state: PersistedWorkspaceState(
        profiles: [profile],
        selectedProfileID: profile.id,
        runs: [],
        draftDOT: sampleDOT
      )
    )

    let api = MockAttractorAPI()
    api.submitResults = [.failure(URLError(.cannotConnectToHost))]

    let localServer = MockLocalServerController(result: .success(true))

    let store = AppStore(
      persistence: persistence,
      localServerController: localServer,
      apiFactory: { _ in api }
    )

    await store.bootstrap()
    await store.submitDraftPipeline()

    XCTAssertEqual(localServer.ensureRunningCalls.count, 0)
    XCTAssertTrue(store.runs.isEmpty)
    XCTAssertTrue(store.lastErrorMessage?.contains("Failed to start pipeline") ?? false)
  }

  func testSubmitPipelineTracksLifecycleToCompletion() async throws {
    let profile = ServerProfile(name: "Local", baseURLString: "http://127.0.0.1:3000")
    let persistence = InMemoryPersistence(
      state: PersistedWorkspaceState(
        profiles: [profile],
        selectedProfileID: profile.id,
        runs: [],
        draftDOT: sampleDOT
      )
    )

    let runID = "run-track-1"
    let api = MockAttractorAPI()
    api.submitResults = [.success(CreatePipelineResponse(id: runID, status: .running))]
    api.pipelineResponses = [
      PipelineStatusResponse(
        id: runID,
        status: .completed,
        result: PipelineStatusResult(status: .success, completedNodes: ["start", "write", "exit"], failureReason: nil)
      ),
    ]
    api.questionResponses = [PipelineQuestionResponse(id: nil, question: nil)]
    api.contextResponse = PipelineContextResponse(context: ["outcome": .string("success")])
    api.checkpointResponse = PipelineCheckpointResponse(
      checkpoint: PipelineCheckpointSummary(completedNodes: ["start", "write", "exit"], status: .success)
    )
    api.graphResponse = GraphDocument(kind: .dot, content: "digraph G { start -> write -> exit }")
    api.eventStreams[runID] = [
      PipelineEventEnvelope(
        kind: "stage_completed",
        timestamp: Date(),
        pipelineId: runID,
        data: ["status": .string("success")]
      ),
      PipelineEventEnvelope(
        kind: "pipeline_completed",
        timestamp: Date(),
        pipelineId: runID,
        data: [:]
      ),
    ]

    let localServer = MockLocalServerController(result: .success(false))

    let store = AppStore(
      persistence: persistence,
      localServerController: localServer,
      apiFactory: { _ in api }
    )

    await store.bootstrap()
    await store.submitDraftPipeline()

    let completed = await waitUntil(timeoutSeconds: 2.0) {
      store.run(withID: runID)?.status == .completed
    }

    XCTAssertTrue(completed)
    XCTAssertEqual(store.run(withID: runID)?.stageStatus, .success)
    XCTAssertEqual(store.events(for: runID).count, 2)
  }

  func testAnswerQuestionClearsPendingQuestion() async throws {
    let profile = ServerProfile(name: "Local", baseURLString: "http://127.0.0.1:3000")
    let persistence = InMemoryPersistence(
      state: PersistedWorkspaceState(
        profiles: [profile],
        selectedProfileID: profile.id,
        runs: [],
        draftDOT: sampleDOT
      )
    )

    let api = MockAttractorAPI()
    let localServer = MockLocalServerController(result: .success(false))

    let store = AppStore(
      persistence: persistence,
      localServerController: localServer,
      apiFactory: { _ in api }
    )

    await store.bootstrap()

    let runID = "run-q-1"
    store.runs = [
      PipelineRunRecord(
        id: runID,
        profileID: profile.id,
        submittedAt: Date(),
        status: .running,
        stageStatus: nil,
        failureReason: "",
        completedNodes: [],
        dotSource: sampleDOT
      ),
    ]

    let question = InterviewQuestion(
      text: "Approve?",
      type: .multipleChoice,
      options: [InterviewOption(key: "approve", label: "Approve")],
      defaultAnswer: nil,
      timeoutSeconds: nil,
      stage: "review",
      metadata: [:]
    )
    store.pendingQuestionsByRun[runID] = PendingQuestionState(id: "q1", question: question, fetchedAt: Date())

    await store.answerQuestion(runID: runID, questionID: "q1", value: "approve")

    XCTAssertEqual(api.submitAnswerCallCount, 1)
    XCTAssertNil(store.pendingQuestionsByRun[runID])
    XCTAssertEqual(store.lastInfoMessage, "Answer submitted.")
  }

  func testRefreshNowLoadsContextCheckpointAndGraph() async throws {
    let profile = ServerProfile(name: "Local", baseURLString: "http://127.0.0.1:3000")
    let persistence = InMemoryPersistence(
      state: PersistedWorkspaceState(
        profiles: [profile],
        selectedProfileID: profile.id,
        runs: [],
        draftDOT: sampleDOT
      )
    )

    let api = MockAttractorAPI()
    api.pipelineResponses = [
      PipelineStatusResponse(
        id: "run-refresh-1",
        status: .completed,
        result: PipelineStatusResult(status: .success, completedNodes: ["start", "exit"], failureReason: nil)
      ),
    ]
    api.questionResponses = [PipelineQuestionResponse(id: nil, question: nil)]
    api.contextResponse = PipelineContextResponse(context: ["graph.goal": .string("Ship")])
    api.checkpointResponse = PipelineCheckpointResponse(
      checkpoint: PipelineCheckpointSummary(completedNodes: ["start", "exit"], status: .success)
    )
    api.graphResponse = GraphDocument(kind: .svg, content: "<svg></svg>")

    let localServer = MockLocalServerController(result: .success(false))

    let store = AppStore(
      persistence: persistence,
      localServerController: localServer,
      apiFactory: { _ in api }
    )

    await store.bootstrap()

    let runID = "run-refresh-1"
    store.runs = [
      PipelineRunRecord(
        id: runID,
        profileID: profile.id,
        submittedAt: Date(),
        status: .running,
        stageStatus: nil,
        failureReason: "",
        completedNodes: [],
        dotSource: sampleDOT
      ),
    ]

    await store.refreshNow(runID: runID)

    XCTAssertEqual(store.contextByRun[runID]?["graph.goal"], .string("Ship"))
    XCTAssertEqual(store.checkpointByRun[runID]??.status, .success)
    XCTAssertEqual(store.graphByRun[runID]?.kind, .svg)
  }

  func testCancelRunTransitionsToCancelled() async throws {
    let profile = ServerProfile(name: "Local", baseURLString: "http://127.0.0.1:3000")
    let persistence = InMemoryPersistence(
      state: PersistedWorkspaceState(
        profiles: [profile],
        selectedProfileID: profile.id,
        runs: [],
        draftDOT: sampleDOT
      )
    )

    let api = MockAttractorAPI()
    let localServer = MockLocalServerController(result: .success(false))

    let store = AppStore(
      persistence: persistence,
      localServerController: localServer,
      apiFactory: { _ in api }
    )

    await store.bootstrap()

    let runID = "run-cancel-1"
    store.runs = [
      PipelineRunRecord(
        id: runID,
        profileID: profile.id,
        submittedAt: Date(),
        status: .running,
        stageStatus: nil,
        failureReason: "",
        completedNodes: [],
        dotSource: sampleDOT
      ),
    ]

    await store.cancel(runID: runID)

    XCTAssertEqual(api.cancelCallCount, 1)
    XCTAssertEqual(store.run(withID: runID)?.status, .cancelled)
  }

  private func waitUntil(timeoutSeconds: Double, condition: @escaping @MainActor () -> Bool) async -> Bool {
    let deadline = Date().addingTimeInterval(timeoutSeconds)
    while Date() < deadline {
      if condition() {
        return true
      }
      try? await Task.sleep(for: .milliseconds(50))
    }
    return condition()
  }

  private var sampleDOT: String {
    "digraph G { start [shape=Mdiamond]; exit [shape=Msquare]; start -> exit }"
  }
}

@MainActor
private final class InMemoryPersistence: AppPersistenceStoring {
  var state: PersistedWorkspaceState?

  init(state: PersistedWorkspaceState?) {
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
private final class MockLocalServerController: LocalServerControlling {
  private let result: Result<Bool, Error>
  private(set) var ensureRunningCalls: [URL] = []

  init(result: Result<Bool, Error>) {
    self.result = result
  }

  func ensureRunning(for baseURL: URL) async throws -> Bool {
    ensureRunningCalls.append(baseURL)
    return try result.get()
  }
}

private final class MockAttractorAPI: AttractorAPI, @unchecked Sendable {
  private let lock = NSLock()

  var submitResults: [Result<CreatePipelineResponse, Error>] = []
  var pipelineResponses: [PipelineStatusResponse] = []
  var questionResponses: [PipelineQuestionResponse] = []
  var contextResponse = PipelineContextResponse(context: [:])
  var checkpointResponse = PipelineCheckpointResponse(checkpoint: nil)
  var graphResponse = GraphDocument(kind: .dot, content: "")
  var eventStreams: [String: [PipelineEventEnvelope]] = [:]

  private(set) var submitAnswerCallCount = 0
  private(set) var cancelCallCount = 0

  func submitPipeline(dot: String) async throws -> CreatePipelineResponse {
    _ = dot
    return try withLock {
      guard !submitResults.isEmpty else {
        return CreatePipelineResponse(id: "default-run", status: .running)
      }
      let result = submitResults.removeFirst()
      return try result.get()
    }
  }

  func fetchPipeline(id: String) async throws -> PipelineStatusResponse {
    withLock {
      if pipelineResponses.count > 1 {
        return pipelineResponses.removeFirst()
      }
      if let last = pipelineResponses.last {
        return last
      }
      return PipelineStatusResponse(id: id, status: .running, result: nil)
    }
  }

  func streamEvents(id: String) -> AsyncThrowingStream<PipelineEventEnvelope, Error> {
    let events = withLock { eventStreams[id] ?? [] }

    return AsyncThrowingStream { continuation in
      Task {
        for event in events {
          continuation.yield(event)
        }
        continuation.finish()
      }
    }
  }

  func fetchPendingQuestion(pipelineID: String) async throws -> PipelineQuestionResponse {
    _ = pipelineID
    return withLock {
      if questionResponses.count > 1 {
        return questionResponses.removeFirst()
      }
      if let last = questionResponses.last {
        return last
      }
      return PipelineQuestionResponse(id: nil, question: nil)
    }
  }

  func submitAnswer(
    pipelineID: String,
    questionID: String,
    value: String,
    text: String?
  ) async throws {
    _ = pipelineID
    _ = questionID
    _ = value
    _ = text
    withLock {
      submitAnswerCallCount += 1
    }
  }

  func fetchContext(pipelineID: String) async throws -> PipelineContextResponse {
    _ = pipelineID
    return withLock { contextResponse }
  }

  func fetchCheckpoint(pipelineID: String) async throws -> PipelineCheckpointResponse {
    _ = pipelineID
    return withLock { checkpointResponse }
  }

  func fetchGraph(pipelineID: String) async throws -> GraphDocument {
    _ = pipelineID
    return withLock { graphResponse }
  }

  func cancelPipeline(pipelineID: String) async throws {
    _ = pipelineID
    withLock {
      cancelCallCount += 1
    }
  }

  private func withLock<T>(_ work: () throws -> T) rethrows -> T {
    lock.lock()
    defer { lock.unlock() }
    return try work()
  }
}
