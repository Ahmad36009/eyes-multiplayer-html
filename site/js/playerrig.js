import * as T from './three.js';
import {clone} from './skeletonutils.js';
const key=n=>n.replace(/_\d+$/,'');
const Q=(ax,a)=>new T.Quaternion().setFromAxisAngle(ax,a);
// Build rig once: measure model, make procedural clips (idle/walk/run) for the unanimated skeleton.
export function buildRig(gltf,height=1.78){
  const root=gltf.scene;root.updateMatrixWorld(true);
  const bones=new Map(),order=[];
  root.traverse(o=>{if(o.isBone){bones.set(key(o.name),o);order.push(o);}});
  const B=n=>bones.get(n);
  const wp=n=>B(n).getWorldPosition(new T.Vector3());
  const W0=new Map();for(const b of order)W0.set(b,b.getWorldQuaternion(new T.Quaternion()));
  const box=new T.Box3().setFromObject(root,true);
  const size=box.getSize(new T.Vector3());
  const scale=height/size.y;
  const up=new T.Vector3(0,1,0);
  let fwd=wp('toe_L_end').add(wp('toe_R_end')).sub(wp('heel_02_L')).sub(wp('heel_02_R'));
  fwd.y=0;if(fwd.lengthSq()<1e-8)fwd.set(0,0,1);fwd.normalize();
  const side=new T.Vector3().crossVectors(fwd,up).normalize(); // swing axis: +angle swings limbs forward
  // yaw fix so model faces -Z (game forward)
  const yawFix=Math.atan2(-fwd.x,-fwd.z)*-1;
  const arm={};
  for(const s of ['L','R']){
    const d=wp('hand_'+s).sub(wp('arm_'+s+'_upper')).normalize();
    const out=new T.Vector3().copy(d).projectOnVector(side).normalize();
    const target=up.clone().multiplyScalar(-1).addScaledVector(out,.14).normalize();
    arm[s]=new T.Quaternion().setFromUnitVectors(d,target);
  }
  const I=()=>new T.Quaternion();
  // pose function: returns map key -> incremental world rotation
  const pose={
    idle:ph=>{const s=Math.sin(ph*Math.PI*2),c=Math.cos(ph*Math.PI*2);return {
      spine_002:Q(side,-.02*s),spine_003:Q(side,-.03*s),
      arm_L_upper:Q(side,.03*s).multiply(arm.L),arm_R_upper:Q(side,.03*s).multiply(arm.R),
      arm_L_lower:Q(side,.14+.02*s),arm_R_lower:Q(side,.14+.02*s),
      spine_004:Q(up,.03*c)};},
    walk:ph=>gait(ph,.6,1.0,.8,.3,.05,.06,.02),
    run:ph=>gait(ph,.85,1.6,.9,1.25,.2,.12,.05)
  };
  function gait(ph,A,K,B,E,lean,twist,sway){
    const t=ph*Math.PI*2,o={};
    o.spine_001=Q(side,-lean).multiply(Q(up,twist*Math.sin(t)));
    o.spine_003=Q(up,-twist*1.3*Math.sin(t));
    o.spine_004=Q(up,twist*.8*Math.sin(t));
    for(const [s,sg] of [['L',1],['R',-1]]){
      const a=A*sg*Math.sin(t),flex=K*Math.max(0,Math.cos(t*sg+(sg<0?Math.PI:0)))**1.5;
      const q=sg*Math.sin(t);
      o['thigh_'+s]=Q(side,A*q);
      const kn=K*Math.pow(Math.max(0,Math.cos(t)*sg),1.3);
      o['shin_'+s]=Q(side,-kn);
      o['foot_'+s]=Q(side,-(A*q-kn)*.6+.1*Math.max(0,-Math.cos(t)*sg));
      o['arm_'+s+'_upper']=Q(side,-B*A*q*1.1).multiply(arm[s]);
      o['arm_'+s+'_lower']=Q(side,E*(.7+.3*Math.max(0,-q)));
    }
    return o;
  }
  const dur={idle:3,walk:1,run:.6},N={idle:24,walk:24,run:24};
  const clips={};
  for(const name of Object.keys(pose)){
    const tracks=new Map();
    for(let i=0;i<=N[name];i++){
      const ph=(i%N[name])/N[name],inc=pose[name](ph);
      const Rd=new Map();
      for(const b of order){
        const r=(inc[key(b.name)]||I()).clone();
        const parent=b.parent&&Rd.get(b.parent);
        const rd=parent?r.multiply(parent):r;
        Rd.set(b,rd);
        const Wd=rd.clone().multiply(W0.get(b));
        const Pd=b.parent&&b.parent.isBone?Rd.get(b.parent).clone().multiply(W0.get(b.parent)):b.parent?b.parent.getWorldQuaternion(new T.Quaternion()):I();
        const local=Pd.invert().multiply(Wd);
        if(!tracks.has(b))tracks.set(b,{t:[],v:[]});
        const tr=tracks.get(b);tr.t.push(i/N[name]*dur[name]);tr.v.push(local.x,local.y,local.z,local.w);
      }
    }
    const list=[];
    for(const [b,tr] of tracks){
      let moved=false;for(let i=4;i<tr.v.length;i++)if(Math.abs(tr.v[i]-tr.v[i%4])>1e-5){moved=true;break;}
      const rest=b.quaternion;
      const differs=Math.abs(tr.v[0]-rest.x)+Math.abs(tr.v[1]-rest.y)+Math.abs(tr.v[2]-rest.z)+Math.abs(tr.v[3]-rest.w)>1e-5;
      if(moved||differs)list.push(new T.QuaternionKeyframeTrack(b.name+'.quaternion',tr.t,tr.v));
    }
    clips[name]=new T.AnimationClip(name,dur[name],list);
  }
  return {scene:root,clips,scale,yawFix,box,size,fwd,side,height};
}
// Instance one player. Feet at y=0, facing -Z at yaw 0.
export function spawnPlayer(rig){
  const model=clone(rig.scene),holder=new T.Group(),inner=new T.Group();
  model.traverse(o=>{
    if(o.isMesh){
      o.frustumCulled=false;
      const old=o.material;
      o.material=new T.MeshLambertMaterial({map:old.map||null,color:old.map?0xffffff:0x8a7d6a,side:T.DoubleSide});
    }
  });
  inner.add(model);
  inner.scale.setScalar(rig.scale);
  inner.rotation.y=rig.yawFix;
  holder.add(inner);
  model.updateMatrixWorld(true);
  const b=new T.Box3().setFromObject(model,true);
  const c=b.getCenter(new T.Vector3());
  // after scale/rot of inner: shift so feet at 0 and centred
  const off=new T.Vector3(c.x,b.min.y,c.z).multiplyScalar(rig.scale).applyAxisAngle(new T.Vector3(0,1,0),rig.yawFix);
  inner.position.set(-off.x,-off.y,-off.z);
  const mixer=new T.AnimationMixer(model),act={};
  for(const k of Object.keys(rig.clips)){act[k]=mixer.clipAction(rig.clips[k]);act[k].play();act[k].setEffectiveWeight(k==='idle'?1:0);}
  holder.userData.anim={mixer,act,cur:'idle',speed:0};
  return holder;
}
// speed in m/s, dt in s
export function animatePlayer(holder,dt,speed){
  const a=holder.userData.anim;if(!a)return;
  a.speed+=(speed-a.speed)*(1-Math.exp(-dt*10));
  const s=a.speed,want=s<.35?'idle':s<4.2?'walk':'run';
  const blend=1-Math.exp(-dt*12);
  for(const k of Object.keys(a.act)){
    const act=a.act[k],w=act.getEffectiveWeight(),target=k===want?1:0;
    act.setEffectiveWeight(w+(target-w)*blend);
  }
  a.act.walk.setEffectiveTimeScale(Math.max(.6,s/2.1));
  a.act.run.setEffectiveTimeScale(Math.max(.7,s/4.7));
  a.act.idle.setEffectiveTimeScale(1);
  a.mixer.update(dt);
}
