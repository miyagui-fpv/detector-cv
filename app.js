'use strict';
/* Detector CV — playas protegidas para detectoristas en la Comunitat Valenciana */

const BUFFER_M = 100;          // franja de protección alrededor de cada zona
const NEAR_M = 300;            // a partir de aquí avisamos de cercanía
const ISLAND_R = { columbretes: 3500, tabarca: 1600, benidorm: 450, illaolla: 180 };

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let DATA = null, map, zoneLayer, youMarker, youCircle, pickMarker, watchId = null, lastPos = null;

/* ---------- Geometría ---------- */
function toXY(lat, lon, lat0, lon0) {
  const k = Math.cos(lat0 * Math.PI / 180);
  return [(lon - lon0) * 111320 * k, (lat - lat0) * 110574];
}
function ringContains(ring, lon, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function polys(geom) { return geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates; }
function contains(geom, lat, lon) {
  return polys(geom).some(p => ringContains(p[0], lon, lat) && !p.slice(1).some(h => ringContains(h, lon, lat)));
}
function distToGeom(geom, lat, lon) {
  let best = Infinity;
  for (const p of polys(geom)) for (const ring of p) {
    for (let i = 1; i < ring.length; i++) {
      const [ax, ay] = toXY(ring[i - 1][1], ring[i - 1][0], lat, lon);
      const [bx, by] = toXY(ring[i][1], ring[i][0], lat, lon);
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      let t = L ? -(ax * dx + ay * dy) / L : 0; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (d < best) best = d;
    }
  }
  return contains(geom, lat, lon) ? 0 : best;
}
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
/* WGS84/ETRS89 → UTM huso 30N (sistema de los mapas oficiales de la GVA) */
function utm30(lat, lon) {
  const a = 6378137, f = 1 / 298.257222101, k0 = 0.9996, lon0 = -3 * Math.PI / 180;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2), r = Math.PI / 180;
  const φ = lat * r, λ = lon * r, N = a / Math.sqrt(1 - e2 * Math.sin(φ) ** 2);
  const T = Math.tan(φ) ** 2, C = ep2 * Math.cos(φ) ** 2, A = Math.cos(φ) * (λ - lon0);
  const M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * φ - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * φ)
    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * φ) - (35 * e2 ** 3 / 3072) * Math.sin(6 * φ));
  const x = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
  const y = k0 * (M + N * Math.tan(φ) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
  return [Math.round(x), Math.round(y)];
}
const fmtM = m => m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toLocaleString('es-ES', { maximumFractionDigits: m < 10000 ? 1 : 0 })} km`;

/* ---------- Evaluación de un punto ---------- */
/* ---------- Otras comunidades autónomas (orientativo) ---------- */
const NORMAS_CCAA = {
  andalucia: { nombre: 'Andalucía', level: 'red', title: 'Prohibido en Andalucía',
    text: 'En Andalucía el detector está <b>prohibido en todo el territorio, playas incluidas</b>, salvo en actividades arqueológicas autorizadas (Ley 14/2007, art. 60). Las multas pueden ser muy elevadas.' },
  cantabria: { nombre: 'Cantabria', level: 'red', title: 'Prohibido en Cantabria',
    text: 'La Ley 11/1998 de Patrimonio Cultural de Cantabria <b>prohíbe el detector</b> fuera de actuaciones arqueológicas autorizadas, también en las playas.' },
  galicia: { nombre: 'Galicia', level: 'amber', title: 'Galicia: necesitas autorización',
    text: 'La Ley 5/2016 (art. 101) exige <b>autorización de la Xunta</b> en ámbitos protegidos y para buscar objetos con posible valor cultural. Si no te contestan en tres meses, se entiende denegada.' },
  asturias: { nombre: 'Asturias', level: 'amber', title: 'Asturias: necesitas autorización',
    text: 'El uso del detector se considera actividad arqueológica (Ley 1/2001), así que necesitas <b>autorización de la Consejería de Cultura</b>.' },
  cataluna: { nombre: 'Cataluña', level: 'amber', title: 'Cataluña: necesitas autorización',
    text: 'Las prospecciones requieren <b>autorización del Departament de Cultura</b> (Llei 9/1993 del patrimoni cultural català).' },
  baleares: { nombre: 'Illes Balears', level: 'amber', title: 'Baleares: con restricciones',
    text: 'Está <b>prohibido sobre bienes del patrimonio histórico</b> (Ley 12/1998, art. 25), salvo equipos investigadores con permiso del consell insular.' },
  murcia: { nombre: 'Región de Murcia', level: 'amber', title: 'Murcia: sin norma propia',
    text: 'No hay una norma autonómica específica sobre detectores. Rige la ley estatal (Ley 16/1985, art. 42): <b>no puedes buscar restos arqueológicos sin autorización</b> ni detectar en zonas arqueológicas protegidas.' },
  canarias: { nombre: 'Canarias', level: 'amber', title: 'Canarias: sin norma propia',
    text: 'No hay una norma autonómica específica sobre detectores. Rige la ley estatal (Ley 16/1985, art. 42): <b>no puedes buscar restos arqueológicos sin autorización</b>. Hay más de 80 zonas arqueológicas protegidas (BIC) en las islas.' },
  paisvasco: { nombre: 'País Vasco', level: 'amber', title: 'País Vasco: consulta antes',
    text: 'No hemos encontrado una norma específica sobre detectores en playas. Rige la ley estatal (Ley 16/1985, art. 42): <b>no puedes buscar restos arqueológicos sin autorización</b>.' },
  ceuta: { nombre: 'Ceuta', level: 'amber', title: 'Ceuta: consulta antes',
    text: 'Rige la ley estatal (Ley 16/1985, art. 42): <b>no puedes buscar restos arqueológicos sin autorización</b>.' },
  melilla: { nombre: 'Melilla', level: 'amber', title: 'Melilla: consulta antes',
    text: 'Rige la ley estatal (Ley 16/1985, art. 42): <b>no puedes buscar restos arqueológicos sin autorización</b>.' }
};
const INTERIOR = { level: 'amber', title: 'Fuera de la costa',
  text: 'Esta app se centra en las playas. Tierra adentro, la mayoría de comunidades exigen <b>autorización de Cultura</b> y permiso del propietario. Consulta la normativa de tu comunidad autónoma.' };
const NOTA_CCAA = '';

let CCAA = null;
function ccaaAt(lat, lon) {
  if (!CCAA) return 'cv';
  for (const c of CCAA) if (contains(c.geometry, lat, lon)) return c.id;
  let best = null;
  for (const c of CCAA) { const d = distToGeom(c.geometry, lat, lon); if (!best || d < best.d) best = { id: c.id, d }; }
  return best && best.d <= 15000 ? best.id : null;
}
function evaluate(lat, lon, acc = 0) {
  const cv = evaluateCV(lat, lon, acc);
  const id = ccaaAt(lat, lon);
  if (id === 'cv' || cv.level !== 'green') return cv;
  if (id === null) return { level: 'amber', title: 'Fuera de España', text: 'Este punto está fuera de las zonas que cubre la app. Consulta la normativa local.' };
  const n = NORMAS_CCAA[id];
  if (!n) return { ...INTERIOR, text: INTERIOR.text + NOTA_CCAA };
  return { level: n.level, title: n.title, text: n.text + NOTA_CCAA };
}

function evaluateCV(lat, lon, acc = 0) {
  let near = null;
  for (const z of DATA.zonas) {
    const d = distToGeom(z.geometry, lat, lon);
    if (!near || d < near.d) near = { z, d };
  }
  for (const i of DATA.islas) {
    const d = haversine(lat, lon, i.lat, i.lon);
    if (d <= ISLAND_R[i.id]) return { level: 'red', title: 'Isla protegida', text: `Estás en ${i.nombre}. Toda la isla está protegida: no se puede detectar.` };
  }
  const { z, d } = near, p = z.properties;
  const where = `${esc(p.nombre)} (${esc(p.municipio)})`;
  if (d === 0) return { level: 'red', zone: z, title: 'Prohibido detectar', text: `Estás dentro de la zona protegida <b>${where}</b>.` };
  if (d <= BUFFER_M) return { level: 'red', zone: z, title: 'Prohibido detectar', text: `Estás a ${fmtM(d)} de <b>${where}</b>, dentro de la franja de ${BUFFER_M} m.` };
  if (d - acc <= BUFFER_M) return { level: 'amber', zone: z, title: 'Demasiado cerca', text: `Estás a unos ${fmtM(d)} de <b>${where}</b>, pero el GPS tiene un margen de ±${fmtM(acc)}. Aléjate un poco más.` };
  if (d <= NEAR_M) return { level: 'amber', zone: z, title: 'Cerca de zona protegida', text: `A ${fmtM(d)} de <b>${where}</b>. Mantente a más de ${BUFFER_M} m de la zona roja.` };
  return { level: 'green', zone: z, title: 'Fuera de las zonas de la Generalitat',
    text: `Este punto no está en el listado de la Generalitat (2021). En la arena de la playa no necesitas autorización de la Conselleria, pero <b>el ayuntamiento puede haberlo prohibido</b>: mira los carteles y la ordenanza municipal. Fuera de la playa necesitas permiso de la Conselleria. Zona protegida más cercana: ${where}, a ${fmtM(d)}.` };
}

function showStatus(res, lat, lon, acc, label) {
  const st = $('#status');
  st.className = 'status s-' + res.level;
  $('#st-title').textContent = res.title;
  $('#st-text').innerHTML = res.text;
  const [x, y] = utm30(lat, lon);
  const c = $('#st-coords');
  c.hidden = false;
  c.textContent = `${label} · ${lat.toFixed(5)}, ${lon.toFixed(5)} · UTM30 ${x.toLocaleString('es-ES')} / ${y.toLocaleString('es-ES')}` + (acc ? ` · ±${Math.round(acc)} m` : '');
  if (navigator.vibrate && res.level === 'red' && label === 'Tu posición') navigator.vibrate([120, 80, 120]);
}

/* ---------- Mapa ---------- */
const BASES = {
  ign: () => L.tileLayer('https://www.ign.es/wmts/ign-base?layer=IGNBaseTodo&style=default&tilematrixset=GoogleMapsCompatible&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image%2Fpng&TileMatrix={z}&TileCol={x}&TileRow={y}',
    { maxZoom: 19, maxNativeZoom: 17, attribution: '© <a href="https://www.ign.es" target="_blank" rel="noopener">IGN</a>' }),
  pnoa: () => L.tileLayer('https://www.ign.es/wmts/pnoa-ma?layer=OI.OrthoimageCoverage&style=default&tilematrixset=GoogleMapsCompatible&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image%2Fjpeg&TileMatrix={z}&TileCol={x}&TileRow={y}',
    { maxZoom: 20, maxNativeZoom: 19, attribution: 'PNOA © <a href="https://www.ign.es" target="_blank" rel="noopener">IGN</a>' }),
  osm: () => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }),
};
let baseLayer;
function setBase(key) {
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = BASES[key]().addTo(map);
  try { localStorage.setItem('base', key); } catch (e) {}
}

function initMap() {
  map = L.map('map', { zoomControl: false, attributionControl: false }).setView([39.35, -0.25], 8);
  L.control.zoom({ position: 'topleft' }).addTo(map);
  L.control.attribution({ position: 'topright', prefix: '<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>' }).addTo(map);
  let saved = 'ign'; try { saved = localStorage.getItem('base') || 'ign'; } catch (e) {}
  $(`input[name=base][value=${saved}]`).checked = true;
  setBase(saved);

  const buffers = { type: 'FeatureCollection', features: DATA.zonas.map(z => ({ type: 'Feature', properties: z.properties, geometry: z.buffer })) };
  L.geoJSON(buffers, { interactive: false, style: { color: '#d33a2c', weight: 1.5, dashArray: '5 5', fill: true, fillOpacity: .07, fillColor: '#d33a2c' } }).addTo(map);
  zoneLayer = L.geoJSON({ type: 'FeatureCollection', features: DATA.zonas.map(z => ({ type: 'Feature', properties: z.properties, geometry: z.geometry })) }, {
    style: { color: '#b3261e', weight: 2, fillColor: '#d33a2c', fillOpacity: .42 },
    onEachFeature: (f, l) => {
      l.bindTooltip(f.properties.nombre, { className: 'zone-tip', sticky: true });
      l.on('click', e => { L.DomEvent.stopPropagation(e); checkPoint(e.latlng.lat, e.latlng.lng); openSheet(f.properties.id); });
    }
  }).addTo(map);
  for (const i of DATA.islas) {
    L.marker([i.lat, i.lon], { icon: L.divIcon({ className: '', html: '<div class="isle"></div>', iconSize: [16, 16] }) })
      .bindTooltip(`${i.nombre} · isla protegida`, { className: 'zone-tip' }).addTo(map);
  }
  map.on('click', e => checkPoint(e.latlng.lat, e.latlng.lng));
}

function checkPoint(lat, lon) {
  if (pickMarker) pickMarker.setLatLng([lat, lon]);
  else pickMarker = L.marker([lat, lon], { icon: L.divIcon({ className: '', html: '<div class="pin"></div>', iconSize: [16, 16] }) }).addTo(map);
  showStatus(evaluate(lat, lon), lat, lon, 0, 'Punto elegido');
}

/* ---------- GPS ---------- */
function onPos(pos, recenter) {
  const { latitude: lat, longitude: lon, accuracy: acc } = pos.coords;
  lastPos = { lat, lon, acc };
  if (pickMarker) { map.removeLayer(pickMarker); pickMarker = null; }
  if (!youMarker) {
    youMarker = L.marker([lat, lon], { icon: L.divIcon({ className: '', html: '<div class="you"></div>', iconSize: [18, 18] }), zIndexOffset: 1000 }).addTo(map);
    youCircle = L.circle([lat, lon], { radius: acc, color: '#1a73e8', weight: 1, fillOpacity: .08, interactive: false }).addTo(map);
  } else { youMarker.setLatLng([lat, lon]); youCircle.setLatLng([lat, lon]).setRadius(acc); }
  if (recenter) map.setView([lat, lon], Math.max(map.getZoom(), 16));
  showStatus(evaluate(lat, lon, acc), lat, lon, acc, 'Tu posición');
  renderList();
}
function onPosErr(err) {
  const st = $('#status'); st.className = 'status s-amber';
  $('#st-title').textContent = 'No se pudo obtener tu posición';
  $('#st-text').textContent = err.code === 1
    ? 'Has denegado el acceso a la ubicación. Actívalo en los ajustes del navegador, o toca el mapa para comprobar un punto.'
    : 'El GPS no responde. Prueba al aire libre o toca el mapa para comprobar un punto.';
  stopFollow();
}
const GEO_OPTS = { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 };
function locate() {
  if (!('geolocation' in navigator)) return onPosErr({ code: 2 });
  const st = $('#status'); st.className = 'status s-wait';
  $('#st-title').textContent = 'Buscando tu posición…';
  $('#st-text').textContent = 'Puede tardar unos segundos al aire libre.';
  navigator.geolocation.getCurrentPosition(p => onPos(p, true), onPosErr, GEO_OPTS);
}
function stopFollow() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null; $('#btn-follow').setAttribute('aria-pressed', 'false');
}
function toggleFollow() {
  if (watchId !== null) return stopFollow();
  if (!('geolocation' in navigator)) return onPosErr({ code: 2 });
  $('#btn-follow').setAttribute('aria-pressed', 'true');
  let first = true;
  watchId = navigator.geolocation.watchPosition(p => { onPos(p, first); first = false; }, onPosErr, GEO_OPTS);
}

/* ---------- Listado ---------- */
let provFilter = '';
function renderList() {
  const q = $('#q').value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const rows = DATA.zonas.map(z => z.properties).filter(p =>
    (!provFilter || p.provincia === provFilter) && (!q || norm(p.nombre + ' ' + p.municipio + ' ' + p.circular).includes(q)));
  const out = $('#list');
  if (!rows.length) { out.innerHTML = '<p class="empty">No hay ninguna playa protegida que coincida con la búsqueda.</p>'; return; }
  const byProv = {};
  for (const p of rows) ((byProv[p.provincia] ||= {})[p.municipio] ||= []).push(p);
  let html = '';
  for (const prov of ['Castellón', 'Valencia', 'Alicante']) {
    if (!byProv[prov]) continue;
    html += `<h3 class="prov">Provincia de ${prov}</h3>`;
    for (const [mun, list] of Object.entries(byProv[prov])) {
      html += `<div class="muni"><h3>${esc(mun)}</h3>`;
      for (const p of list) {
        const km = lastPos ? `<span class="km">${fmtM(distToGeom(DATA.zonas.find(z => z.properties.id === p.id).geometry, lastPos.lat, lastPos.lon))}</span>` : '';
        html += `<button class="beach" data-id="${esc(p.id)}"><span class="beach-name">${esc(p.nombre)}<small>${p.mapas.length} mapa${p.mapas.length > 1 ? 's' : ''} oficial${p.mapas.length > 1 ? 'es' : ''}</small></span>${km}</button>`;
      }
      html += '</div>';
    }
  }
  out.innerHTML = html;
}

/* ---------- Ficha ---------- */
let sheetZone = null;
function openSheet(id) {
  const z = DATA.zonas.find(z => z.properties.id === id); if (!z) return;
  const p = z.properties; sheetZone = z;
  $('#sh-place').textContent = `${p.municipio} · ${p.provincia}`;
  $('#sh-title').textContent = p.nombre;
  $('#sh-circ').textContent = p.circular;
  $('#sh-area').textContent = `${p.area_ha.toLocaleString('es-ES')} ha`;
  $('#sh-dist').textContent = lastPos ? `${fmtM(distToGeom(z.geometry, lastPos.lat, lastPos.lon))} desde tu posición` : 'Activa tu posición para verla';
  $('#sh-imgs').innerHTML = p.mapas.map(m =>
    `<figure style="margin:0"><a href="${esc(m.img)}" target="_blank" rel="noopener"><img src="${esc(m.img)}" alt="Mapa oficial ${esc(m.archivo)}" loading="lazy"></a><figcaption>Playas protegidas · ${esc(m.archivo)} · Generalitat Valenciana</figcaption></figure>`).join('');
  $('#sheet').hidden = false;
  $('#sh-close').focus();
}
function closeSheet() { $('#sheet').hidden = true; }

/* ---------- Navegación ---------- */
function go(view) {
  if (!$(`[data-view="${view}"]`)) view = 'mapa';
  $$('.view').forEach(v => v.hidden = v.dataset.view !== view);
  $$('.tab').forEach(t => t.classList.toggle('on', t.dataset.go === view));
  if (view === 'mapa' && map) setTimeout(() => map.invalidateSize(), 0);
  if (location.hash.slice(1) !== view) history.replaceState(null, '', '#' + view);
}

function renderOtras() {
  const el = $('#otras-ccaa'); if (!el) return;
  el.innerHTML = Object.values(NORMAS_CCAA).map(n =>
    `<article class="rule r-${n.level === 'red' ? 'red' : 'amber'}"><h3>${esc(n.nombre)}</h3><p>${n.text}</p></article>`).join('');
}

/* ---------- Arranque ---------- */
async function boot() {
  DATA = await (await fetch('data/zonas.json')).json();
  fetch('data/ccaa.json').then(r => r.json()).then(d => { CCAA = d; }).catch(() => {});
  renderOtras();
  $('#islas-txt').textContent = DATA.islas.map(i => i.nombre).join(', ') + ' y la Illa del Portitxol (Xàbia)';
  initMap();
  renderList();

  $$('.tab').forEach(t => t.addEventListener('click', () => {
    go(t.dataset.go);
    // GoatCounter: cuenta cada vez que alguien abre una pestaña (Apoyar, Playas, Normas...)
    if (window.goatcounter && window.goatcounter.count)
      window.goatcounter.count({ path: 'pestana-' + t.dataset.go, title: 'Pestaña ' + t.textContent.trim(), event: true });
  }));
  window.addEventListener('hashchange', () => go(location.hash.slice(1)));
  go(location.hash.slice(1) || 'mapa');

  $('#btn-locate').addEventListener('click', locate);
  $('#btn-follow').addEventListener('click', toggleFollow);
  $('#btn-layers').addEventListener('click', () => { $('#layers').hidden = !$('#layers').hidden; });
  $$('input[name=base]').forEach(r => r.addEventListener('change', () => { setBase(r.value); $('#layers').hidden = true; }));

  $('#q').addEventListener('input', renderList);
  $$('.chip').forEach(c => c.addEventListener('click', () => {
    provFilter = c.dataset.prov; $$('.chip').forEach(x => x.classList.toggle('on', x === c)); renderList();
  }));
  $('#list').addEventListener('click', e => { const b = e.target.closest('.beach'); if (b) openSheet(b.dataset.id); });

  $('#sh-close').addEventListener('click', closeSheet);
  $('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
  $('#sh-map').addEventListener('click', () => {
    if (!sheetZone) return;
    closeSheet(); go('mapa');
    setTimeout(() => map.fitBounds(L.geoJSON(sheetZone.geometry).getBounds(), { padding: [40, 40], maxZoom: 17 }), 50);
  });

  const net = () => { $('#net').hidden = navigator.onLine; };
  window.addEventListener('online', net); window.addEventListener('offline', net); net();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
boot().catch(err => {
  $('#st-title').textContent = 'No se pudieron cargar los datos';
  $('#st-text').textContent = 'Recarga la página. Si estás sin conexión, abre la app una vez con conexión para guardarla en el móvil.';
  console.error(err);
});
