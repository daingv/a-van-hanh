// Địa chỉ máy chủ Apps Script (bản triển khai v1). Để trống thì app chạy chế độ thử.
window.APP_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycby7df1JRuSQ3DdoEfMP7fmhv5VhPTDG5MhtuiSMeTQufU6tFNNwFfBG8sMlkzKgnNzk/exec'
};
// Xem thử giao diện trên máy mà không ghi vào Sheet thật: http://localhost:5180/?demo
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /[?&]demo\b/.test(location.search)) {
  window.APP_CONFIG.API_URL = '';
}
