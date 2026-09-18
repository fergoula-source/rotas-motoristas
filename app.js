const byId = id => document.getElementById(id);

const destinoSelect = byId("destino");
const routeLine = byId("routeLine");
const routeHalo = byId("routeHalo");
const gpsDot = byId("gpsDot");
const gpsAccuracyCircle = byId("gpsAccuracyCircle");
const snapDot = byId("snapDot");
const destDot = byId("destDot");
const origemStatus = byId("origemStatus");
const gpsAccuracy = byId("gpsAccuracy");
const destinoStatus = byId("destinoStatus");
const distanciaStatus = byId("distanciaStatus");
const msg = byId("msg");
const viewport = byId("viewport");
const canvas = byId("canvas");

let scale = 0.45, offsetX = 0, offsetY = 0, dragStart = null;
let gps = null;
let gpsPixel = null;
let wakeLock = null;
let routeActive = false;

const destinos = ANCHORS.filter(a => a.id >= 1);
destinos.forEach(d => {
  const op = document.createElement("option");
  op.value = String(d.id);
  op.textContent = `${d.id} - ${d.nome}`;
  destinoSelect.appendChild(op);
});

function clampOffsets(){
  const scaledW = MAP_W * scale;
  const scaledH = MAP_H * scale;
  const vw = viewport.clientWidth;
  const vh = viewport.clientHeight;

  if(scaledW <= vw){
    offsetX = (vw - scaledW) / 2;
  }else{
    offsetX = Math.min(0, Math.max(vw - scaledW, offsetX));
  }

  if(scaledH <= vh){
    offsetY = (vh - scaledH) / 2;
  }else{
    offsetY = Math.min(0, Math.max(vh - scaledH, offsetY));
  }
}

function applyTransform(){
  clampOffsets();
  canvas.style.transform = `translate(${offsetX}px,${offsetY}px) scale(${scale})`;
}
function centerAt(x,y,targetScale=scale){
  scale = targetScale;
  offsetX = viewport.clientWidth/2 - x*scale;
  offsetY = viewport.clientHeight/2 - y*scale;
  applyTransform();
}
function fitWholeMap(){
  const sx=viewport.clientWidth/MAP_W, sy=viewport.clientHeight/MAP_H;
  scale=Math.max(Math.min(sx,sy)*1.08,.25);
  offsetX=(viewport.clientWidth-MAP_W*scale)/2;
  offsetY=(viewport.clientHeight-MAP_H*scale)/2;
  applyTransform();
}

async function requestWakeLock(){
  if(!routeActive || !("wakeLock" in navigator)) return;

  try{
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
    });
  }catch(e){
    // O aparelho/navegador pode não oferecer suporte.
  }
}

document.addEventListener("visibilitychange", async () => {
  if(document.visibilityState === "visible" && routeActive && !wakeLock){
    await requestWakeLock();
  }
});

function barycentric(p,a,b,c){
  const den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
  if(Math.abs(den)<1e-15) return null;
  const w1=((b[1]-c[1])*(p[0]-c[0])+(c[0]-b[0])*(p[1]-c[1]))/den;
  const w2=((c[1]-a[1])*(p[0]-c[0])+(a[0]-c[0])*(p[1]-c[1]))/den;
  const w3=1-w1-w2;
  return [w1,w2,w3];
}
function insideWeights(w){ return w && w[0]>=-1e-8 && w[1]>=-1e-8 && w[2]>=-1e-8; }

function geoToPixel(lat,lon){
  const p=[lon,lat];
  for(const tri of TRI_GEO){
    const A=ANCHORS[tri[0]], B=ANCHORS[tri[1]], C=ANCHORS[tri[2]];
    const w=barycentric(p,[A.lon,A.lat],[B.lon,B.lat],[C.lon,C.lat]);
    if(insideWeights(w)){
      return {x:w[0]*A.x+w[1]*B.x+w[2]*C.x, y:w[0]*A.y+w[1]*B.y+w[2]*C.y};
    }
  }
  // Fora do casco: interpolação pelos 4 pontos mais próximos.
  const near=[...ANCHORS].sort((a,b)=>{
    const da=(a.lat-lat)**2+(a.lon-lon)**2, db=(b.lat-lat)**2+(b.lon-lon)**2;
    return da-db;
  }).slice(0,4);
  let sx=0,sy=0,sw=0;
  for(const a of near){
    const d=Math.hypot((a.lat-lat)*100000,(a.lon-lon)*100000);
    const w=1/Math.max(d*d,.0001); sx+=a.x*w; sy+=a.y*w; sw+=w;
  }
  return {x:sx/sw,y:sy/sw};
}

