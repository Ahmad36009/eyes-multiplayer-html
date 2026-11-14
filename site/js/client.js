import {unityMaterial,originalAmbient,flashlight} from './lighting.js';
import {soundscape} from './soundscape.js';
import {originalUI} from './ui.js';
import {legacyAnimator} from './animation.js';
import * as T from './three.js';
import {buildWorld,navigation} from './world.js';
import {createGame,objectives,labels,distance,difficulties} from './game.js';
import {GLTFLoader} from './gltfloader.js';
import {buildRig,spawnPlayer,animatePlayer} from './playerrig.js';

const $=id=>document.getElementById(id);
const set=(id,visible)=>{$(id).hidden=!visible;};
const coarse=matchMedia('(pointer:coarse)').matches;
let world,nav,data,bytes,renderer,scene,camera,flash,flashTarget,ghostVisual,house;
let room=null,solo=null,state=null,id='',yaw=0,pitch=0,screen='menu',mapFloor=0;
let viewP=null,lastEvent=-1,eventUntil=0,lastFoot=0,sendBusy=false,lastSend=0,flashOn=true;
let netFails=0,gameAmbient,action={},stick={x:0,z:0},runTouch=false,target=null;
const keys=new Set(), actors=new Map(), itemMeshes=new Map(), doorMeshes=new Map(), textures=new Map(), geometryCache=new Map();
const asset=name=>globalThis.eyesAsset(name);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
let animator,breathing,monsterBreath,monsterHum,audio,ui;
let frame=performance.now(),accumulator=0;

