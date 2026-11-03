const byId = id => document.getElementById(id);

const destinoSelect = byId("destino");
const routeLine = byId("routeLine");
const routeHalo = byId("routeHalo");
const approachLine = byId("approachLine");
const gpsDot = byId("gpsDot");
const gpsPulse = byId("gpsPulse");
const gpsAccuracyCircle = byId("gpsAccuracyCircle");
const snapDot = byId("snapDot");
const destDot = byId("destDot");

const origemStatus = byId("origemStatus");
const gpsAccuracy = byId("gpsAccuracy");
const destinoStatus = byId("destinoStatus");
const distanciaStatus = byId("distanciaStatus");
const msg = byId("msg");
const accessInfo = byId("accessInfo");
const accessInfoText = byId("accessInfoText");
const mapStatus = byId("mapStatus");
const wakeStatus = byId("wakeStatus");

const gpsBadge = byId("gpsBadge");
const gpsBadgeText = byId("gpsBadgeText");

const viewport = byId("viewport");
const canvas = byId("canvas");

const locationModal = byId("locationModal");
const locationText = byId("locationText");
const locationHelp = byId("locationHelp");
const btnEnableLocation = byId("btnEnableLocation");
const btnUseGate = byId("btnUseGate");

let scale = 0.4;
let offsetX = 0;
let offsetY = 0;
let minScale = 0.2;
let maxScale = 2.4;

let gps = null;
let gpsPixel = null;
let locationWatchId = null;
let locationFallbackAccepted = false;

let routeStarted = false;
let currentDestinationId = null;
let lastRoutedGps = null;
let lastRouteAt = 0;

let screenWakeLock = null;
let wakeRetryTimer = null;
let wakeRetryInFlight = false;

const activePointers = new Map();
let lastSinglePointer = null;
let lastPinchDistance = null;
let lastPinchMid = null;

const destinos = ANCHORS.filter(a => a.id >= 1);
destinos.forEach(d => {
  const option = document.createElement("option");
  option.value = String(d.id);
  option.textContent = `${d.id} - ${d.nome}`;
  destinoSelect.appendChild(option);
});

function setGpsBadge(mode, text){
  gpsBadge.classList.remove("is-searching","is-live","is-off");
  gpsBadge.classList.add(mode);
  gpsBadgeText.textContent = text;
}

function clamp(value, min, max){
  return Math.min(max, Math.max(min, value));
}

function updateScaleLimits(){
  const vw = Math.max(1, viewport.clientWidth);
  const vh = Math.max(1, viewport.clientHeight);

  const fit = Math.min(vw / MAP_W, vh / MAP_H);
  minScale = Math.max(0.16, fit);
  maxScale = Math.max(2.2, minScale * 6.5);

  scale = clamp(scale, minScale, maxScale);
}

function clampOffsets(){
  const vw = viewport.clientWidth;
  const vh = viewport.clientHeight;
  const scaledW = MAP_W * scale;
  const scaledH = MAP_H * scale;

  if(scaledW <= vw){
    offsetX = (vw - scaledW) / 2;
  }else{
    offsetX = clamp(offsetX, vw - scaledW, 0);
  }

  if(scaledH <= vh){
    offsetY = (vh - scaledH) / 2;
  }else{
    offsetY = clamp(offsetY, vh - scaledH, 0);
  }
}

function applyTransform(){
  clampOffsets();
  canvas.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
}

function fitWholeMap(){
  updateScaleLimits();
  scale = minScale;
  offsetX = (viewport.clientWidth - MAP_W * scale) / 2;
  offsetY = (viewport.clientHeight - MAP_H * scale) / 2;
  applyTransform();
}

function centerAt(x, y, targetScale = scale){
  updateScaleLimits();
  scale = clamp(targetScale, minScale, maxScale);
  offsetX = viewport.clientWidth / 2 - x * scale;
  offsetY = viewport.clientHeight / 2 - y * scale;
  applyTransform();
}

function zoomAt(viewX, viewY, factor){
  updateScaleLimits();

  const mapX = (viewX - offsetX) / scale;
  const mapY = (viewY - offsetY) / scale;

  const nextScale = clamp(scale * factor, minScale, maxScale);
  offsetX = viewX - mapX * nextScale;
  offsetY = viewY - mapY * nextScale;
  scale = nextScale;

  applyTransform();
}

