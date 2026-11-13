# Giai đoạn 1.1 — Báo cáo sửa lỗi, kiểm thử và triển khai

Bảng sửa lỗi chi tiết (23 mục): xem `CHANGELOG.md`.

## 1. Quy tắc trạng thái sau khi sửa

"AN TOÀN" chỉ xuất hiện khi **đủ tất cả** điều kiện:

1. Đọc được `/Monitoring`, không lỗi.
2. Trình duyệt đang kết nối máy chủ Firebase.
3. Heartbeat mới: `lastUpdate` vừa thay đổi trong `heartbeatTimeoutMs` (hoặc `updatedAt` hợp lệ còn mới).
4. `waterLevel` là số nguyên 0–3 và dưới ngưỡng cảnh báo.
5. `sosState` hợp lệ và bằng 0/false.
6. `/DeviceStatus/connection` đọc được và bằng đúng `"CONNECT"`.
7. Không còn SOS đã ghi nhớ chưa được xác nhận.

Thứ tự ưu tiên: SOS đang phát → SOS đã ghi nhớ → lỗi đọc / không dữ liệu → mất kết nối máy chủ → mất tín hiệu LoRa / mất nhịp → thời gian không hợp lệ / đang xác minh → nguy hiểm → cảnh báo → SOS chưa xác minh → LoRa chưa xác minh → an toàn.

Ba loại kết nối được tách riêng trên giao diện:
- **Máy chủ** (trình duyệt ↔ Firebase): đèn ở góc phải tiêu đề.
- **Gateway / LoRa**: dòng "Kết nối LoRa" (giá trị node `/DeviceStatus/connection`).
- **Dữ liệu thiết bị**: dòng "Nhịp tín hiệu" (heartbeat).

## 2. Kết quả kiểm thử

### 2.1 Tự động – Node (logic `js/status.js`)

```bash
node --test tests/status.test.js
```

Kết quả lần chạy cuối: **24 bài – 24 đạt – 0 không đạt**.

### 2.2 Tự động – trình duyệt (chạy `index.html` + `js/app.js` thật, Firebase giả lập)

```bash
npx http-server . -p 8080
```

Mở http://127.0.0.1:8080/tests/browser-tests.html, đợi khoảng 10 giây.
Trang dùng tiền tố lưu trữ `rp_test_`, không đụng dữ liệu của trang thật, không kết nối Firebase thật.

Kết quả lần chạy cuối: **12 bài – 12 đạt – 0 không đạt**.

### 2.3 Đối chiếu 24 mục kiểm thử bắt buộc

| # | Mục | Ở đâu | Kết quả |
|---|-----|-------|---------|
| 1 | Thiếu `sosState` | Node T01, trình duyệt T01 | Đạt |
| 2 | `sosState = null` | Node T02 | Đạt |
| 3 | `sosState = "1"`, `true` | Node T03 | Đạt |
| 4 | SOS bật nhưng mất Firebase | Node T04, trình duyệt T04 | Đạt |
| 5 | SOS đã tắt nhưng chưa xác nhận | Node T05, T05b | Đạt |
| 6 | SOS đã ghi nhớ, Monitoring thiếu | Node T06 | Đạt |
| 7 | Connection không xác định | Node T07, trình duyệt T20 | Đạt |
| 8 | Connection = DISCONNECT | Node T08, trình duyệt T20 | Đạt |
| 9 | Heartbeat mới/cũ/quá hạn | Node T09, T09b, trình duyệt T09 | Đạt |
| 10 | Timestamp tương lai | Node T10 | Đạt |
| 11 | Timestamp không hợp lệ | Node T11 | Đạt |
| 12 | GPS thiếu tọa độ | Node T12 | Đạt |
| 13 | GPS ngoài phạm vi | Node T13 | Đạt |
| 14 | GPS cũ quá hạn | Node T14, trình duyệt T09 | Đạt |
| 15 | localStorage hỏng | Node T15, T15b, trình duyệt T15 | Đạt |
| 16 | Firebase mất rồi có kết nối lại | Trình duyệt T16 | Đạt |
| 17 | Một listener lỗi, listener khác chạy | Trình duyệt T17 | Đạt |
| 18 | Mực nước 0–3 | Node T18 | Đạt |
| 19 | Mực nước không hợp lệ | Node T19 | Đạt |
| 20 | KPI không đồng nhất | Node T20 (quét hơn 1000 tổ hợp), trình duyệt T20 | Đạt |
| 21 | Kéo bản đồ khi GPS cập nhật | Trình duyệt T21 | Đạt |
| 22 | Tải lại trang khi còn SOS | Trình duyệt T22 | Đạt |
| 23 | 375 / 768 / 1440px | Đo bằng trình duyệt: không cuộn ngang, không phần tử tràn, không chữ KPI bị cắt | Đạt |
| 24 | Chạy lâu, không nhân listener/nhật ký | Trình duyệt T24: 699 gói + 27 lần mất/có mạng giả lập | Đạt* |

