import SwiftUI

struct RootWorkspaceView: View {
  @EnvironmentObject private var store: AppStore

  var body: some View {
    ZStack {
      StudioBackground()

      NavigationSplitView {
        SidebarView()
          .environmentObject(store)
          .navigationSplitViewColumnWidth(min: 180, ideal: 210, max: 240)
      } detail: {
        detailView
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
          .padding(.vertical, 14)
          .padding(.horizontal, 22)
      }
      .navigationSplitViewStyle(.balanced)
    }
    .toolbar {
      ToolbarItemGroup(placement: .automatic) {
        Picker("Server", selection: $store.selectedProfileID) {
          ForEach(store.profiles) { profile in
            Text(profile.name).tag(profile.id as UUID?)
          }
        }
        .frame(width: 220)
        .accessibilityIdentifier("toolbar.serverPicker")

        Button(action: { store.isProfileSheetPresented = true }) {
          Image(systemName: "plus")
        }
        .help("Add server profile")
        .accessibilityIdentifier("toolbar.addProfileButton")

        Button {
          Task {
            await store.submitDraftPipeline()
          }
        } label: {
          Image(systemName: store.isSubmitting ? "hourglass" : "play.fill")
        }
        .help("Run draft pipeline")
        .accessibilityIdentifier("toolbar.runPipelineButton")

        if case .run(let runID) = store.selection {
          Button {
            Task {
              await store.refreshNow(runID: runID)
            }
          } label: {
            Image(systemName: "arrow.clockwise")
          }
          .help("Refresh selected run")
          .accessibilityIdentifier("toolbar.refreshRunButton")

          Button(role: .destructive) {
            Task {
              await store.cancel(runID: runID)
            }
          } label: {
            Image(systemName: "stop.fill")
          }
          .help("Cancel selected run")
          .accessibilityIdentifier("toolbar.cancelRunButton")
        }
      }
    }
    .sheet(isPresented: $store.isProfileSheetPresented) {
      ProfileEditorSheet()
        .environmentObject(store)
    }
    .overlay(alignment: .bottom) {
      statusMessages
        .padding(.bottom, 12)
    }
    .preferredColorScheme(.light)
  }

  @ViewBuilder
  private var detailView: some View {
    switch store.selection {
    case .composer, .none:
      ComposerView()
        .environmentObject(store)
    case .run(let runID):
      RunDetailView(runID: runID)
        .environmentObject(store)
    }
  }

  @ViewBuilder
  private var statusMessages: some View {
    if let error = store.lastErrorMessage {
      MessagePill(
        title: "Error",
        message: error,
        tint: .red,
        closeAction: store.clearError
      )
      .accessibilityIdentifier("status.error")
    } else if let info = store.lastInfoMessage {
      MessagePill(
        title: "Info",
        message: info,
        tint: StudioPalette.accent,
        closeAction: store.clearInfo
      )
      .accessibilityIdentifier("status.info")
    }
  }
}

private struct MessagePill: View {
  let title: String
  let message: String
  let tint: Color
  let closeAction: () -> Void

  var body: some View {
    HStack(spacing: 10) {
      Text(title)
        .font(.caption.weight(.semibold))
        .foregroundStyle(tint)

      Text(message)
        .font(.callout)
        .foregroundStyle(StudioPalette.textPrimary)
        .lineLimit(3)

      Spacer(minLength: 8)

      Button(action: closeAction) {
        Image(systemName: "xmark.circle.fill")
          .foregroundStyle(StudioPalette.textSecondary)
      }
      .buttonStyle(.plain)
    }
    .padding(10)
    .background(
      RoundedRectangle(cornerRadius: 10, style: .continuous)
        .fill(.white)
        .overlay(
          RoundedRectangle(cornerRadius: 10, style: .continuous)
            .stroke(StudioPalette.panelBorder, lineWidth: 1)
        )
    )
    .frame(maxWidth: 620)
  }
}
