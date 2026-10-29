// Chạy: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../js/status.js");

const CFG = { waterLevel: { min: 0, max: 3, warning: 2, danger: 3 }, heartbeatTimeoutMs: 60000 };
const fresh = (raw, extra) => Object.assign({ parsed: S.parseMonitoring(raw, CFG), connection: "CONNECT", heartbeat: "fresh", clientOnline: true, sosLatch: false }, extra);
const base = { waterLevel: 0, sosState: 0, latitude: 20.15, longitude: 105.92, gpsValid: true, lastUpdate: 1000 };

test("toNumber / toFlag chấp nhận chuỗi số và từ chối rác", () => {
    assert.equal(S.toNumber("3"), 3);
    assert.equal(S.toNumber(""), null);
    assert.equal(S.toNumber("abc"), null);
    assert.equal(S.toNumber(NaN), null);
    assert.equal(S.toFlag("1"), true);
    assert.equal(S.toFlag(1), true);
    assert.equal(S.toFlag("false"), false);
    assert.equal(S.toFlag(undefined), null);
});

test("SOS dạng chuỗi \"1\" vẫn được nhận (bản cũ bỏ sót do so sánh ===)", () => {
    assert.equal(S.classify(fresh({ ...base, sosState: "1" }), CFG).code, "SOS");
});

test("mực nước dạng chuỗi \"3\" là NGUY HIỂM, mức 2 là CẢNH BÁO", () => {
    assert.equal(S.classify(fresh({ ...base, waterLevel: "3" }), CFG).code, "DANGER");
    assert.equal(S.classify(fresh({ ...base, waterLevel: 2 }), CFG).code, "WARNING");
    assert.equal(S.classify(fresh({ ...base, waterLevel: 1 }), CFG).code, "SAFE");
});

test("không mặc định AN TOÀN khi thiếu/không hợp lệ dữ liệu", () => {
    assert.equal(S.classify(fresh(null), CFG).code, "NO_DATA");
    assert.equal(S.classify(fresh({ ...base, waterLevel: undefined }), CFG).code, "NO_DATA");
    assert.equal(S.classify(fresh({ ...base, waterLevel: 7 }), CFG).code, "NO_DATA");
    assert.equal(S.classify(fresh({ ...base, waterLevel: "abc" }), CFG).code, "NO_DATA");
});

test("mất tín hiệu / đang xác minh không bao giờ ra AN TOÀN", () => {
    assert.equal(S.classify(fresh(base, { connection: "DISCONNECT" }), CFG).code, "OFFLINE");
    assert.equal(S.classify(fresh(base, { heartbeat: "stale" }), CFG).code, "OFFLINE");
    assert.equal(S.classify(fresh(base, { clientOnline: false }), CFG).code, "OFFLINE");
    assert.equal(S.classify(fresh(base, { heartbeat: "verifying" }), CFG).code, "VERIFYING");
});

test("SOS luôn được ưu tiên kể cả khi dữ liệu cũ hoặc mất kết nối", () => {
    const r = S.classify(fresh({ ...base, sosState: 1 }, { heartbeat: "stale", connection: "DISCONNECT" }), CFG);
    assert.equal(r.code, "SOS");
    assert.match(r.detail, /dữ liệu cũ/);
});

test("SOS đã tắt nhưng chưa xác nhận → không tự chuyển về AN TOÀN", () => {
    assert.equal(S.classify(fresh(base, { sosLatch: true }), CFG).code, "SOS_CLEARED");
});

test("kiểm tra tọa độ GPS", () => {
    assert.equal(S.validateGps(0, 0, true).valid, false);
    assert.equal(S.validateGps(95, 105, true).valid, false);
    assert.equal(S.validateGps(20.1, 200, true).valid, false);
    assert.equal(S.validateGps(20.1, 105.9, false).valid, false);
    assert.equal(S.validateGps(null, 105.9, true).valid, false);
    assert.equal(S.validateGps(20.1, 105.9, true).valid, true);
    assert.equal(S.parseMonitoring({ ...base, latitude: "20.1", longitude: "105.9", gpsValid: "1" }, CFG).gps.valid, true);
});

test("heartbeat: snapshot đầu chưa xác minh, lastUpdate đổi → fresh, quá hạn → stale", () => {
    const hb = new S.HeartbeatTracker(60000);
    assert.equal(hb.state(0).state, "none");
    hb.observe(S.parseMonitoring({ ...base, lastUpdate: 1 }, CFG), 0);
    assert.equal(hb.state(1000).state, "verifying");
    assert.equal(hb.state(60000).state, "stale");          // dữ liệu cũ có sẵn lúc mở trang
    hb.observe(S.parseMonitoring({ ...base, lastUpdate: 1 }, CFG), 61000); // không đổi
    assert.equal(hb.state(61000).state, "stale");
    hb.observe(S.parseMonitoring({ ...base, lastUpdate: 2 }, CFG), 62000);
    assert.equal(hb.state(62000).state, "fresh");
    assert.equal(hb.state(121999).state, "fresh");
    assert.equal(hb.state(122000).state, "stale");
});

test("heartbeat dùng updatedAt (giờ máy chủ) nếu có", () => {
    const hb = new S.HeartbeatTracker(60000);
    hb.observe(S.parseMonitoring({ ...base, updatedAt: 1_000_000 }, CFG), 0);
    assert.equal(hb.state(0, 1_030_000).state, "fresh");
    assert.equal(hb.state(0, 1_070_000).state, "stale");
});
