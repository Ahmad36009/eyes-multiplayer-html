const current='2026.11.14.2';
const input=document.getElementById('updateUrl'),status=document.getElementById('updateStatus'),link=document.getElementById('updateLink');
input.value=new URL('./version.json',location.href).href;input.readOnly=true;
status.textContent='Version '+current+' · automatic checks enabled';
const banner=document.createElement('button');banner.hidden=true;banner.style.cssText='position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:1000;max-width:90vw';document.body.append(banner);
let pending=null,busy=false;
function showFeedNotice(){
 const message='A new version is live. Refresh the page after your match to update.';
 for(const id of ['socialFeed','lobbyFeed']){
  const feed=document.getElementById(id);
  if(!feed)continue;
  let notice=feed.nextElementSibling;
  if(!notice?.classList.contains('release-feed-notice')){
   notice=document.createElement('div');
   notice.className='release-feed-notice';
   notice.setAttribute('role','status');
   feed.after(notice);
  }
  if(notice.textContent!==message)notice.textContent=message;
 }
}
async function check(manual=false){
 if(busy)return;busy=true;
 try{
  const response=await fetch(input.value+'?t='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('Update check failed');
  const release=await response.json();
  if(typeof release.version!=='string')throw Error('Invalid version file');
  if(release.version===current){if(manual)status.textContent='You have the latest release ('+current+').';return;}
  if(pending!==release.version)showFeedNotice();
  pending=release.version;status.textContent='Update '+pending+' ready. Finish your match, then reload.';
  banner.textContent='Update ready — reload when finished';banner.hidden=false;
  link.href=location.pathname+'?v='+encodeURIComponent(pending);link.target='_self';link.textContent='Reload latest version';link.hidden=false;
 }catch(e){if(manual)status.textContent=e.message+' — the current game remains playable.';}finally{busy=false;}
}
function reload(event){if(globalThis.eyesInMatch&&!confirm('Leave this match and load the update?')){event?.preventDefault();return;}location.replace(location.pathname+'?v='+encodeURIComponent(pending));}
banner.onclick=reload;link.onclick=reload;document.getElementById('checkUpdate').onclick=()=>check(true);
setInterval(()=>{if(!document.hidden)check();},60000);addEventListener('focus',()=>check());check();
