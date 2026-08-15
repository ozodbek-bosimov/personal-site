// about-stats.js
// This script lives inside {% block content %} in about.html, so HTMX boost
// re-executes it on every navigation to /about — no extra event listeners needed.
// On a hard page load the DOM is already parsed when this runs (script is at
// the bottom of the block), so we call initAboutStats() directly.

(function () {
let _aboutStatsInitTimer = null;
function initAboutStats() {
  if (_aboutStatsInitTimer) clearTimeout(_aboutStatsInitTimer);
  _aboutStatsInitTimer = setTimeout(() => {
    const configData = document.getElementById("about-config-data");
    const githubUrl = configData ? configData.dataset.github : "";
    let ghUsername = null;
    if (githubUrl) {
      const match = githubUrl.match(/github\.com\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) ghUsername = match[1];
    }

    // Time-bucketed cache-buster: refreshes once per hour.
    const cbStr = Math.floor(Date.now() / 3600000).toString();
    let statsUrl = "", langsUrl = "", streakUrl = "";

    const langsMq = window.matchMedia("(min-width: 640px)");
    const buildLangsUrl = (cardWidth) =>
      `https://github-readme-stats-salesp07.vercel.app/api/top-langs/?username=${ghUsername}&title_color=67e8f9&text_color=c9d1d9&icon_color=06b6d4&bg_color=00000000&hide_border=true&layout=compact&card_width=${cardWidth}&v=${cbStr}`;
    const currentLangsCardWidth = () => (langsMq.matches ? 320 : 495);

    if (ghUsername) {
      statsUrl = `https://github-readme-stats-salesp07.vercel.app/api?username=${ghUsername}&title_color=67e8f9&text_color=c9d1d9&icon_color=06b6d4&bg_color=00000000&hide_border=true&include_all_commits=true&count_private=true&rank_icon=github&show_icons=true&v=${cbStr}`;
      langsUrl = buildLangsUrl(currentLangsCardWidth());
      streakUrl = `https://github-readme-streak-stats-salesp07.vercel.app/?user=${ghUsername}&theme=dark&hide_border=true&background=00000000&stroke=334155&ring=06b6d4&fire=67e8f9&v=${cbStr}`;

      // Preload in the background
      setTimeout(() => {
        new Image().src = statsUrl;
        new Image().src = langsUrl;
        new Image().src = streakUrl;
      }, 50);
    }

    let leetcodeUrl = configData ? configData.dataset.leetcode : "";
    let leetcodeProxyUrl = null;
    if (leetcodeUrl && leetcodeUrl.includes("leetcode.com")) {
      leetcodeProxyUrl = `/leetcode-proxy/?v=${cbStr}`;
    }

  // ── GitHub Stats ──────────────────────────────────────────────────────────
  const initGithubStats = function () {
    if (!ghUsername) return;

    const statsImg  = document.getElementById("github-stats-img");
    const langsImg  = document.getElementById("github-langs-img");
    const streakImg = document.getElementById("github-streak-img");
    const container = document.getElementById("github-calendar-container");
    const calWrap   = document.getElementById("github-cal-wrap");

    // Reserve space for the calendar so layout doesn't jump. The +30px
    // leaves room for the date-range label row below the fit-scaled grid,
    // so it can never be clipped by the wrapper's overflow: hidden.
    const setCalReserve = () => {
      if (!calWrap) return;
      const w = calWrap.clientWidth;
      if (!w) return;
      calWrap.style.height = Math.round(0.16 * w + 30) + "px";
    };
    setCalReserve();
    // Clean up previous resize listener to prevent accumulation
    if (window._aboutCalResize) window.removeEventListener("resize", window._aboutCalResize);
    window._aboutCalResize = setCalReserve;
    window.addEventListener("resize", setCalReserve);

    // Sequential reveal: stats → langs → streak → calendar
    const items = [
      { id: "stats",  el: statsImg,  skel: "github-stats-skeleton"  },
      { id: "langs",  el: langsImg,  skel: "github-langs-skeleton"  },
      { id: "streak", el: streakImg, skel: "github-streak-skeleton" },
      { id: "cal",    isCal: true },
    ];

    let calTurnReached = false;
    let calReadyToReveal = false;
    let revealCalendarFn = null;

    const tryRevealCal = () => {
      if (calTurnReached && calReadyToReveal && revealCalendarFn) {
        revealCalendarFn();
      }
    };

    const showImg = (img, skelId) => {
      if (!img) return;
      const skel = document.getElementById(skelId);
      if (skel) skel.style.display = "none";
      img.classList.replace("github-img-hidden", "github-img-show");
    };

    const startTurn = (index) => {
      if (index >= items.length) return;
      const item = items[index];
      item.isMyTurn = true;

      if (item.isCal) {
        calTurnReached = true;
        tryRevealCal();
        return;
      }

      if (item.loaded) {
        showImg(item.el, item.skel);
        item.shown = true;
        setTimeout(() => startTurn(index + 1), 500);
      } else {
        item.timeout = setTimeout(() => {
          item.timedOut = true;
          startTurn(index + 1);
        }, 2000);
      }
    };

    const handleLoad = (index) => {
      const item = items[index];
      item.loaded = true;
      if (item.isMyTurn && !item.shown) {
        showImg(item.el, item.skel);
        item.shown = true;
        if (!item.timedOut) {
          clearTimeout(item.timeout);
          setTimeout(() => startTurn(index + 1), 500);
        }
      }
    };

    if (statsImg) {
      statsImg.onload = () => handleLoad(0);
      statsImg.src = statsUrl;
      if (statsImg.complete && statsImg.naturalWidth) handleLoad(0);
    } else items[0].loaded = true;

    if (langsImg) {
      langsImg.onload = () => handleLoad(1);
      langsImg.src = langsUrl;
      if (langsImg.complete && langsImg.naturalWidth) handleLoad(1);

      const swapLangs = () => {
        const next = buildLangsUrl(currentLangsCardWidth());
        if (langsImg.src !== next) langsImg.src = next;
      };
      // Clean up previous matchMedia listener to prevent accumulation
      if (window._aboutLangsMqHandler && langsMq.removeEventListener) {
        langsMq.removeEventListener("change", window._aboutLangsMqHandler);
      }
      window._aboutLangsMqHandler = swapLangs;
      if (langsMq.addEventListener) langsMq.addEventListener("change", swapLangs);
      else if (langsMq.addListener)  langsMq.addListener(swapLangs);
    } else items[1].loaded = true;

    if (streakImg) {
      streakImg.onload = () => handleLoad(2);
      streakImg.src = streakUrl;
      if (streakImg.complete && streakImg.naturalWidth) handleLoad(2);
    } else items[2].loaded = true;

    // ── GitHub Contribution Calendar ─────────────────────────────────────
    const tryFallbackCalendar = () => {
      if (!container) return;
      container.innerHTML = `<img src="https://ghchart.rshah.org/06b6d4/${ghUsername}" alt="GitHub Contribution Calendar" style="width:100%;height:auto;padding-bottom:1rem;filter:invert(1) hue-rotate(180deg) brightness(1.2);" onerror="const p=this.closest('.profile-panel--full');if(p)p.style.display='none';">`;
      container.style.opacity = "1";
      container.style.height  = "auto";
      container.style.overflow = "visible";
      const skel = document.getElementById("github-cal-skeleton");
      if (skel) skel.style.display = "none";
    };

    const initGitHubCalendar = () => {
      if (!container) return;

      // Clear flags from any previous visit so the calendar re-inits cleanly
      delete container.dataset.initialized;
      delete container.dataset.revealed;
      delete container.dataset.fitBound;
      container.innerHTML = "";

      container.dataset.initialized = "true";

      revealCalendarFn = () => {
        if (container.dataset.revealed) return;
        container.dataset.revealed = "true";

        const skel = document.getElementById("github-cal-skeleton");
        if (skel) skel.style.display = "none";

        container.style.height   = "auto";
        container.style.overflow = "visible";

        setTimeout(() => {
          container.style.opacity  = "1";
          container.style.animation = "fadeInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards";
        }, 100);

        document.querySelectorAll("#github-calendar-container .contrib-column").forEach((el) => {
          if (el.parentElement && el.parentElement.className.includes("flex-wrap")) {
            el.parentElement.style.display = "none";
          }
          el.style.display = "none";
        });
        document.querySelectorAll("#github-calendar-container .text-muted").forEach((el) => {
          el.style.display = "none";
        });
      };

      const fitGithubCalendar = () => {
        const grid =
          container.querySelector(".ContributionCalendar-grid") ||
          container.querySelector("svg.js-calendar-graph-svg") ||
          container.querySelector(".calendar-graph svg") ||
          container.querySelector("svg") ||
          container.querySelector("table");
        if (!grid) return;
        grid.style.zoom = "";
        grid.style.transform = "none";
        grid.style.transformOrigin = "top left";
        grid.style.margin = "0";
        const gridRect = grid.getBoundingClientRect();
        const contRect = container.getBoundingClientRect();
        const naturalW = gridRect.width;
        const naturalH = gridRect.height;
        const avail    = contRect.right - gridRect.left;
        if (!naturalW || avail <= 0) return;
        const scale = avail / naturalW;
        grid.style.transform    = `scale(${scale})`;
        grid.style.marginRight  = `-${naturalW - avail}px`;
        grid.style.marginBottom = `-${naturalH * (1 - scale)}px`;

        // Scale the date-range labels with the grid so they stay
        // proportional on narrow screens (LeetCode-style). Above 60%
        // grid scale they keep their fixed 0.6rem, so desktop looks
        // exactly as before.
        var labels = container.querySelector(".calendar-range-labels");
        if (labels) {
          var labelScale = Math.min(1, Math.max(scale / 0.6, 0.42));
          labels.style.fontSize  = 0.6 * labelScale + "rem";
          labels.style.marginTop = 0.15 * labelScale + "rem";
        }
      };

      const enhanceCalendar = () => {
        const cells = document.querySelectorAll("#github-calendar-container .ContributionCalendar-day");
        const validCells = Array.from(cells).filter(
          (c) => c.hasAttribute("data-date") && c.getAttribute("data-level") !== null,
        );
        if (!validCells.length) return false;

        validCells.sort((a, b) => a.getAttribute("data-date").localeCompare(b.getAttribute("data-date")));
        const lastCell = validCells[validCells.length - 1];

        lastCell.style.boxShadow    = "0 0 0 1px #ffa116, inset 0 0 0 1px #ffa116";
        lastCell.style.boxSizing    = "border-box";
        lastCell.style.backgroundColor = "transparent";

        // Date-range row, LeetCode-heatmap style: one small date at each
        // corner, tight against the grid. Appended to the container, NOT the
        // graph wrapper — the wrapper clips its overflow (overflow-y: hidden
        // in about.css), which cut the row off at the bottom edge once the
        // fit-shrunk grid re-measured. The container is overflow-visible
        // after reveal, so the row can never be clipped.
        if (!container.querySelector(".calendar-range-labels")) {
          const fmtDate = (d) => {
            const parts = d.split("-");
            return parts[0] + "." + parseInt(parts[1], 10) + "." + parseInt(parts[2], 10);
          };
          const firstDate = fmtDate(validCells[0].getAttribute("data-date"));
          const lastDate  = fmtDate(lastCell.getAttribute("data-date"));
          const datesDiv  = document.createElement("div");
          datesDiv.className = "calendar-range-labels";
          const firstSpan = document.createElement("span");
          firstSpan.textContent = firstDate;
          const lastSpan = document.createElement("span");
          lastSpan.textContent = lastDate;
          datesDiv.appendChild(firstSpan);
          datesDiv.appendChild(lastSpan);
          container.appendChild(datesDiv);
        }

        calReadyToReveal = true;

        fitGithubCalendar();
        tryRevealCal();

        requestAnimationFrame(() => {
          fitGithubCalendar();
          requestAnimationFrame(fitGithubCalendar);
        });

        // The table's natural width depends on the loaded fonts (month/day
        // labels), which arrive asynchronously. If they finish after this
        // first fit, the scale is stale and the grid's right edge gets
        // clipped — re-fit once fonts are ready and once the window load
        // settles.
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(function () {
            fitGithubCalendar();
            requestAnimationFrame(fitGithubCalendar);
          });
        }
        if (document.readyState !== "complete") {
          window.addEventListener(
            "load",
            function onLoadRefit() {
              fitGithubCalendar();
              requestAnimationFrame(fitGithubCalendar);
            },
            { once: true },
          );
        }

        if (!container.dataset.fitBound) {
          container.dataset.fitBound = "true";
          if ("ResizeObserver" in window) {
            new ResizeObserver(() => fitGithubCalendar()).observe(container);
          } else {
            let t = null;
            window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(fitGithubCalendar, 150); });
          }
          if ("MutationObserver" in window) {
            new MutationObserver(() => requestAnimationFrame(fitGithubCalendar))
              .observe(container, { childList: true, subtree: true });
          }
        }
        return true;
      };

      const waitForCalendar = (attempt = 0) => {
        if (enhanceCalendar()) return;
        if (attempt < 20) {
          setTimeout(() => waitForCalendar(attempt + 1), 150);
        } else {
          tryFallbackCalendar();
        }
      };

      // Fetch the calendar markup straight from the internal proxy
      // (home.views.github_calendar_proxy). It fetches GitHub server-side
      // and is same-origin, so it works where the browser is blocked.
      fetch(`/github-contributions/`)
        .then((r) => {
          if (!r.ok) throw new Error("Internal proxy failed");
          return r.text();
        })
        .then((html) => {
          if (!container) return;
          container.innerHTML = html;
          waitForCalendar();
        })
        .catch((e) => {
          console.error("GitHub Calendar error:", e);
          tryFallbackCalendar();
        });
    };

    initGitHubCalendar();
    startTurn(0);
  };

  // ── LeetCode Stats ────────────────────────────────────────────────────────
  const initLeetcodeStats = function () {
    if (!leetcodeProxyUrl) return;
    const lcWrapper = document.getElementById("leetcode-stats-wrapper");
    if (!lcWrapper) return;

    lcWrapper.innerHTML = `<img id="leetcode-stats-svg" class="profile-media__img github-img-hidden" alt="LeetCode Stats">`;
    const lcImg = document.getElementById("leetcode-stats-svg");
    const reveal = () => {
      lcWrapper.classList.remove("skeleton-loader");
      lcImg.classList.replace("github-img-hidden", "github-img-show");
    };
    lcImg.onload = reveal;
    lcImg.src = leetcodeProxyUrl;
    if (lcImg.complete && lcImg.naturalWidth) reveal();
  };

  // ── Run ───────────────────────────────────────────────────────────────────
  // The script is in {% block content %} so it executes after the DOM for
  // this page is already in place. Use IntersectionObserver only on a true
  // hard-load where the section might be below the fold; on HTMX navigation
  // the page content is swapped synchronously, so the section is usually
  // already in the viewport — observe it and fire immediately if visible.

  const ghContainer = document.querySelector(".profile-card--github");
  if (ghContainer && "IntersectionObserver" in window) {
    const ghObserver = new IntersectionObserver(
      (entries, obs) => {
        if (
          entries[0].isIntersecting ||
          entries[0].boundingClientRect.top < window.innerHeight
        ) {
          obs.disconnect();
          initGithubStats();
        }
      },
      { rootMargin: "50px", threshold: 0.1 },
    );
    ghObserver.observe(ghContainer);
  } else {
    initGithubStats();
  }

  const lcContainer = document.querySelector(".profile-card--leetcode");
  if (lcContainer && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries, obs) => {
        if (
          entries[0].isIntersecting ||
          entries[0].boundingClientRect.top < window.innerHeight
        ) {
          obs.disconnect();
          initLeetcodeStats();
        }
      },
      { rootMargin: "50px", threshold: 0.1 },
    );
    observer.observe(lcContainer);
  } else {
    initLeetcodeStats();
  }
  }, 50); // end of debounce
}

// Run immediately for initial page load (DOM is already parsed up to this point)
setTimeout(initAboutStats, 10);

// Set up HTMX navigation listeners (only once)
if (!window._aboutStatsListenerAdded) {
  // htmx 2.0 fires ONLY htmx:historyRestore on back/forward restores.
  function handleNav() {
    if (window.location.pathname.includes('/about')) {
      initAboutStats();
    }
  }
  document.addEventListener("htmx:afterSettle", handleNav);
  document.addEventListener("htmx:historyRestore", handleNav);
  window._aboutStatsListenerAdded = true;
}
})();
