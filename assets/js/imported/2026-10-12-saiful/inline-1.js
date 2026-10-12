      // GTM deferred — loads after page is interactive to save ~62KB on initial load
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      // Load GTM on first user interaction (fallback 12s) — keeps it out of the
      // initial-load critical window; real users still get full analytics.
      var _gtmLoaded = false;
      function loadGTM() {
        if (_gtmLoaded) return; _gtmLoaded = true;
        ['pointerdown','keydown','touchstart','scroll'].forEach(function(ev){
          window.removeEventListener(ev, loadGTM, {passive:true});
        });
        var s = document.createElement('script');
        s.async = true;
        s.src = 'https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX';
        document.head.appendChild(s);
        gtag('js', new Date());
        gtag('config', 'G-XXXXXXXXXX');
      }
      ['pointerdown','keydown','touchstart','scroll'].forEach(function(ev){
        window.addEventListener(ev, loadGTM, {passive:true, once:true});
      });
      setTimeout(loadGTM, 12000);
    