    // ── Keep the address bar clean ────────────────────────────────────────
    // Nav links point at in-page sections (#products, #contact, ...). By default
    // the browser leaves that fragment in the URL, so the bar reads
    // "twinstack.net/#products" and clicking the same link twice does nothing.
    // Here we scroll manually and then strip the fragment, so the URL always
    // stays "twinstack.net/" while still landing on the right section.
    (function () {
        function cleanUrl() {
            history.replaceState(null, '', location.pathname + location.search);
        }

        document.addEventListener('click', function (e) {
            var link = e.target.closest('a[href^="#"]');
            if (!link) return;
            // Leave the accessibility skip-link alone: it needs the browser's
            // native focus handling, not just a scroll.
            if (link.classList.contains('skip-link')) return;

            var id = link.getAttribute('href');
            if (!id || id === '#') return;

            var target = document.querySelector(id);
            if (!target) return; // unknown target: let the browser decide

            e.preventDefault();
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            cleanUrl();
        });

        // Someone arriving at twinstack.net/#products still scrolls to the
        // section (browser default), then we tidy the URL behind them.
        window.addEventListener('load', function () {
            if (location.hash && location.hash !== '#main-content') {
                setTimeout(cleanUrl, 400);
            }
        });
    })();

    // Logo click: back to the top of a clean homepage URL.
    function goHomeClean() {
        if (location.pathname !== '/' && location.pathname !== '/index.html') {
            window.location.href = '/';
            return;
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
        history.replaceState(null, '', location.pathname + location.search);
    }
    