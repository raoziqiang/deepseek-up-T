/** Star whale: locally generated, articulated 3D geometry and contact-driven waves. */
const PIXEL = 6
export const __WHALE_PIXEL__ = PIXEL
export const WHALE_SPLASH_DURATION_MS = 6200
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const lerp = (a, b, t) => a + (b - a) * t
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t) }
function random(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
}
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
const normalize = a => { const n = Math.hypot(...a) || 1; return a.map(x => x / n) }
const sub = (a, b) => a.map((x, i) => x - b[i])
const VERTEX = '#version 300 es\n' + `
precision highp float;
in vec3 aPosition;
in vec3 aNormal;
in float aKind;
uniform float uTime;
uniform float uYaw;
out vec3 vNormal;
out vec3 vPosition;
out float vKind;
mat3 rotateY(float a) { float c=cos(a),s=sin(a); return mat3(c,0.,-s,0.,1.,0.,s,0.,c); }
mat3 rotateX(float a) { float c=cos(a),s=sin(a); return mat3(1.,0.,0.,0.,c,s,0.,-s,c); }
vec3 bend(vec3 p) {
  float w=smoothstep(-.7,2.65,p.x);
  p.y += sin(uTime*3.1-p.x*.8)*.29*w*w;
  p.z += sin(uTime*1.55-p.x*.45)*.06*w;
  if(aKind>0.5 && aKind<1.5) p.y+=sin(uTime*2.3+.6)*.17*max(abs(p.z)-.5,0.);
  return p;
}
void main() {
  vec3 p=bend(aPosition);
  vec3 n=aNormal;
  float eps=.008;
  vec3 tx=(bend(aPosition+vec3(eps,0.,0.))-p)/eps;
  vec3 tz=(bend(aPosition+vec3(0.,0.,eps))-p)/eps;
  n=normalize(vec3(n.x-tx.y*n.y,n.y,n.z-tz.y*n.y));
  mat3 view=rotateX(.43+sin(uTime*.65)*.035)*rotateY(uYaw);
  p=view*p; n=view*n;
  float perspective=7.5/(7.5-p.z);
  gl_Position=vec4(p.x*perspective/3.55,p.y*perspective/1.9,-p.z/6.,1.);
  vNormal=n; vPosition=aPosition; vKind=aKind;
}`
const FRAGMENT = '#version 300 es\n' + `
precision highp float;
in vec3 vNormal;
in vec3 vPosition;
in float vKind;
out vec4 color;
void main() {
  vec3 n=normalize(vNormal);
  if(!gl_FrontFacing) n=-n;
  vec3 light=normalize(vec3(-.7,1.5,2.2));
  float diffuse=max(0.,dot(n,light));
  float rim=pow(1.-max(0.,n.z),3.);
  float belly=(1.-smoothstep(-.42,-.07,vPosition.y))*(1.-smoothstep(.5,1.8,vPosition.x));
  if(vKind>.5 && vKind<1.5) belly*=.55;
  vec3 base=mix(vec3(.043,.15,.245),vec3(.51,.65,.69),belly*.83);
  float grain=sin(vPosition.x*53.+sin(vPosition.z*63.))*sin(vPosition.y*81.+vPosition.z*37.);
  base*=1.+grain*.026;
  float throat=pow(.5+.5*sin(atan(vPosition.z,-vPosition.y)*29.+vPosition.x*.22),18.);
  base*=1.-throat*belly*.18;
  float spec=pow(max(0.,dot(n,normalize(light+vec3(0.,0.,1.)))),50.);
  vec3 lit=base*(.40+diffuse*.98)+vec3(.35,.62,.73)*spec*.55+vec3(.12,.43,.55)*rim*.4;
  // Surface-bound starlight follows the skin as the actual mesh deforms.
  vec2 uv=vec2(vPosition.x,atan(vPosition.y,vPosition.z))*8.;
  vec2 cell=floor(uv),q=fract(uv)-.5;
  float seed=fract(sin(dot(cell,vec2(127.1,311.7)))*43758.5453);
  float star=(1.-smoothstep(.01,.11,length(q)))*step(.87,seed);
  float thread=pow(.5+.5*sin(vPosition.x*2.7+atan(vPosition.y,vPosition.z)*16.),95.);
  if(vKind<.5)lit+=vec3(.19,.55,.66)*(star*.85+thread*.09)*(1.-belly);
  if(vKind>1.5 && vKind<2.5) lit=vec3(.004,.012,.022)+vec3(.18,.31,.36)*spec;
  if(vKind>2.5 && vKind<3.5) lit=vec3(.64,.86,.91);
  if(vKind>3.5) lit=vec3(.022,.062,.092)*(.6+diffuse*.4);
  color=vec4(pow(lit,vec3(.83)),1.);
}`

