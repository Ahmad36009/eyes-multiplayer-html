const krasueAllowedDoors=new Set([1262,1267,1578,1608,1806]);
import {Object3D,Bone,Vector3,Matrix4,BoxGeometry} from './three.js';

export function buildWorld(data, bytes) {
  const nodes=new Map(data.nodes.map(n=>[n.id,n]));
  const objects=new Map(data.nodes.map(n=>{
    const o=new Bone();o.name=n.name;
    o.position.fromArray(n.p);o.quaternion.fromArray(n.q).normalize();o.scale.fromArray(n.s);
    return [n.id,o];
  }));
  const root=new Object3D();
  for(const n of data.nodes)(objects.get(n.parent)||root).add(objects.get(n.id));
  root.updateMatrixWorld(true);
  const positions=new Map([...objects].map(([id,o])=>[id,o.getWorldPosition(new Vector3()).toArray()]));
  const xyz=id=>[...positions.get(id)];
  const enabled=id=>{for(let n=nodes.get(id);n;n=nodes.get(n.parent))if(!n.active)return false;return true;};
  const doors=data.nodes.filter(n=>n.scripts.some(s=>['Door','Safe','PlayAnimation'].includes(s)) || n.name==='simple_door_active'&&enabled(n.id));
  const doorIds=new Set(doors.map(n=>n.id));
  const exit=data.nodes.find(n=>n.scripts.includes('QuitHouse'));
  const pickupTypes={TakeIt:'bag',Eye:'eye',DoorLocked:'key',SafeCombination:'code'};
  const points=data.nodes.flatMap(n=>{
    const type=n.scripts.map(s=>pickupTypes[s]).find(Boolean);
    let p=xyz(n.id);
    if(type&&data.meshes[n.mesh]?.p){
      const v=new Float32Array(bytes,...data.meshes[n.mesh].p),lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
      const raw=data.meshes[n.mesh],parts=n.subset?.length?n.subset.map(i=>raw.parts[i]):raw.parts;
      for(const part of parts)for(const index of new Uint32Array(bytes,...part))for(let a=0;a<3;a++){lo[a]=Math.min(lo[a],v[index*3+a]);hi[a]=Math.max(hi[a],v[index*3+a]);}
      p=new Vector3(...lo.map((v,i)=>(v+hi[i])/2)).applyMatrix4(objects.get(n.id).matrixWorld).toArray();
    }
    return type?[{id:n.id,type,tag:n.tag,p}]:[];
  });
  const bins=new Map();
  const cell=2;
  const cellKey=(x,z)=>x+','+z;
  const triangles=[];
  const a=new Vector3(),b=new Vector3(),c=new Vector3(), normal=new Vector3();
  function tri(positions,i,j,k,m,door,layer,kind,id){
    a.fromArray(positions,i*3).applyMatrix4(m);b.fromArray(positions,j*3).applyMatrix4(m);c.fromArray(positions,k*3).applyMatrix4(m);
    normal.crossVectors(b.clone().sub(a),c.clone().sub(a)).normalize();
    if(normal.lengthSq()<.1)return;
    const t=[...a,...b,...c,normal.y,door,layer,kind,id];
    triangles.push(t);
    for(let x=Math.floor(Math.min(a.x,b.x,c.x)/cell);x<=Math.floor(Math.max(a.x,b.x,c.x)/cell);x++)
      for(let z=Math.floor(Math.min(a.z,b.z,c.z)/cell);z<=Math.floor(Math.max(a.z,b.z,c.z)/cell);z++){
        const key=cellKey(x,z);
        if(!bins.has(key))bins.set(key,[]);
        bins.get(key).push(t);
      }
  }
  const box=new BoxGeometry(1,1,1);
  const dynamicIds=new Set(points.map(p=>p.id));
  function ancestor(id,predicate){
    for(let n=nodes.get(id);n;n=nodes.get(n.parent))if(predicate(n))return n.id;
    return 0;
  }
  for(const co of data.colliders){
    if(!enabled(co.id)||ancestor(co.id,n=>dynamicIds.has(n.id)||['rat','girlMain','player'].includes(n.name)||/mapcollider|collidermap/i.test(n.name)))continue;
    const n=nodes.get(co.id);
    if(n.layer===5||n.layer===8)continue;
    const door=ancestor(co.id,n=>doorIds.has(n.id));
    const m=objects.get(co.id).matrixWorld;
    const electrical=!!ancestor(co.id,n=>n.name==='powerbox_large_02');
    const structural=/^(corridor|room_|junction_|wall_|E0[124]_.*(?:wall|window|column|vault)|CS_for_collider|SS_ground_level|steps$|collider_stairs|escalerab|E01_stairs|diningRoom$|smallRoom$|colliderodoffice)/i.test(n.name);
    const kind=electrical?2:structural?1:0;
    if(co.size){
      const local=new Matrix4().makeScale(...co.size).setPosition(...co.center);
      const matrix=m.clone().multiply(local);
      const i=box.index.array,p=box.attributes.position.array;
      for(let j=0;j<i.length;j+=3)tri(p,i[j],i[j+1],i[j+2],matrix,door,n.layer,kind,co.id);
    }else if(data.meshes[co.mesh]?.p){
      const mesh=data.meshes[co.mesh],p=new Float32Array(bytes,...mesh.p);
      for(const part of mesh.parts){
        const i=new Uint32Array(bytes,...part);
        for(let j=0;j<i.length;j+=3)tri(p,i[j],i[j+1],i[j+2],m,door,n.layer,kind,co.id);
      }
    }
  }
  const hinges=new Map(doors.filter(n=>n.hinge).map(n=>[n.id,xyz(n.id)]));
  const panels=triangles.filter(t=>hinges.has(t[10]));
  function nearby(x,z,r,open){
    const result=[...around(x,z,r)].filter(t=>!hinges.has(t[10])||!open[t[10]]);
    for(const t of panels){
      const angle=open[t[10]];
      if(!angle)continue;
      const [px,,pz]=hinges.get(t[10]);
      if(Math.hypot(x-px,z-pz)>r+2)continue;
      const c=Math.cos(angle*1.48),s=Math.sin(angle*1.48),rotated=t.slice();
      for(let i=0;i<9;i+=3){
        const dx=t[i]-px,dz=t[i+2]-pz;
        rotated[i]=px+c*dx+s*dz;
        rotated[i+2]=pz-s*dx+c*dz;
      }
      result.push(rotated);
    }
    return result;
  }
  function around(x,z,r=0){
    if(!r)return bins.get(cellKey(Math.floor(x/cell),Math.floor(z/cell)))||[];
    const found=new Set();
    for(let i=Math.floor((x-r)/cell);i<=Math.floor((x+r)/cell);i++)
      for(let j=Math.floor((z-r)/cell);j<=Math.floor((z+r)/cell);j++)
        for(const t of bins.get(cellKey(i,j))||[])found.add(t);
    return found;
  }
  function floors(x,z,ghost=false){
    const heights=[];
    for(const [ax,ay,az,bx,by,bz,cx,cy,cz,ny,door,layer,kind] of around(x,z)){
      if(door||ny<.24||ghost&&kind!==1)continue;
      const v=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);
      if(Math.abs(v)<1e-8)continue;
      const u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/v;
      const w=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/v;
      if(u>=-1e-5&&w>=-1e-5&&1-u-w>=-1e-5)heights.push(u*ay+w*by+(1-u-w)*cy);
    }
    return heights.sort((a,b)=>b-a).filter((h,i,all)=>!i||all[i-1]-h>.08);
  }
  function section(t,y){
    const hits=[];
    for(let i=0;i<9;i+=3){
      const j=(i+3)%9, d=t[j+1]-t[i+1];
      if(Math.abs(d)<1e-7)continue;
      const k=(y-t[i+1])/d;
      if(k>=0&&k<=1)hits.push([t[i]+k*(t[j]-t[i]),t[i+2]+k*(t[j+2]-t[i+2])]);
    }
    if(hits.length<2)return null;
    return [...hits[0],...hits.at(-1)];
  }
  // Nearest point on the actual door collider at character body height.
  function doorHitsWall(id,open,previous=0){
    const angle=(open[id]||0)*1.48;
    if(Math.abs(angle)<.01)return false;
    const [hx,,hz]=hinges.get(id);
    const c=Math.cos(angle),s=Math.sin(angle);
    const pc=Math.cos(previous),ps=Math.sin(previous);
    for(const t of panels){
      if(t[10]!==id||Math.abs(t[9])>.73)continue;
      for(let i=0;i<9;i+=3){
        const dx=t[i]-hx,dz=t[i+2]-hz;
        // Ignore the jamb immediately beside the hinge.
        if(Math.hypot(dx,dz)<.3)continue;
        const x=hx+c*dx+s*dz,z=hz-s*dx+c*dz;
        for(const wall of around(x,z,.045)){
          if(wall[10]||wall[12]!==1||Math.abs(wall[9])>.73)continue;
          const edge=section(wall,t[i+1]);if(!edge)continue;
          const [ax,az,bx,bz]=edge, vx=bx-ax,vz=bz-az;
          const u=Math.max(0,Math.min(1,((x-ax)*vx+(z-az)*vz)/(vx*vx+vz*vz||1)));
          const px=hx+pc*dx+ps*dz,pz=hz-ps*dx+pc*dz;
          const oldU=Math.max(0,Math.min(1,((px-ax)*vx+(pz-az)*vz)/(vx*vx+vz*vz||1)));
          const before=Math.hypot(px-ax-oldU*vx,pz-az-oldU*vz);
          if(before>=.04&&Math.hypot(x-ax-u*vx,z-az-u*vz)<.04)return true;
        }
      }
    }
    return false;
  }
  const swingLimits=new Map();
  function doorSwingLimits(id){
    if(!swingLimits.has(id)){
      const sweep=direction=>{
        let previous=0;
        for(let i=1;i<=45;i++){
          const angle=direction*i*Math.PI/90;
          if(doorHitsWall(id,{[id]:angle/1.48},previous))break;
          previous=angle;
        }
        return previous;
      };
      swingLimits.set(id,[sweep(-1),sweep(1)]);
    }
    return swingLimits.get(id);
  }
  function doorContact(id, position, open) {
    const [x,y,z]=position;
    const [hx,,hz]=hinges.get(id);
    if(Math.hypot(x-hx,z-hz)>2.5)return null;
    let contact=null;
    for(const triangle of nearby(x,z,.35,open)){
      if(triangle[10]!==id||Math.abs(triangle[9])>.73)continue;
      for(const height of [.48,1.12]){
        const edge=section(triangle,y+height);
        if(!edge)continue;
        const [ax,az,bx,bz]=edge,dx=bx-ax,dz=bz-az;
        const t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz||1)));
        const px=ax+t*dx,pz=az+t*dz,distance=Math.hypot(x-px,z-pz);
        if(distance<1e-7||distance>.36||contact&&distance>=contact.distance)continue;
        const nx=(x-px)/distance,nz=(z-pz)/distance;
        contact={distance,nx,nz,lever:(pz-hz)*nx-(px-hx)*nz};
      }
    }
    return contact;
  }

  function blocked(x,y,z,open,r=.21,ignoreDoors=false,ghost=false,onlyDoor=0){
    for(const t of ghost?around(x,z,r):nearby(x,z,r,open)){
      if(onlyDoor&&t[10]!==onlyDoor)continue;
      if(ghost&&t[10]&&krasueAllowedDoors.has(t[10]))continue;
      if(ghost&&!t[12]&&!t[10])continue;
      if(Math.abs(t[9])>.73 || t[10]&&(ignoreDoors||!ghost&&open[t[10]]&&!hinges.has(t[10])))continue;
      for(const h of [.48,1.12]){
        const s=section(t,y+h);
        if(!s)continue;
        const [ax,az,bx,bz]=s, dx=bx-ax,dz=bz-az;
        const k=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz||1)));
        if((x-ax-k*dx)**2+(z-az-k*dz)**2<r*r)return true;
      }
    }
    return false;
  }
  function move(p,dx,dz,open,ignoreDoors=false,ghost=false){
    let [x,y,z]=p;
    function attempt(nx,nz){
      const heights=floors(nx,nz,ghost);
      const ny=heights.find(h=>h<=y+.40&&h>=y-.72);
      if(ny==null||blocked(nx,ny,nz,open,.20,ignoreDoors,ghost))return false;
      x=nx;y=ny;z=nz;return true;
    }
    const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.075));
    for(let i=0;i<steps;i++){
      if(!attempt(x+dx/steps,z+dz/steps)){
        attempt(x+dx/steps,z);attempt(x,z+dz/steps);
      }
    }
    return [x,y,z];
  }
  function clear(a,b,open,height=.8){
    const dist=Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
    const steps=Math.ceil(dist/.12);
    for(let i=1;i<steps-2;i++){
      const k=i/steps,x=a[0]+(b[0]-a[0])*k,y=a[1]+(b[1]-a[1])*k+height,z=a[2]+(b[2]-a[2])*k;
      for(const t of nearby(x,z,.075,open)){
        if(t[11]===2||Math.abs(t[9])>.73||t[10]&&open[t[10]]&&!hinges.has(t[10]))continue;
        const s=section(t,y);
        if(!s)continue;
        const [ax,az,bx,bz]=s,dx=bx-ax,dz=bz-az;
        const h=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz||1)));
        if((x-ax-h*dx)**2+(z-az-h*dz)**2<.075**2)return false;
      }
    }
    return true;
  }
  // Exact segment/triangle occlusion. Unlike the interaction query this includes
  // ceilings, floors and layer-2 structural meshes; there is no endpoint blind spot.
  function sight(a,b,open={}){
    const origin=new Vector3(a[0],a[1]+1.5,a[2]),end=new Vector3(b[0],b[1]+1.5,b[2]);
    const direction=end.clone().sub(origin),length=direction.length();if(length<1e-6)return true;direction.divideScalar(length);
    const tested=new Set(),edge1=new Vector3(),edge2=new Vector3(),pv=new Vector3(),tv=new Vector3(),qv=new Vector3();
    const steps=Math.max(1,Math.ceil(length/cell));
    for(let i=0;i<=steps;i++)for(const t of nearby(origin.x+(end.x-origin.x)*i/steps,origin.z+(end.z-origin.z)*i/steps,cell*.55,open)){
      if(tested.has(t)||t[10]&&open[t[10]]&&!hinges.has(t[10]))continue;tested.add(t);
      edge1.set(t[3]-t[0],t[4]-t[1],t[5]-t[2]);edge2.set(t[6]-t[0],t[7]-t[1],t[8]-t[2]);
      pv.crossVectors(direction,edge2);const det=edge1.dot(pv);if(Math.abs(det)<1e-9)continue;
      tv.set(origin.x-t[0],origin.y-t[1],origin.z-t[2]);const u=tv.dot(pv)/det;if(u<0||u>1)continue;
      qv.crossVectors(tv,edge1);const v=direction.dot(qv)/det;if(v<0||u+v>1)continue;
      const hit=edge2.dot(qv)/det;if(hit>.015&&hit<length-.015)return false;
    }
    return true;
  }
  const triggerVolumes=(data.triggers||[]).map(t=>({...t,inverse:objects.get(t.id).matrixWorld.clone().invert()}));
  const contains=(t,p)=>{const q=new Vector3(p[0],p[1]+.8,p[2]).applyMatrix4(t.inverse);return ['x','y','z'].every((a,i)=>Math.abs(q[a]-t.center[i])<=t.size[i]/2+.15);};
  const spawn=xyz(data.markers.player[0]);spawn[1]=floors(spawn[0],spawn[2]).find(h=>h<spawn[1]-.3)??0;
  const power=xyz(data.markers.powerbox_large_02[0]);power[1]+=.8;
  return {data,triggerVolumes,contains,nodes,objects,root,enabled,xyz,points,doors,exit:{id:exit.id,p:xyz(exit.id)},power,spawn,floors,blocked,move,clear,sight,triangles,doorContact,doorHitsWall,doorSwingLimits};
}

