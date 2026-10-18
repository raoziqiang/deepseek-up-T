import fs from 'node:fs';

const p = 'C:\\Users\\Z1848\\.gemini\\antigravity\\brain\\5297fee8-79b6-414c-9177-1f8cbee681d0\\.system_generated\\logs\\transcript.jsonl';
const lines = fs.readFileSync(p, 'utf8').trim().split('\n');

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('frame-0_5')) {
    console.log(`Line ${i} matched:`);
    const obj = JSON.parse(lines[i]);
    console.log(obj.tool_calls || obj.content || obj.thinking?.slice(0, 300));
  }
}
