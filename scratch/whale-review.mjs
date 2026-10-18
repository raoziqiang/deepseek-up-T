import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { pathToFileURL } from 'node:url'

const [page, output, mode = 'frames', width = '1280', height = '800'] = process.argv.slice(2)
await fs.mkdir(output, { recursive: true })
const profile = path.resolve('state', `whale-review-browser-${Date.now()}-${Math.random().toString(16).slice(2)}`)
await fs.mkdir(profile, { recursive: true })
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--enable-unsafe-swiftshader', '--force-device-scale-factor=1', 'about:blank',
], { stdio: 'ignore', windowsHide: true })
let ws
try {
  let port
  for (let i = 0; i < 120; i++) {
    try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break } catch {}
    await new Promise(r => setTimeout(r, 100))
  }
  if (!port) throw Error('Chrome did not expose its review endpoint')
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl)
  await once(ws, 'open')
  let id = 0
  const pending = new Map(), errors = []
  ws.addEventListener('message', e => {
    const message = JSON.parse(e.data)
    if (message.id) {
      const task = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) task?.reject(Error(JSON.stringify(message.error)))
      else task?.resolve(message.result)
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  await send('Page.enable'); await send('Runtime.enable')
  if (mode === 'surfaces') await send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'window.__closeCalls=0;window.close=()=>{window.__closeCalls++}'
  })
  await send('Emulation.setDeviceMetricsOverride', { width: +width, height: +height, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: page.startsWith('http') ? page : pathToFileURL(path.resolve(page)).href })
  await new Promise(r => setTimeout(r, 1200))
  for(let attempt=0;attempt<40;attempt++){
    if(await evaluate(mode==='surfaces'?'Boolean(window.WhaleSplash?.rendererInfo().imageReady)':'Boolean(window.whalePreview && window.WhaleSplash?.rendererInfo().imageReady)'))break;
    if(attempt===39)throw Error('Review page did not become ready: '+JSON.stringify(errors));
    await new Promise(r=>setTimeout(r,100));
  }
  const seek = ms => evaluate(`(() => {
    if (window.whalePreview) return window.whalePreview.seek(${ms});
    const s = window.__splash(); s.stop(); s.render(${ms}/6800, s.startedAt + ${ms}); return {phase:s.phase};
  })()`)
  const screenshot = async () => Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')
  if (mode === 'surfaces') {
    const beginning=await evaluate('({renderer:WhaleSplash.rendererInfo(),closeCalls:window.__closeCalls})')
    await new Promise(r=>setTimeout(r,6500))
    const ended=await evaluate('({closeCalls:window.__closeCalls,opacity:getComputedStyle(document.getElementById("whale-stage")).opacity})')
    const pendant=pathToFileURL(path.resolve('state/staged/tree/renderer/pendant.html')).href
    await send('Page.navigate',{url:pendant})
    await send('Emulation.setDeviceMetricsOverride',{width:128,height:128,deviceScaleFactor:1,mobile:false})
    await new Promise(r=>setTimeout(r,500))
    await fs.writeFile(path.join(output,'native-pendant.png'),await screenshot())
    const pendantState=await evaluate('({renderer:WhaleSplash.rendererInfo(),width:document.getElementById("charm-canvas").width})')
    console.log(JSON.stringify({beginning,ended,pendantState}))
    if(beginning.renderer.mode!=='webgl2-reference-mesh'||ended.closeCalls!==1||+ended.opacity!==0||pendantState.renderer.mode!=='webgl2-reference-mesh')throw Error('Shipped renderer acceptance failed')
    await fs.writeFile(path.join(output,'surfaces.json'),JSON.stringify({beginning,ended,pendantState},null,2))
  } else if (mode === 'motion') {
    const receipt=await evaluate(`(() => {
      whalePreview.seek(3200);
      const canvas=document.createElement('canvas');canvas.width=600;canvas.height=360;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      const samples=[],changes=[];let previous=null;
      for(let i=0;i<24;i++){
        ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,600,360);
        ctx.save();ctx.translate(300,180);drawWhale(ctx,560,304,true,false,i/24*WhaleSplash.rendererInfo().strokePeriod);ctx.restore();
        const pixels=ctx.getImageData(0,0,600,360).data;
        let top=360,bottom=0,edge=0,changed=0,finChanged=0;
        for(let y=0;y<360;y++)for(let x=0;x<600;x++){
          const k=(y*600+x)*4;
          if(pixels[k+3]>40){top=Math.min(top,y);bottom=Math.max(bottom,y);if(y<=29||y>=331)edge++;}
          if(previous&&Math.abs(pixels[k+3]-previous[k+3])>24){changed++;if(x>210&&x<390&&y>180)finChanged++;}
        }
        samples.push({top,bottom,edge});if(previous)changes.push({changed,finChanged});previous=pixels;
      }
      const board=document.createElement('canvas');board.width=1280;board.height=800;
      const b=board.getContext('2d');b.fillStyle='#080e1a';b.fillRect(0,0,1280,800);
      for(let i=0;i<4;i++){
        const seconds=i/4*WhaleSplash.rendererInfo().strokePeriod,x=(i%2)*640+320,y=Math.floor(i/2)*400+200;
        b.save();b.translate(x,y);drawWhale(b,590,320,true,false,seconds);b.restore();
        b.fillStyle='#9fb6cc';b.font='16px sans-serif';b.fillText('泳姿 '+(i+1)+' · '+seconds.toFixed(2)+' s',x-270,y+165);
      }
      document.body.replaceChildren(board);board.style.cssText='position:fixed;inset:0;width:100%;height:100%';
      return {samples,changes,minimumChangedPixels:Math.min(...changes.map(c=>c.changed)),minimumFinChangedPixels:Math.min(...changes.map(c=>c.finChanged))};
    })()`)
    await fs.writeFile(path.join(output,'motion-proof.json'),JSON.stringify(receipt,null,2));
    await fs.writeFile(path.join(output,'swim-cycle.png'),await screenshot());
    if(receipt.minimumChangedPixels<500||receipt.minimumFinChangedPixels<100)throw Error('Whale motion is not visible independent of travel');
    if(receipt.samples.some(s=>s.edge>0))throw Error('Swimming silhouette hits the render edge');
    console.log(JSON.stringify({minimumChangedPixels:receipt.minimumChangedPixels,minimumFinChangedPixels:receipt.minimumFinChangedPixels}));
  } else if (mode === 'video') {
    const ffmpeg = spawn('ffmpeg', ['-y','-hide_banner','-loglevel','error','-f','image2pipe','-framerate','30','-i','pipe:0','-c:v','libx264','-pix_fmt','yuv420p','-crf','19','-movflags','+faststart',path.join(output,'replay.mp4')], { windowsHide:true, stdio:['pipe','ignore','inherit'] })
    for (let frame = 0; frame < 240; frame++) {
      await seek(frame / 30 * 1000)
      if (!ffmpeg.stdin.write(await screenshot())) await once(ffmpeg.stdin,'drain')
      if (frame % 60 === 0) console.log(`video ${frame}/240`)
    }
    ffmpeg.stdin.end(); await once(ffmpeg,'exit')
  } else {
    for (const ms of [650,1400,2400,3200,4000,4700,5500,6800,7600]) {
      await seek(ms)
      await fs.writeFile(path.join(output, `frame-${ms}.png`), await screenshot())
    }
    if (mode === 'review') {
      const receipt = await evaluate(`(async () => {
        const api = window.whalePreview;
        const reduced = document.getElementById('reduce-motion');
        reduced.checked = true; reduced.dispatchEvent(new Event('change'));
        await new Promise(r=>setTimeout(r,150));
        const reducedState = api.inspect();
        reduced.checked = false; reduced.dispatchEvent(new Event('change'));
        document.getElementById('replay').click();
        await new Promise(r=>setTimeout(r,900));
        const replayState = api.inspect();
        const frames=[]; let previous=performance.now();
        for(let n=0;n<90;n++) { const now=await new Promise(requestAnimationFrame); frames.push(now-previous); previous=now; }
        frames.sort((a,b)=>a-b);
        api.seek(7600);
        return { reducedState, replayState, finalState:api.inspect(), frameMedianMs:frames[45], frameP95Ms:frames[85] };
      })()`)
      await fs.writeFile(path.join(output,'interactions.json'),JSON.stringify(receipt,null,2))
      if(receipt.reducedState.playing||receipt.reducedState.petOpacity!==1||receipt.finalState.sceneOpacity!==0||receipt.finalState.petOpacity!==1)throw Error('Handoff/reduced-motion acceptance failed')
      const controls=await evaluate(`(async()=>{
        const api=window.whalePreview;
        const range=document.getElementById('timeline');
        range.value='3200';range.dispatchEvent(new Event('input'));
        const scrub=api.inspect();
        document.getElementById('pause').click();
        await new Promise(r=>setTimeout(r,120));
        document.getElementById('pause').click();
        const paused=api.inspect();
        await new Promise(r=>setTimeout(r,120));
        const still=api.inspect();
        api.seek(7300);
        const p=document.getElementById('pet');p.focus();
        const before=p.getBoundingClientRect().left;
        p.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
        return {scrub: scrub.elapsed,paused:!paused.playing,pauseStable:paused.elapsed===still.elapsed,
          keyboardMoved:p.getBoundingClientRect().left===before-10,contacts:window.__splash().contacts};
      })()`)
      if(controls.scrub!==3200||!controls.paused||!controls.pauseStable||!controls.keyboardMoved)throw Error('Preview controls acceptance failed')
      console.log(JSON.stringify(controls))
      await fs.writeFile(path.join(output,'controls.json'),JSON.stringify(controls,null,2))
      console.log(JSON.stringify(receipt))
    }
  }
  await fs.writeFile(path.join(output,'browser-errors.json'), JSON.stringify(errors,null,2))
  console.log(`review complete: ${errors.length} browser exceptions; ${width}x${height}`)
} finally { ws?.close(); chrome.kill() }