let spectateId=null,tagLayer=null;
function cycleSpectate(step){
 const list=state?.players.filter(p=>p.alive&&p.role==='survivor')||[];
 if(list.length){const i=list.findIndex(p=>p.id===spectateId);spectateId=list[(i+step+list.length)%list.length].id;viewP=null;}
}
function show(next){
  if(next==='menu')menuPage('home');
  if(next!=='menu'&&menuMusic){menuMusic.pause();menuMusic=null;}
  screen=next;
  if(next==='menu')startMenuMusic();globalThis.eyesInMatch=!!state&&['running','ending'].includes(state.stage);
  if(next!=='game')$('nametags').replaceChildren();
  for(const key of ['menu','lobby','map','pause','end','story'])set(key,key===next);
  set('hud',next==='game');
  if(next!=='game'){
    keys.clear();stick={x:0,z:0};action={};runTouch=false;
    $('stick').firstElementChild.style.transform='';$('touchRun').classList.remove('active');
    if(document.pointerLockElement)document.exitPointerLock();
  }
}
function sound(name,volume=1,loop=false){
  return audio?.play(name,{volume,loop});
}
function stop(a){if(a)a.pause();}
function menuState(){
  const multi=$('mode').value!=='solo';
  set('network',multi);set('roleRow',$('mode').value==='versus');
  $('play').textContent=multi?'create room':'play';
}
function settings(){
  return {lobbyName:$('lobbyName').value,unlisted:$('unlisted').checked,mode:$('mode').value,difficulty:$('difficulty').value,objective:$('objective').value,name:$('name').value,role:$('role').value};
}
const ICE={iceServers:[{urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302','stun:global.stun.twilio.com:3478']},{urls:['turn:openrelay.metered.ca:80','turn:openrelay.metered.ca:443','turn:openrelay.metered.ca:443?transport=tcp'],username:'openrelayproject',credential:'openrelayproject'}]};
const PREFIX='eyes-horror-';
const freshNet=()=>({peer:null,conn:null,game:null,code:'',clients:new Map(),pending:new Map(),rid:0,timer:0,acc:0,last:0,sig:'',seq:0});
let net=freshNet();
function closeNet(t){
  clearInterval(t.timer);
  for(const c of t.clients.values())try{c.conn.close();}catch(e){}
  try{t.conn?.close();}catch(e){}
  try{t.peer?.destroy();}catch(e){}
  for(const p of t.pending.values())p.reject(Error('Disconnected.'));
}
function netReset(){const t=net;net=freshNet();closeNet(t);}
function netError(e){
  const t=e?.type;
  if(t==='peer-unavailable')return Error('Room not found. Check the code and that the host is still online.');
  if(['network','server-error','socket-error','socket-closed','timeout','disconnected'].includes(t))return Error('Could not reach the matchmaking service. Check your internet connection.');
  return e instanceof Error?e:Error(String(e));
}
function newCode(){const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return Array.from({length:6},()=>a[Math.floor(Math.random()*a.length)]).join('');}
function openPeer(pid){
  return new Promise((resolve,reject)=>{
    const P=globalThis.peerjs?.Peer||globalThis.Peer;
    if(!P)return reject(Error('Network library missing.'));
    let done=false;
    const peer=pid?new P(pid,{config:ICE,debug:0}):new P({config:ICE,debug:0});
    const fail=e=>{if(done)return;done=true;clearTimeout(timer);try{peer.destroy();}catch(x){}reject(e);};
    const timer=setTimeout(()=>fail(Object.assign(Error('timeout'),{type:'timeout'})),10000);
    peer.on('open',()=>{if(done)return;done=true;clearTimeout(timer);resolve(peer);});
    peer.on('error',fail);
  });
}
function reply(c,rid,ok,body){try{c.send(ok?{rid,ok:true,json:body}:{rid,ok:false,error:String(body)});}catch(e){}}
function hostDrop(c){
  for(const cl of net.clients.values())if(cl.conn===c){
    cl.disconnectedAt=performance.now();net.game?.input(cl.id,{x:0,z:0});
  }
}
function hostMessage(c,m){
  if(!m||typeof m!=='object'||!net.game)return;
  const {rid,path,payload}=m;
  try{
    const action=String(path).split('/')[2],g=net.game;
    if(action==='join'){
      if([...net.clients.values()].some(x=>x.conn===c))throw Error('Already joined.');
      const o=payload||{};
      const prior=o.resumeToken&&net.clients.get(o.resumeToken);
      if(prior){
        if(o.version!==releaseVersion)throw Error('Reload to use the same game version.');
        prior.conn=c;prior.disconnectedAt=0;prior.seen=performance.now();
        return reply(c,rid,true,{id:prior.id,host:'host',token:o.resumeToken,code:net.code,state:g.snapshot()});
      }
      const cid='c'+(++net.seq),token=Math.random().toString(36).slice(2)+Date.now().toString(36);
      if(o.version!==releaseVersion)throw Error('Different game version. Both players should reload before joining.');
      g.add(cid,String(o.name||'Survivor').slice(0,24),o.role);
      net.clients.set(token,{conn:c,id:cid,seen:performance.now()});
      return reply(c,rid,true,{id:cid,host:'host',token,code:net.code,state:g.snapshot()});
    }
    const cl=net.clients.get(payload?.token);
    if(!cl||cl.conn!==c)throw Error('Not in this room.');
    cl.seen=performance.now();
    if(action==='tick'){
      const sequence=payload.inputSequence;
      if(Number.isSafeInteger(sequence)&&sequence>(cl.received||0)){
        g.input(cl.id,payload.input||{});cl.received=sequence;
      }
      return reply(c,rid,true,{host:'host',ack:cl.ack||0,state:g.snapshot()});
    }
    if(action==='leave'){net.clients.delete(payload.token);g.remove(cl.id);return reply(c,rid,true,{});}
    if(action==='start')throw Error('Only the host can start the round.');
    throw Error('Unknown request.');
  }catch(e){reply(c,rid,false,e.message);}
}
function hostTick(dt){
  const g=net.game;if(!g)return;
  net.acc+=dt;let n=0;
  while(net.acc>=.025&&n<48){g.tick(.025);for(const cl of net.clients.values())cl.ack=cl.received||0;net.acc-=.025;n++;}
  if(net.acc>1.2)net.acc=0;
}
function hostPump(){
  const now=performance.now();
  // A paused tab or delayed heartbeat does not mean the player left.
  for(const [token,cl] of net.clients){
    if(cl.disconnectedAt&&now-cl.disconnectedAt>30000){net.clients.delete(token);net.game?.remove(cl.id,'connection');continue;}
  }
  for(const cl of net.clients.values())if(now-cl.seen>2500){
    net.game?.input(cl.id,{x:0,z:0});
  }
  if(document.hidden&&net.game){
    const dt=Math.min((now-(net.last||now))/1000,1.1);net.last=now;
    net.game.input('host',{x:0,z:0,yaw,pitch});hostTick(dt);
  }else net.last=now;
}
function hostStep(dt){
  if(!room?.local||!net.game)return;
  const g=net.game;
  g.input('host',packet());hostTick(dt);
  const s=g.snapshot();
  if(s.stage==='lobby'){const sig=s.players.map(p=>p.id+p.name+p.role).join('|')+':'+s.events.at(-1)?.seq;if(sig===net.sig)return;net.sig=sig;}
  else if(s.stage==='ended'&&state?.stage==='ended')return;
  apply(s);
}
async function hostRoom(options){
  netReset();
  let peer=null,code='';
  for(let i=0;i<8&&!peer;i++){
    code=newCode();
    try{peer=await openPeer(PREFIX+code);}
    catch(e){if(e?.type!=='unavailable-id'||i===7)throw netError(e);}
  }
  const game=createGame(world,nav??=navigation(world),options);
  game.add('host',String(options.name||'Survivor').slice(0,24),options.role);
  net.peer=peer;net.game=game;net.code=code;net.last=performance.now();net.directoryToken=crypto.randomUUID();net.lobbyName=options.lobbyName||options.name+"'s lobby";net.unlisted=options.unlisted;publishLobby();
  peer.on('connection',c=>{c.on('data',m=>hostMessage(c,m));c.on('close',()=>hostDrop(c));c.on('error',()=>{if(!c.open)hostDrop(c);});});
  peer.on('disconnected',()=>{try{peer.reconnect();}catch(e){}});
  peer.on('error',()=>{});
  net.timer=setInterval(hostPump,100);
  return {id:'host',host:'host',token:'host',code,local:true,state:game.snapshot()};
}
async function joinRoom(code){
  netReset();
  const peer=await openPeer().catch(e=>{throw netError(e);});
  net.peer=peer;
  const conn=await new Promise((resolve,reject)=>{
    const c=peer.connect(PREFIX+code,{serialization:'json',reliable:true});
    const t=setTimeout(()=>reject(Error('Could not connect to the host. Your network may block peer-to-peer connections.')),15000);
    c.on('open',()=>{clearTimeout(t);resolve(c);});
    c.on('error',e=>{clearTimeout(t);reject(netError(e));});
    peer.on('error',e=>{clearTimeout(t);reject(netError(e));});
  }).catch(e=>{netReset();throw e;});
  wireGuest(conn);
}
function wireGuest(conn){
 net.conn=conn;
 conn.on('data',m=>{
  if(m?.hostLeaving===true){if(net.conn===conn&&room&&!room.local){leave();$('menuStatus').textContent='The host ended the lobby.';}return;}
  const p=net.pending.get(m?.rid);if(!p)return;net.pending.delete(m.rid);m.ok?p.resolve(m.json):p.reject(Error(m.error||'Request failed.'));
 });
 conn.on('close',()=>{if(net.conn===conn&&room&&!room.local)recoverGuest();});
}
async function recoverGuest(){
 const session=net,current=room;if(session.reconnecting||!current)return;
 session.reconnecting=true;$('message').textContent='Connection interrupted — reconnecting…';
 const deadline=performance.now()+25000;
 try{
  while(net===session&&room===current&&performance.now()<deadline){
   let conn;
   try{
    conn=await new Promise((resolve,reject)=>{
      const c=session.peer.connect(PREFIX+current.code,{serialization:'json',reliable:true});
      const timer=setTimeout(()=>{c.close();reject(Error('Connection timed out'));},4000);
      c.on('open',()=>{clearTimeout(timer);resolve(c);});c.on('error',e=>{clearTimeout(timer);reject(e);});
    });
    if(net!==session||room!==current){conn.close();return;}
    wireGuest(conn);
    const response=await clientCall('/'+current.code+'/join',{resumeToken:current.token,version:releaseVersion});
    if(net!==session||room!==current)return;
    current.motion=[];pred=null;apply(response.state);$('message').textContent='Reconnected.';return;
   }catch{conn?.close();await new Promise(r=>setTimeout(r,750));}
  }
  if(net===session&&room===current){leave();$('menuStatus').textContent='Connection to the host could not be restored.';}
 }finally{session.reconnecting=false;}
}
function clientCall(path,payload){
  return new Promise((resolve,reject)=>{
    const conn=net.conn;
    if(!conn||!conn.open)return reject(Error('Not connected.'));
    const rid=++net.rid;
    const t=setTimeout(()=>{net.pending.delete(rid);reject(Error('The host did not respond.'));},6000);
    net.pending.set(rid,{resolve:v=>{clearTimeout(t);resolve(v);},reject:e=>{clearTimeout(t);reject(e);}});
    try{conn.send({rid,path,payload});}catch(e){clearTimeout(t);net.pending.delete(rid);reject(e);}
  });
}
let lobbyBase='';
const releaseVersion=await fetch(new URL('../version.json',import.meta.url)).then(r=>r.json()).then(r=>r.version).catch(()=> '2026.11.14.2');
try{const c=await fetch(new URL('../config.json',import.meta.url),{cache:'no-store'}).then(r=>r.json());if(c.lobbyApi&&new URL(c.lobbyApi).protocol==='https:')lobbyBase=c.lobbyApi.replace(/\/$/,'');}catch{}
function lobbyApi(path){if(!lobbyBase)throw Error('Lobby directory not configured. Room codes still work.');return lobbyBase+path;}
async function publishLobby(t=net,remove=false){
 if(!lobbyBase||!t.game||t.unlisted||!t.directoryToken)return;
 const s=t.game.snapshot();
 try{await fetch(lobbyApi('/api/lobbies'),{method:remove?'DELETE':'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+t.directoryToken},body:JSON.stringify({code:t.code,name:t.lobbyName,host:s.players.find(p=>p.id==='host')?.name,mode:s.mode,difficulty:s.difficulty,stage:s.stage,players:s.players.length,monsterTaken:s.players.some(p=>p.role==='monster'),version:releaseVersion}),signal:AbortSignal.timeout(6000)});}catch{}
}
setInterval(()=>publishLobby(),20000);
for(const el of [$('lobbyName').parentElement,$('unlisted').parentElement,$('lobbyBrowser')])el.style.display='';

async function request(path,payload){
  if(path==='')return hostRoom(payload);
  const action=path.split('/')[2];
  if(action==='join'){
    await joinRoom(path.split('/')[1]);
    try{return await clientCall(path,{...payload,version:releaseVersion});}catch(e){netReset();throw e;}
  }
  if(net.game){
    if(action==='start'){net.game.start();publishLobby();return {host:'host',state:net.game.snapshot()};}
    if(action==='leave'){
      const old=net;publishLobby(old,true);net=freshNet();
      for(const {conn} of old.clients.values())try{conn.send({hostLeaving:true});}catch{}
      setTimeout(()=>closeNet(old),250);return {};
    }
    if(action==='tick')return {host:'host',state:net.game.snapshot()};
    throw Error('Unknown request.');
  }
  if(action==='leave'){
    try{net.conn?.send({rid:++net.rid,path,payload});}catch(e){}
    const old=net;net=freshNet();setTimeout(()=>closeNet(old),250);return {};
  }
  return clientCall(path,payload);
}

function lock(){if(!coarse&&screen==='game')$('view').requestPointerLock?.();}
function leave(){
  if(room)request('/'+room.code+'/leave',{token:room.token}).catch(()=>{});
  room=null;state=null;solo=null;keys.clear();viewP=null;target=null;
  for(const a of actors.values())scene.remove(a);actors.clear();
  for(const a of itemMeshes.values())if(a?.userData.extra)scene.remove(a);itemMeshes.clear();
  document.body.className='';
  stop(gameAmbient);gameAmbient=null;for(const a of [breathing,monsterBreath,monsterHum])stop(a);breathing=monsterBreath=monsterHum=null;
  audio?.clear();show('menu');$('menuStatus').textContent='';$('play').disabled=false;
}
function resetRound(s){
  animator=legacyAnimator(data,world);for(const n of data.nodes){const o=world.objects.get(n.id);o.position.fromArray(n.p);if(o.userData.flashOffset)o.position.add(o.userData.flashOffset);o.quaternion.fromArray(n.q).normalize();o.scale.fromArray(n.s);}animator.update(0,{},0,{});accumulator=0;
  const p=s.players.find(p=>p.id===id);yaw=p?.yaw||0;pitch=0;viewP=null;lastEvent=-1;eventUntil=0;lastFoot=0;action={};
  for(const o of doorMeshes.values())o.quaternion.copy(o.userData.closed);
  for(const p of world.points)world.objects.get(p.id).visible=false;
  audio.start();
  for(const a of [breathing,monsterBreath,monsterHum])stop(a);breathing=null;monsterBreath=null;monsterHum=null;
  show('game');
  $('shade').animate?.([{background:'#000'},{background:'transparent'}],{duration:1200});
}
function apply(s){
  const prior=state?.stage;
  state=s;
  if(s.stage==='lobby')for(const e of s.events){
    if(!['chat','feed'].includes(e.type)||eventKeys.has(String(e.seq)))continue;
    eventKeys.add(String(e.seq));const line=document.createElement('div');line.textContent=e.message;
    $('lobbyFeed').append(line);while($('lobbyFeed').childElementCount>7)$('lobbyFeed').firstElementChild.remove();
  }
  if(s.stage==='lobby'){
    $('lobbyMode').textContent=(s.mode==='versus'?'Versus':'Co-op')+' · '+s.difficulty+' · '+objectives[s.objective].name;
    $('lobbyCode').textContent=room.code;
    $('players').replaceChildren(...s.players.map(p=>{
      const li=document.createElement('li');li.textContent=p.name+' · '+(p.role==='monster'?'Monster':'Survivor')+(p.id===room.host?' · Host':'');return li;
    }));
    set('start',room.host===id);
    const ready=s.mode==='coop'?s.players.length>=2:s.players.some(p=>p.role==='monster')&&s.players.some(p=>p.role==='survivor');
    $('start').disabled=!ready;
    $('lobbyStatus').textContent=ready?(room.host===id?'Ready to start.':'Waiting for the host to start.'):(s.mode==='versus'?'Waiting for a monster and a survivor.':'Waiting for another survivor.');
    return;
  }
  if(s.stage==='running'&&prior!=='running')resetRound(s);
  const me=s.players.find(p=>p.id===id);
  for(const e of s.events){
    if(e.t<lastEvent)continue;
    const k=String(e.seq);
    if(eventKeys.has(k))continue;
    eventKeys.add(k);if(eventKeys.size>150)eventKeys.delete(eventKeys.values().next().value);
    lastEvent=Math.max(lastEvent,e.t);
    if(e.type==='chat'||e.type==='feed'){
      const line=document.createElement('div');line.textContent=e.message;line.className=e.type;
      const feed=$('socialFeed');feed.append(line);while(feed.childElementCount>7)feed.firstElementChild.remove();feed.scrollTop=feed.scrollHeight;
      continue;
    }
    if(e.player&&e.player!==id)continue;
    if(e.type==='hint'&&e.message==='RUN'){$('danger').textContent='RUN';eventUntil=performance.now()+1300;}
    else if(e.message){$('message').textContent=e.message;eventUntil=performance.now()+3500;}
    audio.event(e,s);
  }
  if(s.stage==='ended'&&prior!=='ended'){
    const monster=me?.role==='monster',win=(s.winner==='caught')===monster;
    $('endLabel').textContent=win?'Victory':'Defeat';
    $('endTitle').textContent=s.winner==='escaped'?'Escaped':'Caught';
    $('endText').textContent=s.winner==='escaped'?"hi. congratz, man. nicely done.\nwhy don’t you answer my calls?":'You were caught inside the house.';
    audio.clear();if(s.winner==='escaped')audio.event({type:'escaped'},s);
    const caught=s.winner==='caught';$('endDifficulty').value=s.difficulty;$('replay').hidden=!!room;
    $('end').classList.toggle('caught',caught);
    if(caught){
      $('shade').classList.add('death-fade');
      setTimeout(()=>{
        if(state?.stage==='ended'&&state.winner==='caught')show('end');
        $('shade').classList.remove('death-fade');
      },700);
    }else show('end');
  }
}
const eventKeys=new Set();
async function enter(join=false){
  if(!world||$('play').disabled)return;
  $('play').disabled=true;$('join').disabled=true;
  $('menuStatus').textContent=join?'Joining room…':'Opening the house…';
  const options=settings();
  try{
    eventKeys.clear();
    if(options.mode==='solo'&&!join){
      room=null;id='local';solo=createGame(world,nav??=navigation(world),options);
      solo.add(id,options.name||'Survivor');solo.start();apply(solo.snapshot());lock();
    }else{
      solo=null;
      const value=$('roomCode').value.trim().toUpperCase();
      if(join&&!/^[A-Z0-9]{6}$/.test(value))throw Error('Enter the six-character room code.');
      room=await request(join?'/'+value+'/join':'',options);
      id=room.id;show('lobby');apply(room.state);
    }
  }catch(e){show('menu');$('menuStatus').textContent=e.message;}
  finally{$('play').disabled=false;$('join').disabled=false;}
}
async function refreshLobbies(){
  const status=$('browseStatus'), list=$('publicLobbies');
  status.textContent='Loading lobbies…';
  try{
    const response=await fetch(lobbyApi('/api/lobbies'),{cache:'no-store',signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error('Lobby server unavailable.');
    const lobbies=await response.json();
    list.replaceChildren(...lobbies.map(lobby=>{
      const row=document.createElement('li'), title=document.createElement('strong');
      title.textContent=lobby.name;
      const info=document.createElement('p');
      const mode=lobby.mode==='coop'?'Co-op':'Versus';
      info.textContent=mode+' · '+lobby.difficulty+' · '+(objectives[lobby.objective]?.name||lobby.objective)+' · '+lobby.players+'/'+lobby.capacity+' · Host: '+lobby.host;
      const join=document.createElement('button');
      join.disabled=lobby.stage!=='lobby'||lobby.players>=lobby.capacity;
      join.textContent=lobby.stage!=='lobby'?'In progress':join.disabled?'Full':'Join';
      join.onclick=()=>{
        $('mode').value=lobby.mode;
        menuState();
        if(lobby.mode==='versus'&&lobby.monsterTaken)$('role').value='survivor';
        $('roomCode').value=lobby.code;
        enter(true);
      };
      row.append(title,info,join);
      return row;
    }));
    status.textContent=lobbies.length?'':'No public lobbies yet.';
  }catch(error){
    list.replaceChildren();
    status.textContent=error.message==='Failed to fetch'?'Could not reach this lobby server. Check the URL and server access settings.':error.message;
  }
}
$('refreshLobbies').onclick=refreshLobbies;
$('lobbyBrowser').ontoggle=()=>{if($('lobbyBrowser').open)refreshLobbies();};
function pause(next='pause'){
  if(screen!=='game')return;
  $('pauseVolume').value=$('volume').value;
  $('pauseSensitivity').value=$('sensitivity').value;
  $('pauseBrightness').value=$('brightness').value;
  $('pauseSensitivityLabel').innerHTML=coarse?'touch<br>sensitivity':'mouse<br>sensitivity';
  $('pauseText').textContent=room?'The multiplayer round is still running.':'The house can wait.';
  show(next);
}
function resume(){show('game');lock();}
function showMap(){
  const me=state?.players.find(p=>p.id===id);
  if(!me||me.role==='monster'||!me.alive)return;
  mapFloor=Math.min(3.2,Math.max(-3.2,Math.round(me.p[1]/3.2)*3.2));pause('map');sound('map',.65);drawMap();
}
$('mode').onchange=menuState;$('play').onclick=beginStory;$('join').onclick=()=>enter(true);
$('leaveLobby').onclick=$('quit').onclick=$('back').onclick=leave;
$('start').onclick=async()=>{
  const r=room;if(!r)return;
  try{const result=await request('/'+r.code+'/start',{token:r.token});if(room===r){r.host=result.host;apply(result.state);lock();}}
  catch(e){$('lobbyStatus').textContent=e.message;}
};
$('pauseButton').onclick=()=>pause();$('resume').onclick=resume;
$('mapButton').onclick=showMap;$('closeMap').onclick=resume;
$('floors').onclick=e=>{if(e.target.dataset.floor!=null){mapFloor=+e.target.dataset.floor;drawMap();}};
$('volume').oninput=()=>{if(menuMusic)menuMusic.volume=+$('volume').value;if(gameAmbient)gameAmbient.volume=+$('volume').value*.38;};
$('brightness').oninput=()=>{originalAmbient.value=+$('brightness').value;};
$('fullscreen').onclick=async()=>{
 try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}
 catch{$('fullscreen').textContent='Fullscreen unavailable';}
};
$('spectatePrev').onclick=()=>cycleSpectate(-1);
$('spectateNext').onclick=()=>cycleSpectate(1);
$('chatForm').onsubmit=e=>{
 e.preventDefault();const input=$('chatText');const chat=input.value.trim();
 if(chat)action.chat=chat;
 input.value='';input.blur();set('chatForm',false);lock();
};
$('chatToggle').onclick=()=>{keys.clear();if(document.pointerLockElement)document.exitPointerLock();set('chatForm',true);$('chatText').focus();};
addEventListener('keydown',e=>{
  if(e.target?.matches?.('input,textarea')){if(e.code==='Escape'){e.target.blur();set('chatForm',false);}return;}
  if(room&&screen==='game'&&e.code==='KeyT'){e.preventDefault();$('chatToggle').click();return;}
  if(room&&screen==='game'&&!state?.players.find(p=>p.id===id)?.alive&&['BracketLeft','BracketRight'].includes(e.code)){cycleSpectate(e.code==='BracketLeft'?-1:1);return;}
  if(screen==='story'){e.preventDefault();advanceStory();return;}
  if(screen==='map'&&['KeyM','Escape'].includes(e.code)){e.preventDefault();resume();return;}
  if(screen==='pause'&&e.code==='Escape'){resume();return;}
  if(screen!=='game')return;
  if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();
  keys.add(e.code);
  if(e.repeat)return;
  if(e.code==='Escape')pause();
  if(e.code==='KeyM')showMap();
  if(e.code==='KeyE')use();
  if(e.code==='KeyQ')action.eye=true;
  if(e.code==='KeyF')flashOn=!flashOn;
});
addEventListener('keyup',e=>keys.delete(e.code));
addEventListener('blur',()=>keys.clear());
document.addEventListener('mousemove',e=>{
  if(screen!=='game'||document.pointerLockElement!==$('view'))return;
  yaw+=e.movementX*.0022*+$('sensitivity').value;pitch=clamp(pitch-e.movementY*.0022*+$('sensitivity').value,-1.35,1.35);
});
$('view').onclick=()=>{if(!document.pointerLockElement)lock();else use();};
function bindMultiTouchButton(id,activate){
  const button=$(id);
  let lastTouch=-Infinity;
  // Touch events fire for each finger, including when a different finger holds the stick.
  button.addEventListener('touchstart',event=>{
    event.preventDefault();
    event.stopPropagation();
    lastTouch=performance.now();
    activate();
  },{passive:false});
  button.onclick=event=>{
    if(event.detail===0||performance.now()-lastTouch>700)activate();
  };
}
bindMultiTouchButton('touchUse',use);
bindMultiTouchButton('touchEye',()=>action.eye=true);
bindMultiTouchButton('touchRun',()=>{$('touchRun').classList.toggle('active',runTouch=!runTouch);});
bindMultiTouchButton('chatToggle',()=>{keys.clear();stick={x:0,z:0};if(document.pointerLockElement)document.exitPointerLock();set('chatForm',true);$('chatText').focus();});
function findInteraction(s,me){
  const candidates=new Map([...s.items.filter(item=>!item.taken&&!item.hidden),...s.doors.filter(door=>!door.push)].map(item=>[world.objects.get(item.id==='exit'?world.exit.id:item.id),item]));
  camera.getWorldDirection(lookDir);
  interactionRay.set(camera.position,lookDir);
  interactionRay.far=2.5;
  house.updateMatrixWorld(true);
  for(const hit of interactionRay.intersectObject(house,true)){
    if(!hit.object.isMesh)continue;
    let visible=true,item;
    for(let object=hit.object;object;object=object.parent){
      if(!object.visible){visible=false;break;}
      if(!item)item=candidates.get(object);
    }
    if(!visible)continue;
    if(!item)return null;
    return {...item,hitPoint:[hit.point.x,hit.point.y,-hit.point.z]};
  }
  return null;
}
function use(){
  const me=state?.players.find(p=>p.id===id);
  if(screen!=='game'||state.stage!=='running'||!me?.alive||me.vision>state.elapsed)return;
  if(me.role==='monster')action.attack=true;
  else {
    camera.rotation.set(pitch,-yaw,0,'YXZ');
    const aimed=findInteraction(state,me);
    if(aimed){action.interact=aimed.id;action.hitPoint=aimed.hitPoint;}
  }
}
function pointerArea(el,update,end){
  let pointer=null;
  el.onpointerdown=e=>{if(pointer!==null)return;pointer=e.pointerId;el.setPointerCapture(pointer);update(e,true);};
  el.onpointermove=e=>{if(pointer===e.pointerId)update(e,false);};
  el.onpointerup=el.onpointercancel=e=>{if(pointer===e.pointerId){pointer=null;end();}};
  el.onlostpointercapture=e=>{if(pointer===e.pointerId){pointer=null;end();}};
}
pointerArea($('stick'),e=>{
  const r=$('stick').getBoundingClientRect(),x=clamp((e.clientX-r.left-r.width/2)/37,-1,1),z=clamp((e.clientY-r.top-r.height/2)/37,-1,1);
  stick={x,z:-z};$('stick').firstElementChild.style.transform='translate('+x*29+'px,'+z*29+'px)';
},()=>{stick={x:0,z:0};$('stick').firstElementChild.style.transform='';});
let drag=null;
pointerArea($('look'),(e,first)=>{
  if(first){drag=[e.clientX,e.clientY];return;}
  const gain=.0045*+$("sensitivity").value;
  yaw+=(e.clientX-drag[0])*gain;pitch=clamp(pitch-(e.clientY-drag[1])*gain,-1.35,1.35);drag=[e.clientX,e.clientY];
},()=>drag=null);
function packet(){
  if(screen!=='game'){const p={x:0,z:0,yaw,pitch,...action};action={};return p;}
  const down=(...k)=>k.some(x=>keys.has(x))?1:0;
  const p={seenAt:state?.elapsed,x:down('KeyD','ArrowRight')-down('KeyA','ArrowLeft')+stick.x,z:down('KeyW','ArrowUp')-down('KeyS','ArrowDown')+stick.z,run:runTouch||!!down('ShiftLeft','ShiftRight'),yaw,pitch,...action};
  action={};return p;
}
let inflight=0,netSeq=0,lastSeq=0;
async function network(now){
  if(!room||room.local||net.reconnecting||inflight>=2||now-lastSend<45)return;
  const current=room,seq=++netSeq;lastSend=now;inflight++;
  const input=packet();
  (current.motion??=[]).push({seq,input,frames:[]});
  if(current.motion.length>32)current.motion.shift();
  try{
    const result=await request('/'+current.code+'/tick',{token:current.token,input,inputSequence:seq});
    if(room!==current)return;
    current.host=result.host;netFails=0;
    if(seq<lastSeq)return;lastSeq=seq;current.ack=result.ack??0;current.rtt=performance.now()-now;
    if(state?.stage!=='ended' && !(state?.stage==='running'&&result.state.stage==='lobby'))apply(result.state);
  }catch(e){
    if(room!==current)return;
    $('message').textContent='Waiting for the host…';
  }finally{inflight--;}
}
function moveInput(){
  if(screen!=='game')return {x:0,z:0,run:false};
  const down=(...k)=>k.some(x=>keys.has(x))?1:0;
  return {x:down('KeyD','ArrowRight')-down('KeyA','ArrowLeft')+stick.x,z:down('KeyW','ArrowUp')-down('KeyS','ArrowDown')+stick.z,run:runTouch||!!down('ShiftLeft','ShiftRight')};
}
// Client-side prediction for joined players: move locally, ease toward host position.
let pred=null,srvP=null,lastSnap=null;
function predict(dt){
  const s=state;
  if(!room||room.local||!s||s.stage!=='running'){pred=null;lastSnap=null;return;}
  const me=s.players.find(p=>p.id===id);
  if(!me||!me.alive||me.vision>s.elapsed){pred=null;lastSnap=null;return;}
  const monster=me.role==='monster';
  const move=(position,inp,seconds)=>{
    const x=Math.max(-1,Math.min(1,inp.x||0)),z=Math.max(-1,Math.min(1,inp.z||0));
    if(!x&&!z)return position;
    const n=Math.max(1,Math.hypot(x,z)),angle=inp.yaw??yaw;
    const speed=monster?difficulties[s.difficulty].speed:inp.run?(me.energy>60?6:me.energy>40?5:me.energy>20?4:3):3;
    return world.move(position,(Math.cos(angle)*x+Math.sin(angle)*z)*speed*seconds/n,
      (-Math.sin(angle)*x+Math.cos(angle)*z)*speed*seconds/n,s.open,false,monster);
  };
  const motion=room.motion??=[];
  if(s!==lastSnap||!pred){
    lastSnap=s;srvP=[...me.p];
    room.motion=motion.filter(entry=>entry.seq>(room.ack||0));
    let corrected=srvP;
    let budget=Math.min(.12,(room.rtt||0)/2000+.025);
    for(const entry of room.motion)for(const frame of entry.frames){
      const step=Math.min(frame.dt,budget);if(step<=0)break;
      corrected=move(corrected,frame.input,step);budget-=step;
    }
    if(!pred||distance(pred,corrected)>1.2)pred=[...corrected];
    else pred=world.move(pred,(corrected[0]-pred[0])*.4,(corrected[2]-pred[2])*.4,s.open,false,monster);
  }
  const input={...moveInput(),yaw};
  pred=move(pred,input,dt);
  const latest=room.motion?.at(-1);
  if(latest&&dt>0&&latest.frames.length<20)latest.frames.push({input,dt});
  me.p=[...pred];
}
const startupTextures=[];
function getTexture(file,srgb=true,scale=[1,1],offset=[0,0]){
  const k=JSON.stringify([file,srgb,scale,offset]);
  if(textures.has(k))return textures.get(k);
  let finish;
  startupTextures.push(new Promise(resolve=>{finish=resolve;}));
  const tx=new T.TextureLoader().load(asset(file),()=>finish(true),undefined,()=>finish(false));
  tx.colorSpace=srgb?T.SRGBColorSpace:T.NoColorSpace;
  tx.wrapS=tx.wrapT=T.RepeatWrapping;tx.repeat.fromArray(scale);tx.offset.fromArray(offset);tx.anisotropy=coarse?1:4;
  textures.set(k,tx);return tx;
}
function geometry(n){
  const k=JSON.stringify([n.mesh,n.subset,n.lm,n.lmst]);
  if(geometryCache.has(k))return geometryCache.get(k);
  const raw=data.meshes[n.mesh],geo=new T.BufferGeometry(),attrib=(name,d,size)=>{
    if(d)geo.setAttribute(name,new T.BufferAttribute(new Float32Array(bytes,...d),size));
  };
  attrib('position',raw.p,3);attrib('normal',raw.n,3);attrib('uv',raw.uv,2);
  if(n.lm<5){
    const d=raw.uv2||raw.uv;
    if(d){
      const uv=new Float32Array(new Float32Array(bytes,...d)),[x,y,a,b]=n.lmst;
      for(let i=0;i<uv.length;i+=2){uv[i]=uv[i]*x+a;uv[i+1]=uv[i+1]*y+b;}
      geo.setAttribute('uv2',new T.BufferAttribute(uv,2));
    }
  }
  if(raw.skin){
    geo.setAttribute('skinIndex',new T.Uint16BufferAttribute(raw.skin.flatMap(v=>[0,1,2,3].map(i=>v['boneIndex['+i+']'])),4));
    geo.setAttribute('skinWeight',new T.Float32BufferAttribute(raw.skin.flatMap(v=>[0,1,2,3].map(i=>v['weight['+i+']'])),4));
  }
  const parts=(n.subset?.length?n.subset.map(i=>raw.parts[i]).filter(Boolean):raw.parts);
  const index=new Uint32Array(parts.reduce((count,p)=>count+p[1],0));
  let offset=0;
  for(const [i,p] of parts.entries()){
    const seq=new Uint32Array(bytes,...p);
    for(let j=0;j<seq.length;j+=3){index[offset+j]=seq[j];index[offset+j+1]=seq[j+1];index[offset+j+2]=seq[j+2];}
    geo.addGroup(offset,seq.length,Math.min(i,Math.max(0,(n.materials?.length||1)-1)));offset+=seq.length;
  }
  geo.setIndex(new T.BufferAttribute(index,1));
  if(!geo.attributes.normal)geo.computeVertexNormals();
  geometryCache.set(k,geo);return geo;
}
const materials=new Map();
function material(key,lm){
  const cache=key+':'+lm;
  if(materials.has(cache))return materials.get(cache);
  const m=data.materials[key]||{color:[.7,.7,.7,1],shader:'',name:''};
  const alpha=m.color[3],cut=/transparent|eye|foliage/i.test(m.shader+' '+m.name);
  const mat=new T.MeshLambertMaterial({color:new T.Color(...m.color.slice(0,3)),side:T.DoubleSide,opacity:alpha,transparent:alpha<.72,alphaTest:cut?.24:0});
  if(m.t)mat.map=getTexture(m.t,false,m.scale,m.offset);
  if(lm<5){
    mat.lightMap=getTexture(data.lightmaps[lm],false);mat.lightMap.channel=2;mat.lightMapIntensity=1;
  }
  unityMaterial(mat,m);
  materials.set(cache,mat);return mat;
}
function renderWorld(){
  renderer=new T.WebGLRenderer({canvas:$('view'),antialias:!coarse,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,coarse?1.05:1.5));
  renderer.toneMapping=T.NoToneMapping;renderer.toneMappingExposure=1;
  scene=new T.Scene();scene.background=new T.Color(0x000000);scene.fog=null;
  camera=new T.PerspectiveCamera(60,1,.035,90);camera.rotation.order='YXZ';
  scene.add(new T.AmbientLight(0xffffff,.1));
  flash=flashlight(scene,camera,data,geometry,getTexture);
  house=new T.Group();house.scale.z=-1;house.add(world.root);scene.add(house);
  const player=world.objects.get(data.markers.player[0]);player.visible=false;
  ghostVisual=world.objects.get(data.markers.girlMain[0]);
  const skins=[];
  for(const n of data.nodes){
    const o=world.objects.get(n.id);
    o.visible=n.active&&![5,10,11].includes(n.layer)&&n.name!=='flashlight_cone';
    if(n.mesh&&data.meshes[n.mesh]?.p){
      const mesh=new (n.bones?.length?T.SkinnedMesh:T.Mesh)(geometry(n),n.materials?.length?n.materials.map(k=>material(k,n.lm)):material(null,255));
      o.add(mesh);if(n.bones?.length)skins.push({n,mesh});
    }
  }
  const torch=data.nodes.find(n=>n.name==='FPSWeapons'&&n.parent===flash.lightNode.id);
  if(torch){
    const model=world.objects.get(torch.id);
    model.userData.flashOffset=new T.Vector3(...flash.lightNode.p);
    model.position.add(model.userData.flashOffset);
    flash.rig.add(model);
  }
  house.updateMatrixWorld(true);
  for(const {n,mesh} of skins){
    const bones=n.bones.map(id=>world.objects.get(id));
    const invWorld=mesh.matrixWorld.clone().invert();
    const inverse=data.meshes[n.mesh].bind.map(v=>new T.Matrix4().set(...Array.from({length:16},(_,i)=>v['e'+Math.floor(i/4)+(i%4)])).multiply(invWorld));
    const skeleton=new T.Skeleton(bones,inverse);mesh.bind(skeleton,mesh.matrixWorld);mesh.frustumCulled=false;
  }
  animator=legacyAnimator(data,world);
  player.visible=false;
  for(const n of world.doors){
    const o=world.objects.get(n.id);o.userData.closed=o.quaternion.clone();doorMeshes.set(n.id,o);
  }
  for(const p of world.points)world.objects.get(p.id).visible=false;
  const resize=()=>{renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();};
  addEventListener('resize',resize);resize();
}
function extraMesh(item){
  let o;
  if(item.type==='page1'||item.type==='page2'||item.type==='page3'||item.type==='code'){
    o=new T.Mesh(new T.PlaneGeometry(.28,.35),new T.MeshLambertMaterial({color:0xe2c394,emissive:0x513418,side:T.DoubleSide}));
  }else if(item.type==='fuse'){
    o=new T.Mesh(new T.CylinderGeometry(.06,.06,.31,8),new T.MeshLambertMaterial({color:0xd5a860,emissive:0x865822}));
    o.rotation.z=1.57;
  }else return null;
  o.position.set(item.p[0],item.p[1],-item.p[2]);o.userData.extra=true;scene.add(o);return o;
}
let rig=null;
async function loadPlayerModel(){
  try{
    const buf=await fetch(asset('player_model.glb')).then(r=>r.arrayBuffer());
    const gltf=await new Promise((res,rej)=>new GLTFLoader().parse(buf,'',res,rej));
    rig=buildRig(gltf);
  }catch(e){console.warn('player model failed',e);rig=null;}
}
function modelPlayer(){
  if(!rig)return modelPlayerFallback();
  try{const g=spawnPlayer(rig);scene.add(g);return g;}catch(e){console.warn(e);rig=null;return modelPlayerFallback();}
}
function modelPlayerFallback(){
  const group=new T.Group(),coat=new T.MeshLambertMaterial({color:0x766b56}),skin=new T.MeshLambertMaterial({color:0x8b7864});
  const torso=new T.Mesh(new T.CapsuleGeometry(.22,.57,4,9),coat);torso.position.y=.9;
  const head=new T.Mesh(new T.SphereGeometry(.15,10,8),skin);head.position.y=1.49;
  const beam=new T.Mesh(new T.BoxGeometry(.14,.10,.17),new T.MeshBasicMaterial({color:0xf0c58c}));beam.position.set(.3,1.03,-.25);
  group.add(torso,head,beam);scene.add(group);return group;
}
const pos=new T.Vector3(),lookDir=new T.Vector3(),twist=new T.Quaternion(),axis=new T.Vector3(0,1,0);
function draw(now,dt){
  const s=state, me=s?.players.find(p=>p.id===id);
  const inGame=!!me&&s.stage!=='lobby';
  let spectate=null,ghostView=false;
  if(inGame){
    const vision=me.vision>s.elapsed,dead=!me.alive;
    document.body.classList.toggle('vision',vision);document.body.classList.toggle('dead',dead);
    const living=s.players.filter(p=>p.role==='survivor'&&p.alive);
    spectate=dead&&s.elapsed-(me.caughtAt??-99)>=2.45?(living.find(p=>p.id===spectateId)||living[0]):null;
    if(spectate)spectateId=spectate.id;
    set('spectating',!!spectate);
    set('chatToggle',!!room);
    set('socialFeed',!!room);
    $('spectateName').textContent=spectate?'Watching '+spectate.name:'';
    document.body.classList.toggle('spectating',!!spectate);
    const focus=vision?s.ghost:spectate||me;
    const lookYaw=vision?s.ghost.yaw:spectate?spectate.yaw:yaw;
    const lookPitch=vision?-.04:spectate?spectate.pitch:pitch;
    const step=(screen==='game'&&me.alive&&s.stage==='running'&&!vision&&(stick.x||stick.z||[...keys].some(k=>/^Key[WASD]$|^Arrow/.test(k))))?Math.sin(now*.014)*.022:0;
    const desired=new T.Vector3(focus.p[0],focus.p[1]+(vision||me.role==='monster'?1.35:1.50)+step,-focus.p[2]);
    if(!viewP||viewP.distanceTo(desired)>3)viewP=desired.clone();
    viewP.lerp(desired,1-Math.exp(-dt*22));camera.position.copy(me.role==='monster'?desired:viewP);camera.rotation.set(lookPitch,-lookYaw,0,'YXZ');
    ghostView=vision||me.role==='monster';
    const alive=new Set();
    for(const p of s.players){
      if(p.id===id||p.id===spectate?.id||p.role==='monster'||!p.alive)continue;
      alive.add(p.id);let a=actors.get(p.id);
      if(!a){a=modelPlayer();actors.set(p.id,a);a.position.set(p.p[0],p.p[1],-p.p[2]);a.rotation.y=-p.yaw;}
      else{
        const k=1-Math.exp(-dt*16),ox=a.position.x,oz=a.position.z;
        a.position.x+=(p.p[0]-ox)*k;a.position.z+=(-p.p[2]-oz)*k;a.position.y+=(p.p[1]-a.position.y)*k;
        a.rotation.y+=Math.atan2(Math.sin(-p.yaw-a.rotation.y),Math.cos(-p.yaw-a.rotation.y))*k;
        if(dt>0)animatePlayer(a,dt,Math.hypot(a.position.x-ox,a.position.z-oz)/dt);
      }
    }
    for(const [pid,a] of actors)if(!alive.has(pid)){scene.remove(a);actors.delete(pid);}
    const tags=$('nametags');
    for(const element of [...tags.children])if(!actors.has(element.dataset.player))element.remove();
    if(screen==='game'&&room){
      camera.updateMatrixWorld();
      for(const [pid,actor] of actors){
        const player=s.players.find(p=>p.id===pid);
        let tag=[...tags.children].find(el=>el.dataset.player===pid);
        if(!tag){tag=document.createElement('span');tag.dataset.player=pid;tags.append(tag);}
        const point=actor.position.clone();point.y+=1.9;
        const depth=point.clone().applyMatrix4(camera.matrixWorldInverse).z;
        point.project(camera);
        tag.hidden=depth>=0||Math.abs(point.x)>1||Math.abs(point.y)>1||!world.sight(focus.p,player.p,s.open);
        tag.textContent=player.name;
        tag.style.left=(50+point.x*50)+'%';tag.style.top=(50-point.y*50)+'%';
      }
    }
    if(ghostVisual){
      ghostVisual.visible=!ghostView;
      ghostVisual.position.set(s.ghost.p[0],s.ghost.p[1]+.2*Math.sin(s.elapsed*4)+.3,s.ghost.p[2]);
      ghostVisual.rotation.y=s.ghost.yaw;
    }
    for(const item of s.items){
      const original=world.objects.get(item.id);
      if(original){original.visible=!item.taken&&!item.hidden;continue;}
      if(!itemMeshes.has(item.id))itemMeshes.set(item.id,extraMesh(item));
      const mesh=itemMeshes.get(item.id);if(mesh){mesh.visible=!item.taken;mesh.rotation.y=now*.001;}
    }
    animator.update(screen==='game'&&s.stage==='running'?dt:0,s.open,s.elapsed,s.done);
    for(const [door,o] of doorMeshes){
      if(world.nodes.get(door).animation?.default)continue;
      twist.copy(o.userData.closed);
      if(s.open[door])twist.multiply(new T.Quaternion().setFromAxisAngle(axis,1.48*s.open[door]));
      o.quaternion.copy(twist);
    }
    const role=me.role==='monster';
    $('danger').textContent=s.ghost.hunting?'RUn!!!':'';
    $('counter').textContent=role?'Monster · '+s.players.filter(p=>p.role==='survivor'&&p.alive).length+' alive':s.bags+' / '+s.required+' bags · '+me.eyes+' eyes';
    const tasks=objectives[s.objective].steps.filter(k=>!s.done[k]);
    $('checklist').textContent=role?'E / click to attack':!me.alive?'Spectating':vision?'Seeing through the monster':s.ready?'Return to the front door':tasks.length?'Objective · '+labels[tasks[0]]:'Find money bags';
    set('mapButton',!role);
    $('touchUse').textContent=role?'Attack':'Use';set('touchEye',!role);
    if(now>eventUntil){$('message').textContent='';if(!s.ghost.hunting)$('danger').textContent='';}
    target=null;
    if(!role&&!vision&&me.alive&&screen==='game'){
      target=findInteraction(s,me);
    }
    $('prompt').textContent=target?(coarse?'':'E · ')+labels[target.type]:'';
    audio.update(s,me,dt,screen==='game', {active:!!step,run:keys.has('ShiftLeft')||keys.has('ShiftRight')||runTouch});
    ui.update(s,me,target);
    if((s.stage==='ending'&&s.winner==='caught')||(dead&&s.elapsed-(me.caughtAt??-99)<1.75)){
      camera.lookAt(s.ghost.p[0],s.ghost.p[1]+1.45,-s.ghost.p[2]);
      const scareTime=s.stage==='ending'?1.75-s.ending:s.elapsed-me.caughtAt;
      camera.fov=60-50*Math.min(1,scareTime/.5);camera.updateProjectionMatrix();
      $('shade').style.background='rgba(0,0,0,'+Math.min(1,scareTime/2)+')';
    }else{camera.fov=60;camera.updateProjectionMatrix();$('shade').style.background='';}

  }else{
    camera.position.set(world.spawn[0],world.spawn[1]+1.51,-world.spawn[2]);
    camera.rotation.set(-.035,1.31+Math.sin(now*.00021)*.12,0,'YXZ');
    if(ghostVisual)ghostVisual.visible=false;
  }
  originalAmbient.value=ghostView?3:audio?.flash(s?.elapsed||0)?1.5:+$('brightness').value;
  if(me&&!me.alive&&s.stage==='running'&&s.elapsed-me.caughtAt>=1.75){const t=s.elapsed-me.caughtAt;$('shade').style.background=t>=1.75&&t<2.45?'rgba(0,0,0,'+Math.min(1,(t-1.75)/.35)+')':'';}
  flash.update(dt,s?.elapsed||0,!ghostView&&flashOn&&inGame);
  renderer.render(scene,camera);
}
function drawMap(){
  $('mapArtwork').src=asset('ui/'+(mapFloor<0?'start-1floor':mapFloor===0?'start0floor':'start')+'.png');
  for(const button of $('floors').children)button.classList.toggle('active',+button.dataset.floor===mapFloor);
}
function loop(now){
  const dt=clamp((now-frame)/1000,0,.07);frame=now;
  network(now);hostStep(dt);predict(dt);
  if(solo&&screen==='game'&&['running','ending'].includes(state?.stage)){
    solo.input(id,packet());accumulator+=dt;
    while(accumulator>=.025){solo.tick(.025);accumulator-=.025;}
    apply(solo.snapshot());
  }
  draw(now,dt);
  requestAnimationFrame(loop);
}
(async()=>{
  try{
    [data,bytes]=await Promise.all([fetch(asset('house.json')).then(r=>r.json()),fetch(asset('geometry.bin')).then(r=>r.arrayBuffer())]);
    world=buildWorld(data,bytes);audio=soundscape(data,world,()=>+$('volume').value);ui=await originalUI();renderWorld();const [texturesReady]=await Promise.all([Promise.all(startupTextures),loadPlayerModel(),document.fonts?.ready]);if(texturesReady.includes(false))throw Error('A scene texture could not load.');$('play').disabled=false;$('menuStatus').textContent='';menuState();requestAnimationFrame(loop);globalThis.dispatchEvent?.(new Event('eyes-ready'));
  }catch(e){$('menuStatus').textContent='Could not load the house. '+e.message;console.error(e);$('play').disabled=true;globalThis.dispatchEvent?.(new Event('eyes-load-error'));}
})();

let storyPage=0;
let storyTimer=0;
function beginStory(){
 storyPage=0;show('story');
 const count={casual:12,normal:20,hard:30}[$('difficulty').value];
 const transcript="> just wanna talk 'bout this break-in business\n> already checked it for ya\n> you could get at least "+count+" bags\n> i have the front door key\n> anything else?\n> make a map, that place is huge\n> >> logged out <<";
 const lines=transcript.split('\n');let line=0;
 clearInterval(storyTimer);$('storyText').textContent='';
 const next=()=>{if(screen!=='story'||storyPage||line>=lines.length){clearInterval(storyTimer);return;} $('storyText').textContent+=(line?'\n':'')+lines[line++];sound('chatPing',.6);};
 next();storyTimer=setInterval(next,550);
}
function advanceStory(){
 clearInterval(storyTimer);
 if(storyPage++===0){
  const count={casual:12,normal:20,hard:30}[$('difficulty').value];
  $('storyText').textContent='LEVEL: '+$('difficulty').value+'\n\n* Find at least '+count+' money bags then get back to the exit\n* Hide and/or run from threats\n* Preserve your stamina for dire situations\n* Use a map and Eyes to move safely';
 }else enter();
}
$('storyContinue').onclick=advanceStory;

$('replay').onclick=()=>{const difficulty=$('endDifficulty').value;leave();$('difficulty').value=difficulty;$('mode').value='solo';menuState();enter();};

$('lobbyChat').onsubmit=e=>{e.preventDefault();action.chat=$('lobbyChatText').value.trim();$('lobbyChatText').value='';};

function menuPage(page){
  document.querySelectorAll('[data-menu-page]').forEach(panel=>{panel.hidden=panel.dataset.menuPage!==page;});
  document.querySelector('.ngui-main-actions').hidden=page!=='home';
}
document.querySelectorAll('[data-menu-open]').forEach(button=>{button.onclick=()=>menuPage(button.dataset.menuOpen);});
for(const [pauseId,settingId] of [['pauseVolume','volume'],['pauseSensitivity','sensitivity'],['pauseBrightness','brightness']]){
  $(pauseId).oninput=()=>{$(settingId).value=$(pauseId).value;$(settingId).oninput?.();};
}
$('pauseFullscreen').onclick=()=>$('fullscreen').click();

const interactionRay=new T.Raycaster();

let menuMusic=null;
function startMenuMusic(){
  if(screen!=='menu'||menuMusic)return;
  menuMusic=new Audio(asset('menu.ogg'));menuMusic.loop=true;
  menuMusic.volume=+$('volume').value;
  menuMusic.play().catch(()=>{menuMusic=null;});
}
document.addEventListener('pointerdown',startMenuMusic);
document.getElementById('focusGate')?.addEventListener('click',startMenuMusic);
document.addEventListener('keydown',startMenuMusic);