function fitRoute(points){
  if(!points || points.length < 2) return;

  const xs = points.map(p => p[0]);
  const ys = points.map(p => p[1]);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const padding = 150;
  const routeW = Math.max(80, maxX - minX + padding * 2);
  const routeH = Math.max(80, maxY - minY + padding * 2);

  updateScaleLimits();

  const nextScale = clamp(
    Math.min(viewport.clientWidth / routeW, viewport.clientHeight / routeH),
    minScale,
    Math.min(maxScale, 1.55)
  );

  centerAt((minX + maxX)/2, (minY + maxY)/2, nextScale);
}

function barycentric(p,a,b,c){
  const den = (b[1]-c[1])*(a[0]-c[0]) + (c[0]-b[0])*(a[1]-c[1]);

  if(Math.abs(den) < 1e-15) return null;

  const w1 = ((b[1]-c[1])*(p[0]-c[0]) + (c[0]-b[0])*(p[1]-c[1])) / den;
  const w2 = ((c[1]-a[1])*(p[0]-c[0]) + (a[0]-c[0])*(p[1]-c[1])) / den;
  const w3 = 1 - w1 - w2;

  return [w1,w2,w3];
}

function insideWeights(w){
  return w && w[0] >= -1e-8 && w[1] >= -1e-8 && w[2] >= -1e-8;
}

function geoToPixel(lat, lon){
  const p = [lon, lat];
  const calAnchors = (typeof GEO_ANCHORS !== "undefined" && GEO_ANCHORS.length) ? GEO_ANCHORS : ANCHORS;
  const calTriGeo = (typeof GEO_TRI_GEO !== "undefined" && GEO_TRI_GEO.length) ? GEO_TRI_GEO : TRI_GEO;

  for(const tri of calTriGeo){
    const A = calAnchors[tri[0]];
    const B = calAnchors[tri[1]];
    const C = calAnchors[tri[2]];

    const w = barycentric(p, [A.lon,A.lat], [B.lon,B.lat], [C.lon,C.lat]);

    if(insideWeights(w)){
      return {
        x:w[0]*A.x + w[1]*B.x + w[2]*C.x,
        y:w[0]*A.y + w[1]*B.y + w[2]*C.y
      };
    }
  }

  const near = [...calAnchors]
    .sort((a,b)=>{
      const da = (a.lat-lat)**2 + (a.lon-lon)**2;
      const db = (b.lat-lat)**2 + (b.lon-lon)**2;
      return da-db;
    })
    .slice(0,4);

  let sx=0, sy=0, sw=0;

  for(const a of near){
    const d = Math.hypot((a.lat-lat)*100000, (a.lon-lon)*100000);
    const w = 1 / Math.max(d*d, .0001);
    sx += a.x*w;
    sy += a.y*w;
    sw += w;
  }

  return {x:sx/sw, y:sy/sw};
}

function pixelToGeo(x,y){
  const p = [x,y];
  const calAnchors = (typeof GEO_ANCHORS !== "undefined" && GEO_ANCHORS.length) ? GEO_ANCHORS : ANCHORS;
  const calTriPix = (typeof GEO_TRI_PIX !== "undefined" && GEO_TRI_PIX.length) ? GEO_TRI_PIX : TRI_PIX;

  for(const tri of calTriPix){
    const A = calAnchors[tri[0]];
    const B = calAnchors[tri[1]];
    const C = calAnchors[tri[2]];

    const w = barycentric(p, [A.x,A.y], [B.x,B.y], [C.x,C.y]);

    if(insideWeights(w)){
      return {
        lat:w[0]*A.lat + w[1]*B.lat + w[2]*C.lat,
        lon:w[0]*A.lon + w[1]*B.lon + w[2]*C.lon
      };
    }
  }

  const near = [...calAnchors]
    .sort((a,b)=>{
      const da = (a.x-x)**2 + (a.y-y)**2;
      const db = (b.x-x)**2 + (b.y-y)**2;
      return da-db;
    })
    .slice(0,4);

  let slat=0, slon=0, sw=0;

  for(const a of near){
    const d = Math.hypot(a.x-x, a.y-y);
    const w = 1 / Math.max(d*d, .0001);
    slat += a.lat*w;
    slon += a.lon*w;
    sw += w;
  }

  return {lat:slat/sw, lon:slon/sw};
}

