import Foundation

enum PipelineRunState: String, Codable, CaseIterable, Sendable {
  case running
  case completed
  case failed
  case cancelled
}

enum StageStatus: String, Codable, CaseIterable, Sendable {
  case success
  case partialSuccess = "partial_success"
  case retry
  case fail
  case skipped
}

enum QuestionType: String, Codable, Sendable {
  case yesNo = "yes_no"
  case multipleChoice = "multiple_choice"
  case freeform
  case confirmation
}

struct ServerProfile: Identifiable, Codable, Hashable, Sendable {
  let id: UUID
  var name: String
  var baseURLString: String

  init(id: UUID = UUID(), name: String, baseURLString: String) {
    self.id = id
    self.name = name
    self.baseURLString = baseURLString
  }

  var baseURL: URL? {
    guard let url = URL(string: baseURLString.trimmingCharacters(in: .whitespacesAndNewlines)) else {
      return nil
    }
    return url
  }
}

struct PipelineRunRecord: Identifiable, Codable, Hashable, Sendable {
  let id: String
  let profileID: UUID
  let submittedAt: Date
  var status: PipelineRunState
  var stageStatus: StageStatus?
  var failureReason: String
  var completedNodes: [String]
  var dotSource: String
}

struct CreatePipelineResponse: Codable, Sendable {
  let id: String
  let status: PipelineRunState
}

struct PipelineStatusResponse: Codable, Sendable {
  let id: String
  let status: PipelineRunState
  let result: PipelineStatusResult?
}

struct PipelineStatusResult: Codable, Sendable {
  let status: StageStatus
  let completedNodes: [String]
  let failureReason: String?
}

struct PipelineQuestionResponse: Codable, Sendable {
  let id: String?
  let question: InterviewQuestion?
}

struct InterviewQuestion: Codable, Hashable, Sendable {
  let text: String
  let type: QuestionType
  let options: [InterviewOption]
  let defaultAnswer: InterviewAnswer?
  let timeoutSeconds: Int?
  let stage: String
  let metadata: [String: JSONValue]
}

struct InterviewOption: Codable, Hashable, Sendable, Identifiable {
  let key: String
  let label: String

  var id: String { key }
}

struct InterviewAnswer: Codable, Hashable, Sendable {
  let value: String
  let selectedOption: InterviewOption?
  let text: String
}

struct PendingQuestionState: Codable, Hashable, Sendable {
  let id: String
  let question: InterviewQuestion
  let fetchedAt: Date
}

struct PipelineContextResponse: Codable, Sendable {
  let context: [String: JSONValue]
}

struct PipelineCheckpointResponse: Codable, Sendable {
  let checkpoint: PipelineCheckpointSummary?
}

struct PipelineCheckpointSummary: Codable, Hashable, Sendable {
  let completedNodes: [String]
  let status: StageStatus
}

struct PipelineEventEnvelope: Codable, Hashable, Sendable {
  let kind: String
  let timestamp: Date
  let pipelineId: String
  let data: [String: JSONValue]
}

struct GraphDocument: Codable, Hashable, Sendable {
  enum Kind: String, Codable, Sendable {
    case svg
    case dot
  }

  let kind: Kind
  let content: String
}

enum WorkspaceSelection: Hashable {
  case composer
  case run(String)
}

struct PersistedWorkspaceState: Codable, Sendable {
  var profiles: [ServerProfile]
  var selectedProfileID: UUID?
  var runs: [PipelineRunRecord]
  var draftDOT: String
}

enum JSONValue: Codable, Hashable, Sendable {
  case string(String)
  case int(Int)
  case double(Double)
  case bool(Bool)
  case object([String: JSONValue])
  case array([JSONValue])
  case null

  init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()

    if container.decodeNil() {
      self = .null
      return
    }
    if let value = try? container.decode(Bool.self) {
      self = .bool(value)
      return
    }
    if let value = try? container.decode(Int.self) {
      self = .int(value)
      return
    }
    if let value = try? container.decode(Double.self) {
      self = .double(value)
      return
    }
    if let value = try? container.decode(String.self) {
      self = .string(value)
      return
    }
    if let value = try? container.decode([String: JSONValue].self) {
      self = .object(value)
      return
    }
    if let value = try? container.decode([JSONValue].self) {
      self = .array(value)
      return
    }

    throw DecodingError.dataCorruptedError(
      in: container,
      debugDescription: "Unsupported JSON value"
    )
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()

    switch self {
    case .string(let value):
      try container.encode(value)
    case .int(let value):
      try container.encode(value)
    case .double(let value):
      try container.encode(value)
    case .bool(let value):
      try container.encode(value)
    case .object(let value):
      try container.encode(value)
    case .array(let value):
      try container.encode(value)
    case .null:
      try container.encodeNil()
    }
  }

  var stringValue: String {
    switch self {
    case .string(let value):
      return value
    case .int(let value):
      return String(value)
    case .double(let value):
      return String(format: "%.3f", value)
    case .bool(let value):
      return value ? "true" : "false"
    case .object(let value):
      let pairs = value
        .sorted { $0.key < $1.key }
        .map { "\($0.key): \($0.value.stringValue)" }
        .joined(separator: ", ")
      return "{\(pairs)}"
    case .array(let value):
      let items = value.map(\.stringValue).joined(separator: ", ")
      return "[\(items)]"
    case .null:
      return "null"
    }
  }

  var stringOrNil: String? {
    if case .string(let value) = self {
      return value
    }
    return nil
  }
}
