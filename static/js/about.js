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
