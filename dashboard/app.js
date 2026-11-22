// LAUNCH RADAR dashboard logic. Reads window.RADAR (written by main.ts),
// renders the board, the filters, the detail view and the two charts.
// No network, no clock, no randomness: the same data always renders the
// same page. Views are addressable by hash so the program can screenshot
// them: #detail=<slug> and #filter=<category>.

(function () {
  var D = window.RADAR;
  var rows = D.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  var state = { sort: 'rank', dir: 1, cat: '', chain: '', band: '', wl: false, q: '' };

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function money(usd) {
    if (usd >= 1e9) return '$' + (usd / 1e9).toFixed(1) + 'B';
    if (usd >= 1e6) return '$' + (usd / 1e6).toFixed(1) + 'M';
    if (usd >= 1e3) return '$' + Math.round(usd / 1e3) + 'K';
    return '$' + Math.round(usd);
  }
  function pct(x) {
    if (x === null || x === undefined) return '—';
    return (x > 0 ? '+' : '') + x.toFixed(1) + '%';
  }
  function chainsShort(chains) {
    if (chains.length <= 2) return chains.join(', ');
    return chains.slice(0, 2).join(', ') + ' +' + (chains.length - 2);
  }

  // ---------------------------------------------------------------- header

  var meta = D.meta;
  document.getElementById('stats').innerHTML =
    '<div><dt>Tracked</dt><dd>' + meta.totalProtocols + '</dd></div>' +
    '<div><dt>Pre-token</dt><dd>' + meta.noToken + '</dd></div>' +
    '<div><dt>Watchlist</dt><dd>' + meta.watchlistCount + '</dd></div>' +
    '<div><dt>Ranked</dt><dd>' + meta.boardSize + '</dd></div>' +
    '<div><dt>Snapshot</dt><dd>' + esc(meta.asOf) + '</dd></div>';

  var top = rows[0];
  document.getElementById('pick').innerHTML =
    '<span class="tag">TOP PICK · RANK #1</span>' +
    '<span class="name">' + esc(top.name) + '</span>' +
    '<span class="val">' + money(top.value) + ' implied</span>' +
    '<span>' + money(top.tvl) + ' TVL · ' + esc(top.cat || 'Uncategorised') + ' · ' + top.chains.length + ' chains</span>' +
    '<p class="why">Highest score in the set: the largest TVL of any protocol that records no token, on ' + top.chains.length + ' chains, with no token to dilute a launch.</p>';

  // ---------------------------------------------------------------- filters

  var catSel = document.getElementById('f-cat');
  var chainSel = document.getElementById('f-chain');
  var bandSel = document.getElementById('f-band');
  var wlBox = document.getElementById('f-wl');
  var qInput = document.getElementById('f-q');

  function fillSelect(sel, items, label) {
    var html = '<option value="">' + label + '</option>';
    items.forEach(function (it) { html += '<option value="' + esc(it) + '">' + esc(it) + '</option>'; });
    sel.innerHTML = html;
  }
  var catCounts = {};
  rows.forEach(function (r) { var k = r.cat || 'Uncategorised'; catCounts[k] = (catCounts[k] || 0) + 1; });
  var cats = Object.keys(catCounts).sort(function (a, b) { return catCounts[b] - catCounts[a]; });
  fillSelect(catSel, cats, 'All categories');
  var chainSet = {};
  rows.forEach(function (r) { r.chains.forEach(function (c) { chainSet[c] = true; }); });
  fillSelect(chainSel, Object.keys(chainSet).sort(), 'All chains');

  // ---------------------------------------------------------------- table

  var tbody = document.getElementById('rows');
  var countEl = document.getElementById('count');

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return rows.filter(function (r) {
      if (state.cat && (r.cat || 'Uncategorised') !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
      if (state.band === 'huge' && r.tvl < 1e9) return false;
      if (state.band === 'mid' && (r.tvl < 5e7 || r.tvl >= 1e9)) return false;
      if (state.band === 'early' && r.tvl >= 5e7) return false;
      if (state.wl && !r.wl) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  function sortKey(r) {
    switch (state.sort) {
      case 'name': return r.name.toLowerCase();
      case 'cat': return (r.cat || 'Uncategorised').toLowerCase();
      case 'chains': return r.chains.length;
      case 'tvl': return r.tvl;
      case 'chg': return r.chg === null ? -1e9 : r.chg;
      case 'value': return r.value;
      default: return r.rank;
    }
  }

  function renderTable() {
    var list = filtered();
    list.sort(function (a, b) {
      var ka = sortKey(a), kb = sortKey(b);
      var c = ka < kb ? -1 : ka > kb ? 1 : (a.slug < b.slug ? -1 : 1);
      return c * state.dir;
    });
    var html = '';
    list.forEach(function (r) {
      var cls = r.chg === null ? '' : r.chg >= 0 ? 'pos' : 'neg';
      html += '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + (r.wl ? ' <span class="wl">★WL</span>' : '') + '</td>' +
        '<td>' + esc(r.name) + '</td>' +
        '<td>' + esc(r.cat || '—') + '</td>' +
        '<td>' + esc(chainsShort(r.chains)) + '</td>' +
        '<td class="num">' + money(r.tvl) + '</td>' +
        '<td class="num ' + cls + '">' + pct(r.chg) + '</td>' +
        '<td class="num">' + money(r.value) + '</td>' +
        '<td class="step">' + esc(r.steps[0].length > 72 ? r.steps[0].slice(0, 72) + '…' : r.steps[0]) + '</td></tr>';
    });
    tbody.innerHTML = html;
    countEl.textContent = list.length + ' of ' + rows.length + ' shown';
    var ths = document.querySelectorAll('#board th[data-k]');
    ths.forEach(function (th) {
      th.classList.toggle('sorted', th.getAttribute('data-k') === state.sort);
      th.textContent = th.textContent.replace(/ [▲▼]$/, '') + (th.getAttribute('data-k') === state.sort ? (state.dir === 1 ? ' ▲' : ' ▼') : '');
    });
  }

  document.querySelectorAll('#board th[data-k]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-k');
      if (state.sort === k) state.dir = -state.dir;
      else { state.sort = k; state.dir = k === 'name' || k === 'cat' ? 1 : -1; }
      renderTable();
    });
  });

  catSel.addEventListener('change', function () { state.cat = catSel.value; renderTable(); });
  chainSel.addEventListener('change', function () { state.chain = chainSel.value; renderTable(); });
  bandSel.addEventListener('change', function () { state.band = bandSel.value; renderTable(); });
  wlBox.addEventListener('change', function () { state.wl = wlBox.checked; renderTable(); });
  qInput.addEventListener('input', function () { state.q = qInput.value; renderTable(); });
  document.getElementById('f-clear').addEventListener('click', function () {
    state = { sort: 'rank', dir: 1, cat: '', chain: '', band: '', wl: false, q: '' };
    catSel.value = ''; chainSel.value = ''; bandSel.value = ''; wlBox.checked = false; qInput.value = '';
    renderTable();
  });
  tbody.addEventListener('click', function (e) {
    var tr = e.target.closest('tr');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });

  // ---------------------------------------------------------------- detail

  var detailEl = document.getElementById('detail');
  var detailBody = document.getElementById('detail-body');

  function factorBar(label, val, max, suffix) {
    var w = Math.max(0, Math.min(100, (Math.abs(val) / max) * 100));
    var cls = val < 0 ? ' class="neg"' : '';
    return '<div class="factor"><div class="k">' + label + '</div><div class="v">' + val + (suffix || '') + '</div>' +
      '<div class="bar"><i' + cls + ' style="width:' + w.toFixed(0) + '%"></i></div></div>';
  }

  function whyLine(r) {
    var f = r.f;
    var parts = [
      ['base', f.base, 'a ' + money(r.tvl) + ' TVL gives the strongest base in the set'],
      ['growth', f.growth, 'a ' + pct(r.chg) + ' week ' + (f.growth >= 0 ? 'lifts' : 'cuts') + ' the score by ' + Math.abs(f.growth).toFixed(1) + ' points'],
      ['age', f.age, 'running since ' + (r.listed || 'an unknown date') + ' adds ' + f.age.toFixed(1) + ' maturity points'],
      ['breadth', f.breadth, r.chains.length + ' chains add ' + f.breadth.toFixed(1) + ' breadth points'],
    ];
    parts.sort(function (a, b) { return Math.abs(b[1]) - Math.abs(a[1]); });
    var lead = parts[0];
    return 'Ranks #' + r.rank + ' because ' + lead[2] + ', with a category multiplier of ' + f.cat.toFixed(2) +
      (f.bonus ? ' and the +12 no-token bonus' : '') + ', for a total score of ' + f.score.toFixed(1) +
      ' and an implied value of ' + money(r.value) + '.';
  }

  function openDetail(slug) {
    var r = bySlug[slug];
    if (!r) return;
    var f = r.f;
    detailBody.innerHTML =
      '<h3>' + esc(r.name) + (r.wl ? '<span class="wl">★ WATCHLIST</span>' : '') + '</h3>' +
      '<p class="meta">Rank #' + r.rank + ' · ' + esc(r.cat || 'Uncategorised') + ' · ' + esc(r.chains.join(', ')) +
      ' · TVL ' + money(r.tvl) + ' · 7d ' + pct(r.chg) + ' · Implied value ' + money(r.value) + '</p>' +
      '<div class="factors">' +
      factorBar('Base · log TVL', f.base, 120) +
      factorBar('Growth · 7d', f.growth, 8) +
      factorBar('Age · maturity', f.age, 7.2) +
      factorBar('Breadth · chains', f.breadth, 8) +
      factorBar('Category ×', f.cat, 1.25, '×') +
      factorBar('No-token bonus', f.bonus, 12) +
      '</div>' +
      '<h2>Farm plan — ' + r.steps.length + ' steps</h2>' +
      '<ol>' + r.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<p class="why">' + esc(whyLine(r)) + '</p>';
    detailEl.hidden = false;
    detailEl.scrollIntoView();
  }
  document.getElementById('d-close').addEventListener('click', function () { detailEl.hidden = true; });

  // ---------------------------------------------------------------- charts

  function svgCurve() {
    var W = 1160, H = 220, P = 34;
    var vals = rows.map(function (r) { return Math.log10(r.value); });
    var vMin = Math.min.apply(null, vals), vMax = Math.max.apply(null, vals);
    var x = function (i) { return P + (i / (rows.length - 1)) * (W - 2 * P); };
    var y = function (v) { return H - P - ((v - vMin) / (vMax - vMin)) * (H - 2 * P); };
    var pts = vals.map(function (v, i) { return x(i).toFixed(1) + ',' + y(v).toFixed(1); }).join(' ');
    var grid = '';
    [6, 7, 8, 9].forEach(function (e) {
      if (e < vMin || e > vMax) return;
      var gy = y(e);
      grid += '<line x1="' + P + '" y1="' + gy + '" x2="' + (W - P) + '" y2="' + gy + '" stroke="#1e2a35"/>' +
        '<text x="6" y="' + (gy + 4) + '" fill="#7d8ea0" font-size="11">$' + (e === 9 ? '1B' : e === 8 ? '100M' : e === 7 ? '10M' : '1M') + '</text>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '">' + grid +
      '<polyline points="' + pts + '" fill="none" stroke="#35d0a5" stroke-width="2"/>' +
      '<text x="' + P + '" y="' + (H - 8) + '" fill="#7d8ea0" font-size="11">rank 1</text>' +
      '<text x="' + (W - P - 40) + '" y="' + (H - 8) + '" fill="#7d8ea0" font-size="11">rank 300</text></svg>';
  }

  function svgCats() {
    var cats = D.cats.slice(0, 8);
    var W = 1160, H = 30 * cats.length + 16;
    var max = Math.log10(cats[0].tvl);
    var out = '<svg viewBox="0 0 ' + W + ' ' + H + '">';
    cats.forEach(function (c, i) {
      var y = 8 + i * 30;
      var w = ((Math.log10(c.tvl) - 6) / (max - 6)) * 700;
      out += '<text x="0" y="' + (y + 15) + '" fill="#d7e0e8" font-size="12">' + esc(c.name) + '</text>' +
        '<rect x="210" y="' + y + '" width="' + w.toFixed(0) + '" height="18" fill="#5aa9e6"/>' +
        '<text x="' + (220 + w) + '" y="' + (y + 15) + '" fill="#7d8ea0" font-size="12">' + money(c.tvl) + ' · ' + c.count + ' protocols</text>';
    });
    return out + '</svg>';
  }

  document.getElementById('chart-curve').innerHTML = svgCurve();
  document.getElementById('chart-cats').innerHTML = svgCats();

  // ---------------------------------------------------------------- boot

  renderTable();
  var hash = window.location.hash || '';
  var m = hash.match(/^#detail=(.+)$/);
  if (m) {
    // Detail mode: the board is long, so hide it (and the sections below
    // the detail) so the detail view sits in the first viewport instead of
    // relying on a programmatic scroll, which headless screenshots do not
    // reliably capture.
    document.body.classList.add('detail-mode');
    openDetail(decodeURIComponent(m[1]));
    return;
  }
  var f = hash.match(/^#filter=(.+)$/);
  if (f) {
    var cat = decodeURIComponent(f[1]);
    if (cats.indexOf(cat) !== -1) { state.cat = cat; catSel.value = cat; renderTable(); }
  }
})();
