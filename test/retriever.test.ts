import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PgVectorRetriever } from "../src/retriever.js";

function createFakePool(handlers: {
  query?: ReturnType<typeof vi.fn>;
  end?: ReturnType<typeof vi.fn>;
}): Pool {
  const query = handlers.query ?? vi.fn();
  const end = handlers.end ?? vi.fn().mockResolvedValue(undefined);
  return { query, end } as unknown as Pool;
}

function unitVector(dim: number, index: number): number[] {
  const v = Array.from({ length: dim }, () => 0);
  v[index] = 1;
  return v;
}

describe("PgVectorRetriever (unit)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when neither connectionString nor pool is provided", () => {
    expect(() => new PgVectorRetriever({})).toThrow(
      "PgVectorRetriever: provide exactly one of connectionString or pool",
    );
  });

  it("throws when both connectionString and pool are provided", () => {
    const pool = createFakePool({});
    expect(
      () =>
        new PgVectorRetriever({
          connectionString: "postgres://localhost/db",
          pool,
        }),
    ).toThrow(
      "PgVectorRetriever: provide exactly one of connectionString or pool, not both",
    );
  });

  it("throws on invalid tableName", () => {
    expect(
      () =>
        new PgVectorRetriever({
          pool: createFakePool({}),
          tableName: "drop table;",
        }),
    ).toThrow('PgVectorRetriever: invalid tableName "drop table;".');
  });

  it("search throws on empty queryVector", async () => {
    const retriever = new PgVectorRetriever({
      pool: createFakePool({}),
    });
    await expect(retriever.search([])).rejects.toThrow(
      "PgVectorRetriever.search: queryVector must be non-empty",
    );
    await retriever.close();
  });

  it("search builds query with no filters", async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
    const retriever = new PgVectorRetriever({
      pool: createFakePool({ query: mockQuery }),
      tableName: "memories",
    });
    const q = [0.1, 0.2];
    await retriever.search(q, { topK: 5 });

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toMatch(/\bWHERE\b/i);
    expect(params).toEqual([JSON.stringify(q), 5]);

    await retriever.close();
  });

  it("search builds query with tags filter", async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
    const retriever = new PgVectorRetriever({
      pool: createFakePool({ query: mockQuery }),
    });
    const q = [1, 0];
    await retriever.search(q, { tags: ["pets", "loud"], topK: 3 });

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("metadata->'tags' ?& $2::text[]");
    expect(params).toEqual([JSON.stringify(q), ["pets", "loud"], 3]);

    await retriever.close();
  });

  it("search builds query with threshold filter", async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
    const retriever = new PgVectorRetriever({
      pool: createFakePool({ query: mockQuery }),
    });
    const q = [1, 0, 0];
    await retriever.search(q, { threshold: 0.5, topK: 7 });

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("1 - (embedding <=> $1::vector) >= $2::float8");
    expect(params).toEqual([JSON.stringify(q), 0.5, 7]);

    await retriever.close();
  });

  it("search builds query with tags and threshold", async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
    const retriever = new PgVectorRetriever({
      pool: createFakePool({ query: mockQuery }),
    });
    const q = [0.5, 0.5];
    await retriever.search(q, {
      tags: ["a", "b"],
      threshold: 0.25,
      topK: 99,
    });

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("metadata->'tags' ?& $2::text[]");
    expect(sql).toContain("1 - (embedding <=> $1::vector) >= $3::float8");
    expect(params).toEqual([JSON.stringify(q), ["a", "b"], 0.25, 99]);

    await retriever.close();
  });

  it("search maps rows to SearchResult with score as similarity and vector []", async () => {
    const createdAt = new Date("2026-04-18T12:00:00.000Z");
    const mockQuery = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "id-1",
          content: "hello",
          metadata: { tags: ["t"], source: "s" },
          created_at: createdAt,
          similarity: 0.75,
        },
      ],
    });
    const retriever = new PgVectorRetriever({
      pool: createFakePool({ query: mockQuery }),
    });
    const queryVector = [1, 2, 3];
    const results = await retriever.search(queryVector);

    expect(results).toEqual([
      {
        memory: {
          id: "id-1",
          content: "hello",
          vector: [],
          metadata: {
            tags: ["t"],
            source: "s",
            createdAt: createdAt.toISOString(),
          },
        },
        score: 0.75,
      },
    ]);

    await retriever.close();
  });

  it("search defaults topK to 10 when options omitted", async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
    const retriever = new PgVectorRetriever({
      pool: createFakePool({ query: mockQuery }),
    });
    await retriever.search([1]);

    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([JSON.stringify([1]), 10]);

    await retriever.close();
  });

  it("close calls pool.end when the retriever owns the pool", async () => {
    const endSpy = vi
      .spyOn(Pool.prototype, "end")
      .mockResolvedValue(undefined);
    const retriever = new PgVectorRetriever({
      connectionString: "postgres://127.0.0.1:65433/langmem_ts_unused",
    });
    await retriever.close();
    expect(endSpy).toHaveBeenCalledTimes(1);
  });

  it("close does not call pool.end when the pool was injected", async () => {
    const endMock = vi.fn().mockResolvedValue(undefined);
    const retriever = new PgVectorRetriever({
      pool: createFakePool({ end: endMock }),
    });
    await retriever.close();
    expect(endMock).not.toHaveBeenCalled();
  });
});

