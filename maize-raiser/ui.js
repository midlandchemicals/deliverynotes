/* ============================================================
   MAIZE RAISER — UI layer (DOM interactions)
   ============================================================ */

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse  = window.matchMedia('(pointer: coarse)').matches;
const lerp = (a,b,t)=>a+(b-a)*t;
const clamp = (v,a,b)=>Math.min(b,Math.max(a,v));

/* ── boot sequence; resolves when "ready" ── */
export function runBoot(onReady){
  const boot=document.getElementById('boot');
  const bar=document.getElementById('bootBar');
  const pct=document.getElementById('bootPct');
  const log=document.getElementById('bootLog');
  const lines=[
    'INITIALISING GROWTH PROTOCOL',
    'MOUNTING NUTRIENT LEDGER',
    'CALIBRATING N·P·K RATIOS',
    'SPINNING UP RENDER ENGINE',
    'BATCH 0001 — VERIFIED',
  ];
  let p=0, li=0;
  const start=performance.now();
  const tick=()=>{
    const elapsed=performance.now()-start;
    // ease toward 100 over ~1.9s, never quite finishing until min time met
    const target = Math.min(100, (elapsed/1900)*100);
    p = lerp(p, target, 0.18);
    const shown=Math.min(99, Math.floor(p));
    if(bar) bar.style.right=(100-p)+'%';
    if(pct) pct.textContent=String(shown).padStart(3,'0');
    const want=Math.min(lines.length-1, Math.floor((shown/100)*lines.length));
    if(want!==li && log){ li=want; log.firstElementChild.textContent=lines[li]; }
    if(elapsed<1900 || p<99){ requestAnimationFrame(tick); }
    else{ finish(); }
  };
  const finish=()=>{
    if(bar) bar.style.right='0%';
    if(pct) pct.textContent='100';
    if(log) log.firstElementChild.textContent='READY';
    setTimeout(()=>{
      document.body.removeAttribute('data-loading');
      document.body.classList.add('is-ready');
      onReady && onReady();
    }, 260);
  };
  if(reduced){ // skip the show
    document.body.removeAttribute('data-loading');
    document.body.classList.add('is-ready');
    if(boot) boot.style.display='none';
    onReady && onReady();
    return;
  }
  requestAnimationFrame(tick);
}

/* ── custom cursor (mouse only) ── */
export function initCursor(){
  if(coarse) return;
  const ring=document.getElementById('cursor');
  const dot=document.getElementById('cursorDot');
  if(!ring||!dot) return;
  let x=innerWidth/2,y=innerHeight/2,rx=x,ry=y;
  addEventListener('pointermove',(e)=>{
    x=e.clientX;y=e.clientY;
    dot.style.transform=`translate(${x}px,${y}px) translate(-50%,-50%)`;
    const t=e.target;
    document.body.classList.toggle('cursor-hover', !!(t&&t.closest&&t.closest('a,button,input,[data-cursor]')));
  });
  addEventListener('pointerdown',()=>document.body.classList.add('cursor-down'));
  addEventListener('pointerup',()=>document.body.classList.remove('cursor-down'));
  (function follow(){
    rx=lerp(rx,x,0.18); ry=lerp(ry,y,0.18);
    ring.style.transform=`translate(${rx}px,${ry}px) translate(-50%,-50%)`;
    requestAnimationFrame(follow);
  })();
}

/* ── HUD readouts: coords, clock, scroll ── */
export function initHud(){
  const coords=document.getElementById('hudCoords');
  const clock=document.getElementById('hudClock');
  if(!coarse && coords){
    addEventListener('pointermove',(e)=>{
      coords.textContent=`X:${String(e.clientX).padStart(3,'0')} Y:${String(e.clientY).padStart(3,'0')}`;
    });
  }
  if(clock){
    const upd=()=>{ const d=new Date();
      clock.textContent=[d.getHours(),d.getMinutes(),d.getSeconds()]
        .map(n=>String(n).padStart(2,'0')).join(':'); };
    upd(); setInterval(upd,1000);
  }
}

/* ── reveal-on-scroll + per-cell spec underline ── */
export function initReveals(){
  const els=document.querySelectorAll('[data-reveal], .spec__cell');
  if(reduced || !('IntersectionObserver' in window)){
    els.forEach(el=>el.classList.add('in')); return;
  }
  const io=new IntersectionObserver((entries)=>{
    entries.forEach(en=>{
      if(en.isIntersecting){
        const d=en.target.getAttribute('data-reveal-delay');
        if(d) en.target.style.transitionDelay=d+'ms';
        en.target.classList.add('in');
        io.unobserve(en.target);
      }
    });
  },{ threshold:0.18, rootMargin:'0px 0px -8% 0px' });
  els.forEach(el=>io.observe(el));
}