function pixelToGeo(x,y){
  const p=[x,y];
  for(const tri of TRI_PIX){
    const A=ANCHORS[tri[0]], B=ANCHORS[tri[1]], C=ANCHORS[tri[2]];
    const w=barycentric(p,[A.x,A.y],[B.x,B.y],[C.x,C.y]);
    if(insideWeights(w)){
      return {lat:w[0]*A.lat+w[1]*B.lat+w[2]*C.lat, lon:w[0]*A.lon+w[1]*B.lon+w[2]*C.lon};
    }
  }
  const near=[...ANCHORS].sort((a,b)=>{
    const da=(a.x-x)**2+(a.y-y)**2, db=(b.x-x)**2+(b.y-y)**2;
    return da-db;
  }).slice(0,4);
  let slat=0,slon=0,sw=0;
  for(const a of near){
    const d=Math.hypot(a.x-x,a.y-y);
    const w=1/Math.max(d*d,.0001); slat+=a.lat*w; slon+=a.lon*w; sw+=w;
  }
  return {lat:slat/sw,lon:slon/sw};
}

function haversine(a,b){
  const R=6371000, rad=Math.PI/180;
  const p1=a.lat*rad,p2=b.lat*rad,dp=(b.lat-a.lat)*rad,dl=(b.lon-a.lon)*rad;
  const s=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*R*Math.asin(Math.sqrt(s));
}
function pixelDistanceMeters(p1,p2){ return haversine(pixelToGeo(p1[0],p1[1]),pixelToGeo(p2[0],p2[1])); }

function projectionOnSegment(p,a,b){
  const vx=b[0]-a[0],vy=b[1]-a[1],wx=p[0]-a[0],wy=p[1]-a[1];
  const vv=vx*vx+vy*vy;
  let t=vv===0?0:(wx*vx+wy*vy)/vv;
  t=Math.max(0,Math.min(1,t));
  const q=[a[0]+t*vx,a[1]+t*vy];
  return {q,t,d:Math.hypot(p[0]-q[0],p[1]-q[1])};
}

function makeAdjacency(extraStartPixel){
  const adj={};
  Object.keys(NODES).forEach(n=>adj[n]=[]);
  for(const e of EDGES){
    const a=NODES[e.a], b=NODES[e.b];
    const w=pixelDistanceMeters(a,b);
    adj[e.a].push({to:e.b,w});
    if(e.mode==="both") adj[e.b].push({to:e.a,w});
  }

  let snap=null;
  if(extraStartPixel){
    for(let i=0;i<EDGES.length;i++){
      const e=EDGES[i], a=NODES[e.a],b=NODES[e.b];
      const pr=projectionOnSegment([extraStartPixel.x,extraStartPixel.y],a,b);
      if(!snap || pr.d<snap.d) snap={...pr,e,index:i};
    }
    adj.START=[];
    const e=snap.e, a=NODES[e.a], b=NODES[e.b];
    const total=pixelDistanceMeters(a,b);
    // Em via de ida, a posição atual só segue no sentido a -> b.
    adj.START.push({to:e.b,w:(1-snap.t)*total});
    // Em mão dupla, pode seguir para qualquer lado.
    if(e.mode==="both") adj.START.push({to:e.a,w:snap.t*total});
  }
  return {adj,snap};
}

function dijkstra(adj,start,target){
  const dist={},prev={},used=new Set();
  Object.keys(adj).forEach(k=>dist[k]=Infinity);
  dist[start]=0;
  while(true){
    let u=null,best=Infinity;
    for(const k of Object.keys(adj)){
      if(!used.has(k) && dist[k]<best){best=dist[k];u=k;}
    }
    if(u===null) break;
    if(u===target) break;
    used.add(u);
    for(const e of adj[u]||[]){
      const nd=dist[u]+e.w;
      if(nd<dist[e.to]){dist[e.to]=nd;prev[e.to]=u;}
    }
  }
  if(!isFinite(dist[target])) return null;
  const path=[]; let u=target;
  while(u!==undefined){path.push(u); if(u===start)break; u=prev[u];}
  path.reverse();
  return {path,distance:dist[target]};
}

function currentOriginPixel(){
  if(gpsPixel){
    return {x:gpsPixel.x,y:gpsPixel.y,label:"Minha localização"};
  }

  const p=NODES.P0;
  return {x:p[0],y:p[1],label:"Portaria"};
}