const navCache=new WeakMap();
export function navigation(world,{ghost=false}={}){
  const originalWorld=world,key=ghost?"ghost":"human";
  const cached=navCache.get(world);if(cached?.[key])return cached[key];
  if(ghost){const original=world;world={...original,data:{...original.data,navigation:original.data.ghostNavigation},floors:(x,z)=>original.floors(x,z,true),blocked:(x,y,z,open,r)=>original.blocked(x,y,z,open,r,false,true),move:(p,dx,dz,open)=>original.move(p,dx,dz,open,false,true)};}
  const unit=.35, grid=new Map(), nodes=world.data.navigation?world.data.navigation.map(n=>({...n})):[];
  if(world.data.navigation)for(const n of nodes){const key=Math.round(n.p[0]/unit)+','+Math.round(n.p[2]/unit);if(!grid.has(key))grid.set(key,[]);grid.get(key).push(n);}
  const empty={};
  const k=(x,z)=>x+','+z;
  if(!world.data.navigation)for(let i=-60;i<=60;i++)for(let j=-60;j<=125;j++){
    const x=i*unit,z=j*unit;
    const col=[];
    for(const y of world.floors(x,z)){
      if(y< -3.5||y>7.5||world.blocked(x,y,z,empty,.25,true))continue;
      const n={p:[x,y,z],edges:[],id:nodes.length};
      nodes.push(n);col.push(n);
    }
    if(col.length)grid.set(k(i,j),col);
  }
  if(!world.data.navigation)for(const n of nodes){
    const [x,y,z]=n.p,i=Math.round(x/unit),j=Math.round(z/unit);
    for(const [a,b] of [[0,1],[1,0],[0,-1],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]]){
      for(const to of grid.get(k(i+a,j+b))||[]){
        if(Math.abs(y-to.p[1])>.53)continue;
        let probe=n.p;
        const steps=Math.ceil(Math.hypot(to.p[0]-x,to.p[2]-z)/.075);
        for(let step=0;step<steps;step++)probe=world.move(probe,(to.p[0]-x)/steps,(to.p[2]-z)/steps,empty,true);
        if(Math.hypot(probe[0]-to.p[0],probe[1]-to.p[1],probe[2]-to.p[2])>.08)continue;
        n.edges.push(to.id);
      }
    }
  }
  if(ghost){
    const allowedPositions=world.doors.filter(door=>krasueAllowedDoors.has(door.id)).map(door=>world.xyz(door.id));
    for(const node of nodes){
      const [x,y,z]=node.p;
      if(!allowedPositions.some(p=>Math.abs(p[1]-y)<2.5&&Math.hypot(p[0]-x,p[2]-z)<2.5))continue;
      const i=Math.round(x/unit),j=Math.round(z/unit);
      const edges=new Set(node.edges);
      for(let di=-1;di<=1;di++)for(let dj=-1;dj<=1;dj++){
        if(!di&&!dj)continue;
        for(const to of grid.get(k(i+di,j+dj))||[]){
          if(edges.has(to.id)||Math.abs(to.p[1]-y)>.53)continue;
          if(world.blocked(x,y,z,empty,.20)||world.blocked(...to.p,empty,.20))continue;
          const probe=world.move(node.p,to.p[0]-x,to.p[2]-z,empty);
          if(Math.hypot(...probe.map((v,index)=>v-to.p[index]))<.08)edges.add(to.id);
        }
      }
      node.edges=[...edges];
    }
  }
  function near(p){
    const x=Math.round(p[0]/unit),z=Math.round(p[2]/unit);
    let best=null,d=Infinity;
    for(let i=x-4;i<=x+4;i++)for(let j=z-4;j<=z+4;j++)for(const n of grid.get(k(i,j))||[]){
      const dist=Math.hypot(n.p[0]-p[0],(n.p[1]-p[1])*2,n.p[2]-p[2]);
      if(dist<d){best=n;d=dist;}
    }
    return best;
  }
  function path(a,b){
    const start=near(a),goal=near(b);
    if(!start||!goal)return [];
    const prev=new Int32Array(nodes.length).fill(-1),cost=new Float64Array(nodes.length).fill(Infinity),closed=new Uint8Array(nodes.length),heap=[];
    const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
    function push(id,score){let i=heap.length;heap.push({id,score});while(i){const p=(i-1)>>1;if(heap[p].score<=score)break;[heap[i],heap[p]]=[heap[p],heap[i]];i=p;}}
    function pop(){const result=heap[0],last=heap.pop();if(heap.length){heap[0]=last;let i=0;while(true){let j=i*2+1;if(j>=heap.length)break;if(j+1<heap.length&&heap[j+1].score<heap[j].score)j++;if(heap[i].score<=heap[j].score)break;[heap[i],heap[j]]=[heap[j],heap[i]];i=j;}}return result.id;}
    cost[start.id]=0;prev[start.id]=start.id;push(start.id,distance(start.p,goal.p));
    while(heap.length){
      const current=pop();if(closed[current])continue;closed[current]=1;if(current===goal.id)break;
      for(const next of nodes[current].edges){
        const score=cost[current]+distance(nodes[current].p,nodes[next].p);if(score>=cost[next])continue;
        cost[next]=score;prev[next]=current;push(next,score+distance(nodes[next].p,goal.p));
      }
    }
    if(prev[goal.id]<0)return [];
    const p=[];
    for(let i=goal.id;i!==start.id;i=prev[i])p.push(nodes[i].p);
    return p.reverse();
  }
  const result={nodes,near,path};
  navCache.set(originalWorld,{...navCache.get(originalWorld),[key]:result});
  return result;
}

