export type Severity = 'violation' | 'risk' | 'clear';
export type Element = 'copy' | 'image' | 'landing_page';

// 'replacement' is drop-in ad copy; 'guidance' describes what to change, for
// elements where generated text can't be the fix (images, landing pages).
export type RewriteKind = 'replacement' | 'guidance';

// A policy example (a ✅/❌ line from Meta's own page) that illustrates the
// cited rule. When adjudication matches the ad to an example chunk, the finding
// cites the governing rule and carries the example here as supporting context.
export type SupportingExample = {
  policy_id: string;        // id of the example chunk
  content_type: 'example_compliant' | 'example_violating';
  quote: string;            // VERBATIM text of the example
  source_url: string;
};

export type Finding = {
  element: Element;
  severity: Severity;
  policy_id: string;        // stable id of the clause chunk
  clause_quote: string;     // VERBATIM text from the corpus — never paraphrased
  source_url: string;       // deep link to the policy page
  explanation: string;      // why this ad element violates this clause
  confidence: number;       // 0-1
  suggested_rewrite?: string;
  rewrite_kind?: RewriteKind;
  offending_span?: string;  // VERBATIM substring of the analyzed element the verdict rests on, verified in code
  supporting_example?: SupportingExample;
};

export type AnalysisResult = {
  id: string;
  findings: Finding[];
  elements_analyzed: Element[];
  model_version: string;
  corpus_version: string;   // hash/date of the ingested corpus
  duration_ms: number;
};

export type ContentType =
  | 'rule'
  | 'example_compliant'
  | 'example_violating'
  | 'definition';

// A policy clause as stored in the policy_chunks table, minus the embedding.
export type PolicyChunk = {
  id: string;               // {platform}:{doc_slug}:{clause_path}
  platform: string;
  doc_slug: string;
  doc_title: string;
  clause_path: string;
  heading_trail: string[];  // ancestor headings, outermost first
  content: string;          // verbatim clause text
  content_type: ContentType;
  source_url: string;
  fetched_at: string;       // ISO timestamp
};

export type ScoredChunk = PolicyChunk & {
  vector_score: number | null;  // cosine similarity, null if not found by vector search
  text_score: number | null;    // ts_rank, null if not found by full-text search
  fused_score: number;          // reciprocal rank fusion score
  found_by: ('vector' | 'text')[];
};
