import fs from 'fs';
import path from 'path';

// 1. Count services in src/services
const servicesDir = path.resolve('src/services');
const serviceFiles = fs.readdirSync(servicesDir).filter(f => f.endsWith('.ts') || f.endsWith('.tsx'));
console.log(`=== SERVICES IN src/services (${serviceFiles.length} files) ===`);
serviceFiles.forEach((file, i) => console.log(`${i + 1}. ${file}`));

// 2. Count tools in server.ts
const serverPath = path.resolve('server.ts');
const serverContent = fs.readFileSync(serverPath, 'utf-8');

const startIdx = serverContent.indexOf('const functionDeclarations: any[] = [');
const endIdx = serverContent.indexOf('{ functionDeclarations }', startIdx);

if (startIdx !== -1 && endIdx !== -1) {
  const toolBlock = serverContent.substring(startIdx, endIdx);
  // Match each object with name: "..."
  const regex = /name:\s*["']([a-zA-Z0-9_]+)["']/g;
  const tools = [];
  let m;
  while ((m = regex.exec(toolBlock)) !== null) {
    if (!tools.includes(m[1])) {
      tools.push(m[1]);
    }
  }
  console.log(`\n=== GEMINI / SERVER TOOLS (${tools.length} tools) ===`);
  tools.forEach((t, i) => console.log(`${i + 1}. ${t}`));
} else {
  console.log('Could not find functionDeclarations block in server.ts');
}

// Compare declared tools and handled tools in server.ts
const callRegex = /call\.name\s*===?\s*["']([a-zA-Z0-9_]+)["']/g;
const handledTools = new Set();
let callMatch;
while ((callMatch = callRegex.exec(serverContent)) !== null) {
  handledTools.add(callMatch[1]);
}
console.log(`\n=== Handled tool names in server.ts: ${handledTools.size} ===`);

if (startIdx !== -1 && endIdx !== -1) {
  const toolBlock = serverContent.substring(startIdx, endIdx);
  const regex = /name:\s*["']([a-zA-Z0-9_]+)["']/g;
  const declaredTools = new Set();
  let m;
  while ((m = regex.exec(toolBlock)) !== null) {
    declaredTools.add(m[1]);
  }
  console.log(`Declared tool names in functionDeclarations: ${declaredTools.size}`);
  
  const notInDecl = [...handledTools].filter(x => !declaredTools.has(x));
  const notHandled = [...declaredTools].filter(x => !handledTools.has(x));
  console.log('Handled but not in decl:', notInDecl);
  console.log('Declared but not handled directly by call.name (might be in execute_service or fallback):', notHandled);
}