function haversine(a,b){
  const R = 6371000;
  const rad = Math.PI / 180;

  const p1 = a.lat*rad;
  const p2 = b.lat*rad;
  const dp = (b.lat-a.lat)*rad;
  const dl = (b.lon-a.lon)*rad;

  const s = Math.sin(dp/2)**2 +
    Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;

  return 2*R*Math.asin(Math.sqrt(s));
}

function pixelDistanceMeters(p1,p2){
  return haversine(
    pixelToGeo(p1[0],p1[1]),
    pixelToGeo(p2[0],p2[1])
  );
}

function projectionOnSegment(p,a,b){
  const vx = b[0]-a[0];
  const vy = b[1]-a[1];
  const wx = p[0]-a[0];
  const wy = p[1]-a[1];

  const vv = vx*vx + vy*vy;
  let t = vv===0 ? 0 : (wx*vx + wy*vy)/vv;

  t = clamp(t,0,1);

  const q = [
    a[0] + t*vx,
    a[1] + t*vy
  ];

  return {
    q,
    t,
    dPx:Math.hypot(p[0]-q[0], p[1]-q[1])
  };
}

function isPixelInsideCampus(p){
  return p &&
    p.x >= -100 && p.x <= MAP_W + 100 &&
    p.y >= -100 && p.y <= MAP_H + 100;
}

function localMeters(lat,lon,refLat){
  const rad = Math.PI / 180;
  return {
    x:lon * 111320 * Math.cos(refLat * rad),
    y:lat * 110540
  };
}

function geographicProjectionOnSegment(originGeo,aPixel,bPixel){
  const ga = pixelToGeo(aPixel[0],aPixel[1]);
  const gb = pixelToGeo(bPixel[0],bPixel[1]);
  const refLat = originGeo.lat;
  const p = localMeters(originGeo.lat,originGeo.lon,refLat);
  const a = localMeters(ga.lat,ga.lon,refLat);
  const b = localMeters(gb.lat,gb.lon,refLat);
  const vx = b.x-a.x, vy = b.y-a.y;
  const wx = p.x-a.x, wy = p.y-a.y;
  const vv = vx*vx + vy*vy;
  let t = vv===0 ? 0 : (wx*vx + wy*vy)/vv;
  t = clamp(t,0,1);
  const qPixel=[
    aPixel[0] + t*(bPixel[0]-aPixel[0]),
    aPixel[1] + t*(bPixel[1]-aPixel[1])
  ];
  const qGeo={
    lat:ga.lat + t*(gb.lat-ga.lat),
    lon:ga.lon + t*(gb.lon-ga.lon)
  };
  return {q:qPixel,qGeo,t,dMeters:haversine(originGeo,qGeo)};
}

function edgeSetForDestination(id){
  const targetId=String(id);
  if(targetId!=="9" && targetId!=="12") return EDGES;

  // Para 9/12, bloqueia somente os dois atalhos em contramão da malha geral.
  // Todas as demais vias continuam exatamente como na V11.1.
  const filtered=EDGES.filter(e=>!(
    (e.a==="U4" && e.b==="D9") ||
    (e.a==="U3" && e.b==="D12")
  ));
  return [...filtered,...SPECIAL_EDGES_9_12];
}

function baseAdjacency(edges=EDGES){
  const adj={};
  Object.keys(NODES).forEach(n=>adj[n]=[]);
  for(const e of edges){
    const a=NODES[e.a], b=NODES[e.b];
    const w=pixelDistanceMeters(a,b);
    adj[e.a].push({to:e.b,w});
    if(e.mode === "both") adj[e.b].push({to:e.a,w});
  }
  return adj;
}

