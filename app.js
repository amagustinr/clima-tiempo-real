// Clima en Tiempo Real — PWA que consume servicios gratuitos sin API key:
// Open-Meteo (pronóstico, geocodificación, calidad del aire), RainViewer (radar),
// Nominatim (nombre del lugar por coordenadas) y teselas de OpenStreetMap.

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';
const RADAR_URL = 'https://api.rainviewer.com/public/weather-maps.json';
const REFRESH_MS = 10 * 60 * 1000;

const DEFAULT_PLACE = { name: 'Lima', admin: 'Lima', country: 'Perú', lat: -12.0464, lon: -77.0428 };
const DEFAULT_FAVORITES = [
  DEFAULT_PLACE,
  { name: 'Arequipa', admin: 'Arequipa', country: 'Perú', lat: -16.3988, lon: -71.5369 },
  { name: 'Cusco', admin: 'Cusco', country: 'Perú', lat: -13.5226, lon: -71.9673 },
  { name: 'Trujillo', admin: 'La Libertad', country: 'Perú', lat: -8.1116, lon: -79.0288 },
  { name: 'Piura', admin: 'Piura', country: 'Perú', lat: -5.1945, lon: -80.6328 },
];

// Códigos WMO → [descripción, ícono]; "%" se reemplaza por day/night.
const WMO = {
  0: ['Despejado', 'clear-%'],
  1: ['Mayormente despejado', 'partly-cloudy-%'],
  2: ['Parcialmente nublado', 'partly-cloudy-%'],
  3: ['Muy nublado', 'overcast-%'],
  45: ['Niebla', 'fog-%'],
  48: ['Niebla con escarcha', 'fog-%'],
  51: ['Llovizna ligera', 'partly-cloudy-%-drizzle'],
  53: ['Llovizna moderada', 'drizzle'],
  55: ['Llovizna intensa', 'drizzle'],
  56: ['Llovizna helada', 'sleet'],
  57: ['Llovizna helada intensa', 'sleet'],
  61: ['Lluvia ligera', 'partly-cloudy-%-rain'],
  63: ['Lluvia moderada', 'rain'],
  65: ['Lluvia intensa', 'rain'],
  66: ['Lluvia helada', 'sleet'],
  67: ['Lluvia helada intensa', 'sleet'],
  71: ['Nevada ligera', 'partly-cloudy-%-snow'],
  73: ['Nevada moderada', 'snow'],
  75: ['Nevada intensa', 'snow'],
  77: ['Granizo fino', 'hail'],
  80: ['Chubascos ligeros', 'partly-cloudy-%-rain'],
  81: ['Chubascos moderados', 'rain'],
  82: ['Chubascos violentos', 'rain'],
  85: ['Chubascos de nieve', 'snow'],
  86: ['Chubascos de nieve intensos', 'snow'],
  95: ['Tormenta eléctrica', 'thunderstorms-%-rain'],
  96: ['Tormenta con granizo', 'thunderstorms-rain'],
  99: ['Tormenta con granizo fuerte', 'thunderstorms-rain'],
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
  favorites: store.get('favorites', DEFAULT_FAVORITES),
  metric: store.get('metric', 'general'),
  theme: store.get('theme', 'auto'), // auto | light | dark
  feels: false,
  day: null, // índice del día seleccionado en daily
  data: null, // { p, w, air }
  timer: null,
  seq: 0,
};

// ---------- Utilidades ----------

function wmo(code, isDay = 1) {
  const [desc, ic] = WMO[code] ?? ['Sin datos', 'not-available'];
  return { desc, icon: `icons/wx/${ic.replace('%', isDay ? 'day' : 'night')}.svg` };
}

function placeLabel(p) {
  return [p.name, p.admin && p.admin !== p.name ? p.admin : null, p.country].filter(Boolean).join(', ');
}

function samePlace(a, b) {
  return a && b && Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01;
}

const imperial = () => state.units === 'imperial';
const tempUnit = () => (imperial() ? '°F' : '°C');
const windUnit = () => (imperial() ? 'mph' : 'km/h');
const precipUnit = () => (imperial() ? 'in' : 'mm');
const toC = (t) => (imperial() ? (t - 32) * 5 / 9 : t);
const toKmh = (v) => (imperial() ? v * 1.609 : v);
const round = (v) => (v == null ? '--' : Math.round(v));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
const windDir = (deg) => DIRS[Math.round(deg / 22.5) % 16];

// Las horas de Open-Meteo vienen en la hora local del lugar (timezone=auto),
// así que se formatean tal cual, sin conversión del navegador.
function h12(iso, withMin = false) {
  const H = +iso.slice(11, 13);
  const m = iso.slice(14, 16);
  return `${H % 12 || 12}${withMin ? `:${m}` : ''} ${H < 12 ? 'AM' : 'PM'}`;
}

const minutesOf = (iso) => +iso.slice(11, 13) * 60 + +iso.slice(14, 16);

function weekday(iso) {
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es', { weekday: 'short' }).replace('.', '');
}

function visibility(v, unit) {
  if (v == null) return null;
  const meters = unit === 'ft' ? v * 0.3048 : v;
  return imperial() ? meters / 1609 : meters / 1000;
}

function setStatus(msg) { $('status').textContent = msg; }

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function unitParams(params) {
  if (imperial()) {
    params.set('temperature_unit', 'fahrenheit');
    params.set('wind_speed_unit', 'mph');
    params.set('precipitation_unit', 'inch');
  }
  return params;
}

// ---------- Datos ----------

async function fetchWeather(p) {
  const params = unitParams(new URLSearchParams({
    latitude: p.lat,
    longitude: p.lon,
    timezone: 'auto',
    past_days: 1,
    forecast_days: 7,
    current: [
      'temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'dew_point_2m', 'is_day',
      'precipitation', 'weather_code', 'cloud_cover', 'pressure_msl', 'visibility',
      'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'uv_index',
    ].join(','),
    hourly: [
      'temperature_2m', 'apparent_temperature', 'precipitation_probability', 'precipitation',
      'weather_code', 'is_day', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
      'relative_humidity_2m', 'dew_point_2m', 'cloud_cover', 'pressure_msl', 'uv_index', 'visibility',
    ].join(','),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max,daylight_duration',
  }));
  return getJSON(`${FORECAST_URL}?${params}`);
}

