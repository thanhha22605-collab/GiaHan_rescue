// -------------------------------------------------------------
// ỨNG DỤNG GIÁM SÁT – kết nối Firebase, bản đồ và dashboard
// Chỉ ĐỌC dữ liệu Firebase; trang không ghi gì lên máy chủ.
// Lịch sử mực nước và nhật ký chỉ ghi từ dữ liệu thật nhận được và CHỈ lưu trên trình duyệt này.
// -------------------------------------------------------------
(function () {
    "use strict";

    const CFG = window.APP_CONFIG;
    const S = window.RescueStatus;
    const $ = (id) => document.getElementById(id);
    const SKEW = CFG.clockSkewToleranceMs;

    const PREFIX = CFG.storagePrefix || "rp_";
    const KEY = {
        pos: PREFIX + "last_valid_pos",
        sos: PREFIX + "sos_latch",
        history: PREFIX + "water_history",
        log: PREFIX + "activity_log",
        status: PREFIX + "last_status_key"
    };

    // ---------------- localStorage an toàn ----------------
    // Có thể bị chặn (ẩn danh) hoặc chứa dữ liệu hỏng → mọi thao tác đều bọc try/catch.
    function loadRaw(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }
    function loadJSON(key) {
        const raw = loadRaw(key);
        if (raw === null) return null;
        try { return JSON.parse(raw); } catch (e) { return undefined; } // undefined = hỏng
    }
    function saveJSON(key, value) {
        try {
            if (value === null) localStorage.removeItem(key);
            else localStorage.setItem(key, JSON.stringify(value));
        } catch (e) { /* bỏ qua: hết dung lượng hoặc bị chặn */ }
    }

    const bootNow = Date.now();
    const corrupted = [];
    function loadChecked(key, sanitize) {
        const raw = loadJSON(key);
        const clean = raw === undefined ? sanitize(null) : sanitize(raw);
        // Hỏng = không parse được, hoặc có bản ghi bị loại khi làm sạch → ghi đè bằng bản đã làm sạch
        const bad = raw === undefined || (raw !== null && (clean === null ||
            (Array.isArray(clean) && (!Array.isArray(raw) || clean.length !== raw.length))));
        if (bad) { corrupted.push(key); saveJSON(key, clean); }
        return clean;
    }

    const state = {
        startedAt: bootNow,
        monitoringLoaded: false,
        parsed: null,
        connection: undefined,          // undefined = chưa tải, null = không có node
        errors: { monitoring: null, connection: null, gps: null }, // lỗi RIÊNG từng node
        clientConnected: false,
        everConnected: false,
        serverOffset: null,             // null = chưa biết giờ máy chủ
        gpsNode: null,
        lastValidPos: loadChecked(KEY.pos, (v) => S.sanitizePos(v, bootNow, SKEW)),
        sosLatch: S.sanitizeLatch(loadRaw(KEY.sos), bootNow, SKEW),
        history: loadChecked(KEY.history, (v) => S.sanitizeHistory(v, CFG, bootNow, CFG.historyMax)),
        log: loadChecked(KEY.log, (v) => S.sanitizeLog(v, bootNow, SKEW, CFG.logMax)),
        lastStatusKey: (() => { const v = loadJSON(KEY.status); return typeof v === "string" ? v : null; })(),
        lastGpsValid: undefined,
        userMovedMap: false,
        hasCentered: false,
        historyDirty: true,
        logDirty: true
    };
    const heartbeat = new S.HeartbeatTracker(CFG.heartbeatTimeoutMs, SKEW);

    // ---------------- Định dạng ----------------
    const pad = (n) => String(n).padStart(2, "0");
    function fmtClock(ms) {
        const d = new Date(ms);
        if (isNaN(d.getTime())) return "--:--:--";
        return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
    }
    function fmtTime(ms) {
        const d = new Date(ms);
        if (isNaN(d.getTime())) return "--";
        return fmtClock(ms) + " " + pad(d.getDate()) + "/" + pad(d.getMonth() + 1);
    }
    function fmtAgo(ms) {
        const s = Math.max(0, Math.round(ms / 1000));
        if (s < 60) return s + " giây trước";
        if (s < 3600) return Math.floor(s / 60) + " phút trước";
        if (s < 86400) return Math.floor(s / 3600) + " giờ trước";
        return Math.floor(s / 86400) + " ngày trước";
    }
    // Chỉ chạm DOM khi giá trị thực sự thay đổi
    function setText(id, text, cls) {
        const el = $(id);
        if (el.textContent !== text) el.textContent = text;
        if (cls !== undefined && el.className !== cls) el.className = cls;
    }
    function setClass(id, cls) {
        const el = $(id);
        if (el.className !== cls) el.className = cls;
    }
    function setHidden(id, hidden) {
        const el = $(id);
        if (el.hidden !== hidden) el.hidden = hidden;
    }

    // ---------------- Nhật ký hoạt động (cục bộ) ----------------
    // sev: "sos" | "danger" | "warning" | "offline" | "ok" | "info"
    function addLog(sev, msg) {
        const top = state.log[0];
        if (top && top.sev === sev && top.msg === msg) return; // không ghi trùng liên tiếp
        state.log.unshift({ t: Date.now(), sev: sev, msg: String(msg).slice(0, 300) });
        if (state.log.length > CFG.logMax) state.log.length = CFG.logMax;
        saveJSON(KEY.log, state.log);
        state.logDirty = true;
    }
    const CODE_SEV = { SOS: "sos", DANGER: "danger", WARNING: "warning", OFFLINE: "offline", NO_DATA: "offline", SOS_CLEARED: "warning", SAFE: "ok", VERIFYING: "info" };
    const SEV_ICON = { sos: "fa-bell", danger: "fa-house-flood-water", warning: "fa-triangle-exclamation", offline: "fa-plug-circle-xmark", ok: "fa-circle-check", info: "fa-circle-info" };
    const ALERT_SEVS = { sos: 1, danger: 1, warning: 1, offline: 1 };

    function renderFeed(listId, emptyId, items) {
        const ul = $(listId);
        const frag = document.createDocumentFragment();
        items.forEach((it) => {
            const li = document.createElement("li");
            li.className = "s-" + it.sev;
            const ic = document.createElement("span");
            ic.className = "ic";
            const i = document.createElement("i");
            i.className = "fa-solid " + (SEV_ICON[it.sev] || "fa-circle-info");
            i.setAttribute("aria-hidden", "true");
            ic.appendChild(i);
            const body = document.createElement("div");
            const msg = document.createElement("div");
            msg.className = "msg";
            msg.textContent = it.msg;               // textContent: chống chèn mã
            const time = document.createElement("time");
            time.dateTime = new Date(it.t).toISOString();
            time.textContent = fmtTime(it.t);
            body.appendChild(msg);
            body.appendChild(time);
            li.appendChild(ic);
            li.appendChild(body);
            frag.appendChild(li);
        });
        ul.replaceChildren(frag);
        setHidden(emptyId, items.length > 0);
    }

    function renderFeeds() {
        if (!state.logDirty) return;
        state.logDirty = false;
        const alerts = state.log.filter((it) => ALERT_SEVS[it.sev]).slice(0, 30);
        renderFeed("alert-list", "alert-empty", alerts);
        renderFeed("log-list", "log-empty", state.log.slice(0, 60));
        setText("alert-count", String(alerts.length), "badge" + (alerts.length ? " has-items" : ""));
    }

    // ---------------- Biểu đồ mực nước (SVG tự vẽ, không thư viện) ----------------
    // t = giờ TRÌNH DUYỆT nhận gói; dev = bộ đếm thiết bị (lastUpdate); ts = giờ máy chủ nếu có updatedAt hợp lệ
    function recordWater(p, t) {
        const rec = { t: t, v: p.waterLevel };
        if (p.lastUpdate !== null) rec.dev = p.lastUpdate;
        const tsCheck = S.validateTimestamp(p.updatedAt, state.serverOffset === null ? null : t + state.serverOffset, SKEW);
        if (tsCheck.ok) rec.ts = p.updatedAt;
        const last = state.history[state.history.length - 1];
        if (last && last.t >= t) return; // bảo đảm thứ tự thời gian tăng dần
        // Mức không đổi và chưa đủ khoảng lấy mẫu → bỏ qua (giữ lịch sử dài, ít ghi localStorage)
        if (last && last.v === rec.v && t - last.t < CFG.historySampleMs) return;
        state.history.push(rec);
        if (state.history.length > CFG.historyMax) state.history.splice(0, state.history.length - CFG.historyMax);
        saveJSON(KEY.history, state.history);
        state.historyDirty = true;
    }

    function renderChart() {
        if (!state.historyDirty) return;
        state.historyDirty = false;
        const svg = $("chart");
        const pts = state.history;
        setHidden("chart-empty", pts.length > 0);
        if (!pts.length) { svg.replaceChildren(); return; }

        const W = svg.clientWidth || 600, H = svg.clientHeight || 220;
        const m = { l: 44, r: 12, t: 10, b: 24 };
        const lvMin = CFG.waterLevel.min, lvMax = CFG.waterLevel.max;
        const t0 = pts[0].t;
        const t1 = Math.max(pts[pts.length - 1].t, t0 + 60000);
        const x = (t) => (m.l + (t - t0) / (t1 - t0) * (W - m.l - m.r)).toFixed(1);
        const y = (v) => (m.t + (1 - (v - lvMin) / (lvMax - lvMin)) * (H - m.t - m.b)).toFixed(1);

        // Toàn bộ giá trị chèn vào SVG đều là số đã kiểm tra hoặc chuỗi thời gian do trang tự tạo
        let out = '<defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="#38bdf8" stop-opacity="0.35"/><stop offset="100%" stop-color="#38bdf8" stop-opacity="0"/></linearGradient></defs>';
        for (let v = lvMin; v <= lvMax; v++) {
            out += '<line class="grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>';
            out += '<text class="axis" x="' + (m.l - 8) + '" y="' + (Number(y(v)) + 3) + '" text-anchor="end">Mức ' + v + '</text>';
        }
        out += '<line class="th-warn" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(CFG.waterLevel.warning) + '" y2="' + y(CFG.waterLevel.warning) + '"/>';
        out += '<line class="th-bad" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(CFG.waterLevel.danger) + '" y2="' + y(CFG.waterLevel.danger) + '"/>';

        // Đường bậc thang: mực nước giữ nguyên cho tới gói kế tiếp
        let d = "M" + x(pts[0].t) + "," + y(pts[0].v);
        for (let i = 1; i < pts.length; i++) d += " H" + x(pts[i].t) + " V" + y(pts[i].v);
        out += '<path class="area" d="' + d + ' V' + y(lvMin) + ' H' + x(pts[0].t) + ' Z"/>';
        out += '<path class="line" d="' + d + '"/>';

        if (pts.length <= 120) {
            pts.forEach((p) => {
                const sev = S.levelSeverity(p.v, CFG);
                const c = sev === "danger" ? "#ef4444" : sev === "warning" ? "#f59e0b" : "#22c55e";
                const tip = "Nhận lúc " + fmtTime(p.t) + " – Mức " + p.v + (p.dev !== undefined ? " – bộ đếm thiết bị " + p.dev : "") + (p.ts ? " – giờ máy chủ " + fmtTime(p.ts) : "");
                out += '<circle class="pt" cx="' + x(p.t) + '" cy="' + y(p.v) + '" r="3.5" fill="' + c + '"><title>' + tip + '</title></circle>';
            });
        }
        out += '<text class="axis" x="' + m.l + '" y="' + (H - 6) + '">' + fmtTime(t0) + '</text>';
        out += '<text class="axis" x="' + (W - m.r) + '" y="' + (H - 6) + '" text-anchor="end">' + fmtTime(pts[pts.length - 1].t) + '</text>';
        svg.setAttribute("viewBox", "0 0 " + W + " " + H);
        svg.innerHTML = out;
    }
    if (window.ResizeObserver) new ResizeObserver(() => { state.historyDirty = true; renderChart(); }).observe($("chart"));

    // ---------------- Bản đồ ----------------
    const map = L.map("map", { zoomControl: false }).setView(CFG.defaultMapCenter, CFG.defaultMapZoom);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    // Khung bản đồ co giãn theo cột thông tin → báo Leaflet tính lại kích thước
    if (window.ResizeObserver) new ResizeObserver(() => map.invalidateSize()).observe($("map"));
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap"
    }).addTo(map);

    // Marker chỉ được tạo khi có tọa độ hợp lệ (không đặt marker giả ở vị trí mặc định)
    let marker = null;
    let markerKey = "";
    let popupKey = "";
    let currentPos = null;
    const popupEl = document.createElement("div");

    // Phân biệt di chuyển do người dùng với di chuyển do chương trình
    let programmaticMove = false;
    function moveMap(fn) {
        programmaticMove = true;
        try { fn(); } finally { programmaticMove = false; }
    }
    function onUserMove() {
        if (programmaticMove) return;
        state.userMovedMap = true;
        setHidden("map-recenter", !marker);
    }
    map.on("dragstart", onUserMove);
    map.on("zoomstart", onUserMove);
    $("map-recenter").addEventListener("click", () => {
        state.userMovedMap = false;
        setHidden("map-recenter", true);
        if (marker) moveMap(() => map.setView(marker.getLatLng(), Math.max(map.getZoom(), 15)));
    });

    function markerIcon(code, kind) {
        const cls = code === "SOS" ? "m-sos" : code === "DANGER" ? "m-danger" : code === "WARNING" ? "m-warning" : code === "SAFE" ? "m-safe" : "m-gray";
        const icon = code === "SOS" ? "fa-bell" : kind === "live" ? "fa-tower-broadcast" : "fa-question";
        const key = cls + "|" + kind;
        const stale = kind === "live" ? "" : " is-stale";
        return { key, icon: L.divIcon({ className: "", html: '<div class="dev-marker ' + cls + stale + '"><i class="fa-solid ' + icon + '"></i></div>', iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -16] }) };
    }

    function positionLabel(pos) {
        const when = pos.at !== null ? " – ghi nhận lúc " + fmtTime(pos.at) + " (" + fmtAgo(pos.ageMs) + ")" : "";
        if (pos.kind === "live") return "GPS trực tiếp";
        if (pos.kind === "recent") return "GPS cũ, vị trí tham khảo" + when;
        if (pos.kind === "expired") return "GPS QUÁ HẠN, vị trí tham khảo" + when;
        return pos.source === "server" ? "Vị trí dự phòng (/gps) – không rõ thời điểm ghi" : "GPS chưa xác minh – không rõ thời điểm ghi";
    }

    function renderMap(status, fresh) {
        const pos = S.pickPosition({
            parsed: state.parsed, fresh: fresh, lastChangeAt: heartbeat.lastChangeAt, now: Date.now(),
            lastValidPos: state.lastValidPos, gpsNode: state.errors.gps ? null : state.gpsNode
        }, CFG);
        currentPos = pos;
        const link = $("gmaps-link");

        if (!pos) {
            if (marker) { map.removeLayer(marker); marker = null; markerKey = ""; popupKey = ""; }
            setHidden("map-note", false);
            setText("map-note", "Chưa có tọa độ GPS hợp lệ – chưa hiển thị vị trí thiết bị.", "map-note n-warn");
            link.setAttribute("aria-disabled", "true");
            link.removeAttribute("href");
            setText("gmaps-text", "Chỉ đường (chưa có vị trí)");
            setText("gps-source", "Chưa có", "c-muted");
            setText("gps-time", "--");
            setHidden("gps-copy", true);
            setHidden("map-recenter", true);
            return;
        }

        const latlng = [pos.lat, pos.lng];
        const ic = markerIcon(status.code, pos.kind);
        if (!marker) {
            marker = L.marker(latlng, { icon: ic.icon, keyboard: true, title: "Trạm cảnh báo lũ" }).addTo(map).bindPopup(popupEl);
            markerKey = ic.key;
        } else {
            const cur = marker.getLatLng();
            if (cur.lat !== pos.lat || cur.lng !== pos.lng) marker.setLatLng(latlng);
            if (ic.key !== markerKey) { marker.setIcon(ic.icon); markerKey = ic.key; }
        }
        // Tự di chuyển bản đồ chỉ khi người dùng chưa thao tác
        if (!state.hasCentered) {
            moveMap(() => map.setView(latlng, 16));
            state.hasCentered = true;
        } else if (!state.userMovedMap) {
            const c = map.getCenter();
            if (Math.abs(c.lat - pos.lat) > 1e-6 || Math.abs(c.lng - pos.lng) > 1e-6) moveMap(() => map.panTo(latlng));
        }

        const label = positionLabel(pos);
        const p = state.parsed;
        const lines = [
            ["b", "Trạm Cảnh Báo Lũ"],
            ["", "Trạng thái: " + status.label],
            ["", "Mực nước: " + (p && p.exists && p.waterLevel !== null ? "Mức " + p.waterLevel : "--")],
            [pos.kind === "live" ? "" : "warn", "Vị trí: " + label],
            ["", "Tọa độ: " + pos.lat.toFixed(6) + ", " + pos.lng.toFixed(6)]
        ];
        if (status.code === "SOS") lines.push(["sos", "[ĐANG YÊU CẦU CỨU HỘ!]"]);
        // Popup dựng bằng textContent, chỉ dựng lại khi nội dung đổi (tránh nhấp nháy khi đang mở)
        const key = lines.map((l) => l.join(":")).join("\n");
        if (key !== popupKey) {
            popupKey = key;
            popupEl.textContent = "";
            lines.forEach(([kind, text], i) => {
                const el = document.createElement(kind === "b" ? "b" : "span");
                el.textContent = text;
                if (kind === "sos") { el.style.color = "#c62828"; el.style.fontWeight = "bold"; }
                if (kind === "warn") el.style.color = "#b45309";
                if (i) popupEl.appendChild(document.createElement("br"));
                popupEl.appendChild(el);
            });
        }

        const live = pos.kind === "live";
        setHidden("map-note", live);
        if (!live) {
            const strong = pos.kind === "expired" || pos.kind === "unknown";
            setText("map-note", "⚠ " + label + ". Không dùng làm vị trí cứu hộ trực tiếp.", "map-note " + (strong ? "n-bad" : "n-warn"));
        }
        // Chỉ đường chỉ bật với GPS trực tiếp; vị trí cũ chỉ cho sao chép để tham khảo
        if (live) {
            link.href = "https://www.google.com/maps/dir/?api=1&destination=" + pos.lat.toFixed(6) + "," + pos.lng.toFixed(6);
            link.setAttribute("aria-disabled", "false");
            setText("gmaps-text", "Chỉ đường bằng Google Maps");
        } else {
            link.removeAttribute("href");
            link.setAttribute("aria-disabled", "true");
            setText("gmaps-text", "Chỉ đường bị khóa – vị trí chưa xác minh");
        }
        setHidden("gps-copy", live);
        setText("gps-source", label, live ? "c-ok" : (pos.kind === "recent" ? "c-warn" : "c-bad"));
        setText("gps-time", pos.at !== null ? fmtTime(pos.at) + (live ? "" : " (" + fmtAgo(pos.ageMs) + ")") : "Không rõ");
    }

    $("gps-copy").addEventListener("click", () => {
        if (!currentPos) return;
        const text = currentPos.lat.toFixed(6) + ", " + currentPos.lng.toFixed(6) + " (VỊ TRÍ THAM KHẢO – " + positionLabel(currentPos) + ")";
        const done = () => addLog("info", "Đã sao chép tọa độ tham khảo " + currentPos.lat.toFixed(6) + ", " + currentPos.lng.toFixed(6));
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, () => window.prompt("Sao chép tọa độ tham khảo:", text));
        } else {
            window.prompt("Sao chép tọa độ tham khảo:", text);
        }
    });

    // ---------------- Chỉ số tổng quan ----------------
    // Hiện hệ thống có 1 trạm (/Monitoring). Mọi con số đều lấy từ S.summarize nên đồng nhất với trạng thái tổng.
    function renderKpis(sum, hb, loaded) {
        const k = sum.kpi;
        const p = state.parsed;
        const dash = (n) => (loaded ? String(n) : "--");

        setText("kpi-total", dash(k.total));
        setText("kpi-total-sub", !loaded ? "Đang tải" : state.errors.monitoring ? "Lỗi đọc dữ liệu" : k.total ? "Trạm /Monitoring" : "Chưa có dữ liệu trạm");
        setClass("kpi-total-card", "kpi" + (loaded && state.errors.monitoring ? " k-bad" : ""));

        setText("kpi-online", dash(k.online));
        setText("kpi-online-sub", k.unverified ? k.unverified + " chưa xác minh" : "LoRa + gói mới");
        setClass("kpi-online-card", "kpi " + (k.online ? "k-ok" : k.unverified ? "k-warn" : "k-muted"));

        setText("kpi-offline", dash(k.offline));
        setText("kpi-offline-sub", "Offline / mất nhịp");
        setClass("kpi-offline-card", "kpi " + (k.offline ? "k-bad" : "k-muted"));

        setText("kpi-sos", loaded || state.sosLatch ? String(k.sos) : "--");
        setText("kpi-sos-sub", k.sos ? (k.sosLive ? "Đang phát SOS" : "Chưa xác minh") : "Không có SOS");
        setClass("kpi-sos-card", "kpi " + (k.sos ? (k.sosLive || sum.status.code === "SOS" ? "k-alarm" : "k-warn") : "k-muted"));

        setText("kpi-flood", dash(k.flood));
        setText("kpi-flood-sub", k.flood ? "Mức " + p.waterLevel + (k.dataFresh ? "" : " – dữ liệu cũ") : k.total && k.floodSeverity === null ? "Mực nước không hợp lệ" : "Từ mức " + CFG.waterLevel.warning + " trở lên");
        setClass("kpi-flood-card", "kpi " + (k.flood ? (k.floodSeverity === "danger" ? "k-bad" : "k-warn") : "k-muted"));

        const now = Date.now();
        if (hb.source === "server" && hb.ageMs !== null) {
            setText("kpi-updated", fmtAgo(hb.ageMs));
            setText("kpi-updated-sub", "Theo giờ máy chủ");
        } else if (heartbeat.lastChangeAt) {
            setText("kpi-updated", fmtClock(heartbeat.lastChangeAt));
            setText("kpi-updated-sub", "Trình duyệt nhận – " + fmtAgo(now - heartbeat.lastChangeAt));
        } else {
            setText("kpi-updated", "--");
            setText("kpi-updated-sub", loaded ? "Chưa có gói mới" : "Đang tải");
        }
        setClass("kpi-updated-card", "kpi " + (k.dataFresh ? "k-ok" : "k-muted"));
    }

    // ---------------- Hiển thị tổng ----------------
    const STATUS_VIEW = {
        LOADING:     ["status-verifying", "fa-hourglass-half"],
        NO_DATA:     ["status-nodata", "fa-circle-question"],
        VERIFYING:   ["status-verifying", "fa-hourglass-half"],
        OFFLINE:     ["status-offline", "fa-tower-broadcast"],
        SOS:         ["status-sos", "fa-bell"],
        SOS_CLEARED: ["status-cleared", "fa-bell-slash"],
        DANGER:      ["status-danger", "fa-house-flood-water"],
        WARNING:     ["status-warning", "fa-triangle-exclamation"],
        SAFE:        ["status-safe", "fa-shield-halved"]
    };
    const TITLE = "Hệ Thống Giám Sát Cảnh Báo Lũ Lụt & Cứu Hộ";

    function render() {
        const now = Date.now();
        const serverNow = state.serverOffset === null ? null : now + state.serverOffset;
        const hb = heartbeat.state(now, serverNow);
        const clientOnline = state.clientConnected;
        const fresh = hb.state === "fresh" && clientOnline;
        const loaded = state.monitoringLoaded || !!state.errors.monitoring;

        // Thanh báo mất mạng: chỉ hiện sau khi đã từng kết nối, hoặc quá 8 giây vẫn chưa kết nối được
        setHidden("net-banner", clientOnline || (!state.everConnected && now - state.startedAt < 8000));

        // Đồng hồ và đèn kết nối máy chủ trên header
        setText("clock", fmtClock(now));
        setClass("live-pill", "live-pill " + (clientOnline ? "is-live" : state.everConnected ? "is-down" : ""));
        setText("live-text", clientOnline ? "TRỰC TUYẾN" : state.everConnected ? "MẤT KẾT NỐI" : "ĐANG KẾT NỐI");

        const input = {
            parsed: state.parsed,
            monitoringError: state.errors.monitoring,
            connection: state.connection,
            connectionError: state.errors.connection,
            heartbeat: hb.state,
            clientOnline: clientOnline,
            sosLatch: !!state.sosLatch
        };
        let sum = S.summarize(input, CFG);
        let status = sum.status;
        // Chưa có gì để kết luận (trừ khi đã ghi nhớ SOS từ trước)
        if (!loaded && status.code !== "SOS") {
            status = { code: "LOADING", label: "ĐANG TẢI DỮ LIỆU...", detail: "Chưa xác minh – không hiển thị \"An toàn\" khi chưa có dữ liệu." };
        }

        // Ghi nhật ký khi trạng thái tổng thay đổi (bỏ qua trạng thái tạm); lưu lại để tải lại trang không ghi trùng
        const statusKey = status.code + "|" + status.label;
        if (status.code !== "LOADING" && !(status.code === "VERIFYING" && status.label === "ĐANG XÁC MINH TÍN HIỆU") && statusKey !== state.lastStatusKey) {
            addLog(CODE_SEV[status.code] || "info", status.label + (status.detail ? " – " + status.detail : ""));
            state.lastStatusKey = statusKey;
            saveJSON(KEY.status, statusKey);
        }

        const view = STATUS_VIEW[status.code] || STATUS_VIEW.NO_DATA;
        setClass("status-card", "status-box " + view[0]);
        setClass("status-icon", "fa-solid " + view[1]);
        setText("status-text", status.label);
        setText("status-detail", status.detail || "");
        setHidden("sos-ack-btn", !status.canAck);
        const title = status.code === "SOS" ? "🚨 SOS – " + TITLE : TITLE;
        if (document.title !== title) document.title = title;

        // Kết nối LoRa (giá trị do trạm thu ghi lên Firebase) – tách biệt với kết nối máy chủ
        const c = state.connection;
        if (state.errors.connection) setText("connection-status", "LỖI ĐỌC DỮ LIỆU", "c-bad");
        else if (c === undefined) setText("connection-status", "ĐANG TẢI...", "c-muted");
        else if (c === "CONNECT") setText("connection-status", clientOnline ? "ĐÃ KẾT NỐI (ONLINE)" : "CONNECT (chưa cập nhật)", clientOnline ? "c-ok" : "c-muted");
        else if (c === "DISCONNECT") setText("connection-status", "MẤT KẾT NỐI (OFFLINE)", "c-bad");
        else if (c === null) setText("connection-status", "KHÔNG CÓ DỮ LIỆU", "c-warn");
        else setText("connection-status", "KHÔNG XÁC ĐỊNH", "c-warn");

        // Heartbeat
        const hbView = {
            none: ["Chưa có dữ liệu", "c-muted"],
            verifying: ["Đang xác minh (chờ gói mới)", "c-warn"],
            fresh: ["Bình thường", "c-ok"],
            stale: ["Mất nhịp > " + Math.round(CFG.heartbeatTimeoutMs / 1000) + " giây", "c-bad"],
            untrusted: ["Thời gian dữ liệu không hợp lệ", "c-bad"]
        }[hb.state];
        setText("heartbeat-status", hbView[0], hbView[1]);
        if (hb.source === "server" && hb.ageMs !== null) setText("last-seen", fmtAgo(hb.ageMs) + " (giờ máy chủ)");
        else if (heartbeat.lastChangeAt) setText("last-seen", fmtTime(heartbeat.lastChangeAt) + " (" + fmtAgo(now - heartbeat.lastChangeAt) + ")");
        else setText("last-seen", state.monitoringLoaded ? "Chưa có gói mới từ khi mở trang" : "--");

        // Mực nước
        const p = state.parsed;
        const exists = p && p.exists && !state.errors.monitoring;
        const hasLevel = exists && p.waterLevel !== null;
        setText("water-level", hasLevel ? "MỨC " + p.waterLevel : "MỨC --");
        $("water-level").classList.toggle("is-stale", !(fresh && sum.link === "online"));
        let note = "Ngưỡng: Mức " + CFG.waterLevel.warning + " Cảnh báo | Mức " + CFG.waterLevel.danger + " Nguy hiểm";
        if (exists && !hasLevel) note = "Giá trị mực nước không hợp lệ: " + String(p.waterLevelRaw).slice(0, 30);
        else if (hasLevel && sum.link !== "online") note += " – (dữ liệu chưa xác minh/đã cũ)";
        setText("water-note", note);
        setText("device-status-text", exists && p.statusText ? p.statusText : "--");

        // GPS
        if (exists) {
            setText("lat-val", p.lat !== null ? p.lat.toFixed(6) : "--");
            setText("lng-val", p.lng !== null ? p.lng.toFixed(6) : "--");
            if (p.gps.valid) setText("gps-status", fresh ? "Đã định vị [OK]" : "Đã định vị (dữ liệu cũ)", fresh ? "c-ok" : "c-muted");
            else setText("gps-status", p.gps.reason, "c-warn");
        } else {
            setText("lat-val", "--.------");
            setText("lng-val", "---.------");
            setText("gps-status", "Chưa có dữ liệu", "c-muted");
        }

        renderMap(status.code === "LOADING" ? { code: "NO_DATA", label: status.label } : status, fresh);
        renderKpis(sum, hb, loaded);
        renderChart();
        renderFeeds();
    }

    $("sos-ack-btn").addEventListener("click", () => {
        const msg = "XÁC NHẬN ĐÃ KIỂM TRA THỰC TẾ?\n\n" +
            "• Chỉ ẩn cảnh báo SOS trên TRÌNH DUYỆT NÀY.\n" +
            "• KHÔNG ghi lên Firebase, KHÔNG báo cho người trực khác.\n" +
            "• KHÔNG có nghĩa là cứu hộ đã hoàn tất.\n\n" +
            "Nếu thiết bị phát SOS lần nữa, cảnh báo sẽ bật lại.";
        if (!confirm(msg)) return;
        state.sosLatch = null;
        saveJSON(KEY.sos, null);
        addLog("info", "Người trực đã xác minh và bỏ cảnh báo SOS trên trình duyệt này (không đồng bộ cho người khác)");
        render();
    });

    // ---------------- Firebase (chỉ đọc) ----------------
    firebase.initializeApp(CFG.firebase);
    const database = firebase.database();

    function describeError(path, err) {
        const code = err && err.code ? String(err.code) : "";
        if (/permission[_-]denied/i.test(code)) return "Lỗi đọc " + path + ": không có quyền truy cập (kiểm tra Firebase Rules)";
        return "Lỗi đọc " + path + ": " + ((err && err.message) || code || "không xác định");
    }

    // Mỗi node có listener và biến lỗi riêng; lỗi node A không bị xóa khi node B cập nhật.
    // Firebase tự hủy listener khi lỗi (vd. không có quyền) → gắn lại khi kết nối phục hồi.
    const listeners = {};
    function listen(key, path, onValue) {
        const prev = listeners[key];
        if (prev) prev.ref.off("value", prev.cb);
        const ref = database.ref(path);
        const cb = (snap) => {
            if (state.errors[key]) addLog("ok", "Đã đọc lại được " + path);
            state.errors[key] = null;
            onValue(snap.val());
            render();
        };
        const onErr = (err) => {
            const msg = describeError(path, err);
            if (state.errors[key] !== msg) addLog("offline", msg);
            state.errors[key] = msg;
            listeners[key] = null;          // Firebase đã hủy listener này
            console.error(msg, err);
            render();
        };
        ref.on("value", cb, onErr);
        listeners[key] = { ref, cb, path, onValue };
    }
    const NODES = {};
    function attachFailedNodes() {
        Object.keys(NODES).forEach((key) => {
            if (!listeners[key]) listen(key, NODES[key].path, NODES[key].onValue);
        });
    }
    function register(key, path, onValue) {
        NODES[key] = { path, onValue };
        listen(key, path, onValue);
    }

    if (corrupted.length) addLog("warning", "Đã loại bỏ dữ liệu lưu cục bộ bị hỏng: " + corrupted.join(", "));
    if (state.sosLatch && state.sosLatch.corrupted) addLog("sos", "Dữ liệu SOS lưu cục bộ bị hỏng – giữ cảnh báo SOS để an toàn");
    addLog("info", "Mở trang giám sát");

    database.ref(".info/connected").on("value", (snap) => {
        const connected = snap.val() === true;
        if (connected !== state.clientConnected && (connected || state.everConnected)) {
            addLog(connected ? "ok" : "offline", connected ? "Đã kết nối máy chủ Firebase" : "Mất kết nối máy chủ Firebase");
        }
        const reconnected = connected && !state.clientConnected && state.everConnected;
        state.clientConnected = connected;
        if (connected) state.everConnected = true;
        if (reconnected) attachFailedNodes();   // kiểm tra lại các node từng bị lỗi
        render();
    });
    database.ref(".info/serverTimeOffset").on("value", (snap) => {
        const v = S.toNumber(snap.val());
        state.serverOffset = v === null ? null : v;
    });

    register("monitoring", CFG.paths.monitoring, (val) => {
        const now = Date.now();
        state.monitoringLoaded = true;
        state.parsed = S.parseMonitoring(val, CFG);
        const isNewPacket = heartbeat.observe(state.parsed, now);
        const p = state.parsed;
        const hbNow = heartbeat.state(now, state.serverOffset === null ? null : now + state.serverOffset).state;

        // Chỉ ghi lịch sử khi nhận gói thật sự mới (không ghi lại snapshot cũ lúc mở trang/kết nối lại)
        if (isNewPacket && p.exists && p.waterLevel !== null) recordWater(p, now);
        // Ghi nhớ vị trí hợp lệ cuối cùng (chỉ khi dữ liệu thực sự mới)
        if (p.exists && p.gps.valid && hbNow === "fresh") {
            state.lastValidPos = { lat: p.lat, lng: p.lng, at: now };
            saveJSON(KEY.pos, state.lastValidPos);
        }
        // GPS chốt / mất (chỉ xét gói mới)
        if (p.exists && isNewPacket && state.lastGpsValid !== undefined && p.gps.valid !== state.lastGpsValid) {
            addLog(p.gps.valid ? "ok" : "warning", p.gps.valid ? "GPS đã định vị" : "Mất định vị GPS – " + p.gps.reason);
        }
        if (p.exists && isNewPacket) state.lastGpsValid = p.gps.valid;
        // Chốt SOS: chỉ người trực mới bỏ được; dữ liệu lỗi/thiếu không xóa được chốt
        if (p.exists && p.sos === true && !state.sosLatch) {
            state.sosLatch = { since: now };
            saveJSON(KEY.sos, state.sosLatch);
        }
    });

    register("connection", CFG.paths.connection, (val) => {
        if (state.connection !== undefined && val !== state.connection) {
            const label = val === "CONNECT" ? "đã kết nối" : val === "DISCONNECT" ? "mất kết nối" : val === null ? "không có dữ liệu" : "giá trị không xác định";
            addLog(val === "CONNECT" ? "ok" : val === "DISCONNECT" ? "offline" : "warning", "Trạm thu LoRa: " + label);
        }
        state.connection = val;
    });

    register("gps", CFG.paths.lastGps, (val) => {
        state.gpsNode = val;
    });

    if (CFG.debug) window.__rpDebug = { map, state, listeners, render };

    // Một bộ đếm duy nhất để cập nhật "x giây trước" và phát hiện mất nhịp
    setInterval(render, 1000);
    render();
})();
