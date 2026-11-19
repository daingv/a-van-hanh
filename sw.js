// Lưu sẵn khung app để mở nhanh khi mạng yếu. Không bao giờ đụng vào yêu cầu gửi tới máy chủ.
const VERSION = 'a-v31';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'mock.js', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'bg-welcome.webp', 'logo-mark.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Mạng trước, mất mạng thì dùng bản đã lưu (để bản mới luôn được nhận ngay khi có mạng).
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // cache: 'no-cache' = luôn hỏi lại GitHub (file chưa đổi thì chỉ nhận trả lời ngắn), không dùng bản cũ trình duyệt giữ 10 phút
  e.respondWith(fetch(req, { cache: 'no-cache' }).then(res => {
    const copy = res.clone();
    caches.open(VERSION).then(c => c.put(req, copy));
    return res;
  }).catch(() => caches.match(req).then(r => r || caches.match('index.html'))));
});
