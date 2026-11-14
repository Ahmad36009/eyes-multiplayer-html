export function originalUI(){
 const danger=document.getElementById('danger');
 return {update(state,player,target){
   danger.classList.toggle('warning',state.ghost.hunting&&player.role!=='monster');
   document.getElementById('crosshair').classList.toggle('usable',!!target);
 }};
}
