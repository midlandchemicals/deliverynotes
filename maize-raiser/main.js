/* ============================================================
   MAIZE RAISER — entry point
   Wires the 3D scene to the UI; degrades gracefully w/o WebGL.
   ============================================================ */

import { createScene } from './scene.js';
import {
  runBoot, initCursor, initHud, initReveals, initCounters,
  initNav, initMagnetic, initScroll, initDropForm,
} from './ui.js';

let scene = null;

function init(){
  // chrome + interactions that don't depend on WebGL
  initCursor();
  initHud();
  initNav();
  initMagnetic();
  initDropForm();

  // bring the 3D experience up immediately so it's warm when the boot screen lifts
  const canvas = document.getElementById('scene');
  try{
    scene = createScene(canvas);
  }catch(err){
    console.warn('[mzr] 3D scene failed to start:', err);
    scene = null;
  }
  if(!scene) document.body.classList.add('no-webgl');

  // scroll drives both the progress UI and the can's choreography
  initScroll((p)=>{ scene && scene.setScroll(p); });

  // hold reveals/counters until the boot screen has lifted
  runBoot(()=>{ initReveals(); initCounters(); });
}

init();
