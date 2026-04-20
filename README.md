<div align="center">

![langmem-ts splash banner](assets/splash.png)

# langmem-ts

**TypeScript first class memory primitive for AI agents.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![npm version](https://img.shields.io/npm/v/langmem-ts)](https://www.npmjs.com/package/langmem-ts)
[![npm downloads](https://img.shields.io/npm/dm/langmem-ts)](https://www.npmjs.com/package/langmem-ts)
[![bundle size](https://img.shields.io/bundlephobia/minzip/langmem-ts)](https://bundlephobia.com/package/langmem-ts)

`extract → embed → store → retrieve` over any Postgres + pgvector backend.

</div>

---

## Status

**Early development.** Published on npm as `langmem-ts@0.1.0`. API surface is stable for the core primitive; expect additions, not breaking changes.

## Why

LangMem (Python) is excellent but Python-only. Mem0 is TypeScript-capable but VC-backed with the usual bifurcation risks. There is no credible MIT-licensed, framework-agnostic, TypeScript-native memory library for AI agents. `langmem-ts` fills that gap.

## Install

```bash
npm install langmem-ts
```

Peer dependencies (you bring your own):

```bash
npm install openai pg
```

## Quick start

```ts
import {
  OpenAIEmbedder,
  PgVectorStore,
  PgVectorRetriever,
  LLMExtractor,
} from "langmem-ts";

// Compose the four primitives
const extractor = new LLMExtractor({ apiKey: process.env.OPENAI_API_KEY! });
const embedder = new OpenAIEmbedder({ apiKey: process.env.OPENAI_API_KEY! });
const store = new PgVectorStore({ connectionString: process.env.DATABASE_URL! });
const retriever = new PgVectorRetriever({ connectionString: process.env.DATABASE_URL! });

// Validate that the column dimension matches your embedder output
await store.init(1536);

// Extract facts from a conversation turn
const facts = await extractor.extract({
  role: "user",
  content: "I decided to use pgvector for my memory system",
});

// Embed and store each fact
for (const fact of facts) {
  const vector = await embedder.embed(fact);
  await store.write({ content: fact, vector, metadata: { tags: ["tech"] } });
}

// Retrieve by semantic query later
const queryVector = await embedder.embed("what did I decide about vector databases");
const results = await retriever.search(queryVector, { topK: 5 });

for (const { memory, score } of results) {
  console.log(`[${score.toFixed(2)}] ${memory.content}`);
}

// Clean up when done
await store.close();
await retriever.close();
```

## Core concepts

`langmem-ts` exposes four interfaces, each with a default OpenAI + Postgres implementation. Consumers swap any piece without touching library internals.

| Interface | Default | Purpose |
|---|---|---|
| `Embedder` | `OpenAIEmbedder` | Turns text into a vector |
| `Store` | `PgVectorStore` | Writes memories to Postgres + pgvector |
| `Retriever` | `PgVectorRetriever` | Searches memories by vector similarity |
| `Extractor` | `LLMExtractor` | Distills conversation turns into facts worth remembering |

Every default accepts config via its constructor. The library never reads `process.env` on your behalf.

## Requirements

- Node.js 18 or newer
- Postgres with the [pgvector](https://github.com/pgvector/pgvector) extension enabled
- OpenAI API key (for default embedder + extractor — swap these out if you want)

## Database setup

Run the reference migration against your Postgres database:

```sql
-- langmem-ts reference migration
-- Creates the pgvector extension and the default `memories` table.
--
-- IMPORTANT: The `embedding` column's dimension (1536 below) must match
-- the dimensions your Embedder produces. The library validates this at
-- startup and will refuse to run if they disagree.
--
-- If you use a different embedding model or dimension, change vector(1536)
-- to your model's output dimension BEFORE running this migration.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS memories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content     TEXT NOT NULL,
  embedding   vector(1536) NOT NULL,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memories_embedding_idx
  ON memories USING ivfflat (embedding vector_cosine_ops);
```

The `1536` dimension matches the default embedder (OpenAI `text-embedding-3-large` with `dimensions: 1536` parameter for matryoshka truncation). Changing the embedding model or dimensions after memories exist will corrupt retrieval — `PgVectorStore.init()` validates this at startup and throws with an educational error on mismatch.

## Run the example

```bash
docker compose up -d
# wait ~5 seconds for Postgres to accept connections
export OPENAI_API_KEY=sk-...
export DATABASE_URL=postgres://langmem:langmem@localhost:5432/langmem
npx tsx examples/basic.ts
```

## Design principles

- **Interface-first.** Every component is an interface with a default implementation. Swap any piece.
- **Database-agnostic.** Postgres + pgvector is the reference backend, not the only option.
- **Framework-agnostic.** No LangGraph coupling. Works inside any TypeScript agent or plain script.
- **Zero env reads.** Every config value is injected at construction.
- **Extraction precedes embedding.** Raw conversation text retrieves poorly; extracted facts retrieve well.

## Roadmap

`langmem-ts` ships with a minimal, stable core today: `extract → embed → store → retrieve`. The Python-only [LangMem](https://github.com/langchain-ai/langmem) covers more memory concepts and operations, and porting them to TypeScript is an explicit goal. Each row below is a tracked GitHub issue — contributions welcome.

### Memory types

| Concept | LangMem (Python) | langmem-ts | Contributor notes |
|---|---|---|---|
| **Semantic memory** (facts, preferences) | ✅ | ✅ | Core `extract → embed → store` pipeline. |
| **Episodic memory** (past interactions as examples) | ✅ | ❌ | New `EpisodicExtractor` interface. Captures `observation + thoughts + action + result` rather than flat facts. See [LangMem's episode schema](https://langchain-ai.github.io/langmem/guides/extract_episodic_memories/) as a reference. |
| **Procedural memory** (agent-authored system prompts) | ✅ | ❌ | New `PromptOptimizer` interface that takes trajectories + feedback and returns an updated system prompt. LangMem's signature feature. |

### Memory operations

| Operation | LangMem (Python) | langmem-ts | Contributor notes |
|---|---|---|---|
| **Extraction** | ✅ | ✅ | `LLMExtractor` distills turns into facts. |
| **Deduplication / upsert** | ✅ | ❌ | Before `store.write`, compare against top-k neighbors above a similarity threshold; update instead of duplicate. |
| **Conflict resolution** | ✅ | ❌ | When a new fact contradicts an existing one ("user lives in Berlin" vs. "user lives in Lisbon"), mark the older memory stale. Design question: hard delete vs. soft supersede. |
| **Thread summarization** | ✅ | ❌ | `summarize_messages` equivalent — compress long threads into short-term working memory. |
| **Background reflection** | ✅ | ❌ | A `ReflectionExecutor` equivalent that processes extraction + consolidation off the hot path. The architectural question: Node worker? BullMQ? Leave the scheduling to the consumer? |

### Scoping and retrieval

| Feature | LangMem (Python) | langmem-ts | Contributor notes |
|---|---|---|---|
| **Namespacing** (user/org/app) | ✅ | ❌ | Multi-tenancy primitive. Add a `namespace: string[]` field on `Memory` and a required filter on `Retriever.search`. Prevents cross-user memory bleed. |
| **Metadata filtering in search** | ✅ | Partial | `metadata` is stored but not yet a first-class filter on `retriever.search`. Extend the JSONB query. |
| **Time-aware retrieval** | Partial | ❌ | Boost recent memories via a recency decay factor in the scoring step. |

### Distribution

| Concern | LangMem (Python) | langmem-ts | Contributor notes |
|---|---|---|---|
| **Storage backends** | LangGraph BaseStore (primarily Postgres) | pgvector only | Alternative `Store` + `Retriever` implementations for SQLite/sqlite-vec, Pinecone, Qdrant, or pgvector-over-HTTP. The interface is already designed for this — these are self-contained PRs. |
| **LangGraph integration** | ✅ (native) | ❌ (by design) | Deliberately out of scope. Framework-agnostic is the positioning. |

### Good starting points for contributors

If you want to help and don't know where to start:

- **Small**: metadata filtering on `retriever.search` — extend one method, add tests, done.
- **Medium**: namespacing — touches `Memory` type, `Store.write`, `Retriever.search`. Isolated but cross-cutting.
- **Large**: a new backend (e.g., `SqliteVecStore` + `SqliteVecRetriever`) — full parallel implementation of the existing interfaces. High-signal PR that proves the abstractions work.

Open an issue before starting large work so we can align on interface shape.

## Contributing

Contributions are welcome — especially for [roadmap](#roadmap) items. Start with [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, PR expectations, and what's in vs. out of scope.

Quick summary:
- Small PRs (docs, tests, bug fixes): open directly.
- Interface changes or new backends: open an issue first.
- No env reads inside `src/`. No framework coupling.

## License

MIT — see [LICENSE](./LICENSE).
