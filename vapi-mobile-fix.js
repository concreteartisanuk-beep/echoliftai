/**
 * Echolift AI — Vapi Mobile Integration & WebView Permission Fix
 * Centralized script to handle mobile-specific WebRTC limitations (like in-app browsers)
 * and provide premium, user-friendly feedback on microphone permission errors.
 */

// 1. In-app WebView browser detection
function detectInAppBrowser() {
  const ua = navigator.userAgent || navigator.vendor || window.opera;
  return /FBAN|FBAV|Instagram|LinkedInApp|Messenger|Twitter|Pinterest|Snapchat/i.test(ua);
}

// 2. Inject elegant warning banner for restricted WebViews
function injectInAppWarning() {
  const isInApp = detectInAppBrowser();
  const isMicUnsupported = !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  if (isInApp || isMicUnsupported) {
    // Create banner
    const banner = document.createElement('div');
    banner.id = 'vapi-inapp-banner';
    banner.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: rgba(17, 17, 24, 0.95);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-bottom: 2px solid #7b61ff;
      color: #f0f0f5;
      padding: 1rem 1.5rem;
      z-index: 999999;
      font-family: 'DM Sans', sans-serif;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1.5rem;
      animation: vapiSlideDown 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    `;

    // Inject styles
    const style = document.createElement('style');
    style.id = 'vapi-inapp-styles';
    style.textContent = `
      @keyframes vapiSlideDown {
        from { transform: translateY(-100%); }
        to { transform: translateY(0); }
      }
      #vapi-inapp-banner strong {
        color: #00e5a0;
      }
      .vapi-inapp-close {
        background: transparent;
        border: 1px solid rgba(255,255,255,0.15);
        color: #f0f0f5;
        padding: 0.4rem 1rem;
        border-radius: 6px;
        cursor: pointer;
        font-family: 'Syne', sans-serif;
        font-weight: 600;
        font-size: 0.8rem;
        transition: all 0.2s;
        white-space: nowrap;
      }
      .vapi-inapp-close:hover {
        background: #7b61ff;
        border-color: #7b61ff;
        color: #fff;
      }
      @media (max-width: 600px) {
        #vapi-inapp-banner {
          flex-direction: column;
          align-items: stretch;
          text-align: center;
          gap: 1rem;
        }
        .vapi-inapp-close {
          align-self: center;
        }
      }
    `;
    document.head.appendChild(style);

    banner.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px; text-align: left;">
        <span style="font-size: 1.5rem; flex-shrink: 0;">🎙️</span>
        <div style="font-size: 0.9rem; line-height: 1.5;">
          <strong>Voice Assistant Restricted:</strong> Microphone is blocked inside social media app browsers. 
          Tap the menu icon (<strong>•••</strong> or <strong>share</strong>) and select <strong>'Open in Safari'</strong> or <strong>'Open in Chrome'</strong> to speak with Echo.
        </div>
      </div>
      <button class="vapi-inapp-close" onclick="dismissVapiInAppBanner()">Dismiss</button>
    `;
    document.body.appendChild(banner);
    
    // Push the navigation header down slightly to prevent overlap
    adjustNavLayout(banner.offsetHeight);
  }
}

// Push down navigation header when banner is active
function adjustNavLayout(bannerHeight) {
  const nav = document.querySelector('nav');
  if (nav) {
    nav.style.transition = 'margin-top 0.3s ease';
    nav.style.marginTop = `${bannerHeight}px`;
  }
}

// Dismiss WebView warning banner
window.dismissVapiInAppBanner = function() {
  const banner = document.getElementById('vapi-inapp-banner');
  if (banner) banner.remove();
  
  const nav = document.querySelector('nav');
  if (nav) {
    nav.style.marginTop = '0px';
  }
};

// 3. Render a beautiful warning toast when microphone is blocked/denied
window.showVapiError = function(message) {
  const existing = document.getElementById('vapi-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'vapi-toast';
  toast.style.cssText = `
    position: fixed;
    bottom: 100px;
    right: 20px;
    background: rgba(20, 20, 28, 0.95);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(239, 68, 68, 0.4);
    color: #f0f0f5;
    padding: 1.2rem;
    border-radius: 12px;
    z-index: 999999;
    font-family: 'DM Sans', sans-serif;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
    max-width: 360px;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    animation: vapiSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  `;
  
  toast.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <span style="font-size: 1.2rem; color: #ef4444;">⚠️</span>
      <strong style="font-size: 0.95rem; font-family: 'Syne', sans-serif; color: #ef4444;">Microphone Access Required</strong>
    </div>
    <p style="font-size: 0.85rem; opacity: 0.9; margin: 0; line-height: 1.45;">${message}</p>
    <button onclick="this.parentElement.remove()" style="align-self: flex-end; background: transparent; border: none; color: #00e5a0; font-family: 'Syne', sans-serif; font-weight: 600; font-size: 0.78rem; text-decoration: none; cursor: pointer; padding: 0.2rem; transition: opacity 0.2s;">Dismiss</button>
  `;
  
  if (!document.getElementById('vapi-toast-styles')) {
    const style = document.createElement('style');
    style.id = 'vapi-toast-styles';
    style.textContent = `
      @keyframes vapiSlideUp {
        from { transform: translateY(40px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }
  
  document.body.appendChild(toast);
};

// 4. Handle Vapi instance event hooks
window.handleVapiInstance = function(vapi) {
  if (!vapi) return;
  
  // Hook onto the SDK error event
  vapi.on('error', (error) => {
    console.error("Vapi SDK error:", error);
    
    let userMsg = "An error occurred with the voice assistant. Please check your network and try again.";
    
    // Check for microphone/media related permissions
    if (error && (
      error.message?.toLowerCase().includes('permission') || 
      error.message?.toLowerCase().includes('microphone') ||
      error.name?.toLowerCase().includes('notallowed') ||
      error.name?.toLowerCase().includes('permission')
    )) {
      userMsg = "Microphone access was denied or blocked. Please allow microphone permission in your browser's address bar settings and refresh the page to speak with Echo.";
    }
    
    window.showVapiError(userMsg);
  });
};

// Automatically run WebView checks on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectInAppWarning);
} else {
  injectInAppWarning();
}
