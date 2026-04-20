# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-04-20

### Added

- Initial release
- `Embedder` interface with `OpenAIEmbedder` default
- `Store` interface with `PgVectorStore` default
- `Retriever` interface with `PgVectorRetriever` default
- `Extractor` interface with `LLMExtractor` default
- Reference Postgres + pgvector migration
- Dimension validation at `PgVectorStore.init()`
