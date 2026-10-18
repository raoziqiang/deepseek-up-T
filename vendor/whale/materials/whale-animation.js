/** User-supplied constellation whale, gently articulated without replacing its design. */
const PIXEL = 6
export const __WHALE_PIXEL__ = PIXEL
export const WHALE_SPLASH_DURATION_MS = 6200
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const lerp = (a, b, t) => a + (b - a) * t
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t) }
function random(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
}
// The user's original transparent image is the visual authority. A subdivided
// textured surface supplies gentle depth and articulation without replacing it.
const SWIM_RATE = 2.65
// CPU attachment points and the shader share the same stroke and deformation.
function deformWhalePoint(u,v,seconds){
  const phase=seconds*SWIM_RATE,aspect=880/478;
  let x=(u-.5)*2,y=(.5-v)*2;
  const fin=smooth(.52,.72,v)*(1-smooth(.56,.65,u))*smooth(.32,.43,u);
  const angle=Math.sin(phase-.8)*.38*fin,ca=Math.cos(angle),sa=Math.sin(angle);
  const qx=x+.16,qy=(y+.16)/aspect;
  x=-.16+qx*ca-qy*sa;y=-.16+(qx*sa+qy*ca)*aspect;
  const tail=smooth(.35,.95,u),wave=Math.sin(phase-u*4.6);
  y+=wave*(.025+.30*tail*tail);
  x+=Math.cos(phase-u*4.6)*.018*tail;
  // The raised fluke turns around its own root as the stroke reaches the tail.
  const fluke=smooth(.70,.91,u),a=Math.sin(phase-3.7)*.22*fluke;
  const tx=x-.43,ty=(y-.22)/aspect;
  x=.43+Math.cos(a)*tx-Math.sin(a)*ty;
  y=.22+(Math.sin(a)*tx+Math.cos(a)*ty)*aspect;
  return {x,y};
}
const VERTEX = '#version 300 es\n' + `
precision highp float;
in vec2 aUV;
uniform float uTime;
uniform float uYaw;
out vec2 vUV;
void main(){
  vUV=aUV;
  float phase=uTime*${SWIM_RATE.toFixed(2)},aspect=880./478.;
  vec2 p=vec2((aUV.x-.5)*2.,(.5-aUV.y)*2.);
  float fin=smoothstep(.52,.72,aUV.y)*(1.-smoothstep(.56,.65,aUV.x))*smoothstep(.32,.43,aUV.x);
  float angle=sin(phase-.8)*.38*fin;
  vec2 q=vec2(p.x+.16,(p.y+.16)/aspect);
  p=vec2(-.16+q.x*cos(angle)-q.y*sin(angle),-.16+(q.x*sin(angle)+q.y*cos(angle))*aspect);
  float tail=smoothstep(.35,.95,aUV.x),wave=sin(phase-aUV.x*4.6);
  p.y+=wave*(.025+.30*tail*tail);
  p.x+=cos(phase-aUV.x*4.6)*.018*tail;
  float fluke=smoothstep(.70,.91,aUV.x),a=sin(phase-3.7)*.22*fluke;
  vec2 tq=vec2(p.x-.43,(p.y-.22)/aspect);
  p=vec2(.43+cos(a)*tq.x-sin(a)*tq.y,.22+(sin(a)*tq.x+cos(a)*tq.y)*aspect);
  float depth=sin(aUV.x*3.14159)*sin(aUV.y*3.14159)*.10;
  gl_Position=vec4(p*.88,depth*.1,1.);
}`

