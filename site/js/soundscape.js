import {Euler,Quaternion} from './three.js';
export const floorOf=p=>p[1]<-.5?0:p[1]>2.8?2:1;
export function soundscape(data,world,volume){
 let context,paused=false,listener=world.spawn,yaw=0,lastStep=0,lastTime=0,voices=new Map(),serial=0,silenceAmbience=false;
 const byGo=new Map(data.nodes.map(n=>[n.go,n]));
 const clip=r=>!r?'':r.m_FileID===0?data.audioSources?.[r.m_PathID]?.clip||'':data.audioRefs?.[(['','sharedassets1.assets','sharedassets2.assets'][r.m_FileID])+'_'+r.m_PathID]||'';
 const source=r=>data.audioSources?.[r?.m_PathID];
 function stop(slot){const v=voices.get(slot);if(v){v.audio.pause();v.source?.disconnect();v.pan?.disconnect();voices.delete(slot);}}
 function clear({keepScare=false}={}){for(const k of [...voices.keys()])if(!keepScare||k!=='legacy-scare')stop(k);}
 function play(name,options={}){
  const file=name==='pc-krasue-scare'?'krasue-pc-jumpscare.ogg':name==='legacy-krasue-scare'?'shout3.ogg':data.sounds[name];
  if(!file)return null;
  const slot=options.slot||'oneshot-'+serial++;stop(slot);
  const audio=new Audio(globalThis.eyesAsset(file));audio.loop=!!options.loop;audio.playbackRate=options.pitch||1;
  const v={audio,name,options,slot,wasPlaying:true};voices.set(slot,v);
  try{const AC=globalThis.AudioContext||globalThis.webkitAudioContext;if(AC){context??=new AC();context.resume();v.source=context.createMediaElementSource(audio);v.pan=context.createStereoPanner();v.source.connect(v.pan);v.pan.connect(context.destination);}}catch{}
  audio.onended=()=>stop(slot);adjust(v);audio.play().catch(()=>{});return audio;
 }
 function adjust(v){
  const o=v.options;let gain=silenceAmbience&&o.ambient?0:(o.volume??1);
  if(o.p){const dx=o.p[0]-listener[0],dz=o.p[2]-listener[2],d=Math.hypot(dx,dz,o.p[1]-listener[1]),min=o.min??1,max=o.max??15;gain*=d>=max?0:Math.min(1,min/Math.max(min,d));if(v.pan)v.pan.pan.value=Math.max(-1,Math.min(1,(Math.cos(yaw)*dx-Math.sin(yaw)*dz)/(Math.hypot(dx,dz)||1)));}
  v.audio.volume=Math.max(0,Math.min(1,volume()*gain));
 }
 function playSource(ref,options={}){const a=source(ref);if(!a)return null;return play(options.clip||a.clip,{volume:a.volume,pitch:a.pitch,loop:a.loop,p:world.xyz(a.node),min:a.min,max:a.max,slot:'source-'+ref.m_PathID,...options});}
 const shakers=data.nodes.filter(n=>n.scripts.includes('StrangeThing')).map(n=>({n,next:Math.random(),until:0,amplitude:0,base:new Quaternion(...n.q)}));
 const tvs=data.nodes.filter(n=>n.scripts.includes('TurnOnTv'));
 const foot=data.nodes.find(n=>n.name==='player').behaviours.FootSteps;
 const ai=data.nodes.find(n=>n.name==='girlMain').behaviours.AIPath;
 function start(){clear();silenceAmbience=false;pending.length=0;lightningUntil=0;lastStep=0;lastTime=0;paused=false;for(const s of shakers){s.next=Math.random();s.until=0;}
  for(const [id,a] of Object.entries(data.audioSources))if(a.auto&&a.clip&&!['wind','mmm'].includes(a.clip)&&world.enabled(a.node)&&a.node!==data.markers.girlMain[0])playSource({m_PathID:id},{ambient:true});
 }
 function event(e,state){
  if(e.type==='door'){
   const n=world.nodes.get(e.id);let p=n;while(p&&!p.behaviours.DoorSound)p=world.nodes.get(p.parent);
   const refs=p?.behaviours.DoorSound?.sounds;play(e.clip||(refs?.length?clip(refs[Math.floor(Math.random()*refs.length)]):p?.audio?.clip)||'door1',{p:world.xyz(e.id),volume:p?.audio?.volume??.5,max:p?.audio?.max??6});
  }else if(e.type==='prop'){
   const n=world.nodes.get(e.id),on=state.done[e.id];
   if(e.prop==='Gramofon'){if(!on)stop('gramophone');else play(n.audio.clip,{slot:'gramophone',ambient:true,volume:n.audio.volume,p:world.xyz(e.id),max:n.audio.max,loop:true});}
   else if(e.clip)play(e.clip,{p:world.xyz(e.id),slot:'prop-'+e.id});
   if(e.prop==='Candle'){const halo=byGo.get(n.behaviours.Candle.halo?.m_PathID);if(halo)world.objects.get(halo.id).visible=false;}
  }else if(e.type==='trigger'){
   const n=world.nodes.get(e.id),b=n.behaviours[e.kind]||{};
   if(e.kind==='Lightning'){
    const refs=b.lightnings||[];if(refs[0])playSource(refs[0],{ambient:true});if(refs[1])pending.push({at:state.elapsed+1.22,ref:refs[1]});lightningUntil=state.elapsed+1.5;
   }else if(e.clip)play(e.clip,{p:world.xyz(e.id),slot:'trigger-'+e.id,ambient:true,volume:n.audio?.volume??1,max:n.audio?.max??15});
  }else if(e.type==='shout3'){if(state.chaos?.active.includes('ninja'))return;clear();if(state.difficulty==='scary')play('pc-krasue-scare',{slot:'scary-scare'});else play('legacy-krasue-scare',{slot:'legacy-scare'});}
  else if(e.type==='escaped'){clear();play('mmmEnd');}
  else if(data.sounds[e.type])play(e.type,{ui:true});
 }
 const pending=[];let lightningUntil=0;
 function update(state,player,dt,playing,moving){
  listener=player.p;yaw=player.yaw;
  const scary=state.difficulty==='scary';
  const same=!state.chaos?.active.includes('ninja')&&floorOf(player.p)===floorOf(state.ghost.p);
  silenceAmbience=scary;
  if(scary)for(const shaker of shakers){
   world.objects.get(shaker.n.id).quaternion.copy(shaker.base);
   stop('shake-'+shaker.n.id);
  }
  if(paused===playing){paused=!playing;for(const v of voices.values()){if(v.slot==='scary-scare'||v.slot==='legacy-scare')continue;if(paused)v.audio.pause();else v.audio.play().catch(()=>{});}}
  for(const v of voices.values())adjust(v);
  if(!playing)return;
  if(state.stage!=='running'){for(const k of ['krasue-breath','krasue-hum','house-wind','stamina-breath','footstep'])stop(k);return;}
  const time=state.elapsed,near=same&&Math.hypot(...player.p.map((x,i)=>x-state.ghost.p[i]))<15;
  function loop(ref,on,slot){if(on&&!voices.has(slot))playSource(ref,{slot,p:null});else if(!on)stop(slot);}
  loop(ai.breath,!scary&&near,'krasue-breath');loop(ai.mmm,!scary&&same,'krasue-hum');
  if(!scary&&!same&&!voices.has('house-wind'))play('wind',{slot:'house-wind',loop:true,volume:.65});
  if(same||scary)stop('house-wind');loop(foot.hBreathing,player.energy<50,'stamina-breath');
  const running=player.energy>0&&moving.run,interval=running?foot.runAudioSpeed:foot.walkAudioSpeed;
  if(moving.active&&player.vision<=time&&time-lastStep>=interval){lastStep=time;const list=running?foot.runSteps:foot.walkSteps;playSource(foot.steps,{clip:clip(list[Math.floor(Math.random()*list.length)]),p:null,slot:'footstep'});}
  for(const s of shakers){
   const inFloor=!scary&&same&&floorOf(world.xyz(s.n.id))===floorOf(state.ghost.p);
   const object=world.objects.get(s.n.id);
   if(!inFloor){object.quaternion.copy(s.base);s.until=0;s.next=time+.5;continue;}
   if(time>=s.next){const duration=1.5+Math.random()*.75;s.amplitude=(near?15:5)*Math.PI/180;s.until=time+duration;s.next=s.until+.2+Math.random()*.5;
    const b=s.n.behaviours.StrangeThing,list=near?b.soundsClose:b.soundsFar;if(list?.length)playSource(b.strangeSound,{clip:clip(list[Math.floor(Math.random()*list.length)]),slot:'shake-'+s.n.id});
   }
   if(time<s.until){const fade=Math.min(1,(s.until-time)/.35),phase=s.n.id*.738;object.quaternion.copy(s.base).multiply(new Quaternion().setFromEuler(new Euler(Math.sin(time*45+phase)*s.amplitude*fade,Math.sin(time*53+phase)*s.amplitude*fade,Math.sin(time*41+phase)*s.amplitude*fade)));}else object.quaternion.copy(s.base);
  }
  for(const n of tvs){const screen=byGo.get(n.behaviours.TurnOnTv.screen?.m_PathID);if(!screen)continue;const on=!scary&&near&&floorOf(world.xyz(n.id))===floorOf(state.ghost.p)&&time%3<1.7&&Math.sin(time*17)>-.5;world.objects.get(screen.id).visible=on;if(on&&!voices.has('tv-'+n.id))play(screen.audio?.clip||'static',{slot:'tv-'+n.id,p:world.xyz(n.id),max:3});if(!on)stop('tv-'+n.id);}
  for(let i=pending.length-1;i>=0;i--)if(pending[i].at<=time){playSource(pending[i].ref,{ambient:true});pending.splice(i,1);}
  lastTime=time;
 }
 return {play,start,event,update,clear,clip,shakers,flash:time=>time<lightningUntil&&Math.sin(time*50)>.1};
}



