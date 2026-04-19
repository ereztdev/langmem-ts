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
