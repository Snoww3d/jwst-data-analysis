/**
 * Types for semantic search API responses.
 */

export interface SemanticSearchResult {
  id: string;
  fileName: string;
  score: number;
  matchedText: string;
  targetName: string | null;
  instrument: string | null;
  filter: string | null;
  processingLevel: string | null;
  wavelengthRange: string | null;
  exposureTime: number | null;
  thumbnailData: string | null; // base64 PNG
}

export interface SemanticSearchResponse {
  results: SemanticSearchResult[];
  query: string;
  embedTimeMs: number;
  searchTimeMs: number;
  totalIndexed: number;
  resultCount: number;
}

export interface IndexStatusResponse {
  totalIndexed: number;
  modelLoaded: boolean;
  indexFileExists: boolean;
  modelName: string;
  embeddingDim: number;
}

export interface ReindexResponse {
  jobId: string;
  message: string;
}
