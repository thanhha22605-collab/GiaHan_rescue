# rescue-positioning
Hệ thống giám sát cảnh báo lũ lụt và cứu hộ định vị GPS (LoRa + Firebase Realtime Database + Leaflet).

Trang chạy tĩnh trên GitHub Pages, không cần build: https://canhbaothientaicuuho.github.io/rescue-positioning/

Phiên bản hiện tại: **Giai đoạn 1.1** – xem `CHANGELOG.md`.

## Cấu trúc
| File | Vai trò |
|------|---------|
| `index.html` | Giao diện dashboard |
| `css/style.css` | Giao diện kính, màu trạng thái, responsive |
| `js/config.js` | Firebase, ngưỡng mực nước, heartbeat, dung sai thời gian, tuổi GPS |
| `js/status.js` | Logic thuần: chuẩn hóa dữ liệu, heartbeat, GPS, SOS, phân loại trạng thái, KPI |
| `js/app.js` | Firebase (chỉ đọc), bản đồ, dashboard, nhật ký |
| `tests/status.test.js` | Kiểm thử logic (Node) |
| `tests/browser-tests.html`, `tests/fake-firebase.js` | Kiểm thử app.js thật trên trình duyệt với Firebase giả lập |
| `docs/GIAI-DOAN-1.md` | Phân tích ban đầu |
| `docs/GIAI-DOAN-1.1.md` | Kết quả kiểm thử, triển khai, kiểm thử thiết bị thật, bảo mật |
| `docs/firebase-rules-de-xuat.json` | Đề xuất Firebase Rules (chưa áp dụng) |

## Nguyên tắc
- Trang chỉ **đọc** Firebase: `/Monitoring`, `/DeviceStatus/connection`, `/gps`.
- Không hiển thị "AN TOÀN" khi dữ liệu thiếu, sai, cũ, mất kết nối hoặc chưa xác minh.
- SOS ưu tiên cao nhất, không tự xóa; xác nhận SOS chỉ có tác dụng trên trình duyệt hiện tại.

## Chạy thử và kiểm thử
```
npx http-server . -p 8080
```
- Trang chính: http://127.0.0.1:8080
- Kiểm thử trình duyệt: http://127.0.0.1:8080/tests/browser-tests.html
- Kiểm thử logic: `node --test tests/status.test.js`
