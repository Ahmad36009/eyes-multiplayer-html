export default {async fetch(request,env){
 const origin=request.headers.get('Origin');const allowed=env.ALLOWED_ORIGIN;
 const headers={'Access-Control-Allow-Origin':allowed,'Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization','Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
 const send=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(origin!==allowed)return send({error:'Origin not allowed'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 const path=new URL(request.url).pathname,now=Date.now();
 try{
 if(path==='/api/lobbies'&&request.method==='GET'){
  const {results}=await env.DB.prepare('SELECT body FROM lobbies WHERE expires>? ORDER BY expires DESC LIMIT 100').bind(now).all();return send(results.map(r=>JSON.parse(r.body)));
 }
 if(path!=='/api/lobbies')return send({error:'Not found'},404);
 if(Number(request.headers.get('Content-Length'))>4096)return send({error:'Too large'},413);
 const raw=await request.text();if(raw.length>4096)return send({error:'Too large'},413);const data=JSON.parse(raw);
 if(!/^[A-Z2-9]{6}$/.test(data.code||''))return send({error:'Invalid code'},400);
 const token=request.headers.get('Authorization')?.replace(/^Bearer /,'');if(!token||token.length<24||token.length>128)return send({error:'Missing lobby token'},401);
 if(request.method==='DELETE'){await env.DB.prepare('DELETE FROM lobbies WHERE code=? AND token=?').bind(data.code,token).run();return send({ok:true});}
 if(request.method!=='POST')return send({error:'Method not allowed'},405);
 if(!['coop','versus'].includes(data.mode)||!['casual','normal','hard','scary'].includes(data.difficulty)||!['lobby','running','ending','ended'].includes(data.stage))return send({error:'Invalid lobby'},400);
 const body=JSON.stringify({code:data.code,name:String(data.name||'Eyes lobby').slice(0,40),host:String(data.host||'Survivor').slice(0,24),mode:data.mode,difficulty:data.difficulty,objective:'classic',players:Math.max(0,Math.min(5,Number(data.players)||0)),capacity:5,stage:data.stage,monsterTaken:!!data.monsterTaken,version:String(data.version||'').slice(0,64)});
 const old=await env.DB.prepare('SELECT token,expires FROM lobbies WHERE code=?').bind(data.code).first();if(old&&old.expires>now&&old.token!==token)return send({error:'Code in use'},409);
 await env.DB.prepare('INSERT INTO lobbies(code,token,body,expires) VALUES(?,?,?,?) ON CONFLICT(code) DO UPDATE SET token=excluded.token,body=excluded.body,expires=excluded.expires WHERE lobbies.token=excluded.token OR lobbies.expires<=?').bind(data.code,token,body,now+90000,now).run();
 await env.DB.prepare('DELETE FROM lobbies WHERE expires<?').bind(now-3600000).run();return send({ok:true});
 }catch{return send({error:'Invalid request or unavailable database'},400);}
}};

