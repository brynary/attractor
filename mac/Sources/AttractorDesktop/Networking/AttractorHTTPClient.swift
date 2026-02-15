import Foundation

final class AttractorHTTPClient: AttractorAPI, @unchecked Sendable {
  private struct DotBody: Encodable {
    let dot: String
  }

  private struct AnswerBody: Encodable {
    let value: String
    let text: String?
  }

  private let baseURL: URL
  private let session: URLSession
  init(baseURL: URL, session: URLSession = .shared) {
    self.baseURL = baseURL
    self.session = session
  }

  func submitPipeline(dot: String) async throws -> CreatePipelineResponse {
    let data = try Self.makeEncoder().encode(DotBody(dot: dot))
    let request = try buildRequest(path: "pipelines", method: "POST", body: data)
    return try await perform(request, as: CreatePipelineResponse.self)
  }

  func fetchPipeline(id: String) async throws -> PipelineStatusResponse {
    let request = try buildRequest(path: "pipelines/\(id)")
    return try await perform(request, as: PipelineStatusResponse.self)
  }

  func streamEvents(id: String) -> AsyncThrowingStream<PipelineEventEnvelope, Error> {
    do {
      var request = try buildRequest(path: "pipelines/\(id)/events")
      request.setValue("text/event-stream", forHTTPHeaderField: "Accept")

      let session = self.session
      let streamRequest = request

      return AsyncThrowingStream { continuation in
        let task = Task {
          do {
            let decoder = Self.makeDecoder()
            let (bytes, response) = try await session.bytes(for: streamRequest)
            guard let http = response as? HTTPURLResponse else {
              throw AttractorClientError.invalidResponse
            }
            guard (200..<300).contains(http.statusCode) else {
              throw AttractorClientError.httpStatus(
                code: http.statusCode,
                message: "Unable to open event stream"
              )
            }

            var dataLines: [String] = []

            func flushEvent() throws {
              guard !dataLines.isEmpty else {
                return
              }
              let payload = dataLines.joined(separator: "\n")
              dataLines.removeAll(keepingCapacity: true)

              let data = Data(payload.utf8)
              let event = try decoder.decode(PipelineEventEnvelope.self, from: data)
              continuation.yield(event)
            }

            for try await line in bytes.lines {
              if Task.isCancelled {
                break
              }

              if line.isEmpty {
                try flushEvent()
                continue
              }

              if line.hasPrefix(":") {
                continue
              }

              if line.hasPrefix("data:") {
                let start = line.index(line.startIndex, offsetBy: 5)
                let chunk = String(line[start...]).trimmingCharacters(in: .whitespaces)
                dataLines.append(chunk)
              }
            }

            try flushEvent()
            continuation.finish()
          } catch is CancellationError {
            continuation.finish()
          } catch {
            continuation.finish(throwing: error)
          }
        }

        continuation.onTermination = { _ in
          task.cancel()
        }
      }
    } catch {
      return AsyncThrowingStream { continuation in
        continuation.finish(throwing: error)
      }
    }
  }

  func fetchPendingQuestion(pipelineID: String) async throws -> PipelineQuestionResponse {
    let request = try buildRequest(path: "pipelines/\(pipelineID)/questions")
    return try await perform(request, as: PipelineQuestionResponse.self)
  }

  func submitAnswer(
    pipelineID: String,
    questionID: String,
    value: String,
    text: String?
  ) async throws {
    let data = try Self.makeEncoder().encode(AnswerBody(value: value, text: text))
    let path = "pipelines/\(pipelineID)/questions/\(questionID)/answer"
    let request = try buildRequest(path: path, method: "POST", body: data)
    _ = try await performRaw(request)
  }

  func fetchContext(pipelineID: String) async throws -> PipelineContextResponse {
    let request = try buildRequest(path: "pipelines/\(pipelineID)/context")
    return try await perform(request, as: PipelineContextResponse.self)
  }

  func fetchCheckpoint(pipelineID: String) async throws -> PipelineCheckpointResponse {
    let request = try buildRequest(path: "pipelines/\(pipelineID)/checkpoint")
    return try await perform(request, as: PipelineCheckpointResponse.self)
  }

  func fetchGraph(pipelineID: String) async throws -> GraphDocument {
    let request = try buildRequest(path: "pipelines/\(pipelineID)/graph")
    let (data, response) = try await performRaw(request)

    let contentType = response.value(forHTTPHeaderField: "Content-Type")?.lowercased() ?? ""
    let content = String(data: data, encoding: .utf8) ?? ""

    if contentType.contains("image/svg+xml") || content.contains("<svg") {
      return GraphDocument(kind: .svg, content: content)
    }
    return GraphDocument(kind: .dot, content: content)
  }

  func cancelPipeline(pipelineID: String) async throws {
    let request = try buildRequest(path: "pipelines/\(pipelineID)/cancel", method: "POST")
    _ = try await performRaw(request)
  }

  private func perform<T: Decodable>(_ request: URLRequest, as type: T.Type) async throws -> T {
    let (data, _) = try await performRaw(request)
    return try Self.makeDecoder().decode(type, from: data)
  }

  private func performRaw(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else {
      throw AttractorClientError.invalidResponse
    }

    guard (200..<300).contains(http.statusCode) else {
      let message = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
      throw AttractorClientError.httpStatus(
        code: http.statusCode,
        message: message?.isEmpty == false ? message! : "Unknown error"
      )
    }

    return (data, http)
  }

  private func buildRequest(
    path: String,
    method: String = "GET",
    body: Data? = nil
  ) throws -> URLRequest {
    let url = try resolve(path: path)
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.timeoutInterval = 60

    if let body {
      request.httpBody = body
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }

    request.setValue("application/json", forHTTPHeaderField: "Accept")
    return request
  }

  private func resolve(path: String) throws -> URL {
    let clean = path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    guard let url = URL(string: clean, relativeTo: baseURL)?.absoluteURL else {
      throw AttractorClientError.invalidURL("\(baseURL.absoluteString)/\(path)")
    }
    return url
  }

  static func makeDecoder() -> JSONDecoder {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .custom { nestedDecoder in
      let container = try nestedDecoder.singleValueContainer()
      let raw = try container.decode(String.self)

      let withFractional = ISO8601DateFormatter()
      withFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
      if let date = withFractional.date(from: raw) {
        return date
      }

      let plain = ISO8601DateFormatter()
      plain.formatOptions = [.withInternetDateTime]
      if let date = plain.date(from: raw) {
        return date
      }

      throw DecodingError.dataCorruptedError(
        in: container,
        debugDescription: "Expected ISO8601 date string, got: \(raw)"
      )
    }
    return decoder
  }

  private static func makeEncoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    return encoder
  }
}
