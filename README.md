# rescue-positioning
Hệ thống cảnh báo lũ lụt và cứu hộ định vị qua GPS (LoRa + Firebase Realtime Database + Leaflet).

Trang chạy tĩnh trên GitHub Pages: https://canhbaothientaicuuho.github.io/rescue-positioning/

## Cấu trúc
- `index.html` – giao diện
- `css/style.css` – giao diện/màu trạng thái
- `js/config.js` – cấu hình Firebase, ngưỡng mực nước, thời gian heartbeat
- `js/status.js` – logic phân loại trạng thái (kiểm thử được bằng Node)
- `js/app.js` – kết nối Firebase (chỉ đọc) và bản đồ
- `tests/` – kiểm thử tự động: `node --test tests/status.test.js`
- `docs/GIAI-DOAN-1.md` – phân tích, danh sách lỗi, hướng dẫn kiểm thử

## Chạy thử trên máy
```
npx http-server . -p 8080
```
Mở http://127.0.0.1:8080
