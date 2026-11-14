import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
fs.rmSync('dist',{recursive:true,force:true});fs.cpSync('site','dist',{recursive:true});
const version=process.env.GITHUB_SHA||crypto.randomBytes(8).toString('hex');
fs.writeFileSync('dist/version.json',JSON.stringify({version}));
for(const name of fs.readdirSync('dist/js'))if(name.endsWith('.js')){
 const f=path.join('dist/js',name);let s=fs.readFileSync(f,'utf8');
 s=s.replace(/(from\s*['"]\.\/[^'"]+\.js)(['"])/g,`$1?v=${version}$2`);fs.writeFileSync(f,s);
}
const map=JSON.parse(fs.readFileSync('dist/asset-map.json','utf8')),renamed=new Map();
function fingerprint(relative){
 if(renamed.has(relative))return renamed.get(relative);
 const old=path.join('dist',relative),bytes=fs.readFileSync(old),hash=crypto.createHash('sha256').update(bytes).digest('hex').slice(0,12);
 const ext=path.extname(relative),next=relative.slice(0,-ext.length)+'.'+hash+ext;
 fs.renameSync(old,path.join('dist',next));renamed.set(relative,next);return next;
}
for(const key of Object.keys(map))map[key]=fingerprint(map[key]);
fs.writeFileSync('dist/asset-map.json',JSON.stringify(map));
const indexFile='dist/index.html';fs.writeFileSync(indexFile,fs.readFileSync(indexFile,'utf8').replace(/assets\/inline\/[a-zA-Z0-9.-]+/g,fingerprint));
const css='dist/ngui.css';
fs.writeFileSync(css,fs.readFileSync(css,'utf8').replace('assets/ui/button_sliced.png',renamed.get('assets/ui/button_sliced.png')||'assets/ui/button_sliced.png'));
const up='dist/updates.js';fs.writeFileSync(up,fs.readFileSync(up,'utf8').replace("const current='2026.11.14.2'",`const current='${version}'`));
const html='dist/index.html';fs.writeFileSync(html,fs.readFileSync(html,'utf8').replace("'./js/client.js'",`'./js/client.js?v=${version}'`).replace('./ngui.css"',`./ngui.css?v=${version}"`).replace('./updates.js"',`./updates.js?v=${version}"`).replace("'./asset-map.json'",`'./asset-map.json?v=${version}'`));
fs.writeFileSync('dist/.nojekyll','');
console.log('Built release '+version);
