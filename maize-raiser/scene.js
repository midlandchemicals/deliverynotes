/* ============================================================
   MAIZE RAISER — 3D scene
   A procedurally-built floating fertiliser can.
   No external models/textures: geometry + canvas label + env light.
   ============================================================ */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const LIME = new THREE.Color('#c6ff3a');

/* keyframes for the can as the page scrolls (progress 0..1).
   x is multiplied by a responsive factor so it never collides with text on small screens. */
const KEYS = [
  { p: 0.00, x:  0.00, y:  0.00, s: 1.00, rx:  0.00 },
  { p: 0.15, x:  0.00, y:  0.00, s: 1.00, rx:  0.00 },
  { p: 0.33, x:  0.62, y:  0.06, s: 0.86, rx:  0.10 },
  { p: 0.52, x: -0.62, y:  0.00, s: 0.82, rx: -0.06 },
  { p: 0.66, x:  0.00, y:  0.02, s: 1.06, rx:  0.00 },
  { p: 0.82, x:  0.55, y:  0.00, s: 0.78, rx:  0.08 },
  { p: 1.00, x:  0.00, y: -0.06, s: 1.12, rx:  0.00 },
];

function sampleKeys(p){
  if (p <= KEYS[0].p) return KEYS[0];
  if (p >= KEYS[KEYS.length-1].p) return KEYS[KEYS.length-1];
  for (let i=0;i<KEYS.length-1;i++){
    const a=KEYS[i], b=KEYS[i+1];
    if (p>=a.p && p<=b.p){
      const t=(p-a.p)/(b.p-a.p);
      const e=t*t*(3-2*t); // smoothstep
      return {
        x:a.x+(b.x-a.x)*e, y:a.y+(b.y-a.y)*e,
        s:a.s+(b.s-a.s)*e, rx:a.rx+(b.rx-a.rx)*e,
      };
    }
  }
  return KEYS[0];
}

/* ── the wrap-around label, drawn to a 2D canvas ──
   Returns { tex, redraw }. redraw() is called once webfonts load so the
   brand bakes in Syne / JetBrains Mono rather than a fallback. */
function makeLabel(){
  const W=2048, H=640;
  const c=document.createElement('canvas'); c.width=W; c.height=H;
  const x=c.getContext('2d');
  const lime='#c6ff3a', white='#f4f5f0', grey='#8a909c';

  const draw=()=>{
    // base
    x.fillStyle='#0b0c10'; x.fillRect(0,0,W,H);

    // faint grid hairlines
    x.strokeStyle='rgba(244,245,240,0.06)'; x.lineWidth=1;
    for(let gx=0; gx<=W; gx+=64){ x.beginPath(); x.moveTo(gx,0); x.lineTo(gx,H); x.stroke(); }
    for(let gy=0; gy<=H; gy+=64){ x.beginPath(); x.moveTo(0,gy); x.lineTo(W,gy); x.stroke(); }

    // top + bottom lime hairlines
    x.fillStyle=lime; x.fillRect(0,96,W,2); x.fillRect(0,H-98,W,2);

    // repeating mono ribbons (top + bottom)
    x.textAlign='left'; x.textBaseline='middle';
    x.font='600 26px "JetBrains Mono", monospace';
    const ribbon=(msg,yy,col)=>{
      x.fillStyle=col; const w=x.measureText(msg).width;
      for(let rx=0; rx<W+w; rx+=w){ x.fillText(msg, rx, yy); }
    };
    ribbon('MAIZE RAISER PROTOCOL   ·   $MZR   ·   GROWTH FORMULA   ·   ', 56, grey);
    ribbon('BATCH 0001   ·   0x9F4A…E3D1   ·   FUEL FOR EVERYTHING THAT GROWS   ·   ', H-54, grey);

    // ── centre brand lockup (faces front via texture offset) ──
    const cx=W/2;
    x.textAlign='center';
    x.fillStyle=white; x.font='800 200px "Syne", sans-serif';
    x.fillText('MAIZE', cx, 250);
    x.fillStyle=lime;  x.fillText('RAISER', cx, 420);

    // NPK + tagline under brand
    x.fillStyle=white; x.font='600 30px "JetBrains Mono", monospace';
    x.fillText('N 10.5   ·   P 4.0   ·   K 7.2', cx, 506);
    x.fillStyle=grey;  x.font='500 24px "JetBrains Mono", monospace';
    x.fillText('GROWTH ENGINE · NET 500 ML', cx, 548);

    // ── side blocks (barcode + label), left & right of centre ──
    const barcode=(bx,by)=>{
      let px=bx; const seed=[3,1,2,4,1,3,1,2,1,4,2,1,3,1,2,3,1,4,1,2,3,1,2,4,1,3,1,2];
      x.fillStyle=white;
      for(let i=0;i<seed.length;i++){ const w=seed[i]*2; if(i%2===0) x.fillRect(px,by,w,70); px+=w+2; }
    };
    barcode(150, 300); barcode(W-310, 300);
    x.textAlign='center'; x.fillStyle=grey; x.font='500 20px "JetBrains Mono", monospace';
    x.fillText('SCAN · VERIFY', 240, 400);
    x.fillText('ON-CHAIN', W-220, 400);
  };

  draw();
  const tex=new THREE.CanvasTexture(c);
  tex.colorSpace=THREE.SRGBColorSpace;
  tex.wrapS=THREE.RepeatWrapping;
  tex.offset.x=0.5;            // brand lockup faces the camera, seam to the back
  tex.needsUpdate=true;
  return { tex, redraw(){ draw(); tex.needsUpdate=true; } };
}