function snapCandidates(originGeo,edges=EDGES){
  const list=[];
  for(let i=0;i<edges.length;i++){
    const e=edges[i];
    // Área roxa/proibida nunca é ponto de entrada para caminhão.
    if(e.kind === "purple") continue;
    const a=NODES[e.a], b=NODES[e.b];
    const pr=geographicProjectionOnSegment(originGeo,a,b);
    list.push({...pr,e,index:i});
  }
  list.sort((a,b)=>a.dMeters-b.dMeters);
  return list;
}

function adjacencyWithSnap(snap,edges=EDGES){
  const adj=baseAdjacency(edges);
  adj.START=[];
  const e=snap.e;
  const a=NODES[e.a], b=NODES[e.b];
  const total=pixelDistanceMeters(a,b);
  // Em qualquer segmento, o motorista só segue sentidos permitidos pelo mapa final.
  adj.START.push({to:e.b,w:(1-snap.t)*total});
  if(e.mode === "both") adj.START.push({to:e.a,w:snap.t*total});
  return adj;
}

function dijkstra(adj,start,target){
  const dist = {};
  const prev = {};
  const used = new Set();

  Object.keys(adj).forEach(k => dist[k] = Infinity);
  dist[start] = 0;

  while(true){
    let u = null;
    let best = Infinity;

    for(const k of Object.keys(adj)){
      if(!used.has(k) && dist[k] < best){
        best = dist[k];
        u = k;
      }
    }

    if(u === null) break;
    if(u === target) break;

    used.add(u);

    for(const e of adj[u] || []){
      const nd = dist[u] + e.w;

      if(nd < dist[e.to]){
        dist[e.to] = nd;
        prev[e.to] = u;
      }
    }
  }

  if(!isFinite(dist[target])) return null;

  const path = [];
  let u = target;

  while(u !== undefined){
    path.push(u);

    if(u === start) break;
    u = prev[u];
  }

  path.reverse();

  return {
    path,
    distance:dist[target]
  };
}

function clearRoute(){
  routeLine.setAttribute("points","");
  routeHalo.setAttribute("points","");
  approachLine.setAttribute("points","");
  snapDot.setAttribute("cx",-100);
  snapDot.setAttribute("cy",-100);
  destDot.setAttribute("cx",-100);
  destDot.setAttribute("cy",-100);
  distanciaStatus.textContent = "--";
  destinoStatus.textContent = "Nenhum";
  accessInfo.classList.add("hidden");
  currentDestinationId = null;
  routeStarted = false;
  stopWakeRetryLoop();

  if(screenWakeLock && !screenWakeLock.released){
    screenWakeLock.release().catch(()=>{});
  }
  screenWakeLock = null;
  wakeStatus.textContent = "Tela ativa ao navegar";
}

function currentOrigin(){
  if(gpsPixel && isPixelInsideCampus(gpsPixel)){
    return {
      x:gpsPixel.x,
      y:gpsPixel.y,
      label:"Localização atual",
      isGps:true
    };
  }

  const p = NODES.P0;

  return {
    x:p[0],
    y:p[1],
    label:"Portaria",
    isGps:false
  };
}

function routeDistanceLabel(meters){
  if(meters >= 1000){
    return `${(meters/1000).toFixed(2)} km`;
  }

  return `${Math.round(meters)} m`;
}

