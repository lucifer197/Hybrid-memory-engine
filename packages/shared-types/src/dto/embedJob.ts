export interface EmbedJob {
  tenant_id: string;
  workspace_id: string;
  memory_id: string;
  chunk_ids: string[];
  embedding_model: string;
  /** Forwarded to GraphJob after embeddings are inserted. */
  session_id?: string;
  user_id?: string;
  tags?: string[];
  trace_id?: string;
}
