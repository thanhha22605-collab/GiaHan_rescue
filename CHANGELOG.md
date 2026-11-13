# Nhật ký thay đổi

## Giai đoạn 1.2 — 13/11/2026

Chỉnh web cho khớp firmware thật (trạm phát gửi mỗi 1 giây, trạm thu báo DISCONNECT sau 3 giây).

| # | Thay đổi | File | Kiểm thử |
|---|----------|------|----------|
| 1 | Thời gian chờ mất nhịp 60 giây → 15 giây | `js/config.js` | Node 24/24, trình duyệt T09, T20 – ĐẠT |
| 2 | Lịch sử mực nước chỉ ghi khi mức đổi, hoặc 1 điểm mỗi 60 giây (`historySampleMs`). Trước đây ghi mọi gói nên 500 điểm chỉ đủ ~8 phút | `js/config.js`, `js/app.js` | Trình duyệt T25 (mới), T24 – ĐẠT |
| 3 | Kiểm thử vận hành với dữ liệu đúng như trạm thu v2 ghi (`updatedAt`, giờ máy chủ, DISCONNECT → CONNECT, SOS tự giữ, mất GPS, trạm thu mất điện, giờ ở tương lai) | `tests/browser-tests.html` | Trình duyệt T26 (mới) – ĐẠT |
| 4 | Rules đề xuất viết lại gọn: đọc công khai 3 node, chặn mọi quyền ghi công khai (trạm thu dùng Database Secret nên vẫn ghi được) | `docs/firebase-rules-de-xuat.json`, `docs/GIAI-DOAN-1.1.md` | Chưa áp dụng – cần chủ Firebase |

## Giai đoạn 1.1 — 30/10/2026

Sửa lỗi an toàn và ổn định trên nền code Giai đoạn 1 + Dashboard kính. Không đổi node Firebase, không ghi Firebase, không cần sửa firmware, không cần build.

### Bảng sửa lỗi

