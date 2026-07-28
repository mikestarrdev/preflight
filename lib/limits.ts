// Long-form advertorials (the dominant format for supplement/debt ad copy on
// Ad Library) run into five figures of characters, but the analyze route has
// a hard 120s maxDuration on Vercel. The 21k-character Rosabella case takes
// 184s locally against a cold cache — well past that ceiling. 8,000 keeps
// the deployed function reliably under the timeout; it is a deployment
// constraint, not a product one (see evals/REPORT.md section 9).
export const MAX_COPY_CHARS = 8_000;
