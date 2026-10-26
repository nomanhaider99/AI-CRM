-- Custom migration: pgvector must exist before client_embeddings.embedding vector(1536).
CREATE EXTENSION IF NOT EXISTS vector;
