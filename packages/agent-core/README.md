# @brandforge/agent-core

Phase 3: orchestrator, model router, OpenRouter client live here.
**Nothing here executes AI.**

- `AGENT_PHASE = 'stub'` — build-time marker consumed by the API/UI to show
  honest "AI not configured yet" states.
- `PLANNED_TOOLS` — the 13 planned tool names, each mapped to
  `NOT_IMPLEMENTED` in `NOT_IMPLEMENTED`.
- `toolRegistry` — empty; Phase 3 registers real `AgentTool`
  implementations here.
- `AgentTool<Input, Output>` — the typed tool contract.
