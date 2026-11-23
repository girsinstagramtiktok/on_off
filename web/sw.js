const CACHE='luma-shell-v2';
const ASSETS=['./','./index.html','./styles.css','./main.js','./edge-impulse.js','./audio-worklet.js','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png','./manifest.webmanifest'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok){const clone=response.clone();caches.open(CACHE).then(c=>c.put(event.request,clone));}
    return response;
  }).catch(()=>caches.match(event.request)));
});
