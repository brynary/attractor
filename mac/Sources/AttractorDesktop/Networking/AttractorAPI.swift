import Foundation

protocol AttractorAPI: Sendable {
  func submitPipeline(dot: String) async throws -> CreatePipelineResponse
  func fetchPipeline(id: String) async throws -> PipelineStatusResponse
  func streamEvents(id: String) -> AsyncThrowingStream<PipelineEventEnvelope, Error>
  func fetchPendingQuestion(pipelineID: String) async throws -> PipelineQuestionResponse
  func submitAnswer(
    pipelineID: String,
    questionID: String,
    value: String,
    text: String?
  ) async throws
  func fetchContext(pipelineID: String) async throws -> PipelineContextResponse
  func fetchCheckpoint(pipelineID: String) async throws -> PipelineCheckpointResponse
  func fetchGraph(pipelineID: String) async throws -> GraphDocument
  func cancelPipeline(pipelineID: String) async throws
}

enum AttractorClientError: LocalizedError {
  case invalidURL(String)
  case invalidResponse
  case httpStatus(code: Int, message: String)
  case invalidContentType(String)

  var errorDescription: String? {
    switch self {
    case .invalidURL(let value):
      return "Invalid URL: \(value)"
    case .invalidResponse:
      return "The server returned an invalid response."
    case .httpStatus(let code, let message):
      return "Server error \(code): \(message)"
    case .invalidContentType(let value):
      return "Unsupported content type: \(value)"
    }
  }
}
