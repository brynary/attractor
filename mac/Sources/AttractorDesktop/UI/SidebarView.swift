import SwiftUI

struct SidebarView: View {
  @EnvironmentObject private var store: AppStore

  var body: some View {
    List {
      Section {
        Button {
          store.select(.composer)
        } label: {
          HStack(spacing: 6) {
            Image(systemName: "square.and.pencil")
              .font(.system(size: 11, weight: .semibold))
            Text("Composer")
              .font(.system(size: 12, weight: .semibold))
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("sidebar.composer")
        .listRowBackground(rowBackground(isSelected: store.selection == .composer))
      }

      Section("Runs") {
        if store.runs.isEmpty {
          Text("No runs yet")
            .foregroundStyle(StudioPalette.textSecondary)
            .font(.caption)
            .accessibilityIdentifier("sidebar.noRuns")
        }

        ForEach(store.runs) { run in
          Button {
            store.select(.run(run.id))
          } label: {
            SidebarRunRow(run: run)
              .frame(maxWidth: .infinity, alignment: .leading)
          }
          .buttonStyle(.plain)
          .accessibilityIdentifier("sidebar.run.\(run.id)")
          .listRowBackground(rowBackground(isSelected: store.selection == .run(run.id)))
        }
      }
    }
    .listStyle(.sidebar)
    .environment(\.defaultMinListRowHeight, 24)
    .accessibilityIdentifier("sidebar.list")
  }

  private func rowBackground(isSelected: Bool) -> some View {
    Group {
      if isSelected {
        RoundedRectangle(cornerRadius: 7, style: .continuous)
          .fill(StudioPalette.accent.opacity(0.18))
      } else {
        Color.clear
      }
    }
  }
}

private struct SidebarRunRow: View {
  let run: PipelineRunRecord

  var body: some View {
    HStack(spacing: 6) {
      Circle()
        .fill(run.status.tintColor)
        .frame(width: 7, height: 7)

      VStack(alignment: .leading, spacing: 1) {
        Text(run.id)
          .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
          .lineLimit(1)
        Text(run.status.rawValue)
          .font(.caption2)
          .foregroundStyle(StudioPalette.textSecondary)
      }

      Spacer(minLength: 0)

      if let stageStatus = run.stageStatus {
        Text(stageStatus.rawValue)
          .font(.system(size: 10))
          .foregroundStyle(stageStatus.tintColor)
      }
    }
    .padding(.vertical, 1)
  }
}
