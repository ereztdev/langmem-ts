import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PgVectorStore } from "../src/store.js";

function createFakePool(handlers: {
  query?: ReturnType<typeof vi.fn>;
  end?: ReturnType<typeof vi.fn>;
}): Pool {
  const query = handlers.query ?? vi.fn();
  const end = handlers.end ?? vi.fn().mockResolvedValue(undefined);
  return { query, end } as unknown as Pool;
}

describe("PgVectorStore (unit)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when neither connectionString nor pool is provided", () => {
    expect(() => new PgVectorStore({})).toThrow(
      "PgVectorStore: provide exactly one of connectionString or pool",
    );
  });

  it("throws when both connectionString and pool are provided", () => {
    const pool = createFakePool({});
    expect(
      () =>
        new PgVectorStore({
          connectionString: "postgres://localhost/db",
          pool,
        }),
    ).toThrow(
      "PgVectorStore: provide exactly one of connectionString or pool, not both",
    );
  });

  it("throws on invalid tableName", () => {
    expect(
      () =>
        new PgVectorStore({
          pool: createFakePool({}),
          tableName: "drop table;",
        }),
    ).toThrow('PgVectorStore: invalid tableName "drop table;".');
  });

  it("init throws with dimension mismatch message when column dim differs", async () => {
    const mockQuery = vi.fn().mockResolvedValueOnce({ rows: [{ dim: 512 }] });
    const store = new PgVectorStore({
      pool: createFakePool({ query: mockQuery }),
      tableName: "memories",
    });
    await expect(store.init(1536)).rejects.toThrow(
      /Column "memories\.embedding" is declared vector\(512\)[\s\S]*but expected vector\(1536\)\./,
    );
    await store.close();
  });

  it("init succeeds when dims match", async () => {
    const mockQuery = vi.fn().mockResolvedValueOnce({ rows: [{ dim: 1536 }] });
    const store = new PgVectorStore({
      pool: createFakePool({ query: mockQuery }),
    });
    await store.init(1536);
    await store.close();
  });

  it("write inserts with parameterized SQL and returns hydrated Memory", async () => {
    const mockQuery = vi.fn();
    mockQuery.mockResolvedValueOnce({ rows: [{ dim: 2 }] });
    const createdAt = new Date("2026-04-18T12:00:00.000Z");
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          content: "hello",
          metadata: { tags: ["a"], source: "unit" },
          created_at: createdAt,
        },
      ],
    });

    const store = new PgVectorStore({
      pool: createFakePool({ query: mockQuery }),
      tableName: "memories",
    });
    await store.init(2);

    const memory = await store.write({
      content: "hello",
      vector: [0.1, 0.2],
      metadata: { tags: ["a"], source: "unit" },
    });

    expect(mockQuery).toHaveBeenLastCalledWith(
      expect.stringMatching(
        /INSERT INTO memories \(content, embedding, metadata\)\s+VALUES \(\$1, \$2::vector, \$3::jsonb\)/,
      ),
      ["hello", "[0.1,0.2]", { tags: ["a"], source: "unit" }],
    );

    expect(memory).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      content: "hello",
      vector: [0.1, 0.2],
      metadata: {
        tags: ["a"],
        source: "unit",
        createdAt: createdAt.toISOString(),
      },
    });

    await store.close();
  });

  it("close calls pool.end when the store owns the pool", async () => {
    const endSpy = vi
      .spyOn(Pool.prototype, "end")
      .mockResolvedValue(undefined);
    const store = new PgVectorStore({
      connectionString: "postgres://127.0.0.1:65433/langmem_ts_unused",
    });
    await store.close();
    expect(endSpy).toHaveBeenCalledTimes(1);
  });

  it("close does not call pool.end when the pool was injected", async () => {
    const endMock = vi.fn().mockResolvedValue(undefined);
    const store = new PgVectorStore({
      pool: createFakePool({ end: endMock }),
    });
    await store.close();
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

describe.skipIf(!process.env.DATABASE_URL)("PgVectorStore (live DB)", () => {
  it("init, dimension mismatch, write, and cleanup", async () => {
    const connectionString = process.env.DATABASE_URL as string;
    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
    const tableName = `memories_test_${suffix}`;

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
    try {
      await ddlPool.query(sql);

      const store = new PgVectorStore({
        connectionString,
        tableName,
      });

      await store.init(1536);

      await expect(store.init(3072)).rejects.toThrow(
        'Column "' + tableName + '.embedding" is declared vector(1536)',
      );

      const vector = Array.from({ length: 1536 }, () => 0);
      const written = await store.write({ content: "hello", vector });
      expect(written.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(written.content).toBe("hello");
      expect(written.vector.length).toBe(1536);
      expect(written.metadata.createdAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );

      await store.close();
    } finally {
      await ddlPool.query(`DROP TABLE IF EXISTS ${tableName}`);
      await ddlPool.end();
    }
  });
});
