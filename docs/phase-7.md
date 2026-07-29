Redesign Preflight's visual identity. Next.js 15 + Tailwind, app/page.tsx, app/globals.css, and app/components/{FindingCard,FindingGroup,HelpModal,StepProgress}.tsx.

WHAT THIS IS: a pre-flight compliance checker for Meta ads. A media buyer pastes ad copy, uploads a creative, or points at a landing page, and gets back policy findings cited to the exact clause plus a compliant rewrite. Audience is performance marketers who lose money when ads get rejected. The page's job is to make a verdict legible in five seconds.

CURRENT STATE: functional but visually default. Neutral grays, system font stack, no identity. It reads as a prototype.

DESIGN BRIEF:

Work in two passes. First produce a compact design plan: 4-6 named hex values, typefaces for display and body and one utility/mono role, a layout concept, and one signature element the page is remembered by. Review that plan against the brief and revise anything that reads as a generic default before writing code. Show me the plan before you build.

Ground it in the subject. The name is Preflight and the existing OG image already reaches for a boarding-pass motif. Aviation preflight checklists, instrument panels, and gate signage are the natural well: they are about disciplined verification before committing to something expensive and irreversible, which is exactly what this tool does. Use that vernacular if it earns its place. Do not use it decoratively.

Avoid these, they are current AI-design defaults and read as tells: warm cream background with high-contrast serif and terracotta accent; near-black with a single acid-green accent; broadsheet layout with hairline rules and zero border radius.

CONSTRAINTS THAT ARE NOT NEGOTIABLE:

1. Severity colors stay semantically red / amber / emerald. Violation, risk, clear. A marketer must read severity without learning a new legend. You can shift the exact hues to fit the palette, but not the mapping.

2. This is a compliance tool. Credibility is the point. Restraint reads as competence here. Spend boldness on one signature element and keep everything else disciplined.

3. Do not change any result logic, grouping, severity computation, or the three-state summary just built (all-clear emerald, risks-only amber, violations red). Restyle those states, do not rewrite their behavior or wording.

4. Do not touch lib/, app/api/, or evals/.

ALSO BUILD: a theme toggle.
- Three states: system, light, dark. Default to system.
- Persist the choice in localStorage, read it before first paint to avoid a flash of wrong theme.
- Place it unobtrusively, header corner is fine.
- Every color must work in both themes. The existing dark: variants are a starting point, not a finished dark theme.

QUALITY FLOOR, build to it without announcing it:
- Responsive to mobile, 375px minimum
- Visible keyboard focus on every interactive element
- prefers-reduced-motion respected
- The three severity colors meet WCAG AA contrast against their backgrounds in both themes

VERIFY: tsc --noEmit and eslint clean. Then screenshot the app in both themes across all three result states and critique your own work before telling me it is done.
