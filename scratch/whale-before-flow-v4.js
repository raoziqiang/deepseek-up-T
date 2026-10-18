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
const VERTEX = '#version 300 es\n' + `
precision highp float;
in vec2 aUV;
uniform float uTime;
uniform float uYaw;
out vec2 vUV;
void main(){
  vUV=aUV;
  vec2 p=vec2((aUV.x-.5)*2.,(.5-aUV.y)*2.);
  float tail=smoothstep(.46,.97,aUV.x);
  float wave=sin(uTime*1.65-aUV.x*3.7);
  p.y+=wave*.080*tail*tail;
  float fin=smoothstep(.49,.86,aUV.y)*(1.-smoothstep(.52,.68,aUV.x))*smoothstep(.27,.39,aUV.x);
  p.x+=sin(uTime*1.4+.7)*.024*fin;
  p.y+=sin(uTime*1.4+.7)*.032*fin;
  float depth=sin(aUV.x*3.14159)*sin(aUV.y*3.14159)*.10;
  p.x+=depth*sin(uYaw)*.12;
  p.y+=sin(uTime*.9)*.006*sin(aUV.x*3.14159);
  // Leave room for the deformed silhouette at the texture edges.
  gl_Position=vec4(p*.94,depth*.1,1.);
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
    ctx.save();ctx.shadowColor='rgba(101,225,255,.48)';ctx.shadowBlur=w*.018;
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
    this.dust=Array.from({length:170},()=>({x:rng(),y:rng(),phase:rng()*6.283,size:.25+rng()*.55}))
    this.particles=Array.from({length:64},()=>({angle:rng()*6.283,speed:.35+rng()*.65,life:.5+rng()*.5}))
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
    // Solve when the tail clears / nose enters the sea. The wave origins follow
    // the pose and the viewport instead of using unrelated, hard-coded points.
    const contact=(lo,hi,offset,rising,strength)=>{
      for(let n=0;n<32;n++){
        const t=(lo+hi)/2,p=this.whalePose(t),oy=rising?-.13:-.045,
          y=p.y+(Math.sin(p.rotation)*offset+Math.cos(p.rotation)*oy)*this.whale.len
        if((y>this.surfaceY)===rising)lo=t;else hi=t
      }
      const at=(lo+hi)/2,p=this.whalePose(at)
      const oy=rising?-.13:-.045
      return {at,x:(p.x+(Math.cos(p.rotation)*offset-Math.sin(p.rotation)*oy)*this.whale.len)/this.width,y:.67,strength}
    }
    this.contacts=[contact(.12,.4,.34,true,.65),contact(.5,.85,-.32,false,1)]
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
    const lift=Math.sin(clamp((t-.16)/.60)*Math.PI)
    const y=this.surfaceY-Math.max(0,lift)*this.height*.315
      +this.height*.08*(1-smooth(.02,.18,t))
      +Math.max(0,t-.76)*this.height*1.2
    const rotation=.48*Math.cos(clamp((t-.16)/.60)*Math.PI)-smooth(.76,.94,t)*.18
    const alpha=smooth(.02,.12,t)*(1-smooth(.91,.98,t))
    return {x,y,rotation,alpha,yaw:-.14+Math.sin(t*5)*.19,u:t}
  }
  waveAt(x,y,t){
    let dx=0,dy=0,light=0
    for(const c of this.contacts){
      const age=(t-c.at)*this.durationMs/1000
      if(age<0||age>2.3)continue
      const vx=x-c.x*this.width,vy=(y-c.y*this.height)*3.4,d=Math.hypot(vx,vy)||1
      const band=(d-age*Math.min(this.width,this.height)*.27)/22
      const wave=Math.exp(-band*band)*Math.exp(-age*.85)*c.strength
      dx+=vx/d*wave*8;dy+=vy/d*wave*5;light+=wave
    }
    return {dx,dy,light}
  }
  drawStars(t,seconds){
    const c=this.ctx,w=this.width,h=this.height,pose=this.whalePose(t)
    c.drawImage(this.background,0,0,w,h)
    for(const s of this.stars){
      let x=(s.x*w+seconds*s.z*1.25)%w,y=s.y*h
      const wave=this.waveAt(x,y,t),distance=Math.hypot(x-pose.x,y-pose.y),pull=Math.exp(-distance/(this.whale.len*.4))*pose.alpha
      x+=wave.dx+Math.sin(s.phase+seconds*2)*pull*3;y+=wave.dy+Math.cos(s.phase+seconds*2)*pull*3
      const alpha=(.24+s.z*.45)*(1+.14*Math.sin(s.phase+seconds*.65))+wave.light*.5
      c.fillStyle='rgba(179,205,227,'+Math.min(.95,alpha)+')';c.beginPath();c.arc(x,y,s.r*(.7+s.z*.3)+wave.light*.5,0,Math.PI*2);c.fill()
      if(s.r>1.1&&s.z>.85){
        c.strokeStyle='rgba(174,211,226,'+alpha*.30+')';c.lineWidth=.55;c.beginPath()
        c.moveTo(x-3,y);c.lineTo(x+3,y);c.moveTo(x,y-3);c.lineTo(x,y+3);c.stroke()
      }
    }
    for(const p of this.dust){
      const x=p.x*w,y=this.surfaceY+Math.sin(p.phase+seconds*.16)*h*.018+(p.y-.5)*h*.055,wave=this.waveAt(x,y,t)
      c.fillStyle='rgba(119,176,194,'+(.075+wave.light*.55)+')';c.fillRect(x+wave.dx,y+wave.dy,p.size+wave.light,p.size+wave.light)
    }
  }
  drawRipples(t){
    const c=this.ctx;c.save();c.globalCompositeOperation='screen';c.shadowColor='rgba(99,218,247,.55)';c.shadowBlur=7
    for(const event of this.contacts){
      const age=(t-event.at)*this.durationMs/1000
      if(age<0||age>2.3)continue
      const life=Math.exp(-age*1.1)*smooth(0,.13,age)*event.strength
      for(let ring=0;ring<3;ring++){
        const delay=age-ring*.15;if(delay<=0)continue
        const radius=delay*Math.min(this.width,this.height)*.27
        c.beginPath();c.ellipse(event.x*this.width,event.y*this.height,radius,radius*.235,0,.10,Math.PI*1.97)
        c.strokeStyle='rgba(125,200,215,'+(life*(.58-ring*.13))+')';c.lineWidth=ring===0?1.35:.75;c.stroke()
      }
      for(const p of this.particles){
        const a=age/p.life;if(a>1.35)continue
        const speed=this.height*.15*p.speed,x=event.x*this.width+Math.cos(p.angle)*speed*age
        const y=event.y*this.height-Math.abs(Math.sin(p.angle))*speed*age+this.height*.08*age*age
        c.fillStyle='rgba(175,226,232,'+(clamp(1-a/1.35)*event.strength*.66)+')';c.beginPath();c.arc(x,y,.6+p.speed*.7,0,Math.PI*2);c.fill()
      }
    }
    c.restore()
  }
  drawFlight(t,seconds){
    const p=this.whalePose(t);if(p.alpha<.001)return
    const c=this.ctx,L=this.whale.len
    c.save();c.globalCompositeOperation='screen'
    for(let i=0;i<26;i++){
      const previous=this.whalePose(t-i*.0055),alpha=previous.alpha*(1-i/26)*.18
      if(alpha<=0)continue
      const x=previous.x+(Math.cos(previous.rotation)*.34+Math.sin(previous.rotation)*.13)*L,
        y=previous.y+(Math.sin(previous.rotation)*.34-Math.cos(previous.rotation)*.13)*L+Math.sin(i*2.4+seconds)*3
      c.fillStyle='rgba(111,186,211,'+alpha+')';c.beginPath();c.arc(x,y,.65+(i%3)*.35,0,Math.PI*2);c.fill()
    }
    c.restore()
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
    c.setTransform(this.dpr,0,0,this.dpr,0,0);c.clearRect(0,0,this.width,this.height);this.drawStars(t,seconds)
    if(this.reduced){c.save();c.translate(this.width*.5,this.height*.46);drawWhale(c,this.whale.len,this.whale.height,true,false,0,-.12);c.restore();return}
    this.drawFlight(t,seconds);this.drawRipples(t)
  }
}
WhaleSplash.DURATION_MS=WHALE_SPLASH_DURATION_MS
WhaleSplash.rendererInfo=()=>({mode:model?'webgl2-reference-mesh':'fallback-image',asset:'user-supplied-constellation-whale',imageReady:!!fallback?.naturalWidth,triangles:model?model.count/3:0,error:modelError})
export { PIXEL, clamp, lerp }
