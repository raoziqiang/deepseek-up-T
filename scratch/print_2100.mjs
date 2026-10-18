import fs from 'node:fs';

const p = 'C:\\Users\\Z1848\\.gemini\\antigravity\\brain\\5297fee8-79b6-414c-9177-1f8cbee681d0\\.system_generated\\logs\\transcript.jsonl';
const lines = fs.readFileSync(p, 'utf8').trim().split('\n');

for (let i = 2100; i <= 2110; i++) {
  console.log(`=== Line ${i} ===`);
  const obj = JSON.parse(lines[i]);
  console.log('type:', obj.type);
  if (obj.tool_calls) console.log('tool_calls:', JSON.stringify(obj.tool_calls, null, 2));
  if (obj.content) console.log('content:', obj.content);
}