| STT | Lỗi | File / vị trí | Nguyên nhân | Cách sửa | Kiểm thử |
|----|-----|---------------|-------------|----------|----------|
| 1 | Thiếu / `null` / sai `sosState` vẫn ra AN TOÀN | `js/status.js` → `classify` | Chỉ kiểm tra `sos === true`, còn lại coi như không SOS | Chỉ kết luận không SOS khi `sosState` hợp lệ = 0/false; ngược lại → "CHƯA XÁC MINH TÍN HIỆU SOS" | Node T01–T03, trình duyệt T01 – ĐẠT |
| 2 | `connection` thiếu / giá trị lạ vẫn ra AN TOÀN và KPI ONLINE | `status.js` → `classify`, `linkState`; `app.js` → `renderKpis` | Chỉ loại `DISCONNECT`, mọi giá trị khác được coi là kết nối | AN TOÀN/ONLINE chỉ khi `connection === "CONNECT"`; còn lại → "CHƯA XÁC MINH KẾT NỐI LORA"; KPI lấy từ cùng hàm `summarize` | Node T07, T08, T20; trình duyệt T20 – ĐẠT |
| 3 | `updatedAt` ở tương lai được tính là dữ liệu mới | `status.js` → `HeartbeatTracker.state` | Tuổi âm bị ép `Math.max(0, …)` | Thêm `validateTimestamp`, ngưỡng `clockSkewToleranceMs`; tương lai / sai định dạng / không phải epoch ms → trạng thái `untrusted` | Node T10, T11 – ĐẠT |
| 4 | `updatedAt` không phải số bị bỏ qua, quay về theo dõi `lastUpdate` | `status.js` → `HeartbeatTracker` | `toNumber` trả `null` = "không có trường" | Phân biệt "không có trường" và "có nhưng hỏng" (`hasUpdatedAt`) | Node T11 – ĐẠT |
| 5 | Chỉnh đồng hồ máy lùi lại làm dữ liệu "mới" mãi | `status.js` → `HeartbeatTracker.state` | Tuổi âm < ngưỡng → fresh | Tuổi âm → "verifying" | Node T09 – ĐẠT |
| 6 | Vị trí GPS cũ/không rõ thời điểm vẫn bật chỉ đường cứu hộ | `app.js` → `renderMap`; `status.js` → `pickPosition` | Không phân loại tuổi vị trí | 4 loại: trực tiếp / cũ / QUÁ HẠN / không rõ thời điểm; chỉ đường chỉ bật khi trực tiếp; vị trí khác có cảnh báo đỏ/cam + nút "Sao chép tọa độ tham khảo"; thêm `gps.maxAgeMs`, dòng "Ghi nhận lúc" | Node T14; trình duyệt T09 – ĐẠT |
| 7 | Vị trí trong localStorage không được kiểm tra | `app.js` khởi tạo; `status.js` → `sanitizePos` | Đọc thẳng `JSON.parse` | Kiểm tra phạm vi, 0/0, thời điểm hợp lệ, không ở tương lai; hỏng → xóa và ghi nhật ký | Node T15; trình duyệt T15 – ĐẠT |
| 8 | Lỗi node A bị xóa khi node B cập nhật | `app.js` → biến `state.error` chung | Một biến lỗi cho mọi node | `state.errors` riêng cho `monitoring` / `connection` / `gps`; chỉ xóa khi chính node đó đọc lại được | Trình duyệt T17 – ĐẠT |
| 9 | Listener bị Firebase hủy (vd. PERMISSION_DENIED) không bao giờ được gắn lại | `app.js` → `listen`, `attachFailedNodes` | Không xử lý | Khi máy chủ kết nối lại, gắn lại đúng các node lỗi (gỡ listener cũ trước, không nhân đôi) | Trình duyệt T16, T17, T24 – ĐẠT |
| 10 | Đã ghi nhớ SOS nhưng `/Monitoring` trống/lỗi → hiện "KHÔNG CÓ DỮ LIỆU", mất cảnh báo SOS | `status.js` → `classify` | Kiểm tra "không có dữ liệu" trước SOS | SOS (đang phát hoặc đã ghi nhớ) luôn ưu tiên cao nhất | Node T06 – ĐẠT |
| 11 | "SOS ĐÃ TẮT" hiện ngay từ snapshot cũ khi tải lại trang | `status.js` → `classify` | Không yêu cầu dữ liệu mới | Chỉ hiện "SOS ĐÃ TẮT" khi có **gói mới** `sosState = 0`; ngược lại "ĐÃ GHI NHẬN SOS – CHƯA XÁC MINH" | Node T05b; trình duyệt T22 – ĐẠT |
| 12 | SOS khi trạm thu báo DISCONNECT vẫn mô tả "đang phát" như dữ liệu mới | `status.js` → `classify` | Chỉ xét heartbeat | Thêm điều kiện LoRa; ghi rõ "có thể là dữ liệu cũ" | Node T04 (bài test phát hiện) – ĐẠT |
| 13 | Chốt SOS trong localStorage bị hỏng → mất cảnh báo | `status.js` → `sanitizeLatch` | `JSON.parse` lỗi → null | An toàn khi lỗi: dữ liệu chốt hỏng vẫn giữ cảnh báo SOS | Node T15b; trình duyệt T15 – ĐẠT |
| 14 | Hộp xác nhận SOS không nói rõ phạm vi | `app.js` → nút `sos-ack-btn` | — | Nêu rõ: chỉ trên trình duyệt này, không ghi Firebase, không báo người khác, không phải "cứu hộ hoàn tất" | Trình duyệt T22 – ĐẠT |
| 15 | Lịch sử/nhật ký localStorage hỏng có thể làm vỡ biểu đồ | `status.js` → `sanitizeHistory`, `sanitizeLog` | Không kiểm tra | Lọc bản ghi sai, bỏ trùng, sắp xếp theo thời gian, giới hạn `historyMax` / `logMax` | Node T15; trình duyệt T15, T24 – ĐẠT |
| 16 | Nhật ký trùng lặp khi tải lại / kết nối lại | `app.js` → `addLog`, `render` | Ghi mỗi lần trạng thái tạm thay đổi | Bỏ qua trạng thái tạm, lưu trạng thái cuối, chặn bản ghi trùng liên tiếp | Trình duyệt T24 – ĐẠT |
| 17 | Lịch sử ghi thời điểm trình duyệt nhưng không ghi rõ | `app.js` → `recordWater`, `index.html` | — | Lưu thêm bộ đếm thiết bị (`dev`) và giờ máy chủ (`ts`, nếu có); chú thích "giờ trình duyệt nhận · chỉ lưu trên trình duyệt này" | Trình duyệt T24 – ĐẠT |
| 18 | Người dùng zoom bản đồ vẫn bị kéo về thiết bị | `app.js` → `onUserMove` | Chỉ bắt `dragstart` | Bắt cả `zoomstart`, phân biệt di chuyển do chương trình (`moveMap`) | Trình duyệt T21 – ĐẠT |
| 19 | Popup marker dựng lại mỗi giây khi đang mở | `app.js` → `renderMap` | Không so sánh nội dung | Chỉ dựng lại khi nội dung đổi | Kiểm tra thủ công |
| 20 | Thư viện CDN không có kiểm tra toàn vẹn | `index.html` | — | Thêm `integrity` (SRI sha384, đã tính từ file thật) + `crossorigin` cho Leaflet, Firebase, Font Awesome | Trang thật tải được, Firebase thật hoạt động |
| 21 | Chữ KPI bị cắt ở 1440px, tiêu đề bị ép ở 375px | `css/style.css`, `app.js` | Chữ phụ dài, `nowrap` | Rút gọn chữ, cho xuống tối đa 2 dòng, ẩn tiền tố "MÁY CHỦ:" trên điện thoại | Đo 375/768/1440px – ĐẠT |
| 22 | favicon 404 | `index.html` | Không có biểu tượng | Biểu tượng SVG nội tuyến | Đã kiểm tra log máy chủ |
| 23 | Dữ liệu chứa HTML có thể chèn mã | `app.js` | Đã dùng `textContent` từ GĐ1; SVG biểu đồ chỉ chứa số đã kiểm tra | Giới hạn độ dài `statusText`, kiểm thử chèn `<img onerror>` | Trình duyệt XSS – ĐẠT |

### File thêm mới

- `tests/fake-firebase.js` – Firebase giả lập, **chỉ** dùng cho trang kiểm thử.
- `tests/browser-tests.html` – chạy `index.html` + `js/app.js` thật trong iframe với Firebase giả lập. Cần thiết vì các mục 16, 17, 20–22, 24 phụ thuộc DOM/Leaflet/listener, không kiểm thử được bằng Node.
- `docs/GIAI-DOAN-1.1.md` – báo cáo kiểm thử, triển khai, kiểm thử thiết bị thật.
- `docs/firebase-rules-de-xuat.json` – **đề xuất** Firebase Rules (chưa áp dụng).

## Giai đoạn 1 — 29/10/2026

Xem `docs/GIAI-DOAN-1.md`.
