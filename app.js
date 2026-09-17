const destinoSelect = document.getElementById("destino");
const routeLine = document.getElementById("routeLine");
const gpsDot = document.getElementById("gpsDot");
const gpsAccuracyCircle = document.getElementById("gpsAccuracyCircle");
const destDot = document.getElementById("destDot");

const gpsStatus = document.getElementById("gpsStatus");
const gpsAccuracy = document.getElementById("gpsAccuracy");
const destinoStatus = document.getElementById("destinoStatus");
const distanciaStatus = document.getElementById("distanciaStatus");

const viewport = document.getElementById("viewport");
const canvas = document.getElementById("canvas");

let scale = 0.45;
let offsetX = 0;
let offsetY = 0;
let dragStart = null;
let gpsPixel = null;

DESTINOS.forEach(d => {
  const op = document.createElement("option");
  op.value = d.id;
  op.textContent = d.id + " - " + d.nome.replace(/^Ponto de Carregamento \d+$/, "Ponto de Carregamento");
  destinoSelect.appendChild(op);
});

function applyTransform() {
  canvas.style.transform = `translate(${offsetX}px,${offsetY}px) scale(${scale})`;
}

function centerAt(x, y, targetScale = scale) {
  scale = targetScale;
  offsetX = viewport.clientWidth / 2 - x * scale;
  offsetY = viewport.clientHeight / 2 - y * scale;
  applyTransform();
}

function fitWholeMap() {
  const sx = viewport.clientWidth / MAP_W;
  const sy = viewport.clientHeight / MAP_H;
  scale = Math.max(Math.min(sx, sy) * 1.1, 0.25);
  offsetX = (viewport.clientWidth - MAP_W * scale) / 2;
  offsetY = (viewport.clientHeight - MAP_H * scale) / 2;
  applyTransform();
}

function geoToPixel(lat, lon) {
  const l1 = lat - GEO.C;
  const l2 = lon - GEO.F;
  const det = GEO.A * GEO.E - GEO.B * GEO.D;

  const x = (l1 * GEO.E - GEO.B * l2) / det;
  const y = (GEO.A * l2 - l1 * GEO.D) / det;
  return {x, y};
}

function pixelToGeo(x, y) {
  return {
    lat: GEO.A*x + GEO.B*y + GEO.C,
    lon: GEO.D*x + GEO.E*y + GEO.F
  };
}

function haversine(a, b) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const p1 = a.lat * rad;
  const p2 = b.lat * rad;
  const dp = (b.lat - a.lat) * rad;
  const dl = (b.lon - a.lon) * rad;
  const s = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function routeDistance(route) {
  let total = 0;
  for (let i=1; i<route.length; i++) {
    total += haversine(pixelToGeo(route[i-1][0], route[i-1][1]),
                       pixelToGeo(route[i][0], route[i][1]));
  }
  return total;
}

function drawRoute(id) {
  const d = DESTINOS.find(x => x.id === id);
  const route = ROTAS[id];

  if (!d || !route) return;

  routeLine.setAttribute("points", route.map(p => `${p[0]},${p[1]}`).join(" "));
  destDot.setAttribute("cx", d.x);
  destDot.setAttribute("cy", d.y);

  destinoStatus.textContent = d.nome;
  const dist = routeDistance(route);
  distanciaStatus.textContent = dist >= 1000
    ? (dist/1000).toFixed(2) + " km"
    : Math.round(dist) + " m";

  const xs = route.map(p=>p[0]);
  const ys = route.map(p=>p[1]);
  const cx = (Math.min(...xs)+Math.max(...xs))/2;
  const cy = (Math.min(...ys)+Math.max(...ys))/2;

  const routeW = Math.max(...xs)-Math.min(...xs)+180;
  const routeH = Math.max(...ys)-Math.min(...ys)+180;
  const s = Math.min(viewport.clientWidth/routeW, viewport.clientHeight/routeH);
  centerAt(cx, cy, Math.max(0.4, Math.min(s, 1.25)));
}