function buildRoute(id){
  const target = DEST_NODE[id];
  if(!target) return null;

  const routeEdges=edgeSetForDestination(id);
  const origin = currentOrigin();

  if(!origin.isGps || !gps){
    const adj = baseAdjacency(routeEdges);
    const result = dijkstra(adj,"P0",target);
    if(!result) return null;
    return {
      origin,
      result,
      snap:{q:NODES.P0,dMeters:0},
      approachMeters:0,
      networkPoints:result.path.map(n=>NODES[n]),
      allPoints:result.path.map(n=>NODES[n])
    };
  }

  const originGeo={lat:gps.lat,lon:gps.lon};
  const candidates=snapCandidates(originGeo,routeEdges);
  if(!candidates.length) return null;

  const nearest=candidates[0].dMeters;
  let best=null;

  // Se o GPS já está sobre/ao lado de uma via mapeada, essa via manda.
  // Isso impede "pular" de uma mão única para outra rua só para inventar uma rota.
  if(nearest <= 25){
    const snap=candidates[0];
    const result=dijkstra(adjacencyWithSnap(snap,routeEdges),"START",target);
    if(result) best={snap,result};
  }else{
    // Fora da pista (por exemplo, pessoa a pé): procura a via válida mais próxima.
    const limits=[Math.max(40,nearest+15),Math.max(65,nearest+35),Infinity];
    for(const limit of limits){
      for(const snap of candidates){
        if(snap.dMeters>limit) break;
        const result=dijkstra(adjacencyWithSnap(snap,routeEdges),"START",target);
        if(!result) continue;
        best={snap,result};
        break;
      }
      if(best) break;
    }
  }

  if(!best) return null;

  const networkPoints=[
    best.snap.q,
    ...best.result.path.filter(n=>n!=="START").map(n=>NODES[n])
  ];

  return {
    origin,
    result:best.result,
    snap:best.snap,
    approachMeters:best.snap.dMeters,
    networkPoints,
    allPoints:[[origin.x,origin.y],best.snap.q,...best.result.path.filter(n=>n!=="START").map(n=>NODES[n])]
  };
}

async function renderRoute(id, options = {}){
  const {fit=true, quiet=false} = options;
  const target = DEST_NODE[id];

  const data = buildRoute(id);

  if(!data){
    msg.textContent = "Não foi possível calcular uma rota a partir deste ponto. Procure um colaborador.";
    mapStatus.textContent = "Rota indisponível";
    return false;
  }

  currentDestinationId = String(id);
  routeStarted = true;

  const d = ANCHORS.find(a => String(a.id) === String(id));

  origemStatus.textContent = data.origin.label;
  destinoStatus.textContent = d ? d.nome : `Ponto ${id}`;

  const totalMeters = data.result.distance + data.approachMeters;
  distanciaStatus.textContent = routeDistanceLabel(totalMeters);

  const routePointsText = data.networkPoints
    .map(p => `${p[0]},${p[1]}`)
    .join(" ");

  routeHalo.setAttribute("points", routePointsText);
  routeLine.setAttribute("points", routePointsText);

  if(data.origin.isGps && data.approachMeters > 4){
    const approachText = [
      [data.origin.x,data.origin.y],
      data.snap.q
    ].map(p=>`${p[0]},${p[1]}`).join(" ");

    approachLine.setAttribute("points", approachText);
    accessInfo.classList.remove("hidden");
    accessInfoText.textContent = `Acesso inicial até a via: ${routeDistanceLabel(data.approachMeters)}`;
  }else{
    approachLine.setAttribute("points","");
    accessInfo.classList.add("hidden");
  }

  snapDot.setAttribute("cx",data.snap.q[0]);
  snapDot.setAttribute("cy",data.snap.q[1]);

  destDot.setAttribute("cx",NODES[target][0]);
  destDot.setAttribute("cy",NODES[target][1]);

  mapStatus.textContent = d ? `Rota para ${d.nome}` : "Rota ativa";

  if(!quiet){
    if(data.origin.isGps){
      msg.textContent = data.approachMeters > 12
        ? "GPS em tempo real ativo. A linha tracejada liga sua posição exata à via interna mais próxima."
        : "GPS em tempo real ativo. A rota começa da sua posição atual.";
    }else{
      msg.textContent = "Localização indisponível. A rota foi iniciada automaticamente na Portaria.";
    }
  }

  if(fit){
    fitRoute(data.allPoints);
  }

  await keepScreenAwake();

  return true;
}

function startWakeRetryLoop(){
  if(wakeRetryTimer) return;

  wakeRetryTimer = setInterval(async ()=>{
    if(
      routeStarted &&
      document.visibilityState === "visible" &&
      (!screenWakeLock || screenWakeLock.released)
    ){
      await keepScreenAwake();
    }
  }, 12000);
}

function stopWakeRetryLoop(){
  if(wakeRetryTimer){
    clearInterval(wakeRetryTimer);
    wakeRetryTimer = null;
  }
}

