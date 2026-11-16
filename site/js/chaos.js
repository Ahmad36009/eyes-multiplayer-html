const definitions = [
 ['double','Buy One Get One Free','Two random modifiers run together.'],
 ['faster','Get Over Here','Krasue moves 80% faster.'],
 ['drinks','Too Many Drinks','Your view sways continuously.'],
 ['running-bags','Running Out of Money (Literally)','Loose bags run away when you get close.'],
 ['heart','Heart Attack','One random survivor dies at the bell.'],
 ['potato','Hot Potato','Touch another survivor to pass it. The holder dies at the next bell.'],
 ['ninja','Ninja','Krasue makes no sound.'],
 ['lights-out','Lights Out','Flashlights go dark for four seconds out of every six.'],
 ['second-sight','Second Sight','Eye uses are free, but reveal your position.'],
 ['panic','Panic Room','Krasue can pass through her closest doorway at the bell.'],
 ['slam','Slam Shut','Unlocked doors swing shut.'],
 ['draft','Draft Season','Unlocked doors slowly drift open.'],
 ['marked','Marked for Death','Krasue sees survivors through walls for two seconds every ten seconds.'],
 ['no-refunds','No Refunds','Using an Eye turns off your flashlight for five seconds.'],
 ['heavy-pockets','Heavy Pockets','Each bag slows you by 18%, up to 54%.'],
 ['switch','Switcheroo','Two survivors swap places at the bell.'],
 ['red-light','Stop and Go','Move during the red flash and Krasue spots you.'],
 ['double-bag','Double or Nothing','The marked bag counts double and locks the exit until the bell.'],
 ['relay','Relay Race','Wait five seconds after grabbing a bag or let a teammate take the next one.'],
 ['loose-change','Loose Change','Sprint for two seconds and drop one of your collected bags.'],
 ['window','Window Shopping','Loose bags glow. Hold interact for two seconds to grab one.'],
 ['payday','Payday','Three bonus bags appear until the next bell.'],
 ['no-sprint','Dead Legs','You cannot sprint until the next bell.'],
 ['overdrive','Overdrive','Everyone moves faster. Krasue moves fastest.'],
 ['freeze-tag','Freeze Tag','Every seven seconds, survivors freeze in place for 1.5 seconds.'],
 ['tunnel-vision','Tunnel Vision','Your field of view narrows until the next bell.'],
 ['keep-moving','Keep Moving','Stay still for two seconds and Krasue learns where you are.'],
 ['last-call','Last Call','During the last ten seconds, bags count double and Krasue moves faster.'],
 ['one-eye','One in the Chamber','Use one Eye for twice as long. Further uses are disabled until the bell.'],
];
export const chaosModifiers = Object.fromEntries(definitions.map(([id,title,description])=>[id,{title,description}]));
const floor = p => p[1]<-.5?0:p[1]>2.8?2:1;
const pick = list => list[Math.floor(Math.random()*list.length)];
const lethal = new Set(['heart','potato']);
const doorEffects = new Set(['slam','draft','panic']);

