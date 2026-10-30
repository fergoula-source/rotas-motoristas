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

  for(const tri of TRI_GEO){
    const A = ANCHORS[tri[0]];
    const B = ANCHORS[tri[1]];
    const C = ANCHORS[tri[2]];

    const w = barycentric(p, [A.lon,A.lat], [B.lon,B.lat], [C.lon,C.lat]);

    if(insideWeights(w)){
      return {
        x:w[0]*A.x + w[1]*B.x + w[2]*C.x,
        y:w[0]*A.y + w[1]*B.y + w[2]*C.y
      };
    }
  }

  const near = [...ANCHORS]
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

  for(const tri of TRI_PIX){
    const A = ANCHORS[tri[0]];
    const B = ANCHORS[tri[1]];
    const C = ANCHORS[tri[2]];

    const w = barycentric(p, [A.x,A.y], [B.x,B.y], [C.x,C.y]);

    if(insideWeights(w)){
      return {
        lat:w[0]*A.lat + w[1]*B.lat + w[2]*C.lat,
        lon:w[0]*A.lon + w[1]*B.lon + w[2]*C.lon
      };
    }
  }

  const near = [...ANCHORS]
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

function projectGeoToSegment(p,a,b){
  const rad = Math.PI / 180;
  const meanLat = ((a.lat + b.lat + p.lat) / 3) * rad;
  const metersPerLat = 111320;
  const metersPerLon = 111320 * Math.cos(meanLat);

  const ax = a.lon * metersPerLon;
  const ay = a.lat * metersPerLat;
  const bx = b.lon * metersPerLon;
  const by = b.lat * metersPerLat;
  const px = p.lon * metersPerLon;
  const py = p.lat * metersPerLat;

  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const vv = vx*vx + vy*vy;

  let t = vv === 0 ? 0 : (wx*vx + wy*vy) / vv;
  t = clamp(t,0,1);

  const qx = ax + t*vx;
  const qy = ay + t*vy;

  return {
    t,
    dMeters:Math.hypot(px-qx,py-qy),
    qGeo:{
      lat:a.lat + t*(b.lat-a.lat),
      lon:a.lon + t*(b.lon-a.lon)
    }
  };
}

function makeAdjacency(extraStartGeo){
  const adj = {};
  Object.keys(NODES).forEach(n => adj[n] = []);

  for(const e of EDGES){
    const aGeo = NODE_GEO[e.a];
    const bGeo = NODE_GEO[e.b];
    const w = haversine(aGeo,bGeo);

    adj[e.a].push({to:e.b,w});

    if(e.mode === "both"){
      adj[e.b].push({to:e.a,w});
    }
  }

  const startOptions = [];

  if(extraStartGeo){
    const candidates = [];

    for(let i=0; i<EDGES.length; i++){
      const e = EDGES[i];
      const aGeo = NODE_GEO[e.a];
      const bGeo = NODE_GEO[e.b];
      const pr = projectGeoToSegment(extraStartGeo,aGeo,bGeo);

      const aPx = NODES[e.a];
      const bPx = NODES[e.b];
      const q = [
        aPx[0] + pr.t*(bPx[0]-aPx[0]),
        aPx[1] + pr.t*(bPx[1]-aPx[1])
      ];

      candidates.push({...pr,q,e,index:i});
    }

    candidates.sort((a,b)=>a.dMeters-b.dMeters);

    const nearest = candidates[0]?.dMeters ?? Infinity;
    const usable = candidates
      .filter(c => c.dMeters <= Math.min(90,nearest + 35))
      .slice(0,8);

    adj.START = [];

    for(const c of usable){
      const e = c.e;
      const total = haversine(NODE_GEO[e.a],NODE_GEO[e.b]);

      const forward = {
        to:e.b,
        w:c.dMeters + (1-c.t)*total,
        approachMeters:c.dMeters,
        q:c.q,
        qGeo:c.qGeo,
        edge:e
      };

      adj.START.push({to:forward.to,w:forward.w});
      startOptions.push(forward);

      if(e.mode === "both"){
        const backward = {
          to:e.a,
          w:c.dMeters + c.t*total,
          approachMeters:c.dMeters,
          q:c.q,
          qGeo:c.qGeo,
          edge:e
        };

        adj.START.push({to:backward.to,w:backward.w});
        startOptions.push(backward);
      }
    }
  }

  return {adj,startOptions};
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

  const origin = currentOrigin();

  if(!origin.isGps){
    const {adj} = makeAdjacency(null);
    const result = dijkstra(adj,"P0",target);

    if(!result) return null;

    return {
      origin,
      result,
      snap:{q:NODES.P0,dMeters:0},
      approachMeters:0,
      networkPoints:result.path.map(n=>NODES[n]),
      allPoints:result.path.map(n=>NODES[n]),
      totalMeters:result.distance
    };
  }

  const built = makeAdjacency({lat:gps.lat,lon:gps.lon});
  const result = dijkstra(built.adj,"START",target);

  if(!result || !built.startOptions.length) return null;

  const firstNode = result.path.find(n => n !== "START");
  const chosen = built.startOptions
    .filter(o => o.to === firstNode)
    .sort((a,b)=>a.w-b.w)[0];

  if(!chosen) return null;

  const networkPoints = [
    chosen.q,
    ...result.path
      .filter(n => n !== "START")
      .map(n => NODES[n])
  ];

  return {
    origin,
    result,
    snap:{q:chosen.q,dMeters:chosen.approachMeters},
    approachMeters:chosen.approachMeters,
    networkPoints,
    allPoints:[
      [origin.x,origin.y],
      chosen.q,
      ...result.path
        .filter(n => n !== "START")
        .map(n => NODES[n])
    ],
    totalMeters:result.distance
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

  const totalMeters = data.totalMeters ?? data.result.distance;
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

async function keepScreenAwake(){
  if(!routeStarted) return false;

  if(!("wakeLock" in navigator)){
    wakeStatus.textContent = "Tela: depende do aparelho";
    return false;
  }

  try{
    if(screenWakeLock) return true;

    screenWakeLock = await navigator.wakeLock.request("screen");
    wakeStatus.textContent = "Tela mantida ativa";

    screenWakeLock.addEventListener("release",()=>{
      screenWakeLock = null;
      wakeStatus.textContent = "Tela ativa ao navegar";
    });

    return true;
  }catch(e){
    screenWakeLock = null;
    wakeStatus.textContent = "Tela: depende do aparelho";
    return false;
  }
}

document.addEventListener("visibilitychange", async ()=>{
  if(document.visibilityState === "visible" && routeStarted && !screenWakeLock){
    await keepScreenAwake();
  }
});

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

  lastRoutedGps = gps ? {lat:gps.lat,lon:gps.lon} : null;
  lastRouteAt = Date.now();

  await renderRoute(destinoSelect.value,{fit:true,quiet:false});
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
