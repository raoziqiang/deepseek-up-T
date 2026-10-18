import fs from 'node:fs';

const p = 'C:\\Users\\Z1848\\.gemini\\antigravity\\brain\\5297fee8-79b6-414c-9177-1f8cbee681d0\\.system_generated\\logs\\transcript.jsonl';
const lines = fs.readFileSync(p, 'utf8').trim().split('\n');
console.log('Total steps:', lines.length);

for (let i = 0; i < lines.length; i++) {
  const obj = JSON.parse(lines[i]);
  if (obj.type === 'USER_INPUT') {
    console.log(`\n--- Step ${i} USER_INPUT ---`);
    console.log(obj.content);
    if (obj.media) {
      console.log('Media:', obj.media);
    }
  }
}
