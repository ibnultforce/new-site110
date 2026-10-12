        const modal = document.getElementById('intro-modal');
        const body = document.getElementById('main-body');

        var _formShownAt = 0;
        function goToForm() {
            _formShownAt = Date.now(); // Start spam time-gate timer
            document.getElementById('step-1').classList.remove('active-step');
            document.getElementById('step-1').classList.add('hidden-step');
            setTimeout(() => {
                document.getElementById('step-1').style.display = 'none';
                const step2 = document.getElementById('step-2');
                step2.style.display = 'block';
                requestAnimationFrame(() => {
                    step2.classList.remove('hidden-step');
                    step2.classList.add('active-step');
                });
            }, 300);
        }

        function closeIntro() {
            modal.classList.add('hidden-modal');
            body.style.overflow = 'auto'; 
        }

        function closeToast() {
            const toast = document.getElementById('success-toast');
            toast.classList.remove('opacity-100', 'scale-100');
            toast.classList.add('opacity-0', 'scale-90');
            setTimeout(() => toast.classList.add('hidden'), 500);
        }

        function checkForm() {
            const inputs = document.querySelectorAll('#leadForm input[required], #leadForm textarea[required]');
            let allFilled = true;
            inputs.forEach(input => { if (!input.value.trim()) allFilled = false; });
            const btn = document.getElementById('submitBtn');
            if (allFilled) {
                btn.disabled = false;
                btn.classList.remove('opacity-50', 'cursor-not-allowed');
                btn.classList.add('hover:bg-brand-700', 'cursor-pointer');
            } else {
                btn.disabled = true;
                btn.classList.add('opacity-50', 'cursor-not-allowed');
                btn.classList.remove('hover:bg-brand-700', 'cursor-pointer');
            }
        }

        /* captcha_settings removed — replaced by honeypot + time-gate spam protection */
        
        const urlParams = new URLSearchParams(window.location.search);
        const baseUrl = window.location.href.split('?')[0];
        const isSubmitted = urlParams.get('submitted') === 'true';

        if (isSubmitted) {
            modal.style.display = 'none'; // Instant hide
            body.style.overflow = 'auto';
            
            // Show Horizontal Success Toast
            const toast = document.getElementById('success-toast');
            toast.classList.remove('hidden');
            setTimeout(() => {
                toast.classList.remove('opacity-0', 'scale-90');
                toast.classList.add('opacity-100', 'scale-100');
            }, 10);

            // Auto-Close after 3 seconds
            setTimeout(() => {
                closeToast();
            }, 3000);
        } else {
            // Trigger Lead Form Modal after 30 seconds
            setTimeout(() => {
                const modal = document.getElementById('intro-modal');
                if (modal) {
                    // Set retURL just before showing — avoids early DOM touch
                    const retField = document.getElementById('retURL_field');
                    if (retField) retField.value = baseUrl + '?submitted=true';
                    modal.classList.remove('hidden-modal');
                    body.style.overflow = 'hidden'; 
                }
            }, 30000); // 30 seconds
        }

        const blueprintData = [
            { title: "Strategy & Architecture", icon: "fa-chess-knight", desc: "We start by validating your product idea against Salesforce limits. Our architects design a scalable data model that ensures your app performs flawlessly for 10 users or 10,000." },
            { title: "Development (LWC & Apex)", icon: "fa-code", desc: "Our developers build utilizing the latest Salesforce standards—Lightning Web Components (LWC) for UI and optimized Apex for logic—ensuring a native, seamless experience." },
            { title: "Security Review Specialist", icon: "fa-shield-alt", desc: "Passing the Salesforce Security Review is the hardest part. We pre-scan code, fix vulnerabilities (CRUD/FLS, Injection), and manage the submission process to guarantee success." },
            { title: "Packaging & Listing", icon: "fa-box-open", desc: "We create your Managed Package, configure license management (LMA), and design a high-converting AppExchange listing with compelling visuals and documentation." }
        ];

        function updateBlueprint(index) {
            const contentDiv = document.getElementById('blueprint-content');
            const data = blueprintData[index];
            contentDiv.style.opacity = '0';
            setTimeout(() => {
                contentDiv.innerHTML = `<div class="w-20 h-20 bg-brand-500 rounded-2xl flex items-center justify-center text-4xl text-white mb-6 shadow-lg shadow-brand-500/50 mx-auto"><i class="fas ${data.icon}"></i></div><h4 class="text-3xl font-bold text-white mb-4">${data.title}</h4><p class="text-slate-300 text-lg leading-relaxed max-w-sm mx-auto">${data.desc}</p>`;
                contentDiv.style.opacity = '1';
            }, 200);
        }

        document.addEventListener('DOMContentLoaded', () => {
            // Native reveal-on-scroll — replaces AOS (zero library cost, no LCP block)
            (function(){
                var els = document.querySelectorAll('[data-aos]');
                if (!els.length) return;
                // Mobile: reveal instantly (best LCP, matches old disable:mobile behaviour)
                if (window.matchMedia('(max-width: 767px)').matches ||
                    window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                    els.forEach(function(el){ el.classList.add('aos-animate'); });
                    return;
                }
                var io = new IntersectionObserver(function(entries){
                    entries.forEach(function(e){
                        if (e.isIntersecting){ e.target.classList.add('aos-animate'); io.unobserve(e.target); }
                    });
                }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
                els.forEach(function(el){ io.observe(el); });
            })();

            const navbar = document.getElementById('navbar');
            let navTicking = false;
            window.addEventListener('scroll', () => {
                if (navTicking) return;
                navTicking = true;
                requestAnimationFrame(() => {
                    if (window.scrollY > 50) {
                        navbar.classList.remove('top-6', 'w-[95%]', 'max-w-7xl', 'rounded-2xl', 'h-20');
                        navbar.classList.add('top-0', 'w-full', 'max-w-full', 'rounded-none', 'h-16', 'shadow-md');
                    } else {
                        navbar.classList.remove('top-0', 'w-full', 'max-w-full', 'rounded-none', 'h-16', 'shadow-md');
                        navbar.classList.add('top-6', 'w-[95%]', 'max-w-7xl', 'rounded-2xl', 'h-20');
                    }
                    navTicking = false;
                });
            }, { passive: true });

            const counters = document.querySelectorAll('.counter');
            const observer = new IntersectionObserver((entries) => {
                if(entries[0].isIntersecting) {
                    counters.forEach(counter => {
                        const target = +counter.getAttribute('data-target');
                        const updateCount = () => {
                            const count = +counter.innerText;
                            const inc = target / 100;
                            if (count < target) {
                                counter.innerText = Math.ceil(count + inc);
                                setTimeout(updateCount, 20);
                            } else {
                                counter.innerText = (target === 7) ? "7+" : target;
                            }
                        };
                        updateCount();
                    });
                }
            });
            const statsSection = document.querySelector('.counter')?.closest('section');
            if(statsSection) observer.observe(statsSection);

            const pupils = document.querySelectorAll('.pupil');
            const botContainer = document.querySelector('.bot-container');
            document.addEventListener('mousemove', (e) => {
                const x = e.clientX;
                const y = e.clientY;
                const rect = botContainer.getBoundingClientRect();
                const botX = rect.left + rect.width / 2;
                const botY = rect.top + rect.height / 2;
                const angle = Math.atan2(y - botY, x - botX);
                const distance = Math.min(3, Math.hypot(x - botX, y - botY) / 10);
                pupils.forEach(pupil => {
                    const xMove = Math.cos(angle) * distance;
                                    const yMove = Math.sin(angle) * distance;
                    pupil.style.transform = `translate(calc(-50% + ${xMove}px), calc(-50% + ${yMove}px))`;
                });
            });

            // Mobile menu
            const mobileMenuBtn = document.getElementById('mobile-menu-btn');
            const closeMenuBtn = document.getElementById('close-menu-btn');
            const mobileMenu = document.getElementById('mobile-menu');
            if (mobileMenuBtn) {
                mobileMenuBtn.addEventListener('click', () => {
                    mobileMenu.classList.remove('translate-x-full');
                });
            }
            if (closeMenuBtn) {
                closeMenuBtn.addEventListener('click', () => {
                    mobileMenu.classList.add('translate-x-full');
                });
            }
            mobileMenu.querySelectorAll('a').forEach(link => {
                link.addEventListener('click', () => {
                    mobileMenu.classList.add('translate-x-full');
                });
            });

            // ── AI Chatbot (lazy: nothing is built until first click — zero PSI cost) ──
            const chatbotTrigger = document.getElementById('chatbot-trigger');
            if (chatbotTrigger) {
                chatbotTrigger.addEventListener('click', () => { window.TwinChat ? TwinChat.toggle() : initTwinChat(); });
            }
        });

        // ── SPAM PROTECTION ───────────────────────────────────────────────────
        // _formShownAt is set inside goToForm() above.
        // JS-only: The real form action URL is never in the static HTML
        // It is only set by JS at submit time — bots scraping HTML can't find it
        var _sfEndpoint = atob('aHR0cHM6Ly93ZWJ0by5zYWxlc2ZvcmNlLmNvbS9zZXJ2bGV0L3NlcnZsZXQuV2ViVG9MZWFkP2VuY29kaW5nPVVURi04Jm9yZ0lkPTAwRGROMDAwMDByb0lMRQ==');

        function handleLeadSubmit() {
            const form = document.getElementById('leadForm');

            // 1. Honeypot check — if the hidden field has a value, it's a bot
            const hp = document.getElementById('__hp_website');
            if (hp && hp.value.trim() !== '') {
                // Silently fake success to confuse bots
                closeIntro();
                return;
            }

            // 2. Time-gate check — form must have been visible for at least 5 seconds
            const elapsed = Date.now() - _formShownAt;
            if (_formShownAt > 0 && elapsed < 5000) {
                // Too fast — almost certainly a bot. Silently drop.
                closeIntro();
                return;
            }

            // 3. Basic field validation
            const inputs = form.querySelectorAll('input[required], textarea[required]');
            let valid = true;
            inputs.forEach(input => { if (!input.value.trim()) valid = false; });
            if (!valid) return;

            // 4. All checks passed — set the real endpoint and submit
            form.action = _sfEndpoint;

            // Update retURL before submitting
            const baseUrl = window.location.href.split('?')[0];
            document.getElementById('retURL_field').value = baseUrl + '?submitted=true';

            form.submit();
        }

        // ── TwinChat: AI assistant widget ─────────────────────────────────────
        // All CSS + DOM are injected on FIRST open only, so this adds nothing to
        // initial page load. Answers come from /api/chat (Cloudflare Worker proxy
        // that holds the Anthropic API key — see chat-worker.js). The key is
        // NEVER in this file.
        const TWINCHAT_ENDPOINT = '/api/chat';

        function initTwinChat() {
            const css = document.createElement('style');
            css.textContent = `
            #twinchat{position:fixed;bottom:110px;right:24px;z-index:1000;width:min(370px,calc(100vw - 32px));height:min(520px,calc(100vh - 140px));background:#fff;border-radius:20px;box-shadow:0 20px 60px -10px rgba(2,8,23,.45);display:flex;flex-direction:column;overflow:hidden;opacity:0;transform:translateY(12px) scale(.98);transition:opacity .25s ease,transform .25s ease;font-family:inherit}
            #twinchat.tc-open{opacity:1;transform:none}
            .tc-head{background:linear-gradient(135deg,#0ea5e9,#2563eb);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}
            .tc-head-title{font-weight:700;font-size:15px;line-height:1.2}
            .tc-head-sub{font-size:11px;opacity:.85}
            .tc-head .tc-actions{margin-left:auto;display:flex;gap:6px}
            .tc-btn{background:rgba(255,255,255,.15);border:0;color:#fff;width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:14px;line-height:1;display:flex;align-items:center;justify-content:center}
            .tc-btn:hover{background:rgba(255,255,255,.3)}
            .tc-log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:#f8fafc}
            .tc-msg{max-width:85%;padding:9px 13px;border-radius:14px;font-size:13.5px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}
            .tc-msg.tc-bot{background:#fff;border:1px solid #e2e8f0;color:#1e293b;border-bottom-left-radius:4px;align-self:flex-start}
            .tc-msg.tc-user{background:#0284c7;color:#fff;border-bottom-right-radius:4px;align-self:flex-end}
            .tc-typing{display:inline-flex;gap:4px;padding:12px 14px}
            .tc-typing span{width:7px;height:7px;background:#94a3b8;border-radius:50%;animation:tcB 1.2s infinite}
            .tc-typing span:nth-child(2){animation-delay:.15s}.tc-typing span:nth-child(3){animation-delay:.3s}
            @keyframes tcB{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-5px);opacity:1}}
            .tc-form{display:flex;gap:8px;padding:12px;border-top:1px solid #e2e8f0;background:#fff}
            .tc-input{flex:1;border:1px solid #cbd5e1;border-radius:10px;padding:9px 12px;font-size:13.5px;outline:none;resize:none;max-height:90px;font-family:inherit}
            .tc-input:focus{border-color:#0ea5e9;box-shadow:0 0 0 3px rgba(14,165,233,.15)}
            .tc-send{background:#0284c7;color:#fff;border:0;border-radius:10px;width:42px;cursor:pointer;font-size:16px;flex-shrink:0}
            .tc-send:disabled{opacity:.5;cursor:not-allowed}
            .tc-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 10px;background:#f8fafc}
            .tc-chip{background:#e0f2fe;color:#0369a1;border:1px solid #bae6fd;border-radius:99px;padding:5px 11px;font-size:12px;cursor:pointer}
            .tc-chip:hover{background:#bae6fd}
            @media (max-width:480px){#twinchat{bottom:105px;right:16px}}`;
            document.head.appendChild(css);

            const el = document.createElement('div');
            el.id = 'twinchat';
            el.setAttribute('role','dialog');
            el.setAttribute('aria-label','TwinStack AI assistant');
            el.innerHTML = `
              <div class="tc-head">
                <div><div class="tc-head-title">TwinStack Assistant</div><div class="tc-head-sub">Ask me about our services, products or Saiful</div></div>
                <div class="tc-actions">
                  <button class="tc-btn" id="tc-wa" title="Chat on WhatsApp" aria-label="Continue on WhatsApp">&#128172;</button>
                  <button class="tc-btn" id="tc-close" title="Close" aria-label="Close chat">&#10005;</button>
                </div>
              </div>
              <div class="tc-log" id="tc-log" aria-live="polite"></div>
              <div class="tc-chips" id="tc-chips">
                <button type="button" class="tc-chip">What does TwinStack do?</button>
                <button type="button" class="tc-chip">Who is Saiful Islam?</button>
                <button type="button" class="tc-chip">Tell me about Smart Lookup Data Loader</button>
              </div>
              <form class="tc-form" id="tc-form">
                <textarea class="tc-input" id="tc-input" rows="1" placeholder="Type your question..." aria-label="Your message"></textarea>
                <button type="submit" class="tc-send" id="tc-send" aria-label="Send">&#10148;</button>
              </form>`;
            document.body.appendChild(el);

            const log = el.querySelector('#tc-log'), form = el.querySelector('#tc-form'),
                  input = el.querySelector('#tc-input'), send = el.querySelector('#tc-send');
            const history = [];
            let busy = false, open = false;

            function add(role, text){
                const d = document.createElement('div');
                d.className = 'tc-msg ' + (role === 'user' ? 'tc-user' : 'tc-bot');
                d.textContent = text;
                log.appendChild(d); log.scrollTop = log.scrollHeight;
                return d;
            }
            function typing(on){
                let t = el.querySelector('.tc-typing');
                if (on && !t){ t = document.createElement('div'); t.className = 'tc-msg tc-bot tc-typing'; t.innerHTML = '<span></span><span></span><span></span>'; log.appendChild(t); log.scrollTop = log.scrollHeight; }
                if (!on && t) t.remove();
            }
            async function ask(text){
                if (busy || !text.trim()) return;
                busy = true; send.disabled = true;
                add('user', text); input.value = '';
                history.push({role:'user', content:text});
                el.querySelector('#tc-chips').style.display = 'none';
                typing(true);
                try {
                    const r = await fetch(TWINCHAT_ENDPOINT, {
                        method:'POST', headers:{'Content-Type':'application/json'},
                        body: JSON.stringify({ messages: history.slice(-12) })
                    });
                    const data = await r.json().catch(() => ({}));
                    if (!r.ok && !data.reply) throw new Error('HTTP ' + r.status);
                    const reply = data.reply || 'Sorry, I could not generate a reply.';
                    history.push({role:'assistant', content:reply});
                    typing(false); add('assistant', reply);
                } catch(e) {
                    typing(false);
                    add('assistant', "I'm having trouble connecting right now. You can email info@twinstack.net, reach the team on WhatsApp (tap the \uD83D\uDCAC icon above) or book a free call from the page.");
                }
                busy = false; send.disabled = false; input.focus();
            }

            form.addEventListener('submit', e => { e.preventDefault(); ask(input.value); });
            input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); ask(input.value); } });
            el.querySelector('#tc-chips').addEventListener('click', e => { if (e.target.classList.contains('tc-chip')) ask(e.target.textContent); });
            el.querySelector('#tc-wa').addEventListener('click', () => window.open('https://wa.me/8801556777043','_blank'));
            el.querySelector('#tc-close').addEventListener('click', () => TwinChat.toggle());
            document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) TwinChat.toggle(); });

            window.TwinChat = {
                toggle(){
                    open = !open;
                    if (open){ el.style.display = 'flex'; requestAnimationFrame(()=>el.classList.add('tc-open')); input.focus(); }
                    else { el.classList.remove('tc-open'); setTimeout(()=>{ el.style.display='none'; }, 250); }
                }
            };
            add('assistant', "Hi! \uD83D\uDC4B I'm the TwinStack assistant. Ask me anything about our Salesforce PDO services, our AppExchange products, or Saiful Islam.");
            TwinChat.toggle();
        }

        // Tailwind CSS is now inlined in <style> — no CDN needed
    