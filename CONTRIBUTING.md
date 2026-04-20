# Contributing to langmem-ts

Thanks for looking. This is an early project (v0.1.0) and the core surface is intentionally small. Contributions that extend it in the directions listed in the [roadmap](./README.md#roadmap) are the most useful; please read that section first.

## Before you open a PR

**For small changes** (docs, typos, metadata filter tweaks, tests, a new example): open a PR directly. Reference the related issue if one exists.

**For anything touching an interface** (`Embedder`, `Store`, `Retriever`, `Extractor`) or adding a new one: open an issue first. The four interfaces are the library's contract — they're stable on purpose, and changes need a design pass before code. A 10-minute design discussion saves a 3-hour PR revision.

**For a new backend implementation** (e.g., `SqliteVecStore`, `QdrantRetriever`): open an issue with the proposed module name, the dependencies it will pull in, and how consumers will install it. Backends should be additive — existing `PgVectorStore` / `PgVectorRetriever` behavior must not change.

## What I'm looking for

Good PRs in priority order:

1. **Bug fixes with a regression test.**
2. **Roadmap items** from the README — especially namespacing, metadata filtering, and alternative backends.
3. **Examples** under `examples/` that demonstrate a real integration (LangGraph, Vercel AI SDK, Mastra, plain Express).
4. **Docs improvements** — if something in the README confused you, it will confuse the next person too.

What I'll probably close:

- Large refactors without a prior issue.
- New dependencies without a clear justification (this library is intentionally thin).
- Framework coupling (LangChain, LangGraph, etc.) — this is by-design scope.
- PRs that add `process.env` reads inside library code. The consumer owns configuration.

## Dev setup

```bash
git clone https://github.com/ereztdev/langmem-ts.git
cd langmem-ts
npm install
docker compose up -d
export OPENAI_API_KEY=sk-...
export DATABASE_URL=postgres://langmem:langmem@localhost:5432/langmem
npm test -- --run
```

Core scripts:

- `npm run build` — tsup dual build (CJS + ESM)
- `npm test -- --run` — vitest in run-once mode
- `npx tsc --noEmit` — type-check without emit
- `npx tsx examples/basic.ts` — end-to-end smoke test against docker-compose Postgres

## Code standards

- **TypeScript strict mode.** No `any`, no `@ts-ignore` without a comment explaining why.
- **Interface-first.** If you're adding a capability, define the interface in `types.ts` first, then implement. The default implementation is one choice, not the only one.
- **No env reads inside `src/`.** Config comes through constructors. Examples and tests can read env at the entry point.
- **One concern per PR.** Bundling a bug fix + a new feature + a refactor makes review slow and risky. Split them.
- **Tests.** New behavior needs a test. New interface methods need a test for each implementation.

## Review expectations

I'm one person shipping this on the side. Realistic cadence:

- **Small PRs**: reviewed within ~1 week.
- **Medium PRs** (new feature, single file): 1–2 weeks.
- **Large PRs** (new backend, cross-cutting changes): 2–4 weeks, and only if they had a prior issue.

If I haven't responded in the window above, ping the PR. Silence usually means I missed it, not that I rejected it.

## Commit messages

Conventional Commits style preferred but not enforced:

- `feat:` new capability
- `fix:` bug fix
- `docs:` README / comment changes
- `test:` test-only changes
- `chore:` tooling, CI, metadata

## License

By submitting a PR, you agree your contribution is licensed under MIT, same as the rest of the project.
