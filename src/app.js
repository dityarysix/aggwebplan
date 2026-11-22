// Shows the collected news: picks a section (tab) and a language, then draws the page.
(function () {
  'use strict';

  var data = JSON.parse(document.getElementById('news-data').textContent);
  var SECTIONS = ['jatim', 'indonesia', 'dunia'];
  var TZ = 'Asia/Jakarta';
  var NEW_MINUTES = 60;
  var STREAM_LIMIT = 60;

  var TEXT = {
    id: {
      skip: 'Langsung ke berita',
      tagline: 'Berita Jawa Timur, Indonesia, dan dunia dalam satu halaman',
      jatim: 'Jawa Timur', indonesia: 'Indonesia', dunia: 'Dunia', all: 'Semua',
      about: 'Warta Wetan mengumpulkan judul dan ringkasan berita. Klik judul untuk membaca artikel lengkap di situs aslinya.',
      sources: 'Sumber',
      updated: 'Diperbarui',
      today: 'Hari ini', yesterday: 'Kemarin',
      emptyLang: 'Belum ada berita berbahasa Inggris untuk bagian ini.',
      emptyAny: 'Belum ada berita di bagian ini. Coba lagi nanti.',
      showAll: 'Tampilkan semua bahasa',
      locale: 'id-ID',
    },
    en: {
      skip: 'Skip to the news',
      tagline: 'News from East Java, Indonesia and the world on one page',
      jatim: 'East Java', indonesia: 'Indonesia', dunia: 'World', all: 'All',
      about: 'Warta Wetan collects headlines and summaries. Click a headline to read the full article on the original site.',
      sources: 'Sources',
      updated: 'Updated',
      today: 'Today', yesterday: 'Yesterday',
      emptyLang: 'There is no English news for this section yet.',
      emptyAny: 'There is no news in this section yet. Try again later.',
      showAll: 'Show all languages',
      locale: 'en-GB',
    },
  };

  var state = {
    section: sectionFromHash(),
    lang: localStorage.getItem('ww-lang') || 'all',
  };
  if (['all', 'id', 'en'].indexOf(state.lang) < 0) state.lang = 'all';

  function sectionFromHash() {
    var s = location.hash.slice(1);
    return SECTIONS.indexOf(s) >= 0 ? s : 'jatim';
  }

  function t() { return TEXT[state.lang === 'en' ? 'en' : 'id']; }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function dayKey(date) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }

  function timeOf(date) {
    return new Intl.DateTimeFormat(t().locale, { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  }

  function dayLabel(date) {
    var now = new Date();
    if (dayKey(date) === dayKey(now)) return t().today;
    if (dayKey(date) === dayKey(new Date(now - 86400000))) return t().yesterday;
    return new Intl.DateTimeFormat(t().locale, { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(date);
  }

  function relative(date) {
    var minutes = Math.round((date - new Date()) / 60000);
    var rtf = new Intl.RelativeTimeFormat(t().locale, { numeric: 'auto' });
    if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
    var hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
    return rtf.format(Math.round(hours / 24), 'day');
  }

  function link(article, text) {
    var a = el('a', null, text);
    a.href = article.link;
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  }

  function image(src, className, alt) {
    var img = el('img', className);
    img.src = src;
    img.alt = alt || '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', function () {
      var frame = img.closest('.lead__image');
      if (frame) { frame.remove(); document.getElementById('lead').classList.add('lead--noimage'); }
      else img.remove();
    });
    return img;
  }

  function meta(article, withRelative) {
    var p = el('p', 'meta');
    p.appendChild(el('span', 'meta__source', article.source));
    if (withRelative) p.appendChild(el('span', null, relative(new Date(article.date))));
    return p;
  }

  function renderLead(article) {
    var lead = document.getElementById('lead');
    lead.replaceChildren();
    lead.className = 'lead';
    if (!article) { lead.hidden = true; return; }
    lead.hidden = false;
    if (article.image) {
      var frame = el('div', 'lead__image');
      frame.appendChild(image(article.image, null, ''));
      lead.appendChild(frame);
    } else {
      lead.classList.add('lead--noimage');
    }
    var text = el('div', 'lead__text');
    text.appendChild(meta(article, true));
    var h = el('h2', 'lead__title');
    h.appendChild(link(article, article.title));
    text.appendChild(h);
    if (article.summary) text.appendChild(el('p', 'lead__summary', article.summary));
    lead.appendChild(text);
  }

  function renderStream(articles) {
    var stream = document.getElementById('stream');
    stream.replaceChildren();
    var lastDay = null;
    var now = Date.now();
    articles.slice(0, STREAM_LIMIT).forEach(function (article) {
      var date = new Date(article.date);
      var key = dayKey(date);
      if (key !== lastDay) {
        var heading = el('li', 'day');
        heading.setAttribute('role', 'presentation');
        heading.appendChild(el('h3', null, dayLabel(date))).style.font = 'inherit';
        stream.appendChild(heading);
        lastDay = key;
      }
      var item = el('li', 'story');
      if (now - date < NEW_MINUTES * 60000) item.classList.add('story--new');
      var time = el('time', 'story__time', timeOf(date));
      time.dateTime = article.date;
      item.appendChild(time);

      var body = el('div', 'story__body');
      var h = el('h4', 'story__title');
      h.appendChild(link(article, article.title));
      body.appendChild(h);
      body.appendChild(meta(article, false));
      if (article.summary) body.appendChild(el('p', 'story__summary', article.summary));
      item.appendChild(body);
      if (article.image) item.appendChild(image(article.image, 'story__thumb', ''));
      stream.appendChild(item);
    });
  }

  function renderEmpty() {
    var stream = document.getElementById('stream');
    var box = el('li', 'empty');
    box.appendChild(el('p', null, state.lang === 'all' ? t().emptyAny : t().emptyLang));
    if (state.lang !== 'all') {
      var button = el('button', null, t().showAll);
      button.type = 'button';
      button.addEventListener('click', function () { setLang('all'); });
      box.appendChild(button);
    }
    stream.appendChild(box);
  }

  function render() {
    var text = t();
    document.documentElement.lang = state.lang === 'en' ? 'en' : 'id';
    document.querySelectorAll('[data-t]').forEach(function (node) {
      var value = text[node.getAttribute('data-t')];
      if (value) node.textContent = value;
    });

    document.querySelectorAll('#tabs a').forEach(function (tab) {
      tab.setAttribute('aria-selected', String(tab.dataset.section === state.section));
    });
    document.querySelectorAll('#lang button').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.lang === state.lang));
    });

    document.getElementById('today').textContent = new Intl.DateTimeFormat(text.locale, {
      timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    }).format(new Date());
    document.getElementById('updated').textContent = text.updated + ' ' + relative(new Date(data.updated));
    document.getElementById('sources').textContent = data.sources.join(', ');

    var articles = data.articles.filter(function (a) {
      return a.section === state.section && (state.lang === 'all' || a.lang === state.lang);
    });
    var lead = articles.slice(0, 8).find(function (a) { return a.image; }) || articles[0];
    renderLead(lead);
    renderStream(articles.filter(function (a) { return a !== lead; }));
    if (!articles.length) renderEmpty();
  }

  function setLang(lang) {
    state.lang = lang;
    localStorage.setItem('ww-lang', lang);
    render();
  }

  document.getElementById('lang').addEventListener('click', function (event) {
    var button = event.target.closest('button[data-lang]');
    if (button) setLang(button.dataset.lang);
  });

  window.addEventListener('hashchange', function () {
    state.section = sectionFromHash();
    render();
    window.scrollTo({ top: 0 });
  });

  render();
  setInterval(render, 60000); // keeps "5 minutes ago" labels fresh
})();