\* T24 mô phỏng tải bằng cách đẩy nhanh nhiều gói, **không** phải chạy thật nhiều giờ. Cần kiểm tra thêm mục E11 bên dưới.

Ngoài ra: bài **XSS** (dữ liệu chứa `<img onerror>`) đạt. Trang thật chạy với Firebase thật (dữ liệu lúc kiểm thử: trạm `DISCONNECT`) hiển thị đúng "MẤT TÍN HIỆU", không lỗi JavaScript.

### 2.4 Chưa kiểm thử được

Toàn bộ mục ở phần 4 (thiết bị thật). Lúc kiểm thử, thiết bị đang mất kết nối.

## 3. Triển khai GitHub Pages

1. Chép toàn bộ thư mục (hoặc giải nén file ZIP) vào repository, giữ đúng cấu trúc:
   ```
   index.html
   css/style.css
   js/config.js  js/status.js  js/app.js
   tests/…       docs/…        README.md  CHANGELOG.md
   ```
2. Commit và push lên nhánh `main`.
3. Vào GitHub → **Settings → Pages** → Source: *Deploy from a branch*, Branch: `main`, thư mục `/ (root)` → Save.
4. Đợi 1–2 phút, mở https://canhbaothientaicuuho.github.io/rescue-positioning/ rồi nhấn Ctrl+F5.
5. Kiểm tra đường dẫn file: nhấn F12 → tab **Network** → tải lại trang. Phải thấy `css/style.css`, `js/config.js`, `js/status.js`, `js/app.js` có mã **200**, không có dòng đỏ.
6. Kiểm tra Firebase: F12 → **Console** không có lỗi `PERMISSION_DENIED` hay `integrity`. Đèn ở góc phải tiêu đề hiện "TRỰC TUYẾN".
7. Thư mục `tests/` được đăng công khai nhưng vô hại: chỉ dùng Firebase giả lập. Có thể xóa khỏi bản triển khai nếu muốn.

Không cần build. Nếu sau này đổi phiên bản Leaflet/Firebase/Font Awesome thì phải cập nhật lại mã `integrity` trong `index.html`, nếu không trình duyệt sẽ chặn tải thư viện.

## 4. Kiểm thử bắt buộc với thiết bị thật (trước khi vận hành)

