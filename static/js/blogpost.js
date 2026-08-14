(function () {
  function initBlogPost() {
    // Clean up previous scroll listener
    if (window._blogpostScrollListener) {
      window.removeEventListener("scroll", window._blogpostScrollListener);
      window._blogpostScrollListener = null;
    }
    if (window._tocScrollListener) {
      window.removeEventListener("scroll", window._tocScrollListener);
      window._tocScrollListener = null;
    }
    if (window._tocMainScrollLock) {
      window.removeEventListener("scroll", window._tocMainScrollLock);
      window._tocMainScrollLock = null;
    }

    /* ── Lazy Load Iframes (Run First to ensure they load even if other things fail) ────────────────────────────────────────── */
    function runLazyIframes() {
        var phs = document.querySelectorAll(".lazy-iframe-ph");
        if (!phs.length) return;

        var queue = [];

        function loadIframe(ph) {
            if (ph._loaded) return;
            ph._loaded = true;
            var tpl = ph.nextElementSibling;
            if (!tpl || tpl.tagName !== "TEMPLATE") return;
            var el = tpl.content.firstElementChild;
            if (!el) return;
            var iframe = el.cloneNode(true);
            ph.parentNode.insertBefore(iframe, ph);
            ph.remove();
            tpl.remove();
        }

        if ("IntersectionObserver" in window) {
            try {
                var obs = new IntersectionObserver(function(entries){
                    entries.forEach(function(e){
                        if (e.isIntersecting) {
                            obs.unobserve(e.target);
                            loadIframe(e.target);
                        }
                    });
                }, {rootMargin: "300px 0px"});
                phs.forEach(function(ph){ obs.observe(ph); queue.push(ph); });
            } catch (err) {
                console.error("IntersectionObserver failed:", err);
                phs.forEach(loadIframe);
                return;
            }
        } else {
            phs.forEach(loadIframe);
            return;
        }

        setTimeout(function tick(){
            while (queue.length && queue[0]._loaded) queue.shift();
            if (!queue.length) return;
            var ph = queue.shift();
            if (obs) try { obs.unobserve(ph); } catch(e){}
            loadIframe(ph);
            if (queue.length) setTimeout(tick, 1500);
        }, 2000);
    }    try {
        runLazyIframes();
    } catch (e) {
        console.error("Lazy iframe error:", e);
    }

    /* ── CKEditor / Bare Links Embeds Processing ───────────────────── */
    function processEmbeds() {
      const content = document.querySelector('.blog-content');
      if (!content) return;

      // Twitter/X embed — uses X's official widgets.js. widgets.js dynamically
      // sizes the tweet card to its exact content height (including videos/media)
      // and updates layout when media finishes loading.
      function makeTwitterEmbed(tweetId) {
        const bq = document.createElement('blockquote');
        bq.className = 'twitter-tweet';
        bq.setAttribute('data-theme', 'dark');
        bq.setAttribute('data-dnt', 'true');
        const a = document.createElement('a');
        a.href = `https://twitter.com/x/status/${tweetId}`;
        bq.appendChild(a);
        return bq;
      }

      // Helper: create an Instagram embed iframe
      function makeInstagramEmbed(shortcode) {
        const iframe = document.createElement('iframe');
        iframe.src = `https://www.instagram.com/p/${shortcode}/embed/?theme=dark`;
        iframe.className = "embed-responsive embed-responsive--instagram";
        iframe.setAttribute('frameborder', '0');
        iframe.setAttribute('scrolling', 'no');
        iframe.setAttribute('allowtransparency', 'true');
        iframe.setAttribute('allowfullscreen', 'true');
        iframe.style.colorScheme = 'dark';
        return iframe;
      }

      let hasTwitterEmbed = false;

      // 1. Process <oembed> tags (Twitter, Instagram)
      content.querySelectorAll('oembed').forEach(oembed => {
        let url = oembed.getAttribute('url') || '';
        if (!url) return;
        let figure = oembed.closest('figure.media') || oembed.parentElement;

        if (url.includes('twitter.com') || url.includes('x.com')) {
          url = url.replace('x.com', 'twitter.com');
          const match = url.match(/\/status\/(\d+)/);
          if (match && match[1]) {
            figure.parentNode.replaceChild(makeTwitterEmbed(match[1]), figure);
            hasTwitterEmbed = true;
          }
        } else if (url.includes('instagram.com')) {
          const match = url.match(/\/(?:p|reel)\/([^\/?#&]+)/);
          if (match && match[1]) {
            figure.parentNode.replaceChild(makeInstagramEmbed(match[1]), figure);
          }
        }
      });

      // 2. Convert bare links (LinkedIn, Instagram, Twitter) into embeds
      content.querySelectorAll('a').forEach(link => {
        const url = link.href;
        const parent = link.parentElement;
        if (!parent || parent.tagName !== 'P') return;
        if (parent.textContent.trim() !== link.textContent.trim()) return;

        if (url.includes('linkedin.com/posts/')) {
          const match = url.match(/-([0-9]{19})/);
          if (match && match[1]) {
            const urnId = match[1];
            let urnType = 'share';
            if (url.includes('ugcPost')) urnType = 'ugcPost';
            else if (url.includes('activity')) urnType = 'activity';
            const iframe = document.createElement('iframe');
            iframe.src = `https://www.linkedin.com/embed/feed/update/urn:li:${urnType}:${urnId}?theme=dark`;
            iframe.className = "embed-responsive embed-responsive--linkedin";
            iframe.frameBorder = "0";
            iframe.scrolling = "yes";
            iframe.allowTransparency = "true";
            iframe.allowFullscreen = "true";
            iframe.title = "Embedded LinkedIn post";
            parent.parentNode.replaceChild(iframe, parent);
          }
        } else if (url.includes('instagram.com/')) {
          const match = url.match(/\/(?:p|reel)\/([^\/?#&]+)/);
          if (match && match[1]) {
            parent.parentNode.replaceChild(makeInstagramEmbed(match[1]), parent);
          }
        } else if (url.includes('twitter.com/') || url.includes('x.com/')) {
          const normalizedUrl = url.replace('x.com', 'twitter.com');
          const match = normalizedUrl.match(/\/status\/(\d+)/);
          if (match && match[1]) {
            parent.parentNode.replaceChild(makeTwitterEmbed(match[1]), parent);
            hasTwitterEmbed = true;
          }
        }
      });

      // Load/render X widgets if twitter embeds were found
      if (hasTwitterEmbed || content.querySelector('blockquote.twitter-tweet')) {
        if (window.twttr && window.twttr.widgets) {
          window.twttr.widgets.load(content);
        } else if (!document.getElementById('twitter-wjs')) {
          const script = document.createElement('script');
          script.id = 'twitter-wjs';
          script.src = 'https://platform.twitter.com/widgets.js';
          script.async = true;
          document.head.appendChild(script);
        }
      }
    }

    try {
      processEmbeds();
    } catch (e) {
      console.error("Embed processing error:", e);
    }

    /* ── Auto-resize Instagram embed iframes ──────────── */
    if (!window._embedResizeListenerAdded) {
      window._embedResizeListenerAdded = true;
      window.addEventListener('message', function (e) {

        // Instagram embed resize
        if (e.origin && e.origin.includes('instagram.com') && e.data) {
          var igData = e.data;
          if (typeof igData === 'string') {
            try { igData = JSON.parse(igData); } catch (err) { return; }
          }
          if (igData.type === 'MEASURE' && igData.details && igData.details.height) {
            var igH = igData.details.height;
            document.querySelectorAll('.embed-responsive--instagram').forEach(function (iframe) {
              try {
                if (iframe.contentWindow === e.source) {
                  iframe.style.height = igH + 'px';
                }
              } catch (err) { }
            });
          }
        }
      });
    }

    /* ── Reading Progress Bar ─────────────────────────────────────── */
    const progressBar = document.getElementById("reading-progress-bar");

    if (progressBar) {
      let progressTicking = false;
      function updateProgressBar() {
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const docHeight =
          document.documentElement.scrollHeight -
          document.documentElement.clientHeight;
        const progress = docHeight > 0 ? Math.min(Math.max(scrollTop / docHeight, 0), 1) : 0;
        progressBar.style.transform = `scaleX(${progress})`;
        progressTicking = false;
      }

      window._blogpostScrollListener = function() {
        if (!progressTicking) {
          requestAnimationFrame(updateProgressBar);
          progressTicking = true;
        }
      };
      window.addEventListener("scroll", window._blogpostScrollListener, { passive: true });
      updateProgressBar();
    }

    /* ── Floating Table of Contents ───────────────────────────────── */
    const tocContainer = document.getElementById("toc-sidebar-container");
    const tocBox = document.getElementById("toc-box");
    const tocNav = document.getElementById("floating-toc-nav");
    const blogContent = document.querySelector(".blog-content");

    if (tocContainer && tocBox && tocNav && blogContent) {
      // The post body can contain interactive toolkit blocks (accordions,
      // flashcards, pros/cons, forms, etc.). Their internal headings are
      // control labels, not article sections, so showing them in the floating
      // table of contents makes the menu noisy and can jump readers into a
      // widget rather than a section of the post.
      const headings = Array.from(blogContent.querySelectorAll("h2, h3")).filter(
        (heading) => {
          const label = heading.textContent.replace(/\u00a0/g, " ").trim();
          return (
            label &&
            !heading.hidden &&
            !heading.closest(
              ".tk-accordion, .tk-quiz, .tk-cards, .tk-tabs, .tk-form, .tk-rating, .tk-cta, .tk-spoiler, nav, aside, form, button, [role='tab'], [role='dialog'], details",
            )
          );
        },
      );
      
      if (headings.length >= 1) {
        tocContainer.style.display = "block";
        
        let hoverTimeout;
        tocContainer.addEventListener("mouseenter", () => {
            clearTimeout(hoverTimeout);
            hoverTimeout = setTimeout(() => {
                tocContainer.classList.add("is-hovered");
            }, 180); // delay to prevent accidental flashing
        });
        tocContainer.addEventListener("mouseleave", () => {
            clearTimeout(hoverTimeout);
            hoverTimeout = setTimeout(() => {
                if (!tocContainer.classList.contains('is-locked-open')) {
                    tocContainer.classList.remove("is-hovered");
                }
            }, 180); 
        });

        // Lock-release is handled inside the single throttled scroll
        // listener below (it used to be a separate unthrottled listener).

        tocNav.innerHTML = "";
        
        let activeLink = null;
        
        headings.forEach((heading, index) => {
          if (!heading.id) {
            heading.id = "heading-" + index;
          }
          const link = document.createElement("a");
          link.href = "#" + heading.id;
          link.className = "toc-item group/item flex items-center justify-end w-full cursor-pointer transition-colors shrink-0 px-1";
          
          const dash = document.createElement("span");
          dash.className = "toc-dash w-5 h-[2.5px] rounded-full bg-slate-400 transition-all duration-200";
          
          const text = document.createElement("span");
          text.textContent = heading.textContent;
          text.className = "toc-text text-[12px] text-slate-400 truncate rounded-md px-2 py-1 transition-all flex-1 min-w-0 text-left";
          
          if (heading.tagName.toLowerCase() === "h3") {
            text.classList.add("text-[11.5px]", "text-slate-400/80");
          } else {
            text.classList.add("font-semibold", "text-slate-200");
          }
          
          link.appendChild(dash);
          link.appendChild(text);
          
          link.addEventListener("click", (e) => {
             e.preventDefault();
             
             if (tocContainer) {
                 tocContainer.classList.add('is-locked-open');
                 tocContainer.classList.add('is-hovered');
                 // The scroll listener will automatically remove the lock when scroll finishes
             }

             const target = heading.getBoundingClientRect().top + window.scrollY - 80;
             window.scrollTo({ top: target, behavior: "smooth" });

             // If the page is already at the target (or the target is clamped
             // beyond max scroll), no scroll events will fire and the lock would
             // never clear — release it manually after a short delay.
             const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
             const effective = Math.max(0, Math.min(target, maxScroll));
             if (Math.abs(effective - window.scrollY) < 2) {
                 setTimeout(() => {
                     tocContainer.classList.remove('is-locked-open');
                     if (!tocContainer.matches(':hover')) {
                         tocContainer.classList.remove('is-hovered');
                     }
                 }, 200);
             }
          });
          
          tocNav.appendChild(link);
          heading._tocLink = link;
          heading._tocDash = dash;
          heading._tocText = text;
        });

        function onScrollToc() {
            let current = null;
            for (let i = 0; i < headings.length; i++) {
                if (headings[i].getBoundingClientRect().top < 150) {
                    current = headings[i];
                } else {
                    break;
                }
            }
            if (!current && headings.length && window.scrollY < 100) {
                current = null;
            } else if (!current && headings.length) {
                current = headings[0];
            }
            
            if (activeLink !== current) {
                if (activeLink) {
                    activeLink._tocDash.classList.remove("is-active-dash");
                    activeLink._tocLink.classList.remove("is-active");
                }
                if (current && current._tocLink) {
                    activeLink = current;
                    activeLink._tocDash.classList.add("is-active-dash");
                    activeLink._tocLink.classList.add("is-active");
                    // Keep TOC item visible in sidebar without hijacking main window scroll
                    const linkEl = activeLink._tocLink;
                    const top = linkEl.offsetTop;
                    const bot = top + linkEl.offsetHeight;
                    if (top < tocBox.scrollTop) {
                        tocBox.scrollTop = top;
                    } else if (bot > tocBox.scrollTop + tocBox.clientHeight) {
                        tocBox.scrollTop = bot - tocBox.clientHeight;
                    }
                } else {
                    activeLink = null;
                }
            }
        }
        
        // One rAF-throttled scroll listener drives both the active-item
        // highlight and the lock-release timeout. The two used to be
        // separate listeners that ran getBoundingClientRect() loops on
        // EVERY scroll event — that layout thrash starved the main
        // thread and made the reading progress bar stutter on mobile.
        const tocVisible = window.matchMedia("(min-width: 768px)"); // matches the CSS hide rule below 768px
        let tocTicking = false;

        window._tocScrollListener = function () {
            if (tocTicking) return;
            tocTicking = true;
            requestAnimationFrame(function () {
                tocTicking = false;
                // Sidebar is display:none below 768px — skip all layout
                // work there (this was the mobile jank source).
                if (!tocVisible.matches) return;
                onScrollToc();

                // Release the lock ~150ms after scrolling stops.
                if (tocContainer.classList.contains("is-locked-open")) {
                    clearTimeout(tocContainer._scrollLockTimeout);
                    tocContainer._scrollLockTimeout = setTimeout(function () {
                        tocContainer.classList.remove("is-locked-open");
                        if (!tocContainer.matches(":hover")) {
                            tocContainer.classList.remove("is-hovered");
                        }
                    }, 150);
                }
            });
        };
        window.addEventListener("scroll", window._tocScrollListener, { passive: true });
        if (tocVisible.matches) onScrollToc();
      } else {
        tocContainer.style.display = "none";
      }
    }

    /* ── Copy Link Button ─────────────────────────────────────────── */
    const copyLinkBtn = document.getElementById("copy-link-btn");

    if (copyLinkBtn) {
      // Remove previous listener to prevent duplicates if init runs multiple times
      const newCopyBtn = copyLinkBtn.cloneNode(true);
      copyLinkBtn.parentNode.replaceChild(newCopyBtn, copyLinkBtn);
      
      newCopyBtn.addEventListener("click", function () {
        const url = newCopyBtn.dataset.url || window.location.href;
        const icon = newCopyBtn.querySelector("i");

        navigator.clipboard
          .writeText(url)
          .then(function () {
            newCopyBtn.classList.add("copied");
            if (icon) {
              icon.className = "bi bi-check2";
            }

            setTimeout(function () {
              newCopyBtn.classList.remove("copied");
              if (icon) {
                icon.className = "bi bi-link-45deg";
              }
            }, 2000);
          })
          .catch(function () {
            const textarea = document.createElement("textarea");
            textarea.value = url;
            textarea.style.position = "fixed";
            textarea.style.opacity = "0";
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            try {
              document.execCommand("copy");
              newCopyBtn.classList.add("copied");
              if (icon) icon.className = "bi bi-check2";
              setTimeout(function () {
                newCopyBtn.classList.remove("copied");
                if (icon) icon.className = "bi bi-link-45deg";
              }, 2000);
            } catch (err) {
              console.error("Failed to copy link:", err);
            }
            document.body.removeChild(textarea);
          });
      });
    }

    /* ── Code Block Enhancements ──────────────────────────────────── */
    const toPrettyLanguage = (lang) => {
      if (!lang) return "Python";
      const normalized = lang.toLowerCase();
      if (normalized === "cpp") return "C++";
      if (normalized === "cs") return "C#";
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    };

    const preElements = document.querySelectorAll("pre");

    preElements.forEach((pre) => {
      // Skip if already processed
      if (pre.querySelector(".code-header")) return;

      const code = pre.querySelector("code");
      if (!code) return;

      const languageClass = [...code.classList, ...pre.classList].find((cls) =>
        cls.startsWith("language-"),
      );
      const language = languageClass
        ? languageClass.replace("language-", "")
        : "python";

      if (!languageClass) {
        pre.classList.add("language-python");
        code.classList.add("language-python");
      }

      const header = document.createElement("div");
      header.className = "code-header";

      const langLabel = document.createElement("span");
      langLabel.className = "code-lang";
      langLabel.textContent = toPrettyLanguage(language);

      const copyBtn = document.createElement("button");
      copyBtn.className = "copy-btn";
      copyBtn.type = "button";
      copyBtn.innerHTML = '<i class="bi bi-clipboard"></i> Copy';

      copyBtn.addEventListener("click", function () {
        navigator.clipboard.writeText(code.innerText).then(() => {
          copyBtn.classList.add("copied");
          copyBtn.innerHTML = '<i class="bi bi-check2"></i> Copied!';
          setTimeout(() => {
            copyBtn.classList.remove("copied");
            copyBtn.innerHTML = '<i class="bi bi-clipboard"></i> Copy';
          }, 2000);
        });
      });

      header.appendChild(langLabel);
      header.appendChild(copyBtn);
      pre.insertBefore(header, pre.firstChild);
    });

    if (typeof Prism !== "undefined") {
      try {
        // HTMX head-swaps may re-execute the template's inline autoloader
        // script before prism.min.js finishes loading, leaving languages_path
        // unset. Re-apply it here (idempotent) so the autoloader always knows
        // where to fetch language components before highlighting runs.
        if (Prism.plugins && Prism.plugins.autoloader) {
          Prism.plugins.autoloader.languages_path =
            "https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/";
        }
        Prism.highlightAll();
      } catch (e) {
        console.error("Prism highlight error:", e);
      }
    }
  }

  let _blogPostInitTimer = null;
  function debouncedInitBlogPost() {
    if (_blogPostInitTimer) clearTimeout(_blogPostInitTimer);
    _blogPostInitTimer = setTimeout(initBlogPost, 50);
  }

  // Run immediately for initial page load (DOM is already parsed up to this point)
  setTimeout(debouncedInitBlogPost, 10);

  if (!window._blogPostListenerAdded) {
    function cleanupListeners() {
      if (window._blogpostScrollListener) {
        window.removeEventListener("scroll", window._blogpostScrollListener);
        window._blogpostScrollListener = null;
      }
      if (window._tocScrollListener) {
        window.removeEventListener("scroll", window._tocScrollListener);
        window._tocScrollListener = null;
      }
    }

    document.addEventListener("htmx:afterSettle", function () {
      if (window.location.pathname.includes('/blog/')) {
        debouncedInitBlogPost();
      } else {
        cleanupListeners();
      }
    });
    document.addEventListener("htmx:restored", function () {
      if (window.location.pathname.includes('/blog/')) {
        debouncedInitBlogPost();
      } else {
        cleanupListeners();
      }
    });
    window._blogPostListenerAdded = true;
  }

})();
