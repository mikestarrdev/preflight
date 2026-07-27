// Thin MCP wrapper over the existing analyze pipeline. No reimplementation:
// this file only adapts input/output shapes and reuses
// lib/agent/orchestrator.ts directly.
//
// MCP clients (e.g. Claude Desktop) launch this over stdio with their own
// working directory, but the pipeline reads several paths relative to
// process.cwd() (data/corpus-version.json, the .cache/ dir) — so cwd is
// pinned to the project root before anything else runs, regardless of where
// the client happened to launch it from.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(projectRoot);

import { config } from 'dotenv';
config({ path: resolve(projectRoot, '.env.local') });

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { Finding } from '../lib/types';

const SEVERITY_ORDER = ['violation', 'risk', 'clear'] as const;
const SEVERITY_MARK: Record<Finding['severity'], string> = {
  violation: '✗',
  risk: '~',
  clear: '✓',
};

function formatFinding(f: Finding): string {
  const lines = [
    `${SEVERITY_MARK[f.severity]} [${f.element}] ${f.policy_id} (confidence ${f.confidence.toFixed(2)})`,
    `  clause: "${f.clause_quote}"`,
    `  why: ${f.explanation}`,
  ];
  if (f.suggested_rewrite) {
    const label = f.rewrite_kind === 'guidance' ? 'guidance' : 'rewrite';
    lines.push(`  ${label}: ${f.suggested_rewrite}`);
  }
  lines.push(`  source: ${f.source_url}`);
  return lines.join('\n');
}

async function main() {
  // Imported after dotenv config and the chdir above, so every relative path
  // and env-dependent client the pipeline touches resolves correctly.
  const { analyze } = await import('../lib/agent/orchestrator');
  const { MEDIA_TYPE_BY_EXT } = await import('../lib/inputs/vision');

  const server = new McpServer({ name: 'preflight', version: '1.0.0' });

  server.registerTool(
    'check_ad',
    {
      title: 'Check ad against Meta ad policy',
      description:
        'Checks paid social ad copy, a creative image, and/or a landing page against ' +
        "Meta's (Facebook/Instagram) advertising policies. Returns findings cited to " +
        'the exact policy clause broken, with a suggested compliant rewrite for each ' +
        'violation. Provide at least one of copy, image_path, or url.',
      inputSchema: {
        copy: z.string().optional().describe('Ad copy text to check'),
        image_path: z
          .string()
          .optional()
          .describe('Absolute path to a creative image file (jpg, png, or webp)'),
        url: z.string().optional().describe("Landing page URL the ad's CTA links to"),
      },
    },
    async ({ copy, image_path, url }) => {
      if (!copy && !image_path && !url) {
        return {
          content: [{ type: 'text', text: 'Provide at least one of: copy, image_path, url.' }],
          isError: true,
        };
      }

      let image: { data: string; mediaType: (typeof MEDIA_TYPE_BY_EXT)[string] } | undefined;
      if (image_path) {
        const mediaType = MEDIA_TYPE_BY_EXT[extname(image_path).toLowerCase()];
        if (!mediaType) {
          return {
            content: [
              { type: 'text', text: `Unsupported image type: ${image_path} (jpg, png, webp only).` },
            ],
            isError: true,
          };
        }
        image = { data: readFileSync(image_path).toString('base64'), mediaType };
      }

      try {
        const result = await analyze({ copy, image, url });
        const header = `Analyzed ${result.elements_analyzed.join(', ') || 'nothing'} in ${result.duration_ms}ms (model ${result.model_version}, corpus ${result.corpus_version}).`;

        if (result.findings.length === 0) {
          return { content: [{ type: 'text', text: `${header}\n\nNo policy findings.` }] };
        }

        const sections = SEVERITY_ORDER.map((severity) => {
          const group = result.findings.filter((f) => f.severity === severity);
          if (group.length === 0) return null;
          return `${severity.toUpperCase()} (${group.length})\n\n${group.map(formatFinding).join('\n\n')}`;
        }).filter((s): s is string => s !== null);

        return { content: [{ type: 'text', text: `${header}\n\n${sections.join('\n\n')}` }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Analysis failed: ${message}` }], isError: true };
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
