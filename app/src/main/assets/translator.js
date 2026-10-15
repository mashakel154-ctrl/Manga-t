(function () {
  if (window.MT) return;
  var seq = 0, visible = true, entries = [];
  var BATCH = 5;

  function srcOf(i) { return i.currentSrc || i.src || ''; }

  function usable(i, strict) {
    var u = srcOf(i);
    if (!/^(https?:|blob:|data:)/i.test(u)) return false;
    if (!i.complete || i.naturalWidth < 300 || i.naturalHeight < 300) return false;
    if (strict && (i.naturalWidth < 500 || i.naturalHeight < 700)) return false;
    return i.getBoundingClientRect().width >= 200;
  }

  function isDone(i) { return !!i.dataset.mtId && i.dataset.mtSrc === srcOf(i); }

  function failedTwice(i) { return i.dataset.mtFailSrc === srcOf(i) && +i.dataset.mtFails >= 2; }

  function mark(i, id, u) { i.dataset.mtId = id; i.dataset.mtSrc = u; }

  function dist(i) {
    var r = i.getBoundingClientRect();
    if (r.bottom < 0) return -r.bottom;
    if (r.top > window.innerHeight) return r.top - window.innerHeight;
    return 0;
  }

  function cleanup() {
    entries = entries.filter(function (e) {
      var r = e.img.isConnected ? e.img.getBoundingClientRect() : null;
      var alive = !!r && r.width >= 50 && srcOf(e.img) === e.src;
      if (!alive) {
        e.els.forEach(function (d) { d.remove(); });
        if (e.img.dataset.mtSrc === e.src) {
          delete e.img.dataset.mtId;
          delete e.img.dataset.mtSrc;
        }
      }
      return alive;
    });
  }

  function collect(maxScreens, limit) {
    maxScreens = maxScreens || 0;
    var strict = maxScreens > 0;
    var list = Array.prototype.filter.call(document.images, function (i) {
      if (!usable(i, strict) || isDone(i)) return false;
      if (strict && (failedTwice(i) || dist(i) > window.innerHeight * maxScreens)) return false;
      return true;
    });
    list.sort(function (a, b) {
      return dist(a) - dist(b) || a.getBoundingClientRect().top - b.getBoundingClientRect().top;
    });
    list = list.slice(0, limit || BATCH);
    var out = [];
    list.forEach(function (i) {
      var id = String(++seq), u = srcOf(i);
      if (/^https?:/i.test(u)) {
        mark(i, id, u);
        out.push({ id: id, url: u });
        return;
      }
      try {
        var s = Math.min(1, 2400 / i.naturalWidth);
        var c = document.createElement('canvas');
        c.width = Math.round(i.naturalWidth * s);
        c.height = Math.round(i.naturalHeight * s);
        c.getContext('2d').drawImage(i, 0, 0, c.width, c.height);
        var d = c.toDataURL('image/jpeg', 0.85);
        mark(i, id, u);
        out.push({ id: id, url: d });
      } catch (e) {}
    });
    return JSON.stringify(out);
  }

  function pending(maxScreens) {
    cleanup();
    var n = 0;
    Array.prototype.forEach.call(document.images, function (i) {
      if (usable(i, true) && !isDone(i) && !failedTwice(i) && dist(i) <= window.innerHeight * maxScreens) n++;
    });
    return n;
  }

  function info() {
    var all = document.images.length, big = 0, done = 0;
    Array.prototype.forEach.call(document.images, function (i) {
      if (usable(i, false)) { big++; if (isDone(i)) done++; }
    });
    return 'صور الصفحة: ' + all + '، الكبيرة: ' + big + '، سبقت معالجتها: ' + done +
      '، لوحات canvas: ' + document.querySelectorAll('canvas').length + '.';
  }

  function unmark(id) {
    var i = document.querySelector('img[data-mt-id="' + id + '"]');
    if (!i) return;
    var u = srcOf(i);
    var n = (i.dataset.mtFailSrc === u ? +i.dataset.mtFails : 0) + 1;
    i.dataset.mtFailSrc = u;
    i.dataset.mtFails = String(n);
    delete i.dataset.mtId;
    delete i.dataset.mtSrc;
  }

  function expand(boxes, W, H) {
    return boxes.map(function (a, i) {
      var w = a.x1 - a.x0, h = a.y1 - a.y0;
      var pl = Math.max(10, w * 0.12), pr = pl;
      var pt = Math.max(10, h * 0.14), pb = pt;
      boxes.forEach(function (b, j) {
        if (i === j) return;
        var vOver = a.y0 < b.y1 && a.y1 > b.y0;
        var hOver = a.x0 < b.x1 && a.x1 > b.x0;
        if (vOver) {
          if (b.x0 >= a.x1) pr = Math.min(pr, Math.max(0, (b.x0 - a.x1) / 2 - 1));
          if (b.x1 <= a.x0) pl = Math.min(pl, Math.max(0, (a.x0 - b.x1) / 2 - 1));
        }
        if (hOver) {
          if (b.y0 >= a.y1) pb = Math.min(pb, Math.max(0, (b.y0 - a.y1) / 2 - 1));
          if (b.y1 <= a.y0) pt = Math.min(pt, Math.max(0, (a.y0 - b.y1) / 2 - 1));
        }
      });
      return {
        x0: Math.max(0, a.x0 - pl),
        x1: Math.min(W, a.x1 + pr),
        y0: Math.max(0, a.y0 - pt),
        y1: Math.min(H, a.y1 + pb)
      };
    });
  }

  function growBox(d) {
    var w = d.offsetWidth, h = d.offsetHeight;
    var nw = w * 1.08, nh = h * 1.12;
    d.style.left = (parseFloat(d.style.left) - (nw - w) / 2) + 'px';
    d.style.top = (parseFloat(d.style.top) - (nh - h) / 2) + 'px';
    d.style.width = nw + 'px';
    d.style.height = nh + 'px';
  }

  function fitBox(d) {
    var fs = Math.min(40, Math.max(11, d.clientHeight * 0.42));
    d.style.fontSize = fs + 'px';
    var grow = 0, guard = 0;
    while ((d.scrollHeight > d.clientHeight + 1 || d.scrollWidth > d.clientWidth + 1) && guard < 120) {
      if (fs > 11) { fs -= 1; }
      else if (grow < 3) { growBox(d); grow++; }
      else if (fs > 8) { fs -= 1; }
      else { break; }
      d.style.fontSize = fs + 'px';
      guard++;
    }
  }

  function place(res) {
    var img = document.querySelector('img[data-mt-id="' + res.id + '"]');
    if (!img || img.dataset.mtSrc !== srcOf(img)) return;
    var entry = { img: img, w: res.w, src: srcOf(img), els: [] };
    var r = img.getBoundingClientRect();
    var k = img.clientWidth / res.w;
    var H = img.naturalHeight / img.naturalWidth * res.w;
    var ex = expand(res.boxes, res.w, H);
    res.boxes.forEach(function (b, n) {
      var e = ex[n];
      var d = document.createElement('div');
      d.contentEditable = 'true';
      d.textContent = b.text;
      d.dataset.b = [e.x0, e.y0, e.x1, e.y1].join(',');
      d.style.cssText =
        'position:absolute;z-index:2147483000;display:' + (visible ? 'flex' : 'none') +
        ';align-items:center;justify-content:center;text-align:center;background:#fff;color:#111;' +
        'border-radius:35%;overflow:visible;font-weight:700;line-height:1.3;word-break:break-word;' +
        'text-shadow:0 0 3px #fff,0 0 3px #fff;' +
        'padding:4px;box-sizing:border-box;direction:rtl;font-family:Tahoma,"Noto Sans Arabic",Arial,sans-serif;' +
        'left:' + (r.left + window.scrollX + e.x0 * k) + 'px;' +
        'top:' + (r.top + window.scrollY + e.y0 * k) + 'px;' +
        'width:' + ((e.x1 - e.x0) * k) + 'px;' +
        'height:' + ((e.y1 - e.y0) * k) + 'px';
      document.body.appendChild(d);
      fitBox(d);
      entry.els.push(d);
    });
    entries.push(entry);
  }

  function reposition() {
    entries.forEach(function (e) {
      var r = e.img.getBoundingClientRect(), k = e.img.clientWidth / e.w;
      e.els.forEach(function (d) {
        var b = d.dataset.b.split(',').map(Number);
        d.style.left = (r.left + window.scrollX + b[0] * k) + 'px';
        d.style.top = (r.top + window.scrollY + b[1] * k) + 'px';
        d.style.width = ((b[2] - b[0]) * k) + 'px';
        d.style.height = ((b[3] - b[1]) * k) + 'px';
        fitBox(d);
      });
    });
  }

  function toggle() {
    visible = !visible;
    entries.forEach(function (e) {
      e.els.forEach(function (d) { d.style.display = visible ? 'flex' : 'none'; });
    });
  }

  function clear() {
    entries.forEach(function (e) {
      e.els.forEach(function (d) { d.remove(); });
    });
    entries = [];
    Array.prototype.forEach.call(document.querySelectorAll('img[data-mt-id]'), function (i) {
      delete i.dataset.mtId;
      delete i.dataset.mtSrc;
    });
    Array.prototype.forEach.call(document.querySelectorAll('img[data-mt-fails]'), function (i) {
      delete i.dataset.mtFails;
      delete i.dataset.mtFailSrc;
    });
  }

  var timer;
  function later() { clearTimeout(timer); timer = setTimeout(reposition, 150); }
  window.addEventListener('resize', later);
  if (window.ResizeObserver) new ResizeObserver(later).observe(document.body);
  setInterval(cleanup, 600);

  window.MT = {
    collect: collect, pending: pending, place: place, toggle: toggle,
    clear: clear, info: info, unmark: unmark
  };
})();