async function routeToDestination(id){
  const target=DEST_NODE[id];
  if(!target) return;

  const origin=currentOriginPixel();
  let result,snap,points;

  if(origin.label==="Portaria"){
    const {adj}=makeAdjacency(null);
    result=dijkstra(adj,"P0",target);
    if(!result) return failRoute();
    points=result.path.map(n=>NODES[n]);
    snap={q:NODES.P0,d:0};
  }else{
    const built=makeAdjacency(origin);
    snap=built.snap;
    // Evita "teletransportar" o caminhão para uma via muito distante.
    if(!snap || snap.d>140){
      msg.textContent="Sua posição parece estar distante das vias cadastradas. Confira o GPS ou procure um colaborador.";
      return;
    }
    result=dijkstra(built.adj,"START",target);
    if(!result) return failRoute();
    points=[snap.q,...result.path.filter(n=>n!=="START").map(n=>NODES[n])];
  }

  const d=ANCHORS.find(a=>String(a.id)===String(id));
  destinoStatus.textContent=d.nome;
  origemStatus.textContent=origin.label;
  distanciaStatus.textContent=result.distance>=1000 ? (result.distance/1000).toFixed(2)+" km" : Math.round(result.distance)+" m";

  const txt=points.map(p=>`${p[0]},${p[1]}`).join(" ");
  routeHalo.setAttribute("points",txt);
  routeLine.setAttribute("points",txt);
  snapDot.setAttribute("cx",snap.q[0]); snapDot.setAttribute("cy",snap.q[1]);
  destDot.setAttribute("cx",NODES[target][0]); destDot.setAttribute("cy",NODES[target][1]);

  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  const minx=Math.min(...xs),maxx=Math.max(...xs),miny=Math.min(...ys),maxy=Math.max(...ys);
  const cx=(minx+maxx)/2,cy=(miny+maxy)/2;
  const s=Math.min(viewport.clientWidth/(maxx-minx+220),viewport.clientHeight/(maxy-miny+220));
  centerAt(cx,cy,Math.max(.42,Math.min(s,1.45)));

  routeActive = true;
  await requestWakeLock();

  if(origin.label==="Portaria"){
    msg.textContent="Localização não disponível. A rota foi iniciada automaticamente na Portaria.";
  }else if(snap.d>35){
    msg.textContent="Sua localização foi ajustada para a via permitida mais próxima.";
  }else{
    msg.textContent="Rota calculada a partir da sua localização atual.";
  }
}

function failRoute(){
  routeHalo.setAttribute("points","");
  routeLine.setAttribute("points","");
  distanciaStatus.textContent="--";
  msg.textContent="Não existe uma rota de entrada permitida desse ponto até o destino. Procure um colaborador.";
}

byId("btnRota").addEventListener("click",()=>{
  if(!destinoSelect.value){alert("Selecione um destino.");return;}
  routeToDestination(destinoSelect.value);
});


byId("btnMais").addEventListener("click",()=>{
  const cx=(viewport.clientWidth/2-offsetX)/scale,cy=(viewport.clientHeight/2-offsetY)/scale;
  centerAt(cx,cy,Math.min(scale*1.25,2.2));
});
byId("btnMenos").addEventListener("click",()=>{
  const cx=(viewport.clientWidth/2-offsetX)/scale,cy=(viewport.clientHeight/2-offsetY)/scale;
  centerAt(cx,cy,Math.max(scale/1.25,.25));
});

viewport.addEventListener("pointerdown",e=>{
  dragStart={x:e.clientX,y:e.clientY,ox:offsetX,oy:offsetY};
  viewport.setPointerCapture(e.pointerId);
});
viewport.addEventListener("pointermove",e=>{
  if(!dragStart)return;
  offsetX=dragStart.ox+(e.clientX-dragStart.x);
  offsetY=dragStart.oy+(e.clientY-dragStart.y);
  applyTransform();
});
viewport.addEventListener("pointerup",()=>dragStart=null);
viewport.addEventListener("pointercancel",()=>dragStart=null);

function updateGps(pos){
  gps={lat:pos.coords.latitude,lon:pos.coords.longitude,accuracy:pos.coords.accuracy};
  gpsPixel=geoToPixel(gps.lat,gps.lon);
  gpsDot.setAttribute("cx",gpsPixel.x);
  gpsDot.setAttribute("cy",gpsPixel.y);
  origemStatus.textContent="Minha localização";

  // Círculo de precisão aproximado em pixels, calculado localmente.
  const g1=pixelToGeo(gpsPixel.x,gpsPixel.y);
  const g2=pixelToGeo(gpsPixel.x+10,gpsPixel.y);
  const mpp=Math.max(haversine(g1,g2)/10,.1);
  gpsAccuracyCircle.setAttribute("cx",gpsPixel.x);
  gpsAccuracyCircle.setAttribute("cy",gpsPixel.y);
  gpsAccuracyCircle.setAttribute("r",Math.min(gps.accuracy/mpp,250));
  gpsAccuracy.textContent=Math.round(gps.accuracy)+" m";
  msg.textContent="Localização encontrada. Selecione o destino e toque em INICIAR ROTA.";
}

function gpsError(err){
  gpsPixel = null;
  gpsAccuracy.textContent="--";
  origemStatus.textContent="Portaria";

  if(err.code===1){
    msg.textContent="Localização não autorizada. A origem será a Portaria.";
  }else{
    msg.textContent="Localização indisponível. A origem será a Portaria.";
  }
}

if("geolocation" in navigator){
  navigator.geolocation.watchPosition(updateGps,gpsError,{enableHighAccuracy:true,maximumAge:1500,timeout:15000});
}else gpsError({code:2});

window.addEventListener("resize",fitWholeMap);
fitWholeMap();
