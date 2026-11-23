const $ = (id) => document.getElementById(id);
let map, userMarker, userCoords = null, watchId = null, facilityMarkers = [], lastWeather = null;
const fmt = (n, digits=0) => Number.isFinite(Number(n)) ? Number(n).toFixed(digits) : '--';
function toast(msg){const el=$('toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2800)}
function setText(id,value){$(id).textContent=value}
function initMap(){
  if(!window.maplibregl){setText('map-status','Map library failed to load. Check your internet connection.');return}
  map=new maplibregl.Map({container:'map',style:'https://tiles.openfreemap.org/styles/liberty',center:[121.0,16.5],zoom:5,pitch:48,bearing:-15,attributionControl:true});
  map.addControl(new maplibregl.NavigationControl({visualizePitch:true}),'top-right');
  map.addControl(new maplibregl.ScaleControl(),'bottom-left');
  map.on('load',()=>{
    // Add 3D building extrusions only when the selected style exposes building source layers.
    const layers=map.getStyle().layers||[];
    const label=layers.find(l=>l.type==='symbol'&&l.layout&&l.layout['text-field']);
    const sourceLayer=layers.find(l=>l['source-layer']==='building');
    if(sourceLayer){
      map.addLayer({id:'3d-buildings',source:sourceLayer.source,'source-layer':'building',type:'fill-extrusion',minzoom:14,
        paint:{'fill-extrusion-color':'#9aa9bb','fill-extrusion-height':['coalesce',['get','render_height'],['get','height'],8],
          'fill-extrusion-base':['coalesce',['get','render_min_height'],0],'fill-extrusion-opacity':.72}});
    }
    setText('map-status','Map loaded · OpenStreetMap-based map');
  });
  map.on('error',()=>setText('map-status','Map tile or style error. Check connection.'));
}
function setUserLocation(lat,lon,zoom=true){
  userCoords={lat,lon};
  const ll=[lon,lat];
  if(!userMarker){
    const el=document.createElement('div');el.className='user-marker';el.innerHTML='<span></span>';
    userMarker=new maplibregl.Marker({element:el}).setLngLat(ll).addTo(map);
  }else userMarker.setLngLat(ll);
  if(zoom&&map)map.flyTo({center:ll,zoom:14,pitch:50,duration:1200});
  setText('location-label',`${lat.toFixed(5)}, ${lon.toFixed(5)}`);
  setText('stat-gps',watchId!==null?'Live':'Located');
  setText('stat-gps-note','GPS position available');
  setText('map-status',`Position updated · ${new Date().toLocaleTimeString()}`);
  loadWeather(lat,lon);loadEarthquakes(lat,lon);
  updateQr();
}
function locateMe(){
  if(!navigator.geolocation){toast('This browser does not support GPS.');return}
  setText('map-status','Requesting location permission…');
  navigator.geolocation.getCurrentPosition(pos=>{
    setUserLocation(pos.coords.latitude,pos.coords.longitude);
    if(watchId===null){
      watchId=navigator.geolocation.watchPosition(p=>setUserLocation(p.coords.latitude,p.coords.longitude,false),
        e=>{setText('stat-gps','Paused');setText('stat-gps-note',e.message)}, {enableHighAccuracy:true,maximumAge:10000,timeout:20000});
    }
    toast('Your location is available on this device.');
  },err=>{
    const messages={1:'Location permission was denied. Enable it in browser settings.',2:'GPS location is unavailable. Try manual place search.',3:'Location request timed out. Try again.'};
    setText('map-status',messages[err.code]||'Unable to access location.');setText('stat-gps','Unavailable');toast(messages[err.code]||err.message);
  },{enableHighAccuracy:true,timeout:15000,maximumAge:30000});
}
async function searchPlace(){
  const q=$('search-input').value.trim();if(!q){toast('Enter a place to search.');return}
  setText('map-status','Searching location…');
  try{
    const r=await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`);
    if(!r.ok)throw Error('Geocoding service unavailable');
    const data=await r.json();if(!data.length)throw Error('No matching location found');
    const p=data[0],lat=+p.lat,lon=+p.lon;map.flyTo({center:[lon,lat],zoom:13,pitch:45});
    setText('location-label',p.display_name.split(',').slice(0,2).join(','));
    setText('map-status',`Showing search result · ${p.display_name}`);
    // Manual map center is not represented as verified GPS.
    loadWeather(lat,lon);loadEarthquakes(lat,lon);toast('Map centered on selected place.');
  }catch(e){setText('map-status',e.message);toast(e.message)}
}
const weatherCodes={0:['Clear sky','☀'],1:['Mainly clear','🌤'],2:['Partly cloudy','⛅'],3:['Overcast','☁'],45:['Fog','🌫'],48:['Depositing rime fog','🌫'],51:['Light drizzle','🌦'],53:['Drizzle','🌦'],55:['Dense drizzle','🌧'],61:['Slight rain','🌦'],63:['Moderate rain','🌧'],65:['Heavy rain','🌧'],71:['Slight snow','🌨'],73:['Moderate snow','🌨'],75:['Heavy snow','❄'],80:['Rain showers','🌦'],81:['Moderate showers','🌧'],82:['Violent showers','⛈'],95:['Thunderstorm','⛈'],96:['Thunderstorm with hail','⛈'],99:['Severe thunderstorm with hail','⛈']};
async function loadWeather(lat,lon){
  try{
    const url=`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,pressure_msl,wind_speed_10m,wind_direction_10m&hourly=precipitation_probability,temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max,precipitation_probability_max&forecast_days=7&timezone=auto`;
    const r=await fetch(url);if(!r.ok)throw Error('Weather service unavailable');const d=await r.json();lastWeather=d;
    const c=d.current,desc=weatherCodes[c.weather_code]||['Unknown','🌡'];
    setText('stat-temp',`${fmt(c.temperature_2m)}°`);setText('stat-condition',desc[0]);
    setText('weather-temp',`${fmt(c.temperature_2m)}°C`);setText('weather-description',desc[0]);setText('weather-symbol',desc[1]);
    setText('feels-like',`${fmt(c.apparent_temperature)}°C`);setText('rain-chance',`${fmt(d.hourly?.precipitation_probability?.[0])}%`);
    setText('wind-speed',`${fmt(c.wind_speed_10m)} km/h · ${fmt(c.wind_direction_10m)}°`);
    setText('humidity',`${fmt(c.relative_humidity_2m)}%`);setText('pressure',`${fmt(c.pressure_msl)} hPa`);
    setText('uv-index',fmt(d.daily?.uv_index_max?.[0],1));
    $('hourly-list').innerHTML=d.hourly.time.slice(0,8).map((t,i)=>`<div class="hour"><small>${new Date(t).toLocaleTimeString([],{hour:'numeric'})}</small><span>${(weatherCodes[d.hourly.weather_code[i]]||['','🌡'])[1]}</span><b>${fmt(d.hourly.temperature_2m[i])}°</b><small>${fmt(d.hourly.precipitation_probability[i])}% rain</small></div>`).join('');
    $('daily-list').innerHTML=d.daily.time.map((t,i)=>`<div class="day-row"><b>${i===0?'Today':new Date(t+'T12:00:00').toLocaleDateString([],{weekday:'short'})}</b><span>${(weatherCodes[d.daily.weather_code[i]]||['','🌡'])[1]} ${fmt(d.daily.precipitation_probability_max[i])}%</span><b>${fmt(d.daily.temperature_2m_max[i])}° / ${fmt(d.daily.temperature_2m_min[i])}°</b></div>`).join('');
    setText('updated-label',`Weather updated ${new Date().toLocaleTimeString()} · Open-Meteo`);
    const risk=(c.precipitation>=10||c.wind_speed_10m>=50)?'High':(c.precipitation>=2||c.wind_speed_10m>=30)?'Moderate':'Low';
    setText('stat-risk',risk);setText('stat-risk-note','Weather indicator only · not an official hazard rating');
  }catch(e){setText('weather-description',e.message);setText('stat-condition','Weather unavailable');toast(e.message)}
}
async function loadEarthquakes(lat,lon){
  try{
    const r=await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson');if(!r.ok)throw Error('USGS feed unavailable');
    const data=await r.json(),features=data.features||[];setText('stat-quakes',features.length);
    const near=features.map(f=>({f,dist:distanceKm(lat,lon,f.geometry.coordinates[1],f.geometry.coordinates[0])})).sort((a,b)=>a.dist-b.dist).slice(0,8);
    $('alert-list').innerHTML=near.length?near.map(({f,dist})=>`<div class="alert-item"><b>M ${fmt(f.properties.mag,1)} · ${escapeHtml(f.properties.place||'Earthquake event')}</b><span>${Math.round(dist)} km from selected point · ${new Date(f.properties.time).toLocaleString()} · <a href="${f.properties.url}" target="_blank" rel="noopener">USGS details</a></span></div>`).join(''):'<div class="empty-state">No events in the current feed.</div>';
  }catch(e){$('alert-list').innerHTML=`<div class="empty-state">${escapeHtml(e.message)}</div>`;setText('stat-quakes','N/A')}
}
function distanceKm(a,b,c,d){const rad=x=>x*Math.PI/180;const x=rad(c-a),y=rad(d-b);const h=Math.sin(x/2)**2+Math.cos(rad(a))*Math.cos(rad(c))*Math.sin(y/2)**2;return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h))}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function findFacilities(){
  if(!map){toast('Map is not ready.');return}
  const center=map.getCenter(),query=`[out:json][timeout:20];(node["amenity"~"hospital|clinic|police|fire_station|shelter"](around:5000,${center.lat},${center.lng});way["amenity"~"hospital|clinic|police|fire_station|shelter"](around:5000,${center.lat},${center.lng}););out center 30;`;
  setText('map-status','Searching OpenStreetMap for nearby facilities…');
  try{
    const r=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',body:query});if(!r.ok)throw Error('Facility search service unavailable');const d=await r.json();
    clearFacilities();d.elements.forEach(el=>{const lat=el.lat??el.center?.lat,lon=el.lon??el.center?.lon;if(!lat||!lon)return;const name=el.tags?.name||el.tags?.amenity||'Emergency facility';const m=new maplibregl.Marker({color:'#e87932'}).setLngLat([lon,lat]).setPopup(new maplibregl.Popup().setHTML(`<b>${escapeHtml(name)}</b><br>${escapeHtml(el.tags?.amenity||'Facility')}<br><small>OpenStreetMap data</small>`)).addTo(map);facilityMarkers.push(m)});
    setText('map-status',`${facilityMarkers.length} nearby facilities shown · OpenStreetMap`);toast(`${facilityMarkers.length} facilities found.`);
  }catch(e){setText('map-status',e.message);toast(e.message)}
}
function clearFacilities(){facilityMarkers.forEach(m=>m.remove());facilityMarkers=[]}
function coordsText(){return userCoords?`${userCoords.lat.toFixed(6)}, ${userCoords.lon.toFixed(6)}`:null}
function sosMessage(){return `EMERGENCY ALERT! I NEED HELP. My current location is ${coordsText()||'not available'}. Please contact emergency responders. ${userCoords?`Map: https://www.openstreetmap.org/?mlat=${userCoords.lat}&mlon=${userCoords.lon}#map=16/${userCoords.lat}/${userCoords.lon}`:''}`}
function saveContact(){localStorage.setItem('resqContactName',$('contact-name').value);localStorage.setItem('resqContactNumber',$('contact-number').value);toast('Contact saved on this device.')}
function shareLocation(){
  if(!userCoords){toast('Get your GPS location first.');return}
  const text=`My current location: ${coordsText()} https://www.openstreetmap.org/?mlat=${userCoords.lat}&mlon=${userCoords.lon}#map=16/${userCoords.lat}/${userCoords.lon}`;
  if(navigator.share)navigator.share({title:'My emergency location',text}).catch(()=>{});
  else if(navigator.clipboard)navigator.clipboard.writeText(text).then(()=>toast('Location link copied.'));else toast(text);
}
function copyCoords(){if(!coordsText()){toast('GPS coordinates are not available.');return}navigator.clipboard?.writeText(coordsText()).then(()=>toast('Coordinates copied.')).catch(()=>toast('Clipboard unavailable.'))}
function updateQr(){
  const url=location.protocol==='https:'?location.href.split('#')[0]:null;
  $('qrcode').innerHTML='';
  if(!url||!window.QRCode){$('qrcode').innerHTML='<span class="muted">Deploy to HTTPS to create a shareable QR code.</span>';return}
  new QRCode($('qrcode'),{text:url,width:150,height:150,colorDark:'#10203a',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.H});
  setText('qr-url',url);
}
function downloadQr(){const canvas=$('qrcode').querySelector('canvas');const img=$('qrcode').querySelector('img');const src=canvas?.toDataURL('image/png')||img?.src;if(!src){toast('QR code is not available. Deploy this site over HTTPS.');return}const a=document.createElement('a');a.href=src;a.download='resq-emergency-access-qr.png';a.click()}
function refresh(){if(userCoords){loadWeather(userCoords.lat,userCoords.lon);loadEarthquakes(userCoords.lat,userCoords.lon)}else locateMe()}
$('locate-btn').addEventListener('click',locateMe);$('search-btn').addEventListener('click',searchPlace);$('search-input').addEventListener('keydown',e=>{if(e.key==='Enter')searchPlace()});
$('facilities-btn').addEventListener('click',findFacilities);$('clear-facilities').addEventListener('click',clearFacilities);$('refresh-btn').addEventListener('click',refresh);
$('fullscreen-btn').addEventListener('click',()=>{const el=$('map-section');if(!document.fullscreenElement)el.requestFullscreen?.();else document.exitFullscreen?.();setTimeout(()=>map?.resize(),250)});
$('theme-toggle').addEventListener('click',()=>{document.body.classList.toggle('dark');localStorage.setItem('resqTheme',document.body.classList.contains('dark')?'dark':'light');map?.resize()});
/* ---------- Page navigation (each sidebar item is its own page) ---------- */
const sidebar=$('sidebar'),overlay=$('nav-overlay');
const sideLinks=[...document.querySelectorAll('.nav a[data-nav]')];
const pageMeta={
  overview:['EMERGENCY MANAGEMENT PLATFORM','Situation overview'],
  map:['GEOSPATIAL MONITOR','Live incident map'],
  weather:['OPEN-METEO','Weather conditions'],
  alerts:['VERIFIED FEED','Disaster alerts'],
  emergency:['QUICK RESPONSE','Emergency assistance'],
  qr:['QUICK ACCESS','QR access & sources']
};
function setMenu(open){sidebar.classList.toggle('open',open);overlay.classList.toggle('show',open);$('menu-toggle').setAttribute('aria-expanded',String(open))}
function showPage(id){
  if(!pageMeta[id])id='overview';
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id==='view-'+id));
  sideLinks.forEach(a=>{const on=a.dataset.nav===id;a.classList.toggle('active',on);if(on)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
  setText('page-eyebrow',pageMeta[id][0]);setText('page-title',pageMeta[id][1]);
  document.title=pageMeta[id][1]+' \u00b7 ResQ';
  window.scrollTo({top:0,behavior:'instant'});
  if(id==='map'&&map)setTimeout(()=>map.resize(),60);   // map needs a resize after being hidden
  setMenu(false);
}
document.querySelectorAll('[data-nav]').forEach(el=>el.addEventListener('click',e=>{
  e.preventDefault();const id=el.dataset.nav;
  if(location.hash==='#'+id)showPage(id);else location.hash=id;   // hashchange -> showPage, so Back/Forward work
}));
window.addEventListener('hashchange',()=>showPage(location.hash.slice(1)));
window.addEventListener('resize',()=>{if(window.innerWidth>700)setMenu(false);map?.resize()});
$('menu-toggle').addEventListener('click',()=>setMenu(!sidebar.classList.contains('open')));
overlay.addEventListener('click',()=>setMenu(false));
document.addEventListener('keydown',e=>{if(e.key==='Escape')setMenu(false)});
$('theme-toggle').addEventListener('click',()=>setMenu(false));
// Mirror the first earthquake results onto the Overview page
new MutationObserver(()=>{$('overview-alerts').innerHTML=[...$('alert-list').children].slice(0,3).map(n=>n.outerHTML).join('')})
  .observe($('alert-list'),{childList:true});
showPage(location.hash.slice(1));
$('save-contact').addEventListener('click',saveContact);$('share-location').addEventListener('click',shareLocation);$('copy-coords').addEventListener('click',copyCoords);$('download-qr').addEventListener('click',downloadQr);
$('sos-btn').addEventListener('click',()=>{if(!userCoords){toast('GPS unavailable. Locate yourself before preparing SOS.');return}$('sos-preview').textContent=sosMessage();$('confirm-modal').classList.add('open')});
$('cancel-sos').addEventListener('click',()=>$('confirm-modal').classList.remove('open'));
$('confirm-sos').addEventListener('click',()=>{
  $('confirm-modal').classList.remove('open');const number=$('contact-number').value.trim();const message=sosMessage();
  if(navigator.share){navigator.share({title:'Emergency alert',text:message}).catch(()=>{});return}
  if(number){location.href=`sms:${encodeURIComponent(number)}?body=${encodeURIComponent(message)}`}
  else if(navigator.clipboard){navigator.clipboard.writeText(message).then(()=>toast('Message copied. Choose your messaging app to send it.'))}
  else toast('No supported sharing method found.');
});
window.addEventListener('online',()=>setText('connection-status','Online'));window.addEventListener('offline',()=>setText('connection-status','Offline'));
if(localStorage.getItem('resqTheme')==='dark')document.body.classList.add('dark');
$('contact-name').value=localStorage.getItem('resqContactName')||'';$('contact-number').value=localStorage.getItem('resqContactNumber')||'';
setText('connection-status',navigator.onLine?'Online':'Offline');initMap();updateQr();
