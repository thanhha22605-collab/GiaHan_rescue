# Giai đoạn 1 — Sửa lỗi và ổn định

## 1. Phân tích mã nguồn hiện tại

Repository có **2 file**: `README.md` và `index.html` (≈11 KB, chứa cả HTML, CSS, JS).

- Firebase JS SDK v8.10.1, chỉ cấu hình `databaseURL` (`map-1dc88-default-rtdb`), không có xác thực.
- Leaflet 1.9.4 + OpenStreetMap, 1 marker.
- Đọc 2 node: `/Monitoring` và `/DeviceStatus/connection`. Trang **không ghi** lên Firebase.

Dữ liệu thực tế đọc được lúc phân tích (29/10/2026):

```json
"Monitoring":   { "gpsValid": false, "lastUpdate": 77893, "latitude": 0, "longitude": 0,
                  "sosState": 0, "statusText": "AN TOAN", "waterLevel": 2 },
"DeviceStatus": { "connection": "DISCONNECT" },
"gps":          { "lat": 20.149024, "lng": 105.924103 }
```

Nhận xét từ dữ liệu:
- `lastUpdate` = 77893 và không đổi sau 20 giây → nhiều khả năng là `millis()` (thời gian chạy của vi điều khiển), **không phải** giờ thực. Không thể dùng trực tiếp để tính tuổi dữ liệu.
- Node `/gps` có tọa độ nhưng trang cũ không dùng. **Chưa rõ thiết bị nào ghi node này** – cần xác nhận.
- Database đang **cho phép đọc công khai** không cần đăng nhập. Quyền ghi chưa được kiểm tra (không thử ghi để tránh làm hỏng dữ liệu thật).

## 2. Lỗi phát hiện và hạng mục ưu tiên

### Lỗi xác định được từ mã nguồn

| # | Mức | Lỗi (bản cũ) | Hậu quả | Đã sửa |
|---|-----|--------------|---------|--------|
| 1 | Nghiêm trọng | Thẻ trạng thái mặc định "AN TOÀN" trong HTML; mọi trường hợp khác SOS/mức 3 đều ra "AN TOÀN" | Hiện "AN TOÀN" khi chưa có dữ liệu, khi trạm DISCONNECT, khi dữ liệu cũ. **Với dữ liệu thật hiện tại, trang cũ báo AN TOÀN dù trạm đã mất kết nối** | ✅ |
| 2 | Nghiêm trọng | `sosState === 1` so sánh chặt | Nếu thiết bị/gateway gửi `"1"` hoặc `true` → **bỏ sót SOS** | ✅ |
| 3 | Nghiêm trọng | Không có heartbeat; `connection` chỉ là cờ do trạm thu ghi | Trạm thu mất điện → cờ "CONNECT" giữ nguyên mãi, trang vẫn báo online | ✅ |
| 4 | Cao | `waterLevel === 3` so sánh chặt; thiếu dữ liệu → mặc định 0 | Mức `"3"` dạng chuỗi bị coi là an toàn; thiếu trường → hiện "MỨC 0" | ✅ |
| 5 | Cao | Mức 3 (ghi chú "Báo động lũ") chỉ hiện màu cam "cảnh báo"; mức 1–2 hiện an toàn | Phân loại không khớp ghi chú trên giao diện | ✅ (ngưỡng cấu hình được) |
| 6 | Cao | `lat.toFixed(6)` khi `latitude` là chuỗi | Lỗi JavaScript, dừng cập nhật toàn bộ giao diện | ✅ |
| 7 | Cao | Không kiểm tra phạm vi tọa độ | Tọa độ sai (vd. lat 95) vẫn được đưa lên bản đồ nếu `gpsValid` đúng | ✅ |
| 8 | Trung bình | Marker giả đặt sẵn tại [20.2506, 105.9744] kèm popup | Người trực có thể tưởng đó là vị trí thiết bị | ✅ |
| 9 | Trung bình | Không xử lý lỗi đọc Firebase, không theo dõi `.info/connected` | Mất mạng/không có quyền → trang đứng im ở dữ liệu cũ, không báo gì | ✅ |
| 10 | Trung bình | `map.panTo` mỗi lần cập nhật | Người trực kéo bản đồ xem khu vực khác bị kéo ngược lại | ✅ |
| 11 | Trung bình | Link Google Maps giữ `#` hoặc vị trí cũ, không ghi rõ | Mở link sai | ✅ (chỉ đường, tắt khi không có tọa độ) |
| 12 | Thấp | `snapshot.val() === null` → không làm gì | Trang kẹt "ĐANG TẢI..." | ✅ |
| 13 | Thấp | Icon `fa-shield-check` là icon trả phí của Font Awesome | Icon trạng thái an toàn không hiển thị | ✅ (`fa-shield-halved`) |
| 14 | Thấp | Popup dựng bằng chuỗi HTML | Nếu DB bị ghi bậy có thể chèn mã (rủi ro thấp vì đang dùng số) | ✅ (dùng `textContent`) |

