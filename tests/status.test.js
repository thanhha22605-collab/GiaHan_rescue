// Chạy: node --test tests/status.test.js
// Mã [Txx] tương ứng danh sách kiểm thử bắt buộc trong CHANGELOG.md / docs/GIAI-DOAN-1.1.md
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../js/status.js");

const CFG = {
    waterLevel: { min: 0, max: 3, warning: 2, danger: 3 },
    heartbeatTimeoutMs: 60000,
    clockSkewToleranceMs: 30000,
    gps: { maxAgeMs: 600000 }
};
const NOW = 1_800_000_000_000; // epoch ms cố định cho kiểm thử
const base = { waterLevel: 0, sosState: 0, latitude: 20.15, longitude: 105.92, gpsValid: true, lastUpdate: 1000 };
const input = (raw, extra) => Object.assign({
    parsed: S.parseMonitoring(raw, CFG), monitoringError: null, connection: "CONNECT", connectionError: null,
    heartbeat: "fresh", clientOnline: true, sosLatch: false
}, extra);
const code = (raw, extra) => S.classify(input(raw, extra), CFG).code;
const noKey = (k) => { const o = { ...base }; delete o[k]; return o; };

// ---------------- Chuyển kiểu ----------------
test("toNumber / toFlag chấp nhận chuỗi số và từ chối rác", () => {
    assert.equal(S.toNumber("3"), 3);
    assert.equal(S.toNumber(""), null);
    assert.equal(S.toNumber("abc"), null);
    assert.equal(S.toNumber(NaN), null);
    assert.equal(S.toNumber(Infinity), null);
    assert.equal(S.toFlag("1"), true);
    assert.equal(S.toFlag(1), true);
    assert.equal(S.toFlag("false"), false);
    assert.equal(S.toFlag(undefined), null);
    assert.equal(S.toFlag(2), null);
    assert.equal(S.toFlag("yes"), null);
});

// ---------------- SOS ----------------
test("[T01] thiếu sosState → không AN TOÀN", () => {
    const r = S.classify(input(noKey("sosState")), CFG);
    assert.equal(r.code, "VERIFYING");
    assert.match(r.label, /SOS/);
});
test("[T02] sosState = null / giá trị lạ → không AN TOÀN", () => {
    for (const v of [null, "abc", 2, {}, []]) assert.notEqual(code({ ...base, sosState: v }), "SAFE", String(v));
});
test("[T03] sosState = \"1\" và true → SOS; 0/\"0\"/false → không SOS", () => {
    for (const v of ["1", true, 1]) assert.equal(code({ ...base, sosState: v }), "SOS");
    for (const v of [0, "0", false]) assert.equal(code({ ...base, sosState: v }), "SAFE");
});
test("[T04] SOS đang bật nhưng mất Firebase / mất LoRa / dữ liệu cũ → vẫn SOS", () => {
    for (const extra of [{ clientOnline: false }, { connection: "DISCONNECT" }, { heartbeat: "stale" }, { heartbeat: "untrusted" }]) {
        const r = S.classify(input({ ...base, sosState: 1 }, extra), CFG);
        assert.equal(r.code, "SOS", JSON.stringify(extra));
        assert.match(r.detail, /dữ liệu cũ/);
    }
});
test("[T05] SOS đã tắt (gói MỚI sosState=0) nhưng chưa xác nhận → SOS_CLEARED, có nút xác nhận", () => {
    const r = S.classify(input(base, { sosLatch: true }), CFG);
    assert.equal(r.code, "SOS_CLEARED");
    assert.equal(r.canAck, true);
});
test("[T05b] SOS đã ghi nhớ, sosState=0 nhưng dữ liệu CŨ → vẫn SOS (không báo đã tắt)", () => {
    for (const extra of [{ heartbeat: "stale" }, { heartbeat: "verifying" }, { clientOnline: false }]) {
        const r = S.classify(input(base, { sosLatch: true, ...extra }), CFG);
        assert.equal(r.code, "SOS", JSON.stringify(extra));
        assert.equal(r.latched, true);
    }
});
test("[T05c] SOS đã ghi nhớ, sosState không xác định → vẫn SOS", () => {
    const r = S.classify(input({ ...base, sosState: null }, { sosLatch: true }), CFG);
    assert.equal(r.code, "SOS");
    assert.match(r.detail, /không xác định/);
});
test("[T06] SOS đã ghi nhớ nhưng /Monitoring thiếu hoặc lỗi đọc → vẫn SOS", () => {
    assert.equal(code(null, { sosLatch: true }), "SOS");
    assert.equal(code(base, { sosLatch: true, monitoringError: "Lỗi đọc /Monitoring: không có quyền" }), "SOS");
});

