import XCTest
@testable import AttractorDesktop

final class AttractorModelsTests: XCTestCase {
  func testJSONValueDecodesNestedObject() throws {
    let input = """
    {
      "status": "success",
      "attempt": 2,
      "flags": [true, false],
      "meta": { "owner": "qa" }
    }
    """.data(using: .utf8)!

    let value = try JSONDecoder().decode([String: JSONValue].self, from: input)

    XCTAssertEqual(value["status"], .string("success"))
    XCTAssertEqual(value["attempt"], .int(2))
    XCTAssertEqual(value["flags"], .array([.bool(true), .bool(false)]))
    XCTAssertEqual(value["meta"], .object(["owner": .string("qa")]))
  }

  func testPipelineStatusDecoding() throws {
    let input = """
    {
      "id": "run-1",
      "status": "completed",
      "result": {
        "status": "partial_success",
        "completedNodes": ["start", "test", "exit"],
        "failureReason": null
      }
    }
    """.data(using: .utf8)!

    let decoder = JSONDecoder()
    let status = try decoder.decode(PipelineStatusResponse.self, from: input)

    XCTAssertEqual(status.id, "run-1")
    XCTAssertEqual(status.status, .completed)
    XCTAssertEqual(status.result?.status, .partialSuccess)
    XCTAssertEqual(status.result?.completedNodes.count, 3)
  }
}