const FRAGMENT = '#version 300 es\n' + `
precision highp float;
uniform sampler2D uImage;
uniform float uTime;
in vec2 vUV;
out vec4 color;
void main(){
  vec4 tex=texture(uImage,vUV);
  // Preserve the original line drawing and alpha. Light only breathes softly.
  float breath=.98+.035*sin(uTime*.85+vUV.x*3.);
  color=vec4(tex.rgb*breath,tex.a);
}`
class WhaleModel {
  constructor(){
    this.canvas=document.createElement('canvas');this.canvas.width=1056;this.canvas.height=574;
    const gl=this.canvas.getContext('webgl2',{alpha:true,antialias:true,premultipliedAlpha:false,preserveDrawingBuffer:true});
    if(!gl)throw Error('WebGL2 unavailable');this.gl=gl;
    const compile=(type,source)=>{
      const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));return shader;
    };
    const program=gl.createProgram(),vs=compile(gl.VERTEX_SHADER,VERTEX),fs=compile(gl.FRAGMENT_SHADER,FRAGMENT);
    gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
    gl.deleteShader(vs);gl.deleteShader(fs);this.program=program;gl.useProgram(program);
    const vertices=[],indices=[],nx=100,ny=54;
    for(let y=0;y<=ny;y++)for(let x=0;x<=nx;x++)vertices.push(x/nx,y/ny);
    for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
      const a=y*(nx+1)+x,b=a+nx+1;indices.push(a,b,a+1,b,b+1,a+1);
    }
    this.count=indices.length;this.vao=gl.createVertexArray();gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);
    const loc=gl.getAttribLocation(program,'aUV');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,8,0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,gl.createBuffer());gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.STATIC_DRAW);
    this.time=gl.getUniformLocation(program,'uTime');this.yaw=gl.getUniformLocation(program,'uYaw');
    this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(program,'uImage'),0);gl.clearColor(0,0,0,0);
  }
  render(time=0,yaw=-.12){
    const gl=this.gl;if(gl.isContextLost()||!fallback?.complete||!fallback.naturalWidth)return null;
    gl.useProgram(this.program);gl.bindVertexArray(this.vao);gl.bindTexture(gl.TEXTURE_2D,this.texture);
    if(!this.uploaded){gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,fallback);this.uploaded=true;}
    gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(this.time,time);gl.uniform1f(this.yaw,yaw);gl.drawElements(gl.TRIANGLES,this.count,gl.UNSIGNED_SHORT,0);
    return this.canvas;
  }
}

