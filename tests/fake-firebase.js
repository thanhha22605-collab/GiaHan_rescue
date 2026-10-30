// Firebase GIẢ LẬP – chỉ dùng cho tests/browser-tests.html, không bao giờ được nạp ở trang thật.
// Mô phỏng API v8 tối thiểu mà js/app.js dùng: initializeApp, database().ref(path).on/off.
(function () {
    "use strict";
    const values = {};
    const subs = {};
    let onCount = 0, offCount = 0;
    const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
    const snap = (v) => ({ val: () => clone(v) });

    function ref(path) {
        return {
            on(evt, cb, err) {
                (subs[path] = subs[path] || []).push({ cb, err });
                onCount++;
                // Giống Firebase: listener mới nhận giá trị hiện tại (bất đồng bộ)
                if (Object.prototype.hasOwnProperty.call(values, path)) {
                    setTimeout(() => { if ((subs[path] || []).some((s) => s.cb === cb)) cb(snap(values[path])); }, 0);
                }
                return cb;
            },
            off(evt, cb) {
                const a = subs[path] || [];
                const i = a.findIndex((s) => s.cb === cb);
                if (i >= 0) { a.splice(i, 1); offCount++; }
            }
        };
    }

    window.__fb = {
        // Ghi giá trị và phát sự kiện "value" cho mọi listener của node
        set(path, v) {
            values[path] = v;
            (subs[path] || []).slice().forEach((s) => s.cb(snap(v)));
        },
        // Mô phỏng lỗi (vd. PERMISSION_DENIED): Firebase gọi callback lỗi rồi hủy listener
        fail(path, code) {
            const a = (subs[path] || []).slice();
            subs[path] = [];
            a.forEach((s) => s.err && s.err({ code: code, message: code }));
        },
        count() { return Object.keys(subs).reduce((n, k) => n + subs[k].length, 0); },
        countFor(path) { return (subs[path] || []).length; },
        stats() { return { onCount, offCount }; }
    };
    window.firebase = { initializeApp() {}, database() { return { ref }; } };
})();
