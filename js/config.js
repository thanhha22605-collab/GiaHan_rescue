// -------------------------------------------------------------
// CẤU HÌNH HỆ THỐNG
// Chỉnh các giá trị dưới đây cho khớp với firmware thiết bị.
// Không đặt khóa bí mật / service account vào file này (file chạy công khai trên trình duyệt).
// -------------------------------------------------------------
window.APP_CONFIG = {
    firebase: {
        databaseURL: "https://map-1dc88-default-rtdb.firebaseio.com/"
    },

    // Đường dẫn dữ liệu hiện có trên Firebase (giữ nguyên, không đổi cấu trúc)
    paths: {
        monitoring: "/Monitoring",                 // waterLevel, sosState, latitude, longitude, gpsValid, lastUpdate, statusText
        connection: "/DeviceStatus/connection",    // "CONNECT" | "DISCONNECT"
        lastGps: "/gps"                            // { lat, lng } – vị trí lưu gần nhất (chỉ dùng làm dự phòng)
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

    // Vị trí mặc định của bản đồ khi chưa có tọa độ hợp lệ (chỉ để hiển thị, KHÔNG đặt marker)
    defaultMapCenter: [20.2506, 105.9744],
    defaultMapZoom: 13
};
