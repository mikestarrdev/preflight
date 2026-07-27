import { getChunk } from '@/lib/rag/corpus-index';

// Document-scope guard. Some policy documents state, in their own text, that
// they cover only a limited set of ad categories. A finding that cites such a
// document is valid only if the ad actually falls within that stated scope;
// otherwise the adjudicator has reached for a clause outside the document's own
// domain — e.g. citing Health and Wellness against a productivity-coaching quiz
// when Health and Wellness says it covers weight-loss, cosmetic, and
// reproductive-health ads only.
//
// The check lives in code, not the adjudicator prompt: the scope is a fact
// already stated in the corpus, and enforcing it deterministically is more
// reliable than asking the model to police itself. Only documents whose corpus
// text states a *limiting* scope get an entry. A document that opens with a
// prohibition ("Ads must not promote weapons") applies to every ad and stays
// unscoped — absence from this table means "applies universally", not "unknown".

type DocumentScope = {
  // The clause whose text states the limited coverage, quoted above `terms`.
  scope_clause_id: string;
  // Phrases that must still appear in that clause. A tripwire: if the corpus is
  // re-scraped and the scope statement moves or is reworded, the assertion
  // fails loudly instead of leaving a stale term list silently in force.
  anchors: string[];
  // An ad is in scope if any of these appears in its copy or its classification
  // (vertical + restricted categories). Derived from the category names the
  // scope clause enumerates, matched after normalizing case and _/- to spaces.
  terms: string[];
};

const SCOPES: Record<string, DocumentScope> = {
  // meta:health-wellness:0.1 — "This policy covers two categories of ads:
  // Weight Loss and Cosmetic Products and Procedures, and Adult Products and
  // Reproductive Health."
  'health-wellness': {
    scope_clause_id: 'meta:health-wellness:0.1',
    anchors: ['weight loss', 'reproductive health'],
    terms: [
      // Weight Loss and Cosmetic Products and Procedures
      'weight loss',
      'lose weight',
      'fat loss',
      'cosmetic',
      'skincare',
      'skin care',
      // Adult Products and Reproductive Health
      'reproductive',
      'sexual',
      'contracept',
      'fertility',
      'menstrua',
      'libido',
      'erectile',
      'adult product',
    ],
  },
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ');
}

let checked = false;
function assertScopesMatchCorpus(): void {
  if (checked) return;
  for (const [slug, scope] of Object.entries(SCOPES)) {
    const chunk = getChunk(scope.scope_clause_id);
    if (!chunk) {
      throw new Error(
        `scope: ${slug} declares ${scope.scope_clause_id} as its scope clause, but that chunk is not in the corpus`,
      );
    }
    const text = normalize(chunk.content);
    for (const anchor of scope.anchors) {
      if (!text.includes(normalize(anchor))) {
        throw new Error(
          `scope: ${scope.scope_clause_id} no longer contains "${anchor}" — re-derive ${slug}'s scope terms from the current clause text`,
        );
      }
    }
  }
  checked = true;
}

// Whether `docSlug`'s policy applies to an ad with these signals. Signals are
// the ad copy plus its classification (vertical + restricted categories); the
// classification matters because an ad's copy does not always name its own
// category verbatim (a weight-loss ad may only say "belly fat"). Unscoped
// documents apply to every ad.
export function inDocumentScope(docSlug: string, signals: string): boolean {
  const scope = SCOPES[docSlug];
  if (!scope) return true;
  assertScopesMatchCorpus();
  const hay = normalize(signals);
  return scope.terms.some((term) => hay.includes(normalize(term)));
}