async function fetchAir(p) {
  try {
    return await getJSON(`${AIR_URL}?latitude=${p.lat}&longitude=${p.lon}&timezone=auto&past_days=1&forecast_days=5`
      + '&current=european_aqi,pm2_5,pm10&hourly=european_aqi');
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

// ---------- Ventanas de tiempo ----------

function nowIndex(w) {
  const i = w.hourly.time.findIndex((t) => t.slice(0, 13) === w.current.time.slice(0, 13));
  return Math.max(0, i);
}

function todayIndex(w) {
  return Math.max(0, w.daily.time.indexOf(w.current.time.slice(0, 10)));
}

function range(from, n, max) {
  const out = [];
  for (let i = from; i < Math.min(from + n, max); i++) out.push(i);
  return out;
}

// 24 horas a mostrar en el gráfico: desde la hora actual para "Hoy",
// o de 00:00 a 23:00 para cualquier otro día.
function dayWindow(w, day) {
  const len = w.hourly.time.length;
  let start = day === todayIndex(w) ? nowIndex(w) : w.hourly.time.indexOf(`${w.daily.time[day]}T00:00`);
  if (start < 0) start = 0;
  start = Math.min(start, len - 24);
  return range(start, 24, len);
}

// ---------- Tiempo actual ----------

function renderNow(p, w, air) {
  const c = w.current;
  const d = w.daily;
  const t = todayIndex(w);
  const now = wmo(c.weather_code, c.is_day);
  const tu = tempUnit();
  const vis = visibility(c.visibility, w.current_units?.visibility);

  document.title = `${round(c.temperature_2m)}${tu} · ${p.name}`;
  $('place-name').textContent = placeLabel(p);
  $('now-time').textContent = `${h12(c.time, true)} (hora local)`;
  $('now-icon').src = now.icon;
  $('now-icon').alt = now.desc;
  $('now-temp').textContent = round(c.temperature_2m);
  $('now-unit').textContent = tu;
  $('now-desc').textContent = now.desc;
  $('now-feels').textContent = `${round(c.apparent_temperature)}°`;

  const dayDesc = wmo(d.weather_code[t]).desc.toLowerCase();
  let summary = `Pronóstico para hoy: ${dayDesc}, con una temperatura máxima de ${round(d.temperature_2m_max[t])}° y mínima de ${round(d.temperature_2m_min[t])}°.`;
  if (d.precipitation_probability_max[t] >= 40) summary += ` Probabilidad de lluvia del ${d.precipitation_probability_max[t]}%.`;
  if (d.uv_index_max[t] >= 8) summary += ' Índice UV muy alto: protégete del sol.';
  $('now-summary').textContent = summary;

  $('s-wind').innerHTML = `${round(c.wind_speed_10m)} ${windUnit()} <span class="arrow" style="transform:rotate(${c.wind_direction_10m + 180}deg)" title="Desde ${windDir(c.wind_direction_10m)}">↑</span>`;
  $('s-hum').textContent = `${c.relative_humidity_2m}%`;
  $('s-vis').textContent = vis == null ? '--' : `${vis >= 10 ? Math.round(vis) : vis.toFixed(1)} ${imperial() ? 'mi' : 'km'}`;
  $('s-press').textContent = `${round(c.pressure_msl)} hPa`;
  $('s-dew').textContent = `${round(c.dew_point_2m)}°`;
  $('details-time').textContent = h12(c.time, true);
}

// ---------- Tarjetas de días ----------

function renderDays(w) {
  const d = w.daily;
  const t = todayIndex(w);
  const box = $('days');
  box.innerHTML = '';
  d.time.forEach((iso, i) => {
    const b = document.createElement('button');
    b.className = 'day';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(i === state.day));
    const name = i === t ? 'Hoy' : i === t - 1 ? 'Ayer' : i === t + 1 ? 'Mañana' : weekday(iso);
    const x = wmo(d.weather_code[i]);
    b.innerHTML = `<span class="d-top"><span class="d-num">${+iso.slice(8, 10)}</span><span class="d-name">${name}</span></span>
      <img src="${x.icon}" alt="${x.desc}" title="${x.desc}">
      <span class="d-temps"><span class="d-max">${round(d.temperature_2m_max[i])}°</span><span class="d-min">${round(d.temperature_2m_min[i])}°</span></span>`;
    b.addEventListener('click', () => {
      state.day = i;
      for (const el of box.children) el.setAttribute('aria-selected', String(el === b));
      renderChart();
    });
    box.appendChild(b);
  });
  box.children[state.day]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// ---------- Gráfico por hora ----------

// Cada métrica es una sola serie con un solo eje (nunca dos escalas a la vez).
const METRICS = {
  general: {
    tab: 'Información general', color: 'var(--m-general)', kind: 'area',
    get: (h, i) => (state.feels ? h.apparent_temperature[i] : h.temperature_2m[i]),
    fmt: (v) => `${round(v)}°`, legend: () => (state.feels ? 'Sensación térmica' : 'Temperatura'),
  },
  precip: {
    tab: 'Precipitación', color: 'var(--m-precip)', kind: 'bar', domain: [0, 100],
    get: (h, i) => h.precipitation_probability[i],
    fmt: (v) => `${round(v)}%`, legend: () => 'Probabilidad de precipitación',
    extra: (h, i) => `${h.precipitation[i]} ${precipUnit()}`,
  },
  wind: {
    tab: 'Viento', color: 'var(--m-wind)', kind: 'area', min: 0,
    get: (h, i) => h.wind_speed_10m[i],
    fmt: (v) => `${round(v)}`, unit: () => ` ${windUnit()}`, legend: () => `Velocidad del viento (${windUnit()})`,
    extra: (h, i) => `Ráfagas ${round(h.wind_gusts_10m[i])} ${windUnit()} · desde ${windDir(h.wind_direction_10m[i])}`,
  },
  air: {
    tab: 'Calidad del aire', color: 'var(--m-air)', kind: 'area', min: 0,
    get: (h, i) => state.airByTime?.get(h.time[i]) ?? null,
    fmt: (v) => `${round(v)}`, legend: () => 'Índice europeo de calidad del aire (EAQI)',
    extra: (h, i) => aqiInfo(state.airByTime?.get(h.time[i])).label,
  },
  humidity: {
    tab: 'Humedad', color: 'var(--m-humidity)', kind: 'area', domain: [0, 100],
    get: (h, i) => h.relative_humidity_2m[i],
    fmt: (v) => `${round(v)}%`, legend: () => 'Humedad relativa',
    extra: (h, i) => `Punto de rocío ${round(h.dew_point_2m[i])}°`,
  },
  clouds: {
    tab: 'Nubosidad', color: 'var(--m-clouds)', kind: 'area', domain: [0, 100],
    get: (h, i) => h.cloud_cover[i],
    fmt: (v) => `${round(v)}%`, legend: () => 'Cobertura de nubes',
  },
  pressure: {
    tab: 'Presión', color: 'var(--m-pressure)', kind: 'line',
    get: (h, i) => h.pressure_msl[i],
    fmt: (v) => `${round(v)}`, unit: () => ' hPa', legend: () => 'Presión al nivel del mar (hPa)',
  },
  uv: {
    tab: 'Ultravioleta', color: 'var(--m-uv)', kind: 'bar', min: 0,
    get: (h, i) => h.uv_index[i],
    fmt: (v) => (v == null ? '--' : `${Math.round(v)}`), legend: () => 'Índice UV',
    extra: (h, i) => uvInfo(h.uv_index[i]).label,
  },
};

function renderMetricTabs() {
  const box = $('metric-tabs');
  box.innerHTML = '';
  for (const [key, m] of Object.entries(METRICS)) {
    const b = document.createElement('button');
    b.className = 'pill';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(key === state.metric));
    b.textContent = m.tab;
    b.addEventListener('click', () => {
      state.metric = key;
      store.set('metric', key);
      for (const el of box.children) el.setAttribute('aria-selected', String(el === b));
      renderChart();
    });
    box.appendChild(b);
  }
}

function renderChart() {
  if (!state.data) return;
  const { w } = state.data;
  const h = w.hourly;
  const m = METRICS[state.metric];
  const idx = dayWindow(w, state.day);
  const isToday = state.day === todayIndex(w);
  const svg = $('chart-svg');

  $('chart-title').textContent = m.tab;
  $('feels-toggle').hidden = state.metric !== 'general';

  const W = svg.clientWidth || 800;
  const H = 210;
  const narrow = W < 560;
  const pad = { top: 12, right: narrow ? 8 : 12, bottom: 10, left: narrow ? 34 : 44 };
  const iw = W - pad.left - pad.right;
  const ih = H - pad.top - pad.bottom;
  const slot = iw / idx.length;
  const x = (k) => pad.left + (k + 0.5) * slot;
  const step = W >= 900 ? 2 : W >= 560 ? 3 : 4;

  const vals = idx.map((i) => m.get(h, i));
  const known = vals.filter((v) => v != null);

  // Fila superior: hora, ícono y valor cada `step` horas
  const cols = $('chart-cols');
  cols.style.height = state.metric === 'wind' ? '86px' : '80px';
  cols.innerHTML = idx.map((i, k) => {
    if (k % step) return '';
    const t = h.time[i];
    const wx = wmo(h.weather_code[i], h.is_day[i]);
    const label = isToday && k === 0 ? 'Ahora' : h12(t);
    const dayTag = t.slice(11, 13) === '00' ? `${weekday(t)} ${+t.slice(8, 10)}` : '';
    const top = state.metric === 'wind'
      ? `<span class="c-arrow" style="transform:rotate(${h.wind_direction_10m[i] + 180}deg)" title="Desde ${windDir(h.wind_direction_10m[i])}">↑</span>`
      : `<img src="${wx.icon}" alt="${wx.desc}" title="${wx.desc}">`;
    return `<div class="chart-col" style="left:${x(k)}px;width:${slot * step}px">
      <div class="c-day">${dayTag}</div><div class="c-time">${label}</div>${top}
      <div class="c-val">${vals[k] == null ? '--' : m.fmt(vals[k])}</div></div>`;
  }).join('');

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

  if (!known.length) {
    svg.innerHTML = `<text class="empty" x="${W / 2}" y="${H / 2}" text-anchor="middle">Sin datos para este día</text>`;
    $('chart-strip').innerHTML = '';
    $('chart-legend').innerHTML = '';
    return;
  }

  // Escala Y
  let lo;
  let hi;
  if (m.domain) {
    [lo, hi] = m.domain;
  } else {
    const mn = Math.min(...known);
    const mx = Math.max(...known);
    const padY = Math.max((mx - mn) * 0.25, state.metric === 'pressure' ? 2 : 3);
    lo = m.min != null ? Math.max(m.min, Math.floor(mn - padY)) : Math.floor(mn - padY);
    hi = Math.ceil(mx + padY);
  }
  if (state.metric === 'uv') hi = Math.max(11, Math.ceil(Math.max(...known)));
  if (state.metric === 'air') hi = Math.max(100, Math.ceil(Math.max(...known) / 20) * 20);
  const y = (v) => pad.top + (1 - (v - lo) / (hi - lo)) * ih;

  const nTicks = 4;
  const raw = (hi - lo) / nTicks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const tStep = [1, 2, 5, 10].map((s) => s * mag).find((s) => s >= raw) ?? raw;
  const ticks = [];
  for (let t = Math.ceil(lo / tStep) * tStep; t <= hi + 1e-9; t += tStep) ticks.push(+t.toFixed(6));

  const base = pad.top + ih;
  let marks = '';
  if (m.kind === 'bar') {
    const bw = Math.max(3, slot - 4);
    marks = vals.map((v, k) => (v == null ? '' : `<rect class="bar" x="${x(k) - bw / 2}" y="${y(v)}" width="${bw}" height="${Math.max(0, base - y(v))}" style="fill:${m.color}" rx="3"/>`)).join('');
  } else {
    // Línea con huecos donde no hay datos
    let d = '';
    let started = false;
    vals.forEach((v, k) => {
      if (v == null) { started = false; return; }
      d += `${started ? 'L' : 'M'}${x(k).toFixed(1)},${y(v).toFixed(1)}`;
      started = true;
    });
    const first = vals.findIndex((v) => v != null);
    const last = vals.length - 1 - [...vals].reverse().findIndex((v) => v != null);
    const area = m.kind === 'area' && vals.every((v) => v != null)
      ? `<path d="${d}L${x(last)},${base}L${x(first)},${base}Z" fill="url(#g-${state.metric})"/>` : '';
    marks = `${area}<path class="line" d="${d}" style="stroke:${m.color}"/>`;
  }

  // Amanecer y atardecer dentro de la ventana
  let sun = '';
  const t0 = h.time[idx[0]];
  const t1 = h.time[idx[idx.length - 1]];
  w.daily.sunrise.concat(w.daily.sunset).forEach((s, n) => {
    if (s < t0 || s > `${t1.slice(0, 13)}:59`) return;
    const k = idx.findIndex((i) => h.time[i].slice(0, 13) === s.slice(0, 13));
    if (k < 0) return;
    const sx = x(k) + ((+s.slice(14, 16)) / 60 - 0.5) * slot;
    const isRise = n < w.daily.sunrise.length;
    sun += `<line class="sun-line" x1="${sx}" x2="${sx}" y1="${pad.top}" y2="${base}"/>
      <text class="sun-label" x="${sx + 4}" y="${base - 6}">${isRise ? '☀↑' : '☀↓'} ${h12(s, true)}</text>`;
  });

  svg.setAttribute('aria-label', `${m.legend()}: de ${m.fmt(Math.min(...known))} a ${m.fmt(Math.max(...known))}`);
  svg.innerHTML = `
    <defs><linearGradient id="g-${state.metric}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" style="stop-color:${m.color}" stop-opacity="0.35"/>
      <stop offset="1" style="stop-color:${m.color}" stop-opacity="0.02"/>
    </linearGradient></defs>
    ${ticks.map((t) => `<line class="grid-line" x1="${pad.left}" x2="${W - pad.right}" y1="${y(t)}" y2="${y(t)}"/>
      <text class="axis-label" x="${pad.left - 8}" y="${y(t) + 4}" text-anchor="end">${t}${state.metric === 'general' ? '°' : ''}</text>`).join('')}
    ${sun}
    ${marks}
    <line class="crosshair" id="chart-cross" y1="${pad.top}" y2="${base}" visibility="hidden"/>
    <circle class="dot" id="chart-dot" r="5" style="fill:${m.color}" visibility="hidden"/>
    <rect id="chart-hit" x="${pad.left}" y="0" width="${iw}" height="${H}" fill="transparent"/>`;

  // Franja inferior: probabilidad de precipitación por bloque (solo en información general)
  const strip = $('chart-strip');
  strip.innerHTML = state.metric !== 'general' ? '' : idx.map((i, k) => {
    if (k % step) return '';
    const block = idx.slice(k, k + step).map((j) => h.precipitation_probability[j] ?? 0);
    const pmax = Math.max(...block);
    const left = pad.left + k * slot + 1;
    const width = slot * block.length - 2;
    return `<div class="strip-cell ${pmax ? '' : 'none'}" style="left:${left}px;width:${width}px">💧${pmax}%</div>`;
  }).join('');

  $('chart-legend').innerHTML = `<span><span class="sw" style="background:${m.color}"></span>${m.legend()}</span>`
    + (state.metric === 'general' ? '<span>💧 Probabilidad de precipitación</span>' : '')
    + (sun ? '<span>☀↑ Amanecer · ☀↓ Atardecer</span>' : '');

  // Tooltip con cursor
  const tip = $('chart-tip');
  const cross = $('chart-cross');
  const dot = $('chart-dot');
  const hide = () => {
    tip.hidden = true;
    cross.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
  };
  const show = (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const k = Math.max(0, Math.min(idx.length - 1, Math.floor((px - pad.left) / slot)));
    const i = idx[k];
    const v = vals[k];
    const wx = wmo(h.weather_code[i], h.is_day[i]);
    cross.setAttribute('x1', x(k));
    cross.setAttribute('x2', x(k));
    cross.setAttribute('visibility', 'visible');
    if (v != null) {
      dot.setAttribute('cx', x(k));
      dot.setAttribute('cy', y(v));
      dot.setAttribute('visibility', m.kind === 'bar' ? 'hidden' : 'visible');
    }
    const extra = m.extra ? m.extra(h, i) : '';
    tip.innerHTML = `<span>${weekday(h.time[i])} ${h12(h.time[i])}</span><br>`
      + `<b>${v == null ? 'Sin datos' : m.fmt(v) + (m.unit ? m.unit() : '')}</b>`
      + (state.metric === 'general' ? ` · ${wx.desc}<br><span>Prob. lluvia</span> ${h.precipitation_probability[i] ?? 0}%` : '')
      + (extra ? `<br><span>${esc(extra)}</span>` : '');
    tip.hidden = false;
    const chartBox = $('chart').getBoundingClientRect();
    const half = tip.offsetWidth / 2;
    const left = r.left - chartBox.left + (x(k) / W) * r.width;
    tip.style.left = `${Math.max(half + 4, Math.min(chartBox.width - half - 4, left))}px`;
    tip.style.top = `${r.top - chartBox.top + 4}px`;
  };
  const hit = $('chart-hit');
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', hide);
}

// ---------- Detalles del tiempo ----------

function aqiInfo(v) {
  if (v == null) return { label: 'Sin datos' };
  if (v <= 20) return { label: 'Buena' };
  if (v <= 40) return { label: 'Aceptable' };
  if (v <= 60) return { label: 'Moderada' };
  if (v <= 80) return { label: 'Mala' };
  if (v <= 100) return { label: 'Muy mala' };
  return { label: 'Extremadamente mala' };
}

function uvInfo(v) {
  if (v == null) return { label: 'Sin datos' };
  if (v < 3) return { label: 'Bajo' };
  if (v < 6) return { label: 'Moderado' };
  if (v < 8) return { label: 'Alto' };
  if (v < 11) return { label: 'Muy alto' };
  return { label: 'Extremo' };
}

const BEAUFORT = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
const BEAUFORT_NAMES = ['Calma', 'Ventolina', 'Brisa muy débil', 'Brisa débil', 'Brisa moderada', 'Brisa fresca',
  'Brisa fuerte', 'Viento fuerte', 'Temporal', 'Temporal fuerte', 'Temporal muy fuerte', 'Tempestad', 'Huracán'];

function beaufort(kmh) {
  const f = BEAUFORT.findIndex((lim) => kmh < lim);
  const force = f < 0 ? 12 : f;
  return `Fuerza ${force} (${BEAUFORT_NAMES[force]})`;
}

function moonPhase(date = new Date()) {
  const SYN = 29.530588853;
  const age = (((date - Date.UTC(2000, 0, 6, 18, 14)) / 86400000) % SYN + SYN) % SYN;
  const illum = Math.round(((1 - Math.cos((2 * Math.PI * age) / SYN)) / 2) * 100);
  const phases = [
    ['Luna nueva', 'moon-new'], ['Luna creciente', 'moon-waxing-crescent'], ['Cuarto creciente', 'moon-first-quarter'],
    ['Gibosa creciente', 'moon-waxing-gibbous'], ['Luna llena', 'moon-full'], ['Gibosa menguante', 'moon-waning-gibbous'],
    ['Cuarto menguante', 'moon-last-quarter'], ['Luna menguante', 'moon-waning-crescent'],
  ];
  const [name, icon] = phases[Math.floor(((age / SYN) * 8 + 0.5) % 8)];
  const toFull = Math.round(((SYN / 2 - age) + SYN) % SYN);
  return { name, icon: `icons/wx/${icon}.svg`, illum, toFull };
}

// Mini gráfico de línea para las tarjetas (una sola serie, punto en "ahora")
function spark(values, nowK, color, id) {
  const W = 220;
  const H = 90;
  const known = values.filter((v) => v != null);
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  const span = hi - lo || 1;
  const x = (k) => 6 + (k / (values.length - 1)) * (W - 12);
  const y = (v) => 10 + (1 - (v - lo) / span) * (H - 24);
  const d = values.map((v, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)},${y(v ?? lo).toFixed(1)}`).join('');
  const past = values.slice(0, nowK + 1).map((v, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)},${y(v ?? lo).toFixed(1)}`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" style="stop-color:${color}" stop-opacity="0.3"/><stop offset="1" style="stop-color:${color}" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${d}L${x(values.length - 1)},${H}L${x(0)},${H}Z" fill="url(#${id})"/>
    <path d="${d}" fill="none" style="stroke:var(--track)" stroke-width="5" stroke-linecap="round"/>
    <path d="${past}" fill="none" style="stroke:${color}" stroke-width="5" stroke-linecap="round"/>
    <circle cx="${x(nowK)}" cy="${y(values[nowK] ?? lo)}" r="8" style="fill:${color};stroke:var(--ring)" stroke-width="3"/>
  </svg>`;
}

// Arco de medidor de 0 a max con marcador en el valor
function gauge(value, max, colors, id) {
  const R = 52;
  const frac = Math.max(0, Math.min(1, (value ?? 0) / max));
  const pt = (deg) => [70 + R * Math.cos((deg * Math.PI) / 180), 70 + R * Math.sin((deg * Math.PI) / 180)];
  const [sx, sy] = pt(135);
  const [ex, ey] = pt(45);
  const [mx, my] = pt(135 + frac * 270);
  const arc = `M${sx.toFixed(1)},${sy.toFixed(1)} A${R},${R} 0 1 1 ${ex.toFixed(1)},${ey.toFixed(1)}`;
  const stops = colors.map((c, n) => `<stop offset="${n / (colors.length - 1)}" stop-color="${c}"/>`).join('');
  return `<svg viewBox="0 0 140 130" aria-hidden="true" style="max-height:130px">
    <defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${70 - R}" y1="0" x2="${70 + R}" y2="0">${stops}</linearGradient></defs>
    <path d="${arc}" fill="none" style="stroke:var(--track)" stroke-width="10" stroke-linecap="round"/>
    <path d="${arc}" fill="none" stroke="url(#${id})" stroke-width="10" stroke-linecap="round" opacity="${value == null ? 0.2 : 1}"/>
    ${value == null ? '' : `<circle cx="${mx}" cy="${my}" r="8" style="fill:var(--card);stroke:var(--text)" stroke-width="3"/>`}
  </svg>`;
}

function ring(frac, color) {
  const R = 50;
  const C = 2 * Math.PI * R;
  return `<svg viewBox="0 0 120 120" aria-hidden="true" style="max-height:120px">
    <circle cx="60" cy="60" r="${R}" style="fill:var(--track)" opacity="0.45"/>
    <circle cx="60" cy="60" r="${R}" fill="none" style="stroke:var(--track)" stroke-width="8"/>
    <circle cx="60" cy="60" r="${R}" fill="none" style="stroke:${color}" stroke-width="8" stroke-linecap="round"
      stroke-dasharray="${C * Math.max(0, Math.min(1, frac))} ${C}" transform="rotate(-90 60 60)"/>
  </svg>`;
}

function card(title, viz, label, text) {
  return `<article class="card detail"><h3>${title}</h3><div class="viz">${viz}</div>
    <div class="label">${label}</div><p>${text}</p></article>`;
}

function trendWord(diff, th = 1) {
  if (diff > th) return 'En aumento';
  if (diff < -th) return 'En descenso';
  return 'Estable';
}

function renderDetails(p, w, air) {
  const h = w.hourly;
  const c = w.current;
  const d = w.daily;
  const t = todayIndex(w);
  const ni = nowIndex(w);
  const next = range(ni, 24, h.time.length);
  const tu = '°';
  const at = (i) => h12(h.time[i]);
  const argMax = (arr, f) => arr.reduce((b, i) => (f(i) > f(b) ? i : b), arr[0]);
  const argMin = (arr, f) => arr.reduce((b, i) => (f(i) < f(b) ? i : b), arr[0]);
  const cards = [];

  // 1. Temperatura
  {
    const win = range(Math.max(0, ni - 6), 24, h.time.length);
    const vals = win.map((i) => h.temperature_2m[i]);
    const iMax = argMax(next, (i) => h.temperature_2m[i]);
    const iMin = argMin(next, (i) => h.temperature_2m[i]);
    const tr = trendWord((h.temperature_2m[ni + 3] ?? c.temperature_2m) - c.temperature_2m);
    const text = h.temperature_2m[iMax] > c.temperature_2m + 0.5
      ? `Subirá hasta un pico de ${round(h.temperature_2m[iMax])}${tu} a las ${at(iMax)}. Mínima de ${round(h.temperature_2m[iMin])}${tu} a las ${at(iMin)}.`
      : `Bajará hasta ${round(h.temperature_2m[iMin])}${tu} a las ${at(iMin)}. Máxima de ${round(h.temperature_2m[iMax])}${tu} a las ${at(iMax)}.`;
    cards.push(card('Temperatura',
      `${spark(vals, win.indexOf(ni), 'var(--m-general)', 'sp-t')}<div class="center" style="align-items:flex-end;justify-content:flex-end;padding:0 6px 2px 0"><span class="big-num">${round(c.temperature_2m)}°</span></div>`,
      tr, text));
  }

  // 2. Sensación térmica
  {
    const diff = toC(c.apparent_temperature) - toC(c.temperature_2m);
    const label = diff > 3 ? 'Más cálida' : diff > 1 ? 'Ligeramente cálida' : diff < -3 ? 'Más fría' : diff < -1 ? 'Ligeramente fría' : 'Similar a la real';
    const factor = diff > 1 ? 'la humedad' : diff < -1 ? (toKmh(c.wind_speed_10m) > 10 ? 'el viento' : 'la baja humedad') : null;
    const text = factor
      ? `La sensación térmica es ${diff > 0 ? 'más cálida' : 'más fría'} que la temperatura real debido a ${factor}.`
      : 'La sensación térmica es prácticamente igual a la temperatura real.';
    const win = range(Math.max(0, ni - 6), 24, h.time.length);
    cards.push(card('Sensación térmica',
      `<div style="width:100%">${spark(win.map((i) => h.apparent_temperature[i]), win.indexOf(ni), 'var(--feels)', 'sp-f')}
        <div class="row" style="justify-content:space-around;margin-top:4px">
          <div class="kv"><span>Sensación</span><b class="big-num">${round(c.apparent_temperature)}°</b></div>
          <div class="kv"><span>Temperatura</span><b class="big-num">${round(c.temperature_2m)}°</b></div>
        </div></div>`,
      `${label}${factor ? ` <span class="tag">Factor: ${factor.replace(/^la |^el /, '')}</span>` : ''}`, text));
  }

  // 3. Nubosidad
  {
    const cc = c.cloud_cover;
    const name = cc < 20 ? 'Despejado' : cc < 50 ? 'Parcialmente nublado' : cc < 85 ? 'Mayormente nublado' : 'Nublado';
    const avg = next.slice(1, 7).reduce((s, i) => s + h.cloud_cover[i], 0) / 6;
    const tr = avg > cc + 10 ? 'aumente' : avg < cc - 10 ? 'disminuya' : 'se mantenga';
    cards.push(card('Nubosidad',
      `${ring(cc / 100, 'var(--m-clouds)')}<div class="center"><span class="big-num">${cc}<small>%</small></span></div>`,
      `${name} (${cc}%)`, `Se espera que la nubosidad ${tr} en las próximas 6 horas (promedio ${Math.round(avg)}%).`));
  }

  // 4. Precipitaciones
  {
    const sum = next.reduce((s, i) => s + (h.precipitation[i] ?? 0), 0);
    const first = next.find((i) => h.precipitation_probability[i] >= 30);
    const pmax = Math.max(...next.map((i) => h.precipitation_probability[i] ?? 0));
    const label = sum < 0.1 && pmax < 30 ? 'Sin precipitaciones' : sum < 2 ? 'Lluvia débil posible' : 'Lluvia prevista';
    const text = first != null
      ? `Probabilidad de ${h.precipitation_probability[first]}% a las ${at(first)}. Máxima de ${pmax}% en las próximas 24 horas.`
      : `Sin precipitaciones significativas en las próximas 24 horas (máx. ${pmax}%).`;
    cards.push(card('Precipitaciones',
      `${ring(Math.min(1, pmax / 100), 'var(--m-precip)')}<div class="center"><span class="big-num">${imperial() ? sum.toFixed(2) : sum.toFixed(1).replace(/\.0$/, '')}<small>${precipUnit()}</small></span><span class="muted" style="font-size:10px">próximas 24 h</span></div>`,
      label, text));
  }

  // 5. Viento
  {
    const dir = c.wind_direction_10m;
    const iG = argMax(next, (i) => h.wind_gusts_10m[i]);
    const compass = `<svg viewBox="0 0 120 120" aria-hidden="true" style="max-height:120px;width:120px;flex:none">
      <circle cx="60" cy="60" r="46" fill="none" style="stroke:var(--track)" stroke-width="3"/>
      ${[0, 90, 180, 270].map((a) => `<line x1="60" y1="10" x2="60" y2="18" style="stroke:var(--faint)" stroke-width="2" transform="rotate(${a} 60 60)"/>`).join('')}
      <text x="60" y="8" style="fill:var(--muted)" font-size="11" text-anchor="middle">N</text>
      <text x="116" y="64" style="fill:var(--muted)" font-size="11" text-anchor="middle">E</text>
      <text x="60" y="120" style="fill:var(--muted)" font-size="11" text-anchor="middle">S</text>
      <text x="4" y="64" style="fill:var(--muted)" font-size="11" text-anchor="middle">O</text>
      <g transform="rotate(${dir + 180} 60 60)">
        <path d="M60 24 L72 66 L60 58 L48 66 Z" style="fill:var(--m-air)"/>
        <line x1="60" y1="58" x2="60" y2="92" style="stroke:var(--m-air)" stroke-width="4" stroke-linecap="round"/>
      </g></svg>`;
    cards.push(card('Viento',
      `<div class="row">${compass}<div class="side">
        <div class="kv"><span>Desde ${windDir(dir)} (${dir}°)</span></div>
        <div class="kv"><b class="big-num">${round(c.wind_speed_10m)}</b><span>${windUnit()} · velocidad</span></div>
        <div class="kv"><b class="big-num">${round(c.wind_gusts_10m)}</b><span>${windUnit()} · ráfagas</span></div>
      </div></div>`,
      beaufort(toKmh(c.wind_speed_10m)),
      `Ráfagas máximas de ${round(h.wind_gusts_10m[iG])} ${windUnit()} a las ${at(iG)} en las próximas 24 horas.`));
  }

  // 6. Humedad
  {
    const dew = toC(c.dew_point_2m);
    const label = dew < 10 ? 'Seco' : dew < 16 ? 'Cómodo' : dew < 21 ? 'Húmedo' : 'Muy húmedo';
    const bars = next.slice(0, 7).map((i) => `<i title="${at(i)}: ${h.relative_humidity_2m[i]}%"><b style="height:${h.relative_humidity_2m[i]}%"></b></i>`).join('');
    const iMin = argMin(next, (i) => h.relative_humidity_2m[i]);
    cards.push(card('Humedad',
      `<div class="row" style="justify-content:center"><div class="hum-bars">${bars}</div><div class="side">
        <div class="kv"><b class="big-num">${c.relative_humidity_2m}%</b><span>Humedad relativa</span></div>
        <div class="kv"><b class="big-num">${round(c.dew_point_2m)}°</b><span>Punto de rocío</span></div>
      </div></div>`,
      label, `Mínima de ${h.relative_humidity_2m[iMin]}% a las ${at(iMin)}. Las barras muestran las próximas 7 horas.`));
  }

  // 7. UV
  {
    const uv = c.uv_index == null ? null : Math.round(c.uv_index);
    const todayHours = range(t * 24, 24, h.time.length);
    const iMax = argMax(todayHours, (i) => h.uv_index[i] ?? 0);
    cards.push(card('Índice UV',
      `${gauge(uv, 11, ['#4ade80', '#facc15', '#fb923c', '#f87171', '#a855f7'], 'g-uv')}<div class="center"><span class="big-num">${uv ?? '--'}</span></div>`,
      uvInfo(uv).label,
      `Máximo de ${Math.round(h.uv_index[iMax] ?? 0)} (${uvInfo(Math.round(h.uv_index[iMax] ?? 0)).label.toLowerCase()}) a las ${at(iMax)}.`
      + ((h.uv_index[iMax] ?? 0) >= 6 ? ' Usa protector solar y evita el sol del mediodía.' : '')));
  }

  // 8. Calidad del aire
  {
    const v = air?.current?.european_aqi ?? null;
    const info = aqiInfo(v);
    const pm25 = air?.current?.pm2_5;
    const pm10 = air?.current?.pm10;
    cards.push(card('Calidad del aire',
      `${gauge(v, 100, ['#4ade80', '#a3e635', '#facc15', '#fb923c', '#f87171', '#a855f7'], 'g-aqi')}<div class="center"><span class="big-num">${v ?? '--'}</span><span class="muted small">EAQI</span></div>`,
      info.label,
      v == null ? 'No hay datos de calidad del aire para esta ubicación.'
        : `PM2.5: ${pm25} µg/m³ · PM10: ${pm10} µg/m³ (índice europeo, 0–100+).`));
  }

  // 9. Visibilidad
  {
    const unit = w.current_units?.visibility;
    const vis = visibility(c.visibility, unit);
    const km = c.visibility == null ? null : (unit === 'ft' ? c.visibility * 0.3048 : c.visibility) / 1000;
    const label = km == null ? 'Sin datos' : km < 1 ? 'Muy mala' : km < 4 ? 'Mala' : km < 10 ? 'Moderada' : km < 20 ? 'Buena' : 'Excelente';
    const on = km == null ? 0 : km < 1 ? 1 : km < 4 ? 2 : km < 10 ? 3 : km < 20 ? 4 : 5;
    const bars = [40, 60, 80, 100, 120].map((wd, n) => `<i class="${4 - n < on ? '' : 'off'}" style="width:${wd}px"></i>`).join('');
    const iMin = argMin(next, (i) => h.visibility[i] ?? Infinity);
    const vMin = visibility(h.visibility[iMin], unit);
    cards.push(card('Visibilidad',
      `<div style="text-align:center"><div class="vis-bars">${bars}</div><div class="big-num" style="margin-top:10px">${vis == null ? '--' : vis >= 10 ? Math.round(vis) : vis.toFixed(1)}<small>${imperial() ? 'mi' : 'km'}</small></div></div>`,
      label,
      vMin == null ? '' : `Mínima de ${vMin >= 10 ? Math.round(vMin) : vMin.toFixed(1)} ${imperial() ? 'mi' : 'km'} a las ${at(iMin)} en las próximas 24 horas.`));
  }

  // 10. Presión
  {
    const win = range(Math.max(0, ni - 6), 24, h.time.length);
    const prev = h.pressure_msl[Math.max(0, ni - 3)];
    const tr = trendWord(c.pressure_msl - prev, 0.8);
    const fut = h.pressure_msl[Math.min(h.time.length - 1, ni + 6)];
    cards.push(card('Presión',
      `<div style="width:100%">${spark(win.map((i) => h.pressure_msl[i]), win.indexOf(ni), 'var(--m-pressure)', 'sp-p')}
        <div class="big-num" style="margin-top:4px">${round(c.pressure_msl)}<small>hPa</small></div></div>`,
      tr, `${tr === 'Estable' ? 'Sin cambios importantes' : tr === 'En aumento' ? 'Subió' : 'Bajó'} en las últimas 3 horas. Se espera ${round(fut)} hPa dentro de 6 horas.`));
  }

  // 11. Sol
  {
    const rise = d.sunrise[t];
    const set = d.sunset[t];
    const nowM = minutesOf(c.time);
    const r = minutesOf(rise);
    const s = minutesOf(set);
    const frac = (nowM - r) / (s - r);
    const isDay = frac >= 0 && frac <= 1;
    const ang = Math.PI * (1 - Math.max(0, Math.min(1, frac)));
    const sx = 110 + 80 * Math.cos(ang);
    const sy = 95 - 80 * Math.sin(ang);
    const light = Math.round(d.daylight_duration[t] / 60);
    const arcLen = Math.PI * 80;
    cards.push(card('Sol',
      `<svg viewBox="0 0 220 110" aria-hidden="true">
        <line x1="10" y1="95" x2="210" y2="95" style="stroke:var(--track)" stroke-width="2"/>
        <path d="M30 95 A80 80 0 0 1 190 95" fill="none" style="stroke:var(--track)" stroke-width="4" stroke-linecap="round"/>
        <path d="M30 95 A80 80 0 0 1 190 95" fill="none" style="stroke:var(--sun)" stroke-width="4" stroke-linecap="round"
          stroke-dasharray="${arcLen * Math.max(0, Math.min(1, frac))} ${arcLen}"/>
        <circle cx="30" cy="95" r="5" style="fill:var(--muted)"/><circle cx="190" cy="95" r="5" style="fill:var(--muted)"/>
        ${isDay ? `<circle cx="${sx}" cy="${sy}" r="11" style="fill:var(--sun);stroke:var(--ring)" stroke-width="3"/>` : ''}
      </svg>`,
      `☀↑ ${h12(rise, true)} &nbsp; ☀↓ ${h12(set, true)}`,
      `${Math.floor(light / 60)} h ${light % 60} min de luz solar. ${isDay ? `Faltan ${Math.floor((s - nowM) / 60)} h ${(s - nowM) % 60} min para el atardecer.` : 'Es de noche en esta ubicación.'}`));
  }

  // 12. Luna
  {
    const mp = moonPhase();
    cards.push(card('Luna',
      `<img class="moon-img" src="${mp.icon}" alt="${mp.name}">`,
      mp.name,
      `Iluminación del ${mp.illum}%. ${mp.toFull === 0 ? 'Hoy hay luna llena.' : `Próxima luna llena en ${mp.toFull} días.`}`));
  }

  $('details').innerHTML = cards.join('');
}

// ---------- Mapa y radar ----------

const map = { obj: null, marker: null, radar: null, frames: [], frame: 0, playing: null };

function initMap() {
  if (map.obj || typeof L === 'undefined') return;
  map.obj = L.map('map', { zoomControl: true, attributionControl: true, scrollWheelZoom: false })
    .setView([DEFAULT_PLACE.lat, DEFAULT_PLACE.lon], 7);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 12,
    className: 'base-tiles',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Radar: <a href="https://www.rainviewer.com/">RainViewer</a>',
  }).addTo(map.obj);
  $('radar-play').addEventListener('click', toggleRadar);
}

function updateMap(p, w) {
  initMap();
  if (!map.obj) return;
  const c = w.current;
  const wx = wmo(c.weather_code, c.is_day);
  map.obj.setView([p.lat, p.lon], 7);
  const html = `<div class="map-pin"><img src="${wx.icon}" alt="">${round(c.temperature_2m)}°</div>`;
  const icon = L.divIcon({ html, className: '', iconSize: null, iconAnchor: [20, 16] });
  if (map.marker) map.marker.setLatLng([p.lat, p.lon]).setIcon(icon);
  else map.marker = L.marker([p.lat, p.lon], { icon, keyboard: false }).addTo(map.obj);
  loadRadar();
}

async function loadRadar() {
  try {
    const data = await getJSON(RADAR_URL);
    map.host = data.host;
    map.frames = data.radar?.past ?? [];
    if (!map.frames.length) return;
    showFrame(map.frames.length - 1);
  } catch {
    $('radar-time').textContent = 'Radar no disponible';
  }
}

function showFrame(n) {
  const f = map.frames[n];
  if (!f || !map.obj) return;
  map.frame = n;
  const url = `${map.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`;
  const layer = L.tileLayer(url, { opacity: 0.75, maxNativeZoom: 7, maxZoom: 12, zIndex: 5 });
  layer.addTo(map.obj);
  const old = map.radar;
  map.radar = layer;
  if (old) setTimeout(() => map.obj.removeLayer(old), 250);
  const mins = Math.round((Date.now() / 1000 - f.time) / 60);
  $('radar-time').textContent = `Radar de lluvia · ${new Date(f.time * 1000).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })} (hace ${mins} min)`;
}

function toggleRadar() {
  const btn = $('radar-play');
  if (map.playing) {
    clearInterval(map.playing);
    map.playing = null;
    btn.textContent = '▶';
    btn.setAttribute('aria-label', 'Reproducir radar');
    showFrame(map.frames.length - 1);
    return;
  }
  btn.textContent = '❚❚';
  btn.setAttribute('aria-label', 'Pausar radar');
  map.playing = setInterval(() => showFrame((map.frame + 1) % map.frames.length), 700);
}

// ---------- Accesos rápidos (favoritos) ----------

async function renderQuick() {
  const nav = $('quick');
  const favs = state.favorites;
  $('btn-fav').textContent = favs.some((f) => samePlace(f, state.place)) ? '★' : '☆';
  if (!favs.length) { nav.innerHTML = ''; return; }

  let current = [];
  try {
    const params = unitParams(new URLSearchParams({
      latitude: favs.map((f) => f.lat).join(','),
      longitude: favs.map((f) => f.lon).join(','),
      current: 'temperature_2m,weather_code,is_day',
      timezone: 'auto',
    }));
    const res = await getJSON(`${FORECAST_URL}?${params}`);
    current = (Array.isArray(res) ? res : [res]).map((r) => r.current);
  } catch { /* sin temperaturas: se muestran solo los nombres */ }

  nav.innerHTML = '';
  favs.forEach((f, n) => {
    const cur = current[n];
    const b = document.createElement('button');
    b.className = `quick-chip${samePlace(f, state.place) ? ' active' : ''}`;
    b.title = placeLabel(f);
    b.innerHTML = cur
      ? `<span></span><img src="${wmo(cur.weather_code, cur.is_day).icon}" alt=""><b>${round(cur.temperature_2m)}°</b>`
      : '<span></span>';
    b.firstChild.textContent = f.name;
    b.addEventListener('click', () => load(f));
    nav.appendChild(b);
  });
}

// ---------- Flujo principal ----------

function renderAll(p, w, air) {
  state.data = { p, w, air };
  state.airByTime = new Map((air?.hourly?.time ?? []).map((t, n) => [t, air.hourly.european_aqi[n]]));
  if (state.day == null || state.day >= w.daily.time.length) state.day = todayIndex(w);
  renderNow(p, w, air);
  renderDays(w);
  renderChart();
  renderDetails(p, w, air);
  updateMap(p, w);
}

async function load(p, { silent = false } = {}) {
  const seq = ++state.seq;
  const changed = !samePlace(p, state.place);
  state.place = p;
  if (changed) state.day = null;
  store.set('place', p);
  if (!silent) setStatus('Actualizando…');
  try {
    const [w, air] = await Promise.all([fetchWeather(p), fetchAir(p)]);
    if (seq !== state.seq) return; // llegó otra petición más reciente
    renderAll(p, w, air);
    setStatus('');
    store.set('lastData', { p, w, air, units: state.units });
  } catch (err) {
    if (seq !== state.seq) return;
    const cached = store.get('lastData', null);
    if (cached && samePlace(cached.p, p) && cached.units === state.units) {
      renderAll(cached.p, cached.w, cached.air);
      setStatus('Sin conexión: mostrando los últimos datos guardados.');
    } else {
      setStatus(`No se pudo obtener el clima (${err.message}). Revisa tu conexión.`);
    }
  }
  renderQuick();
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
      small.textContent = ` ${[p.admin, p.country].filter(Boolean).join(', ')}`;
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

// ---------- Tema ----------

const lightQuery = window.matchMedia?.('(prefers-color-scheme: light)');

function applyTheme() {
  const dark = state.theme === 'dark' || (state.theme === 'auto' && !lightQuery?.matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b1730' : '#eef2f8');
}

function setupTheme() {
  const sel = $('theme-select');
  sel.value = state.theme;
  sel.addEventListener('change', () => {
    state.theme = sel.value;
    store.set('theme', state.theme);
    applyTheme();
  });
  // En modo automático sigue los cambios del sistema operativo.
  lightQuery?.addEventListener?.('change', () => { if (state.theme === 'auto') applyTheme(); });
  applyTheme();
}

// ---------- Inicio ----------

function init() {
  setupTheme();
  $('btn-units').textContent = tempUnit();
  setupSearch();
  renderMetricTabs();

  $('btn-locate').addEventListener('click', locate);

  $('btn-units').addEventListener('click', () => {
    state.units = imperial() ? 'metric' : 'imperial';
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
    renderQuick();
  });

  $('feels-input').addEventListener('change', (e) => {
    state.feels = e.target.checked;
    renderChart();
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderChart();
      map.obj?.invalidateSize();
    }, 150);
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