const __dirname = dirname(fileURLToPath(import.meta.url));

function adaptMigrationForScratchTable(
  baseSql: string,
  tableName: string,
): string {
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

describe.skipIf(!process.env.DATABASE_URL)("PgVectorRetriever (live DB)", () => {
  it("vector similarity, tags, threshold, and cleanup", async () => {
    const connectionString = process.env.DATABASE_URL as string;
    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
    const tableName = `memories_test_${suffix}`;
    const dim = 1536;

    const migrationPath = join(
      __dirname,
      "..",
      "database",
      "migrations",
      "001_init.sql",
    );
    const baseSql = readFileSync(migrationPath, "utf8");
    const sql = adaptMigrationForScratchTable(baseSql, tableName);

    const ddlPool = new Pool({ connectionString });
    const vecA = unitVector(dim, 0);
    const vecB = unitVector(dim, 1);
    const vecC = unitVector(dim, 2);
    const queryVec = unitVector(dim, 0);

    try {
      await ddlPool.query(sql);

      await ddlPool.query(
        `INSERT INTO ${tableName} (content, embedding, metadata) VALUES ($1, $2::vector, $3::jsonb)`,
        [
          "cats are great",
          JSON.stringify(vecA),
          { tags: ["pets", "animals"] },
        ],
      );
      await ddlPool.query(
        `INSERT INTO ${tableName} (content, embedding, metadata) VALUES ($1, $2::vector, $3::jsonb)`,
        [
          "dogs bark loud",
          JSON.stringify(vecB),
          { tags: ["pets", "loud"] },
        ],
      );
      await ddlPool.query(
        `INSERT INTO ${tableName} (content, embedding, metadata) VALUES ($1, $2::vector, $3::jsonb)`,
        [
          "paris is a city",
          JSON.stringify(vecC),
          { tags: ["places"] },
        ],
      );

      const retriever = new PgVectorRetriever({
        connectionString,
        tableName,
      });

      try {
        const byVector = await retriever.search(queryVec);
        expect(byVector[0]?.memory.content).toBe("cats are great");
        const scores = byVector.map((r) => r.score);
        for (let i = 0; i < scores.length - 1; i += 1) {
          const a = scores[i];
          const b = scores[i + 1];
          if (a === undefined || b === undefined) {
            throw new Error("missing score");
          }
          expect(a + 1e-9).toBeGreaterThanOrEqual(b);
        }
        for (const r of byVector) {
          expect(r.score).toBeGreaterThanOrEqual(-1);
          expect(r.score).toBeLessThanOrEqual(1);
        }

        const petsOnly = await retriever.search(queryVec, {
          tags: ["pets"],
        });
        const petsContents = petsOnly
          .map((r) => r.memory.content)
          .sort();
        expect(petsContents).toEqual(["cats are great", "dogs bark loud"]);

        const petsLoud = await retriever.search(queryVec, {
          tags: ["pets", "loud"],
        });
        expect(petsLoud.map((r) => r.memory.content)).toEqual([
          "dogs bark loud",
        ]);

        const highSim = await retriever.search(queryVec, {
          threshold: 0.5,
        });
        expect(highSim.map((r) => r.memory.content)).toEqual([
          "cats are great",
        ]);
      } finally {
        await retriever.close();
      }
    } finally {
      await ddlPool.query(`DROP TABLE IF EXISTS ${tableName}`);
      await ddlPool.end();
    }
  });
});