// ---------------- Kết nối LoRa ----------------
test("[T07] connection không xác định / thiếu / lỗi đọc → không AN TOÀN", () => {
    for (const c of [null, undefined, "", "connect", "OK", 1]) {
        const r = S.classify(input(base, { connection: c }), CFG);
        assert.equal(r.code, "VERIFYING", String(c));
        assert.match(r.label, /LORA/);
    }
    assert.equal(code(base, { connection: "CONNECT", connectionError: "Lỗi đọc /DeviceStatus/connection" }), "VERIFYING");
});
test("[T08] connection = DISCONNECT → MẤT TÍN HIỆU", () => {
    const r = S.classify(input(base, { connection: "DISCONNECT" }), CFG);
    assert.equal(r.code, "OFFLINE");
    assert.equal(r.label, "MẤT TÍN HIỆU");
});
test("mất kết nối máy chủ được phân biệt với mất LoRa", () => {
    assert.equal(S.classify(input(base, { clientOnline: false }), CFG).label, "MẤT KẾT NỐI MÁY CHỦ");
});

// ---------------- Heartbeat & timestamp ----------------
test("[T09] heartbeat: snapshot đầu chưa xác minh, gói mới → fresh, quá hạn → stale", () => {
    const hb = new S.HeartbeatTracker(60000, 30000);
    assert.equal(hb.state(0).state, "none");
    assert.equal(hb.observe(S.parseMonitoring({ ...base, lastUpdate: 1 }, CFG), 0), false); // snapshot cũ lúc mở trang
    assert.equal(hb.state(1000).state, "verifying");
    assert.equal(hb.state(60000).state, "stale");
    assert.equal(hb.observe(S.parseMonitoring({ ...base, lastUpdate: 1 }, CFG), 61000), false); // đọc lại, không đổi
    assert.equal(hb.state(61000).state, "stale");
    assert.equal(hb.observe(S.parseMonitoring({ ...base, lastUpdate: 2 }, CFG), 62000), true);
    assert.equal(hb.state(62000).state, "fresh");
    assert.equal(hb.state(121999).state, "fresh");
    assert.equal(hb.state(122000).state, "stale");
    // Thiết bị khởi động lại (bộ đếm giảm) vẫn là gói mới
    assert.equal(hb.observe(S.parseMonitoring({ ...base, lastUpdate: 0 }, CFG), 130000), true);
    // Node biến mất → reset, lần sau lại là snapshot đầu
    hb.observe(S.parseMonitoring(null, CFG), 131000);
    assert.equal(hb.state(131000).state, "none");
    // Đồng hồ máy bị chỉnh lùi → không coi là mới
    hb.observe(S.parseMonitoring({ ...base, lastUpdate: 5 }, CFG), 200000);
    hb.observe(S.parseMonitoring({ ...base, lastUpdate: 6 }, CFG), 201000);
    assert.equal(hb.state(100000).state, "verifying");
});
test("[T09b] heartbeat dùng updatedAt hợp lệ (giờ máy chủ)", () => {
    const hb = new S.HeartbeatTracker(60000, 30000);
    hb.observe(S.parseMonitoring({ ...base, updatedAt: NOW }, CFG), 0);
    assert.equal(hb.state(0, NOW + 30000).state, "fresh");
    assert.equal(hb.state(0, NOW + 70000).state, "stale");
    // Chưa biết giờ máy chủ → quay về cách theo dõi thay đổi
    assert.equal(hb.state(0, null).state, "verifying");
});
test("[T10] updatedAt nằm trong tương lai quá dung sai → untrusted, không AN TOÀN", () => {
    const hb = new S.HeartbeatTracker(60000, 30000);
    hb.observe(S.parseMonitoring({ ...base, updatedAt: NOW + 120000 }, CFG), 0);
    assert.equal(hb.state(0, NOW).state, "untrusted");
    // Trong dung sai thì chấp nhận
    const hb2 = new S.HeartbeatTracker(60000, 30000);
    hb2.observe(S.parseMonitoring({ ...base, updatedAt: NOW + 10000 }, CFG), 0);
    assert.equal(hb2.state(0, NOW).state, "fresh");
    assert.equal(code(base, { heartbeat: "untrusted" }), "VERIFYING");
});
test("[T11] updatedAt không hợp lệ (chuỗi rác, millis(), epoch giây, âm) → untrusted", () => {
    for (const v of ["abc", 77893, 1_700_000_000, -5, {}]) {
        const hb = new S.HeartbeatTracker(60000, 30000);
        hb.observe(S.parseMonitoring({ ...base, updatedAt: v }, CFG), 0);
        // vẫn untrusted kể cả khi lastUpdate thay đổi
        hb.observe(S.parseMonitoring({ ...base, updatedAt: v, lastUpdate: 2000 }, CFG), 1000);
        assert.equal(hb.state(1000, NOW).state, "untrusted", String(v));
    }
    assert.deepEqual(S.validateTimestamp(NOW, NOW + 1000, 30000), { ok: true, ageMs: 1000 });
    assert.equal(S.validateTimestamp(NOW, null, 30000).reason, "no_server_time");
});

