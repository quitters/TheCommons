async function refreshJoinCode() {
  try {
    const response = await fetch('/shared/join-current.json', { cache: 'no-store' });
    if (!response.ok) return;
    const config = await response.json();
    const url = new URL(config.url);
    if (!['https:', 'http:'].includes(url.protocol)) return;
    for (const card of document.querySelectorAll('[data-join-card]')) {
      const image = card.querySelector('[data-join-image]');
      const src = `/shared/join-qr.svg?v=${encodeURIComponent(config.updatedAt)}`;
      if (image.getAttribute('src') !== src) image.src = src;
      card.querySelector('[data-join-link]').href = url.href;
      card.hidden = false;
    }
    const empty = document.getElementById('joinEmpty');
    if (empty) empty.hidden = true;
  } catch { /* An unconfigured/offline join link must not interrupt the canvas. */ }
}
refreshJoinCode();
setInterval(refreshJoinCode, 10_000);
