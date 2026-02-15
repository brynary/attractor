# Attractor Studio (macOS)

Native SwiftUI desktop app for controlling and observing Attractor pipeline runs.

## Features

- Multi-server profiles (`http://127.0.0.1:3000` by default)
- DOT pipeline composer with curated templates
- Pipeline run controls (start, refresh, cancel)
- Real-time event stream via SSE (`/pipelines/:id/events`)
- Human gate workflow (`/pipelines/:id/questions` + answer endpoint)
- Graph visualization (`/pipelines/:id/graph`)
- Context and checkpoint inspection
- Persisted workspace (profiles, draft DOT, recent runs)

## Build

```bash
cd mac
swift build
```

## Run

```bash
cd mac
swift run AttractorDesktop
```

Make sure the Attractor server is running, for example:

```bash
bun run attractor/bin/attractor-server.ts
```

## Test

```bash
cd mac
swift test
```

Optional UI automation smoke tests (requires macOS Accessibility permission):

```bash
cd mac
ATTRACTOR_STUDIO_ENABLE_UI_AUTOMATION=1 swift test --filter MacUIAutomationTests
```

## Architecture

- `Sources/AttractorDesktop/Networking`: typed Attractor API client + SSE support
- `Sources/AttractorDesktop/App`: app state, persistence, app entry point
- `Sources/AttractorDesktop/UI`: SwiftUI views and WebKit graph renderer
- `Sources/AttractorDesktop/Models`: shared data models and value types
- `Sources/AttractorDesktop/Utils`: templates and helper data
