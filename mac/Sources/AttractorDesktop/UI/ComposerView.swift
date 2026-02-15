import SwiftUI

struct ComposerView: View {
  @EnvironmentObject private var store: AppStore

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      StudioSectionHeading(
        title: "Pipeline Composer",
        subtitle: "Write DOT and run."
      )
      .accessibilityIdentifier("composer.title")

      HStack(spacing: 10) {
        GlassCard(padding: 10) {
          HStack(spacing: 8) {
            Text("Template")
              .font(.caption)
              .foregroundStyle(StudioPalette.textSecondary)

            Picker("Template", selection: $store.selectedTemplate) {
              ForEach(PipelineTemplate.allCases) { template in
                Text(template.title).tag(template)
              }
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .onChange(of: store.selectedTemplate) { _, template in
              store.applyTemplate(template)
            }
            .accessibilityIdentifier("composer.templatePicker")
          }
        }
        .frame(maxWidth: 340, alignment: .leading)

        Spacer(minLength: 0)

        Button {
          Task {
            await store.submitDraftPipeline()
          }
        } label: {
          Label(store.isSubmitting ? "Starting..." : "Run Pipeline", systemImage: "play.fill")
        }
        .buttonStyle(StudioPrimaryButtonStyle())
        .disabled(store.isSubmitting)
        .accessibilityIdentifier("composer.runPipelineButton")
      }

      GlassCard(padding: 8) {
        TextEditor(text: $store.draftDOT)
          .font(.system(size: 13, weight: .regular, design: .monospaced))
          .foregroundStyle(StudioPalette.textPrimary)
          .scrollContentBackground(.hidden)
          .background(Color.clear)
          .textEditorStyle(.plain)
          .padding(4)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .accessibilityIdentifier("composer.dotEditor")
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}
