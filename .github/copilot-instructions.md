# Copilot Instructions

The contributor rules for this repository are maintained in a single place: **[`AGENTS.md`](../AGENTS.md)**.
Read it (and the files it links) before writing or modifying any code.

In short:

1. **Read [`docs/index.md`](../docs/index.md) first** — it maps what exists and which doc to consult.
2. **API-first** — all data access goes through `src/app/api/**` route handlers; keep `docs/openapi.yaml` in sync.
3. **One place for the LLM** — import `getAIClient()` and model constants from `src/lib/ai/model.ts`; never hardcode model names.
4. **Docs ship with the code** — update the relevant feature doc and `docs/index.md` after every change.

See [`AGENTS.md`](../AGENTS.md) for the full rules and [`docs/contributing.md`](../docs/contributing.md) for step-by-step recipes.
