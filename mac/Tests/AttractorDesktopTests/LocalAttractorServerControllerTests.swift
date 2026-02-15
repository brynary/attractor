import XCTest
@testable import AttractorDesktop

final class LocalAttractorServerControllerTests: XCTestCase {
  @MainActor
  func testLocalhostDetection() {
    XCTAssertTrue(LocalAttractorServerController.isLocalhost(URL(string: "http://127.0.0.1:3000")!))
    XCTAssertTrue(LocalAttractorServerController.isLocalhost(URL(string: "http://localhost:3000")!))
    XCTAssertTrue(LocalAttractorServerController.isLocalhost(URL(string: "http://[::1]:3000")!))

    XCTAssertFalse(LocalAttractorServerController.isLocalhost(URL(string: "https://example.com")!))
    XCTAssertFalse(LocalAttractorServerController.isLocalhost(URL(string: "http://192.168.1.20:3000")!))
  }
}