async function keepScreenAwake(force=false){
  if(!routeStarted && !force) return false;

  if(!("wakeLock" in navigator)){
    wakeStatus.textContent = "Tela: depende do aparelho";
    return false;
  }

  if(document.visibilityState !== "visible"){
    return false;
  }

  if(screenWakeLock && !screenWakeLock.released){
    wakeStatus.textContent = "Tela mantida ativa";
    startWakeRetryLoop();
    return true;
  }

  if(wakeRetryInFlight) return false;
  wakeRetryInFlight = true;

  try{
    screenWakeLock = await navigator.wakeLock.request("screen");
    wakeStatus.textContent = "Tela mantida ativa";
    startWakeRetryLoop();

    const thisLock = screenWakeLock;
    thisLock.addEventListener("release",()=>{
      if(screenWakeLock === thisLock){
        screenWakeLock = null;
      }

      if(routeStarted){
        wakeStatus.textContent = "Reativando tela...";
        setTimeout(()=>{
          if(
            routeStarted &&
            document.visibilityState === "visible" &&
            (!screenWakeLock || screenWakeLock.released)
          ){
            keepScreenAwake();
          }
        }, 400);
      }else{
        wakeStatus.textContent = "Tela ativa ao navegar";
      }
    });

    return true;
  }catch(e){
    screenWakeLock = null;
    wakeStatus.textContent = "Tela: depende do aparelho";
    startWakeRetryLoop();
    return false;
  }finally{
    wakeRetryInFlight = false;
  }
}

async function restoreWakeLock(){
  if(
    routeStarted &&
    document.visibilityState === "visible" &&
    (!screenWakeLock || screenWakeLock.released)
  ){
    await keepScreenAwake();
  }
}

document.addEventListener("visibilitychange",restoreWakeLock);
window.addEventListener("focus",restoreWakeLock);
window.addEventListener("pageshow",restoreWakeLock);

document.addEventListener("pointerdown",()=>{
  if(routeStarted){
    restoreWakeLock();
  }
},{passive:true});

function showLocationModal(type="unavailable"){
  if(locationFallbackAccepted) return;

  locationModal.classList.remove("hidden");
  locationHelp.classList.add("hidden");
  locationHelp.innerHTML = "";

  if(type === "denied"){
    locationText.textContent =
      "A localização está bloqueada para este site. Libere a permissão e tente novamente.";

    locationHelp.classList.remove("hidden");
    locationHelp.innerHTML =
      "<b>Android / Chrome:</b> toque no ícone ao lado do endereço → Permissões → Localização → Permitir.<br><br>" +
      "<b>iPhone:</b> Ajustes → Privacidade e Segurança → Serviços de Localização e permita o acesso ao navegador.";
  }else{
    locationText.textContent =
      "Ative o GPS/Localização do celular para iniciar a rota exatamente do ponto onde você está.";
  }
}

function hideLocationModal(){
  locationModal.classList.add("hidden");
}

function startLocationWatch(){
  if(!("geolocation" in navigator)){
    gpsError({code:2});
    return;
  }

  if(locationWatchId !== null){
    navigator.geolocation.clearWatch(locationWatchId);
  }

  setGpsBadge("is-searching","Buscando GPS...");

  locationWatchId = navigator.geolocation.watchPosition(
    updateGps,
    gpsError,
    {
      enableHighAccuracy:true,
      maximumAge:1000,
      timeout:15000
    }
  );
}

async function retryLocation(){
  locationFallbackAccepted = false;

  if(!("geolocation" in navigator)){
    showLocationModal("unavailable");
    return;
  }

  try{
    if(navigator.permissions?.query){
      const state = await navigator.permissions.query({name:"geolocation"});

      if(state.state === "denied"){
        showLocationModal("denied");
        return;
      }
    }
  }catch(e){}

  locationText.textContent = "Solicitando sua localização...";
  locationHelp.classList.add("hidden");

  navigator.geolocation.getCurrentPosition(
    pos=>{
      updateGps(pos);
      hideLocationModal();
      startLocationWatch();
    },
    err=>{
      if(err.code === 1) showLocationModal("denied");
      else showLocationModal("unavailable");
    },
    {
      enableHighAccuracy:true,
      maximumAge:0,
      timeout:15000
    }
  );
}

