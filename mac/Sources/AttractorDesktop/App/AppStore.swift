import Foundation
import SwiftUI

@MainActor
final class AppStore: ObservableObject {
  @Published var profiles: [ServerProfile] = []
  @Published var selectedProfileID: UUID?

  @Published var runs: [PipelineRunRecord] = []
  @Published var selection: WorkspaceSelection? = .composer

  @Published var draftDOT: String = PipelineTemplate.codeReview.dot
  @Published var selectedTemplate: PipelineTemplate = .codeReview

  @Published var eventsByRun: [String: [PipelineEventEnvelope]] = [:]
  @Published var pendingQuestionsByRun: [String: PendingQuestionState] = [:]
  @Published var contextByRun: [String: [String: JSONValue]] = [:]
  @Published var checkpointByRun: [String: PipelineCheckpointSummary?] = [:]
  @Published var graphByRun: [String: GraphDocument] = [:]

  @Published var isSubmitting = false
  @Published var isProfileSheetPresented = false
  @Published var lastErrorMessage: String?
  @Published var lastInfoMessage: String?

  private let persistence: AppPersistenceStoring
  private let localServerController: LocalServerControlling
  private let apiFactory: (URL) -> AttractorAPI
  private var streamTasks: [String: Task<Void, Never>] = [:]
  private var pollingTasks: [String: Task<Void, Never>] = [:]
  private var hasBootstrapped = false

  init(
    persistence: AppPersistenceStoring = AppPersistence(),
    localServerController: LocalServerControlling = LocalAttractorServerController.shared,
    apiFactory: @escaping (URL) -> AttractorAPI = { AttractorHTTPClient(baseURL: $0) }
  ) {
    self.persistence = persistence
    self.localServerController = localServerController
    self.apiFactory = apiFactory
  }

  var selectedProfile: ServerProfile? {
    guard let selectedProfileID else {
      return nil
    }
    return profiles.first(where: { $0.id == selectedProfileID })
  }

  var selectedRun: PipelineRunRecord? {
    guard case .run(let id) = selection else {
      return nil
    }
    return run(withID: id)
  }

  func bootstrap() async {
    guard !hasBootstrapped else {
      return
    }
    hasBootstrapped = true

    if let persisted = await persistence.load() {
      profiles = persisted.profiles
      selectedProfileID = persisted.selectedProfileID
      runs = persisted.runs.sorted(by: { $0.submittedAt > $1.submittedAt })
      draftDOT = persisted.draftDOT
    }

    if profiles.isEmpty {
      let local = ServerProfile(name: "Local Attractor", baseURLString: "http://127.0.0.1:3000")
      profiles = [local]
      selectedProfileID = local.id
    }

    if selectedProfileID == nil || !profiles.contains(where: { $0.id == selectedProfileID }) {
      selectedProfileID = profiles.first?.id
    }

    if draftDOT.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      draftDOT = PipelineTemplate.codeReview.dot
    }

    for run in runs where run.status == .running {
      startTracking(runID: run.id, profileID: run.profileID)
    }