// ---------------- GPS ----------------
test("[T12] GPS thiếu tọa độ", () => {
    assert.equal(S.validateGps(null, 105.9, true).valid, false);
    assert.equal(S.parseMonitoring(noKey("latitude"), CFG).gps.valid, false);
    assert.equal(S.parseMonitoring({ ...base, latitude: "" }, CFG).gps.valid, false);
});
test("[T13] GPS ngoài phạm vi / 0,0 / gpsValid sai", () => {
    assert.equal(S.validateGps(95, 105, true).valid, false);
    assert.equal(S.validateGps(20.1, 200, true).valid, false);
    assert.equal(S.validateGps(0, 0, true).valid, false);
    assert.equal(S.validateGps(20.1, 105.9, false).valid, false);
    assert.equal(S.validateGps(20.1, 105.9, null).valid, false);
    assert.equal(S.validateGps(20.1, 105.9, true).valid, true);
    assert.equal(S.parseMonitoring({ ...base, latitude: "20.1", longitude: "105.9", gpsValid: "1" }, CFG).gps.valid, true);
});
test("[T14] GPS cũ / quá hạn / không rõ thời điểm không bao giờ là 'live'", () => {
    const p = S.parseMonitoring(base, CFG);
    const ctx = (extra) => Object.assign({ parsed: p, fresh: true, lastChangeAt: NOW, now: NOW, lastValidPos: null, gpsNode: null }, extra);
    assert.equal(S.pickPosition(ctx(), CFG).kind, "live");
    assert.equal(S.pickPosition(ctx({ fresh: false, now: NOW + 60000 }), CFG).kind, "recent");
    assert.equal(S.pickPosition(ctx({ fresh: false, now: NOW + 700000 }), CFG).kind, "expired");
    assert.equal(S.pickPosition(ctx({ fresh: false, lastChangeAt: null }), CFG).kind, "unknown");
    // Mất GPS: dùng vị trí hợp lệ cuối của trình duyệt (có thời điểm)
    const noFix = S.parseMonitoring({ ...base, gpsValid: false, latitude: 0, longitude: 0 }, CFG);
    const r = S.pickPosition(ctx({ parsed: noFix, lastValidPos: { lat: 20.1, lng: 105.9, at: NOW - 900000 } }), CFG);
    assert.equal(r.kind, "expired");
    assert.equal(r.source, "browser");
    // Chỉ có node /gps → dự phòng, không rõ thời điểm
    const g = S.pickPosition(ctx({ parsed: noFix, gpsNode: { lat: 20.149024, lng: 105.924103 } }), CFG);
    assert.equal(g.kind, "unknown");
    assert.equal(g.source, "server");
    // /gps sai → không có vị trí
    assert.equal(S.pickPosition(ctx({ parsed: noFix, gpsNode: { lat: 200, lng: "x" } }), CFG), null);
});

