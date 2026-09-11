/* SAAHAA · ui/map.js — real maps, anywhere in the world, with nothing sent
   to anyone we did not choose.

   Leaflet is VENDORED under /vendor/leaflet (no CDN: the CSP allows scripts
   from 'self' only, and a tradesperson's phone should not depend on a third
   party's uptime). Tiles come from OpenStreetMap; geocoding ("where is this
   address?") and reverse geocoding ("what is this pin called?") come from
   Nominatim, OpenStreetMap's free geocoder, used politely: one request per
   user action, never per keystroke, with a proper User-Agent as its usage
   policy asks.

   THE CONTRACT every screen uses (views never touch L directly):
     await ready()                      loads Leaflet once, resolves L
     mapInto(el, {center, zoom})        a map in an element → handle
     handle.pin(lat, lng, opts)         a marker (opts: label, color, draggable)
     handle.line([[lat,lng],…])         a polyline
     handle.fit([[lat,lng],…])          fit bounds with padding
     handle.on('click', fn)             map events
     handle.destroy()
     geocode(query)   → [{label, lat, lng}]   (Nominatim search, world-wide)
     reverse(lat,lng) → {label, city, area}
     locate()         → {lat, lng, accuracy} from the device (asks permission)
     km(a, b)         → haversine distance between two {lat,lng}, one decimal

   A place is always {lat, lng, label}. The old area names still work
   everywhere (domain/match.js maps them to coordinates), so nothing that was
   seeded with "Madhapur" breaks. */

const BASE = './vendor/leaflet/';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* The pin palette is the design system's, and only the system's: the accent
   for the thing being watched, ink for people, neutral for places, success for
   a finished state. Views read PINS instead of typing a hex; anything that
   still hands over one of the retired colours is mapped to its modern role so
   a pin never silently falls back. */
export const PINS = Object.freeze({ accent: '#ec3013', ink: '#201e1d', neutral: '#7d7979', success: '#1f7a4d' });
const COLORS = new Set(Object.values(PINS).map(c => c.toUpperCase()));
const LEGACY = { '#E0B558': PINS.accent, '#EF4444': PINS.accent, '#7C3AED': PINS.ink, '#3B82F6': PINS.ink,
                 '#14B8A6': PINS.neutral, '#64748B': PINS.neutral, '#22C55E': PINS.success };
let leaflet = null, loading = null;

/* Leaflet ships its own look — Helvetica, pure black on pure white, 2px and
   12px corners, a drop shadow under every popup. Next to the Modernist system
   that reads as a different product bolted into the page. This sheet is the
   ONLY place the map's chrome is restyled: Archivo, zero radius, the system's
   ink/paper tokens (so it inverts with the theme like everything else), and
   2px rules doing the organising. It changes nothing about behaviour, the pin
   colour whitelist or the popup escaping in pinIcon()/pin() below.
   Written with textContent, never innerHTML. */
/* Every selector is prefixed with .leaflet-container on purpose: Leaflet's own
   sheet reaches these elements through .leaflet-touch / .leaflet-container
   descendant selectors, so a bare .leaflet-bar loses the cascade and the
   controls stay round and white. Two class selectors ties it, and this sheet
   is appended after leaflet.css, so the tie falls our way. */