function setGpsMarker(p,accuracyMeters){
  gpsDot.setAttribute("cx",p.x);
  gpsDot.setAttribute("cy",p.y);

  gpsPulse.setAttribute("cx",p.x);
  gpsPulse.setAttribute("cy",p.y);

  const g1 = pixelToGeo(p.x,p.y);
  const g2 = pixelToGeo(p.x+10,p.y);
  const metersPerPixel = Math.max(haversine(g1,g2)/10,.1);

  gpsAccuracyCircle.setAttribute("cx",p.x);
  gpsAccuracyCircle.setAttribute("cy",p.y);
  gpsAccuracyCircle.setAttribute("r",Math.min(accuracyMeters/metersPerPixel,260));
}

function updateGps(pos){
  hideLocationModal();
  locationFallbackAccepted = false;

  gps = {
    lat:pos.coords.latitude,
    lon:pos.coords.longitude,
    accuracy:pos.coords.accuracy,
    heading:pos.coords.heading,
    speed:pos.coords.speed
  };

  gpsPixel = geoToPixel(gps.lat,gps.lon);

  if(!isPixelInsideCampus(gpsPixel)){
    origemStatus.textContent = "Fora da área mapeada";
    gpsAccuracy.textContent = `${Math.round(gps.accuracy)} m`;
    setGpsBadge("is-off","GPS fora da área");
    return;
  }

  setGpsMarker(gpsPixel,gps.accuracy);

  origemStatus.textContent = "Localização atual";
  gpsAccuracy.textContent = `± ${Math.round(gps.accuracy)} m`;
  setGpsBadge("is-live","GPS em tempo real");

  if(!routeStarted){
    msg.textContent = "Localização encontrada. Selecione o destino e toque em INICIAR ROTA.";
  }

  if(routeStarted && currentDestinationId){
    const now = Date.now();

    let movedEnough = true;

    if(lastRoutedGps){
      const moved = haversine(
        {lat:lastRoutedGps.lat,lon:lastRoutedGps.lon},
        {lat:gps.lat,lon:gps.lon}
      );

      movedEnough = moved >= 4;
    }

    if(movedEnough && now - lastRouteAt >= 1800){
      lastRouteAt = now;
      lastRoutedGps = {lat:gps.lat,lon:gps.lon};
      renderRoute(currentDestinationId,{fit:false,quiet:true});
    }
  }
}

function gpsError(err){
  gpsPixel = null;
  gps = null;

  gpsAccuracy.textContent = "--";
  origemStatus.textContent = "Portaria";
  setGpsBadge("is-off","GPS indisponível");

  if(err.code === 1){
    msg.textContent = "Localização não autorizada. A origem será a Portaria.";
    showLocationModal("denied");
  }else{
    msg.textContent = "Localização indisponível. A origem será a Portaria.";
    showLocationModal("unavailable");
  }
}

btnEnableLocation.addEventListener("click",retryLocation);

btnUseGate.addEventListener("click",()=>{
  locationFallbackAccepted = true;
  gpsPixel = null;
  gps = null;

  origemStatus.textContent = "Portaria";
  gpsAccuracy.textContent = "--";
  setGpsBadge("is-off","Usando Portaria");
  msg.textContent = "A origem será a Portaria.";

  hideLocationModal();
});

byId("btnRota").addEventListener("click",async ()=>{
  if(!destinoSelect.value){
    destinoSelect.focus();
    msg.textContent = "Selecione um destino para iniciar a rota.";
    return;
  }

  // Solicita o Wake Lock dentro do gesto do usuário, que é o cenário
  // mais confiável nos navegadores móveis.
  await keepScreenAwake(true);

  lastRoutedGps = gps ? {lat:gps.lat,lon:gps.lon} : null;
  lastRouteAt = Date.now();

  const routed = await renderRoute(destinoSelect.value,{fit:true,quiet:false});

  if(!routed && !routeStarted){
    stopWakeRetryLoop();
  }
});

destinoSelect.addEventListener("change",()=>{
  if(!destinoSelect.value){
    clearRoute();
    mapStatus.textContent = "Aguardando destino";
    return;
  }

  const d = ANCHORS.find(a => String(a.id) === destinoSelect.value);
  destinoStatus.textContent = d ? d.nome : "Selecionado";
});

