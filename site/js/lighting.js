import * as T from './three.js';
// Formula recovered from CustomD's LIGHTMAP_ON ARB program:
// tex.rgb * _FakeAmbient * lightmap.rgb * lightmap.a * 8.
export const originalAmbient={value:.25},originalTime={value:0};
export function unityMaterial(mat,description){
 mat.toneMapped=false;
 mat.onBeforeCompile=shader=>{
  shader.uniforms.originalAmbient=originalAmbient;
  shader.fragmentShader='uniform float originalAmbient;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',`
    vec3 outgoingLight;
    #ifdef USE_LIGHTMAP
      vec4 unityLM=texture2D(lightMap,vLightMapUv);
      outgoingLight=diffuseColor.rgb*unityLM.rgb*unityLM.a*8.0*originalAmbient;
      outgoingLight+=reflectedLight.directDiffuse*3.14159265;
    #else
      outgoingLight=reflectedLight.directDiffuse*3.14159265+reflectedLight.indirectDiffuse*originalAmbient*3.14159265;
    #endif
    outgoingLight+=totalEmissiveRadiance;`);
  // Replace the whole function: the previous substring did not exist in this Three build.
  // Unity 4's light attenuation lookup is approximated here; not an exact LUT export.
  const lights=T.ShaderChunk.lights_pars_begin.replace(/float getDistanceAttenuation[\s\S]*?(?=float getSpotAttenuation)/,`
  float getDistanceAttenuation(const in float d,const in float range,const in float decay){
    if(range<=0.0)return 1.0;
    float r=d/range;
    return pow(clamp(1.0-r*r,0.0,1.0),2.0)/(1.0+25.0*r*r);
  }
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <lights_pars_begin>',lights);
  shader.fragmentShader=shader.fragmentShader.replace('#include <colorspace_fragment>','');
 };
 mat.customProgramCacheKey=()=> 'unity4-rgbm-gamma-v3';return mat;
}
export function flashlight(scene,camera,data,geometry,texture){
 const lightNode=data.nodes.find(n=>n.behaviours.TurnOffFlashlight),source=lightNode.light;
 const holder=data.nodes.find(n=>n.name==='FlashlightPlaceholder');
 const coneNode=data.nodes.find(n=>n.name==='flashlight_cone'),desc=data.materials[coneNode.materials[0]];
 const rig=new T.Group();rig.scale.z=-1;scene.add(rig);
 let flickerAt=4+Math.random()*12, pulses=0, dark=false, lastTime=0;
 const pulseLength=()=>.03+Math.random()*.05;
 const spot=new T.SpotLight(new T.Color(...source.color.slice(0,3)),source.intensity,source.range,source.spot*Math.PI/360,.08,0);
 spot.map=texture(source.cookie,false);spot.position.fromArray(lightNode.p);const target=new T.Object3D();target.position.set(0,0,10);const lightRig=new T.Group();scene.add(lightRig);
 spot.position.z*=-1;target.position.z=-10;
 lightRig.add(spot,target);spot.target=target;
 const coneMaterial=new T.ShaderMaterial({transparent:true,depthTest:true,depthWrite:false,side:T.DoubleSide,toneMapped:false,uniforms:{mainTex:{value:texture(desc.t,false)},fogTex:{value:texture(desc.textures._FakeFog.file,false)},elapsed:originalTime},vertexShader:`
 varying vec2 tex;varying vec4 projected;varying float facing;
 void main(){vec4 mv=modelViewMatrix*vec4(position,1.);vec3 n=normalize(normalMatrix*normal);facing=pow(clamp(dot(normalize(-mv.xyz),n),0.,1.),2.);tex=uv;projected=projectionMatrix*mv;gl_Position=projected;}`,fragmentShader:`
 uniform sampler2D mainTex,fogTex;uniform float elapsed;varying vec2 tex;varying vec4 projected;varying float facing;
 void main(){vec3 weights=vec3(.2199707,.70703125,.070983887);vec4 base=texture2D(mainTex,tex);vec3 mist=texture2D(fogTex,projected.xy/projected.w+fract(elapsed/20.)).rgb;gl_FragColor=vec4(vec3(dot(base.rgb,weights)),base.a*dot(mist,weights)*facing);}`});
 const cone=new T.Mesh(geometry(coneNode),coneMaterial);cone.position.fromArray(coneNode.p).add(new T.Vector3(...lightNode.p));cone.quaternion.fromArray(coneNode.q);cone.scale.fromArray(coneNode.s);cone.renderOrder=100;rig.add(cone);
 let initialized=false;const offset=new T.Vector3(...holder.p);offset.z*=-1;const rotation=new T.Quaternion(-holder.q[0],-holder.q[1],holder.q[2],holder.q[3]);
 function update(dt,time,on){
  originalTime.value=time;
  camera.updateMatrixWorld();
  rig.position.copy(offset).applyMatrix4(camera.matrixWorld);
  const aim=camera.quaternion.clone().multiply(rotation);
  if(!initialized){rig.quaternion.copy(aim);initialized=true;}
  else rig.quaternion.slerp(aim,Math.min(1,12*dt));
  if(time<lastTime){flickerAt=time+4+Math.random()*12;dark=false;pulses=0;}
  lastTime=time;
  if(time>=flickerAt){
   if(dark){
    dark=false;
    flickerAt=time+(pulses?pulseLength():4+Math.random()*12);
   }else{
    if(!pulses)pulses=1+Math.floor(Math.random()*2);
    pulses--;dark=true;flickerAt=time+pulseLength();
   }
  }
  spot.intensity=dark?0:source.intensity;
  rig.visible=on;
  lightRig.position.copy(rig.position);lightRig.quaternion.copy(rig.quaternion);lightRig.visible=on;
 }

 return {update,rig,spot,lightNode};
}
