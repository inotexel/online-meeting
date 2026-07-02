import { useEffect, useState } from "react";
import { Button } from "@/components";
import {
  deleteClientDocument,
  ingestClientDocument,
  listClientDocuments,
  slugifyClientId,
  ClientDocument,
} from "@/lib/memory";
import { FileTextIcon, LoaderIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";

interface ClientDocumentsProps {
  clientName: string;
  openaiApiKey?: string;
  knowledgeConfigured: boolean;
  disabled?: boolean;
  embedded?: boolean;
}

export const ClientDocuments = ({
  clientName,
  openaiApiKey,
  knowledgeConfigured,
  disabled = false,
  embedded = false,
}: ClientDocumentsProps) => {
  const [documents, setDocuments] = useState<ClientDocument[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");

  const trimmedName = clientName.trim();
  const clientId = trimmedName ? slugifyClientId(trimmedName) : "";

  useEffect(() => {
    if (!knowledgeConfigured || !clientId) {
      setDocuments((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError("");

    void listClientDocuments(clientId)
      .then((rows) => {
        if (!cancelled) setDocuments(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, knowledgeConfigured]);

  const refreshDocuments = async () => {
    if (!clientId) return;
    setIsLoading(true);
    setError("");
    try {
      const rows = await listClientDocuments(clientId);
      setDocuments(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpload = async () => {
    if (!trimmedName) {
      setError("Enter a client name before uploading documents.");
      return;
    }
    if (!openaiApiKey?.trim()) {
      setError("OpenAI API key required for document indexing (Dev Space STT).");
      return;
    }

    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Documents",
          extensions: ["pdf", "txt", "md", "markdown"],
        },
      ],
    });

    if (!selected || typeof selected !== "string") return;

    setIsUploading(true);
    setError("");
    try {
      await ingestClientDocument({
        clientId,
        clientName: trimmedName,
        filePath: selected,
        openaiApiKey: openaiApiKey.trim(),
      });
      await refreshDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (documentId: string) => {
    setError("");
    try {
      await deleteClientDocument(documentId);
      await refreshDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!knowledgeConfigured) return null;

  const body = (
    <>
      {!trimmedName && (
        <p className="text-xs text-muted-foreground">
          Enter a client name to attach documents for live coach retrieval.
        </p>
      )}

      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md p-2">
          {error}
        </p>
      )}

      {isLoading && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <LoaderIcon className="w-3 h-3 animate-spin" />
          Loading documents…
        </p>
      )}

      {!isLoading && trimmedName && documents.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No documents yet. Upload PDF, TXT, or Markdown — chunks are stored in
          Neo4j for live coaching.
        </p>
      )}

      {documents.map((doc) => (
        <div
          key={doc.id}
          className="flex items-start justify-between gap-2 rounded-md border border-border/40 bg-background/60 p-2"
        >
          <div className="min-w-0">
            <p className="text-xs font-medium truncate">{doc.title}</p>
            <p className="text-[10px] text-muted-foreground truncate">
              {doc.filename} · {doc.chunkCount} chunks
            </p>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-6 w-6 shrink-0"
            disabled={disabled}
            onClick={() => void handleDelete(doc.id)}
          >
            <Trash2Icon className="w-3 h-3" />
          </Button>
        </div>
      ))}
    </>
  );

  if (embedded) {
    return (
      <div className="space-y-2">
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1"
            disabled={disabled || isUploading || !trimmedName}
            onClick={() => void handleUpload()}
          >
            {isUploading ? (
              <LoaderIcon className="w-3 h-3 animate-spin" />
            ) : (
              <UploadIcon className="w-3 h-3" />
            )}
            Upload cheat sheet
          </Button>
        </div>
        {body}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/40 gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <FileTextIcon className="w-3.5 h-3.5" />
          Client documents (Neo4j RAG)
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          disabled={disabled || isUploading || !trimmedName}
          onClick={() => void handleUpload()}
        >
          {isUploading ? (
            <LoaderIcon className="w-3 h-3 animate-spin" />
          ) : (
            <UploadIcon className="w-3 h-3" />
          )}
          Upload
        </Button>
      </div>

      <div className="p-3 space-y-2">{body}</div>
    </div>
  );
};