const SKIN = `
.leaflet-container{font-family:var(--font-body),system-ui,sans-serif;font-size:13px;background:var(--surface-2,#eae9e9)}
.leaflet-container a{color:var(--color-accent-text)}
.leaflet-container .leaflet-bar,
.leaflet-container .leaflet-bar a,
.leaflet-container .leaflet-bar a:first-child,
.leaflet-container .leaflet-bar a:last-child,
.leaflet-container .leaflet-popup-content-wrapper,
.leaflet-container .leaflet-popup-tip,
.leaflet-container .leaflet-control-attribution{border-radius:0}
.leaflet-container .leaflet-bar{border:1px solid var(--color-text);box-shadow:none}
.leaflet-container .leaflet-bar a{width:34px;height:34px;line-height:34px;
  background:var(--bg,#f3f2f2);color:var(--color-text);
  border-bottom:1px solid var(--color-divider);font-weight:700}
.leaflet-container .leaflet-bar a:hover{background:var(--surface,#eae9e9);color:var(--color-accent-text)}
.leaflet-container .leaflet-bar a:last-child{border-bottom:0}
.leaflet-container .leaflet-bar a.leaflet-disabled{background:var(--surface,#eae9e9);color:var(--ink-4,#9b9797)}
.leaflet-container .leaflet-popup-content-wrapper{background:var(--bg,#f3f2f2);color:var(--color-text);
  border:2px solid var(--color-text);box-shadow:none;padding:2px}
.leaflet-container .leaflet-popup-content{margin:10px 12px;font:400 13px/1.45 var(--font-body),system-ui,sans-serif}
.leaflet-container .leaflet-popup-tip{background:var(--color-text);box-shadow:none}
.leaflet-container a.leaflet-popup-close-button{color:var(--color-text);
  width:30px;height:30px;padding:0;font:800 18px/30px var(--font-heading),system-ui,sans-serif}
.leaflet-container a.leaflet-popup-close-button:hover{color:var(--color-accent-text);background:transparent}
.leaflet-container .leaflet-control-attribution{background:var(--bg,#f3f2f2);
  color:var(--ink-3,#605d5d);font-size:10px;letter-spacing:.02em;padding:2px 6px;
  border-top:1px solid var(--color-divider);border-left:1px solid var(--color-divider)}
.leaflet-container .saahaa-pin{background:none;border:0}
`;
function skin() {
  if (typeof document === 'undefined' || document.getElementById('saahaa-map-skin')) return;
  const s = document.createElement('style');
  s.id = 'saahaa-map-skin';
  s.textContent = SKIN;
  document.head.appendChild(s);
}

export function ready() {
  if (leaflet) return Promise.resolve(leaflet);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-leaflet]')) {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = BASE + 'leaflet.css'; css.setAttribute('data-leaflet', '1');
      document.head.appendChild(css);
    }
    skin();   // after leaflet.css, so ours wins on equal specificity
    const s = document.createElement('script');
    s.src = BASE + 'leaflet.js'; s.async = true;
    s.onload = () => {
      leaflet = window.L;
      // the vendored marker images, not the CDN ones Leaflet guesses at
      leaflet.Icon.Default.mergeOptions({
        iconUrl: BASE + 'images/marker-icon.png', iconRetinaUrl: BASE + 'images/marker-icon-2x.png',
        shadowUrl: BASE + 'images/marker-shadow.png',
      });
      resolve(leaflet);
    };
    s.onerror = () => reject(new Error('Leaflet failed to load'));
    document.head.appendChild(s);
  });
  return loading;
}

