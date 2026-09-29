// Fixture SPA. Vanilla JS, no framework. Everything a crawler would want is added after load.
const PAGES = {
  '/': {
    title: 'Fixture Shop | Home',
    description: 'A fixture shop used to test crawler-prerender.',
    canonical: '/',
    h1: 'Fixture Shop',
    body: [
      'Fixture Shop sells imaginary widgets to imaginary customers, and exists only so that a test can tell the difference between markup a crawler receives and markup a browser builds.',
      'Every sentence on this page is added by JavaScript after the document loads, which is exactly what a client-rendered single page app does when nothing prerenders it.',
      'If you are reading this in a raw HTTP response, prerendering is working.',
    ],
    links: ['/about', '/products/widget', '/streamed', '/ssr', '/gone', '/redirect-me', '/private/secret', '/file.pdf'],
    jsonLd: { '@context': 'https://schema.org', '@type': 'Organization', name: 'Fixture Shop', url: 'https://fixture.test/' },
  },
  '/about': {
    title: 'About | Fixture Shop',
    description: 'About the fixture shop.',
    canonical: '/about',
    h1: 'About the fixture',
    body: [
      'The fixture team is one function that returns an object. It has no staff, no office and no opinions about widgets.',
      'This page links to a child page that is only reachable by following a link that JavaScript renders, which lets the crawl test check depth handling.',
    ],
    links: ['/', '/about/team'],
    jsonLd: { '@context': 'https://schema.org', '@type': 'AboutPage', name: 'About the fixture' },
  },
  '/about/team': {
    title: 'Team | Fixture Shop',
    description: 'The fixture team.',
    canonical: '/about/team',
    h1: 'The fixture team',
    body: ['The team is a single function. It is reachable from the about page and from nowhere else, at depth two from the home page.'],
    links: ['/about'],
  },
  '/products/widget': {
    title: 'Widget | Fixture Shop',
    description: 'The one widget.',
    canonical: '/products/widget',
    h1: 'The Widget',
    body: [
      'The widget is a small imaginary object with a well documented price of nothing and a well documented weight of nothing.',
      'It has a reviews section below that appears seven hundred milliseconds after the page finishes loading, standing in for a lazy chunk or a timer.',
    ],
    links: ['/'],
    late: { after: 700, h2: 'Reviews', text: 'Nobody has reviewed the widget, because it does not exist. This paragraph arrives late on purpose.' },
    jsonLd: { '@context': 'https://schema.org', '@type': 'Product', name: 'Widget' },
  },
  '/private/secret': {
    title: 'Private | Fixture Shop',
    description: 'Disallowed by robots.txt.',
    canonical: '/private/secret',
    h1: 'Private page',
    body: ['A crawl that respects robots.txt never reaches this page, however many links point to it.'],
    links: ['/'],
  },
};

const page = PAGES[location.pathname.replace(/\/+$/, '') || '/'];

function setMeta(name, content) {
  let m = document.querySelector(`meta[name="${name}"]`);
  if (!m) {
    m = document.createElement('meta');
    m.name = name;
    document.head.appendChild(m);
  }
  m.content = content;
}

async function start() {
  // A real network request so the page has something for network idle to wait on.
  await fetch('/api/content.json').then((r) => r.json());
  const root = document.getElementById('app');
  if (!page) {
    root.innerHTML = '<main><h1>Not found</h1><p>No such fixture page.</p></main>';
    return;
  }
  document.title = page.title;
  setMeta('description', page.description);
  let c = document.querySelector('link[rel="canonical"]');
  if (!c) {
    c = document.createElement('link');
    c.rel = 'canonical';
    document.head.appendChild(c);
  }
  c.href = location.origin + page.canonical;

  const nav = page.links.map((l) => `<a href="${l}">${l}</a>`).join(' ');
  root.innerHTML = `<header><nav>${nav}</nav></header><main><h1>${page.h1}</h1>${page.body
    .map((p) => `<p>${p}</p>`)
    .join('')}</main><footer><small>Fixture footer</small></footer>`;

  if (page.jsonLd) {
    const s = document.createElement('script');
    s.type = 'application/ld+json';
    s.textContent = JSON.stringify(page.jsonLd);
    document.head.appendChild(s);
  }
  if (page.late) {
    setTimeout(() => {
      const main = root.querySelector('main');
      main.insertAdjacentHTML('beforeend', `<section><h2>${page.late.h2}</h2><p>${page.late.text}</p></section>`);
    }, page.late.after);
  }
}

start();