| # | Thao tác | Kết quả mong đợi |
|---|----------|------------------|
| E1 | Bật thiết bị + gateway, mở web | "ĐANG XÁC MINH" → sau gói đầu tiên: AN TOÀN / CẢNH BÁO / NGUY HIỂM. KPI Online = 1 |
| E2 | Đo chu kỳ gửi thực tế (F12 → xem "Nhận dữ liệu mới lúc") | Đặt `heartbeatTimeoutMs` ≈ 3 × chu kỳ trong `js/config.js` |
| E3 | Mực nước 0 → 1 → 2 → 3 | AN TOÀN → AN TOÀN → CẢNH BÁO → NGUY HIỂM. **Xác nhận ngưỡng mức 2** |
| E4 | Nhấn SOS | Thẻ đỏ nhấp nháy, 🚨 trên tab, marker đỏ, KPI SOS = 1 |
| E5 | Tắt SOS trên thiết bị | "SOS ĐÃ TẮT – CẦN XÁC MINH" (sau gói mới). Bấm xác nhận → về trạng thái theo mực nước |
| E6 | Nhấn SOS rồi tải lại trang ngay | Vẫn hiện SOS |
| E7 | Nhấn SOS, rồi rút nguồn gateway | Vẫn hiện SOS, ghi "có thể là dữ liệu cũ" |
| E8 | GPS chốt ngoài trời | "GPS trực tiếp", chỉ đường bật, marker liền nét |
| E9 | Che anten GPS | Chỉ đường bị khóa; "GPS cũ" → sau 10 phút "GPS QUÁ HẠN" (viền đỏ) |
| E10 | Rút nguồn thiết bị phát / rút nguồn gateway | Sau ≤ `heartbeatTimeoutMs`: "MẤT TÍN HIỆU", KPI Offline = 1 |
| E11 | Để trang mở ≥ 8 giờ | F12 → Performance monitor: bộ nhớ ổn định, không chậm dần |
| E12 | Tắt Wi-Fi máy tính 30 giây rồi bật lại | Banner đỏ → tự kết nối lại, không cần tải lại trang |
| E13 | Kiểm tra kiểu dữ liệu gateway ghi (Firebase Console) | `sosState`, `waterLevel` là số; `connection` là đúng `"CONNECT"`/`"DISCONNECT"` |
| E14 | Mở trên 2 điện thoại khác nhau | Cả hai hiển thị giống nhau; xác nhận SOS ở máy này **không** ẩn cảnh báo ở máy kia (đúng thiết kế) |

## 5. Bảo mật

### Đã rà soát

- Trang **chỉ đọc** Firebase (`.on("value")`); không có lệnh `set`/`update`/`push`/`remove`.
- Không có service account, khóa bí mật. `databaseURL` không phải bí mật.
- Nội dung động dùng `textContent`. `innerHTML` chỉ còn ở biểu đồ SVG (chỉ chứa số đã kiểm tra và chuỗi thời gian do trang tự tạo) và icon marker (chuỗi cố định).
- Link Google Maps chỉ chứa tọa độ đã kiểm tra (`toFixed(6)`), mở với `rel="noopener noreferrer"`.
- Thư viện ngoài có SRI: bị sửa trên CDN → trình duyệt từ chối chạy.

### Rủi ro không xử lý được bằng frontend

1. **Quyền đọc/ghi Firebase:** (cập nhật 13/11/2026) database hiện **từ chối mọi quyền đọc**, nên web không có dữ liệu. Firmware trạm thu ghi bằng Database Secret – loại khóa bỏ qua Rules – nên có thể áp dụng ngay `docs/firebase-rules-de-xuat.json`: cho đọc công khai 3 node web cần, chặn mọi quyền ghi công khai. Trạm thu vẫn ghi được. Chỉ chủ Firebase mới đổi được Rules (Firebase Console → Realtime Database → Rules).
2. **Xác nhận SOS chỉ cục bộ:** không đồng bộ giữa nhiều người trực. Phương án đề xuất (chưa triển khai): bật Firebase Authentication cho người trực, thêm node mới `/SosAcks/{id}` = `{ by, at, note }` chỉ cho tài khoản người trực ghi, rules chặn mọi người khác; trang đọc node này để hiển thị "Ai đã tiếp nhận lúc nào". Việc này **không** sửa node hiện có.
3. **Lịch sử, nhật ký chỉ cục bộ:** mỗi trình duyệt một bản, mất khi xóa dữ liệu trình duyệt, không phải hồ sơ sự cố dùng chung. Muốn có lịch sử chung cần gateway ghi thêm node lịch sử hoặc Cloud Function.
4. **Không có giờ thực từ thiết bị:** `lastUpdate` là bộ đếm thời gian chạy. Trang suy ra "còn sống" bằng cách thấy nó thay đổi. Nếu gateway ghi thêm `updatedAt: {".sv":"timestamp"}` (chỉ thêm trường, không đổi trường cũ), trang sẽ tự dùng giờ máy chủ – chính xác hơn, kể cả ngay khi vừa mở trang.
5. **Content-Security-Policy:** chưa thêm, vì Firebase có thể chuyển sang long-polling bằng script động từ `*.firebaseio.com`, dễ chặn nhầm. Nên thêm sau khi kiểm thử được trên mạng thật.
