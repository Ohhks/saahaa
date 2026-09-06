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
let leaflet = null, loading = null;

export function ready() {
  if (leaflet) return Promise.resolve(leaflet);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-leaflet]')) {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = BASE + 'leaflet.css'; css.setAttribute('data-leaflet', '1');
      document.head.appendChild(css);
    }
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

/* SAAHAA-coloured pins: a small SVG, so a customer and a pro never look alike */
function pinIcon(L, color = '#7C3AED', glyph = '') {
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
  const handle = {
    map,
    pin(lat, lng, o = {}) {
      const m = L.marker([lat, lng], { icon: pinIcon(L, o.color, o.glyph), draggable: !!o.draggable, title: o.label || '' }).addTo(map);
      if (o.label) m.bindPopup(o.label);
      if (o.onMove) m.on('dragend', e => { const p = e.target.getLatLng(); o.onMove({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) }); });
      layers.push(m); return m;
    },
    circle(lat, lng, meters, o = {}) { const c = L.circle([lat, lng], { radius: meters, color: o.color || '#E0B558', weight: 1, fillOpacity: .08 }).addTo(map); layers.push(c); return c; },
    line(points, o = {}) { const l = L.polyline(points, { color: o.color || '#E0B558', weight: 3, dashArray: o.dashed ? '6 6' : null }).addTo(map); layers.push(l); return l; },
    fit(points, pad = 40) { if (points.length === 1) map.setView(points[0], 15); else if (points.length) map.fitBounds(points, { padding: [pad, pad] }); },
    on(ev, fn) { map.on(ev, e => fn(e.latlng ? { lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) } : e)); },
    clear() { layers.splice(0).forEach(l => map.removeLayer(l)); },
    invalidate() { setTimeout(() => map.invalidateSize(), 60); },
    destroy() { try { map.remove(); } catch (e) {} },
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
