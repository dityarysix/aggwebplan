// Shows this week's edition: picks a section (tab) and a language, then draws the page.
(function () {
  'use strict';

  var data = JSON.parse(document.getElementById('news-data').textContent);
  // Tabs: 'utama' shows all East Java news, the area tabs show East Java news tagged with that
  // area (see areas.json), 'dunia' shows world news.
  var SECTIONS = ['utama', 'surabaya', 'malang', 'madura', 'mataraman', 'dunia'];
  var TZ = 'Asia/Jakarta';
  var EDITION_DAYS = 7;
  var HIGHLIGHTS = 3;
  var PER_DAY = 6;

  var TEXT = {
    id: {
      skip: 'Langsung ke berita',
      utama: 'Sorotan Utama', dunia: 'Dunia', all: 'Semua',
      leadLabel: 'Laporan utama', highlightsLabel: 'Sorotan pekan ini', weekLabel: 'Sepanjang pekan',
      edition: 'Edisi',
      about: 'Jawa Timur Sepekan mengumpulkan judul dan ringkasan berita dari media tepercaya. Klik judul untuk membaca artikel lengkap di situs aslinya.',
      sources: 'Sumber',
      sourceLine: 'Sumber',
      readAt: function (site) { return 'Berita selengkapnya dapat dibaca di ' + site; },
      official: 'Rilis resmi',
      daily: 'Ringkasan harian', weekly: 'Ringkasan sepekan',
      officialSources: 'Rilis resmi pemerintah daerah',
      updated: 'Diperbarui',
      today: 'Hari ini', yesterday: 'Kemarin',
      more: function (n) { return 'Lihat semua ' + n + ' berita'; },
      less: 'Tampilkan lebih sedikit',
      emptyLang: 'Belum ada berita berbahasa Inggris untuk rubrik ini pekan ini.',
      emptyAny: 'Belum ada berita di rubrik ini pekan ini.',
      showAll: 'Tampilkan semua bahasa',
      locale: 'id-ID',
    },
    en: {
      skip: 'Skip to the news',
      utama: 'Top Stories', dunia: 'World', all: 'All',
      leadLabel: 'Top story', highlightsLabel: 'This week’s highlights', weekLabel: 'Through the week',
      edition: 'Edition',
      about: 'Jawa Timur Sepekan collects headlines and summaries from trusted news outlets. Click a headline to read the full article on the original site.',
      sources: 'Sources',
      sourceLine: 'Source',
      readAt: function (site) { return 'Read the full story at ' + site; },
      official: 'Official release',
      daily: 'Daily wrap-up', weekly: 'Weekly wrap-up',
      officialSources: 'Official releases from local governments',
      updated: 'Updated',
      today: 'Today', yesterday: 'Yesterday',
      more: function (n) { return 'See all ' + n + ' stories'; },
      less: 'Show fewer',
      emptyLang: 'There is no English news for this area this week. English news from East Java’s own outlets is rare; Top Stories and World have more.',
      emptyAny: 'There is no news in this area this week.',
      showAll: 'Show all languages',
      locale: 'en-GB',
    },
  };

  var state = {
    section: sectionFromHash(),
    lang: localStorage.getItem('js-lang') || 'all',
    open: {}, // days the reader expanded
  };
  if (['all', 'id', 'en'].indexOf(state.lang) < 0) state.lang = 'all';

  function sectionFromHash() {
    var s = location.hash.slice(1);
    return SECTIONS.indexOf(s) >= 0 ? s : 'utama';
  }

  function t() { return TEXT[state.lang === 'en' ? 'en' : 'id']; }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function fmt(date, options) {
    options.timeZone = TZ;
    return new Intl.DateTimeFormat(t().locale, options).format(date);
  }

  function dayKey(date) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }

  function editionLabel() {
    var end = new Date();
    var start = new Date(end - (EDITION_DAYS - 1) * 86400000);
    var sameMonth = fmt(start, { month: 'long' }) === fmt(end, { month: 'long' });
    var from = fmt(start, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'long' });
    return t().edition + ' ' + from + '–' + fmt(end, { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function relative(date) {
    var minutes = Math.round((date - new Date()) / 60000);
    var rtf = new Intl.RelativeTimeFormat(t().locale, { numeric: 'auto' });
    if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
    var hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
    return rtf.format(Math.round(hours / 24), 'day');
  }

  function when(article) {
    var date = new Date(article.date);
    var key = dayKey(date);
    if (key === dayKey(new Date())) return relative(date);
    return fmt(date, { weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function title(article, tag) {
    var h = el(tag, 'title');
    var a = el('a', null, article.title);
    if (article.page) {
      a.href = article.page;  // AI-written article page on this site
    } else {
      a.href = article.link;
      a.target = '_blank';
      a.rel = 'noopener';
    }
    h.appendChild(a);
    return h;
  }

  // A paragraph whose last three words link to the source article.
  function paragraph(text, link, site) {
    var p = el('p', 'para');
    var words = (text || t().readAt(site)).split(' ');
    var cut = Math.max(0, words.length - 3);
    var tail = words.slice(cut).join(' ');
    var trailing = (tail.match(/[.,;:!?"”)]+$/) || [''])[0];
    if (cut) p.appendChild(document.createTextNode(words.slice(0, cut).join(' ') + ' '));
    var a = el('a', null, trailing ? tail.slice(0, -trailing.length) : tail);
    a.href = link;
    a.target = '_blank';
    a.rel = 'noopener';
    p.appendChild(a);
    if (trailing) p.appendChild(document.createTextNode(trailing));
    return p;
  }

  // The story text: one paragraph per outlet (at most two), then "Sumber: ..." after the last one.
  function storyText(article) {
    var box = document.createDocumentFragment();
    if (article.digest) {  // a wrap-up: its links to every story are on its own page
      box.appendChild(el('p', 'para', article.summary));
      return box;
    }
    box.appendChild(paragraph(article.summary, article.link, article.site));
    var sites = [article.site];
    if (article.also) {
      box.appendChild(paragraph(article.also.summary, article.also.link, article.also.site));
      if (sites.indexOf(article.also.site) < 0) sites.push(article.also.site);
    }
    box.appendChild(el('p', 'sources', t().sourceLine + ': ' + sites.join(', ')));
    return box;
  }

  function meta(article, withTime) {
    var p = el('p', 'meta');
    p.appendChild(el('b', null, article.source));
    if (withTime) p.appendChild(document.createTextNode(', ' + when(article)));
    if (article.official) p.appendChild(el('span', 'official', t().official));
    if (article.digest) p.appendChild(el('span', 'official', t()[article.digest]));
    return p;
  }

  function frame(article, onFail) {
    var box = el('div', 'frame');
    var img = el('img');
    img.src = article.image;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', function () { box.remove(); if (onFail) onFail(); });
    box.appendChild(img);
    return box;
  }

  function renderLead(article) {
    var section = document.getElementById('lead');
    var story = document.getElementById('lead-story');
    story.replaceChildren();
    story.className = 'lead__story';
    section.hidden = !article;
    if (!article) return;
    if (article.image) story.appendChild(frame(article, function () { story.classList.add('lead__story--noimage'); }));
    else story.classList.add('lead__story--noimage');
    var text = el('div');
    text.appendChild(title(article, 'h3'));
    text.appendChild(storyText(article));
    text.appendChild(meta(article, true));
    story.appendChild(text);
  }

  function renderHighlights(articles) {
    var section = document.getElementById('highlights');
    var grid = document.getElementById('highlights-grid');
    grid.replaceChildren();
    section.hidden = articles.length === 0;
    articles.forEach(function (article) {
      var item = el('article', 'highlight');
      if (article.image) item.appendChild(frame(article));
      item.appendChild(title(article, 'h3'));
      item.appendChild(meta(article, true));
      item.appendChild(storyText(article));
      grid.appendChild(item);
    });
  }

  function renderDays(articles) {
    var container = document.getElementById('days');
    container.replaceChildren();
    var groups = [];
    var byKey = {};
    articles.forEach(function (article) {
      var key = dayKey(new Date(article.date));
      if (!byKey[key]) { byKey[key] = []; groups.push({ key: key, date: new Date(article.date), items: byKey[key] }); }
      byKey[key].push(article);
    });

    var todayKey = dayKey(new Date());
    var yesterdayKey = dayKey(new Date(Date.now() - 86400000));
    groups.forEach(function (group) {
      var day = el('section', 'day');
      var heading = el('h3', 'day__name');
      var name = group.key === todayKey ? t().today : group.key === yesterdayKey ? t().yesterday : fmt(group.date, { weekday: 'long' });
      heading.appendChild(document.createTextNode(name));
      heading.appendChild(el('span', 'day__date', fmt(group.date, { day: 'numeric', month: 'long' })));
      day.appendChild(heading);

      var body = el('div');
      var list = el('ul', 'day__list');
      var isOpen = !!state.open[group.key];
      group.items.slice(0, isOpen ? group.items.length : PER_DAY).forEach(function (article) {
        var li = el('li');
        li.appendChild(title(article, 'h4'));
        li.appendChild(meta(article, false));
        li.appendChild(storyText(article));
        list.appendChild(li);
      });
      body.appendChild(list);
      if (group.items.length > PER_DAY) {
        var button = el('button', 'more', isOpen ? t().less : t().more(group.items.length));
        button.type = 'button';
        button.setAttribute('aria-expanded', String(isOpen));
        button.addEventListener('click', function () {
          state.open[group.key] = !isOpen;
          render();
          var again = document.querySelector('[data-day="' + group.key + '"] .more');
          if (again) again.focus();
        });
        body.appendChild(button);
      }
      day.dataset.day = group.key;
      day.appendChild(body);
      container.appendChild(day);
    });
  }

  function renderEmpty() {
    var container = document.getElementById('days');
    var box = el('div');
    box.appendChild(el('p', 'empty', state.lang === 'all' ? t().emptyAny : t().emptyLang));
    if (state.lang !== 'all') {
      var button = el('button', 'more', t().showAll);
      button.type = 'button';
      button.addEventListener('click', function () { setLang('all'); });
      box.appendChild(button);
    }
    container.appendChild(box);
  }

  // Top story and highlights: recent stories with a photo, each from a different outlet.
  function pickFeatured(articles) {
    var recent = articles.filter(function (a) { return Date.now() - new Date(a.date) < 2 * 86400000 && a.image; });
    var picked = [];
    var usedSources = {};
    recent.forEach(function (a) {
      if (picked.length < HIGHLIGHTS + 1 && !usedSources[a.source]) { picked.push(a); usedSources[a.source] = true; }
    });
    if (!picked.length && articles.length) picked.push(articles[0]);
    return picked;
  }

  // The daily and weekly wrap-ups, shaped like articles.
  var DIGESTS = (data.digests || []).map(function (d) {
    return {
      digest: d.kind, title: d.title, date: d.date, page: d.page, link: d.page, image: d.image,
      summary: d.summary, source: 'Redaksi Jawa Timur Sepekan', section: 'jatim', lang: 'id', areas: [],
    };
  });

  // The newest wrap-up leads Sorotan Utama for 2 hours. After that it stays on top (up to 12 hours
  // for the daily, 24 for the weekly) until a big story arrives: one reported by two outlets.
  function leadDigest(articles) {
    var d = DIGESTS[0];
    if (!d) return null;
    var age = Date.now() - new Date(d.date);
    if (age < 2 * 3600000) return d;
    if (age > (d.digest === 'weekly' ? 24 : 12) * 3600000) return null;
    var bigNews = articles.some(function (a) { return a.also && a.date > d.date; });
    return bigNews ? null : d;
  }

  function render() {
    var text = t();
    document.documentElement.lang = state.lang === 'en' ? 'en' : 'id';
    document.querySelectorAll('[data-t]').forEach(function (node) {
      var value = text[node.getAttribute('data-t')];
      if (typeof value === 'string') node.textContent = value;
    });
    document.querySelectorAll('#tabs a').forEach(function (tab) {
      tab.setAttribute('aria-selected', String(tab.dataset.section === state.section));
    });
    document.querySelectorAll('#lang button').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.lang === state.lang));
    });
    document.getElementById('edition').textContent = editionLabel();
    document.getElementById('updated').textContent = text.updated + ' ' + relative(new Date(data.updated));
    document.getElementById('sources').textContent = data.sources.join(', ');
    document.getElementById('official-sources').textContent = (data.official || []).join(', ');

    var articles = data.articles.filter(function (a) {
      if (state.lang !== 'all' && a.lang !== state.lang) return false;
      if (state.section === 'dunia') return a.section === 'dunia';
      if (a.section !== 'jatim') return false;
      return state.section === 'utama' || (a.areas || []).indexOf(state.section) >= 0;
    });
    var featured = pickFeatured(articles);
    var listed = articles;
    // On Sorotan Utama, the wrap-ups join the news, and the newest one can take the top spot.
    if (state.section === 'utama' && state.lang !== 'en' && DIGESTS.length) {
      var lead = leadDigest(articles);
      if (lead) featured = [lead].concat(featured.slice(0, HIGHLIGHTS));
      listed = articles.concat(DIGESTS).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    }
    renderLead(featured[0]);
    renderHighlights(featured.slice(1));
    renderDays(listed.filter(function (a) { return featured.indexOf(a) < 0; }));
    if (!articles.length) renderEmpty();
  }

  function setLang(lang) {
    state.lang = lang;
    localStorage.setItem('js-lang', lang);
    render();
  }

  document.getElementById('lang').addEventListener('click', function (event) {
    var button = event.target.closest('button[data-lang]');
    if (button) setLang(button.dataset.lang);
  });

  window.addEventListener('hashchange', function () {
    state.section = sectionFromHash();
    state.open = {};
    render();
    window.scrollTo({ top: 0 });
  });

  render();
  setInterval(render, 60000); // keeps "5 minutes ago" labels fresh
})();
