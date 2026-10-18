const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 600,
    height: 700,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    }
  });

  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[RENDERER CONSOLE] (${level}) ${message} at ${sourceId}:${line}`);
  });

  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.log(`[FAIL LOAD] ${errorCode}: ${errorDescription} on ${validatedURL}`);
  });

  const replayPath = 'D:\\Program Files (x86)\\deepseekharness\\resources\\app.asar\\renderer\\replay.html';
  console.log('Loading replay from:', replayPath);
  await win.loadFile(replayPath);

  // Wait 1.5s then check canvas and image state
  setTimeout(async () => {
    try {
      const res = await win.webContents.executeJavaScript(`
        (() => {
          const img = window.__heroImg || null;
          const canvas = document.getElementById('whale-stage');
          return {
            hasCanvas: !!canvas,
            canvasW: canvas ? canvas.width : 0,
            canvasH: canvas ? canvas.height : 0,
            splashExists: typeof window.WhaleSplash === 'function',
            drawWhaleExists: typeof window.drawWhale === 'function',
          };
        })()
      `);
      console.log('Renderer state:', res);
    } catch (e) {
      console.log('Eval error:', e.message);
    }
    app.quit();
  }, 1500);
});
