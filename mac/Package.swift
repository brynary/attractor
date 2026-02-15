// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "AttractorDesktop",
  platforms: [
    .macOS(.v14),
  ],
  products: [
    .executable(name: "AttractorDesktop", targets: ["AttractorDesktop"]),
  ],
  targets: [
    .executableTarget(
      name: "AttractorDesktop",
      path: "Sources/AttractorDesktop",
      linkerSettings: [
        .linkedFramework("WebKit"),
      ]
    ),
    .testTarget(
      name: "AttractorDesktopTests",
      dependencies: ["AttractorDesktop"],
      path: "Tests/AttractorDesktopTests"
    ),
  ]
)
