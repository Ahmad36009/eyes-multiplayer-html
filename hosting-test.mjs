import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import worker from './lobby-server/worker.js';
test('update notice never automatically interrupts a match',async()=>{
 const els=new Map();const el=id=>{if(!els.has(id))els.set(id,{style:{},hidden:false});return els.get(id);};let button,reloads=0;
 const context={URL,AbortSignal,Date,encodeURIComponent,document:{hidden:false,getElementById:el,createElement:()=>button={style:{}},body:{append(){}}},location:{href:'https://example.github.io/eyes/',pathname:'/eyes/',replace(){reloads++;}},fetch:async()=>({ok:true,json:async()=>({version:'new'})}),setInterval(){},addEventListener(){},confirm:()=>false,eyesInMatch:true};
 vm.runInNewContext(fs.readFileSync(new URL('./site/updates.js',import.meta.url),'utf8'),context);await new Promise(r=>setImmediate(r));assert.equal(button.hidden,false);assert.equal(reloads,0);button.onclick();assert.equal(reloads,0);
});
test('directory restricts origin and queries unexpired listings',async()=>{
 const env={ALLOWED_ORIGIN:'https://owner.github.io',DB:{
   prepare(sql){
     assert(sql.includes('expires>?'));
     return {bind(){return {all:async()=>({results:[{body:JSON.stringify({name:'Test',difficulty:'hard'})}]})};}};
   }
 }};
 assert.equal((await worker.fetch(new Request('https://worker/api/lobbies',{headers:{Origin:'https://wrong.example'}}),env)).status,403);
 const response=await worker.fetch(new Request('https://worker/api/lobbies',{headers:{Origin:env.ALLOWED_ORIGIN}}),env);assert.equal(response.status,200);assert.equal((await response.json())[0].difficulty,'hard');
});
test('built manifest resolves every carried-over asset',()=>{const root=new URL('./dist/',import.meta.url);const map=JSON.parse(fs.readFileSync(new URL('asset-map.json',root)));assert.equal(Object.keys(map).length,271);for(const path of Object.values(map))assert(fs.statSync(new URL(path,root)).size<100*1024*1024);});
