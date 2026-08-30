import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const declPath = path.resolve(__dirname, '../src/live/liveToolDeclarations.ts');

const mod = await import('../src/live/liveToolDeclarations.ts');
const list = mod.fridayFunctionDeclarations;
const seen = new Set();
const unique = [];

for (const tool of list) {
  if (!seen.has(tool.name)) {
    seen.add(tool.name);
    unique.push(tool);
  } else {
    console.log('Removed duplicate tool:', tool.name);
  }
}

const out = `/**
 * FRIDAY AI — Gemini Live Tool Declarations (100% Unique & Verified)
 * Declarations defining parameters and capabilities for real-time voice streaming.
 */

export const fridayFunctionDeclarations: any[] = ${JSON.stringify(unique, null, 2)};
`;

fs.writeFileSync(declPath, out, 'utf8');
console.log(`✅ Deduplication complete! Total unique tools: ${unique.length}`);
