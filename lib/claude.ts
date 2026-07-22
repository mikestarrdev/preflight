import Anthropic from '@anthropic-ai/sdk';

// Pinned snapshots, never evergreen pointers. Every model string in the
// codebase must come from here.
export const MODEL_REASONING = 'claude-sonnet-4-6';
export const MODEL_VISION = 'claude-sonnet-4-6';

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});
