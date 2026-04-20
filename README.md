<div align="center">

# langmem-ts

**TypeScript-native memory primitive for AI agents.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)

`extract → embed → store → retrieve` over any Postgres + pgvector backend.

</div>

---

## Status

**Early development.** Not yet published to npm. API surface is stable for the core primitive; expect additions, not breaking changes.

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

The `1536` dimension matches the default embedder (OpenAI `text-embedding-3-large` truncated via matryoshka). Changing the embedding model or dimensions after memories exist will corrupt retrieval — `PgVectorStore.init()` validates this at startup and throws with an educational error on mismatch.

## Design principles

- **Interface-first.** Every component is an interface with a default implementation. Swap any piece.
- **Database-agnostic.** Postgres + pgvector is the reference backend, not the only option.
- **Framework-agnostic.** No LangGraph coupling. Works inside any TypeScript agent or plain script.
- **Zero env reads.** Every config value is injected at construction.
- **Extraction precedes embedding.** Raw conversation text retrieves poorly; extracted facts retrieve well.

## License

MIT — see [LICENSE](./LICENSE).
