const key='eyes-achievements-v1';
const catalog={
 'escape':['First Escape','Escape the mansion.'],
 'scary':['No Fear','Escape on Actually Scary.'],
 'chaos':['Against the Odds','Escape a Chaos round after a modifier starts.'],
 'scaled':['Group Effort','Escape a multiplayer round with scaled bags.'],
 'versus':['House Rules','Win a Versus round as Krasue.'],
};
function read(){
 try{return JSON.parse(localStorage.getItem(key))||{};}catch{return {};}
}
export function recordAchievementRound(s,me){
 if(!me)return;
 const unlocked=read();
 const escape=s.winner==='escaped'&&me.role==='survivor'&&me.alive;
 const awards={
  escape,scary:escape&&s.difficulty==='scary',
  chaos:escape&&s.gameMode==='chaos'&&s.elapsed>=60,
  scaled:escape&&s.mode!=='solo'&&s.scaleBags,
  versus:s.mode==='versus'&&me.role==='monster'&&s.winner==='caught',
 };
 const earned=Object.keys(awards).filter(id=>awards[id]&&!unlocked[id]);
 if(!earned.length)return;
 for(const id of earned)unlocked[id]=Date.now();
 try{localStorage.setItem(key,JSON.stringify(unlocked));}catch{}
 document.getElementById('achievementRound').textContent='Unlocked · '+earned.map(id=>catalog[id][0]).join(', ');
}
export function showAchievements(){
 const button=document.getElementById('achievementsButton'), dialog=document.getElementById('achievements');
 button.onclick=()=>{
  const unlocked=read();
  document.getElementById('achievementList').replaceChildren(...Object.entries(catalog).map(([id,[title,description]])=>{
   const item=document.createElement('li');
   item.textContent=(unlocked[id]?'✓ ':'')+title+' · '+description;
   return item;
  }));
  dialog.showModal();
 };
}