byId("btnCenter").addEventListener("click",()=>{
  if(gpsPixel && isPixelInsideCampus(gpsPixel)){
    centerAt(gpsPixel.x,gpsPixel.y,Math.max(scale,minScale*2.2));
  }else{
    const p = NODES.P0;
    centerAt(p[0],p[1],Math.max(scale,minScale*2.2));
  }
});

byId("btnMais").addEventListener("click",()=>{
  zoomAt(viewport.clientWidth/2,viewport.clientHeight/2,1.25);
});

byId("btnMenos").addEventListener("click",()=>{
  zoomAt(viewport.clientWidth/2,viewport.clientHeight/2,0.8);
});

viewport.addEventListener("wheel",e=>{
  e.preventDefault();

  const rect = viewport.getBoundingClientRect();
  zoomAt(
    e.clientX - rect.left,
    e.clientY - rect.top,
    e.deltaY < 0 ? 1.14 : 0.88
  );
},{passive:false});

function pointerDistance(a,b){
  return Math.hypot(a.x-b.x,a.y-b.y);
}

function pointerMid(a,b){
  return {
    x:(a.x+b.x)/2,
    y:(a.y+b.y)/2
  };
}

viewport.addEventListener("pointerdown",e=>{
  viewport.setPointerCapture(e.pointerId);

  activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});

  if(activePointers.size === 1){
    lastSinglePointer = {x:e.clientX,y:e.clientY};
  }

  if(activePointers.size === 2){
    const pts = [...activePointers.values()];
    lastPinchDistance = pointerDistance(pts[0],pts[1]);
    lastPinchMid = pointerMid(pts[0],pts[1]);
    lastSinglePointer = null;
  }
});

viewport.addEventListener("pointermove",e=>{
  if(!activePointers.has(e.pointerId)) return;

  activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});

  if(activePointers.size === 1){
    const p = [...activePointers.values()][0];

    if(lastSinglePointer){
      offsetX += p.x - lastSinglePointer.x;
      offsetY += p.y - lastSinglePointer.y;
      applyTransform();
    }

    lastSinglePointer = p;
    return;
  }

  if(activePointers.size === 2){
    const pts = [...activePointers.values()];
    const dist = pointerDistance(pts[0],pts[1]);
    const mid = pointerMid(pts[0],pts[1]);

    if(lastPinchDistance && lastPinchMid){
      const rect = viewport.getBoundingClientRect();

      const currentViewX = lastPinchMid.x - rect.left;
      const currentViewY = lastPinchMid.y - rect.top;

      const mapX = (currentViewX - offsetX)/scale;
      const mapY = (currentViewY - offsetY)/scale;

      const nextScale = clamp(
        scale * (dist/lastPinchDistance),
        minScale,
        maxScale
      );

      const nextViewX = mid.x - rect.left;
      const nextViewY = mid.y - rect.top;

      offsetX = nextViewX - mapX*nextScale;
      offsetY = nextViewY - mapY*nextScale;
      scale = nextScale;

      applyTransform();
    }

    lastPinchDistance = dist;
    lastPinchMid = mid;
  }
});

function endPointer(e){
  activePointers.delete(e.pointerId);

  if(activePointers.size === 1){
    const p = [...activePointers.values()][0];
    lastSinglePointer = p;
    lastPinchDistance = null;
    lastPinchMid = null;
  }else if(activePointers.size === 0){
    lastSinglePointer = null;
    lastPinchDistance = null;
    lastPinchMid = null;
  }
}

viewport.addEventListener("pointerup",endPointer);
viewport.addEventListener("pointercancel",endPointer);

window.addEventListener("resize",()=>{
  const oldCenterX = (viewport.clientWidth/2 - offsetX)/scale;
  const oldCenterY = (viewport.clientHeight/2 - offsetY)/scale;

  updateScaleLimits();
  centerAt(oldCenterX,oldCenterY,scale);
});

requestAnimationFrame(()=>{
  fitWholeMap();
  startLocationWatch();
});
