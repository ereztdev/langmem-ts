import { Pool } from "pg";

import type {
  MemoryMetadata,
  PgVectorRetrieverConfig,
  Retriever,
  SearchOptions,
  SearchResult,
} from "./types.js";

const TABLE_NAME_REGEX = /^[a-z_][a-z0-9_]*$/i;

const DEFAULT_TOP_K = 10;

function validateTableName(tableName: string): void {
  if (!TABLE_NAME_REGEX.test(tableName)) {
    throw new Error(
      `PgVectorRetriever: invalid tableName "${tableName}". Must match /^[a-z_][a-z0-9_]*$/i.`,
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

export class PgVectorRetriever implements Retriever {
  private readonly pool: Pool;

  private readonly ownsPool: boolean;

  private readonly tableName: string;

  public constructor(config: PgVectorRetrieverConfig) {
    const connectionString =
      typeof config.connectionString === "string"
        ? config.connectionString
        : "";
    const hasConnectionString = connectionString.length > 0;
    const injectedPool = config.pool;

    if (!hasConnectionString && injectedPool === undefined) {
      throw new Error(
        "PgVectorRetriever: provide exactly one of connectionString or pool",
      );
    }
    if (hasConnectionString && injectedPool !== undefined) {
      throw new Error(
        "PgVectorRetriever: provide exactly one of connectionString or pool, not both",
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
        "PgVectorRetriever: provide exactly one of connectionString or pool",
      );
    }
  }

  public async search(
    queryVector: number[],
    options?: SearchOptions,
  ): Promise<SearchResult[]> {
    if (queryVector.length === 0) {
      throw new Error(
        "PgVectorRetriever.search: queryVector must be non-empty",
      );
    }

    const topK = options?.topK ?? DEFAULT_TOP_K;
    const tags = options?.tags;
    const hasTags = tags !== undefined && tags.length > 0;
    const threshold = options?.threshold;
    const hasThreshold = threshold !== undefined;

    const vectorLiteral = JSON.stringify(queryVector);

    const whereClauses: string[] = [];
    const params: unknown[] = [vectorLiteral];

    if (hasTags) {
      params.push(tags);
      whereClauses.push(`metadata->'tags' ?& $${params.length}::text[]`);
    }
    if (hasThreshold) {
      params.push(threshold);
      whereClauses.push(
        `1 - (embedding <=> $1::vector) >= $${params.length}::float8`,
      );
    }

    params.push(topK);
    const limitParamIndex = params.length;

    const whereSql =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const sql = `
SELECT
  id,
  content,
  metadata,
  created_at,
  1 - (embedding <=> $1::vector) AS similarity
FROM ${this.tableName}
${whereSql}
ORDER BY embedding <=> $1::vector ASC
LIMIT $${limitParamIndex}
`;

    const result = await this.pool.query<{
      id: string;
      content: string;
      metadata: unknown;
      created_at: Date;
      similarity: string | number;
    }>(sql, params);

    return result.rows.map((row): SearchResult => {
      const createdAtIso = row.created_at.toISOString();
      const rawScore = row.similarity;
      const score =
        typeof rawScore === "string" ? Number.parseFloat(rawScore) : rawScore;
      return {
        memory: {
          id: row.id,
          content: row.content,
          // Embeddings are not loaded for each hit; use [] and re-fetch by id if needed.
          vector: [],
          metadata: rowMetadataToMemoryMetadata(row.metadata, createdAtIso),
        },
        score,
      };
    });
  }

  public async close(): Promise<void> {
    if (this.ownsPool) {
      await this.pool.end();
    }
  }
}
