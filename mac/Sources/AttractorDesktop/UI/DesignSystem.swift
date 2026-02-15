import SwiftUI

enum StudioPalette {
  static let background = Color(red: 0.97, green: 0.97, blue: 0.96)
  static let panel = Color.white
  static let panelBorder = Color.black.opacity(0.045)
  static let textPrimary = Color(red: 0.16, green: 0.18, blue: 0.20)
  static let textSecondary = Color(red: 0.40, green: 0.45, blue: 0.49)
  static let accent = Color(red: 0.11, green: 0.45, blue: 0.70)
}

struct StudioBackground: View {
  var body: some View {
    StudioPalette.background
      .ignoresSafeArea()
  }
}

struct GlassCard<Content: View>: View {
  let content: Content
  let padding: CGFloat

  init(padding: CGFloat = 14, @ViewBuilder content: () -> Content) {
    self.padding = padding
    self.content = content()
  }

  var body: some View {
    content
      .padding(padding)
      .background(
        RoundedRectangle(cornerRadius: 10, style: .continuous)
          .fill(StudioPalette.panel)
          .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
              .stroke(StudioPalette.panelBorder, lineWidth: 0.75)
          )
          .shadow(color: .black.opacity(0.04), radius: 5, x: 0, y: 2)
      )
  }
}

struct StatusBadge: View {
  let text: String
  let color: Color

  var body: some View {
    Text(text.uppercased())
      .font(.system(size: 10, weight: .semibold))
      .foregroundStyle(color)
      .padding(.horizontal, 8)
      .padding(.vertical, 4)
      .background(
        Capsule(style: .continuous)
          .fill(color.opacity(0.12))
      )
  }
}

struct StudioPrimaryButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: 12, weight: .semibold))
      .foregroundStyle(.white)
      .padding(.horizontal, 10)
      .padding(.vertical, 7)
      .background(
        RoundedRectangle(cornerRadius: 8, style: .continuous)
          .fill(StudioPalette.accent)
      )
      .opacity(configuration.isPressed ? 0.85 : 1)
  }
}

struct StudioGhostButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: 12, weight: .semibold))
      .foregroundStyle(StudioPalette.textPrimary)
      .padding(.horizontal, 10)
      .padding(.vertical, 7)
      .background(
        RoundedRectangle(cornerRadius: 8, style: .continuous)
          .fill(Color.white)
          .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
              .stroke(StudioPalette.panelBorder, lineWidth: 0.75)
          )
      )
      .opacity(configuration.isPressed ? 0.85 : 1)
  }
}

struct StudioSectionHeading: View {
  let title: String
  let subtitle: String

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(title)
        .font(.system(size: 28, weight: .bold, design: .default))
        .foregroundStyle(StudioPalette.textPrimary)
      Text(subtitle)
        .font(.system(size: 14))
        .foregroundStyle(StudioPalette.textSecondary)
    }
  }
}

extension PipelineRunState {
  var tintColor: Color {
    switch self {
    case .running:
      return StudioPalette.accent
    case .completed:
      return .green
    case .failed:
      return .red
    case .cancelled:
      return .orange
    }
  }
}

extension StageStatus {
  var tintColor: Color {
    switch self {
    case .success:
      return .green
    case .partialSuccess:
      return .mint
    case .retry:
      return .orange
    case .fail:
      return .red
    case .skipped:
      return .gray
    }
  }
}
