// -------------------------------------------------------------
// ỨNG DỤNG GIÁM SÁT – kết nối Firebase, bản đồ và hiển thị
// Chỉ ĐỌC dữ liệu Firebase; trang không ghi gì lên máy chủ.
// -------------------------------------------------------------
(function () {
    "use strict";

    const CFG = window.APP_CONFIG;
    const S = window.RescueStatus;
    const $ = (id) => document.getElementById(id);

    const STORAGE_POS = "rp_last_valid_pos";
    const STORAGE_SOS = "rp_sos_latch";

    // Đọc/ghi localStorage an toàn (có thể bị chặn ở chế độ ẩn danh)
    function loadJSON(key) {
        try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
    }
    function saveJSON(key, value) {
        try {
            if (value === null) localStorage.removeItem(key);
            else localStorage.setItem(key, JSON.stringify(value));
        } catch (e) { /* bỏ qua */ }
    }

    const state = {
        startedAt: Date.now(),
        monitoringLoaded: false,
        parsed: null,
        connection: undefined,        // undefined = chưa tải, null = không có node
        clientConnected: false,
        everConnected: false,
        serverOffset: 0,
        lastGpsNode: null,
        lastValidPos: loadJSON(STORAGE_POS),   // { lat, lng, at }
        sosLatch: loadJSON(STORAGE_SOS),       // { since }
        error: null,
        userMovedMap: false,
        hasCentered: false
    };
    const heartbeat = new S.HeartbeatTracker(CFG.heartbeatTimeoutMs);

    // ---------------- Định dạng ----------------
    function fmtTime(ms) {
        const d = new Date(ms);
        const pad = (n) => String(n).padStart(2, "0");
        return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()) + " " + pad(d.getDate()) + "/" + pad(d.getMonth() + 1);
    }
    function fmtAgo(ms) {
        const s = Math.max(0, Math.round(ms / 1000));
        if (s < 60) return s + " giây trước";
        if (s < 3600) return Math.floor(s / 60) + " phút trước";
        if (s < 86400) return Math.floor(s / 3600) + " giờ trước";
        return Math.floor(s / 86400) + " ngày trước";
    }
    function setText(id, text, cls) {
        const el = $(id);
        if (el.textContent !== text) el.textContent = text;
        if (cls !== undefined) el.className = cls;
    }

    // ---------------- Bản đồ ----------------
    const map = L.map("map").setView(CFG.defaultMapCenter, CFG.defaultMapZoom);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap"
    }).addTo(map);

    // Marker chỉ được tạo khi có tọa độ hợp lệ (không đặt marker giả ở vị trí mặc định)
    let marker = null;
    let markerClass = "";
    const popupEl = document.createElement("div");

    map.on("dragstart", () => {
        state.userMovedMap = true;
        $("map-recenter").hidden = !marker;
    });
    $("map-recenter").addEventListener("click", () => {
        state.userMovedMap = false;
        $("map-recenter").hidden = true;
        if (marker) map.setView(marker.getLatLng(), Math.max(map.getZoom(), 15));
    });

    function markerIcon(code) {
        const cls = code === "SOS" ? "m-sos" : code === "DANGER" ? "m-danger" : code === "WARNING" ? "m-warning" : code === "SAFE" ? "m-safe" : "m-gray";
        const icon = code === "SOS" ? "fa-bell" : "fa-tower-broadcast";
        return { cls, icon: L.divIcon({ className: "", html: '<div class="dev-marker ' + cls + '"><i class="fa-solid ' + icon + '"></i></div>', iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -14] }) };
    }

    // Chọn vị trí hiển thị: GPS trực tiếp → vị trí hợp lệ cuối (trình duyệt này) → node /gps → không có
    function pickPosition(fresh) {
        const p = state.parsed;
        if (p && p.exists && p.gps.valid) {
            return { lat: p.lat, lng: p.lng, live: fresh, label: fresh ? "GPS thiết bị (trực tiếp)" : "GPS thiết bị – dữ liệu cũ" };
        }
        if (state.lastValidPos) {
            return { lat: state.lastValidPos.lat, lng: state.lastValidPos.lng, live: false, label: "Vị trí cuối lúc " + fmtTime(state.lastValidPos.at) + " (đã cũ)" };
        }
        const g = state.lastGpsNode;
        if (g) {
            const lat = S.toNumber(g.lat), lng = S.toNumber(g.lng);
            if (S.validateGps(lat, lng, true).valid) {
                return { lat, lng, live: false, label: "Vị trí lưu trên máy chủ (/gps) – không rõ thời điểm" };
            }
        }
        return null;
    }

    function renderMap(status, fresh) {
        const pos = pickPosition(fresh);
        const note = $("map-note");
        const link = $("gmaps-link");

        if (!pos) {
            if (marker) { map.removeLayer(marker); marker = null; markerClass = ""; }
            note.hidden = false;
            setText("map-note", "Chưa có tọa độ GPS hợp lệ – chưa hiển thị vị trí thiết bị.");
            link.setAttribute("aria-disabled", "true");
            link.removeAttribute("href");
            setText("gps-source", "Chưa có", "c-muted");
            return;
        }

        const latlng = [pos.lat, pos.lng];
        const ic = markerIcon(status.code);
        if (!marker) {
            marker = L.marker(latlng, { icon: ic.icon, keyboard: true, title: "Trạm cảnh báo lũ" }).addTo(map).bindPopup(popupEl);
            markerClass = ic.cls;
        } else {
            marker.setLatLng(latlng);
            if (ic.cls !== markerClass) { marker.setIcon(ic.icon); markerClass = ic.cls; }
        }
        if (!state.hasCentered || !state.userMovedMap) {
            const cur = map.getCenter();
            if (!state.hasCentered) map.setView(latlng, 16);
            else if (Math.abs(cur.lat - pos.lat) > 1e-6 || Math.abs(cur.lng - pos.lng) > 1e-6) map.panTo(latlng);
            state.hasCentered = true;
        }

        // Popup dựng bằng textContent để tránh chèn mã từ dữ liệu
        const p = state.parsed;
        const lines = [
            ["b", "Trạm Cảnh Báo Lũ"],
            ["", "Trạng thái: " + status.label],
            ["", "Mực nước: " + (p && p.waterLevel !== null && p.waterLevel !== undefined ? "Mức " + p.waterLevel : "--")],
            ["", "Vị trí: " + pos.label],
            ["", "Tọa độ: " + pos.lat.toFixed(6) + ", " + pos.lng.toFixed(6)]
        ];
        if (status.code === "SOS") lines.push(["sos", "[ĐANG YÊU CẦU CỨU HỘ!]"]);
        popupEl.textContent = "";
        lines.forEach(([kind, text], i) => {
            const el = document.createElement(kind === "b" ? "b" : "span");
            el.textContent = text;
            if (kind === "sos") { el.style.color = "#c62828"; el.style.fontWeight = "bold"; }
            if (i) popupEl.appendChild(document.createElement("br"));
            popupEl.appendChild(el);
        });

        note.hidden = pos.live;
        if (!pos.live) setText("map-note", "Lưu ý: " + pos.label + ".");
        link.href = "https://www.google.com/maps/dir/?api=1&destination=" + pos.lat + "," + pos.lng;
        link.setAttribute("aria-disabled", "false");
        setText("gps-source", pos.label, pos.live ? "c-ok" : "c-warn");
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

    function render() {
        const now = Date.now();
        const hb = heartbeat.state(now, now + state.serverOffset);
        const clientOnline = state.clientConnected;
        const fresh = hb.state === "fresh" && clientOnline;

        // Thanh báo mất mạng: chỉ hiện sau khi đã từng kết nối, hoặc quá 8 giây vẫn chưa kết nối được
        $("net-banner").hidden = clientOnline || (!state.everConnected && now - state.startedAt < 8000);

        let status;
        if (state.error) {
            status = { code: "NO_DATA", label: "KHÔNG ĐỌC ĐƯỢC DỮ LIỆU", detail: state.error };
        } else if (!state.monitoringLoaded) {
            status = { code: "LOADING", label: "ĐANG TẢI DỮ LIỆU...", detail: "Chưa xác minh – không hiển thị \"An toàn\" khi chưa có dữ liệu." };
        } else {
            status = S.classify({
                parsed: state.parsed,
                connection: state.connection,
                heartbeat: hb.state,
                clientOnline: clientOnline,
                sosLatch: !!state.sosLatch
            }, CFG);
        }

        const view = STATUS_VIEW[status.code];
        $("status-card").className = "status-box " + view[0];
        $("status-icon").className = "fa-solid " + view[1];
        setText("status-text", status.label);
        setText("status-detail", status.detail);
        $("sos-ack-btn").hidden = status.code !== "SOS_CLEARED";
        const title = "Hệ Thống Giám Sát Cảnh Báo Lũ Lụt & Cứu Hộ";
        document.title = status.code === "SOS" ? "🚨 SOS – " + title : title;

        // Kết nối LoRa (giá trị do trạm thu ghi lên Firebase)
        const c = state.connection;
        if (c === undefined) setText("connection-status", "ĐANG TẢI...", "c-muted");
        else if (c === "CONNECT") setText("connection-status", "ĐÃ KẾT NỐI (ONLINE)", "c-ok");
        else if (c === "DISCONNECT") setText("connection-status", "MẤT KẾT NỐI (OFFLINE)", "c-bad");
        else if (c === null) setText("connection-status", "KHÔNG CÓ DỮ LIỆU", "c-muted");
        else setText("connection-status", "KHÔNG RÕ (" + String(c) + ")", "c-warn");

        // Heartbeat
        const hbView = {
            none: ["Chưa có dữ liệu", "c-muted"],
            verifying: ["Đang xác minh (chờ gói mới)", "c-warn"],
            fresh: ["Bình thường", "c-ok"],
            stale: ["Mất nhịp > " + Math.round(CFG.heartbeatTimeoutMs / 1000) + " giây", "c-bad"]
        }[hb.state];
        setText("heartbeat-status", hbView[0], hbView[1]);
        if (heartbeat.lastChangeAt) setText("last-seen", fmtTime(heartbeat.lastChangeAt) + " (" + fmtAgo(now - heartbeat.lastChangeAt) + ")");
        else if (hb.ageMs !== null) setText("last-seen", fmtAgo(hb.ageMs));
        else setText("last-seen", state.monitoringLoaded ? "Chưa có gói mới từ khi mở trang" : "--");

        // Mực nước
        const p = state.parsed;
        const hasLevel = p && p.exists && p.waterLevel !== null;
        setText("water-level", hasLevel ? "MỨC " + p.waterLevel : "MỨC --");
        $("water-level").classList.toggle("is-stale", !fresh);
        let note = "Ngưỡng: Mức " + CFG.waterLevel.warning + " Cảnh báo | Mức " + CFG.waterLevel.danger + " Nguy hiểm";
        if (p && p.exists && !hasLevel) note = "Giá trị mực nước không hợp lệ: " + String(p.waterLevelRaw);
        else if (hasLevel && !fresh) note += " – (dữ liệu chưa xác minh/đã cũ)";
        setText("water-note", note);
        setText("device-status-text", p && p.statusText ? p.statusText : "--");

        // GPS
        if (p && p.exists) {
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
    }

    $("sos-ack-btn").addEventListener("click", () => {
        if (!confirm("Xác nhận đã kiểm tra thực tế và bỏ cảnh báo SOS trên trình duyệt này?")) return;
        state.sosLatch = null;
        saveJSON(STORAGE_SOS, null);
        render();
    });

    // ---------------- Firebase (chỉ đọc) ----------------
    firebase.initializeApp(CFG.firebase);
    const database = firebase.database();

    function onError(path) {
        return (err) => {
            state.error = "Lỗi đọc " + path + ": " + (err && err.code === "PERMISSION_DENIED" ? "không có quyền truy cập" : (err && err.message) || "không xác định");
            console.error(state.error, err);
            render();
        };
    }

    database.ref(".info/connected").on("value", (snap) => {
        state.clientConnected = snap.val() === true;
        if (state.clientConnected) state.everConnected = true;
        render();
    });
    database.ref(".info/serverTimeOffset").on("value", (snap) => {
        state.serverOffset = S.toNumber(snap.val()) || 0;
    });

    database.ref(CFG.paths.monitoring).on("value", (snapshot) => {
        state.error = null;
        state.monitoringLoaded = true;
        state.parsed = S.parseMonitoring(snapshot.val(), CFG);
        heartbeat.observe(state.parsed, Date.now());

        const p = state.parsed;
        // Ghi nhớ vị trí hợp lệ cuối cùng (chỉ khi dữ liệu thực sự mới)
        if (p.exists && p.gps.valid && heartbeat.state(Date.now(), Date.now() + state.serverOffset).state === "fresh") {
            state.lastValidPos = { lat: p.lat, lng: p.lng, at: Date.now() };
            saveJSON(STORAGE_POS, state.lastValidPos);
        }
        // Chốt SOS: chỉ người trực mới bỏ được, hệ thống không tự chuyển về an toàn
        if (p.exists && p.sos === true && !state.sosLatch) {
            state.sosLatch = { since: Date.now() };
            saveJSON(STORAGE_SOS, state.sosLatch);
        }
        render();
    }, onError(CFG.paths.monitoring));

    database.ref(CFG.paths.connection).on("value", (snapshot) => {
        state.connection = snapshot.val();
        render();
    }, onError(CFG.paths.connection));

    database.ref(CFG.paths.lastGps).on("value", (snapshot) => {
        state.lastGpsNode = snapshot.val();
        render();
    }, (err) => console.warn("Không đọc được " + CFG.paths.lastGps, err));

    // Một bộ đếm duy nhất để cập nhật "x giây trước" và phát hiện mất nhịp
    setInterval(render, 1000);
    render();
})();
