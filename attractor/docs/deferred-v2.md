# Attractor v2 - Deferred Items

Items not included in v1 implementation. See attractor-spec.md for full details.

1. **HTTP Server Mode** (spec 9.5) - REST API, SSE events, web human gates
2. **Full ManagerLoopHandler** (spec 4.11) - child pipeline spawning, telemetry, guard/steer
3. **CLI Agent Backends** - Claude Code/Codex/Gemini subprocess and tmux management
4. **Context Fidelity Implementation** (spec 5.4) - full/truncate/compact/summary modes with actual LLM summarization
5. **Tool Call Hooks** (spec 9.7) - pre/post shell hooks around LLM tool calls
6. **Pipeline Composition** (spec 9.4) - sub-pipeline nodes, graph merging transform
7. **Artifact Store File Backing** (spec 5.5) - 100KB threshold disk storage
8. **ConsoleInterviewer Robustness** - non-blocking stdin, terminal formatting, input validation
9. **loop_restart Edge Attribute** (spec 2.7, 3.2) - terminate and re-launch with fresh log dir
10. **Parallel Handler Advanced Policies** - k_of_n, quorum, first_success join; fail_fast error; bounded parallelism
