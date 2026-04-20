// This example runs against the local source (../src/index.js) so it
// can be executed from a clone of the repo without building or linking.
// In your own project, install the package and import from "langmem-ts":
//
//   import { OpenAIEmbedder, PgVectorStore, ... } from "langmem-ts";

import { Pool } from "pg";

import {
  LLMExtractor,
  OpenAIEmbedder,
  PgVectorRetriever,
  PgVectorStore,
} from "../src/index.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!OPENAI_API_KEY || !DATABASE_URL) {
  throw new Error(
    "Missing OPENAI_API_KEY and/or DATABASE_URL.\n" +
      "Set OPENAI_API_KEY to your OpenAI API key.\n" +
      "For local Postgres + pgvector: docker compose up -d\n" +
      "Then: export DATABASE_URL=postgres://langmem:langmem@localhost:5432/langmem",
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForPostgres(connectionString: string): Promise<void> {
  const maxAttempts = 15;
  const delayMs = 2000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const pool = new Pool({ connectionString });
    try {
      await pool.query("SELECT 1");
      await pool.end();
      return;
    } catch (err) {
      lastError = err;
      try {
        await pool.end();
      } catch {
        // ignore shutdown errors during probe
      }
      if (attempt === maxAttempts) {
        const detail =
          lastError instanceof Error ? lastError.message : String(lastError);
        throw new Error(
          "Postgres did not accept connections within ~30s after 15 attempts (2s between each). " +
            "Is the database up? Start it with `docker compose up -d` and check logs with `docker compose logs`. " +
            `Last error: ${detail}`,
        );
      }
      await sleep(delayMs);
    }
  }
}

const DEMO_TURNS = [
  {
    role: "user" as const,
    content: "We chose cosine distance in pgvector for semantic memory search.",
  },
  {
    role: "user" as const,
    content: "Ship the memory layer before the agent UI so retrieval is stable early.",
  },
  {
    role: "user" as const,
    content: "Keep embeddings at 1536 dims to match the default OpenAI matryoshka setting.",
  },
];

async function main(): Promise<void> {
  await waitForPostgres(DATABASE_URL);

  const ddl = new Pool({ connectionString: DATABASE_URL });
  await ddl.query("DROP INDEX IF EXISTS memories_embedding_idx");
  await ddl.end();

  const extractor = new LLMExtractor({ apiKey: OPENAI_API_KEY });
  const embedder = new OpenAIEmbedder({ apiKey: OPENAI_API_KEY });
  const store = new PgVectorStore({ connectionString: DATABASE_URL });
  const retriever = new PgVectorRetriever({ connectionString: DATABASE_URL });

  await store.init(1536);
  try {
    for (const turn of DEMO_TURNS) {
      const facts = await extractor.extract(turn);
      for (const fact of facts) {
        const vector = await embedder.embed(fact);
        await store.write({
          content: fact,
          vector,
          metadata: { tags: ["demo"], source: "examples/basic" },
        });
      }
    }

    const queryVector = await embedder.embed("what similarity metric did we pick for vectors?");
    const results = await retriever.search(queryVector, { topK: 5 });
    for (const { memory, score } of results) {
      console.log(`[${score.toFixed(3)}] ${memory.content}`);
    }
  } finally {
    await store.close();
    await retriever.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