export function createScene(canvas){
  // bail clearly if WebGL is unavailable
  let renderer;
  try{
    renderer=new THREE.WebGLRenderer({ canvas, antialias:true, powerPreference:'high-performance' });
  }catch(e){ return null; }
  if(!renderer || !renderer.getContext()) return null;

  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mqCoarse=window.matchMedia('(pointer: coarse)').matches;

  let W=window.innerWidth, H=window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, mqCoarse?1.8:2));
  renderer.setSize(W,H);
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.12;

  const scene=new THREE.Scene();
  scene.background=new THREE.Color('#06070b');
  scene.fog=new THREE.FogExp2('#06070b', 0.045);

  const camera=new THREE.PerspectiveCamera(32, W/H, 0.1, 100);
  camera.position.set(0,0,6.4);

  // procedural studio reflections
  const pmrem=new THREE.PMREMGenerator(renderer);
  scene.environment=pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  // ── lights ──
  const key=new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3.5,5,4); scene.add(key);
  const rim=new THREE.DirectionalLight(LIME, 3.2);
  rim.position.set(-4,1.5,-3.5); scene.add(rim);
  const fill=new THREE.DirectionalLight(0x9fb6ff, 0.6);
  fill.position.set(-2,-3,2); scene.add(fill);
  const base=new THREE.PointLight(LIME, 6, 8, 2);
  base.position.set(0,-2.4,1.2); scene.add(base);
  scene.add(new THREE.AmbientLight(0x223044, 0.4));

  // ── the can ──
  const can=new THREE.Group();
  scene.add(can);

  // body silhouette via a smooth 2D spline → lathe
  const profilePts=[
    new THREE.Vector2(0.001,-1.42),
    new THREE.Vector2(0.74,-1.42),
    new THREE.Vector2(1.00,-1.20),
    new THREE.Vector2(1.00, 1.02),
    new THREE.Vector2(0.88, 1.30),
    new THREE.Vector2(0.50, 1.44),
    new THREE.Vector2(0.47, 1.56),
    new THREE.Vector2(0.30, 1.60),
    new THREE.Vector2(0.001,1.61),
  ];
  const profile=new THREE.SplineCurve(profilePts).getPoints(90);
  const bodyGeo=new THREE.LatheGeometry(profile, 180);
  const aluminium=new THREE.MeshStandardMaterial({
    color:0xe8ecf0, metalness:1.0, roughness:0.26, envMapIntensity:1.25,
  });
  const body=new THREE.Mesh(bodyGeo, aluminium);
  can.add(body);

  // wrap-around printed label on the straight section
  const label0=makeLabel();
  const labelTex=label0.tex;
  labelTex.anisotropy=renderer.capabilities.getMaxAnisotropy();
  // re-bake the label once the brand webfonts are available
  if(document.fonts && document.fonts.ready){ document.fonts.ready.then(()=>label0.redraw()); }
  const labelGeo=new THREE.CylinderGeometry(1.004,1.004,2.0,180,1,true);
  const labelMat=new THREE.MeshStandardMaterial({
    map:labelTex, metalness:0.18, roughness:0.55, envMapIntensity:0.8,
  });
  const label=new THREE.Mesh(labelGeo, labelMat);
  label.position.y=-0.05;
  can.add(label);

  // thin lime rings top & bottom of the label for a "sealed" detail
  const ringMat=new THREE.MeshStandardMaterial({
    color:LIME, emissive:LIME, emissiveIntensity:1.4, metalness:0.6, roughness:0.3,
  });
  [0.97,-1.07].forEach(yy=>{
    const r=new THREE.Mesh(new THREE.TorusGeometry(1.005,0.012,12,180), ringMat);
    r.rotation.x=Math.PI/2; r.position.y=yy; can.add(r);
  });

  // glowing halo ring behind the can (blooms)
  const halo=new THREE.Mesh(
    new THREE.TorusGeometry(1.7,0.018,16,200),
    new THREE.MeshBasicMaterial({ color:LIME })
  );
  halo.position.z=-1.1; halo.position.y=-0.1; can.add(halo);

  // soft radial glow sprite behind
  const glowTex=(()=>{
    const s=256, cv=document.createElement('canvas'); cv.width=cv.height=s;
    const g=cv.getContext('2d');
    const grad=g.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);
    grad.addColorStop(0,'rgba(198,255,58,0.55)');
    grad.addColorStop(0.4,'rgba(198,255,58,0.18)');
    grad.addColorStop(1,'rgba(198,255,58,0)');
    g.fillStyle=grad; g.fillRect(0,0,s,s);
    const t=new THREE.CanvasTexture(cv); t.colorSpace=THREE.SRGBColorSpace; return t;
  })();
  const glow=new THREE.Sprite(new THREE.SpriteMaterial({
    map:glowTex, blending:THREE.AdditiveBlending, depthWrite:false, transparent:true, opacity:0.9,
  }));
  glow.scale.set(7,7,1); glow.position.z=-1.6;
  can.add(glow);

  // ── drifting particle field for depth ──
  const pCount=reduced?0:520;
  let points=null;
  if(pCount){
    const pos=new Float32Array(pCount*3);
    for(let i=0;i<pCount;i++){
      pos[i*3]  =(Math.random()-0.5)*18;
      pos[i*3+1]=(Math.random()-0.5)*12;
      pos[i*3+2]=(Math.random()-0.5)*10-3;
    }
    const pg=new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos,3));
    points=new THREE.Points(pg, new THREE.PointsMaterial({
      color:0xc6ff3a, size:0.012, transparent:true, opacity:0.5,
      depthWrite:false, blending:THREE.AdditiveBlending,
    }));
    scene.add(points);
  }

  // ── post-processing: subtle bloom on the lime accents ──
  const composer=new EffectComposer(renderer);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, mqCoarse?1.8:2));
  composer.setSize(W,H);
  composer.addPass(new RenderPass(scene,camera));
  const bloom=new UnrealBloomPass(new THREE.Vector2(W,H), 0.6, 0.5, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ── interaction state ──
  let scrollP=0;
  const ptr={x:0,y:0};            // normalised pointer -1..1
  const ptrLerp={x:0,y:0};
  let spin=0;                     // continuous auto-rotation
  let dragVel=0;                  // momentum from drag
  let dragging=false, lastX=0;
  const cur={x:0,y:0,s:1,rx:0};   // smoothed keyframe state

  const isInteractive=(el)=> el && el.closest && el.closest('a,button,input,textarea,select,.terminal,[data-cursor]');

  if(!mqCoarse){
    window.addEventListener('pointermove',(e)=>{
      ptr.x=(e.clientX/window.innerWidth)*2-1;
      ptr.y=(e.clientY/window.innerHeight)*2-1;
      if(dragging){
        const dx=e.clientX-lastX; lastX=e.clientX;
        dragVel=dx*0.006; spin+=dragVel;
      }
    });
    window.addEventListener('pointerdown',(e)=>{
      if(e.button!==0 || isInteractive(e.target)) return;
      dragging=true; lastX=e.clientX; dragVel=0;
      document.body.classList.add('is-dragging');
    });
    window.addEventListener('pointerup',()=>{ dragging=false; document.body.classList.remove('is-dragging'); });
    window.addEventListener('pointercancel',()=>{ dragging=false; });
  }

  // ── render loop ──
  const clock=new THREE.Clock();
  let running=true, frame=0;

  function resize(){
    W=window.innerWidth; H=window.innerHeight;
    camera.aspect=W/H; camera.updateProjectionMatrix();
    renderer.setSize(W,H); composer.setSize(W,H);
  }
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange',()=>{ running=!document.hidden; if(running){ clock.getDelta(); loop(); } });

  function loop(){
    if(!running) return;
    frame=requestAnimationFrame(loop);
    const dt=Math.min(clock.getDelta(),0.05);
    const t=clock.elapsedTime;

    // responsive horizontal travel
    const aspect=W/H;
    const xFactor=THREE.MathUtils.clamp(aspect,0.55,1.5);
    const k=sampleKeys(scrollP);
    cur.x=THREE.MathUtils.lerp(cur.x, k.x*xFactor*1.7, 0.06);
    cur.y=THREE.MathUtils.lerp(cur.y, k.y, 0.06);
    cur.s=THREE.MathUtils.lerp(cur.s, k.s, 0.06);
    cur.rx=THREE.MathUtils.lerp(cur.rx, k.rx, 0.06);

    // pointer smoothing
    ptrLerp.x=THREE.MathUtils.lerp(ptrLerp.x, ptr.x, 0.05);
    ptrLerp.y=THREE.MathUtils.lerp(ptrLerp.y, ptr.y, 0.05);

    // auto-rotate + drag momentum
    if(!reduced){ spin+=dt*0.18; }
    if(!dragging){ spin+=dragVel; dragVel*=0.94; }

    const floatY=reduced?0:Math.sin(t*0.8)*0.06;
    const wobble=reduced?0:Math.sin(t*0.6)*0.02;

    can.position.x=cur.x + ptrLerp.x*0.18;
    can.position.y=cur.y + floatY;
    can.scale.setScalar(cur.s);
    can.rotation.y=spin + ptrLerp.x*0.25;
    can.rotation.x=cur.rx + (-ptrLerp.y*0.16) + wobble;

    if(points){ points.rotation.y+=dt*0.01; points.rotation.x=ptrLerp.y*0.04; }

    // gentle camera parallax
    camera.position.x=THREE.MathUtils.lerp(camera.position.x, ptrLerp.x*0.45, 0.05);
    camera.position.y=THREE.MathUtils.lerp(camera.position.y, -ptrLerp.y*0.32, 0.05);
    camera.lookAt(0, cur.y*0.5, 0);

    // pulse the halo a touch
    const pulse=0.85+Math.sin(t*1.4)*0.12;
    halo.material.color.copy(LIME).multiplyScalar(pulse);

    composer.render();
  }
  loop();

  return {
    setScroll(p){ scrollP=THREE.MathUtils.clamp(p,0,1); },
    resize,
    dispose(){
      running=false; cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      renderer.dispose(); composer.dispose?.(); pmrem.dispose();
    },
  };
}
