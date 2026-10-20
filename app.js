// Clima en Tiempo Real — PWA que consume las APIs gratuitas de Open-Meteo (sin API key).

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';
const REFRESH_MS = 10 * 60 * 1000;
const DEFAULT_PLACE = { name: 'Lima', admin: 'Lima', country: 'Perú', lat: -12.0464, lon: -77.0428 };

// Códigos WMO → [descripción, icono día, icono noche]
const WMO = {
  0: ['Despejado', '☀️', '🌙'],
  1: ['Mayormente despejado', '🌤️', '🌙'],
  2: ['Parcialmente nublado', '⛅', '☁️'],
  3: ['Nublado', '☁️', '☁️'],
  45: ['Niebla', '🌫️', '🌫️'],
  48: ['Niebla con escarcha', '🌫️', '🌫️'],
  51: ['Llovizna ligera', '🌦️', '🌧️'],
  53: ['Llovizna moderada', '🌦️', '🌧️'],
  55: ['Llovizna intensa', '🌧️', '🌧️'],
  56: ['Llovizna helada', '🌧️', '🌧️'],
  57: ['Llovizna helada intensa', '🌧️', '🌧️'],
  61: ['Lluvia ligera', '🌦️', '🌧️'],
  63: ['Lluvia moderada', '🌧️', '🌧️'],
  65: ['Lluvia intensa', '🌧️', '🌧️'],
  66: ['Lluvia helada', '🌧️', '🌧️'],
  67: ['Lluvia helada intensa', '🌧️', '🌧️'],
  71: ['Nevada ligera', '🌨️', '🌨️'],
  73: ['Nevada moderada', '🌨️', '🌨️'],
  75: ['Nevada intensa', '❄️', '❄️'],
  77: ['Granizo fino', '🌨️', '🌨️'],
  80: ['Chubascos ligeros', '🌦️', '🌧️'],
  81: ['Chubascos moderados', '🌧️', '🌧️'],
  82: ['Chubascos violentos', '⛈️', '⛈️'],
  85: ['Chubascos de nieve', '🌨️', '🌨️'],
  86: ['Chubascos de nieve intensos', '❄️', '❄️'],
  95: ['Tormenta eléctrica', '⛈️', '⛈️'],
  96: ['Tormenta con granizo', '⛈️', '⛈️'],
  99: ['Tormenta con granizo fuerte', '⛈️', '⛈️'],
};

const $ = (id) => document.getElementById(id);

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* almacenamiento no disponible */ }
  },
};

const state = {
  place: store.get('place', null),
  units: store.get('units', 'metric'),
  favorites: store.get('favorites', []),
  timer: null,
  seq: 0,
};

// ---------- Utilidades ----------

function wmo(code, isDay = 1) {
  const w = WMO[code] ?? ['Desconocido', '❓', '❓'];
  return { desc: w[0], icon: isDay ? w[1] : w[2] };
}

function placeLabel(p) {
  return [p.name, p.admin && p.admin !== p.name ? p.admin : null, p.country].filter(Boolean).join(', ');
}

function samePlace(a, b) {
  return a && b && Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01;
}

function tempUnit() { return state.units === 'metric' ? '°C' : '°F'; }
function windUnit() { return state.units === 'metric' ? 'km/h' : 'mph'; }
function precipUnit() { return state.units === 'metric' ? 'mm' : 'in'; }

function windDir(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  return dirs[Math.round(deg / 45) % 8];
}

// Las horas de Open-Meteo vienen en la zona horaria local del lugar (timezone=auto),
// así que se formatean "tal cual" sin conversión del navegador.
function hhmm(iso) { return iso.slice(11, 16); }

function dayName(iso, i) {
  if (i === 0) return 'Hoy';
  if (i === 1) return 'Mañana';
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('es', { weekday: 'short', day: 'numeric' });
}

function aqiLabel(v) {
  if (v == null) return '--';
  if (v <= 20) return `${v} · Buena`;
  if (v <= 40) return `${v} · Aceptable`;
  if (v <= 60) return `${v} · Moderada`;
  if (v <= 80) return `${v} · Mala`;
  if (v <= 100) return `${v} · Muy mala`;
  return `${v} · Extrema`;
}

function setStatus(msg) { $('status').textContent = msg; }

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---------- Datos ----------

async function fetchWeather(p) {
  const params = new URLSearchParams({
    latitude: p.lat,
    longitude: p.lon,
    timezone: 'auto',
    forecast_days: 7,
    current: [
      'temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'is_day',
      'precipitation', 'weather_code', 'cloud_cover', 'pressure_msl',
      'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
    ].join(','),
    hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max',
  });
  if (state.units === 'imperial') {
    params.set('temperature_unit', 'fahrenheit');
    params.set('wind_speed_unit', 'mph');
    params.set('precipitation_unit', 'inch');
  }
  return getJSON(`${FORECAST_URL}?${params}`);
}

