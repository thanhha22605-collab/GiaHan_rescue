// -------------------------------------------------------------
// LOGIC XỬ LÝ DỮ LIỆU & PHÂN LOẠI TRẠNG THÁI
// Thuần JavaScript, không phụ thuộc DOM/Firebase → kiểm thử được bằng Node (tests/status.test.js).
// Nguyên tắc: thiếu, sai hoặc chưa xác minh dữ liệu thì KHÔNG BAO GIỜ trả về "AN TOÀN".
// -------------------------------------------------------------
(function (root) {
    "use strict";

    // Mốc thời gian nhỏ nhất được coi là epoch hợp lệ (01/01/2020, ms).
    // Giá trị nhỏ hơn (vd. millis() của vi điều khiển, hoặc epoch tính bằng giây) không phải giờ thực.
    const MIN_EPOCH_MS = 1577836800000;

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

    function isValidLatLng(lat, lng) {
        return lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng) &&
            lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0);
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

    // Kiểm tra timestamp giờ thực (epoch ms) so với giờ máy chủ ước lượng.
    // Trả về { ok, ageMs } hoặc { ok:false, reason: "missing" | "invalid" | "future" | "no_server_time" }.
    function validateTimestamp(ts, serverNow, skewMs) {
        if (ts === null || ts === undefined) return { ok: false, reason: "missing" };
        if (typeof ts !== "number" || !Number.isFinite(ts) || ts < MIN_EPOCH_MS) return { ok: false, reason: "invalid" };
        if (serverNow === null || serverNow === undefined || !Number.isFinite(serverNow)) return { ok: false, reason: "no_server_time" };
        const age = serverNow - ts;
        if (age < -skewMs) return { ok: false, reason: "future" };
        return { ok: true, ageMs: Math.max(0, age) };
    }

    // Chuẩn hóa node /Monitoring. Không sửa dữ liệu gốc.
    function parseMonitoring(raw, cfg) {
        const wl = (cfg && cfg.waterLevel) || { min: 0, max: 3 };
        if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
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
            sos: toFlag(raw.sosState),          // true | false | null (không xác định)
            sosRaw: raw.sosState,
            lat: lat,
            lng: lng,
            gpsFlag: gpsFlag,
            gps: validateGps(lat, lng, gpsFlag),
            // lastUpdate: bộ đếm của thiết bị (thường là millis()), KHÔNG phải giờ thực
            lastUpdate: toNumber(raw.lastUpdate),
            // updatedAt (tùy chọn, nếu gateway ghi {".sv":"timestamp"}): giờ thực của máy chủ, epoch ms
            updatedAt: raw.updatedAt === undefined ? null : toNumber(raw.updatedAt),
            hasUpdatedAt: raw.updatedAt !== undefined && raw.updatedAt !== null,
            statusText: typeof raw.statusText === "string" ? raw.statusText.slice(0, 80) : null
        };
    }

    // Phân loại mực nước theo ngưỡng cấu hình.
    function levelSeverity(level, cfg) {
        if (level === null || level === undefined) return null;
        if (level >= cfg.waterLevel.danger) return "danger";
        if (level >= cfg.waterLevel.warning) return "warning";
        return "safe";
    }

    // Theo dõi heartbeat.
    // - Có updatedAt hợp lệ → tính tuổi theo giờ máy chủ.
    // - Có updatedAt nhưng không đáng tin (sai định dạng / ở tương lai) → "untrusted", không coi là mới.
    // - Không có updatedAt → thiết bị được coi là còn sống khi lastUpdate (hoặc nội dung) THAY ĐỔI.
    //   Snapshot đầu tiên khi mở trang có thể là dữ liệu cũ nên chưa được tính là gói mới.
    function HeartbeatTracker(timeoutMs, skewMs) {
        this.timeoutMs = timeoutMs;
        this.skewMs = skewMs || 0;
        this.reset();
    }
    HeartbeatTracker.prototype.reset = function () {
        this.signature = undefined;
        this.firstSeenAt = null;
        this.lastChangeAt = null;
        this.updatedAt = null;
        this.hasUpdatedAt = false;
    };
    // Trả về true nếu snapshot này là gói dữ liệu mới (khác gói trước).
    HeartbeatTracker.prototype.observe = function (parsed, now) {
        if (!parsed || !parsed.exists) { this.reset(); return false; }
        this.updatedAt = parsed.updatedAt;
        this.hasUpdatedAt = !!parsed.hasUpdatedAt;
        const sig = parsed.lastUpdate !== null
            ? "u:" + parsed.lastUpdate
            : "v:" + [parsed.waterLevelRaw, parsed.sosRaw, parsed.lat, parsed.lng, parsed.gpsFlag, parsed.statusText, parsed.updatedAt].join("|");
        let isNew = false;
        if (this.signature === undefined) {
            this.firstSeenAt = now;
        } else if (sig !== this.signature) {
            this.lastChangeAt = now;
            isNew = true;
        }
        this.signature = sig;
        return isNew;
    };
    // state: "none" | "verifying" | "fresh" | "stale" | "untrusted"
    HeartbeatTracker.prototype.state = function (now, serverNow) {
        if (this.signature === undefined) return { state: "none", ageMs: null, source: null };
        if (this.hasUpdatedAt) {
            // Có trường updatedAt nhưng không đọc được thành số → không đáng tin
            const v = this.updatedAt === null ? { ok: false, reason: "invalid" } : validateTimestamp(this.updatedAt, serverNow, this.skewMs);
            if (v.ok) return { state: v.ageMs < this.timeoutMs ? "fresh" : "stale", ageMs: v.ageMs, source: "server" };
            if (v.reason === "invalid" || v.reason === "future") return { state: "untrusted", ageMs: null, source: "server", reason: v.reason };
            // no_server_time: chưa biết giờ máy chủ → dùng cách theo dõi thay đổi
        }
        if (this.lastChangeAt !== null) {
            const age = now - this.lastChangeAt;
            if (age < 0) return { state: "verifying", ageMs: null, source: "change" }; // đồng hồ máy bị chỉnh lùi
            return { state: age < this.timeoutMs ? "fresh" : "stale", ageMs: age, source: "change" };
        }
        return { state: now - this.firstSeenAt < this.timeoutMs ? "verifying" : "stale", ageMs: null, source: "change" };
    };

    // ---------------- Phân loại trạng thái tổng ----------------
    // input: {
    //   parsed, monitoringError (chuỗi|null), connection (giá trị node), connectionError (chuỗi|null),
    //   heartbeat (chuỗi state), clientOnline (bool), sosLatch (bool)
    // }
    // Thứ tự ưu tiên: SOS đang phát → SOS đã ghi nhớ → lỗi/không dữ liệu → mất kết nối → chưa xác minh
    //                 → mực nước (nguy hiểm/cảnh báo) → SOS/LoRa chưa xác minh → AN TOÀN.
    function classify(input, cfg) {
        const p = input.parsed;
        const monitoringOk = !!(p && p.exists) && !input.monitoringError;
        const fresh = input.heartbeat === "fresh" && !!input.clientOnline;
        const sev = monitoringOk ? levelSeverity(p.waterLevel, cfg) : null;
        const lastKnown = sev ? " Giá trị cuối: mức " + p.waterLevel + "." : "";
        const timeoutS = Math.round(cfg.heartbeatTimeoutMs / 1000);

        // 1. SOS đang phát – ưu tiên cao nhất, giữ cả khi dữ liệu cũ
        if (monitoringOk && p.sos === true) {
            const confirmed = fresh && !(input.connection === "DISCONNECT" && !input.connectionError);
            return {
                code: "SOS", label: "CẤP CỨU KHẨN CẤP (SOS)", canAck: false,
                detail: confirmed ? "Thiết bị đang phát tín hiệu SOS." : "Tín hiệu SOS chưa được xác nhận mới – có thể là dữ liệu cũ, cần kiểm tra ngay."
            };
        }
        // 2. SOS đã ghi nhớ: chỉ báo "đã tắt" khi có gói MỚI xác nhận sosState = false
        if (input.sosLatch) {
            if (monitoringOk && p.sos === false && fresh) {
                return {
                    code: "SOS_CLEARED", label: "SOS ĐÃ TẮT – CẦN XÁC MINH", canAck: true,
                    detail: "Thiết bị đã gửi sosState = 0. Hệ thống không tự chuyển sang an toàn; người trực cần xác minh thực tế."
                };
            }
            let why;
            if (input.monitoringError) why = "Không đọc được dữ liệu trạm: " + input.monitoringError;
            else if (!monitoringOk) why = "Không có dữ liệu trạm (/Monitoring trống).";
            else if (p.sos === null) why = "Trạng thái SOS hiện không xác định (sosState = " + String(p.sosRaw) + ").";
            else why = "Chưa nhận được gói dữ liệu mới xác nhận thiết bị đã tắt SOS.";
            return { code: "SOS", label: "ĐÃ GHI NHẬN SOS – CHƯA XÁC MINH", canAck: true, latched: true, detail: why };
        }
        // 3. Lỗi đọc / không có dữ liệu
        if (input.monitoringError) return { code: "NO_DATA", label: "KHÔNG ĐỌC ĐƯỢC DỮ LIỆU", detail: input.monitoringError };
        if (!monitoringOk) return { code: "NO_DATA", label: "KHÔNG CÓ DỮ LIỆU", detail: "Chưa nhận được dữ liệu từ trạm (/Monitoring trống)." };
        // 4. Mất kết nối
        if (!input.clientOnline) {
            return { code: "OFFLINE", label: "MẤT KẾT NỐI MÁY CHỦ", detail: "Trình duyệt mất kết nối Firebase – dữ liệu đang hiển thị có thể đã cũ." + lastKnown };
        }
        if (!input.connectionError && input.connection === "DISCONNECT") {
            return { code: "OFFLINE", label: "MẤT TÍN HIỆU", detail: "Trạm thu báo mất kết nối LoRa với thiết bị." + lastKnown };
        }
        if (input.heartbeat === "stale") {
            return { code: "OFFLINE", label: "MẤT TÍN HIỆU", detail: "Không nhận được dữ liệu mới trong " + timeoutS + " giây." + lastKnown };
        }
        // 5. Chưa chứng minh được dữ liệu còn mới
        if (input.heartbeat === "untrusted") {
            return { code: "VERIFYING", label: "THỜI GIAN DỮ LIỆU KHÔNG HỢP LỆ", detail: "Trường updatedAt sai định dạng hoặc nằm trong tương lai – không thể xác minh dữ liệu còn mới." + lastKnown };
        }
        if (input.heartbeat !== "fresh") {
            return { code: "VERIFYING", label: "ĐANG XÁC MINH TÍN HIỆU", detail: "Đang chờ gói dữ liệu mới để xác nhận thiết bị còn hoạt động." + lastKnown };
        }
        // 6. Mực nước
        if (sev === null) return { code: "NO_DATA", label: "KHÔNG CÓ DỮ LIỆU", detail: "Giá trị mực nước không hợp lệ: " + String(p.waterLevelRaw) };
        if (sev === "danger") return { code: "DANGER", label: "NGUY HIỂM – MỨC " + p.waterLevel, detail: "Mực nước đạt ngưỡng báo động lũ." };
        if (sev === "warning") return { code: "WARNING", label: "CẢNH BÁO – MỨC " + p.waterLevel, detail: "Mực nước đang tăng, cần theo dõi." };
        // 7. Các điều kiện bắt buộc còn lại trước khi kết luận an toàn
        if (p.sos === null) {
            return { code: "VERIFYING", label: "CHƯA XÁC MINH TÍN HIỆU SOS", detail: "sosState thiếu hoặc không hợp lệ (" + String(p.sosRaw) + ") – không thể kết luận an toàn." };
        }
        if (input.connectionError) {
            return { code: "VERIFYING", label: "CHƯA XÁC MINH KẾT NỐI LORA", detail: input.connectionError };
        }
        if (input.connection !== "CONNECT") {
            const v = input.connection === undefined || input.connection === null ? "không có dữ liệu" : "giá trị không xác định \"" + String(input.connection).slice(0, 30) + "\"";
            return { code: "VERIFYING", label: "CHƯA XÁC MINH KẾT NỐI LORA", detail: "Trạng thái trạm thu: " + v + "." };
        }
        return { code: "SAFE", label: "AN TOÀN", detail: "Dữ liệu mới, kết nối LoRa tốt, mực nước dưới ngưỡng cảnh báo." };
    }

    // Trạng thái liên kết của thiết bị dùng cho KPI: "none" | "online" | "offline" | "unverified".
    // ONLINE chỉ khi: có dữ liệu, máy chủ kết nối, heartbeat mới VÀ trạm thu báo CONNECT.
    function linkState(input) {
        const p = input.parsed;
        if (!(p && p.exists) || input.monitoringError) return "none";
        if ((!input.connectionError && input.connection === "DISCONNECT") || input.heartbeat === "stale") return "offline";
        if (input.clientOnline && input.heartbeat === "fresh" && !input.connectionError && input.connection === "CONNECT") return "online";
        return "unverified";
    }

    // Gộp trạng thái tổng + KPI để giao diện luôn đồng nhất.
    function summarize(input, cfg) {
        const status = classify(input, cfg);
        const link = linkState(input);
        const p = input.parsed;
        const monitoringOk = !!(p && p.exists) && !input.monitoringError;
        const sev = monitoringOk ? levelSeverity(p.waterLevel, cfg) : null;
        const sosLive = monitoringOk && p.sos === true;
        return {
            status: status,
            link: link,
            kpi: {
                total: monitoringOk ? 1 : 0,
                online: link === "online" ? 1 : 0,
                offline: link === "offline" ? 1 : 0,
                unverified: link === "unverified" ? 1 : 0,
                sos: sosLive || input.sosLatch ? 1 : 0,
                sosLive: sosLive,
                flood: sev === "warning" || sev === "danger" ? 1 : 0,
                floodSeverity: sev,
                dataFresh: link === "online"
            }
        };
    }

    // ---------------- Vị trí GPS ----------------
    // ctx: { parsed, fresh, lastChangeAt, now, lastValidPos {lat,lng,at}, gpsNode {lat,lng} }
    // kind: "live" (trực tiếp) | "recent" (cũ, còn trong hạn) | "expired" (quá hạn) | "unknown" (không rõ thời điểm)
    // source: "telemetry" (/Monitoring) | "browser" (vị trí hợp lệ cuối lưu trên trình duyệt) | "server" (node /gps)
    function pickPosition(ctx, cfg) {
        const p = ctx.parsed;
        const byAge = (lat, lng, at, source) => {
            if (at === null || at === undefined) return { lat, lng, at: null, ageMs: null, kind: "unknown", source };
            const ageMs = Math.max(0, ctx.now - at);
            return { lat, lng, at, ageMs, kind: ageMs <= cfg.gps.maxAgeMs ? "recent" : "expired", source };
        };
        const lvp = ctx.lastValidPos;
        if (p && p.exists && p.gps.valid) {
            if (ctx.fresh) return { lat: p.lat, lng: p.lng, at: ctx.lastChangeAt !== null ? ctx.lastChangeAt : ctx.now, ageMs: 0, kind: "live", source: "telemetry" };
            let at = ctx.lastChangeAt;
            if (at === null && lvp && Math.abs(lvp.lat - p.lat) < 1e-6 && Math.abs(lvp.lng - p.lng) < 1e-6) at = lvp.at;
            return byAge(p.lat, p.lng, at, "telemetry");
        }
        if (lvp) return byAge(lvp.lat, lvp.lng, lvp.at, "browser");
        const g = ctx.gpsNode;
        if (g && typeof g === "object") {
            const lat = toNumber(g.lat), lng = toNumber(g.lng);
            if (isValidLatLng(lat, lng)) return { lat, lng, at: null, ageMs: null, kind: "unknown", source: "server" };
        }
        return null;
    }

    // ---------------- Làm sạch dữ liệu localStorage ----------------
    function validEpoch(t, now, skewMs) {
        return typeof t === "number" && Number.isFinite(t) && t >= MIN_EPOCH_MS && t <= now + skewMs;
    }
    function sanitizePos(v, now, skewMs) {
        if (!v || typeof v !== "object") return null;
        const lat = toNumber(v.lat), lng = toNumber(v.lng), at = toNumber(v.at);
        if (!isValidLatLng(lat, lng) || !validEpoch(at, now, skewMs)) return null;
        return { lat, lng, at };
    }
    // An toàn khi lỗi: nếu có bất kỳ dữ liệu SOS đã ghi nhớ (kể cả bị hỏng) thì vẫn giữ cảnh báo.
    function sanitizeLatch(raw, now, skewMs) {
        if (raw === null || raw === undefined || raw === "null") return null;
        let v = null;
        try { v = JSON.parse(raw); } catch (e) { return { since: null, corrupted: true }; }
        if (v === null) return null;
        const since = v && typeof v === "object" ? toNumber(v.since) : null;
        return validEpoch(since, now, skewMs) ? { since } : { since: null, corrupted: true };
    }
    function sanitizeHistory(arr, cfg, now, max) {
        if (!Array.isArray(arr)) return [];
        const out = [];
        const seen = Object.create(null);
        for (const it of arr) {
            if (!it || typeof it !== "object") continue;
            const t = it.t, v = it.v;
            if (!validEpoch(t, now, cfg.clockSkewToleranceMs)) continue;
            if (typeof v !== "number" || !Number.isInteger(v) || v < cfg.waterLevel.min || v > cfg.waterLevel.max) continue;
            if (seen[t]) continue;
            seen[t] = 1;
            const rec = { t, v };
            if (typeof it.dev === "number" && Number.isFinite(it.dev)) rec.dev = it.dev;
            if (validEpoch(it.ts, now, cfg.clockSkewToleranceMs)) rec.ts = it.ts;
            out.push(rec);
        }
        out.sort((a, b) => a.t - b.t);
        return out.slice(-max);
    }
    const LOG_SEVS = { sos: 1, danger: 1, warning: 1, offline: 1, ok: 1, info: 1 };
    function sanitizeLog(arr, now, skewMs, max) {
        if (!Array.isArray(arr)) return [];
        const out = arr.filter((it) => it && typeof it === "object" && validEpoch(it.t, now, skewMs) &&
            LOG_SEVS[it.sev] === 1 && typeof it.msg === "string")
            .map((it) => ({ t: it.t, sev: it.sev, msg: it.msg.slice(0, 300) }));
        out.sort((a, b) => b.t - a.t);
        return out.slice(0, max);
    }

    const api = {
        MIN_EPOCH_MS, toNumber, toFlag, isValidLatLng, validateGps, validateTimestamp, parseMonitoring, levelSeverity,
        HeartbeatTracker, classify, linkState, summarize, pickPosition,
        sanitizePos, sanitizeLatch, sanitizeHistory, sanitizeLog
    };
    root.RescueStatus = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
