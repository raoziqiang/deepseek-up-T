import fs from 'node:fs';
import path from 'node:path';

function searchDir(dir) {
  for (const item of fs.readdirSync(dir)) {
    if (item === 'node_modules' || item === '.git' || item === 'state' || item === 'dist') continue;
    const p = path.join(dir, item);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      searchDir(p);
    } else if (p.endsWith('.js') || p.endsWith('.mjs') || p.endsWith('.cjs')) {
      const content = fs.readFileSync(p, 'utf8');
      if (content.includes('snout') || content.includes('snout') || content.includes('whalePath') || content.includes('drawWhale')) {
        console.log(`Found whale code in: ${p}`);
      }
    }
  }
}

searchDir('.');
