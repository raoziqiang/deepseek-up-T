import fs from 'node:fs';

const p = 'C:\\Users\\Z1848\\.gemini\\antigravity\\brain\\5297fee8-79b6-414c-9177-1f8cbee681d0\\.system_generated\\logs\\transcript.jsonl';
const lines = fs.readFileSync(p, 'utf8').trim().split('\n');

for (let i = 1490; i < 1525; i++) {
  if (i >= lines.length) break;
  const obj = JSON.parse(lines[i]);
  if (obj.type === 'USER_INPUT' || obj.type === 'PLANNER_RESPONSE') {
    console.log(`\n=== Step ${i} [${obj.type}] ===`);
    const text = obj.content ? (typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content)) : (obj.thinking ? obj.thinking.slice(0, 200) : '(empty)');
    console.log(text.slice(0, 400));
  }
}