/* ── count-up numbers ── */
export function initCounters(){
  const els=document.querySelectorAll('[data-count]');
  const run=(el)=>{
    const end=parseFloat(el.getAttribute('data-count'));
    const dec=parseInt(el.getAttribute('data-decimals')||'0',10);
    const pad=parseInt(el.getAttribute('data-pad')||'0',10);
    const fmt=(v)=>{
      let s = dec>0 ? v.toFixed(dec) : Math.round(v).toLocaleString('en-US');
      if(pad) s=String(Math.round(v)).padStart(pad,'0');
      return s;
    };
    if(reduced){ el.textContent=fmt(end); return; }
    const dur=1400, t0=performance.now();
    const step=(now)=>{
      const t=clamp((now-t0)/dur,0,1);
      const e=1-Math.pow(1-t,3); // ease-out cubic
      el.textContent=fmt(end*e);
      if(t<1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  if(!('IntersectionObserver' in window)){ els.forEach(run); return; }
  const io=new IntersectionObserver((entries)=>{
    entries.forEach(en=>{ if(en.isIntersecting){ run(en.target); io.unobserve(en.target); } });
  },{ threshold:0.5 });
  els.forEach(el=>io.observe(el));
}

/* ── nav: stuck state, mobile menu, active link, smooth scroll ── */
export function initNav(){
  const nav=document.getElementById('nav');
  const burger=document.getElementById('navBurger');
  const links=document.getElementById('navLinks');

  addEventListener('scroll',()=>{
    nav.classList.toggle('is-stuck', scrollY>40);
  },{passive:true});

  if(burger){
    burger.addEventListener('click',()=>nav.classList.toggle('is-open'));
    links?.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>nav.classList.remove('is-open')));
  }

  // active section highlight
  const map=new Map();
  links?.querySelectorAll('a').forEach(a=>{
    const id=a.getAttribute('href');
    if(id&&id.startsWith('#')){ const sec=document.querySelector(id); if(sec) map.set(sec,a); }
  });
  if('IntersectionObserver' in window && map.size){
    const io=new IntersectionObserver((entries)=>{
      entries.forEach(en=>{
        if(en.isIntersecting){
          links.querySelectorAll('a').forEach(a=>a.classList.remove('is-active'));
          map.get(en.target)?.classList.add('is-active');
        }
      });
    },{ threshold:0.4 });
    map.forEach((_,sec)=>io.observe(sec));
  }
}

/* ── magnetic buttons (mouse only) ── */
export function initMagnetic(){
  if(coarse || reduced) return;
  document.querySelectorAll('[data-magnetic]').forEach(el=>{
    const strength=18;
    el.addEventListener('pointermove',(e)=>{
      const r=el.getBoundingClientRect();
      const mx=(e.clientX-(r.left+r.width/2))/r.width;
      const my=(e.clientY-(r.top+r.height/2))/r.height;
      el.style.transform=`translate(${mx*strength}px, ${my*strength}px)`;
    });
    el.addEventListener('pointerleave',()=>{ el.style.transform=''; });
  });
}

/* ── scroll progress → bar + HUD %, and feed the 3D scene ── */
export function initScroll(onProgress){
  const bar=document.getElementById('scrollProgress');
  const hud=document.getElementById('hudScroll');
  let ticking=false;
  const update=()=>{
    const max=document.documentElement.scrollHeight-innerHeight;
    const p=max>0?clamp(scrollY/max,0,1):0;
    if(bar) bar.style.width=(p*100)+'%';
    if(hud) hud.textContent='SCROLL '+String(Math.round(p*100)).padStart(3,'0')+'%';
    onProgress && onProgress(p);
    ticking=false;
  };
  addEventListener('scroll',()=>{ if(!ticking){ ticking=true; requestAnimationFrame(update); } },{passive:true});
  addEventListener('resize',update);
  update();
}

/* ── the drop "mint" form (no backend; simulated) ── */
export function initDropForm(){
  const form=document.getElementById('dropForm');
  const email=document.getElementById('dropEmail');
  const status=document.getElementById('dropStatus');
  if(!form) return;
  form.addEventListener('submit',(e)=>{
    e.preventDefault();
    const v=(email?.value||'').trim();
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)){
      status.textContent='✕ INVALID ADDRESS — TRY AGAIN'; status.style.color='#ff6b5e'; return;
    }
    status.style.color=''; status.textContent='» MINTING ACCESS';
    let dots=0;
    const anim=setInterval(()=>{ dots=(dots+1)%4; status.textContent='» MINTING ACCESS'+'.'.repeat(dots); },220);
    setTimeout(()=>{
      clearInterval(anim);
      const hash='0x'+Array.from({length:6},()=>Math.floor(Math.random()*16).toString(16)).join('').toUpperCase();
      status.textContent=`✓ RESERVED — ALLOCATION ${hash} · CHECK YOUR INBOX`;
      form.reset();
    }, 1400);
  });
}