async function fetchAir(p) {
  try {
    const data = await getJSON(`${AIR_URL}?latitude=${p.lat}&longitude=${p.lon}&current=european_aqi,pm2_5`);
    return data.current;
  } catch {
    return null; // la calidad del aire es opcional
  }
}

async function searchCities(q) {
  const data = await getJSON(`${GEOCODING_URL}?name=${encodeURIComponent(q)}&count=8&language=es&format=json`);
  return (data.results ?? []).map((r) => ({
    name: r.name, admin: r.admin1, country: r.country, lat: r.latitude, lon: r.longitude,
  }));
}

async function reverseGeocode(lat, lon) {
  try {
    const data = await getJSON(`${REVERSE_URL}?lat=${lat}&lon=${lon}&format=json&accept-language=es&zoom=10`);
    const a = data.address ?? {};
    return {
      name: a.city || a.town || a.village || a.municipality || a.county || 'Mi ubicación',
      admin: a.state, country: a.country, lat, lon,
    };
  } catch {
    return { name: 'Mi ubicación', admin: '', country: '', lat, lon };
  }
}

// ---------- Render ----------

function render(p, w, air) {
  const c = w.current;
  const d = w.daily;
  const tu = tempUnit();
  const now = wmo(c.weather_code, c.is_day);

  document.body.classList.toggle('day', c.is_day === 1);
  document.title = `${Math.round(c.temperature_2m)}${tu} · ${p.name}`;

  $('place-name').textContent = placeLabel(p);
  $('updated').textContent = `Actualizado ${new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })} · hora local ${hhmm(c.time)}`;
  $('now-icon').textContent = now.icon;
  $('now-temp').textContent = `${Math.round(c.temperature_2m)}${tu}`;
  $('now-desc').textContent = now.desc;
  $('now-range').textContent = `Máx ${Math.round(d.temperature_2m_max[0])}° · Mín ${Math.round(d.temperature_2m_min[0])}°`;

  $('d-feels').textContent = `${Math.round(c.apparent_temperature)}${tu}`;
  $('d-hum').textContent = `${c.relative_humidity_2m}%`;
  $('d-wind').textContent = `${Math.round(c.wind_speed_10m)} ${windUnit()} ${windDir(c.wind_direction_10m)}`;
  $('d-gust').textContent = `${Math.round(c.wind_gusts_10m)} ${windUnit()}`;
  $('d-press').textContent = `${Math.round(c.pressure_msl)} hPa`;
  $('d-cloud').textContent = `${c.cloud_cover}%`;
  $('d-precip').textContent = `${c.precipitation} ${precipUnit()}`;
  $('d-uv').textContent = d.uv_index_max[0] != null ? d.uv_index_max[0].toFixed(1) : '--';
  $('d-sunrise').textContent = hhmm(d.sunrise[0]);
  $('d-sunset').textContent = hhmm(d.sunset[0]);
  $('d-aqi').textContent = aqiLabel(air?.european_aqi);
  $('d-pm25').textContent = air?.pm2_5 != null ? `${air.pm2_5} µg/m³` : '--';

  // Próximas 24 horas a partir de la hora actual del lugar
  const h = w.hourly;
  const start = Math.max(0, h.time.findIndex((t) => t.slice(0, 13) === c.time.slice(0, 13)));
  $('hourly').innerHTML = h.time.slice(start, start + 24).map((t, k) => {
    const i = start + k;
    const ic = wmo(h.weather_code[i], h.is_day[i]).icon;
    const pp = h.precipitation_probability[i];
    return `<div class="hour">
      <small>${k === 0 ? 'Ahora' : hhmm(t)}</small>
      <div class="i">${ic}</div>
      <div class="t">${Math.round(h.temperature_2m[i])}°</div>
      <div class="p">${pp ? `💧${pp}%` : '&nbsp;'}</div>
    </div>`;
  }).join('');

  $('daily').innerHTML = d.time.map((t, i) => {
    const x = wmo(d.weather_code[i]);
    const pp = d.precipitation_probability_max[i];
    return `<li>
      <span class="day">${dayName(t, i)}</span>
      <span class="ic" title="${x.desc}">${x.icon}</span>
      <span class="rain">${pp ? `💧${pp}%` : ''}</span>
      <span class="range"><span class="min">${Math.round(d.temperature_2m_min[i])}°</span>${Math.round(d.temperature_2m_max[i])}°</span>
    </li>`;
  }).join('');

  setStatus('');
  for (const id of ['current', 'hourly-card', 'daily-card']) $(id).hidden = false;
  renderFavorites();
}