/* System-coloured pins: a small SVG, so a customer and a pro never look alike */
function pinIcon(L, color = PINS.ink, glyph = '') {
  // a popup and a divIcon are HTML: colour is whitelisted, the glyph escaped
  color = LEGACY[String(color).toUpperCase()] || String(color).toLowerCase();
  if (!COLORS.has(color.toUpperCase())) color = PINS.ink;
  glyph = esc(String(glyph).slice(0, 2));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="42" viewBox="0 0 30 42">
    <path d="M15 41s-13-13.6-13-24A13 13 0 0 1 28 17c0 10.4-13 24-13 24z" fill="${color}" stroke="#fff" stroke-width="2"/>
    <circle cx="15" cy="17" r="6" fill="#fff"/>${glyph ? `<text x="15" y="21" font-size="10" text-anchor="middle" fill="${color}" font-family="system-ui" font-weight="700">${glyph}</text>` : ''}</svg>`;
  return L.divIcon({ className: 'saahaa-pin', html: svg, iconSize: [30, 42], iconAnchor: [15, 41], popupAnchor: [0, -36] });
}

export function mapInto(el, { center = [17.4486, 78.3908], zoom = 13, interactive = true } = {}) {
  const L = leaflet;
  if (!L || !el) return null;
  const map = L.map(el, { zoomControl: interactive, dragging: interactive, scrollWheelZoom: interactive,
                          touchZoom: interactive, doubleClickZoom: interactive, attributionControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  map.setView(center, zoom);
  const layers = [];
  /* destroy() sets this: the 60ms invalidate timer, or a caller holding a stale
     handle, must never touch a removed map — Leaflet throws on `_leaflet_pos`. */
  let dead = false;
  const handle = {
    map,
    pin(lat, lng, o = {}) {
      if (dead) return null;
      const m = L.marker([lat, lng], { icon: pinIcon(L, o.color, o.glyph), draggable: !!o.draggable, title: String(o.label || '').slice(0, 120) }).addTo(map);
      if (o.label) m.bindPopup(esc(o.label));   // Leaflet renders a popup string as HTML
      if (o.onMove) m.on('dragend', e => { const p = e.target.getLatLng(); o.onMove({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) }); });
      layers.push(m); return m;
    },
    circle(lat, lng, meters, o = {}) { if (dead) return null; const c = L.circle([lat, lng], { radius: meters, color: o.color || PINS.accent, weight: 1, fillOpacity: .08 }).addTo(map); layers.push(c); return c; },
    line(points, o = {}) { if (dead) return null; const l = L.polyline(points, { color: o.color || PINS.accent, weight: 3, dashArray: o.dashed ? '6 6' : null }).addTo(map); layers.push(l); return l; },
    fit(points, pad = 40) { if (dead) return; if (points.length === 1) map.setView(points[0], 15); else if (points.length) map.fitBounds(points, { padding: [pad, pad] }); },
    on(ev, fn) { map.on(ev, e => fn(e.latlng ? { lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) } : e)); },
    clear() { if (dead) return; layers.splice(0).forEach(l => map.removeLayer(l)); },
    invalidate() { setTimeout(() => { if (dead || !map._container) return; try { map.invalidateSize(); } catch (e) {} }, 60); },
    destroy() { dead = true; try { map.remove(); } catch (e) {} },
  };
  handle.invalidate();
  return handle;
}

/* ── geocoding: OpenStreetMap's Nominatim, used politely ─────── */
const NOMINATIM = 'https://nominatim.openstreetmap.org';
const HEADERS = { 'Accept': 'application/json', 'Accept-Language': 'en' };
let lastCall = 0;
async function polite(url) {
  const wait = Math.max(0, 1100 - (Date.now() - lastCall));   // ≤ 1 request/second, per their policy
  if (wait) await new Promise(r => setTimeout(r, wait));
  lastCall = Date.now();
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error('geocoder ' + r.status);
  return r.json();
}
export async function geocode(query, { limit = 5, near } = {}) {
  const q = String(query || '').trim();
  if (q.length < 3) return [];
  let url = `${NOMINATIM}/search?format=jsonv2&addressdetails=1&limit=${limit}&q=${encodeURIComponent(q)}`;
  if (near) url += `&viewbox=${near.lng - 0.5},${near.lat + 0.5},${near.lng + 0.5},${near.lat - 0.5}`;
  const rows = await polite(url);
  return rows.map(r => ({ lat: +(+r.lat).toFixed(6), lng: +(+r.lon).toFixed(6), label: shortLabel(r), full: r.display_name }));
}
export async function reverse(lat, lng) {
  const r = await polite(`${NOMINATIM}/reverse?format=jsonv2&addressdetails=1&lat=${lat}&lon=${lng}`);
  return { lat, lng, label: shortLabel(r), full: r.display_name || '', city: cityOf(r), area: areaOf(r) };
}
function areaOf(r) { const a = r.address || {}; return a.suburb || a.neighbourhood || a.quarter || a.village || a.town || a.city_district || a.city || ''; }
function cityOf(r) { const a = r.address || {}; return a.city || a.town || a.village || a.county || a.state || ''; }
function shortLabel(r) {
  const a = r.address || {};
  const bits = [a.road || a.pedestrian || a.hamlet, areaOf(r), cityOf(r)].filter(Boolean);
  return [...new Set(bits)].slice(0, 3).join(', ') || (r.display_name || '').split(',').slice(0, 2).join(',');
}

/** The device's own position. Asks the browser for permission; never silent. */
export function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('No location on this device'));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), accuracy: Math.round(p.coords.accuracy) }),
      e => reject(new Error(e.code === 1 ? 'Location permission was refused' : 'Could not get your location')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  });
}

/** Great-circle distance in km, one decimal — the same formula domain/match.js uses. */
export function km(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371, toR = d => d * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return +(2 * R * Math.asin(Math.sqrt(h))).toFixed(1);
}
