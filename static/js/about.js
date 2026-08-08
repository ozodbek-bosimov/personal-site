// about.js
// Lives inside {% block content %} in about.html — HTMX re-executes it on
// every navigation to /about, so no extra event listeners are needed.

function initAbout() {
  document.querySelectorAll('.skill-bar').forEach(bar => {
    const percentage = bar.getAttribute('data-percentage');
    bar.style.setProperty('--target-width', percentage + '%');
  });
}

// DOM is already ready when this runs (script is at the bottom of the block).
initAbout();

// ── Timeline card click delegation ─────────────────────────────────
// Clicking anywhere on a card with data-company-url opens the company,
// EXCEPT on more/less toggle buttons.
document.querySelectorAll('.timeline-card[data-company-url]').forEach(function (card) {
  card.addEventListener('click', function (e) {
    // Don't navigate if user clicked a more/less button or an existing link
    if (e.target.closest('.timeline-inline-more, .timeline-inline-less, a')) return;
    var url = card.getAttribute('data-company-url');
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  });
});

function toggleBullets(listId) {
  const list = document.getElementById(listId);
  if (!list) return;
  const hiddenItems = list.querySelectorAll('.hidden-bullet');
  const ellipsis = list.querySelector('.timeline-ellipsis');
  const moreBtn = list.querySelector('.timeline-inline-more');

  if (hiddenItems.length > 0) {
    hiddenItems.forEach(item => {
      item.classList.remove('hidden-bullet');
      item.classList.add('shown-bullet');
    });
    if (ellipsis) ellipsis.style.display = 'none';
    if (moreBtn) moreBtn.style.display = 'none';
  } else {
    const shownItems = list.querySelectorAll('.shown-bullet');
    shownItems.forEach(item => {
      item.classList.remove('shown-bullet');
      item.classList.add('hidden-bullet');
    });
    if (ellipsis) ellipsis.style.display = 'inline';
    if (moreBtn) moreBtn.style.display = 'inline';
  }
}