function renderFavorites() {
  $('btn-fav').textContent = state.favorites.some((f) => samePlace(f, state.place)) ? '★' : '☆';
  const nav = $('favorites');
  nav.innerHTML = '';
  for (const f of state.favorites) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.innerHTML = `<span></span><span class="x" title="Quitar">✕</span>`;
    chip.firstChild.textContent = f.name;
    chip.addEventListener('click', (e) => {
      if (e.target.classList.contains('x')) {
        state.favorites = state.favorites.filter((x) => !samePlace(x, f));
        store.set('favorites', state.favorites);
        renderFavorites();
      } else {
        load(f);
      }
    });
    nav.appendChild(chip);
  }
}

// ---------- Flujo principal ----------

async function load(p, { silent = false } = {}) {
  const seq = ++state.seq;
  state.place = p;
  store.set('place', p);
  if (!silent) setStatus(`Cargando clima de ${p.name}…`);
  try {
    const [w, air] = await Promise.all([fetchWeather(p), fetchAir(p)]);
    if (seq !== state.seq) return; // llegó otra petición más reciente
    render(p, w, air);
    store.set('lastData', { p, w, air, units: state.units });
  } catch (err) {
    if (seq !== state.seq) return;
    const cached = store.get('lastData', null);
    if (cached && samePlace(cached.p, p) && cached.units === state.units) {
      render(cached.p, cached.w, cached.air);
      setStatus('Sin conexión: mostrando los últimos datos guardados.');
    } else {
      setStatus(`No se pudo obtener el clima (${err.message}). Revisa tu conexión.`);
    }
  }
  clearInterval(state.timer);
  state.timer = setInterval(() => load(state.place, { silent: true }), REFRESH_MS);
}

function locate() {
  if (!('geolocation' in navigator)) {
    setStatus('Tu dispositivo no permite geolocalización. Busca una ciudad.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    async (pos) => load(await reverseGeocode(pos.coords.latitude, pos.coords.longitude)),
    () => setStatus('No se pudo obtener tu ubicación. Busca una ciudad.'),
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
  );
}

// ---------- Búsqueda ----------

function setupSearch() {
  const input = $('search-input');
  const list = $('search-results');
  let debounce;
  let items = [];
  let active = -1;

  const close = () => { list.hidden = true; active = -1; };
  const pick = (p) => { close(); input.value = ''; input.blur(); load(p); };

  const paint = () => {
    list.innerHTML = '';
    items.forEach((p, i) => {
      const li = document.createElement('li');
      li.className = i === active ? 'active' : '';
      li.textContent = p.name;
      const small = document.createElement('small');
      small.textContent = ' ' + [p.admin, p.country].filter(Boolean).join(', ');
      li.appendChild(small);
      li.addEventListener('mousedown', (e) => { e.preventDefault(); pick(p); });
      list.appendChild(li);
    });
    list.hidden = items.length === 0;
  };

  input.addEventListener('input', () => {
    clearTimeout(debounce);
    const q = input.value.trim();
    if (q.length < 2) { items = []; close(); return; }
    debounce = setTimeout(async () => {
      try {
        items = await searchCities(q);
        active = -1;
        if (!items.length) {
          list.innerHTML = '<li class="muted">Sin resultados</li>';
          list.hidden = false;
        } else {
          paint();
        }
      } catch {
        close();
      }
    }, 300);
  });

  input.addEventListener('keydown', (e) => {
    if (list.hidden || !items.length) return;
    if (e.key === 'ArrowDown') { active = (active + 1) % items.length; paint(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { active = (active - 1 + items.length) % items.length; paint(); e.preventDefault(); }
    if (e.key === 'Escape') close();
  });

  $('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (items.length) pick(items[Math.max(active, 0)]);
  });

  input.addEventListener('blur', () => setTimeout(close, 150));
}

// ---------- Inicio ----------

function init() {
  $('btn-units').textContent = tempUnit();
  setupSearch();

  $('btn-locate').addEventListener('click', locate);

  $('btn-units').addEventListener('click', () => {
    state.units = state.units === 'metric' ? 'imperial' : 'metric';
    store.set('units', state.units);
    $('btn-units').textContent = tempUnit();
    if (state.place) load(state.place);
  });

  $('btn-fav').addEventListener('click', () => {
    if (!state.place) return;
    if (state.favorites.some((f) => samePlace(f, state.place))) {
      state.favorites = state.favorites.filter((f) => !samePlace(f, state.place));
    } else {
      state.favorites.push(state.place);
    }
    store.set('favorites', state.favorites);
    renderFavorites();
  });

  // Al volver a la app tras un rato, refresca de inmediato.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.place) load(state.place, { silent: true });
  });

  if (state.place) {
    load(state.place);
  } else {
    // Muestra una ciudad por defecto mientras el usuario responde al permiso de ubicación.
    load(DEFAULT_PLACE);
    locate();
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
