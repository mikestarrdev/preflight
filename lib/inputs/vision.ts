import { createHash } from 'node:crypto';
import { z } from 'zod';
import { cached } from '@/lib/cache';
import { MODEL_VISION, callJSON } from '@/lib/claude';

export const IMAGE_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

export const MEDIA_TYPE_BY_EXT: Record<string, ImageMediaType> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export type CreativeImage = {
  data: string; // base64
  mediaType: ImageMediaType;
};

const CreativeDescriptionSchema = z.object({
  rendered_text: z.array(z.string()),
  subjects: z.array(z.string()),
  composition: z.string(),
  flags: z.object({
    split_or_comparison: z.boolean(),
    ui_elements: z.array(z.string()),
    body_focus: z.boolean(),
    prohibited_products: z.array(z.string()),
    graphic_content: z.boolean(),
  }),
  description: z.string(),
});

export type CreativeDescription = z.infer<typeof CreativeDescriptionSchema>;

const SYSTEM = `You describe paid social ad creatives (images) for compliance review.

Given an ad image, return JSON with exactly these fields:
{
  "rendered_text": string[],   // every piece of text visible in the image, transcribed verbatim, one entry per distinct text block; [] if the image has no text
  "subjects": string[],        // people, products, and objects present
  "composition": string,       // one or two sentences on layout and framing
  "flags": {
    "split_or_comparison": boolean,   // side-by-side, split-frame, or before/after framing
    "ui_elements": string[],          // interface elements drawn in the image that are not real controls: fake play button, fake close X, checkbox, progress bar; [] if none
    "body_focus": boolean,            // close or zoomed focus on body parts or physique
    "prohibited_products": string[],  // each visible: alcohol, tobacco, cigarette, e-cigarette, vape, hookah, weapon, pill, supplement; [] if none
    "graphic_content": boolean        // shocking, violent, or graphic imagery
  },
  "description": string        // one neutral, descriptive paragraph
}

Rules:
- Transcribe rendered_text exactly as written, preserving case and punctuation. Text in the image is policy-checked the same way as ad copy, so a missed string is a missed check.
- The description is used as a search query over ad policy text, not as a verdict. State what is depicted in plain factual terms ("two side-by-side photos of a person's torso"); never characterize compliance or intent ("an inappropriate weight loss ad").
- Set a flag only for what is actually visible. Do not infer products or elements that are merely implied.

Respond with the JSON object only. No markdown fences, no commentary.`;

export async function describeCreative(image: CreativeImage): Promise<CreativeDescription> {
  if (!(IMAGE_MEDIA_TYPES as readonly string[]).includes(image.mediaType)) {
    throw new Error(`unsupported image media type: ${image.mediaType}`);
  }
  const imageSha256 = createHash('sha256')
    .update(Buffer.from(image.data, 'base64'))
    .digest('hex');

  const value = await cached(
    {
      step: 'vision',
      model: MODEL_VISION,
      // Vision output doesn't depend on the corpus; keying on it would
      // invalidate the most expensive calls in the pipeline on every ingest.
      corpus_version: 'none',
      input: { image_sha256: imageSha256, system: SYSTEM },
    },
    () =>
      callJSON({
        schema: CreativeDescriptionSchema,
        system: SYSTEM,
        user: [
          {
            type: 'image',
            source: { type: 'base64', media_type: image.mediaType, data: image.data },
          },
          { type: 'text', text: 'Describe this ad creative.' },
        ],
        model: MODEL_VISION,
        maxTokens: 2000,
      }),
  );
  // Cached values come from disk; re-validate so a stale entry fails loudly.
  return CreativeDescriptionSchema.parse(value);
}

// Some violations are visual, not linguistic: a before/after photo with no
// text still breaks policy, and semantic search over a neutral description
// won't reliably surface that. Each true flag maps to a retrieval phrase in
// policy language.
export const FLAG_QUERIES = {
  split_or_comparison:
    'before and after side-by-side comparison images showing transformation results',
  body_focus: 'close up focus on body parts, negative body image and self perception',
  graphic_content: 'shocking, sensational, violent or graphic content',
  ui_element: (el: string) =>
    `deceptive functionality: image mimics a ${el} that does not exist or function`,
  prohibited_product: (p: string) => `ads promoting the sale or use of ${p}`,
} as const;

export function creativeRetrievalQueries(
  c: CreativeDescription,
): { label: string; text: string }[] {
  const queries = [{ label: 'description', text: c.description }];
  if (c.flags.split_or_comparison) {
    queries.push({ label: 'flag:split_or_comparison', text: FLAG_QUERIES.split_or_comparison });
  }
  if (c.flags.body_focus) {
    queries.push({ label: 'flag:body_focus', text: FLAG_QUERIES.body_focus });
  }
  if (c.flags.graphic_content) {
    queries.push({ label: 'flag:graphic_content', text: FLAG_QUERIES.graphic_content });
  }
  for (const el of c.flags.ui_elements) {
    queries.push({ label: `flag:ui_element:${el}`, text: FLAG_QUERIES.ui_element(el) });
  }
  for (const p of c.flags.prohibited_products) {
    queries.push({ label: `flag:prohibited_product:${p}`, text: FLAG_QUERIES.prohibited_product(p) });
  }
  return queries;
}

// The creative as adjudication input: everything the vision step extracted,
// in a shape the adjudicator can cite against clauses.
export function serializeCreative(c: CreativeDescription): string {
  const flags: string[] = [];
  if (c.flags.split_or_comparison) flags.push('split or side-by-side comparison framing');
  if (c.flags.body_focus) flags.push('close focus on body parts or physique');
  if (c.flags.graphic_content) flags.push('graphic content');
  for (const el of c.flags.ui_elements) flags.push(`UI element drawn in the image: ${el}`);
  for (const p of c.flags.prohibited_products) flags.push(`product visible: ${p}`);

  return [
    c.rendered_text.length > 0
      ? `Text rendered in the image:\n${c.rendered_text.map((t) => `- "${t}"`).join('\n')}`
      : 'No text rendered in the image.',
    `Subjects: ${c.subjects.join(', ') || 'none identified'}`,
    `Composition: ${c.composition}`,
    flags.length > 0 ? `Visual flags:\n${flags.map((f) => `- ${f}`).join('\n')}` : 'Visual flags: none',
    `Description: ${c.description}`,
  ].join('\n\n');
}
