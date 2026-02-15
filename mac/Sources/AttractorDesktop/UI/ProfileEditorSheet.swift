import SwiftUI

struct ProfileEditorSheet: View {
  @EnvironmentObject private var store: AppStore
  @Environment(\.dismiss) private var dismiss

  @State private var name: String = ""
  @State private var baseURL: String = "http://127.0.0.1:3000"

  var body: some View {
    ZStack {
      StudioBackground()

      VStack(alignment: .leading, spacing: 12) {
        Text("Server Profiles")
          .font(.title.bold())
          .foregroundStyle(StudioPalette.textPrimary)

        GlassCard {
          VStack(alignment: .leading, spacing: 8) {
            ForEach(store.profiles) { profile in
              HStack {
                VStack(alignment: .leading, spacing: 2) {
                  Text(profile.name)
                    .font(.headline)
                    .foregroundStyle(StudioPalette.textPrimary)
                  Text(profile.baseURLString)
                    .font(.caption)
                    .foregroundStyle(StudioPalette.textSecondary)
                    .textSelection(.enabled)
                }
                Spacer()
                Button(role: .destructive) {
                  store.removeProfile(profile)
                } label: {
                  Image(systemName: "trash")
                }
                .disabled(store.profiles.count <= 1)
              }
            }
          }
        }

        GlassCard {
          VStack(alignment: .leading, spacing: 8) {
            TextField("Name", text: $name)
              .textFieldStyle(.roundedBorder)
            TextField("Base URL", text: $baseURL)
              .textFieldStyle(.roundedBorder)

            HStack {
              Spacer()
              Button("Add") {
                store.addProfile(name: name, baseURLString: baseURL)
                name = ""
                baseURL = "http://127.0.0.1:3000"
              }
              .buttonStyle(StudioPrimaryButtonStyle())
            }
          }
        }

        HStack {
          Spacer()
          Button("Done") {
            dismiss()
          }
          .buttonStyle(StudioGhostButtonStyle())
          .keyboardShortcut(.defaultAction)
        }
      }
      .padding(20)
    }
    .frame(width: 620, height: 500)
  }
}
