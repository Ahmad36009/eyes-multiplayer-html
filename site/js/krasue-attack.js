import {Quaternion} from './three.js';
import {attackTracks} from './krasue-attack-data.js';

// The modern SimpleAttackStrategy starts the attack and then waits 2 s
// before starting its death effect. Attack2 has 60 samples at 30 Hz.


export function bindKrasueAttack(world){
 const q=new Quaternion();
 const tracks=attackTracks.map(([id,kind,values])=>{
  const joint=world.objects.get(id);
  if(!joint)throw Error('Krasue Attack2 joint missing: '+id);
  return {joint,kind,values};
 });
 let saved=null;
 return {
  reset(){
   if(!saved)return;
   for(const [joint,p,r,s] of saved){joint.position.copy(p);joint.quaternion.copy(r);joint.scale.copy(s);}
   saved=null;
  },
  update(seconds){
   if(!saved)saved=[...new Set(tracks.map(track=>track.joint))].map(joint=>[joint,joint.position.clone(),joint.quaternion.clone(),joint.scale.clone()]);
   const frame=Math.min(59,Math.max(0,seconds*30));
   const first=Math.floor(frame),second=Math.min(59,first+1),blend=frame-first;
   for(const {joint,kind,values} of tracks){
    if(kind===2){
     joint.quaternion.fromArray(values,first*4).slerp(q.fromArray(values,second*4),blend);
    }else{
     const a=first*3,b=second*3;
     const channel=kind===1?joint.position:joint.scale;
     channel.set(
      values[a]+(values[b]-values[a])*blend,
      values[a+1]+(values[b+1]-values[a+1])*blend,
      values[a+2]+(values[b+2]-values[a+2])*blend,
     );
    }
   }
  }
 };
}