### Tính năng cần bổ sung (chưa có trong bản cũ – các giai đoạn sau)

| Mức | Hạng mục | Giai đoạn |
|-----|----------|-----------|
| Cao | Quy tắc bảo mật Firebase + đăng nhập người trực (cần thông tin firmware, xem mục 5) | 3–4 |
| Cao | Quy trình SOS: Chưa tiếp nhận → Đã tiếp nhận → Đang cứu hộ → Hoàn thành, lưu lịch sử, âm thanh | 3 |
| Cao | Dashboard mới, nhiều thiết bị, bộ lọc, tìm kiếm | 2 |
| Trung bình | Biểu đồ/lịch sử mực nước (cần node lịch sử – hiện **chưa có dữ liệu lịch sử**) | 2–3 |
| Trung bình | Thông báo đẩy khi đóng web (cần Cloud Functions/FCM – gói Blaze) | 3 |
| Thấp | PWA, xuất CSV, RSSI/SNR/pin (chỉ khi firmware gửi các trường này) | 4 |

## 3. Danh sách file

| File | Trạng thái | Nội dung |
|------|-----------|----------|
| `index.html` | Sửa | Giữ bố cục 4 thẻ + bản đồ; tách CSS/JS; thêm dòng nhịp tín hiệu, thời gian nhận, nguồn vị trí, nút xác nhận SOS, banner mất mạng |
| `css/style.css` | Mới | CSS tách từ `index.html` + các trạng thái mới (xám cho mất tín hiệu/không dữ liệu) |
| `js/config.js` | Mới | Đường dẫn Firebase, ngưỡng mực nước, thời gian heartbeat |
| `js/status.js` | Mới | Logic thuần: chuẩn hóa dữ liệu, kiểm tra GPS, heartbeat, phân loại trạng thái |
| `js/app.js` | Mới | Kết nối Firebase (chỉ đọc), bản đồ, hiển thị |
| `tests/status.test.js` | Mới | 10 bài kiểm thử tự động cho logic |
| `README.md` | Sửa | Hướng dẫn ngắn |

Cấu trúc dữ liệu Firebase và giao thức thiết bị **giữ nguyên**. Trang vẫn chỉ đọc, không ghi.

## 4. Logic trạng thái mới

Thứ tự ưu tiên (`js/status.js → classify`):

1. **KHÔNG CÓ DỮ LIỆU** – `/Monitoring` trống hoặc lỗi đọc.
2. **SOS** – `sosState` là `1`, `"1"`, `true`. Luôn ưu tiên kể cả khi dữ liệu cũ (kèm ghi chú "có thể là dữ liệu cũ").
3. **SOS ĐÃ TẮT – CẦN XÁC MINH** – thiết bị đã về 0 sau khi phát SOS. Trang **không tự chuyển về an toàn**; người trực bấm "Đã xác minh" (chỉ lưu trên trình duyệt đó, không ghi Firebase).
4. **MẤT KẾT NỐI MÁY CHỦ** – trình duyệt mất mạng tới Firebase.
5. **MẤT TÍN HIỆU** – `connection = "DISCONNECT"` hoặc quá `heartbeatTimeoutMs` không có gói mới.
6. **ĐANG XÁC MINH** – vừa mở trang, đang chờ gói mới để chứng minh thiết bị còn sống.
7. **NGUY HIỂM** (mức ≥ 3) / **CẢNH BÁO** (mức ≥ 2) / **AN TOÀN**.

