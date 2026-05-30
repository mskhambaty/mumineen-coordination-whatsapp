## Coding Rules

Always read `docs/index.md` before starting to write or modify any code in this repository. The index tells you what exists, where it lives, and which feature doc to consult before making changes.

## API-First Rule

Every data access or action MUST go through `src/app/api/**` route handlers. No page, component, or server action may query the database directly.

The API contract is defined in `docs/openapi.yaml`. Update it for every API route addition or behavior change.

## LLM Rule

All OpenAI calls MUST import `getAIClient()` and model constants from `src/lib/ai/model.ts`. Never hardcode model names outside that file.

## Documentation Rule

Always update the relevant feature doc and `docs/index.md` after implementing a feature.
