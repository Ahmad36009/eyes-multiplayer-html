import {navigation} from './world.js';
// Gameplay values and rules transcribed from the supplied Unity 4 assemblies.
export const difficulties={casual:{bags:12,eyes:2,speed:2.5},normal:{bags:20,eyes:3,speed:3.5},hard:{bags:30,eyes:4,speed:5}};
export const objectives={classic:{name:'Original game',steps:[]}};
export const labels={bag:'Take money bag',eye:'Take eye',key:'Take basement key',code:'Take safe combination',exit:'Leave the house',door:'Open / close',Printer:'Use printer',Gramofon:'Use gramophone',Phone:'Answer phone',Candle:'Extinguish candle',OpenThing:'Open',ShowFullScreen:'Read'};
export const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const shuffle=a=>{a=[...a];for(let i=a.length-1;i;i--){let j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const floor=p=>p[1]<-.5?0:p[1]>2.8?2:1;
export function createGame(world,nav,options={}){
 const mode=['coop','versus'].includes(options.mode)?options.mode:'solo';
 const ghostNav=navigation(world,{ghost:true});
 const difficulty=Object.hasOwn(difficulties,options.difficulty)?options.difficulty:'normal',settings=difficulties[difficulty];
 const bygo=new Map([...world.nodes.values()].map(n=>[n.go,n]));
 const resolve=r=>r&&bygo.get(r.m_PathID);
 const open={},hingeVelocity=new Map(),done={},events=[],players=new Map(),visited=new Set();
 let clock=0;
 let stage='lobby',elapsed=0,bags=0,keyFound=false,winner='',path=[],pathIndex=1,repath=0,target=null,active=false,hunting=false,ending=0;
 let seq=0;const emit=(type,message='',extra={})=>{events.push({seq:seq++,t:elapsed,type,message,...extra});if(events.length>40)events.shift();};
 const ghostNode=[...world.nodes.values()].find(n=>n.name==='girlMain'),ai=ghostNode.behaviours.AIPath;
 const patrolRoot=resolve(ai.parentNode),patrol=[...world.nodes.values()].filter(n=>n.parent===patrolRoot?.id).map(n=>world.xyz(n.id));
 // Original corridor markers. Project straight down, with no lateral navmesh snap.
 const marker=world.nodes.get(Math.random()<.5?2252:1399);
 const [x,y,z]=world.xyz(marker.id);
 const ground=world.floors(x,z,true).find(h=>h<y-.4&&(marker.id===2252?h>2.8:h<-.5));
 if(ground===undefined||world.blocked(x,ground,z,{},.65,false,true))throw Error('Krasue corridor spawn is obstructed.');
 const ghost={p:[x,ground,z],yaw:0,hunting:false};
 const items=[];
 for(const [tag,count] of [[20014,12],[20015,6],[20016,12],[20019,settings.eyes],[20020,settings.eyes],[20021,settings.eyes]])items.push(...shuffle(world.points.filter(p=>p.tag===tag)).slice(0,count));
 items.push(...shuffle(world.points.filter(p=>p.type==='key')).slice(0,1),...world.points.filter(p=>p.type==='code'));
 const exit={id:'exit',type:'exit',p:[world.exit.p[0]+1.48,world.exit.p[1]+.87,world.exit.p[2]]};items.push(exit);
 const printer=[...world.nodes.values()].find(n=>n.behaviours.Printer),printed=resolve(printer?.behaviours.Printer.page);
 if(printed)items.push({id:printed.id,type:'eye',p:world.xyz(printed.id),hidden:true});
 for(const item of items)item.taken=false;
 const lockedNode=[...world.nodes.values()].find(n=>n.behaviours.DoorLockedPavement),locked=resolve(lockedNode?.behaviours.DoorLockedPavement.door);
 const doors=world.doors.filter(n=>world.enabled(n.id)).map(n=>{
  const p=[...world.xyz(n.id)];p[1]+=.83;
  const tris=world.triangles.filter(t=>t[10]===n.id);
  if(tris.length)for(const axis of [0,2])p[axis]=(Math.min(...tris.flatMap(t=>[t[axis],t[axis+3],t[axis+6]]))+Math.max(...tris.flatMap(t=>[t[axis],t[axis+3],t[axis+6]])))/2;
  const q=world.objects.get(n.id).getWorldQuaternion(world.objects.get(n.id).quaternion.clone());
  const normal=[2*(q.x*q.z+q.w*q.y),1-2*(q.x*q.x+q.y*q.y)];
  return {id:n.id,type:'door',p,normal,locked:n.id===locked?.id?'key':n.behaviours.Safe?'code':null,push:!!n.hinge,animation:n.animation?.default};
 });
 const safe=[...world.nodes.values()].find(n=>n.behaviours.Safe),safeBags=Object.values(safe?.behaviours.Safe||{}).map(r=>resolve(r)?.id);
 const props=[...world.nodes.values()].flatMap(n=>{const type=n.scripts.find(s=>['Printer','Gramofon','Phone','Candle','OpenThing','ShowFullScreen'].includes(s));return type?[{id:n.id,type,p:world.xyz(n.id)}]:[];});
 const aud=r=>{if(!r)return '';const f=r.m_FileID?['','sharedassets1.assets','sharedassets2.assets'][r.m_FileID]:'level1';return world.data.audioRefs[f+'_'+r.m_PathID]||'';};
 let printerAt=Infinity;
 function ready(){return bags>=settings.bags;}
 function add(id,name,requestedRole){
  if(stage!=='lobby'||players.size>=(mode==='solo'?1:5))throw Error('Room unavailable.');
  const role=mode==='versus'&&requestedRole==='monster'?'monster':'survivor';
  if(role==='monster'&&[...players.values()].some(p=>p.role==='monster'))throw Error('Krasue slot is taken.');
  players.set(id,{id,name,role,p:[...(role==='monster'?ghost.p:world.spawn)],yaw:-1.305,pitch:0,eyes:0,vision:0,alive:true,energy:100,runTimer:0,walkTimer:0,input:{}});}
 function start(){
  if(stage!=='lobby')return;
  if(mode!=='solo'&&(players.size<2||mode==='versus'&&![...players.values()].some(p=>p.role==='monster')))throw Error('Room needs more players.');
  stage='running';emit('start');}
 function end(result){stage='ending';winner=result;ending=result==='caught'?1.75:.75;emit(result==='caught'?'shout3':'escaped');}
 function interact(p,id,hitPoint){
  if(!Array.isArray(hitPoint)||hitPoint.length!==3||!hitPoint.every(Number.isFinite))hitPoint=null;
  const item=[...items.filter(i=>!i.taken&&!i.hidden),...doors,...props].find(i=>String(i.id)===String(id));
  if(!item)return;
  const point=hitPoint||item.p;
  if(distance([p.p[0],p.p[1]+1.5,p.p[2]],point)>2.65||distance(point,item.p)>1.5)return;
  if(!world.clear([p.p[0],p.p[1]+.75,p.p[2]],[point[0],point[1]-.75,point[2]],{...open,[item.id]:true},.75))return;
  const n=world.nodes.get(item.id);
  if(item.type==='door'){
   if(item.push)return;
   if(item.locked==='key'&&!keyFound)return emit('hint','Locked. Find a key.');
   if(item.locked==='code'&&!done.code)return emit('hint','Locked. Find the combination.');
   open[item.id]=!open[item.id];emit('door','',{id:item.id,clip:aud(n.behaviours.PlayAnimation?.[open[item.id]?'openSounds':'closeSounds']?.[0])});return;
  }
  if(item.type==='exit'){if(ready())end('escaped');else emit('hint',`I can't leave yet. I need to find ${settings.bags-bags} bags more.`);return;}
  if(props.includes(item)){
   if(item.type==='Candle'&&done[item.id])return;
   if(item.type==='Printer'){if(done.printer)return;done.printer=true;printerAt=elapsed+5.5;}
   done[item.id]=!done[item.id];emit('prop','',{id:item.id,prop:item.type,clip:n.audio?.clip});return;
  }
  if(safeBags.includes(item.id)&&!open[safe.id])return;
  if(item.type==='bag'){bags++;emit('takeIt',bags+'/'+settings.bags);}
  if(item.type==='eye'){p.eyes++;emit('eye');}
  if(item.type==='key'){keyFound=true;emit('takeIt','The basement key found.');}
  if(item.type==='code'){done.code=true;emit('takeIt','A safe combination found.');}
  item.taken=true;
 }
 function remove(id,reason="left"){
  const p=players.get(id);players.delete(id);if(p)emit("feed",p.name+(reason==="left"?" left the lobby.":" lost connection."));
  if(stage==='running'&&p?.role==='monster')end('escaped');
  else if(stage==='running'&&players.size&&![...players.values()].some(p=>p.alive&&p.role==='survivor'))end('caught');
 }
 function catchPlayer(p){
  p.alive=false;p.caughtAt=elapsed;emit("feed","Krasue caught "+p.name+".");
  if(![...players.values()].some(p=>p.alive&&p.role==='survivor'))end('caught');
  else emit('shout3','',{player:p.id});
 }
 const history=[];
 function input(id,packet={}){
  const p=players.get(id);if(!p)return;
  const message=typeof packet.chat==='string'?packet.chat.trim().slice(0,160):'';
  if(message&&clock>=(p.nextChat||0)){p.nextChat=clock+.65;emit('chat',p.name+': '+message);}
  if(!p.alive||stage!=='running')return;
  const axis=k=>Number.isFinite(packet[k])?Math.max(-1,Math.min(1,packet[k])):0;
  p.input={x:axis('x'),z:axis('z'),run:packet.run===true};
  if(Number.isFinite(packet.yaw))p.yaw=packet.yaw;
  if(Number.isFinite(packet.pitch))p.pitch=Math.max(-1.35,Math.min(1.35,packet.pitch));
  if(p.role==='monster'){
   if(packet.attack&&elapsed>=(p.nextAttack||0)){p.nextAttack=elapsed+(p.camping?1.8:1);const timestamp=Number.isFinite(packet.seenAt)?Math.max(elapsed-.15,Math.min(elapsed,packet.seenAt)):elapsed;
    const past=history.findLast(h=>h.t<=timestamp);
    const prey=[...players.values()].find(q=>{
      if(q.role!=='survivor'||!q.alive||!world.sight(p.p,q.p,open))return false;
      const previous=past?.positions.get(q.id)||q.p;
      return distance(q.p,p.p)<1.85||distance(previous,p.p)<1.85&&distance(q.p,p.p)<2.65&&world.sight(p.p,previous,open);
    });if(prey)catchPlayer(prey);}
   return;
  }
  if(packet.eye&&p.eyes&&p.vision<=elapsed){p.eyes--;p.vision=elapsed+3;active=true;emit('eye');}
  if(packet.interact!=null&&p.vision<=elapsed)interact(p,packet.interact,packet.hitPoint);
 }
 function tick(dt){
  clock+=dt;
  if(stage==='ending'){ending-=dt;if(ending<=0)stage='ended';return;}
  if(stage!=='running')return;elapsed+=dt;
  history.push({t:elapsed,positions:new Map([...players.values()].map(p=>[p.id,[...p.p]]))});
  while(history.length&&history[0].t<elapsed-.2)history.shift();
  const survivors=[...players.values()].filter(p=>p.alive&&p.role==='survivor');
  if(printerAt<=elapsed){const paper=items.find(i=>i.id===printed?.id);if(paper){paper.hidden=false;emit('print','',{id:paper.id});}printerAt=Infinity;}
  // The angle is integrated from angular velocity. Survivor contact applies a
  // normal impulse at the surface, rather than assigning an opening angle.
  const scale=1.48;
  for(const door of doors.filter(d=>d.push)){
    if(door.locked==='key'&&!keyFound)continue;
    const hinge=world.nodes.get(door.id).hinge;
    const spring=hinge.m_Spring;
    const angle=(open[door.id]||0)*scale;
    let velocity=hingeVelocity.get(door.id)||0;
    const radians=Math.PI/180;
    if(hinge.m_UseSpring){
      velocity+=(-(spring.spring*(angle-spring.targetPosition*radians)+Math.max(spring.damper,2*Math.sqrt(spring.spring))*velocity))*dt;
    }
    for(const player of survivors){
      if(player.vision>elapsed)continue;
      const {x=0,z=0,run}=player.input;
      if(!x&&!z)continue;
      const speed=(run?(player.energy>60?6:player.energy>40?5:player.energy>20?4:3):3)/Math.max(1,Math.hypot(x,z));
      const vx=(Math.cos(player.yaw)*x+Math.sin(player.yaw)*z)*speed;
      const vz=(-Math.sin(player.yaw)*x+Math.cos(player.yaw)*z)*speed;
      const contact=world.doorContact(door.id,player.p,open);
      if(!contact||Math.abs(contact.lever)<.015)continue;
      const closing=contact.lever*velocity-vx*contact.nx-vz*contact.nz;
      if(closing<=0)continue;
      const impulse=closing/(contact.lever**2+.16);
      velocity-=impulse*contact.lever;
      if(!hingeVelocity.has(door.id))emit('door','',{id:door.id});
    }
    if(!angle&&Math.abs(velocity)<.001)continue;
    // Pick the unobstructed portion of the swing if a survivor occupies its path.
    const step=Math.max(-.12,Math.min(.12,velocity*dt));
    const oldContacts=survivors.map(player=>world.doorContact(door.id,player.p,open)?.distance??Infinity);
    const [minAngle,maxAngle]=world.doorSwingLimits(door.id);
    let fraction=1;
    for(;fraction>=1/32;fraction/=2){
      const next=Math.max(minAngle,Math.min(maxAngle,angle+step*fraction));
      open[door.id]=next/scale;
      if(!survivors.some((player,i)=>{
        const gap=world.doorContact(door.id,player.p,open)?.distance??Infinity;
        return gap<.20&&gap<oldContacts[i]-1e-5;
      }))break;
    }
    if(fraction<1/32){open[door.id]=angle/scale;velocity=0;}
    if(Math.abs(open[door.id])<.002&&Math.abs(velocity)<.01){
      delete open[door.id];hingeVelocity.delete(door.id);
    }else{
      const finalAngle=open[door.id]*scale;
      const againstStop=(velocity>0&&finalAngle>=maxAngle-1e-6)||(velocity<0&&finalAngle<=minAngle+1e-6);
      hingeVelocity.set(door.id,againstStop?0:(finalAngle-angle)/dt);
    }
  }
  for(const p of survivors){
  if(p.vision<=elapsed){
   let {x=0,z=0,run}=p.input;const norm=Math.max(1,Math.hypot(x,z));x/=norm;z/=norm;
   let speed=run?(p.energy>60?6:p.energy>40?5:p.energy>20?4:3):3;
   if(run){p.runTimer+=dt;if(p.runTimer>1){p.energy=Math.max(0,p.energy-10);p.runTimer-=1;}}
   else{p.walkTimer+=dt;if(p.walkTimer>1){p.energy=Math.min(100,p.energy+5);p.walkTimer-=1;}}
   if(x||z){
    const lockedDoor=doors.find(d=>d.locked==='key');
    if(lockedDoor&&!keyFound&&!visited.has('locked')&&world.doorContact(lockedDoor.id,p.p,open)){
      visited.add('locked');emit('hint','Locked. Find a key.');
    }
    p.p=world.move(p.p,(Math.cos(p.yaw)*x+Math.sin(p.yaw)*z)*speed*dt,(-Math.sin(p.yaw)*x+Math.cos(p.yaw)*z)*speed*dt,open);
   }
  }
  for(const tr of world.triggerVolumes){
   if(visited.has(tr.id)||!world.contains(tr,p.p))continue;
   const n=world.nodes.get(tr.id),b=n.behaviours;
   if(b.noobActiveGirlCollider){active=true;visited.add(tr.id);}
   const scripts=['Piano','PhoneRing','Lightning','PlaySound','Voices','FadeInOutGirl','TurnOnTv','RatsEating'];
   const kind=scripts.find(k=>n.scripts.includes(k));
   if(kind){visited.add(tr.id);const refs=Object.values(b[kind]||{}).filter(v=>v?.m_PathID);const clip=refs.map(aud).find(Boolean)||n.audio?.clip;emit('trigger','',{id:n.id,kind,clip});}
  }
  }
  if(mode==='versus'){
   const m=[...players.values()].find(p=>p.role==='monster');
   if(m){
    const {x=0,z=0}=m.input,n=Math.max(1,Math.hypot(x,z)),d=settings.speed*dt/n;
    m.p=world.move(m.p,(Math.cos(m.yaw)*x+Math.sin(m.yaw)*z)*d,(-Math.sin(m.yaw)*x+Math.cos(m.yaw)*z)*d,open,false,true);
    // Pressure builds only when a survivor needs an exit that Krasue is guarding.
    const nearExit=q=>Math.abs(q.p[1]-(exit.p[1]-.87))<1.35&&Math.hypot(q.p[0]-exit.p[0],q.p[2]-exit.p[2])<5;
    const guarding=ready()&&nearExit(m);
    const contested=survivors.some(q=>distance(q.p,m.p)<6&&world.sight(m.p,q.p,open));
    m.campPressure=Math.max(0,Math.min(42,(m.campPressure||0)+dt*(guarding&&!contested?1:-3)));
    if(!m.camping&&m.campPressure>=30){
      m.camping=true;
      emit('hint','Move away from the exit to restore your attack speed.',{player:m.id});
    }else if(m.camping&&(!guarding||contested||m.campPressure<15)){
      m.camping=false;
      m.nextAttack=Math.min(m.nextAttack||0,elapsed+1);
    }
    ghost.p=m.p;ghost.yaw=m.yaw;
   }
   return;
  }
  const p=survivors.sort((a,b)=>distance(a.p,ghost.p)-distance(b.p,ghost.p)).find(q=>distance(q.p,ghost.p)<15&&world.sight(ghost.p,q.p,open));
  if(!active||!survivors.length)return;
  const seen=!!p;
  if(seen){target=[...p.p];hunting=true;}
  if(seen&&distance(ghost.p,p.p)<1.85){catchPlayer(p);return;}
  function newPatrol(){
    target=[...(shuffle(patrol)[0]||ghostNav.nodes[0].p)];
    hunting=false;repath=elapsed;
  }
  if(!target)newPatrol();
  if(elapsed>=repath){
    repath=elapsed+(ai.repathRate||.5);
    path=[ghost.p.slice(),...ghostNav.path(ghost.p,target)];
    pathIndex=1;
    if(path.length<2&&!seen)newPatrol();
  }
  if(path.length>1){
    while(pathIndex<path.length-1&&distance(ghost.p,path[pathIndex])<(ai.pickNextWaypointDist||1)){
      // Keep the next segment clear around corners.
      const next=path[pathIndex+1];
      const trial=world.move(ghost.p,next[0]-ghost.p[0],next[2]-ghost.p[2],open,false,true);
      if(distance(trial,next)>.2)break;
      pathIndex++;
    }
    const a=path[pathIndex-1],b=path[pathIndex],v=b.map((x,i)=>x-a[i]);
    const length=Math.hypot(...v);
    let factor=length?Math.max(0,Math.min(1,v.reduce((n,x,i)=>n+x*(ghost.p[i]-a[i]),0)/(length*length))):0;
    const nearest=a.map((x,i)=>x+v[i]*factor);
    factor=length?Math.min(1,factor+Math.max(0,(ai.forwardLook||1)-distance(nearest,ghost.p))/length):0;
    const goal=a.map((x,i)=>x+v[i]*factor),delta=goal.map((x,i)=>x-ghost.p[i]),range=Math.hypot(...delta);
    if(pathIndex===path.length-1&&range<=(ai.endReachedDistance||.5))newPatrol();
    else if(range>1e-6){
      const angle=Math.atan2(delta[0],delta[2]);
      const alignment=(Math.sin(ghost.yaw)*delta[0]+Math.cos(ghost.yaw)*delta[2])/range;
      const slowdown=ai.slowdownDistance>0?Math.min(1,range/ai.slowdownDistance):1;
      const velocity=Math.min((settings.speed+Math.floor(elapsed/240)*.75)*Math.max(.05,alignment)*slowdown,range/(dt*2));
      const dx=Math.sin(ghost.yaw)*velocity*dt,dz=Math.cos(ghost.yaw)*velocity*dt;
      ghost.yaw+=Math.atan2(Math.sin(angle-ghost.yaw),Math.cos(angle-ghost.yaw))*Math.min(1,(ai.turningSpeed||10)*dt);
      ghost.p=world.move(ghost.p,dx,dz,open,false,true);
    }
  }
  ghost.hunting=hunting;
 }
 function snapshot(){return {mode,objective:'classic',difficulty,stage,elapsed,bags,required:settings.bags,winner,ready:ready(),keyFound,open:{...open},done:{...done},ghost:{...ghost},ending,players:[...players.values()].map(({input,...p})=>({...p})),items:items.map(p=>({...p})),doors:[...doors,...props],events:[...events]};}
 return {add,remove,start,input,tick,snapshot};
}