**Heartbeat:** vì `lastUpdate` là bộ đếm của thiết bị, trang ghi nhận *thời điểm trình duyệt thấy `lastUpdate` thay đổi*. Snapshot đầu tiên khi mở trang chưa được tin cậy. Nếu sau này firmware/gateway ghi thêm trường `updatedAt` = `{".sv":"timestamp"}`, trang sẽ tự dùng giờ máy chủ (chính xác hơn, kể cả ngay khi vừa mở trang).

**Vị trí:** GPS trực tiếp (hợp lệ) → vị trí hợp lệ cuối cùng mà trình duyệt này đã thấy → node `/gps` → không hiển thị marker. Mọi vị trí không trực tiếp đều ghi rõ "đã cũ".

## 5. Firebase – cấu hình và việc cần làm

Giai đoạn 1 **không cần thay đổi gì trên Firebase**.

Khuyến nghị (chưa áp dụng, cần thông tin trước khi làm):
- **Kiểm tra quyền ghi:** vào Firebase Console → Realtime Database → Rules. Nếu đang là `".write": true` thì bất kỳ ai cũng có thể sửa/xóa dữ liệu, kể cả tắt SOS. Không nên đổi rules trước khi biết thiết bị đang ghi bằng cách nào (database secret, tài khoản, hay không xác thực), vì có thể làm thiết bị ngừng gửi.
- **Thêm `updatedAt`** (giờ máy chủ) vào gói ghi `/Monitoring` từ gateway – bổ sung trường, không đổi trường cũ.

## 6. Triển khai GitHub Pages

1. Đẩy nhánh `giai-doan-1-on-dinh` lên GitHub và mở Pull Request vào `main` (hoặc merge trực tiếp).
2. Repository → Settings → Pages → Source: *Deploy from a branch*, Branch: `main` / `(root)`.
3. Sau 1–2 phút, mở https://canhbaothientaicuuho.github.io/rescue-positioning/ và nhấn Ctrl+F5.

Không cần build. Toàn bộ là file tĩnh.

Chạy thử trên máy: `npx http-server . -p 8080` rồi mở http://127.0.0.1:8080 (không mở trực tiếp bằng `file://`).

## 7. Hướng dẫn kiểm thử

### 7.1 Tự động (logic)

```bash
node --test tests/status.test.js
```

Kết quả hiện tại: **10/10 đạt**.

### 7.2 Đã kiểm thử trên trình duyệt (dữ liệu Firebase thật, 29/10/2026)

| Kịch bản | Kết quả |
|----------|---------|
| Trạm `DISCONNECT`, mức 2, GPS 0/0 | "MẤT TÍN HIỆU – Giá trị cuối: mức 2" (bản cũ: "AN TOÀN") ✅ |
| GPS không hợp lệ, có node `/gps` | Marker xám tại `/gps`, ghi "không rõ thời điểm", link chỉ đường trỏ đúng ✅ |
| Ngắt Firebase phía trình duyệt (`goOffline`) | Banner đen + "MẤT KẾT NỐI MÁY CHỦ" ✅ |
| Kết nối lại (`goOnline`) | Banner tắt, trạng thái trở lại ✅ |
| Màn hình 375 px | Không cuộn ngang, các thẻ xếp dọc ✅ |
| Lỗi console | Không có ✅ |

### 7.3 CHƯA kiểm thử được – cần làm với thiết bị thật

Lúc kiểm thử, thiết bị đang mất kết nối nên **chưa có bằng chứng** cho các kịch bản dưới đây. Đề nghị kiểm thử và ghi kết quả:

