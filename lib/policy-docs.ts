// Display-only doc_slug -> title lookup for the frontend. Findings carry
// policy_id (`{platform}:{doc_slug}:{clause_path}`) but not the document
// title, so this mirrors the doc_title already stored on every corpus chunk
// (see data/parsed/*.json, not committed — scripts/scrape-policies.ts
// rebuilds it) without adding a field to the core Finding type or querying
// the DB again at render time.
const DOC_TITLES: Record<string, string> = {
  'account-integrity': 'Account Integrity',
  'adult-nudity': 'Adult Nudity and Sexual Activity',
  'adult-solicitation': 'Adult Sexual Solicitation and Sexually Explicit Language',
  alcohol: 'Alcohol',
  cryptocurrency: 'Cryptocurrency Products and Services',
  'cs-fraud-scams': 'Fraud, Scams, and Deceptive Practices',
  'cs-spam': 'Spam',
  'deceptive-practices': 'Fraud, Scams and Deceptive Practices',
  'discriminatory-practices': 'Discriminatory Practices',
  'drugs-pharmaceuticals': 'Drugs and Pharmaceuticals',
  'financial-services': 'Financial and Insurance Products and Services',
  'health-wellness': 'Health and Wellness',
  'inauthentic-behavior': 'Inauthentic Behavior',
  'personal-attributes': 'Privacy Violations and Personal Attributes',
  tobacco: 'Tobacco and Related Product',
  'unacceptable-business-practices': 'Unacceptable Business Practices',
  weapons: 'Weapons, Ammunition or Explosives',
};

function humanize(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// policy_id is "{platform}:{doc_slug}:{clause_path}" — the middle segment.
export function docTitleFromPolicyId(policyId: string): string {
  const slug = policyId.split(':')[1] ?? policyId;
  return DOC_TITLES[slug] ?? humanize(slug);
}
