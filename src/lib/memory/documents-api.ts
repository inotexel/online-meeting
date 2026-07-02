import { invoke } from "@tauri-apps/api/core";

export interface ClientDocument {
  id: string;
  clientId: string;
  title: string;
  filename: string;
  chunkCount: number;
  uploadedAt?: string | null;
}

export interface DocChunkHit {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  text: string;
  score: number;
}

export async function ingestClientDocument(params: {
  clientId: string;
  clientName: string;
  filePath: string;
  openaiApiKey: string;
}): Promise<ClientDocument> {
  const result = await invoke<{
    id: string;
    client_id: string;
    title: string;
    filename: string;
    chunk_count: number;
    uploaded_at?: string | null;
  }>("knowledge_ingest_document", {
    input: {
      clientId: params.clientId,
      clientName: params.clientName,
      filePath: params.filePath,
      openaiApiKey: params.openaiApiKey,
    },
  });

  return {
    id: result.id,
    clientId: result.client_id,
    title: result.title,
    filename: result.filename,
    chunkCount: result.chunk_count,
    uploadedAt: result.uploaded_at,
  };
}

export async function listClientDocuments(
  clientId: string
): Promise<ClientDocument[]> {
  const rows = await invoke<
    Array<{
      id: string;
      client_id: string;
      title: string;
      filename: string;
      chunk_count: number;
      uploaded_at?: string | null;
    }>
  >("knowledge_list_documents", { clientId });

  return rows.map((row) => ({
    id: row.id,
    clientId: row.client_id,
    title: row.title,
    filename: row.filename,
    chunkCount: row.chunk_count,
    uploadedAt: row.uploaded_at,
  }));
}

export async function deleteClientDocument(
  documentId: string
): Promise<void> {
  await invoke("knowledge_delete_document", { documentId });
}

export async function searchClientDocuments(params: {
  clientId: string;
  query: string;
  openaiApiKey: string;
  limit?: number;
  minScore?: number;
}): Promise<DocChunkHit[]> {
  const rows = await invoke<
    Array<{
      chunk_id: string;
      document_id: string;
      document_title: string;
      text: string;
      score: number;
    }>
  >("knowledge_search_client_docs", {
    input: {
      clientId: params.clientId,
      query: params.query,
      openaiApiKey: params.openaiApiKey,
      limit: params.limit ?? 5,
      minScore: params.minScore,
    },
  });

  return rows.map((row) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    documentTitle: row.document_title,
    text: row.text,
    score: row.score,
  }));
}
