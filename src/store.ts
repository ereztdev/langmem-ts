import { Pool } from "pg";

import type {
  Memory,
  MemoryInput,
  MemoryMetadata,
  PgVectorStoreConfig,
  Store,
} from "./types.js";

const TABLE_NAME_REGEX = /^[a-z_][a-z0-9_]*$/i;

function formatEmbeddingDimensionMismatchMessage(
  tableName: string,
  actualDim: number,
  expectedDim: number,
): string {
  return `PgVectorStore: embedding dimension mismatch.
  Column "${tableName}.embedding" is declared vector(${actualDim})
  but expected vector(${expectedDim}).

Your choice of embedding model and dimensions is a commitment for the
life of the corpus. Vectors from different models or dimensions live
in different mathematical spaces — similarity scores between them are
mathematically meaningless and retrieval will silently return garbage.

If this is unintentional:
  - Restore the original \`dimensions\` in your Embedder config, OR
  - Update the column to match your current embedder output.

If this is intentional (migrating to a different model), run a full
re-embed migration:
  1. Stand up a new table or column with the new dimension
  2. Re-embed all existing memories with the new model
  3. Atomically swap the application to the new table/column`;
}

function validateTableName(tableName: string): void {
  if (!TABLE_NAME_REGEX.test(tableName)) {
    throw new Error(
      `PgVectorStore: invalid tableName "${tableName}". Must match /^[a-z_][a-z0-9_]*$/i.`,
    );
  }
}

function rowMetadataToMemoryMetadata(
  rowMeta: unknown,
  createdAtIso: string,
): MemoryMetadata {
  const base: MemoryMetadata = { createdAt: createdAtIso };
  if (typeof rowMeta !== "object" || rowMeta === null) {
    return base;
  }
  const record = rowMeta as Record<string, unknown>;
  if (Array.isArray(record.tags)) {
    const tags = record.tags.filter(
      (tag): tag is string => typeof tag === "string",
    );
    if (tags.length > 0) {
      base.tags = tags;
    }
  }
  if (typeof record.source === "string") {
    base.source = record.source;
  }
  return base;
}

export class PgVectorStore implements Store {
  private readonly pool: Pool;

  private readonly ownsPool: boolean;

  private readonly tableName: string;

  private expectedDimension: number | null = null;

  public constructor(config: PgVectorStoreConfig) {
    const connectionString =
      typeof config.connectionString === "string"
        ? config.connectionString
        : "";
    const hasConnectionString = connectionString.length > 0;
    const injectedPool = config.pool;

    if (!hasConnectionString && injectedPool === undefined) {
      throw new Error(
        "PgVectorStore: provide exactly one of connectionString or pool",
      );
    }
    if (hasConnectionString && injectedPool !== undefined) {
      throw new Error(
        "PgVectorStore: provide exactly one of connectionString or pool, not both",
      );
    }

    this.tableName = config.tableName ?? "memories";
    validateTableName(this.tableName);

    if (hasConnectionString) {
      this.pool = new Pool({ connectionString });
      this.ownsPool = true;
    } else if (injectedPool !== undefined) {
      this.pool = injectedPool;
      this.ownsPool = false;
    } else {
      throw new Error(
        "PgVectorStore: provide exactly one of connectionString or pool",
      );
    }
  }

  public async init(expectedDimensions: number): Promise<void> {
    const dimResult = await this.pool.query<{ dim: number | null }>(
      `
      SELECT a.atttypmod AS dim
      FROM pg_catalog.pg_attribute a
      INNER JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      INNER JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      INNER JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
      WHERE c.relname = $1
        AND n.nspname = pg_catalog.current_schema()
        AND a.attname = 'embedding'
        AND t.typname = 'vector'
        AND a.attnum > 0
        AND NOT a.attisdropped
      `,
      [this.tableName],
    );

    if (dimResult.rows.length === 0) {
      throw new Error(
        `PgVectorStore.init: no vector column "embedding" found on table "${this.tableName}" in the current schema`,
      );
    }

    const rawDim = dimResult.rows[0]?.dim;
    if (rawDim === null || rawDim === undefined || rawDim < 1) {
      throw new Error(
        `PgVectorStore.init: could not read a positive embedding dimension for "${this.tableName}.embedding" (atttypmod=${String(rawDim)})`,
      );
    }

    if (rawDim !== expectedDimensions) {
      throw new Error(
        formatEmbeddingDimensionMismatchMessage(
          this.tableName,
          rawDim,
          expectedDimensions,
        ),
      );
    }

    this.expectedDimension = expectedDimensions;
  }

  public async write(
    memory: MemoryInput & { vector: number[] },
  ): Promise<Memory> {
    if (this.expectedDimension === null) {
      throw new Error(
        "PgVectorStore.write: call init() first so embedding dimensions are validated",
      );
    }
    if (memory.vector.length !== this.expectedDimension) {
      throw new Error(
        `PgVectorStore.write: vector length ${memory.vector.length} does not match initialized dimension ${this.expectedDimension}`,
      );
    }

    const metadataForInsert: Record<string, unknown> = {};
    if (memory.metadata !== undefined) {
      if (memory.metadata.tags !== undefined) {
        metadataForInsert.tags = memory.metadata.tags;
      }
      if (memory.metadata.source !== undefined) {
        metadataForInsert.source = memory.metadata.source;
      }
    }

    const embeddingLiteral = JSON.stringify(memory.vector);
    const insertSql = `
      INSERT INTO ${this.tableName} (content, embedding, metadata)
      VALUES ($1, $2::vector, $3::jsonb)
      RETURNING id, content, metadata, created_at
    `;

    const insertResult = await this.pool.query<{
      id: string;
      content: string;
      metadata: unknown;
      created_at: Date;
    }>(insertSql, [memory.content, embeddingLiteral, metadataForInsert]);

    const row = insertResult.rows[0];
    if (row === undefined) {
      throw new Error("PgVectorStore.write: INSERT returned no row");
    }

    const createdAtIso = row.created_at.toISOString();

    return {
      id: row.id,
      content: row.content,
      vector: memory.vector,
      metadata: rowMetadataToMemoryMetadata(row.metadata, createdAtIso),
    };
  }

  public async close(): Promise<void> {
    if (this.ownsPool) {
      await this.pool.end();
    }
  }
}
