import type { Pool } from "pg";

export interface Memory {
  id: string;
  content: string;
  vector: number[];
  metadata: MemoryMetadata;
}

export interface MemoryMetadata {
  tags?: string[];
  source?: string;
  createdAt: string;
}

export interface MemoryInput {
  content: string;
  metadata?: Partial<MemoryMetadata>;
}

export interface ConversationTurn {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface SearchOptions {
  topK?: number;
  tags?: string[];
  threshold?: number;
}

export interface SearchResult {
  memory: Memory;
  score: number;
}

export interface Embedder {
  embed(text: string): Promise<number[]>;
}

export interface Store {
  write(memory: MemoryInput & { vector: number[] }): Promise<Memory>;
}

export interface Retriever {
  search(queryVector: number[], options?: SearchOptions): Promise<SearchResult[]>;
}

export interface Extractor {
  extract(turn: ConversationTurn): Promise<string[]>;
}

export interface OpenAIEmbedderConfig {
  apiKey: string;
  model?: string;
  dimensions?: number;
}

export interface PgVectorStoreConfig {
  connectionString?: string;
  pool?: Pool;
  tableName?: string;
}

export interface PgVectorRetrieverConfig {
  connectionString?: string;
  pool?: Pool;
  tableName?: string;
}

export interface LLMExtractorConfig {
  apiKey: string;
  model?: string;
}
