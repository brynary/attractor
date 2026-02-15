import Foundation

enum PipelineTemplate: String, CaseIterable, Identifiable {
  case quickStart
  case codeReview
  case robustDelivery
  case parallelBuild

  var id: String { rawValue }

  var title: String {
    switch self {
    case .quickStart:
      return "Quick Start"
    case .codeReview:
      return "Code Review"
    case .robustDelivery:
      return "Robust Delivery"
    case .parallelBuild:
      return "Parallel Build"
    }
  }

  var dot: String {
    switch self {
    case .quickStart:
      return """
      digraph QuickStart {
          graph [goal="Generate and review greeting code"]

          start  [shape=Mdiamond]
          exit   [shape=Msquare]

          write  [label="Write", prompt="Write a TypeScript greet(name: string) function"]
          review [label="Review", prompt="Review for correctness and style"]

          start -> write -> review -> exit
      }
      """
    case .codeReview:
      return """
      digraph CodeReview {
          graph [goal="Review and improve code quality"]
          node [timeout="900s"]

          start      [shape=Mdiamond]
          exit       [shape=Msquare]

          analyze    [label="Analyze", prompt="Analyze repository for code quality issues"]
          plan_fixes [label="Plan Fixes", prompt="Create a focused fix plan"]
          implement  [label="Fix", prompt="Implement the planned changes"]
          verify     [label="Verify", prompt="Run tests and summarize results"]
          gate       [shape=hexagon, label="Human Review"]

          start -> analyze -> plan_fixes -> implement -> verify
          verify -> gate      [label="Pass", condition="outcome=success"]
          verify -> implement [label="Fail", condition="outcome!=success"]
          gate -> exit        [label="[A] Approve"]
          gate -> implement   [label="[R] Revise"]
      }
      """
    case .robustDelivery:
      return """
      digraph Robust {
          graph [goal="Deploy with confidence", default_max_retry=3, retry_target="implement"]

          start     [shape=Mdiamond]
          exit      [shape=Msquare]
          implement [label="Implement", prompt="Implement the feature", max_retries=2]
          test      [label="Test", prompt="Run full test suite", goal_gate=true]
          deploy    [label="Deploy", prompt="Deploy to staging"]

          start -> implement -> test -> deploy -> exit
      }
      """
    case .parallelBuild:
      return """
      digraph ParallelWork {
          graph [goal="Build frontend and backend in parallel"]

          start    [shape=Mdiamond]
          exit     [shape=Msquare]

          fan_out  [shape=component, label="Split Work"]
          frontend [label="Frontend", prompt="Build the frontend"]
          backend  [label="Backend", prompt="Build the API"]
          fan_in   [shape=tripleoctagon, label="Merge"]

          start -> fan_out
          fan_out -> frontend
          fan_out -> backend
          frontend -> fan_in
          backend -> fan_in
          fan_in -> exit
      }
      """
    }
  }
}
