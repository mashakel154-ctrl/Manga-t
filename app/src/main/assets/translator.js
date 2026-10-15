(function () {
  if (window.MT) return;
  var seq = 0, visible = true, entries = [];
  var BATCH = 5;

  function usable(i) {
    var u = i.currentSrc || i.src || '';
    if (!/^(https?:|blob:|data:)/i.test(u)) return false;
    if (!i.complete || i.naturalWidth < 300 || i.naturalHeight < 300) return false;
    return i.getBoundingClientRect().width >= 200;
  }

  function dist(i) {
    var r = i.getBoundingClientRect();
    if (r.bottom < 0) return -r.bottom;
    if (r.top > window.innerHeight) return r.top - window.innerHeight;
    return 0;
  }

  function collect() {
    var list = Array.prototype.filter.call(document.images, function (i) {
      return usable(i) && !i.dataset.mtId;
    });
    list.sort(function (a, b) {
      return dist(a) - dist(b) || a.getBoundingClientRect().top - b.getBoundingClientRect().top;
    });
    list = list.slice(0, BATCH);
    var out = [];
    list.forEach(function (i) {
      var id = String(++seq), u = i.currentSrc || i.src;
      if (/^https?:/i.test(u)) {
        i.dataset.mtId = id;
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
        i.dataset.mtId = id;
        out.push({ id: id, url: d });
      } catch (e) {}
    });
    return JSON.stringify(out);
  }

  function info() {
    var all = document.images.length, big = 0, done = 0;
    Array.prototype.forEach.call(document.images, function (i) {
      if (usable(i)) { big++; if (i.dataset.mtId) done++; }
    });
    return 'صور الصفحة: ' + all + '، الكبيرة: ' + big + '، سبقت معالجتها: ' + done +
      '، لوحات canvas: ' + document.querySelectorAll('canvas').length + '.';
  }

  function unmark(id) {
    var i = document.querySelector('img[data-mt-id="' + id + '"]');
    if (i) delete i.dataset.mtId;
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
    var fs = Math.min(42, Math.max(12, d.clientHeight * 0.45));
    d.style.fontSize = fs + 'px';
    var guard = 0;
    while ((d.scrollHeight > d.clientHeight + 1 || d.scrollWidth > d.clientWidth + 1) && guard < 80) {
      if (fs > 12) { fs -= 1; d.style.fontSize = fs + 'px'; }
      else { growBox(d); }
      guard++;
    }
  }

  function place(res) {
    var img = document.querySelector('img[data-mt-id="' + res.id + '"]');
    if (!img) return;
    var entry = { img: img, w: res.w, els: [] };
    var r = img.getBoundingClientRect();
    var k = img.clientWidth / res.w;
    res.boxes.forEach(function (b) {
      var w0 = b.x1 - b.x0, h0 = b.y1 - b.y0;
      var px = Math.max(10, w0 * 0.12), py = Math.max(10, h0 * 0.14);
      var x0 = Math.max(0, b.x0 - px), y0 = Math.max(0, b.y0 - py);
      var x1 = Math.min(res.w, b.x1 + px), y1 = b.y1 + py;
      var d = document.createElement('div');
      d.contentEditable = 'true';
      d.textContent = b.text;
      d.dataset.b = [x0, y0, x1, y1].join(',');
      d.style.cssText =
        'position:absolute;z-index:2147483000;display:' + (visible ? 'flex' : 'none') +
        ';align-items:center;justify-content:center;text-align:center;background:#fff;color:#111;' +
        'border-radius:35%;overflow:hidden;font-weight:700;line-height:1.3;word-break:break-word;' +
        'padding:4px;box-sizing:border-box;direction:rtl;font-family:Tahoma,"Noto Sans Arabic",Arial,sans-serif;' +
        'left:' + (r.left + window.scrollX + x0 * k) + 'px;' +
        'top:' + (r.top + window.scrollY + y0 * k) + 'px;' +
        'width:' + ((x1 - x0) * k) + 'px;' +
        'height:' + ((y1 - y0) * k) + 'px';
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
    });
  }

  var timer;
  function later() { clearTimeout(timer); timer = setTimeout(reposition, 150); }
  window.addEventListener('resize', later);
  if (window.ResizeObserver) new ResizeObserver(later).observe(document.body);

  window.MT = { collect: collect, place: place, toggle: toggle, clear: clear, info: info, unmark: unmark };
})();