| # | Bước | Kết quả mong đợi |
|---|------|------------------|
| T1 | Bật thiết bị + trạm thu, mở web | "ĐANG XÁC MINH" → sau gói đầu tiên chuyển "AN TOÀN"/"CẢNH BÁO"/"NGUY HIỂM"; "Nhịp tín hiệu: Bình thường" |
| T2 | Thay đổi mực nước 0→1→2→3 | Lần lượt AN TOÀN → AN TOÀN → CẢNH BÁO (cam) → NGUY HIỂM (đỏ). **Xác nhận lại ngưỡng mức 2 có đúng là cảnh báo không** |
| T3 | Nhấn nút SOS | Thẻ đỏ nhấp nháy "CẤP CỨU KHẨN CẤP (SOS)", tiêu đề tab có 🚨, marker đỏ biểu tượng chuông |
| T4 | Tắt SOS trên thiết bị | "SOS ĐÃ TẮT – CẦN XÁC MINH" + nút xác nhận. Bấm nút → về trạng thái theo mực nước |
| T5 | Ra ngoài trời chờ GPS chốt | "Đã định vị [OK]", marker di chuyển tới vị trí thật, nguồn "GPS thiết bị (trực tiếp)" |
| T6 | Che anten GPS (mất fix) | GPS báo lý do, marker giữ vị trí cuối, ghi "Vị trí cuối lúc … (đã cũ)" |
| T7 | Rút nguồn thiết bị phát (giữ trạm thu) | Sau ≤ 60 s: "MẤT TÍN HIỆU" (hoặc sớm hơn nếu trạm ghi DISCONNECT) |
| T8 | Rút nguồn **trạm thu** | Sau ≤ 60 s: "MẤT TÍN HIỆU" dù cờ vẫn là CONNECT (bản cũ: vẫn báo online) |
| T9 | Tắt Wi-Fi máy tính 10 s rồi bật lại | Banner mất kết nối → tự kết nối lại, không cần tải lại trang |
| T10 | Kéo bản đồ ra xa | Bản đồ không bị kéo ngược; nút "Về vị trí thiết bị" xuất hiện |
| T11 | Để trang mở 8 giờ | Không chậm dần, bộ nhớ ổn định (DevTools → Performance monitor) |

### 7.4 Hồi quy chức năng cũ

- Vẫn đọc đúng `/Monitoring` và `/DeviceStatus/connection`.
- Vẫn hiển thị mực nước, lat/lng, trạng thái GPS, link Google Maps, bản đồ OSM.
- Vẫn cập nhật thời gian thực không cần tải lại trang.

## 8. So sánh trước / sau

| Chức năng | Trước | Sau Giai đoạn 1 |
|-----------|-------|-----------------|
| Trạng thái khi chưa có dữ liệu | "AN TOÀN" | "ĐANG TẢI" / "KHÔNG CÓ DỮ LIỆU" |
| Trạm DISCONNECT | Vẫn "AN TOÀN" | "MẤT TÍN HIỆU" + giá trị cuối |
| Trạm thu mất điện | Vẫn "ONLINE" | Phát hiện qua heartbeat |
| Mất mạng phía người xem | Không báo | Banner + trạng thái riêng, tự kết nối lại |
| SOS dạng `"1"`/`true` | Bỏ sót | Nhận đúng |
| SOS tắt | Tự về "AN TOÀN" | Giữ cảnh báo đến khi người trực xác nhận |
| Mức 3 | Cam "cảnh báo" | Đỏ "NGUY HIỂM"; mức 2 cam "CẢNH BÁO" (cấu hình được) |
| Số liệu dạng chuỗi | Có thể lỗi JS | Được chuẩn hóa |
| Kiểm tra GPS | Chỉ `gpsValid` và khác 0 | + phạm vi, kiểu dữ liệu, lý do cụ thể |
| Marker | Marker giả ở vị trí mặc định | Chỉ hiện khi có tọa độ, màu theo trạng thái |
| Mất GPS | Giữ marker, không ghi chú | Vị trí cuối + ghi rõ đã cũ |
| Google Maps | Xem vị trí, có thể là `#` | Chỉ đường, tắt khi không có tọa độ |
| Bản đồ | Tự kéo về mỗi lần cập nhật | Tôn trọng thao tác người dùng |
| Kiểm thử tự động | Không có | 10 bài |

## 9. Thông tin cần bạn cung cấp

1. **Chu kỳ gửi dữ liệu** của thiết bị LoRa (để chỉnh `heartbeatTimeoutMs`, mặc định 60 s).
2. **Ngưỡng mực nước**: mức 2 là cảnh báo hay vẫn an toàn? (firmware đang gửi `statusText: "AN TOAN"` ở mức 2).
3. Mã nguồn **firmware gateway** (ESP32/Arduino) – để biết cách ghi Firebase, ai ghi node `/gps`, và thiết kế rules bảo mật mà không làm thiết bị ngừng gửi.
4. Số lượng thiết bị dự kiến và cách phân biệt (ID) – cần cho giám sát nhiều thiết bị ở Giai đoạn 2.
5. Tài liệu Word kế hoạch tối ưu (nếu có).
