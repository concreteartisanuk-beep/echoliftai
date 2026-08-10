// --- Mobile Navigation Drawer ---
(function initMobileNav() {
    const toggle = document.getElementById('navToggle');
    const menu = document.getElementById('navMenu');
    if (!toggle || !menu) return;

    const setOpen = (open) => {
        menu.classList.toggle('open', open);
        toggle.classList.toggle('open', open);
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
        document.body.classList.toggle('nav-open', open);
    };

    toggle.addEventListener('click', () => setOpen(!menu.classList.contains('open')));

    // Close after picking a destination. Capture phase so the body scroll lock
    // is released before the anchor's own smooth-scroll handler runs.
    menu.addEventListener('click', (e) => {
        if (e.target.closest('a')) setOpen(false);
    }, true);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') setOpen(false);
    });

    document.addEventListener('click', (e) => {
        if (!menu.classList.contains('open')) return;
        if (!e.target.closest('.nav-container')) setOpen(false);
    });

    // Never leave the drawer state stuck when rotating back to a wide viewport
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) setOpen(false);
    });
})();

// --- Persistent £47 offer bar ---
//
// The page is long and the order form sits near the top, so anyone who reads to
// the bottom has no CTA within reach. This keeps one there. It stays out of the
// way deliberately: hidden over the hero (where the CTA is already on screen),
// hidden again while the order form itself is in view, and gone for the session
// once dismissed.
(function initOfferBar() {
    const bar = document.getElementById('offerBar');
    if (!bar) return;

    const closeBtn = document.getElementById('offerBarClose');
    const nav = document.querySelector('.navbar');
    const hero = document.getElementById('home');
    const order = document.getElementById('growth-report');
    const DISMISS_KEY = 'echolift.offerBar.dismissed';

    try {
        if (sessionStorage.getItem(DISMISS_KEY) === '1') return;
    } catch (err) {
        // Storage unavailable — the bar just reappears on the next page load.
    }

    // Sit directly beneath the navbar, whose height changes with the viewport
    // and when the in-app-browser warning banner pushes it down.
    const position = () => {
        if (!nav) return;
        const bottom = nav.getBoundingClientRect().bottom;
        bar.style.top = `${Math.max(0, Math.round(bottom))}px`;
    };

    const orderFormInView = () => {
        if (!order) return false;
        const box = order.getBoundingClientRect();
        return box.top < window.innerHeight * 0.75 && box.bottom > 0;
    };

    const update = () => {
        position();
        const pastHero = hero ? hero.getBoundingClientRect().bottom < 0 : window.scrollY > 600;
        bar.classList.toggle('visible', pastHero && !orderFormInView());
    };

    let queued = false;
    const onScroll = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            update();
        });
    };

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            bar.classList.remove('visible');
            window.removeEventListener('scroll', onScroll);
            window.removeEventListener('resize', onScroll);
            try {
                sessionStorage.setItem(DISMISS_KEY, '1');
            } catch (err) {
                /* dismissal just won't persist */
            }
        });
    }

    bar.hidden = false;
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
})();

// --- Scroll Animations Observer ---
document.addEventListener('DOMContentLoaded', () => {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                // Could remove observer if we only want elements to animate once
                // observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: "0px 0px -50px 0px"
    });

    const animatedElements = document.querySelectorAll('.fade-in-up');
    animatedElements.forEach(el => observer.observe(el));
});

// --- Intelligence Hub Simulation Logic ---
let isScanning = false;
const scanContainer = document.getElementById('scan-container');
const btnScan = document.getElementById('btn-scan');
const statGaps = document.getElementById('stat-gaps');

const scanSteps = [
    { type: 'info', msg: 'Initiating scan protocol for competitors [3/3]...' },
    { type: 'info', msg: 'Targeting domain mappings & sitemaps...' },
    { type: 'warning', msg: 'Analyzing competitor keyword density...' },
    { type: 'success', msg: 'GAP DETECTED: Rival missing keyword "AI voice bots for plumbers"' },
    { type: 'success', msg: 'GAP DETECTED: Missing "automated SEO services UK"' },
    { type: 'info', msg: 'Cross-referencing with local search volumes...' },
    { type: 'success', msg: 'GAP DETECTED: Weak content on "how to stop missing calls"' },
    { type: 'warning', msg: 'Generating counter-strategy...' },
    { type: 'info', msg: 'Passing 3 High-Value keywords to EchoHub Engine...' },
    { type: 'success', msg: 'Scan Complete. 3 Gaps sent to blog queue.' }
];

function startScan() {
    if (isScanning) return;
    
    isScanning = true;
    btnScan.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Scanning...';
    btnScan.disabled = true;
    
    // Clear idle state
    scanContainer.innerHTML = '';
    statGaps.innerText = '0';
    
    let stepIndex = 0;
    let gapsCount = 0;
    
    const interval = setInterval(() => {
        if (stepIndex >= scanSteps.length) {
            clearInterval(interval);
            finishScan();
            return;
        }
        
        const step = scanSteps[stepIndex];
        addLogEntry(step.type, step.msg);
        
        if (step.type === 'success' && step.msg.includes('GAP DETECTED')) {
            gapsCount++;
            statGaps.innerText = gapsCount;
            // Add a little pop effect to the stat
            statGaps.style.transform = 'scale(1.2)';
            setTimeout(() => statGaps.style.transform = 'scale(1)', 200);
        }
        
        stepIndex++;
        // Auto-scroll to bottom
        scanContainer.scrollTop = scanContainer.scrollHeight;
    }, 800 + Math.random() * 600); // Random delay between 0.8s and 1.4s
}

function addLogEntry(type, message) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    
    const now = new Date();
    const timeStr = `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}]`;
    
    let icon = '';
    let colorClass = '';
    
    switch(type) {
        case 'info':
            icon = '<i class="fa-solid fa-angle-right"></i>';
            colorClass = 'log-info';
            break;
        case 'success':
            icon = '<i class="fa-solid fa-check"></i>';
            colorClass = 'log-success';
            break;
        case 'warning':
            icon = '<i class="fa-solid fa-triangle-exclamation"></i>';
            colorClass = 'log-warning';
            break;
    }
    
    entry.innerHTML = `
        <span class="log-time">${timeStr}</span>
        <span class="${colorClass}">${icon} ${message}</span>
    `;
    
    scanContainer.appendChild(entry);
}

function finishScan() {
    isScanning = false;
    btnScan.innerHTML = '<i class="fa-solid fa-satellite-dish"></i> Run Scan Again';
    btnScan.disabled = false;
    
    // Add pulsing effect to the button when finished
    btnScan.classList.add('pulse-anim');
    setTimeout(() => btnScan.classList.remove('pulse-anim'), 3000);
}

// Add smooth scrolling for navigation
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const targetId = this.getAttribute('href');
        if(targetId === '#') return;
        
        const targetElement = document.querySelector(targetId);
        if(targetElement) {
            window.scrollTo({
                top: targetElement.offsetTop - 80,
                behavior: 'smooth'
            });
        }
    });
});
