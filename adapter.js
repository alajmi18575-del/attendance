/* طبقة الربط: تسجيل الدخول + أدوار (مالك / مشرف حسب المواقع) + قاعدة بيانات Firebase.
   الصفحة الرئيسية تتعامل مع window.claude.use("db") كما هي، وهذا الملف يوفر لها نفس الواجهة فوق Firestore. */
(function () {
  "use strict";
  var C = window.APP_CONFIG || {};
  var configured = C.firebase && C.firebase.apiKey && !/PASTE/.test(C.firebase.apiKey) && C.adminEmail && !/PASTE/.test(C.adminEmail);
  window.APP_LIVE_CAM = true;

  var resolveApi;
  var ready = new Promise(function (r) { resolveApi = r; });
  window.claude = { use: function (n) { return ready.then(function (a) { return a[n] || null; }); } };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  var st = document.createElement("style");
  st.textContent =
    "#gate{position:fixed;inset:0;z-index:50;background:var(--bg);color:var(--ink);overflow:auto;padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) 28px max(16px,env(safe-area-inset-left))}" +
    "#gate .in{max-width:520px;margin:0 auto;display:flex;flex-direction:column;gap:12px}" +
    "#gate h1{margin:30px 0 0;font-size:22px}#gate h2{margin:0;font-size:16px}" +
    "#gate input[type=text],#gate input[type=email],#gate input[type=password]{width:100%}" +
    "#gate .chips{display:flex;flex-wrap:wrap;gap:6px}#gate .chip{background:var(--off);border-radius:99px;padding:2px 10px;font-size:12.5px}" +
    "#gate label.chk{display:flex;align-items:center;gap:8px;padding:6px 0}#gate label.chk input{width:18px;height:18px}" +
    "#gate .box{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:8px}" +
    ".hdrbtns{display:flex;gap:8px;align-items:center;flex-wrap:wrap}";
  document.head.appendChild(st);

  var gate = document.createElement("div");
  gate.id = "gate"; gate.setAttribute("dir", "rtl");
  document.body.appendChild(gate);
  function show(html) { gate.innerHTML = '<div class="in">' + html + "</div>"; gate.hidden = false; gate.style.display = "block"; }
  function hide() { gate.hidden = true; gate.style.display = "none"; gate.innerHTML = ""; }

  if (!configured) {
    show('<h1>حضور الوافدين</h1><div class="note">لم يتم إدخال إعدادات Firebase والبريد الخاص بالمالك بعد. افتح ملف config.js واتبع دليل التشغيل.</div>');
    return;
  }

  firebase.initializeApp(C.firebase);
  var auth = firebase.auth();
  var fs = firebase.firestore();
  try { fs.enablePersistence({ synchronizeTabs: true }).catch(function () {}); } catch (e) {}

  var ctx = { email: "", owner: false, sites: [], name: "" };
  var started = false;

  /* ---------- شاشة الدخول ---------- */
  function showLogin(msg) {
    show('<h1>حضور الوافدين</h1><p class="hint" style="margin:0">سجّل دخولك بحساب المشرف أو حساب المالك.</p>' +
      '<form id="lf" style="display:flex;flex-direction:column;gap:10px">' +
      '<input id="lEmail" type="email" placeholder="البريد الإلكتروني" dir="ltr" required autocomplete="username">' +
      '<input id="lPass" type="password" placeholder="كلمة المرور" dir="ltr" required autocomplete="current-password">' +
      '<button class="btn" type="submit">دخول</button></form>' +
      (msg ? '<div class="note">' + esc(msg) + "</div>" : ""));
    var f = document.getElementById("lf");
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = f.querySelector("button"); btn.disabled = true;
      auth.signInWithEmailAndPassword(document.getElementById("lEmail").value.trim(), document.getElementById("lPass").value)
        .catch(function () { showLogin("البريد أو كلمة المرور غير صحيحة."); });
    });
  }
  function showNoAccess(email) {
    show('<h1>لا توجد صلاحية</h1><div class="note">الحساب ' + esc(email) + ' غير مضاف كمشرف. تواصل مع المالك ليضيفك ويحدد موقعك.</div>' +
      '<button class="btn ghost" id="lo">تسجيل خروج</button>');
    document.getElementById("lo").onclick = function () { auth.signOut().then(function () { location.reload(); }); };
  }

  auth.onAuthStateChanged(function (u) {
    if (!u) { if (!started) showLogin(); return; }
    if (started) return;
    ctx.email = (u.email || "").toLowerCase();
    ctx.owner = ctx.email === String(C.adminEmail).toLowerCase();
    if (ctx.owner) { start(); return; }
    fs.collection("supervisors").doc(ctx.email).get().then(function (d) {
      if (!d.exists) { showNoAccess(ctx.email); return; }
      var x = d.data() || {};
      ctx.sites = Array.isArray(x.sites) ? x.sites : [];
      ctx.name = x.name || "";
      start();
    }).catch(function () { showLogin("تعذر التحقق من الصلاحية. تأكد من الاتصال وحاول مرة ثانية."); });
  });

  /* ---------- واجهة البيانات (نفس شكل db في الصفحة) ---------- */
  function snap(s) { return { id: s.id, exists: s.exists, data: function () { return s.data(); } }; }
  function qsWrap(docs) { return { docs: docs.map(snap), size: docs.length, empty: !docs.length }; }
  function flat(o, pre, out) {
    out = out || {};
    Object.keys(o).forEach(function (k) {
      var v = o[k], key = pre ? pre + "." + k : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out); else out[key] = v;
    });
    return out;
  }
  function docRef(ref) {
    return {
      id: ref.id, path: ref.path,
      get: function () { return ref.get().then(snap); },
      set: function (d) { return ref.set(d); },
      update: function (d) { return ref.update(flat(d)); },
      delete: function () { return ref.delete(); },
      onSnapshot: function (n, e) { return ref.onSnapshot(function (s) { n(snap(s)); }, e || function () {}); }
    };
  }
  var FILTERED = { people: 1, att: 1, excuses: 1 };
  function col(name, cs) {
    cs = cs || [];
    function queries() {
      var base = fs.collection(name), qs;
      if (!ctx.owner && FILTERED[name]) qs = ctx.sites.map(function (s) { return base.where("site", "==", s); });
      else qs = [base];
      return qs.map(function (q) { cs.forEach(function (c) { q = q.where(c[0], c[1], c[2]); }); return q; });
    }
    return {
      where: function (f, o, v) { return col(name, cs.concat([[f, o, v]])); },
      doc: function (id) { var c = fs.collection(name); return docRef(id ? c.doc(id) : c.doc()); },
      add: function (d) { return fs.collection(name).add(d).then(docRef); },
      get: function () {
        return Promise.all(queries().map(function (q) { return q.get(); })).then(function (rs) {
          return qsWrap(rs.reduce(function (a, r) { return a.concat(r.docs); }, []));
        });
      },
      onSnapshot: function (next, err) {
        var qs = queries();
        if (!qs.length) { setTimeout(function () { next(qsWrap([])); }, 0); return function () {}; }
        var results = [], seen = 0, flags = [];
        var unsubs = qs.map(function (q, i) {
          return q.onSnapshot(function (s) {
            results[i] = s.docs;
            if (!flags[i]) { flags[i] = 1; seen++; }
            if (seen === qs.length) next(qsWrap(results.reduce(function (a, r) { return a.concat(r); }, [])));
          }, err || function () {});
        });
        return function () { unsubs.forEach(function (u) { u(); }); };
      }
    };
  }
  var dbApi = { collection: function (n) { return col(n); }, doc: function (p) { return docRef(fs.doc(p)); } };

  /* ---------- حفظ الملفات ---------- */
  var MIME = { xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pdf: "application/pdf", csv: "text/csv;charset=utf-8", html: "text/html;charset=utf-8" };
  function fileModal(file, blob, name) {
    return new Promise(function (res) {
      var m = document.createElement("div");
      m.style.cssText = "position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.55);display:grid;place-items:center;padding:20px";
      m.innerHTML = '<div class="box" style="background:var(--surface);color:var(--ink);border-radius:14px;padding:18px;max-width:360px;width:100%;display:flex;flex-direction:column;gap:12px" dir="rtl"><b>الملف جاهز</b><div class="hint">' + esc(name) + '</div><button class="btn" id="fmGo">حفظ أو مشاركة الملف</button><button class="btn ghost" id="fmX">إغلاق</button></div>';
      document.body.appendChild(m);
      function close() { m.remove(); res({ status: "saved" }); }
      m.querySelector("#fmX").onclick = close;
      m.querySelector("#fmGo").onclick = function () {
        var p = (navigator.share && file) ? navigator.share({ files: [file] }) : Promise.reject({ name: "NoShare" });
        p.then(close).catch(function (e) { if (e && e.name === "AbortError") return; window.open(URL.createObjectURL(blob), "_blank"); });
      };
    });
  }
  var downloadsApi = {
    save: function (o) {
      var ext = (String(o.filename).split(".").pop() || "").toLowerCase();
      var type = MIME[ext] || "application/octet-stream";
      var blob = new Blob([o.data], { type: type });
      var file = null;
      try { file = new File([blob], o.filename, { type: type }); } catch (e) {}
      var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      if (ios && file && navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file] }).then(function () { return { status: "saved" }; }).catch(function (e) {
          if (e && e.name === "AbortError") throw { code: "declined" };
          return fileModal(file, blob, o.filename);
        });
      }
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = o.filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 8000);
      return Promise.resolve({ status: "saved" });
    }
  };
  var assetsApi = {
    upload: function (blob) {
      return new Promise(function (res, rej) {
        var r = new FileReader();
        r.onload = function () { res({ id: r.result, url: r.result, sizeBytes: blob.size, contentType: blob.type }); };
        r.onerror = rej; r.readAsDataURL(blob);
      });
    },
    delete: function () { return Promise.resolve(); }
  };
  var userApi = {
    canEdit: function () { return ctx.owner; },
    isOwner: function () { return ctx.owner; },
    can: function () { return true; },
    id: function () { return Promise.resolve(ctx.email); }
  };

  function start() {
    started = true;
    hide();
    var top = document.querySelector(".top");
    if (top) {
      var box = document.createElement("div");
      box.className = "hdrbtns";
      box.innerHTML = '<span class="date">' + (ctx.owner ? "المالك" : esc(ctx.name || ctx.email) + " · " + ctx.sites.map(esc).join("، ")) + "</span>" +
        (ctx.owner ? '<button type="button" class="btn small ghost" id="supBtn">المشرفون</button>' : "") +
        '<button type="button" class="btn small ghost" id="outBtn">خروج</button>';
      top.appendChild(box);
      document.getElementById("outBtn").onclick = function () { auth.signOut().then(function () { location.reload(); }); };
      if (ctx.owner) document.getElementById("supBtn").onclick = openSup;
    }
    resolveApi({ db: dbApi, user: userApi, downloads: downloadsApi, assets: assetsApi });
  }

  /* ---------- إدارة المشرفين (للمالك فقط) ---------- */
  var sup = { list: [], sites: [], form: null, msg: "", unsub: null };
  function openSup() {
    sup.form = { email: "", name: "", pass: "", sites: [], edit: false };
    sup.msg = "";
    fs.collection("people").get().then(function (s) {
      var o = {}; s.docs.forEach(function (d) { var x = d.data(); if (x.site) o[x.site] = 1; });
      sup.sites = Object.keys(o).sort(function (a, b) { return a.localeCompare(b, "ar"); });
      drawSup();
    });
    if (sup.unsub) sup.unsub();
    sup.unsub = fs.collection("supervisors").onSnapshot(function (s) {
      sup.list = s.docs.map(function (d) { var x = d.data(); x.id = d.id; return x; });
      drawSup();
    }, function () { sup.msg = "تعذر تحميل المشرفين."; drawSup(); });
    drawSup();
  }
  function drawSup() {
    var f = sup.form;
    var rows = sup.list.length ? sup.list.map(function (s) {
      return '<div class="box"><div><b>' + esc(s.name || s.email) + '</b> <span class="mono">' + esc(s.email) + '</span></div>' +
        '<div class="chips">' + (s.sites || []).map(function (x) { return '<span class="chip">' + esc(x) + "</span>"; }).join("") + (s.sites && s.sites.length ? "" : '<span class="hint">بدون مواقع</span>') + "</div>" +
        '<div class="hdrbtns"><button type="button" class="btn small ghost" data-s="edit" data-id="' + esc(s.id) + '">تعديل المواقع</button>' +
        '<button type="button" class="btn small ghost" data-s="reset" data-id="' + esc(s.id) + '">إرسال رابط كلمة المرور</button>' +
        '<button type="button" class="btn small danger" data-s="del" data-id="' + esc(s.id) + '">' + (sup.confirm === s.id ? "تأكيد الإزالة" : "إزالة") + "</button></div></div>";
    }).join("") : '<div class="hint">ما فيه مشرفين بعد.</div>';
    var checks = sup.sites.length ? sup.sites.map(function (x) {
      return '<label class="chk"><input type="checkbox" data-site="' + esc(x) + '"' + (f.sites.indexOf(x) >= 0 ? " checked" : "") + "> " + esc(x) + "</label>";
    }).join("") : '<div class="hint">أضف الوافدين أولاً حتى تظهر المواقع هنا.</div>';
    show('<div class="hdrbtns" style="justify-content:space-between"><h1 style="margin:0">المشرفون</h1><button type="button" class="btn ghost" data-s="close">رجوع</button></div>' +
      '<p class="hint" style="margin:0">كل مشرف يرى ويسجّل حضور المواقع المحددة له فقط. أنت ترى كل المواقع.</p>' + rows +
      '<form id="sf" class="box" autocomplete="off"><h2>' + (f.edit ? "تعديل مواقع المشرف" : "إضافة مشرف") + "</h2>" +
      '<input id="sName" type="text" placeholder="اسم المشرف" value="' + esc(f.name) + '">' +
      '<input id="sEmail" type="email" dir="ltr" placeholder="البريد الإلكتروني" value="' + esc(f.email) + '"' + (f.edit ? " readonly" : "") + " required>" +
      (f.edit ? "" : '<input id="sPass" type="password" dir="ltr" placeholder="كلمة مرور (٦ خانات على الأقل)" value="' + esc(f.pass) + '" required>') +
      '<div><b style="font-size:13px">المواقع المسموحة</b>' + checks + "</div>" +
      '<button class="btn" type="submit">' + (f.edit ? "حفظ" : "إضافة المشرف") + "</button>" +
      (f.edit ? '<button type="button" class="btn ghost" data-s="cancel">إلغاء التعديل</button>' : "") +
      '<div class="hint" role="status">' + esc(sup.msg) + "</div></form>");
    gate.scrollTop = gate.scrollTop;
  }
  gate.addEventListener("input", function (e) {
    var f = sup.form; if (!f) return;
    if (e.target.id === "sName") f.name = e.target.value;
    else if (e.target.id === "sEmail") f.email = e.target.value;
    else if (e.target.id === "sPass") f.pass = e.target.value;
  });
  gate.addEventListener("change", function (e) {
    var s = e.target.getAttribute && e.target.getAttribute("data-site");
    if (s == null || !sup.form) return;
    var i = sup.form.sites.indexOf(s);
    if (e.target.checked && i < 0) sup.form.sites.push(s);
    if (!e.target.checked && i >= 0) sup.form.sites.splice(i, 1);
  });
  gate.addEventListener("click", function (e) {
    var b = e.target.closest("[data-s]"); if (!b) return;
    var a = b.getAttribute("data-s"), id = b.getAttribute("data-id");
    if (a === "close") { if (sup.unsub) { sup.unsub(); sup.unsub = null; } hide(); return; }
    if (a === "cancel") { sup.form = { email: "", name: "", pass: "", sites: [], edit: false }; sup.msg = ""; drawSup(); return; }
    var item = sup.list.filter(function (x) { return x.id === id; })[0];
    if (a === "edit" && item) { sup.form = { email: item.email || item.id, name: item.name || "", pass: "", sites: (item.sites || []).slice(), edit: true }; sup.msg = ""; drawSup(); return; }
    if (a === "reset" && item) {
      auth.sendPasswordResetEmail(item.email || item.id).then(function () { sup.msg = "أُرسل رابط تعيين كلمة المرور إلى " + item.email; drawSup(); }).catch(function () { sup.msg = "تعذر إرسال الرابط."; drawSup(); });
      return;
    }
    if (a === "del" && item) {
      if (sup.confirm !== id) { sup.confirm = id; drawSup(); return; }
      sup.confirm = "";
      fs.collection("supervisors").doc(id).delete().then(function () { sup.msg = "تمت إزالة صلاحية المشرف."; drawSup(); }).catch(function () { sup.msg = "تعذرت الإزالة."; drawSup(); });
    }
  });
  gate.addEventListener("submit", function (e) {
    if (e.target.id !== "sf") return;
    e.preventDefault();
    var f = sup.form, email = (f.email || "").trim().toLowerCase();
    if (!email) { sup.msg = "اكتب البريد."; drawSup(); return; }
    if (!f.sites.length) { sup.msg = "اختر موقعًا واحدًا على الأقل."; drawSup(); return; }
    var data = { email: email, name: (f.name || "").trim(), sites: f.sites.slice() };
    function saveDoc(note) {
      fs.collection("supervisors").doc(email).set(data).then(function () {
        sup.form = { email: "", name: "", pass: "", sites: [], edit: false };
        sup.msg = note || "تم الحفظ."; drawSup();
      }).catch(function () { sup.msg = "ما انحفظ. حاول مرة ثانية."; drawSup(); });
    }
    if (f.edit) { saveDoc(); return; }
    if ((f.pass || "").length < 6) { sup.msg = "كلمة المرور أقل من ٦ خانات."; drawSup(); return; }
    var secApp = firebase.apps.filter(function (a) { return a.name === "sec"; })[0] || firebase.initializeApp(C.firebase, "sec");
    secApp.auth().createUserWithEmailAndPassword(email, f.pass).then(function () {
      return secApp.auth().signOut();
    }).then(function () { saveDoc("تمت إضافة المشرف. أعطه البريد وكلمة المرور."); })
      .catch(function (err) {
        if (err && err.code === "auth/email-already-in-use") saveDoc("الحساب موجود مسبقًا. تم ربطه بالمواقع. استخدم «إرسال رابط كلمة المرور» إذا نسي كلمته.");
        else { sup.msg = (err && err.code === "auth/invalid-email") ? "البريد غير صحيح." : "ما انضاف الحساب. تأكد أن تسجيل الدخول بالبريد مفعّل في Firebase."; drawSup(); }
      });
  });
})();
