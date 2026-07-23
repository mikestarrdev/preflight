import type { AnalyzeOutput } from '@/lib/agent/orchestrator';

// One line of evals/dataset/*.jsonl.
export type EvalCase = {
  id: string;
  input: { copy: string };
  expected: {
    should_flag: boolean;
    policy_ids: string[]; // clauses that should be cited; citing any one counts
    notes?: string;
  };
  source: string;
  tags: string[];
};

// One case after a run: the result, or the error that prevented one.
export type CaseRun = {
  eval_case: EvalCase;
  result: AnalyzeOutput | null;
  error?: string;
  duration_ms: number;
};
