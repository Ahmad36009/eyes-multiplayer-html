// Unity legacy curves retain their key times and cubic tangents.
function sample(keys,t,quaternion=false){
 if(!keys.length)return null;
 if(t<=keys[0].time)return Object.values(keys[0].value);
 if(t>=keys.at(-1).time)return Object.values(keys.at(-1).value);
 let hi=1;while(hi<keys.length&&keys[hi].time<t)hi++;
 const a=keys[hi-1],b=keys[hi],dt=b.time-a.time,u=(t-a.time)/dt,u2=u*u,u3=u2*u;
 const av=Object.values(a.value),bv=Object.values(b.value),ao=Object.values(a.outSlope),bi=Object.values(b.inSlope);
 const v=av.map((x,i)=>(2*u3-3*u2+1)*x+(u3-2*u2+u)*dt*ao[i]+(-2*u3+3*u2)*bv[i]+(u3-u2)*dt*bi[i]);
 if(quaternion){const length=Math.hypot(...v);return v.map(x=>x/length);}return v;
}
export function legacyAnimator(data,world){
 const entries=[];
 for(const n of data.nodes){
  const clip=data.animations[n.animation?.default];if(!clip)continue;
  const root=world.objects.get(n.id),tracks=[];
  for(const [group,prop] of [['m_RotationCurves','quaternion'],['m_PositionCurves','position'],['m_ScaleCurves','scale']])for(const curve of clip[group]||[]){
   let object=root;for(const name of curve.path.split('/').filter(Boolean))object=object?.children.find(c=>c.name===name);
   if(object)tracks.push({object,prop,keys:curve.curve.m_Curve});
  }
  let length=Math.max(0,...tracks.flatMap(t=>t.keys.map(k=>k.time)));
  entries.push({id:n.id,tracks,length,time:0,auto:n.animation.auto,door:!!n.behaviours.PlayAnimation,clip:clip.m_Name});
 }
 function update(dt,open,elapsed,done){
  for(const e of entries){
   if(!e.length)continue;
   if(e.door)e.time=Math.max(0,Math.min(e.length,e.time+(open[e.id]?dt:-dt)));
   else if(e.auto)e.time=elapsed%e.length;
   else continue;
   for(const t of e.tracks){const v=sample(t.keys,e.time,t.prop==='quaternion');if(v)t.object[t.prop].fromArray(v);}
  }
 }
 return {update,entries};
}
