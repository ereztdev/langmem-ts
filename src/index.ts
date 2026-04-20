// Interfaces — consumers implementing custom adapters need these
export type {
  Embedder,
  Store,
  Retriever,
  Extractor,
} from "./types.js";

// Core domain types — consumers interact with these
export type {
  Memory,
  MemoryMetadata,
  MemoryInput,
  ConversationTurn,
  SearchOptions,
  SearchResult,
} from "./types.js";

// Config types for default implementations
export type {
  OpenAIEmbedderConfig,
  PgVectorStoreConfig,
  PgVectorRetrieverConfig,
  LLMExtractorConfig,
  ExtractorExample,
} from "./types.js";

// Default implementations
export { OpenAIEmbedder } from "./embedder.js";
export { PgVectorStore } from "./store.js";
export { PgVectorRetriever } from "./retriever.js";
export { LLMExtractor } from "./extractor.js";
