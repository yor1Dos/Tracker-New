const weatherCodes = {
  0:  ['Clear sky', '☀'],
  1:  ['Mainly clear', '🌤'],
  2:  ['Partly cloudy', '⛅'],
  3:  ['Overcast', '☁'],
  45: ['Fog', '🌫'],
  48: ['Depositing rime fog', '🌫'],
  51: ['Light drizzle', '🌦'],
  53: ['Drizzle', '🌦'],
  55: ['Dense drizzle', '🌧'],
  61: ['Slight rain', '🌦'],
  63: ['Moderate rain', '🌧'],
  65: ['Heavy rain', '🌧'],
  71: ['Slight snow', '🌨'],
  73: ['Moderate snow', '🌨'],
  75: ['Heavy snow', '❄'],
  80: ['Rain showers', '🌦'],
  81: ['Moderate showers', '🌧'],
  82: ['Violent showers', '⛈'],
  95: ['Thunderstorm', '⛈'],
  96: ['Thunderstorm with hail', '⛈'],
  99: ['Severe thunderstorm with hail', '⛈']
};

const pageMeta = {
  overview:  ['EMERGENCY MANAGEMENT PLATFORM', 'Situation overview'],
  map:       ['GEOSPATIAL MONITOR', 'Live incident map'],
  weather:   ['OPEN-METEO', 'Weather conditions'],
  alerts:    ['VERIFIED FEED', 'Disaster alerts'],
  emergency: ['QUICK RESPONSE', 'Emergency assistance'],
  qr:        ['QUICK ACCESS', 'QR access & sources']
};

function QuakeEvent(feature, userLat, userLon, app) {
  const coords = feature.geometry.coordinates;
  this.mag   = feature.properties.mag;
  this.place = feature.properties.place || 'Earthquake event';
  this.time  = new Date(feature.properties.time);
  this.url   = feature.properties.url;
  this.dist  = app.distanceKm(userLat, userLon, coords[1], coords[0]);
}

QuakeEvent.prototype.render = function (app) {
  return `<div class="alert-item">
    <b>M ${app.fmt(this.mag, 1)} · ${app.escapeHtml(this.place)}</b>
    <span>${Math.round(this.dist)} km from selected point ·
      ${this.time.toLocaleString()} ·
      <a href="${this.url}" target="_blank" rel="noopener">USGS details</a></span>
  </div>`;
};

class ResQApp {
  constructor() {
    this.map = null;
    this.userMarker = null;
    this.userCoords = null;
    this.watchId = null;
    this.facilityMarkers = [];
    this.lastWeather = null;

    this.config = {
      mapStyle: 'https://tiles.openfreemap.org/styles/liberty',
      initialCenter: [121.0, 16.5],
      initialZoom: 5,
      weatherUrl: 'https://api.open-meteo.com/v1/forecast',
      quakeFeed: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
      overpassUrl: 'https://overpass-api.de/api/interpreter',
      geocodeUrl: 'https://nominatim.openstreetmap.org/search'
    };

    this.$ = (id) => document.getElementById(id);
  }

  fmt(n, digits = 0) {
    return Number.isFinite(Number(n)) ? Number(n).toFixed(digits) : '--';
  }

