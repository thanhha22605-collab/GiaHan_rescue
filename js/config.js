// -------------------------------------------------------------
// CẤU HÌNH HỆ THỐNG
// Chỉnh các giá trị dưới đây cho khớp với firmware thiết bị.
// Không đặt khóa bí mật / service account vào file này (file chạy công khai trên trình duyệt).
// databaseURL không phải bí mật; quyền truy cập do Firebase Rules quyết định.
// -------------------------------------------------------------
window.APP_CONFIG = {
    firebase: {
        databaseURL: "https://map-1dc88-default-rtdb.firebaseio.com/"
    },

    // Đường dẫn dữ liệu hiện có trên Firebase (giữ nguyên, không đổi cấu trúc)
    paths: {
        monitoring: "/Monitoring",                 // waterLevel, sosState, latitude, longitude, gpsValid, lastUpdate, statusText
        connection: "/DeviceStatus/connection",    // "CONNECT" | "DISCONNECT"
        lastGps: "/gps"                            // { lat, lng } – vị trí lưu gần nhất (chỉ dùng làm dự phòng, không rõ thời điểm)
    },

    // Ngưỡng mực nước (thang 0–3 của thiết bị).
    // CẦN XÁC NHẬN VỚI FIRMWARE: mức 2 hiện được coi là "Cảnh báo", mức 3 là "Nguy hiểm".
    waterLevel: {
        min: 0,
        max: 3,
        warning: 2,
        danger: 3
    },

    // Heartbeat: nếu không thấy dữ liệu mới (lastUpdate thay đổi) trong khoảng này
    // thì coi thiết bị MẤT TÍN HIỆU. Nên đặt ≈ 3 lần chu kỳ gửi của thiết bị.
    // CẦN XÁC NHẬN chu kỳ gửi thực tế của trạm LoRa.
    heartbeatTimeoutMs: 60000,

    // Sai lệch đồng hồ cho phép khi kiểm tra timestamp (updatedAt, dữ liệu lưu cục bộ).
    // Timestamp nằm trong tương lai quá ngưỡng này bị coi là không hợp lệ.
    clockSkewToleranceMs: 30000,

    gps: {
        // Vị trí GPS cũ hơn ngưỡng này bị đánh dấu "QUÁ HẠN"
        maxAgeMs: 10 * 60 * 1000
    },

    // Giới hạn dữ liệu lưu cục bộ trên trình duyệt
    historyMax: 500,
    logMax: 150,
    storagePrefix: "rp_",

    // Chỉ bật trong trang kiểm thử (tests/harness.html)
    debug: false,

    // Vị trí mặc định của bản đồ khi chưa có tọa độ hợp lệ (chỉ để hiển thị, KHÔNG đặt marker)
    defaultMapCenter: [20.2506, 105.9744],
    defaultMapZoom: 13
};