document.getElementById("btnRota").addEventListener("click", () => {
  if (!destinoSelect.value) {
    alert("Selecione um destino.");
    return;
  }
  drawRoute(destinoSelect.value);
});

document.getElementById("btnPortaria").addEventListener("click", () => {
  gpsPixel = {x:PORTARIA.x, y:PORTARIA.y};
  gpsDot.setAttribute("cx", PORTARIA.x);
  gpsDot.setAttribute("cy", PORTARIA.y);
  gpsAccuracyCircle.setAttribute("cx", PORTARIA.x);
  gpsAccuracyCircle.setAttribute("cy", PORTARIA.y);
  gpsAccuracyCircle.setAttribute("r", 0);
  gpsStatus.textContent = "modo de teste: Portaria";
  gpsAccuracy.textContent = "--";
  centerAt(PORTARIA.x, PORTARIA.y, 1.0);
});

document.getElementById("btnMinhaPosicao").addEventListener("click", () => {
  if (gpsPixel) centerAt(gpsPixel.x, gpsPixel.y, Math.max(scale, 1.0));
});

document.getElementById("btnMais").addEventListener("click", () => {
  const cx = (viewport.clientWidth/2-offsetX)/scale;
  const cy = (viewport.clientHeight/2-offsetY)/scale;
  centerAt(cx,cy,Math.min(scale*1.25,2.2));
});
document.getElementById("btnMenos").addEventListener("click", () => {
  const cx = (viewport.clientWidth/2-offsetX)/scale;
  const cy = (viewport.clientHeight/2-offsetY)/scale;
  centerAt(cx,cy,Math.max(scale/1.25,0.25));
});

viewport.addEventListener("pointerdown", e => {
  dragStart = {x:e.clientX,y:e.clientY,ox:offsetX,oy:offsetY};
  viewport.setPointerCapture(e.pointerId);
});
viewport.addEventListener("pointermove", e => {
  if (!dragStart) return;
  offsetX = dragStart.ox + (e.clientX-dragStart.x);
  offsetY = dragStart.oy + (e.clientY-dragStart.y);
  applyTransform();
});
viewport.addEventListener("pointerup", () => dragStart = null);
viewport.addEventListener("pointercancel", () => dragStart = null);

function updateGps(position) {
  const lat = position.coords.latitude;
  const lon = position.coords.longitude;
  const accuracyM = position.coords.accuracy;
  const p = geoToPixel(lat,lon);
  gpsPixel = p;

  gpsDot.setAttribute("cx", p.x);
  gpsDot.setAttribute("cy", p.y);

  // Approx. metres per pixel from a short horizontal sample at current point.
  const g1 = pixelToGeo(p.x,p.y);
  const g2 = pixelToGeo(p.x+10,p.y);
  const mPerPx = haversine(g1,g2)/10;
  gpsAccuracyCircle.setAttribute("cx", p.x);
  gpsAccuracyCircle.setAttribute("cy", p.y);
  gpsAccuracyCircle.setAttribute("r", Math.min(accuracyM/mPerPx, 250));

  gpsAccuracy.textContent = Math.round(accuracyM) + " m";

  const inside = p.x > -100 && p.x < MAP_W+100 && p.y > -100 && p.y < MAP_H+100;
  gpsStatus.textContent = inside ? "localização encontrada" : "GPS encontrado, mas fora da área do mapa";
}

function gpsError(err) {
  if (err.code === 1) gpsStatus.textContent = "permissão de localização negada";
  else if (err.code === 2) gpsStatus.textContent = "localização indisponível";
  else gpsStatus.textContent = "GPS não respondeu";
}

if ("geolocation" in navigator) {
  navigator.geolocation.watchPosition(updateGps, gpsError, {
    enableHighAccuracy:true,
    maximumAge:2000,
    timeout:15000
  });
} else {
  gpsStatus.textContent = "GPS não suportado";
}

window.addEventListener("resize", fitWholeMap);
fitWholeMap();
