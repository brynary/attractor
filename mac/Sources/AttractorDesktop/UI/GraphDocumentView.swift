import SwiftUI
import WebKit

struct GraphDocumentView: NSViewRepresentable {
  let document: GraphDocument

  func makeNSView(context: Context) -> WKWebView {
    let configuration = WKWebViewConfiguration()
    configuration.defaultWebpagePreferences.allowsContentJavaScript = false

    let webView = WKWebView(frame: .zero, configuration: configuration)
    webView.setValue(false, forKey: "drawsBackground")
    webView.isInspectable = true
    return webView
  }

  func updateNSView(_ webView: WKWebView, context: Context) {
    webView.loadHTMLString(htmlString(for: document), baseURL: nil)
  }

  private func htmlString(for document: GraphDocument) -> String {
    switch document.kind {
    case .svg:
      return """
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <style>
          body {
            margin: 0;
            background: #f7f7f6;
            color: #243038;
            font-family: "Avenir Next", -apple-system, BlinkMacSystemFont, sans-serif;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            min-height: 100vh;
            padding: 12px;
          }
          svg {
            width: 100%;
            height: auto;
            background: rgba(255, 255, 255, 0.88);
            border-radius: 14px;
            box-shadow: 0 6px 18px rgba(23, 34, 41, 0.12);
            border: 1px solid rgba(24, 35, 46, 0.12);
            padding: 8px;
          }
        </style>
      </head>
      <body>
        \(document.content)
      </body>
      </html>
      """

    case .dot:
      return """
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8"/>
        <style>
          body {
            margin: 0;
            background: #f7f7f6;
            color: #243038;
            font-family: Menlo, SFMono-Regular, ui-monospace, monospace;
            padding: 12px;
          }
          pre {
            margin: 0;
            white-space: pre-wrap;
            word-break: break-word;
            line-height: 1.45;
            background: rgba(255, 255, 255, 0.86);
            border: 1px solid rgba(24, 35, 46, 0.12);
            border-radius: 14px;
            padding: 16px;
            box-shadow: 0 6px 18px rgba(23, 34, 41, 0.1);
          }
        </style>
      </head>
      <body>
        <pre>\(escapeHTML(document.content))</pre>
      </body>
      </html>
      """
    }
  }

  private func escapeHTML(_ input: String) -> String {
    input
      .replacingOccurrences(of: "&", with: "&amp;")
      .replacingOccurrences(of: "<", with: "&lt;")
      .replacingOccurrences(of: ">", with: "&gt;")
      .replacingOccurrences(of: "\"", with: "&quot;")
      .replacingOccurrences(of: "'", with: "&#39;")
  }
}
