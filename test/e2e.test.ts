import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import {
  OpenAIEmbedder,
  PgVectorStore,
  PgVectorRetriever,
  LLMExtractor,
} from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function adaptMigrationForScratchTable(baseSql: string, tableName: string): string {
  const indexName = `${tableName}_embedding_idx`;
  let result = baseSql.replaceAll("memories_embedding_idx", indexName);
  result = result.replaceAll(
    "CREATE TABLE IF NOT EXISTS memories (",
    `CREATE TABLE IF NOT EXISTS ${tableName} (`,
  );
  result = result.replaceAll(
    "ON memories USING ivfflat",
    `ON ${tableName} USING ivfflat`,
  );
  return result;
}

const hasKeys = Boolean(process.env.OPENAI_API_KEY) && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasKeys)("langmem-ts end-to-end", () => {
  it("extract → embed → store → retrieve full pipeline", async () => {
    const connectionString = process.env.DATABASE_URL as string;
    const apiKey = process.env.OPENAI_API_KEY as string;
    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
    const tableName = `memories_e2e_${suffix}`;

    const migrationPath = join(__dirname, "..", "database", "migrations", "001_init.sql");
    const baseSql = readFileSync(migrationPath, "utf8");
    const sql = adaptMigrationForScratchTable(baseSql, tableName);

    const ddlPool = new Pool({ connectionString });

    try {
      await ddlPool.query(sql);
      // IVFFlat is approximate; with very few rows Postgres may use the index
      // and return no hits. Drop it so ORDER BY <=> is an exact scan on this tiny table.
      await ddlPool.query(`DROP INDEX IF EXISTS ${tableName}_embedding_idx`);

      // Compose all four components
      const extractor = new LLMExtractor({ apiKey });
      const embedder = new OpenAIEmbedder({ apiKey });
      const store = new PgVectorStore({ connectionString, tableName });
      const retriever = new PgVectorRetriever({ connectionString, tableName });

      await store.init(1536);

      try {
        // STEP 1: Extract facts from a conversation turn
        const turn = {
          role: "user" as const,
          content:
            "I decided to use pgvector for my memory system because it lets me keep everything in Postgres instead of adding a separate vector DB",
        };
        const facts = await extractor.extract(turn);
        expect(facts.length).toBeGreaterThan(0);

        // STEP 2: Embed and store each fact
        for (const fact of facts) {
          const vector = await embedder.embed(fact);
          expect(vector.length).toBe(1536);
          await store.write({
            content: fact,
            vector,
            metadata: { tags: ["tech", "decision"], source: "e2e-test" },
          });
        }

        // STEP 3: Retrieve by semantic query
        const queryVector = await embedder.embed("what did I decide about vector databases");
        const results = await retriever.search(queryVector, { topK: 5 });

        // Assertions
        expect(results.length).toBeGreaterThan(0);
        expect(results.length).toBeLessThanOrEqual(facts.length);

        // The top result should have high similarity — same embedding space, semantically related
        const topScore = results[0]?.score;
        expect(topScore).toBeDefined();
        expect(topScore as number).toBeGreaterThan(0.4);

        // Results are ordered by similarity descending
        for (let i = 0; i < results.length - 1; i++) {
          const a = results[i]?.score;
          const b = results[i + 1]?.score;
          if (a === undefined || b === undefined) throw new Error("missing score");
          expect(a + 1e-9).toBeGreaterThanOrEqual(b);
        }

        // Retrieved content should reference the stored fact (mentions pgvector or postgres or vector)
        const joined = results.map((r) => r.memory.content).join(" ").toLowerCase();
        expect(
          joined.includes("pgvector") ||
            joined.includes("postgres") ||
            joined.includes("vector"),
        ).toBe(true);

        // STEP 4: Tag-filtered retrieval
        const tagFiltered = await retriever.search(queryVector, {
          tags: ["decision"],
          topK: 5,
        });
        expect(tagFiltered.length).toBe(results.length);

        const noMatch = await retriever.search(queryVector, {
          tags: ["nonexistent-tag"],
          topK: 5,
        });
        expect(noMatch.length).toBe(0);
      } finally {
        await store.close();
        await retriever.close();
      }
    } finally {
      await ddlPool.query(`DROP TABLE IF EXISTS ${tableName}`);
      await ddlPool.end();
    }
  });
});
