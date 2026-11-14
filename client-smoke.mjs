// Structural client test. Rendering is stubbed; this does not validate WebGL pixels.
import fs from 'node:fs';import assert from 'node:assert/strict';
const dir=new URL('./site/js/',import.meta.url), listeners=new Map(), elements=new Map();
const classList={add(){},remove(){},toggle(){}};
function el(id){if(!elements.has(id))elements.set(id,{id,hidden:false,disabled:false,style:{},classList,textContent:'',value:({mode:'solo',difficulty:'normal',objective:'classic',volume:'.65',brightness:'1',sensitivity:'1',role:'survivor'}[id]||''),children:[],get parentElement(){return el(id+'parent');},get firstElementChild(){return el(id+'child');},getContext(){return new Proxy({},{get:()=>()=>{}});},addEventListener(){},removeEventListener(){},setPointerCapture(){},append(){},replaceChildren(){},getBoundingClientRect(){return {left:0,top:0,width:100,height:100};}});return elements.get(id);}
globalThis.document={querySelectorAll:()=>[],querySelector:()=>el("mainActions"),getElementById:el,body:{classList,className:''},addEventListener:(type,f)=>listeners.set(type,f),createElement:()=>el('new'),createElementNS:()=>el('image'),pointerLockElement:null};
globalThis.addEventListener=(t,f)=>listeners.set(t,f);globalThis.matchMedia=()=>({matches:true});globalThis.innerWidth=1280;globalThis.innerHeight=720;globalThis.devicePixelRatio=1;let frame;globalThis.requestAnimationFrame=f=>frame=f;
globalThis.eyesAsset=n=>new URL('../assets/'+n,dir);
globalThis.Audio=class{play(){return Promise.resolve();}pause(){}};
globalThis.fetch=async path=>{const b=fs.readFileSync(new URL(path,dir));return{json:async()=>JSON.parse(b),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.length)};};
fs.writeFileSync(new URL('three-smoke.js',dir),`export * from './three.js';export class WebGLRenderer{constructor(){this.toneMappingExposure=1;}setPixelRatio(){}setSize(){}render(){}}`);
fs.writeFileSync(new URL('client-smoke.js',dir),fs.readFileSync(new URL('client.js',dir),'utf8').replace("import * as T from './three.js'","import * as T from './three-smoke.js'"));
try{
 await import('./site/js/client-smoke.js');await new Promise(r=>setTimeout(r,1000));assert.equal(el('menuStatus').textContent,'');assert(frame);
 el('play').onclick();assert(!el('story').hidden);el('storyContinue').onclick();el('storyContinue').onclick();await new Promise(r=>setTimeout(r,20));
 assert(!el('hud').hidden,el('menuStatus').textContent);frame(performance.now());assert.match(el('counter').textContent,/0 \/ 20 bags/);
 el('pauseButton').onclick();assert(!el('pause').hidden);el('resume').onclick();frame(performance.now());
 el('mapButton').onclick();assert(!el('map').hidden);el('closeMap').onclick();
 el('quit').onclick();assert(!el('menu').hidden);el('play').onclick();el('storyContinue').onclick();el('storyContinue').onclick();await new Promise(r=>setTimeout(r,20));frame(performance.now());assert.match(el('counter').textContent,/0 \/ 20 bags/);
 console.log('PASS client initialization, intro, start, frame update, pause/resume, map, quit and replay (renderer stubbed)');
 process.exitCode=0;
}finally{fs.unlinkSync(new URL('three-smoke.js',dir));fs.unlinkSync(new URL('client-smoke.js',dir));}process.exit(0);
