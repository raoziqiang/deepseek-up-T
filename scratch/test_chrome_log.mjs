import { spawn } from 'node:child_process';
import http from 'node:http';

// We can check with chrome if there are any console logs or CSP errors
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

console.log('Testing replay.html console in headless Chrome...');
const proc = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--remote-debugging-port=9223',
  'file:///D:/Z1848/harness-ds/deepseek-up-T/vendor/whale/materials/renderer/replay.html'
]);

setTimeout(async () => {
  try {
    const res = await fetch('http://127.0.0.1:9223/json');
    const list = await res.json();
    console.log('Chrome tabs:', list);
  } catch (e) {
    console.error('CDP connect error:', e.message);
  } finally {
    proc.kill();
  }
}, 2000);
