const fs = require('fs');
const path = require('path');

const declPath = path.resolve(__dirname, '../src/live/liveToolDeclarations.ts');
const content = fs.readFileSync(declPath, 'utf8');

const regex = /name:\s*["']([^"']+)["']/g;
let match;
const names = [];
const counts = {};

while ((match = regex.exec(content)) !== null) {
  const name = match[1];
  names.push(name);
  counts[name] = (counts[name] || 0) + 1;
}

console.log('Total tools count:', names.length);
const duplicates = Object.entries(counts).filter(([_, count]) => count > 1);
console.log('Duplicates found:', duplicates);