// ---------------- localStorage ----------------
test("[T15] localStorage hỏng/sai định dạng được làm sạch", () => {
    assert.equal(S.sanitizePos("abc", NOW, 30000), null);
    assert.equal(S.sanitizePos({ lat: 95, lng: 1, at: NOW }, NOW, 30000), null);
    assert.equal(S.sanitizePos({ lat: 20, lng: 105, at: NOW + 3_600_000 }, NOW, 30000), null); // ở tương lai
    assert.equal(S.sanitizePos({ lat: 20, lng: 105, at: 12345 }, NOW, 30000), null);
    assert.deepEqual(S.sanitizePos({ lat: 20, lng: 105, at: NOW }, NOW, 30000), { lat: 20, lng: 105, at: NOW });

    const h = S.sanitizeHistory([{ t: NOW, v: 1 }, { t: NOW - 1000, v: 2 }, { t: NOW, v: 1 }, { t: "x", v: 1 }, { t: NOW, v: 9 }, null, 5], CFG, NOW, 500);
    assert.deepEqual(h.map((x) => x.v), [2, 1]);                   // đã sắp xếp, bỏ trùng và bản ghi lỗi
    assert.deepEqual(S.sanitizeHistory("rác", CFG, NOW, 500), []);
    assert.equal(S.sanitizeHistory(Array.from({ length: 900 }, (_, i) => ({ t: NOW - i * 1000, v: 1 })), CFG, NOW, 500).length, 500);

    const l = S.sanitizeLog([{ t: NOW, sev: "ok", msg: "a" }, { t: NOW, sev: "<script>", msg: "b" }, { t: NOW - 5, sev: "info", msg: 5 }, {}], NOW, 30000, 150);
    assert.equal(l.length, 1);
    assert.deepEqual(S.sanitizeLog({}, NOW, 30000, 150), []);
});
test("[T15b] chốt SOS hỏng vẫn được giữ (an toàn khi lỗi)", () => {
    assert.equal(S.sanitizeLatch(null, NOW, 30000), null);
    assert.equal(S.sanitizeLatch("null", NOW, 30000), null);
    assert.deepEqual(S.sanitizeLatch(JSON.stringify({ since: NOW }), NOW, 30000), { since: NOW });
    assert.equal(S.sanitizeLatch("{hỏng", NOW, 30000).corrupted, true);
    assert.equal(S.sanitizeLatch(JSON.stringify({ since: "abc" }), NOW, 30000).corrupted, true);
});

// ---------------- Mực nước ----------------
test("[T18] mực nước 0–3 (số và chuỗi)", () => {
    assert.equal(code({ ...base, waterLevel: 0 }), "SAFE");
    assert.equal(code({ ...base, waterLevel: "1" }), "SAFE");
    assert.equal(code({ ...base, waterLevel: 2 }), "WARNING");
    assert.equal(code({ ...base, waterLevel: "3" }), "DANGER");
});
test("[T19] mực nước không hợp lệ → KHÔNG CÓ DỮ LIỆU", () => {
    for (const v of [undefined, null, -1, 4, 7, 1.5, "abc", "", true, {}]) {
        assert.equal(code({ ...base, waterLevel: v }), "NO_DATA", String(v));
    }
    assert.equal(code(null), "NO_DATA");
    assert.equal(code([]), "NO_DATA");
    assert.equal(code("chuỗi"), "NO_DATA");
});

// ---------------- KPI đồng nhất với trạng thái ----------------
test("[T20] KPI luôn đồng nhất với trạng thái tổng (quét tổ hợp đầu vào)", () => {
    const raws = [null, base, { ...base, sosState: 1 }, { ...base, sosState: null }, { ...base, waterLevel: 2 }, { ...base, waterLevel: 3 }, { ...base, waterLevel: "x" }];
    const conns = ["CONNECT", "DISCONNECT", null, undefined, "??"];
    const hbs = ["fresh", "stale", "verifying", "untrusted", "none"];
    let n = 0;
    for (const raw of raws) for (const connection of conns) for (const heartbeat of hbs)
        for (const clientOnline of [true, false]) for (const sosLatch of [false, true])
            for (const connectionError of [null, "lỗi"]) for (const monitoringError of [null, "lỗi"]) {
                const inp = input(raw, { connection, heartbeat, clientOnline, sosLatch, connectionError, monitoringError });
                const s = S.summarize(inp, CFG);
                const c = s.status.code;
                n++;
                // AN TOÀN ⇒ online thật sự
                if (c === "SAFE") assert.equal(s.link, "online");
                // ONLINE ⇒ LoRa CONNECT, heartbeat mới, máy chủ kết nối
                if (s.kpi.online) {
                    assert.equal(connection, "CONNECT"); assert.equal(heartbeat, "fresh"); assert.equal(clientOnline, true); assert.equal(connectionError, null);
                }
                // Mất tín hiệu do LoRa/heartbeat ⇒ KPI offline
                if (c === "OFFLINE" && s.status.label === "MẤT TÍN HIỆU") assert.equal(s.kpi.offline, 1);
                // SOS trên trạng thái ⇒ KPI SOS
                if (c === "SOS" || c === "SOS_CLEARED") assert.equal(s.kpi.sos, 1);
                // Mỗi thiết bị thuộc đúng một nhóm
                assert.equal(s.kpi.online + s.kpi.offline + s.kpi.unverified, s.kpi.total);
                // Không có dữ liệu ⇒ không đếm thiết bị
                if (!raw || monitoringError) assert.equal(s.kpi.total, 0);
            }
    assert.ok(n > 1000);
});