export function createChaos(enabled, type, doorwayGroups = [[1546,1924]]) {
 const active = new Set();
 let next=8,start=0,potato=null,passAt=0,selectedDoors=[],markedBag=null,exitLocked=false,revealBag=null,revealUntil=0;
 const has = id => active.has(id);
 function roll(survivors) {
  return Object.keys(chaosModifiers).filter(id=>{
   if(id==='heart')return survivors.length>=2&&Math.random()<.025;
   if(id==='potato')return survivors.length>=2;
   if(['relay','chain','buddy'].includes(id))return type==='coop'&&survivors.length>=2;
   if(id==='switch')return type==='coop'&&survivors.length>=2;
   if(id==='marked')return type==='versus';
   return !has(id);
  });
 }
 function snapshot(elapsed) {
  return enabled?{active:[...active],remaining:Math.max(0,next-elapsed),age:elapsed-start,potato,markedBag,revealBag:revealUntil>elapsed?revealBag:null}:null;
 }
 function tick(ctx) {
  if(!enabled)return;
  let {elapsed,dt,survivors,ghost,doors,open,items,bagCandidates,world,emit,catchPlayer,hingeVelocity}=ctx;
  if(elapsed>=next){
   const holder=survivors.find(p=>p.id===potato);
   if(holder&&survivors.length>1)catchPlayer(holder,'Hot Potato');
   survivors=survivors.filter(p=>p.alive);
   const first=pick(roll(survivors));
   for(const item of items)if(item.chaosBonus&&!item.taken){item.hidden=true;item.chaosBonus=false;}
   active.clear();selectedDoors=[];potato=null;markedBag=null;exitLocked=false;revealBag=null;revealUntil=0;
   start=next;next+=22;
   for(const p of survivors){p.chaosBags=0;p.chaosEyeUsed=false;p.nextChaosBag=0;p.sprintTime=0;p.bagHold=null;p.bagHoldAt=0;p.idleChaos=0;p.chaosPosition=null;}
   if(first==='double'){
    const candidates=roll(survivors).filter(id=>id!=='double');
    const a=pick(candidates);
    const b=pick(candidates.filter(id=>id!==a&&!(lethal.has(a)&&lethal.has(id))&&!(a==='freeze-tag'&&id==='keep-moving'||a==='keep-moving'&&id==='freeze-tag')&&!(a==='no-sprint'&&id==='overdrive'||a==='overdrive'&&id==='no-sprint')&&!(doorEffects.has(a)&&doorEffects.has(id))&&!(a==='second-sight'&&id==='one-eye'||a==='one-eye'&&id==='second-sight')&&!(a==='red-tag'&&id==='double-bag'||a==='double-bag'&&id==='red-tag')));
    active.add(a);if(b)active.add(b);
   }else if(first)active.add(first);
   emit('chaos','',{bundle:first==='double'});
   if(has('red-tag')||has('double-bag'))markedBag=pick(items.filter(item=>item.type==='bag'&&!item.taken&&!item.hidden))?.id??null;
   if(has('heart')&&survivors.length>=2)catchPlayer(pick(survivors),'Heart Attack');
   if(has('potato')){potato=pick(survivors.filter(p=>p.alive))?.id;passAt=elapsed+1;}
   if(has('switch')){
    const a=pick(survivors),b=pick(survivors.filter(p=>p!==a));
    if(a&&b)[a.p,b.p]=[b.p,a.p];
   }
   if(has('payday')){
    const unused=bagCandidates.filter(b=>!items.some(item=>item.id===b.id)||items.some(item=>item.id===b.id&&item.hidden&&item.type==='bag'));
    for(let i=0;i<3&&unused.length;i++){
     const entry=unused.splice(Math.floor(Math.random()*unused.length),1)[0];
     const old=items.find(item=>item.id===entry.id);
     if(old){old.hidden=false;old.chaosBonus=true;}
     else items.push({...entry,p:[...entry.p],chaosBonus:true,taken:false});
    }
   }
   if(has('panic')){
    const nearest=doors.filter(d=>d.push).sort((a,b)=>Math.hypot(...a.p.map((x,i)=>x-ghost.p[i]))-Math.hypot(...b.p.map((x,i)=>x-ghost.p[i])))[0];
    if(nearest)selectedDoors=doorwayGroups.find(group=>group.includes(nearest.id))||[nearest.id];
   }
  }
  if(has('slam')||has('draft')){
   for(const door of doors){
    if(!door.push||door.locked||survivors.some(p=>Math.hypot(...p.p.map((x,i)=>x-door.p[i]))<1.6))continue;
    const old=open[door.id]||0;
    if(has('slam')&&elapsed-start<1){open[door.id]=old*Math.exp(-dt*12);hingeVelocity.delete(door.id);}
    if(has('draft'))open[door.id]=Math.min(.75,old+dt*1.2);
   }
  }
  if(has('potato')&&survivors.length>1){
   const holder=survivors.find(p=>p.alive&&p.id===potato);
   if(!holder){potato=pick(survivors.filter(p=>p.alive))?.id;passAt=elapsed+1;}
   else if(elapsed>=passAt){
    const nextHolder=survivors.find(p=>p!==holder&&p.alive&&Math.hypot(...p.p.map((x,i)=>x-holder.p[i]))<.85);
    if(nextHolder){potato=nextHolder.id;passAt=elapsed+1.5;}
   }
  }
  if(has('keep-moving'))for(const p of survivors){
   const prior=p.chaosPosition;
   p.chaosPosition=[...p.p];
   p.idleChaos=prior&&Math.hypot(p.p[0]-prior[0],p.p[2]-prior[2])<.01?(p.idleChaos||0)+dt:0;
   if(p.idleChaos>=2)p.revealedUntil=elapsed+2;
  }
  if(has('red-light')&&(elapsed-start)%6>=4)for(const p of survivors){
   if(p.alive&&(p.input.x||p.input.z))p.revealedUntil=elapsed+2;
  }
  if(has('running-bags'))for(const item of items){
   if(item.type!=='bag'||item.taken||item.hidden)continue;
   const prey=survivors.find(p=>p.alive&&floor(p.p)===floor(item.p)&&Math.hypot(p.p[0]-item.p[0],p.p[2]-item.p[2])<2.5);
   if(!prey)continue;
   const dx=item.p[0]-prey.p[0],dz=item.p[2]-prey.p[2],len=Math.hypot(dx,dz);
   if(len<.01)continue;
   const moved=world.move([item.p[0],prey.p[1],item.p[2]],dx/len*dt*3,dz/len*dt*3,open);
   if(moved[0]!==item.p[0]||moved[2]!==item.p[2]){
    item.chaosOrigin=true;item.p=[moved[0],item.p[1],moved[2]];
   }
  }
 }
 return {has,tick,snapshot,doors:()=>selectedDoors,
  speed:elapsed=>has('faster')?1.8:has('overdrive')?1.65:has('last-call')&&next-elapsed<=10?1.5:1,
  exitLocked:()=>exitLocked,
  canCollect(p,item,elapsed){
   if(has('relay')&&p.nextChaosBag>elapsed)return false;
   if(!has('window'))return true;
   if(p.bagHold!==item.id||elapsed-p.bagHoldLast>.3){p.bagHold=item.id;p.bagHoldAt=elapsed;}
   p.bagHoldLast=elapsed;
   return elapsed-p.bagHoldAt>=2;
  },
  collect(p,item,elapsed,items){
   if(has('relay'))p.nextChaosBag=elapsed+5;
   if(has('red-tag')&&item.id===markedBag)p.revealedUntil=elapsed+5;
   if(has('chain')){
    revealBag=items.filter(b=>b!==item&&b.type==='bag'&&!b.taken&&!b.hidden)
     .sort((a,b)=>Math.hypot(...a.p.map((x,i)=>x-p.p[i]))-Math.hypot(...b.p.map((x,i)=>x-p.p[i])))[0]?.id??null;
    revealUntil=elapsed+5;
   }
   if(has('double-bag')&&item.id===markedBag){exitLocked=true;return 2;}
   if(has('heavy-pockets'))p.chaosBags=Math.min(3,(p.chaosBags||0)+1);
   return has('last-call')&&next-elapsed<=10?2:1;
  },
  canUseEye:p=>!has('one-eye')||!p.chaosEyeUsed,
  eye(p,elapsed){
   if(has('second-sight'))p.revealedUntil=elapsed+5;
   if(has('no-refunds'))p.flashOffUntil=elapsed+5;
   if(has('one-eye')){p.chaosEyeUsed=true;return 6;}
   return 3;
  },
 };
}
