(function () {
  if (window.MT) return;
  var seq = 0, visible = true, entries = [];

  function collect() {
    var list = [];
    Array.prototype.forEach.call(document.images, function (i) {
      var u = i.currentSrc || i.src;
      if (!/^https?:/i.test(u)) return;
      if (i.naturalWidth < 300 || i.naturalHeight < 300 || i.clientWidth < 200) return;
      if (i.dataset.mtId) return;
      list.push(i);
    });
    list.sort(function (a, b) {
      return Math.abs(a.getBoundingClientRect().top) - Math.abs(b.getBoundingClientRect().top);
    });
    return JSON.stringify(list.map(function (i) {
      var id = String(++seq);
      i.dataset.mtId = id;
      return { id: id, url: i.currentSrc || i.src };
    }));
  }

  function fitBox(d) {
    var fs = Math.min(40, Math.max(10, d.clientHeight * 0.5));
    d.style.fontSize = fs + 'px';
    while (fs > 8 && (d.scrollHeight > d.clientHeight + 1 || d.scrollWidth > d.clientWidth + 1)) {
      fs -= 1;
      d.style.fontSize = fs + 'px';
    }
  }

  function place(res) {
    var img = document.querySelector('img[data-mt-id="' + res.id + '"]');
    if (!img) return;
    var entry = { img: img, w: res.w, els: [] };
    var r = img.getBoundingClientRect();
    var k = img.clientWidth / res.w, pad = 6;
    res.boxes.forEach(function (b) {
      var d = document.createElement('div');
      d.contentEditable = 'true';
      d.textContent = b.text;
      d.dataset.b = [b.x0, b.y0, b.x1, b.y1].join(',');
      d.style.cssText =
        'position:absolute;z-index:2147483000;display:' + (visible ? 'flex' : 'none') +
        ';align-items:center;justify-content:center;text-align:center;background:#fff;color:#111;' +
        'border-radius:42%;overflow:hidden;font-weight:700;line-height:1.25;word-break:break-word;' +
        'padding:2px;box-sizing:border-box;direction:rtl;font-family:Tahoma,"Noto Naskh Arabic",Arial,sans-serif;' +
        'left:' + (r.left + window.scrollX + b.x0 * k - pad) + 'px;' +
        'top:' + (r.top + window.scrollY + b.y0 * k - pad) + 'px;' +
        'width:' + ((b.x1 - b.x0) * k + pad * 2) + 'px;' +
        'height:' + ((b.y1 - b.y0) * k + pad * 2) + 'px';
      document.body.appendChild(d);
      fitBox(d);
      entry.els.push(d);
    });
    entries.push(entry);
  }

  function reposition() {
    entries.forEach(function (e) {
      var r = e.img.getBoundingClientRect(), k = e.img.clientWidth / e.w, pad = 6;
      e.els.forEach(function (d) {
        var b = d.dataset.b.split(',').map(Number);
        d.style.left = (r.left + window.scrollX + b[0] * k - pad) + 'px';
        d.style.top = (r.top + window.scrollY + b[1] * k - pad) + 'px';
        d.style.width = ((b[2] - b[0]) * k + pad * 2) + 'px';
        d.style.height = ((b[3] - b[1]) * k + pad * 2) + 'px';
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
      delete e.img.dataset.mtId;
    });
    entries = [];
  }

  var timer;
  function later() { clearTimeout(timer); timer = setTimeout(reposition, 150); }
  window.addEventListener('resize', later);
  if (window.ResizeObserver) new ResizeObserver(later).observe(document.body);

  window.MT = { collect: collect, place: place, toggle: toggle, clear: clear };
})();