  toast(msg) {
    const el = this.$('toast');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2800);
  }

  setText(id, value) { this.$(id).textContent = value; }

  escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  distanceKm(a, b, c, d) {
    const rad = x => x * Math.PI / 180;
    const x = rad(c - a), y = rad(d - b);
    const h = Math.sin(x / 2) ** 2 +
              Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(y / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  initMap() {
    if (!window.maplibregl) {
      this.setText('map-status', 'Map library failed to load. Check your internet connection.');
      return;
    }
    this.map = new maplibregl.Map({
      container: 'map',
      style: this.config.mapStyle,
      center: this.config.initialCenter,
      zoom: this.config.initialZoom,
      pitch: 48,
      bearing: -15,
      attributionControl: true
    });
    this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    this.map.addControl(new maplibregl.ScaleControl(), 'bottom-left');

    this.map.on('load', () => {
      const layers = this.map.getStyle().layers || [];
      const sourceLayer = layers.find(l => l['source-layer'] === 'building');
      if (sourceLayer) {
        this.map.addLayer({
          id: '3d-buildings',
          source: sourceLayer.source,
          'source-layer': 'building',
          type: 'fill-extrusion',
          minzoom: 14,
          paint: {
            'fill-extrusion-color': '#9aa9bb',
            'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 8],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
            'fill-extrusion-opacity': 0.72
          }
        });
      }
      this.setText('map-status', 'Map loaded · OpenStreetMap-based map');
    });

    this.map.on('error', () =>
      this.setText('map-status', 'Map tile or style error. Check connection.'));
  }

  setUserLocation(lat, lon, zoom = true) {
    this.userCoords = { lat, lon };
    const ll = [lon, lat];

    if (!this.userMarker) {
      const el = document.createElement('div');
      el.className = 'user-marker';
      el.innerHTML = '<span></span>';
      this.userMarker = new maplibregl.Marker({ element: el }).setLngLat(ll).addTo(this.map);
    } else {
      this.userMarker.setLngLat(ll);
    }

    if (zoom && this.map) {
      this.map.flyTo({ center: ll, zoom: 14, pitch: 50, duration: 1200 });
    }

    this.setText('location-label', `${lat.toFixed(5)}, ${lon.toFixed(5)}`);
    this.setText('stat-gps', this.watchId !== null ? 'Live' : 'Located');
    this.setText('stat-gps-note', 'GPS position available');
    this.setText('map-status', `Position updated · ${new Date().toLocaleTimeString()}`);

    this.loadWeather(lat, lon);
    this.loadEarthquakes(lat, lon);
    this.updateQr();
  }

  locateMe() {
    if (!navigator.geolocation) { this.toast('This browser does not support GPS.'); return; }
    this.setText('map-status', 'Requesting location permission…');

    navigator.geolocation.getCurrentPosition(pos => {
      this.setUserLocation(pos.coords.latitude, pos.coords.longitude);
      if (this.watchId === null) {
        this.watchId = navigator.geolocation.watchPosition(
          p => this.setUserLocation(p.coords.latitude, p.coords.longitude, false),
          e => {
            this.setText('stat-gps', 'Paused');
            this.setText('stat-gps-note', e.message);
          },
          { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
        );
      }
      this.toast('Your location is available on this device.');
    }, err => {
      const messages = {
        1: 'Location permission was denied. Enable it in browser settings.',
        2: 'GPS location is unavailable. Try manual place search.',
        3: 'Location request timed out. Try again.'
      };
      this.setText('map-status', messages[err.code] || 'Unable to access location.');
      this.setText('stat-gps', 'Unavailable');
      this.toast(messages[err.code] || err.message);
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  }

  async searchPlace() {
    const q = this.$('search-input').value.trim();
    if (!q) { this.toast('Enter a place to search.'); return; }
    this.setText('map-status', 'Searching location…');
    try {
      const r = await fetch(
        `${this.config.geocodeUrl}?format=json&limit=1&q=${encodeURIComponent(q)}`);
      if (!r.ok) throw Error('Geocoding service unavailable');
      const data = await r.json();
      if (!data.length) throw Error('No matching location found');

      const p = data[0], lat = +p.lat, lon = +p.lon;
      this.map.flyTo({ center: [lon, lat], zoom: 13, pitch: 45 });
      this.setText('location-label', p.display_name.split(',').slice(0, 2).join(','));
      this.setText('map-status', `Showing search result · ${p.display_name}`);
      this.loadWeather(lat, lon);
      this.loadEarthquakes(lat, lon);
      this.toast('Map centered on selected place.');
    } catch (e) {
      this.setText('map-status', e.message);
      this.toast(e.message);
    }
  }

  async loadWeather(lat, lon) {
    try {
      const url = `${this.config.weatherUrl}?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,` +
        `precipitation,weather_code,pressure_msl,wind_speed_10m,wind_direction_10m` +
        `&hourly=precipitation_probability,temperature_2m,weather_code` +
        `&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max,` +
        `precipitation_probability_max&forecast_days=7&timezone=auto`;

      const r = await fetch(url);
      if (!r.ok) throw Error('Weather service unavailable');
      const d = await r.json();
      this.lastWeather = d;

      const c = d.current;
      const desc = weatherCodes[c.weather_code] || ['Unknown', '🌡'];

      this.setText('stat-temp', `${this.fmt(c.temperature_2m)}°`);
      this.setText('stat-condition', desc[0]);
      this.setText('weather-temp', `${this.fmt(c.temperature_2m)}°C`);
      this.setText('weather-description', desc[0]);
      this.setText('weather-symbol', desc[1]);
      this.setText('feels-like', `${this.fmt(c.apparent_temperature)}°C`);
      this.setText('rain-chance', `${this.fmt(d.hourly?.precipitation_probability?.[0])}%`);
      this.setText('wind-speed', `${this.fmt(c.wind_speed_10m)} km/h · ${this.fmt(c.wind_direction_10m)}°`);
      this.setText('humidity', `${this.fmt(c.relative_humidity_2m)}%`);
      this.setText('pressure', `${this.fmt(c.pressure_msl)} hPa`);
      this.setText('uv-index', this.fmt(d.daily?.uv_index_max?.[0], 1));

      this.$('hourly-list').innerHTML = d.hourly.time.slice(0, 8).map((t, i) =>
        `<div class="hour">
          <small>${new Date(t).toLocaleTimeString([], { hour: 'numeric' })}</small>
          <span>${(weatherCodes[d.hourly.weather_code[i]] || ['', '🌡'])[1]}</span>
          <b>${this.fmt(d.hourly.temperature_2m[i])}°</b>
          <small>${this.fmt(d.hourly.precipitation_probability[i])}% rain</small>
        </div>`).join('');

      this.$('daily-list').innerHTML = d.daily.time.map((t, i) =>
        `<div class="day-row">
          <b>${i === 0 ? 'Today' : new Date(t + 'T12:00:00')
            .toLocaleDateString([], { weekday: 'short' })}</b>
          <span>${(weatherCodes[d.daily.weather_code[i]] || ['', '🌡'])[1]} ` +
            `${this.fmt(d.daily.precipitation_probability_max[i])}%</span>
          <b>${this.fmt(d.daily.temperature_2m_max[i])}° / ` +
            `${this.fmt(d.daily.temperature_2m_min[i])}°</b>
        </div>`).join('');

      this.setText('updated-label',
        `Weather updated ${new Date().toLocaleTimeString()} · Open-Meteo`);

      const risk = (c.precipitation >= 10 || c.wind_speed_10m >= 50) ? 'High'
                 : (c.precipitation >= 2  || c.wind_speed_10m >= 30) ? 'Moderate'
                 : 'Low';
      this.setText('stat-risk', risk);
      this.setText('stat-risk-note', 'Weather indicator only · not an official hazard rating');
    } catch (e) {
      this.setText('weather-description', e.message);
      this.setText('stat-condition', 'Weather unavailable');
      this.toast(e.message);
    }
  }

  async loadEarthquakes(lat, lon) {
    try {
      const r = await fetch(this.config.quakeFeed);
      if (!r.ok) throw Error('USGS feed unavailable');
      const data = await r.json();
      const features = data.features || [];
      this.setText('stat-quakes', features.length);

      const near = features
        .map(f => new QuakeEvent(f, lat, lon, this))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 8);

      this.$('alert-list').innerHTML = near.length
        ? near.map(q => q.render(this)).join('')
        : '<div class="empty-state">No events in the current feed.</div>';
    } catch (e) {
      this.$('alert-list').innerHTML =
        `<div class="empty-state">${this.escapeHtml(e.message)}</div>`;
      this.setText('stat-quakes', 'N/A');
    }
  }

  async findFacilities() {
    if (!this.map) { this.toast('Map is not ready.'); return; }
    const center = this.map.getCenter();
    const query = `[out:json][timeout:20];` +
      `(node["amenity"~"hospital|clinic|police|fire_station|shelter"](around:5000,${center.lat},${center.lng});` +
      `way["amenity"~"hospital|clinic|police|fire_station|shelter"](around:5000,${center.lat},${center.lng});` +
      `);out center 30;`;

    this.setText('map-status', 'Searching OpenStreetMap for nearby facilities…');
    try {
      const r = await fetch(this.config.overpassUrl, { method: 'POST', body: query });
      if (!r.ok) throw Error('Facility search service unavailable');
      const d = await r.json();

      this.clearFacilities();
      d.elements.forEach(el => {
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        if (!lat || !lon) return;
        const name = el.tags?.name || el.tags?.amenity || 'Emergency facility';
        const m = new maplibregl.Marker({ color: '#e87932' })
          .setLngLat([lon, lat])
          .setPopup(new maplibregl.Popup().setHTML(
            `<b>${this.escapeHtml(name)}</b><br>` +
            `${this.escapeHtml(el.tags?.amenity || 'Facility')}<br>` +
            `<small>OpenStreetMap data</small>`))
          .addTo(this.map);
        this.facilityMarkers.push(m);
      });

      this.setText('map-status',
        `${this.facilityMarkers.length} nearby facilities shown · OpenStreetMap`);
      this.toast(`${this.facilityMarkers.length} facilities found.`);
    } catch (e) {
      this.setText('map-status', e.message);
      this.toast(e.message);
    }
  }

  clearFacilities() {
    this.facilityMarkers.forEach(m => m.remove());
    this.facilityMarkers = [];
  }

  coordsText() {
    return this.userCoords
      ? `${this.userCoords.lat.toFixed(6)}, ${this.userCoords.lon.toFixed(6)}`
      : null;
  }

  sosMessage() {
    return `EMERGENCY ALERT! I NEED HELP. My current location is ` +
      `${this.coordsText() || 'not available'}. Please contact emergency responders. ` +
      (this.userCoords
        ? `Map: https://www.openstreetmap.org/?mlat=${this.userCoords.lat}&mlon=${this.userCoords.lon}#map=16/${this.userCoords.lat}/${this.userCoords.lon}`
        : '');
  }

  saveContact() {
    localStorage.setItem('resqContactName', this.$('contact-name').value);
    localStorage.setItem('resqContactNumber', this.$('contact-number').value);
    this.toast('Contact saved on this device.');
  }

  shareLocation() {
    if (!this.userCoords) { this.toast('Get your GPS location first.'); return; }
    const text = `My current location: ${this.coordsText()} ` +
      `https://www.openstreetmap.org/?mlat=${this.userCoords.lat}` +
      `&mlon=${this.userCoords.lon}#map=16/${this.userCoords.lat}/${this.userCoords.lon}`;
    if (navigator.share) navigator.share({ title: 'My emergency location', text }).catch(() => {});
    else if (navigator.clipboard)
      navigator.clipboard.writeText(text).then(() => this.toast('Location link copied.'));
    else this.toast(text);
  }

  copyCoords() {
    if (!this.coordsText()) { this.toast('GPS coordinates are not available.'); return; }
    navigator.clipboard?.writeText(this.coordsText())
      .then(() => this.toast('Coordinates copied.'))
      .catch(() => this.toast('Clipboard unavailable.'));
  }

  updateQr() {
    const url = location.protocol === 'https:' ? location.href.split('#')[0] : null;
    this.$('qrcode').innerHTML = '';
    if (!url || !window.QRCode) {
      this.$('qrcode').innerHTML =
        '<span class="muted">Deploy to HTTPS to create a shareable QR code.</span>';
      return;
    }
    new QRCode(this.$('qrcode'), {
      text: url, width: 150, height: 150,
      colorDark: '#10203a', colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.H
    });
    this.setText('qr-url', url);
  }

  downloadQr() {
    const canvas = this.$('qrcode').querySelector('canvas');
    const img = this.$('qrcode').querySelector('img');
    const src = canvas?.toDataURL('image/png') || img?.src;
    if (!src) {
      this.toast('QR code is not available. Deploy this site over HTTPS.');
      return;
    }
    const a = document.createElement('a');
    a.href = src;
    a.download = 'resq-emergency-access-qr.png';
    a.click();
  }

  refresh() {
    if (this.userCoords) {
      this.loadWeather(this.userCoords.lat, this.userCoords.lon);
      this.loadEarthquakes(this.userCoords.lat, this.userCoords.lon);
    } else this.locateMe();
  }

  setMenu(open) {
    const sidebar = this.$('sidebar'), overlay = this.$('nav-overlay');
    sidebar.classList.toggle('open', open);
    overlay.classList.toggle('show', open);
    this.$('menu-toggle').setAttribute('aria-expanded', String(open));
  }

  showPage(id) {
    if (!pageMeta[id]) id = 'overview';
    document.querySelectorAll('.view').forEach(v =>
      v.classList.toggle('active', v.id === 'view-' + id));
    document.querySelectorAll('.nav a[data-nav]').forEach(a => {
      const on = a.dataset.nav === id;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    this.setText('page-eyebrow', pageMeta[id][0]);
    this.setText('page-title', pageMeta[id][1]);
    document.title = pageMeta[id][1] + ' \u00b7 ResQ';
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (id === 'map' && this.map) setTimeout(() => this.map.resize(), 60);
    this.setMenu(false);
  }

  bindEvents() {
    this.$('locate-btn').addEventListener('click', () => this.locateMe());
    this.$('search-btn').addEventListener('click', () => this.searchPlace());
    this.$('search-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') this.searchPlace();
    });
    this.$('facilities-btn').addEventListener('click', () => this.findFacilities());
    this.$('clear-facilities').addEventListener('click', () => this.clearFacilities());
    this.$('refresh-btn').addEventListener('click', () => this.refresh());

    this.$('fullscreen-btn').addEventListener('click', () => {
      const el = this.$('map-section');
      if (!document.fullscreenElement) el.requestFullscreen?.();
      else document.exitFullscreen?.();
      setTimeout(() => this.map?.resize(), 250);
    });

    this.$('theme-toggle').addEventListener('click', () => {
      document.body.classList.toggle('dark');
      localStorage.setItem('resqTheme',
        document.body.classList.contains('dark') ? 'dark' : 'light');
      this.map?.resize();
      this.setMenu(false);
    });

    document.querySelectorAll('[data-nav]').forEach(el =>
      el.addEventListener('click', e => {
        e.preventDefault();
        const id = el.dataset.nav;
        if (location.hash === '#' + id) this.showPage(id);
        else location.hash = id;
      }));

    window.addEventListener('hashchange', () => this.showPage(location.hash.slice(1)));
    window.addEventListener('resize', () => {
      if (window.innerWidth > 700) this.setMenu(false);
      this.map?.resize();
    });

    this.$('menu-toggle').addEventListener('click', () =>
      this.setMenu(!this.$('sidebar').classList.contains('open')));
    this.$('nav-overlay').addEventListener('click', () => this.setMenu(false));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') this.setMenu(false);
    });

    this.$('sos-btn').addEventListener('click', () => {
      if (!this.userCoords) {
        this.toast('GPS unavailable. Locate yourself before preparing SOS.');
        return;
      }
      this.$('sos-preview').textContent = this.sosMessage();
      this.$('confirm-modal').classList.add('open');
    });
    this.$('cancel-sos').addEventListener('click', () =>
      this.$('confirm-modal').classList.remove('open'));
    this.$('confirm-sos').addEventListener('click', () => {
      this.$('confirm-modal').classList.remove('open');
      const number = this.$('contact-number').value.trim();
      const message = this.sosMessage();
      if (navigator.share) {
        navigator.share({ title: 'Emergency alert', text: message }).catch(() => {});
        return;
      }
      if (number)
        location.href = `sms:${encodeURIComponent(number)}?body=${encodeURIComponent(message)}`;
      else if (navigator.clipboard)
        navigator.clipboard.writeText(message)
          .then(() => this.toast('Message copied. Choose your messaging app to send it.'));
      else this.toast('No supported sharing method found.');
    });

    this.$('save-contact').addEventListener('click', () => this.saveContact());
    this.$('share-location').addEventListener('click', () => this.shareLocation());
    this.$('copy-coords').addEventListener('click', () => this.copyCoords());
    this.$('download-qr').addEventListener('click', () => this.downloadQr());

    window.addEventListener('online', () => this.setText('connection-status', 'Online'));
    window.addEventListener('offline', () => this.setText('connection-status', 'Offline'));

    new MutationObserver(() => {
      this.$('overview-alerts').innerHTML =
        [...this.$('alert-list').children].slice(0, 3).map(n => n.outerHTML).join('');
    }).observe(this.$('alert-list'), { childList: true });
  }

  init() {
    if (localStorage.getItem('resqTheme') === 'dark') document.body.classList.add('dark');
    this.$('contact-name').value = localStorage.getItem('resqContactName') || '';
    this.$('contact-number').value = localStorage.getItem('resqContactNumber') || '';
    this.setText('connection-status', navigator.onLine ? 'Online' : 'Offline');
    this.bindEvents();
    this.initMap();
    this.updateQr();
    this.showPage(location.hash.slice(1));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.resq = new ResQApp();
  window.resq.init();
});
