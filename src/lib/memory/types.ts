export interface MemoryTextItem {
  id: string;
  text: string;
  status?: string;
}

export interface MemoryExtraction {
  new_facts: MemoryTextItem[];
  new_objections: MemoryTextItem[];
  new_questions: MemoryTextItem[];
  new_action_items: MemoryTextItem[];
  updated_objections: MemoryTextItem[];
}

export interface ClientGraphContext {
  clientId: string;
  clientName: string;
  facts: string[];
  openObjections: string[];
  openQuestions: string[];
  openActions: string[];
  meetingCount: number;
}

export interface CoachSuggestion {
  type:
    | "question"
    | "objection"
    | "reminder"
    | "answer"
    | "expect"
    | "cite_doc"
    | "gap";
  text: string;
  reason: string;
  sourceDocument?: string | null;
  /** True when this tip was grounded in Neo4j doc vector search */
  fromDocSearch?: boolean;
  /** The document chunk text used as evidence */
  sourceExcerpt?: string | null;
  docSearchScore?: number | null;
}

export interface RetrievedDocChunk {
  documentTitle: string;
  text: string;
  score: number;
}

export interface CoachResponse {
  stepIn?: boolean;
  suggestions: CoachSuggestion[];
  error?: string;
}

export const EMPTY_MEMORY_EXTRACTION: MemoryExtraction = {
  new_facts: [],
  new_objections: [],
  new_questions: [],
  new_action_items: [],
  updated_objections: [],
};
