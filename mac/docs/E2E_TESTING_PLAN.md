# Attractor Studio E2E Testing Plan

## Goal
Validate that the macOS app can reliably control and observe Attractor pipelines across the critical user journeys.

## Scope
- App startup and profile selection
- Pipeline submission (normal and local auto-start fallback)
- Live run tracking (events + polling)
- Human-gate interaction
- Run controls (refresh, cancel)
- Observability tabs (graph, context, checkpoint)
- Error handling for local vs remote servers

## Environments
1. Local development: macOS + Bun + local Attractor server
2. Failure mode: no local server initially running
3. Remote mode: non-local profile where auto-start must not trigger

## Critical Path Matrix
| ID | Path | Preconditions | Steps | Expected |
|---|---|---|---|---|
| CP-1 | Launch + bootstrap | Fresh app state | Open app | Local profile exists (`127.0.0.1:3000`), composer visible |
| CP-2 | Submit pipeline (server running) | Local server up | Run pipeline | Run appears in sidebar, status starts `running` |
| CP-3 | Submit pipeline (server down) | Local profile, server down | Run pipeline | App auto-starts server, retries submit, run created |
| CP-4 | Submit pipeline (remote down) | Remote profile unreachable | Run pipeline | No auto-start; user gets connection error |
| CP-5 | Run lifecycle convergence | Running run | Stream + poll events | Run transitions to `completed`/`failed` correctly |
| CP-6 | Human gate answer | Pending question exists | Submit answer | Pending question cleared; answer acknowledged |
| CP-7 | Cancel run | Running run | Cancel action | Run transitions to `cancelled` |
| CP-8 | Artifact refresh | Completed run | Refresh | Graph/context/checkpoint load without error |

## Automated Coverage (Current)
Automated integration-style tests in `mac/Tests/AttractorDesktopTests/E2EAppStoreTests.swift` cover:
- CP-2/CP-5: submit and lifecycle tracking updates
- CP-3: local auto-start fallback on connection failure
- CP-4: remote connection failure does not trigger auto-start
- CP-6: answering pending question clears state
- CP-7: cancel transitions run state to `cancelled`
- CP-8: refresh loads context/checkpoint/graph

UI automation tests in `mac/Tests/AttractorDesktopTests/MacUIAutomationTests.swift` cover:
- CP-1: app launch renders composer controls
- CP-2: clicking Run Pipeline opens run detail for `ui-run-001`
- CP-6: human-gate question can be answered from run view
- CP-5/CP-8: completed run exposes Graph, Events, Context, and Checkpoint tabs
- CP-7: cancel from toolbar transitions run status to `cancelled`

Unit coverage:
- model decoding tests in `AttractorModelsTests.swift`
- localhost detection test in `LocalAttractorServerControllerTests.swift`

## Manual E2E Checklist
1. Kill server; run pipeline on local profile; verify auto-start and successful run creation.
2. Add remote profile (`https://example.com`), select it, run pipeline; verify clear connection error.
3. Run a graph with human gate; answer question from dashboard; confirm path advances.
4. Open run tabs (Graph, Events, Context, Checkpoint); verify content appears and refresh works.
5. Start a long-running pipeline and cancel it; verify state changes to cancelled.

## Regression Gate
Before merging any app flow changes:
```bash
cd mac
swift test
```

For UI smoke coverage on a desktop session with Accessibility enabled:
```bash
cd mac
ATTRACTOR_STUDIO_ENABLE_UI_AUTOMATION=1 swift test --filter MacUIAutomationTests
```

Pass criteria:
- all tests green
- no crash during manual CP-1..CP-8 smoke run
