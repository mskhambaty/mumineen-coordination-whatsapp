# Contributing — Rules for New Features and Files

## Before You Start

1. **Read `docs/index.md`** — understand the existing feature map.
2. **Read the doc** for the area you are changing.
3. Check whether a new doc file is needed (see below).

## Code Conventions

- Language: TypeScript (strict mode). No `any` unless unavoidable.
- Formatting: ESLint (`npm run lint`) must pass before committing.
- Path alias: use `@/lib/...` and `@/app/...`, not relative `../../` imports.
- No secrets in code. All secrets come from environment variables via `requireEnv()` or `optionalEnv()`.
- Server-only code stays in `src/lib/` and `src/app/api/`. Nothing secret-adjacent goes to a client component.
- API-first: pages and components must call `src/app/api/**` routes rather than querying Supabase directly.
- OpenAI calls must use `src/lib/ai/model.ts`; do not hardcode model names elsewhere.

## Adding a New API Route

1. Create the route under `src/app/api/<feature>/route.ts`.
2. Use `requireEnv()` for any required env vars; add them to [environment.md](./environment.md).
3. Add the route to the key file locations table in [index.md](./index.md).
4. Document the endpoint in the relevant feature doc (or create one if none exists).
5. Update [openapi.yaml](./openapi.yaml) with parameters, request body, responses, auth, and schemas.

## Adding a New Tool

1. Add a `ToolDefinition` to `toolDefinitions` in `src/lib/agent/tools.ts`.
2. Add the tool name to `publicTools` or `committeeTools` in `src/lib/permissions.ts`.
3. Add a `case` to `runTool()` in `tools.ts`.
4. Update the tool table and access matrix in [ai-agent.md](./ai-agent.md) and [permissions.md](./permissions.md).

## Adding a New Database Table or Column

1. Create a new migration file: `supabase/migrations/YYYYMMDDHHMMSS_description.sql`.
2. Never edit an already-applied migration file.
3. Enable RLS on any new table.
4. Update [database.md](./database.md) with the new table/column definition.

## Adding a New Environment Variable

1. Add it to `.env.example` with a comment.
2. Add an alias entry in `src/lib/env.ts` if needed.
3. Document it in [environment.md](./environment.md).

## Updating an Existing Feature

1. Make the code change.
2. Update the corresponding doc in `docs/` to reflect the change.
3. If the change affects architecture or flow, update [architecture.md](./architecture.md).

## Adding a New Doc File

Create a new `.md` file in `docs/` when:
- A new major feature is added (e.g., a new subsystem or integration).
- An existing doc grows too large to be readable.

When you add a new doc:
1. Add a row to the Document Map table in [index.md](./index.md).
2. Give the file a clear, lowercase, hyphenated name (e.g., `volunteer-roster.md`).
3. Start the file with a one-paragraph summary of what the feature does.

## Commit Messages

Use the conventional commit format:

```
feat: add volunteer roster tool
fix: handle empty webhook payload
docs: update database schema for site_content
chore: bump openai sdk
```

## Running Checks

```bash
npm run lint    # ESLint
npm run test    # Vitest unit tests
npm run build   # Next.js production build
```

All three must pass before merging.
