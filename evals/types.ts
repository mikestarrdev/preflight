import type { AnalyzeOutput } from '@/lib/agent/orchestrator';

export type Split = 'dev' | 'holdout';

// One line of evals/dataset/*.jsonl. image_path is repo-relative; the runner
// loads and base64-encodes the fixture. split is assigned once by
// evals/split.ts and frozen: the runner loads dev unless --holdout is passed.
export type EvalCase = {
  id: string;
  input: { copy?: string; image_path?: string; url?: string };
  expected: {
    should_flag: boolean;
    policy_ids: string[]; // clauses that should be cited; citing any one counts
    notes?: string;
  };
  source: string;
  tags: string[];
  split?: Split; // assigned by evals/split.ts; the runner asserts it is present
  // Provenance for cases lifted from a live source (e.g. Meta's Ad Library),
  // set together and omitted otherwise. meta_status records the platform's own
  // enforcement state (e.g. still running) separately from expected.should_flag,
  // which always follows the written policy, not enforcement — a violating ad
  // can still be running (unenforced or whitelisted) without changing its label.
  source_url?: string;
  collected_date?: string; // ISO date the ad was retrieved from the source
  meta_status?: string;
};

// A case paired with the tier it came from (the dataset filename stem). Tiers
// are scored and reported separately and never merged into one headline number.
export type LoadedCase = { evalCase: EvalCase; tier: string };

// One case after a run: the result, or the error that prevented one.
export type CaseRun = {
  eval_case: EvalCase;
  tier: string;
  result: AnalyzeOutput | null;
  error?: string;
  duration_ms: number;
};
