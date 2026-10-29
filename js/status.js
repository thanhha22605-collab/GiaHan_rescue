// -------------------------------------------------------------
// LOGIC XỬ LÝ DỮ LIỆU & PHÂN LOẠI TRẠNG THÁI
// Thuần JavaScript, không phụ thuộc DOM/Firebase → kiểm thử được bằng Node (tests/status.test.js).
// -------------------------------------------------------------
(function (root) {
    "use strict";

    // Chuyển giá trị về số hữu hạn; chấp nhận số dạng chuỗi ("3", "20.15"). Ngược lại trả về null.
    function toNumber(v) {
        if (typeof v === "number") return Number.isFinite(v) ? v : null;
        if (typeof v === "string" && v.trim() !== "") {
            const n = Number(v.trim());
            return Number.isFinite(n) ? n : null;
        }
        return null;
    }

    // Chuyển giá trị về boolean; chấp nhận 1/0, "1"/"0", "true"/"false". Không xác định → null.
    function toFlag(v) {
        if (v === true || v === 1) return true;
        if (v === false || v === 0) return false;
        if (typeof v === "string") {
            const s = v.trim().toLowerCase();
            if (s === "1" || s === "true") return true;
            if (s === "0" || s === "false") return false;
        }
        return null;
    }

    // Kiểm tra tọa độ GPS trước khi dùng cho bản đồ.
    function validateGps(lat, lng, gpsFlag) {
        if (lat === null || lng === null) return { valid: false, reason: "Thiếu tọa độ" };
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return { valid: false, reason: "Tọa độ ngoài phạm vi" };
        if (lat === 0 && lng === 0) return { valid: false, reason: "Chưa có tín hiệu vệ tinh" };
        if (gpsFlag === false) return { valid: false, reason: "Thiết bị báo GPS chưa chốt" };
        if (gpsFlag === null) return { valid: false, reason: "Không rõ trạng thái GPS" };
        return { valid: true, reason: "" };
    }

    // Chuẩn hóa node /Monitoring. Không sửa dữ liệu gốc.
    function parseMonitoring(raw, cfg) {
        const wl = (cfg && cfg.waterLevel) || { min: 0, max: 3 };
        if (raw === null || raw === undefined || typeof raw !== "object") {
            return { exists: false };
        }
        const levelNum = toNumber(raw.waterLevel);
        const levelValid = levelNum !== null && Number.isInteger(levelNum) && levelNum >= wl.min && levelNum <= wl.max;
        const lat = toNumber(raw.latitude);
        const lng = toNumber(raw.longitude);
        const gpsFlag = toFlag(raw.gpsValid);
        return {
            exists: true,
            waterLevel: levelValid ? levelNum : null,
            waterLevelRaw: raw.waterLevel,
            sos: toFlag(raw.sosState),
            lat: lat,
            lng: lng,
            gpsFlag: gpsFlag,
            gps: validateGps(lat, lng, gpsFlag),
            lastUpdate: toNumber(raw.lastUpdate),
            // Trường tùy chọn (khuyến nghị firmware/gateway bổ sung): thời điểm máy chủ ghi, dạng epoch ms
            updatedAt: toNumber(raw.updatedAt),
            statusText: typeof raw.statusText === "string" ? raw.statusText : null
        };
    }

    // Phân loại mực nước theo ngưỡng cấu hình.
    function levelSeverity(level, cfg) {
        if (level === null || level === undefined) return null;
        if (level >= cfg.waterLevel.danger) return "danger";
        if (level >= cfg.waterLevel.warning) return "warning";
        return "safe";
    }

    // Theo dõi heartbeat: thiết bị được coi là "còn sống" khi lastUpdate (bộ đếm của thiết bị) thay đổi.
    // Snapshot đầu tiên khi mở trang có thể là dữ liệu cũ, nên chưa được tính là đã xác minh.
    function HeartbeatTracker(timeoutMs) {
        this.timeoutMs = timeoutMs;
        this.reset();
    }
    HeartbeatTracker.prototype.reset = function () {
        this.signature = undefined;
        this.firstSeenAt = null;
        this.lastChangeAt = null;
        this.updatedAt = null;
    };
    // now: giờ trình duyệt (ms). serverNow: giờ máy chủ ước lượng (ms) – chỉ dùng khi có updatedAt.
    HeartbeatTracker.prototype.observe = function (parsed, now) {
        if (!parsed || !parsed.exists) { this.reset(); return; }
        this.updatedAt = parsed.updatedAt;
        // Ưu tiên lastUpdate; nếu thiết bị không gửi thì so sánh toàn bộ giá trị.
        const sig = parsed.lastUpdate !== null
            ? "u:" + parsed.lastUpdate
            : "v:" + [parsed.waterLevelRaw, parsed.sos, parsed.lat, parsed.lng, parsed.gpsFlag, parsed.statusText].join("|");
        if (this.signature === undefined) {
            this.firstSeenAt = now;
        } else if (sig !== this.signature) {
            this.lastChangeAt = now;
        }
        this.signature = sig;
    };
    // Trả về "none" | "verifying" | "fresh" | "stale" và tuổi dữ liệu (ms, nếu biết).
    HeartbeatTracker.prototype.state = function (now, serverNow) {
        if (this.signature === undefined) return { state: "none", ageMs: null };
        if (this.updatedAt !== null && serverNow !== undefined && serverNow !== null) {
            const age = Math.max(0, serverNow - this.updatedAt);
            return { state: age < this.timeoutMs ? "fresh" : "stale", ageMs: age };
        }
        if (this.lastChangeAt !== null) {
            const age = now - this.lastChangeAt;
            return { state: age < this.timeoutMs ? "fresh" : "stale", ageMs: age };
        }
        return { state: now - this.firstSeenAt < this.timeoutMs ? "verifying" : "stale", ageMs: null };
    };

    // Phân loại trạng thái tổng của trạm. Thứ tự ưu tiên:
    // KHÔNG DỮ LIỆU → SOS → SOS ĐÃ HỦY (chờ xác minh) → MẤT TÍN HIỆU → ĐANG XÁC MINH → NGUY HIỂM → CẢNH BÁO → AN TOÀN.
    // "AN TOÀN" chỉ được trả về khi dữ liệu mới, kết nối tốt và mực nước hợp lệ dưới ngưỡng.
    function classify(input, cfg) {
        const p = input.parsed;
        const sev = p && p.exists ? levelSeverity(p.waterLevel, cfg) : null;
        const lastKnown = sev ? " Giá trị cuối: mức " + p.waterLevel + "." : "";

        if (!p || !p.exists) {
            return { code: "NO_DATA", label: "KHÔNG CÓ DỮ LIỆU", detail: "Chưa nhận được dữ liệu từ trạm (/Monitoring trống)." };
        }
        if (p.sos === true) {
            const stale = input.heartbeat !== "fresh" || !input.clientOnline;
            return {
                code: "SOS",
                label: "CẤP CỨU KHẨN CẤP (SOS)",
                detail: stale ? "Tín hiệu SOS chưa được xác nhận mới – có thể là dữ liệu cũ, cần kiểm tra ngay." : "Thiết bị đang phát tín hiệu SOS."
            };
        }
        if (input.sosLatch) {
            return {
                code: "SOS_CLEARED",
                label: "SOS ĐÃ TẮT – CẦN XÁC MINH",
                detail: "Thiết bị đã ngừng phát SOS. Hệ thống không tự chuyển sang an toàn; người trực cần xác minh rồi bấm xác nhận."
            };
        }
        if (!input.clientOnline) {
            return { code: "OFFLINE", label: "MẤT KẾT NỐI MÁY CHỦ", detail: "Trình duyệt mất kết nối Firebase – dữ liệu đang hiển thị có thể đã cũ." + lastKnown };
        }
        if (input.connection === "DISCONNECT") {
            return { code: "OFFLINE", label: "MẤT TÍN HIỆU", detail: "Trạm thu báo mất kết nối LoRa với thiết bị." + lastKnown };
        }
        if (input.heartbeat === "stale") {
            return { code: "OFFLINE", label: "MẤT TÍN HIỆU", detail: "Không nhận được dữ liệu mới trong " + Math.round(cfg.heartbeatTimeoutMs / 1000) + " giây." + lastKnown };
        }
        if (input.heartbeat !== "fresh") {
            return { code: "VERIFYING", label: "ĐANG XÁC MINH TÍN HIỆU", detail: "Đang chờ gói dữ liệu mới để xác nhận thiết bị còn hoạt động." + lastKnown };
        }
        if (sev === null) {
            return { code: "NO_DATA", label: "KHÔNG CÓ DỮ LIỆU", detail: "Giá trị mực nước không hợp lệ: " + String(p.waterLevelRaw) };
        }
        if (sev === "danger") return { code: "DANGER", label: "NGUY HIỂM – MỨC " + p.waterLevel, detail: "Mực nước đạt ngưỡng báo động lũ." };
        if (sev === "warning") return { code: "WARNING", label: "CẢNH BÁO – MỨC " + p.waterLevel, detail: "Mực nước đang tăng, cần theo dõi." };
        return { code: "SAFE", label: "AN TOÀN", detail: "Dữ liệu mới, mực nước dưới ngưỡng cảnh báo." };
    }

    const api = { toNumber, toFlag, validateGps, parseMonitoring, levelSeverity, HeartbeatTracker, classify };
    root.RescueStatus = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