    persistState()
  }

  func addProfile(name: String, baseURLString: String) {
    let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
    let trimmedURL = baseURLString.trimmingCharacters(in: .whitespacesAndNewlines)

    guard !trimmedName.isEmpty else {
      pushError("Server name cannot be empty.")
      return
    }

    guard let url = URL(string: trimmedURL), url.scheme?.isEmpty == false else {
      pushError("Server URL is invalid.")
      return
    }

    let profile = ServerProfile(name: trimmedName, baseURLString: url.absoluteString)
    profiles.append(profile)
    selectedProfileID = profile.id
    persistState()
  }

  func removeProfile(_ profile: ServerProfile) {
    guard profiles.count > 1 else {
      pushError("At least one server profile is required.")
      return
    }

    profiles.removeAll(where: { $0.id == profile.id })

    if selectedProfileID == profile.id {
      selectedProfileID = profiles.first?.id
    }

    persistState()
  }

  func applyTemplate(_ template: PipelineTemplate) {
    selectedTemplate = template
    draftDOT = template.dot
    persistState()
  }

  func select(_ selection: WorkspaceSelection?) {
    self.selection = selection

    guard case .run(let runID) = selection else {
      return
    }

    Task {
      await refreshNow(runID: runID)
    }
  }

  func submitDraftPipeline() async {
    guard let profile = selectedProfile else {
      pushError("Select a server profile before starting a pipeline.")
      return
    }

    guard let baseURL = profile.baseURL else {
      pushError("Selected server URL is invalid.")
      return
    }

    let dot = draftDOT.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !dot.isEmpty else {
      pushError("Pipeline DOT is empty.")
      return
    }

    isSubmitting = true
    defer { isSubmitting = false }

    do {
      let result = try await submitPipelineWithAutoStart(profile: profile, baseURL: baseURL, dot: dot)
      let created = result.response

      let run = PipelineRunRecord(
        id: created.id,
        profileID: profile.id,
        submittedAt: Date(),
        status: created.status,
        stageStatus: nil,
        failureReason: "",
        completedNodes: [],
        dotSource: dot
      )

      runs.insert(run, at: 0)
      selection = .run(run.id)
      eventsByRun[run.id] = []
      pendingQuestionsByRun[run.id] = nil

      startTracking(runID: run.id, profileID: run.profileID)
      if result.startedServer {
        lastInfoMessage = "Started local server and launched pipeline \(run.id)."
      } else {
        lastInfoMessage = "Pipeline \(run.id) started."
      }
      persistState()
    } catch {
      pushError("Failed to start pipeline: \(error.localizedDescription)")
    }
  }

  func cancel(runID: String) async {
    guard let run = run(withID: runID) else {
      return
    }
    guard let profile = profile(withID: run.profileID), let baseURL = profile.baseURL else {
      pushError("Could not resolve server for this pipeline.")
      return
    }

    do {
      let client = apiFactory(baseURL)
      try await client.cancelPipeline(pipelineID: runID)
      mutateRun(id: runID) { item in
        item.status = .cancelled
      }
      stopTracking(runID: runID)
      persistState()
    } catch {
      pushError("Cancel failed: \(error.localizedDescription)")
    }
  }

  func answerQuestion(
    runID: String,
    questionID: String,
    value: String,
    text: String? = nil
  ) async {
    guard let run = run(withID: runID) else {
      return
    }
    guard let profile = profile(withID: run.profileID), let baseURL = profile.baseURL else {
      pushError("Could not resolve server for this pipeline.")
      return
    }

    do {
      let client = apiFactory(baseURL)
      try await client.submitAnswer(
        pipelineID: runID,
        questionID: questionID,
        value: value,
        text: text
      )
      pendingQuestionsByRun.removeValue(forKey: runID)
      lastInfoMessage = "Answer submitted."
    } catch {
      pushError("Failed to submit answer: \(error.localizedDescription)")
    }
  }

  func refreshNow(runID: String) async {
    guard let run = run(withID: runID) else {
      return
    }
    guard let profile = profile(withID: run.profileID), let baseURL = profile.baseURL else {
      return
    }

    let client = apiFactory(baseURL)
    await pollOnce(runID: runID, client: client)
    await refreshArtifacts(runID: runID, client: client)
  }

  func fetchGraph(runID: String) async {
    guard let run = run(withID: runID) else {
      return
    }
    guard let profile = profile(withID: run.profileID), let baseURL = profile.baseURL else {
      return
    }

    do {
      let client = apiFactory(baseURL)
      graphByRun[runID] = try await client.fetchGraph(pipelineID: runID)
    } catch {
      pushError("Failed to load graph: \(error.localizedDescription)")
    }
  }

  func clearError() {
    lastErrorMessage = nil
  }

  func clearInfo() {
    lastInfoMessage = nil
  }

  func events(for runID: String) -> [PipelineEventEnvelope] {
    eventsByRun[runID, default: []].sorted(by: { $0.timestamp < $1.timestamp })
  }

  func run(withID id: String) -> PipelineRunRecord? {
    runs.first(where: { $0.id == id })
  }

  private func startTracking(runID: String, profileID: UUID) {
    guard streamTasks[runID] == nil, pollingTasks[runID] == nil else {
      return
    }

    guard let profile = profile(withID: profileID), let baseURL = profile.baseURL else {
      pushError("Server profile is missing for pipeline \(runID).")
      return
    }

    let client = apiFactory(baseURL)

    streamTasks[runID] = Task { [weak self] in
      guard let self else {
        return
      }

      do {
        for try await event in client.streamEvents(id: runID) {
          self.eventsByRun[runID, default: []].append(event)
          self.apply(event: event, runID: runID)
        }
      } catch {
        self.pushError("Event stream disconnected for \(runID): \(error.localizedDescription)")
      }
    }

    pollingTasks[runID] = Task { [weak self] in
      guard let self else {
        return
      }

      while !Task.isCancelled {
        await self.pollOnce(runID: runID, client: client)

        guard let run = self.run(withID: runID), run.status == .running else {
          break
        }

        try? await Task.sleep(for: .seconds(1.2))
      }

      await self.refreshArtifacts(runID: runID, client: client)
      self.stopTracking(runID: runID)
    }
  }

  private func stopTracking(runID: String) {
    streamTasks[runID]?.cancel()
    streamTasks[runID] = nil

    pollingTasks[runID]?.cancel()
    pollingTasks[runID] = nil
  }

  private func pollOnce(runID: String, client: AttractorAPI) async {
    do {
      let status = try await client.fetchPipeline(id: runID)
      merge(status: status)

      let question = try await client.fetchPendingQuestion(pipelineID: runID)
      if let questionID = question.id, let prompt = question.question {
        pendingQuestionsByRun[runID] = PendingQuestionState(
          id: questionID,
          question: prompt,
          fetchedAt: Date()
        )
      } else {
        pendingQuestionsByRun.removeValue(forKey: runID)
      }

      if status.status != .running {
        stopTracking(runID: runID)
      }
    } catch {
      pushError("Polling failed for \(runID): \(error.localizedDescription)")
    }
  }

  private func refreshArtifacts(runID: String, client: AttractorAPI) async {
    do {
      let context = try await client.fetchContext(pipelineID: runID)
      contextByRun[runID] = context.context
    } catch {
      pushError("Context refresh failed: \(error.localizedDescription)")
    }

    do {
      let checkpoint = try await client.fetchCheckpoint(pipelineID: runID)
      checkpointByRun[runID] = checkpoint.checkpoint
    } catch {
      pushError("Checkpoint refresh failed: \(error.localizedDescription)")
    }

    do {
      graphByRun[runID] = try await client.fetchGraph(pipelineID: runID)
    } catch {
      pushError("Graph refresh failed: \(error.localizedDescription)")
    }
  }

  private func merge(status: PipelineStatusResponse) {
    mutateRun(id: status.id) { run in
      run.status = status.status
      run.stageStatus = status.result?.status
      run.completedNodes = status.result?.completedNodes ?? run.completedNodes
      run.failureReason = status.result?.failureReason ?? run.failureReason
    }
    persistState()
  }

  private func apply(event: PipelineEventEnvelope, runID: String) {
    switch event.kind {
    case "pipeline_completed":
      mutateRun(id: runID) { run in
        run.status = .completed
      }
    case "pipeline_failed":
      mutateRun(id: runID) { run in
        run.status = .failed
        if let reason = event.data["reason"]?.stringValue {
          run.failureReason = reason
        }
      }
    case "stage_completed":
      if let rawStatus = event.data["status"]?.stringOrNil,
         let stageStatus = StageStatus(rawValue: rawStatus)
      {
        mutateRun(id: runID) { run in
          run.stageStatus = stageStatus
        }
      }
    default:
      break
    }

    if event.kind == "checkpoint_saved" || event.kind == "pipeline_completed" {
      Task {
        await refreshNow(runID: runID)
      }
    }
  }

  private func mutateRun(id: String, mutation: (inout PipelineRunRecord) -> Void) {
    guard let index = runs.firstIndex(where: { $0.id == id }) else {
      return
    }

    var value = runs[index]
    mutation(&value)
    runs[index] = value
    runs.sort(by: { $0.submittedAt > $1.submittedAt })
  }

  private func profile(withID id: UUID) -> ServerProfile? {
    profiles.first(where: { $0.id == id })
  }

  private func pushError(_ message: String) {
    lastErrorMessage = message
  }

  private func submitPipelineWithAutoStart(
    profile: ServerProfile,
    baseURL: URL,
    dot: String
  ) async throws -> (response: CreatePipelineResponse, startedServer: Bool) {
    let client = apiFactory(baseURL)

    do {
      let response = try await client.submitPipeline(dot: dot)
      return (response, false)
    } catch {
      guard shouldAttemptLocalServerAutoStart(baseURL: baseURL, error: error) else {
        throw error
      }

      let started = try await localServerController.ensureRunning(for: baseURL)
      let retryClient = apiFactory(baseURL)
      let response = try await retryClient.submitPipeline(dot: dot)

      if started {
        print("Auto-started local Attractor server for profile \(profile.name)")
      }
      return (response, started)
    }
  }

  private func shouldAttemptLocalServerAutoStart(baseURL: URL, error: Error) -> Bool {
    guard isLocalhost(baseURL) else {
      return false
    }

    guard let urlError = error as? URLError else {
      return false
    }

    switch urlError.code {
    case .cannotConnectToHost, .cannotFindHost, .networkConnectionLost, .notConnectedToInternet, .timedOut, .dnsLookupFailed:
      return true
    default:
      return false
    }
  }

  private func isLocalhost(_ url: URL) -> Bool {
    let host = (url.host ?? "").lowercased()
    return host == "127.0.0.1" || host == "localhost" || host == "::1"
  }

  private func persistState() {
    let state = PersistedWorkspaceState(
      profiles: profiles,
      selectedProfileID: selectedProfileID,
      runs: runs,
      draftDOT: draftDOT
    )

    Task {
      @MainActor in
      await persistence.save(state)
    }
  }
}