/** Closed surfaces: body, two pectoral fins, dorsal fin, flukes, and inset eyes. */
class WhaleModel {
  constructor() {
    this.canvas = document.createElement('canvas')
    this.canvas.width = 768; this.canvas.height = 412
    const gl = this.canvas.getContext('webgl2', { alpha:true, antialias:true, premultipliedAlpha:true, preserveDrawingBuffer:true })
    if (!gl) throw Error('WebGL2 unavailable')
    this.gl = gl
    const compile = (type, source) => {
      const shader=gl.createShader(type); gl.shaderSource(shader,source); gl.compileShader(shader)
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader))
      return shader
    }
    const program=gl.createProgram()
    const vs=compile(gl.VERTEX_SHADER,VERTEX),fs=compile(gl.FRAGMENT_SHADER,FRAGMENT)
    gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program)
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program))
    gl.deleteShader(vs);gl.deleteShader(fs)
    this.program=program;this.vertices=[];this.indices=[];this.build();this.count=this.indices.length
    gl.useProgram(program)
    this.vao=gl.createVertexArray();gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(this.vertices),gl.STATIC_DRAW)
    for(const [name,size,offset] of [['aPosition',3,0],['aNormal',3,12],['aKind',1,24]]) {
      const loc=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc,size,gl.FLOAT,false,28,offset)
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,gl.createBuffer())
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint32Array(this.indices),gl.STATIC_DRAW)
    this.time=gl.getUniformLocation(program,'uTime');this.yaw=gl.getUniformLocation(program,'uYaw')
    this.vertices=null;this.indices=null;gl.enable(gl.DEPTH_TEST);gl.clearColor(0,0,0,0)
  }
  surface(fn,nu=60,nv=32,kind=0) {
    const base=this.vertices.length/7
    for(let i=0;i<=nu;i++)for(let j=0;j<=nv;j++){
      const u=i/nu,v=j/nv,p=fn(u,v),d=.0002
      const du=sub(fn(Math.min(1,u+d),v),fn(Math.max(0,u-d),v))
      const dv=sub(fn(u,v+d),fn(u,v-d)),n=normalize(cross(du,dv))
      this.vertices.push(...p,...n,kind)
    }
    for(let i=0;i<nu;i++)for(let j=0;j<nv;j++){
      const a=base+i*(nv+1)+j,b=a+nv+1
      this.indices.push(a,b,a+1,b,b+1,a+1)
    }
  }
  sphere(x,y,z,rx,ry,rz,kind=0) {
    this.surface((u,v)=>{
      const a=.001+u*(Math.PI-.002),b=v*Math.PI*2
      return [x+rx*Math.cos(a),y+ry*Math.sin(a)*Math.sin(b),z+rz*Math.sin(a)*Math.cos(b)]
    },16,24,kind)
  }
  build() {
    const profile=[
      [-2.62,.01,.025,-.03],[-2.5,.23,.31,.01],[-2.15,.39,.51,.04],
      [-1.55,.56,.63,.06],[-.8,.63,.62,.04],[0,.51,.50,.04],
      [.75,.36,.34,.025],[1.4,.21,.20,0],[2.05,.105,.11,0],[2.58,.055,.07,0]
    ]
    const sample=x=>{
      let k=0;while(k<profile.length-2&&x>profile[k+1][0])k++
      const a=profile[k],b=profile[k+1],t=clamp((x-a[0])/(b[0]-a[0]))
      return [1,2,3].map(c=>{
        const prev=profile[Math.max(0,k-1)],next=profile[Math.min(profile.length-1,k+2)]
        const m0=(b[c]-prev[c])/(b[0]-prev[0])*(b[0]-a[0])
        const m1=(next[c]-a[c])/(next[0]-a[0])*(b[0]-a[0])
        return (2*t*t*t-3*t*t+1)*a[c]+(t*t*t-2*t*t+t)*m0+(-2*t*t*t+3*t*t)*b[c]+(t*t*t-t*t)*m1
      })
    }
    this.surface((u,v)=>{
      const x=lerp(-2.62,2.58,u),[ry,rz,cy]=sample(x),a=v*Math.PI*2
      return [x,cy+ry*Math.sin(a),rz*Math.cos(a)]
    },110,56,0)
    for(const side of [-1,1]){
      this.surface((u,v)=>{
        const a=v*Math.PI*2,shape=Math.pow(Math.sin(Math.PI*u),.7)
        return [-1.08+u*.78+Math.cos(a)*(.25*shape+.012),
          -.22-u*.80+.15*u*u+Math.sin(a)*(.065*shape+.004),side*(.42+u*1.19)]
      },42,24,1)
      this.surface((u,v)=>{
        const a=v*Math.PI*2,w=.34*Math.pow(1-u,.72)+.004
        return [2.38+.64*u-.11*Math.sin(u*Math.PI)+Math.cos(a)*w,
          .02+.13*u*u+Math.sin(a)*(.065*Math.sin(Math.PI*u)+.006),side*(.015+u*1.04)]
      },42,24,0)
      this.sphere(-2.11,-.075,side*.505,.105,.078,.024,0)
      this.sphere(-2.125,-.073,side*.526,.064,.047,.022,2)
      this.sphere(-2.147,-.055,side*.545,.015,.013,.008,3)
      this.surface((u,v)=>{
        const x=lerp(-2.48,-1.26,u),p=sample(x),a=v*Math.PI*2
        const y=-.11-.11*Math.sin(u*Math.PI*.8)
        const z=side*p[1]*Math.sqrt(Math.max(.01,1-((y-p[2])/p[0])**2))
        return [x,y+.014*Math.sin(a),z+.012*Math.cos(a)]
      },45,8,4)
    }
    this.surface((u,v)=>{
      const a=v*Math.PI*2,shape=Math.pow(1-u,.72)
      return [.43+u*.31+Math.cos(a)*(.32*shape+.003),.31+u*.43,Math.sin(a)*(.09*shape+.003)]
    },26,20,0)
    for(let i=0;i<6;i++){
      const x=-2.44+i*.12,[ry,rz,cy]=sample(x)
      this.sphere(x,cy+ry*.78,rz*.57,.035,.026,.03,0)
    }
  }
  render(time=0,yaw=-.12) {
    const gl=this.gl
    if(gl.isContextLost())return null
    gl.viewport(0,0,this.canvas.width,this.canvas.height)
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(this.program);gl.bindVertexArray(this.vao)
    gl.uniform1f(this.time,time);gl.uniform1f(this.yaw,yaw)
    gl.drawElements(gl.TRIANGLES,this.count,gl.UNSIGNED_INT,0)
    return this.canvas
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
if(typeof Image!=='undefined'){
  const script=typeof document!=='undefined'?document.currentScript?.src||document.baseURI:''
  fallback=new Image();fallback.src=new URL('whale-3d.png',script).href
}
export function whalePath(ctx,w,h){
  ctx.beginPath();ctx.ellipse(0,0,w*.42,h*.35,0,0,Math.PI*2)
}
export function drawWhale(ctx,w,h,detail=true,light=false,time=0,yaw=-.12){
  const frame=getModel()?.render(time,yaw)
  if(frame){ctx.drawImage(frame,-w/2,-w/1.864/2,w,w/1.864);return}
  if(fallback?.complete&&fallback.naturalWidth){
    const ih=w*fallback.naturalHeight/fallback.naturalWidth;ctx.drawImage(fallback,-w/2,-ih/2,w,ih);return
  }
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
        const t=(lo+hi)/2,p=this.whalePose(t),y=p.y+Math.sin(p.rotation)*this.whale.len*offset
        if((y>this.surfaceY)===rising)lo=t;else hi=t
      }
      const at=(lo+hi)/2,p=this.whalePose(at)
      return {at,x:(p.x+Math.cos(p.rotation)*this.whale.len*offset)/this.width,y:.67,strength}
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
    fog(w*.58,h*.40,w*.7,'rgba(22,40,67,.40)')
    fog(w*.22,h*.65,w*.4,'rgba(23,67,83,.18)')
    fog(w*.83,h*.14,w*.30,'rgba(52,48,83,.14)')
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
    const x=this.width*lerp(.96,.28,clamp((t-.01)/.83))
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
    const c=this.ctx;c.save();c.globalCompositeOperation='screen'
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
      const x=previous.x+Math.cos(previous.rotation)*L*.34,y=previous.y+Math.sin(previous.rotation)*L*.34+Math.sin(i*2.4+seconds)*3
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
WhaleSplash.rendererInfo=()=>({mode:model?'webgl2-mesh':'fallback-image',triangles:model?model.count/3:0,error:modelError})
export { PIXEL, clamp, lerp }