let model=null,modelAttempted=false,modelError=null
function getModel(){
  if(!modelAttempted){
    modelAttempted=true
    try{model=new WhaleModel()}catch(error){modelError=error.message;console.warn('Whale 3D fallback:',error.message)}
  }
  return model
}
let fallback=null
const WHALE_IMAGE_DATA = '' // Populated by the classic-script bundler for file:// WebGL safety.
if(typeof Image!=='undefined'){
  const script=typeof document!=='undefined'?document.currentScript?.src||document.baseURI:''
  fallback=new Image();fallback.onload=()=>window.dispatchEvent(new Event('whaleassetready'));
  fallback.src=WHALE_IMAGE_DATA || new URL('whale-3d.png',script).href
}
export function whalePath(ctx,w,h){
  ctx.beginPath();ctx.ellipse(0,0,w*.42,h*.35,0,0,Math.PI*2)
}
export function drawWhale(ctx,w,h,detail=true,light=false,time=0,yaw=-.12){
  const frame=getModel()?.render(time,yaw)
  if(frame){
    ctx.save();ctx.globalCompositeOperation='screen';ctx.globalAlpha*=.30;
    ctx.filter='blur('+Math.max(2,w*.028)+'px)';
    ctx.drawImage(frame,-w/2,-w/(880/478)/2,w,w/(880/478));ctx.restore();
    ctx.save();ctx.shadowColor='rgba(101,225,255,.66)';ctx.shadowBlur=w*.026;
    ctx.drawImage(frame,-w/2,-w/(880/478)/2,w,w/(880/478));ctx.restore();return
  }
  if(fallback?.complete&&fallback.naturalWidth){
    const ih=w*fallback.naturalHeight/fallback.naturalWidth;ctx.drawImage(fallback,-w/2,-ih/2,w,ih);return
  }
  if(fallback)return; // Never substitute another silhouette while the supplied image loads.
  ctx.save();ctx.fillStyle='#71b7ca';whalePath(ctx,w,h);ctx.fill();ctx.restore()
}
export class WhaleSplash {
  constructor(canvas,options={}){
    this.canvas=canvas;this.ctx=canvas.getContext('2d')
    if(!this.ctx)throw Error('Whale splash canvas unavailable')
    this.durationMs=options.durationMs??WHALE_SPLASH_DURATION_MS;this.onPendant=options.onPendant??(()=>{})
    this.reduced=options.reducedMotion??matchMedia('(prefers-reduced-motion: reduce)').matches
    this.phase='idle';this.raf=0;this.startedAt=0;this.hiddenAt=null;this.pendant={x:0,y:0,placed:false}
    this._tick=now=>this.frame(now)
    this._resize=()=>{this.resize();if(this.phase!=='running')this.render(this.progress??0)}
    this._visibility=()=>{
      if(document.hidden){this.hiddenAt=performance.now();cancelAnimationFrame(this.raf);this.raf=0}
      else if(this.phase==='running'){if(this.hiddenAt!==null)this.startedAt+=performance.now()-this.hiddenAt;this.hiddenAt=null;this.raf=requestAnimationFrame(this._tick)}
    }
    const rng=random(options.seed??92731)
    this.stars=Array.from({length:580},()=>({x:rng(),y:rng(),r:.25+rng()*.95,z:.2+rng()*.8,phase:rng()*6.283}))
    this.prismaticDust=Array.from({length:260},()=>({offset:rng(),life:1.3+rng()*1.5,angle:rng()*Math.PI*2,
      spin:(rng()-.5)*2,spread:.25+rng()*.9,speed:rng(),size:rng(),color:rng()<.09?3:Math.floor(rng()*3)}))
    this.resize();getModel()
  }
  resize(){
    const box=this.canvas.getBoundingClientRect();this.width=Math.max(1,box.width);this.height=Math.max(1,box.height)
    this.dpr=Math.min(window.devicePixelRatio||1,1.75)
    this.canvas.width=Math.round(this.width*this.dpr);this.canvas.height=Math.round(this.height*this.dpr)
    this.surfaceY=this.height*.67;this.whale={len:Math.min(this.width*.58,this.height*.82,630)}
    this.whale.height=this.whale.len/1.864;this.scroll={x:0,y:0,w:this.width,h:this.height}
    if(!this.pendant.placed)this.pendant={x:this.width-92,y:90,placed:false}
    this.background=this.makeBackground()
    this.whaleLayer=document.createElement('canvas')
    this.whaleLayer.width=this.canvas.width;this.whaleLayer.height=this.canvas.height
    this.whaleContext=this.whaleLayer.getContext('2d')
  }
  makeBackground(){
    const bg=document.createElement('canvas');bg.width=Math.ceil(this.width);bg.height=Math.ceil(this.height)
    const c=bg.getContext('2d'),w=this.width,h=this.height
    c.fillStyle='#040811';c.fillRect(0,0,w,h)
    const fog=(x,y,r,color)=>{
      const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,color);g.addColorStop(1,'rgba(5,10,20,0)')
      c.fillStyle=g;c.fillRect(0,0,w,h)
    }
    fog(w*.58,h*.40,w*.7,'rgba(28,54,93,.50)')
    fog(w*.22,h*.65,w*.4,'rgba(25,91,112,.25)')
    fog(w*.83,h*.14,w*.40,'rgba(70,53,109,.20)')
    const rng=random(3197)
    for(let i=0;i<2100;i++){
      const x=rng()*w,n=(rng()+rng()+rng()-1.5),y=h*.12+x*.32+n*h*.14
      c.fillStyle='rgba(136,166,192,'+(.025+rng()*.085)+')';c.fillRect(x,y,.45+rng()*.65,.45+rng()*.65)
    }
    return bg
  }
  pendantSize(){return clamp(Math.min(this.width,this.height)*.13,60,104)}
  start(){
    this.stop();this.phase='running';this.startedAt=performance.now();this.hiddenAt=null
    window.addEventListener('resize',this._resize);document.addEventListener('visibilitychange',this._visibility)
    if(this.reduced){this.render(1);this.finish();return}
    this.raf=requestAnimationFrame(this._tick)
  }
  stop(){
    cancelAnimationFrame(this.raf);this.raf=0;this.phase='stopped'
    window.removeEventListener('resize',this._resize);document.removeEventListener('visibilitychange',this._visibility)
  }
  finish(){if(this.phase!=='running')return;this.stop();this.phase='complete';this.onPendant()}
  frame(now){
    if(this.phase!=='running')return
    const t=clamp((now-this.startedAt)/this.durationMs);this.render(t,now)
    if(t>=1)this.finish();else this.raf=requestAnimationFrame(this._tick)
  }
  whalePose(t){
    const x=this.width*lerp(.90,.28,clamp((t-.01)/.83))
    const lift=Math.sin(smooth(.12,.80,t)*Math.PI)
    const y=this.surfaceY-Math.max(0,lift)*this.height*.315
      +this.height*.08*(1-smooth(.02,.18,t))
      +Math.max(0,t-.76)*this.height*1.2
    const rotation=.38*Math.cos(smooth(.12,.80,t)*Math.PI)-smooth(.76,.94,t)*.12
    const alpha=smooth(.02,.12,t)*(1-smooth(.91,.98,t))
    return {x,y,rotation,alpha,yaw:-.14+Math.sin(t*5)*.19,u:t}
  }
  // All wake elements use past deformed tail positions, not a separate timer.
  tailAt(t){
    const p=this.whalePose(t),seconds=t*this.durationMs/1000;
    const point=deformWhalePoint(.91,.22,seconds),L=this.whale.len;
    const x=point.x*.88*L/2,y=-point.y*.88*L/(880/478)/2;
    return {x:p.x+Math.cos(p.rotation)*x-Math.sin(p.rotation)*y,
      y:p.y+Math.sin(p.rotation)*x+Math.cos(p.rotation)*y,rotation:p.rotation,alpha:p.alpha};
  }
  prepareFlow(t){
    const seconds=t*this.durationMs/1000,L=this.whale.len;
    this.flowPose=this.whalePose(t);this.flowWaves=[];
    if(this.reduced)return;
    // Each half-stroke leaves a crest which grows after the whale has passed.
    const interval=Math.PI/SWIM_RATE;
    for(let emitted=.48;emitted<5.45;emitted+=interval){
      const age=seconds-emitted;if(age<0||age>3.1)continue;
      const tail=this.tailAt(emitted/(this.durationMs/1000));
      const strength=smooth(0,.22,age)*Math.exp(-age*.63)*tail.alpha*(1-smooth(.91,1,t));
      this.flowWaves.push({x:tail.x+age*L*.055,y:tail.y+age*L*.025,
        angle:tail.rotation-.25,rx:L*(.11+age*.29),ry:L*(.06+age*.15),strength,age});
    }
  }
  flowAt(x,y){
    if(this.reduced)return {dx:0,dy:0,light:0};
    const p=this.flowPose,L=this.whale.len,vx=x-p.x,vy=y-p.y;
    const d=Math.hypot(vx/(L*.66),vy/(L*.38));
    const influence=Math.exp(-d*d*1.5)*p.alpha*(1-smooth(.78,.94,p.u));
    let dx=(vx*.15-L*.025)*influence,dy=vy*.25*influence,light=influence*.24;
    for(const wave of this.flowWaves){
      const ca=Math.cos(wave.angle),sa=Math.sin(wave.angle),ox=x-wave.x,oy=y-wave.y;
      const lx=ca*ox+sa*oy,ly=-sa*ox+ca*oy;
      const r=Math.hypot(lx/wave.rx,ly/wave.ry),band=(r-1)*wave.rx/(L*.075);
      const crest=Math.exp(-band*band)*wave.strength;
      const push=Math.sin(band*2.2)*crest*L*.045;
      const n=Math.hypot(lx,ly*1.7)||1,nx=lx/n,ny=ly*1.7/n;
      dx+=(ca*nx-sa*ny)*push;dy+=(sa*nx+ca*ny)*push;
      light+=crest*.8;
    }
    return {dx,dy,light};
  }
  drawContinuum(t){
    const c=this.ctx,L=this.whale.len,seconds=t*this.durationMs/1000,p=this.flowPose;
    const palette=['91,219,255','135,116,255','230,123,228','255,207,142'];
    const fade=1-smooth(.86,1,t);
    const glow=(x,y,r,rgb,alpha)=>{
      if(alpha<.0005)return;
      const g=c.createRadialGradient(x,y,0,x,y,r);
      g.addColorStop(0,'rgba('+rgb+','+alpha+')');
      g.addColorStop(.25,'rgba('+rgb+','+alpha*.7+')');
      g.addColorStop(.65,'rgba('+rgb+','+alpha*.18+')');g.addColorStop(1,'rgba('+rgb+',0)');
      c.fillStyle=g;c.fillRect(x-r,y-r,r*2,r*2);
    };
    c.save();c.globalCompositeOperation='screen';
    glow(p.x,p.y,L*.56,palette[0],p.alpha*.12*fade);
    // Airy overlapping color, without a drawn centerline or attached ribbons.
    for(let i=0;i<28;i++){
      const age=i/27*2.4,pt=t-age/(this.durationMs/1000);if(pt<.07)continue;
      const a=this.tailAt(pt),spread=L*(.025+age*.065);
      const x=a.x+age*L*.10+Math.sin(i*2.39+seconds*.3)*spread*.5;
      const y=a.y+Math.cos(i*1.83+seconds*.45)*spread;
      const opacity=.045*a.alpha*smooth(0,.13,age)*(1-age/2.6)*fade;
      glow(x,y,L*(.085+age*.095),palette[i%3],opacity);
    }
    // Deterministic particle births make replay and timeline scrubbing identical.
    for(const dust of this.prismaticDust){
      const age=(seconds+dust.offset*dust.life)%dust.life,emitted=seconds-age;
      if(emitted<.38||emitted>5.45)continue;
      const a=this.tailAt(emitted/(this.durationMs/1000));
      const life=smooth(0,.14,age)*(1-smooth(dust.life*.35,dust.life,age))*a.alpha*fade;
      if(life<.005)continue;
      const swirl=dust.angle+age*(.65+dust.spin);
      const radius=L*(.018+age*.095)*dust.spread;
      const x=a.x+age*L*(.045+dust.speed*.10)+Math.cos(swirl)*radius;
      const y=a.y+Math.sin(swirl)*radius*.8-age*L*.035;
      const size=(.65+dust.size*1.65)*Math.max(.7,L/600),rgb=palette[dust.color];
      glow(x,y,size*7,rgb,life*.22);
      c.save();c.translate(x,y);c.rotate(dust.angle+age*dust.spin);
      c.fillStyle='rgba('+rgb+','+life*(.45+dust.size*.45)+')';c.beginPath();
      c.ellipse(0,0,size*(dust.size>.78?1.7:1),size*.6,0,0,Math.PI*2);c.fill();
      if(dust.size>.91){
        c.strokeStyle='rgba(235,242,255,'+life*.6+')';c.lineWidth=.65;c.beginPath();
        c.moveTo(-size*2.5,0);c.lineTo(size*2.5,0);c.moveTo(0,-size*2.5);c.lineTo(0,size*2.5);c.stroke();
      }
      c.restore();
    }
    // The refractive wave remains in the stars, with a soft colored crest.
    for(const wave of this.flowWaves){
      const ca=Math.cos(wave.angle),sa=Math.sin(wave.angle);
      for(let i=0;i<24;i++){
        const angle=i/24*Math.PI*2,x=Math.cos(angle)*wave.rx,y=Math.sin(angle)*wave.ry;
        glow(wave.x+ca*x-sa*y,wave.y+sa*x+ca*y,L*.055,palette[i%3],wave.strength*.014);
      }
    }
    c.restore();
  }

  drawStars(t,seconds){
    const c=this.ctx,w=this.width,h=this.height;
    c.drawImage(this.background,0,0,w,h);
    for(const s of this.stars){
      const x=(s.x*w+seconds*s.z*1.25)%w,y=s.y*h,f=this.flowAt(x,y);
      const px=x+f.dx,py=y+f.dy;
      const alpha=clamp((.22+s.z*.45)*(1+.14*Math.sin(s.phase+seconds*.65))+f.light*.42);
      if(f.light>.08){
        c.beginPath();c.moveTo(px-f.dx*.5,py-f.dy*.5);c.quadraticCurveTo(x,py,px,py);
        c.lineWidth=.5+s.r*.4;c.strokeStyle='rgba(139,196,248,'+clamp(f.light*.30)+')';c.stroke();
      }
      c.fillStyle='rgba(179,216,242,'+alpha+')';c.beginPath();c.arc(px,py,s.r*(.7+s.z*.3)+Math.min(.7,f.light*.35),0,Math.PI*2);c.fill();
      if(s.r>1.1&&s.z>.85){
        c.strokeStyle='rgba(174,211,226,'+alpha*.30+')';c.lineWidth=.55;c.beginPath();
        c.moveTo(px-3,py);c.lineTo(px+3,py);c.moveTo(px,py-3);c.lineTo(px,py+3);c.stroke();
      }
    }
  }

  drawFlight(t,seconds){
    const p=this.whalePose(t);if(p.alpha<.001)return
    const c=this.ctx,L=this.whale.len
    const layer=this.whaleContext
    layer.setTransform(this.dpr,0,0,this.dpr,0,0);layer.clearRect(0,0,this.width,this.height)
    layer.save();layer.globalAlpha=p.alpha;layer.translate(p.x,p.y);layer.rotate(p.rotation)
    drawWhale(layer,L,L/1.864,true,false,seconds,p.yaw);layer.restore()
    layer.save();layer.globalCompositeOperation='destination-in'
    const mask=layer.createLinearGradient(0,this.surfaceY-this.height*.012,0,this.surfaceY+this.height*.055)
    mask.addColorStop(0,'rgba(255,255,255,1)');mask.addColorStop(1,'rgba(255,255,255,0)')
    layer.fillStyle=mask;layer.fillRect(0,0,this.width,this.height);layer.restore()
    c.drawImage(this.whaleLayer,0,0,this.width,this.height)
  }
  drawPendant(progress,now,dark,x=this.pendant.x,y=this.pendant.y,size=this.pendantSize()){
    const c=this.ctx;c.save();c.globalAlpha=clamp(progress);c.translate(x,y)
    drawWhale(c,size*1.25,size*.7,true,false,this.reduced?0:now/1000,-.12);c.restore()
  }
  render(progress,now=performance.now()){
    const t=clamp(progress);this.progress=t;const c=this.ctx,seconds=t*this.durationMs/1000
    c.setTransform(this.dpr,0,0,this.dpr,0,0);c.clearRect(0,0,this.width,this.height);this.prepareFlow(t);this.drawStars(t,seconds)
    if(this.reduced){c.save();c.translate(this.width*.5,this.height*.46);drawWhale(c,this.whale.len,this.whale.height,true,false,0,-.12);c.restore();return}
    this.drawContinuum(t);this.drawFlight(t,seconds)
  }
}
WhaleSplash.DURATION_MS=WHALE_SPLASH_DURATION_MS
WhaleSplash.rendererInfo=()=>({mode:model?'webgl2-reference-mesh':'fallback-image',asset:'user-supplied-constellation-whale',imageReady:!!fallback?.naturalWidth,triangles:model?model.count/3:0,error:modelError,strokePeriod:Math.PI*2/SWIM_RATE})
export { PIXEL, clamp, lerp }
