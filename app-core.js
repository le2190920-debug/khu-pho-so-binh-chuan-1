/* ==========================================================================
   app-core.js - Lop nen chung cho app Khu pho so phuong An Phu
   --------------------------------------------------------------------------
   Muc dich: trang nao cung "chay duoc" va "khong bao gio trang trang".
   Viet theo ES5 de chay tren Android cu + WebView cu cua nguoi dan.

   Van de can giai quyet:
   1. fetch() ma khong check res.ok -> 404 tra ve HTML, r.json() nem loi
      "Unexpected token <" -> nguoi dung thay bang "Loi tai du lieu: SyntaxError".
   2. Mot trong nhieu file JSON/GeoJSON hong -> Promise.all() lam mat trong cai.
   3. Leaflet tu CDN bi chan (mang cham / offline / bi firewalled) ->
      window.L = undefined, map im lang khong bao loi gi.
   4. Doc truc tiep D.totals / D.kps / k.area_km2.toFixed() -> nem loi neu
      file thieu truong, ca trang mat trang.
   5. Khong co duong quay lai gi khi du lieu hong.
   ========================================================================== */
(function (global) {
  'use strict';

  var RETRY = 2;          /* so lan thu lai */
  var TIMEOUT = 12000;    /* ms, truoc khi bo cuoc tai */

  /* ---------- tien ich nho ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  /* Ep ve so hop le, tra null neu khong phai so. Dung thay cho .toFixed() truc tiep. */
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  /* Dinh dang toa do an toan. */
  function coord(v, d) {
    var n = num(v);
    return n === null ? null : n.toFixed(d == null ? 5 : d);
  }

  /* Doc mot truong, thieu thi tra gia tri mac dinh. Khong bao gio nem loi. */
  function field(obj, name, dflt) {
    if (!obj) return dflt;
    var v = obj[name];
    return (v === undefined || v === null) ? dflt : v;
  }

  /* Lay so lieu chinh xac tu kp.json, co so sanh khi thieu. */
  function totals(kp) {
    var t = (kp && kp.totals) || {};
    return {
      so_kp: num(field(t, 'so_kp', 14)),
      tong_dn: num(field(t, 'tong_dn', null)),
      tong_dn_gps: num(field(t, 'tong_dn_gps', null)),
      tong_dn_khong_gps: num(field(t, 'tong_dn_khong_gps', null)),
      phuong_dien_tich_ha: num(field(t, 'phuong_dien_tich_ha', null))
    };
  }

  /* ---------- tai JSON / GeoJSON co kiem tra ---------- */
  function fetchOnce(path, ms) {
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var opt = { cache: 'no-store' };
    if (ctrl) opt.signal = ctrl.signal;

    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms || TIMEOUT);

    return fetch(path, opt).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) {
        var e = new Error('HTTP ' + res.status + ' ' + (res.statusText || ''));
        e.httpStatus = res.status;
        throw e;
      }
      return res.text();
    }, function (err) {
      clearTimeout(timer);
      throw err;
    }).then(function (txt) {
      try { return JSON.parse(txt); }
      catch (p) {
        throw new Error('File "' + path + '" ton tai nhung KHONG phai JSON hop le (' +
          (txt.slice(0, 40) + '...') + ')');
      }
    });
  }

  /* Tai JSON. Thu lai RETRY lan. Loi co thong diep tieng Viet ro rang. */
  function json(path, ms) {
    var tries = 0;
    function attempt() {
      return fetchOnce(path, ms).catch(function (err) {
        tries++;
        var aborted = (err && err.name === 'AbortError');
        var http = err && err.httpStatus;
        /* 404/403/410 - thu lai vo ich */
        if (http === 404 || http === 403 || http === 410) throw describe(path, err, tries);
        if (tries > RETRY) throw describe(path, err, tries);
        return new Promise(function (ok) { setTimeout(ok, 400 * tries); }).then(attempt);
      });
    }
    return attempt();
  }

  function describe(path, err, tries) {
    var why;
    if (err && err.name === 'AbortError') why = ' qua thoi gian cho (' + (TIMEOUT / 1000) + 's)';
    else if (err && err.httpStatus === 404) why = ' khong tim thay file (404)';
    else if (err && err.httpStatus) why = ' loi may chu HTTP ' + err.httpStatus;
    else why = ' loi mang hoac trinh duyet: ' + ((err && err.message) || 'khong ro');
    var e = new Error('Khong tai duoc "' + path + '"' + why +
      (tries > 1 ? ' (da thu ' + tries + ' lan)' : ''));
    e.cause = err;
    return e;
  }

  /* ---------- hien loi ra man hinh (khong bao gio de trang trang) ---------- */
  function box(msg, kind) {
    var color = (kind === 'warn') ? '#fbbf24' : '#fb7185';
    var bg = (kind === 'warn') ? 'rgba(251,191,36,.09)' : 'rgba(251,113,133,.09)';
    return '<div style="border-left:3px solid ' + color + ';background:' + bg +
      ';border-radius:10px;padding:11px 13px;font-size:13px;color:var(--tx)">' + msg + '</div>';
  }

  /* Loi chan man hinh: co ten file, co huong dan, co duong quay lai. */
  function fatal(msg, err) {
    var old = document.getElementById('anphuFatal');
    if (old) old.parentNode.removeChild(old);
    var d = document.createElement('div');
    d.id = 'anphuFatal';
    d.style.margin = '0 0 12px';
    d.innerHTML = box(
      '<b>Khong tai duoc du lieu.</b><br>' + esc(msg) +
      '<br><small style="color:var(--mut)">Trang van con dung, chi la phan du lieu bi thieu. ' +
      'Thu lai / kiem tra ket noi mang. Neu la tai ghp, ban co the tai lai du lieu o may chu.</small>' +
      '<br><a href="index.html" style="display:inline-block;margin-top:7px">&larr; Ve trang chu</a>',
      'err');
    var host = document.querySelector('main') || document.body;
    if (host.firstChild) host.insertBefore(d, host.firstChild);
    else host.appendChild(d);
    if (err && global.console) console.error('[AnPhu]', msg, err);
  }

  /* Canh bao nhe (khong lam trang chet) */
  function warn(html, id) {
    var old = id ? document.getElementById(id) : null;
    if (old) old.parentNode.removeChild(old);
    var d = document.createElement('div');
    if (id) d.id = id;
    d.style.margin = '0 0 8px';
    d.innerHTML = box(html, 'warn');
    var host = document.querySelector('main') || document.body;
    if (host.firstChild) host.insertBefore(d, host.firstChild);
    else host.appendChild(d);
    return d;
  }

  /* ---------- Leaflet ---------- */
  /* Tra ve true neu dung duoc. Sai thi hien canh bao ro (khong im lang). */
  function needLeaflet(elId) {
    if (global.L) return true;
    var boxEl = document.getElementById(elId);
    var msg = '<b>Ban do khong tai duoc.</b> Thu vien Leaflet (unpkg.com) khong phai toi ' +
      'hoac bi chan. Phan con lai cua trang van dung.<br>' +
      '<small style="color:var(--mut)">Kiem tra ket noi mang / thu doi mang. ' +
      'Ban do nen can Internet; cac bao cao van xem duoc.</small>';
    if (boxEl) {
      boxEl.innerHTML = '<div style="padding:14px;font-size:13px">' + msg + '</div>';
      boxEl.style.background = 'transparent';
    }
    warn(msg, 'anphuLeaflet');
    return false;
  }

  /* ---------- thanh dieu huong chung (luon co, ke ca khi du lieu hong) ---------- */
  var NAV = [
    { href: 'index.html', label: 'Trang chu' },
    { href: 'dashboard.html', label: 'Bản đồ 14 KP' },
    { href: 'danh-sach-bc1.html', label: 'DN & nhà trọ KPBC1' }
  ];

  function nav(active) {
    if (document.getElementById('anphuNav')) return;
    var links = NAV.map(function (n) {
      var on = (n.href === active);
      return '<a href="' + n.href + '"' + (on ? ' aria-current="page"' : '') +
        ' style="font-size:12px;padding:5px 11px;border-radius:99px;text-decoration:none;' +
        'border:1px solid ' + (on ? 'var(--cy)' : 'var(--line)') + ';' +
        'background:' + (on ? 'rgba(34,211,238,.14)' : 'transparent') + ';' +
        'color:' + (on ? '#fff' : 'var(--mut)') + '">' + esc(n.label) + '</a>';
    }).join('');

    var h = document.createElement('div');
    h.id = 'anphuNav';
    h.style.cssText = 'display:flex;gap:7px;flex-wrap:wrap;align-items:center;' +
      'padding:9px 18px;border-bottom:1px solid var(--line);background:#071129';
    h.innerHTML = '<span style="font-size:11px;color:var(--mut);letter-spacing:1px;' +
      'margin-right:5px">ĐIỀU HƯỚNG</span>' + links;
    var hd = document.querySelector('header');
    if (hd && hd.parentNode) hd.parentNode.insertBefore(h, hd);
    else document.body.insertBefore(h, document.body.firstChild);
  }

  /* ---------- GeoJSON -> vòng toa do cho Leaflet ---------- */
  /* Chấp nhận Polygon, MultiPolygon, và GeometryCollection. Luôn trả mảng hợp lệ. */
  function rings(geom) {
    var out = [];
    if (!geom) return out;
    var list = (geom.type === 'GeometryCollection') ? (geom.geometries || []) : [geom];
    for (var i = 0; i < list.length; i++) {
      var g = list[i], c = g && g.coordinates, j, r, ring;
      if (!c) continue;
      if (g.type === 'MultiPolygon') {
        for (j = 0; j < c.length; j++) { ring = flip(c[j]); if (ring.length) out.push(ring); }
      } else if (g.type === 'Polygon') {
        ring = flip(c); if (ring.length) out.push(ring);
      }
    }
    return out;
  }
  function ring(poly) {
    var r = [], i;
    for (i = 0; i < poly.length; i++) {
      var p = poly[i];
      if (p && p.length >= 2) r.push([Number(p[1]), Number(p[0])]);  /* GeoJSON x,y -> lat,lng */
    }
    return r;
  }
  function flip(poly) { return (poly && poly.length) ? ring(poly[0]) : []; }

  /* ---------- bat loi toan cuc: mot trang, mot loi ---------- */
  function guard(fn, label) {
    return function () {
      try { return fn.apply(this, arguments); }
      catch (err) { fatal('Loi khi hien thi du lieu' + (label ? ' (' + label + ')' : '') + '.', err); }
    };
  }

  global.ANPHU = {
    esc: esc, num: num, coord: coord, field: field, totals: totals,
    json: json, fatal: fatal, warn: warn, needLeaflet: needLeaflet,
    nav: nav, rings: rings, guard: guard,
    version: '1.0'
  };
})(window);