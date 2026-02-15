import SwiftUI

private enum RunTab: String, CaseIterable, Identifiable {
  case dashboard
  case graph
  case events
  case context
  case checkpoint

  var id: String { rawValue }
}

struct RunDetailView: View {
  @EnvironmentObject private var store: AppStore

  let runID: String

  @State private var tab: RunTab = .dashboard
  @State private var searchText = ""
  @State private var selectedKinds: Set<String> = []
  @State private var answerNote = ""

  private var run: PipelineRunRecord? {
    store.run(withID: runID)
  }

  private var events: [PipelineEventEnvelope] {
    store.events(for: runID)
  }

  var body: some View {
    if let run {
      VStack(alignment: .leading, spacing: 12) {
        header(run)

        Picker("View", selection: $tab) {
          Text("Dashboard")
            .tag(RunTab.dashboard)
            .accessibilityIdentifier("run.tab.dashboard")
          Text("Graph")
            .tag(RunTab.graph)
            .accessibilityIdentifier("run.tab.graph")
          Text("Events")
            .tag(RunTab.events)
            .accessibilityIdentifier("run.tab.events")
          Text("Context")
            .tag(RunTab.context)
            .accessibilityIdentifier("run.tab.context")
          Text("Checkpoint")
            .tag(RunTab.checkpoint)
            .accessibilityIdentifier("run.tab.checkpoint")
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("run.tabPicker")

        tabContent(run)
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    } else {
      GlassCard {
        ContentUnavailableView("Run not found", systemImage: "questionmark.circle")
      }
    }
  }

  private func header(_ run: PipelineRunRecord) -> some View {
    GlassCard {
      HStack(alignment: .center) {
        VStack(alignment: .leading, spacing: 4) {
          Text(run.id)
            .font(.system(size: 24, weight: .bold, design: .monospaced))
            .foregroundStyle(StudioPalette.textPrimary)
            .accessibilityIdentifier("run.detail.id.\(run.id)")
          Text("Submitted \(run.submittedAt.formatted(date: .abbreviated, time: .standard))")
            .font(.callout)
            .foregroundStyle(StudioPalette.textSecondary)
        }

        Spacer()

        HStack(spacing: 8) {
          StatusBadge(text: run.status.rawValue, color: run.status.tintColor)
            .accessibilityIdentifier("run.status.\(run.status.rawValue)")
          if let stage = run.stageStatus {
            StatusBadge(text: stage.rawValue, color: stage.tintColor)
              .accessibilityIdentifier("run.stage.\(stage.rawValue)")
          }
        }
      }
    }
  }

  @ViewBuilder
  private func tabContent(_ run: PipelineRunRecord) -> some View {
    switch tab {
    case .dashboard:
      dashboard(run)
    case .graph:
      graphTab
    case .events:
      eventsTab
    case .context:
      contextTab
    case .checkpoint:
      checkpointTab
    }
  }

  private func dashboard(_ run: PipelineRunRecord) -> some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 10) {
        HStack(spacing: 10) {
          metricCard("Run", run.status.rawValue.capitalized)
          metricCard("Stage", run.stageStatus?.rawValue.capitalized ?? "-")
          metricCard("Events", String(events.count))
          metricCard("Nodes", String(run.completedNodes.count))
        }

        if !run.failureReason.isEmpty {
          GlassCard {
            VStack(alignment: .leading, spacing: 4) {
              Text("Failure")
                .font(.headline)
              Text(run.failureReason)
                .foregroundStyle(.red)
            }
          }
        }

        if let pending = store.pendingQuestionsByRun[run.id] {
          questionCard(runID: run.id, pending: pending)
        }

        GlassCard {
          VStack(alignment: .leading, spacing: 6) {
            Text("Completed Nodes")
              .font(.headline)

            if run.completedNodes.isEmpty {
              Text("No completed nodes yet.")
                .foregroundStyle(StudioPalette.textSecondary)
            } else {
              ForEach(run.completedNodes, id: \.self) { node in
                Text(node)
                  .font(.system(size: 13, design: .monospaced))
                  .foregroundStyle(StudioPalette.textPrimary)
              }
            }
          }
        }
      }
      .padding(.bottom, 8)
    }
  }

  private func questionCard(runID: String, pending: PendingQuestionState) -> some View {
    GlassCard {
      VStack(alignment: .leading, spacing: 8) {
        Text("Human Gate")
          .font(.headline)
        Text(pending.question.text)
          .foregroundStyle(StudioPalette.textPrimary)

        if pending.question.options.isEmpty {
          TextField("Optional note", text: $answerNote)
            .accessibilityIdentifier("run.question.note")
          Button("Submit") {
            Task {
              await store.answerQuestion(
                runID: runID,
                questionID: pending.id,
                value: answerNote.isEmpty ? "submit" : answerNote,
                text: answerNote
              )
              answerNote = ""
            }
          }
          .buttonStyle(StudioPrimaryButtonStyle())
          .accessibilityIdentifier("run.question.submit")
        } else {
          ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
              ForEach(pending.question.options) { option in
                Button(option.label) {
                  Task {
                    await store.answerQuestion(
                      runID: runID,
                      questionID: pending.id,
                      value: option.key,
                      text: answerNote.isEmpty ? nil : answerNote
                    )
                    answerNote = ""
                  }
                }
                .buttonStyle(StudioPrimaryButtonStyle())
                .accessibilityIdentifier("run.question.option.\(option.key)")
              }
            }
          }

          TextField("Optional note", text: $answerNote)
            .accessibilityIdentifier("run.question.note")
        }
      }
    }
    .accessibilityIdentifier("run.question.card")
  }

  private func metricCard(_ title: String, _ value: String) -> some View {
    GlassCard {
      VStack(alignment: .leading, spacing: 2) {
        Text(title)
          .font(.caption)
          .foregroundStyle(StudioPalette.textSecondary)
        Text(value)
          .font(.title3.weight(.semibold))
          .foregroundStyle(StudioPalette.textPrimary)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  private var graphTab: some View {
    GlassCard {
      VStack(alignment: .leading, spacing: 8) {
        HStack {
          Text("Graph")
            .font(.headline)

          Spacer()

          Button {
            Task {
              await store.fetchGraph(runID: runID)
            }
          } label: {
            Label("Reload", systemImage: "arrow.clockwise")
          }
        }

        if let graph = store.graphByRun[runID] {
          GraphDocumentView(document: graph)
            .accessibilityIdentifier("run.graph.document")
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
          ContentUnavailableView("No graph", systemImage: "chart.xyaxis.line")
            .accessibilityIdentifier("run.graph.empty")
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }

  private var eventsTab: some View {
    GlassCard {
      VStack(alignment: .leading, spacing: 8) {
        HStack {
          TextField("Search events", text: $searchText)
            .textFieldStyle(.roundedBorder)

          Menu("Kinds") {
            ForEach(eventKinds, id: \.self) { kind in
              Toggle(isOn: Binding(
                get: { selectedKinds.contains(kind) },
                set: { include in
                  if include { selectedKinds.insert(kind) }
                  else { selectedKinds.remove(kind) }
                }
              )) {
                Text(kind)
              }
            }
          }
        }

        List(filteredEvents.indices, id: \.self) { index in
          let event = filteredEvents[index]
          VStack(alignment: .leading, spacing: 2) {
            HStack {
              Text(event.kind)
                .font(.system(size: 12, weight: .semibold, design: .monospaced))
              Spacer()
              Text(event.timestamp.formatted(date: .omitted, time: .standard))
                .font(.caption)
                .foregroundStyle(StudioPalette.textSecondary)
            }
            Text(eventSummary(event))
              .font(.system(size: 11, design: .monospaced))
              .foregroundStyle(StudioPalette.textSecondary)
              .lineLimit(2)
          }
          .padding(.vertical, 2)
          .accessibilityIdentifier("run.events.row.\(event.kind)")
        }
        .accessibilityIdentifier("run.events.list")
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }

  private var contextTab: some View {
    GlassCard {
      let rows = contextRows
      if rows.isEmpty {
        ContentUnavailableView("No context", systemImage: "tray")
          .accessibilityIdentifier("run.context.empty")
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        Table(rows) {
          TableColumn("Key", value: \.key)
          TableColumn("Value", value: \.value)
        }
        .accessibilityIdentifier("run.context.table")
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
  }

  private var checkpointTab: some View {
    GlassCard {
      if let checkpoint = store.checkpointByRun[runID] ?? nil {
        VStack(alignment: .leading, spacing: 8) {
          HStack {
            Text("Status")
              .font(.headline)
            StatusBadge(text: checkpoint.status.rawValue, color: checkpoint.status.tintColor)
              .accessibilityIdentifier("run.checkpoint.status.\(checkpoint.status.rawValue)")
          }

          Text("Completed Nodes")
            .font(.headline)

          ForEach(checkpoint.completedNodes, id: \.self) { node in
            Text(node)
              .font(.system(size: 13, design: .monospaced))
          }
        }
        .accessibilityIdentifier("run.checkpoint.content")
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      } else {
        ContentUnavailableView("No checkpoint", systemImage: "externaldrive")
          .accessibilityIdentifier("run.checkpoint.empty")
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
  }

  private var eventKinds: [String] {
    Array(Set(events.map(\.kind))).sorted()
  }

  private var filteredEvents: [PipelineEventEnvelope] {
    events.filter { event in
      let kindMatch = selectedKinds.isEmpty || selectedKinds.contains(event.kind)
      guard kindMatch else {
        return false
      }

      let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !query.isEmpty else {
        return true
      }

      let needle = query.lowercased()
      return event.kind.lowercased().contains(needle)
      || eventSummary(event).lowercased().contains(needle)
    }
  }

  private var contextRows: [ContextRow] {
    let context = store.contextByRun[runID] ?? [:]
    return context
      .map { ContextRow(key: $0.key, value: $0.value.stringValue) }
      .sorted(by: { $0.key < $1.key })
  }

  private func eventSummary(_ event: PipelineEventEnvelope) -> String {
    if event.data.isEmpty {
      return "{}"
    }

    return event.data
      .sorted(by: { $0.key < $1.key })
      .map { "\($0.key)=\($0.value.stringValue)" }
      .joined(separator: " ")
  }
}

private struct ContextRow: Identifiable {
  let key: String
  let value: String
  var id: String { key }
}
