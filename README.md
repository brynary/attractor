# Attractor

> **This project is no longer maintained.** The ideas here have evolved into [Fabro](https://github.com/fabro-sh/fabro), a production-ready software factory built in Rust. If you're interested in DOT-based AI workflow orchestration, check out Fabro instead.

---

Attractor was a prototype for defining multi-stage AI workflows as Graphviz DOT graphs and executing them automatically — handling retries, checkpoints, parallel branches, human approvals, and conditional routing.

It is a Bun/TypeScript monorepo with three packages:

- **unified-llm** — Unified LLM client for Anthropic, OpenAI, and Gemini
- **coding-agent** — Agentic coding loop with tool use (read, write, edit, shell, grep, glob)
- **attractor** — DOT-based pipeline orchestration engine
