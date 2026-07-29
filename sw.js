// 메시(STL)·BGM(mp3)는 용량이 커서(총 ~5.5MB) 새로고침마다 다시 받으면
// 로드가 매번 느리다. 이 파일들만 캐시 우선(cache-first)으로 서빙해
// 한 번 받으면 이후 새로고침에서는 네트워크 왕복 없이 즉시 로드되게 한다.
// 버전(v1)을 올리면 이전 캐시를 지우고 다시 받는다 — 메시/오디오 파일을
// 교체했을 때만 여기 CACHE_NAME을 바꾸면 된다.
const CACHE_NAME = 'magicexe-assets-v1';
const PRECACHE_URLS = [
  'meshes/arm/v10/visual/link0.stl',
  'meshes/arm/v10/visual/link1.stl',
  'meshes/arm/v10/visual/link2.stl',
  'meshes/arm/v10/visual/link3.stl',
  'meshes/arm/v10/visual/link4.stl',
  'meshes/arm/v10/visual/link5.stl',
  'meshes/arm/v10/visual/link6.stl',
  'meshes/arm/v10/visual/link7.stl',
  'meshes/body/v10/collision/body_link0_symp.stl',
  'meshes/ee/openarmx_hand/collision/finger.stl',
  'meshes/ee/openarmx_hand/collision/hand.stl',
  'assets/magicexe_mastering.mp3',
  'assets/magicexe_bitcrush.mp3',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
    )).then(() => self.clients.claim())
  );
});

// 메시·오디오만 cache-first(캐시에 있으면 네트워크 안 탐) — 나머지(HTML/JS/CSS)는
// 이 서비스워커가 손대지 않아 기존 캐시버스팅(?v=NN)으로 배포 즉시 반영된다.
self.addEventListener('fetch', (event) => {
  const isPrecached = PRECACHE_URLS.some((p) => event.request.url.endsWith(p));
  if (!isPrecached) return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      return res;
    }))
  );
});
