// --- GLOBAL APP STATE ---
let state = {
  currentTab: 'dashboard',
  leads: [],
  logs: [],
  campaign: {},
  thread: [],
  activeCallInterval: null,
  activeCallDuration: 0,
  isCallSimulating: false,
  // Incremented on every hang-up and every new call, so a playback loop from a
  // previous call cannot keep speaking over the current one.
  callToken: 0,
  activeAudio: null,
  selectedSMSLeadId: null
};

// --- API CLIENT ---
// Same-origin Netlify Functions. Everything under /api/apexvoice/ is served by
// this project, so there is no external host to keep alive.
const API_BASE = '/api/apexvoice';

// The portal sits behind an edge-function auth gate. A 401 from any endpoint
// means the session cookie expired or was cleared, which is not something the
// operator can fix from this page — so hand them back to the sign-in form
// rather than showing a data error they cannot act on.
const LOGIN_PAGE = '/portal/login.html';
let redirectingToLogin = false;

function redirectToLogin() {
  if (redirectingToLogin) return;
  redirectingToLogin = true;
  window.location.replace(LOGIN_PAGE);
}

class ApiError extends Error {}

async function apiFetch(endpoint, options = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${endpoint}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
  } catch (err) {
    throw new ApiError('Could not reach the server. Check your connection and try again.');
  }

  if (res.status === 401) {
    redirectToLogin();
    throw new ApiError('Your session has expired. Taking you back to sign in…');
  }

  if (res.status === 204) return null;

  let payload = null;
  try {
    payload = await res.json();
  } catch (err) {
    payload = null;
  }

  if (!res.ok) {
    throw new ApiError((payload && payload.error) || `Request failed (${res.status}).`);
  }

  return payload;
}

// --- HTML ESCAPING ---
// Prospect names, pain points and messages are rendered through innerHTML.
// They come from generated data and from free-text fields, so everything
// interpolated into markup goes through here first.
function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- STATUS BANNER ---
function showBanner(message, kind = 'error') {
  const banner = document.getElementById('api-status-banner');
  if (!banner) return;
  banner.textContent = message;
  banner.className = `api-status-banner ${kind} visible`;
}

function hideBanner() {
  const banner = document.getElementById('api-status-banner');
  if (banner) banner.className = 'api-status-banner';
}

// --- INITIALIZE APPLICATION ---
document.addEventListener('DOMContentLoaded', async () => {
  lucide.createIcons();
  setupNavigation();
  setupEventListeners();
  await loadAllData();
});

// --- NAVIGATION & TABS ---
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const tab = item.getAttribute('data-tab');
      navigateToTab(tab);
      closeSidebar();
    });
  });

  setupSidebarDrawer();

  // Handle URL hashes if present
  const hash = window.location.hash.substring(1);
  if (hash && ['dashboard', 'lead-finder', 'campaign', 'call-sim', 'sms-hub'].includes(hash)) {
    navigateToTab(hash);
  }
}

// Off-canvas sidebar for narrow viewports
function setSidebarOpen(open) {
  const sidebar = document.getElementById('portal-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const toggle = document.getElementById('sidebar-toggle');
  if (!sidebar) return;

  sidebar.classList.toggle('open', open);
  if (toggle) {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
  }
  if (backdrop) {
    if (open) {
      backdrop.hidden = false;
      // Next frame so the opacity transition actually runs
      requestAnimationFrame(() => backdrop.classList.add('visible'));
    } else {
      backdrop.classList.remove('visible');
      backdrop.hidden = true;
    }
  }
}

function closeSidebar() {
  setSidebarOpen(false);
}

function setupSidebarDrawer() {
  const sidebar = document.getElementById('portal-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const toggle = document.getElementById('sidebar-toggle');
  if (!sidebar || !toggle) return;

  toggle.addEventListener('click', () => {
    setSidebarOpen(!sidebar.classList.contains('open'));
  });

  if (backdrop) backdrop.addEventListener('click', closeSidebar);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSidebar();
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) closeSidebar();
  });
}

function navigateToTab(tabId) {
  state.currentTab = tabId;

  // Update sidebar active classes
  document.querySelectorAll('.nav-item').forEach(item => {
    if (item.getAttribute('data-tab') === tabId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Update visible tab section
  document.querySelectorAll('.tab-content').forEach(section => {
    if (section.id === `${tabId}-tab`) {
      section.classList.add('active');
    } else {
      section.classList.remove('active');
    }
  });

  // Update headers
  const titleMap = {
    'dashboard': { title: 'Dashboard Overview', subtitle: 'Track your autonomous AI agent\'s performance in real time.' },
    'lead-finder': { title: 'Lead Finder', subtitle: 'Find real businesses by industry and UK location.' },
    'campaign': { title: 'AI Campaign Settings', subtitle: 'Configure agent personality, pitches, and primary sales scripts.' },
    'call-sim': { title: 'Interactive Outbound Call Simulator', subtitle: 'Watch the AI Agent negotiate, pitch and overcome client objections.' },
    'sms-hub': { title: 'SMS Outreach Hub', subtitle: 'Review and coordinate conversational text pitches generated by the AI.' }
  };

  const header = titleMap[tabId] || titleMap['dashboard'];
  document.getElementById('page-title').textContent = header.title;
  document.getElementById('page-subtitle').textContent = header.subtitle;

  // Specific tab entry actions
  if (tabId === 'sms-hub') {
    renderSMSList();
  }

  // Sync window hash
  window.location.hash = tabId;
}

// --- DATA FETCHING ---
async function loadAllData() {
  try {
    const [leads, campaign, logs] = await Promise.all([
      apiFetch('/prospects'),
      apiFetch('/campaign'),
      apiFetch('/activity')
    ]);

    state.leads = Array.isArray(leads) ? leads : [];
    state.campaign = campaign || {};
    state.logs = Array.isArray(logs) ? logs : [];
    hideBanner();
  } catch (err) {
    // Surface the failure instead of rendering an empty dashboard that looks
    // like a brand-new account.
    showBanner(`${err.message} Displayed figures may be out of date.`);
  }

  updateDashboardStats();
  renderLeadsTable();
  populateCampaignForms();
  populateCallDropdowns();
  populateCustomerPresetDropdown();
  renderLogsList();
  if (state.currentTab === 'sms-hub') renderSMSList();
}

// --- DASHBOARD RENDERING ---
function updateDashboardStats() {
  const totalLeads = state.leads.length;
  const totalCalls = state.logs.filter(l => l.type === 'Call').length;
  const demosBooked = state.leads.filter(l => l.status === 'Qualified').length;

  // Calculate conversion: qualified / (total called/interacted)
  const interactedLeads = state.leads.filter(l => l.lastInteraction).length;
  const conversionRate = interactedLeads > 0 ? Math.round((demosBooked / interactedLeads) * 100) : 0;

  document.getElementById('stat-total-leads').textContent = totalLeads;
  document.getElementById('stat-total-calls').textContent = totalCalls;
  document.getElementById('stat-demos-booked').textContent = demosBooked;
  document.getElementById('stat-conversion-rate').textContent = `${conversionRate}%`;

  // Update summary panel on right
  document.getElementById('summary-company-name').textContent = state.campaign.companyName || 'ApexVoice';
  document.getElementById('summary-service-name').textContent = state.campaign.serviceName || 'AI Receptionist';
  document.getElementById('summary-pitch-text').textContent = state.campaign.primaryHook || 'No hook defined.';
  document.getElementById('summary-agent-name').textContent = state.campaign.agentName || 'Alex';
  document.getElementById('summary-pricing').textContent = state.campaign.pricing || 'Custom pricing';
  document.getElementById('summary-persona').textContent = state.campaign.personality || 'Standard professional';

  // Update ElevenLabs status pill indicator
  const pill = document.getElementById('elevenlabs-status-pill');
  if (pill) {
    if (state.campaign.elevenLabsConfigured) {
      pill.textContent = state.campaign.elevenLabsFromEnv
        ? 'ElevenLabs Voices: Active (key from environment)'
        : 'ElevenLabs Voices: Active (Neural AI)';
      pill.className = 'pill-indicator active';
    } else {
      pill.textContent = 'ElevenLabs Voices: Disabled (Local Web Speech)';
      pill.className = 'pill-indicator inactive';
    }
  }

  // Mirror the same state next to the key field
  const keyStatus = document.getElementById('elevenlabs-key-status');
  if (keyStatus) {
    if (state.campaign.elevenLabsFromEnv) {
      keyStatus.textContent = 'A key is set via the ELEVENLABS_API_KEY environment variable and takes precedence over anything saved here.';
    } else if (state.campaign.elevenLabsConfigured) {
      keyStatus.textContent = 'A key is saved. Leave this field blank to keep it.';
    } else {
      keyStatus.textContent = 'No key saved — the simulator uses your browser\'s built-in speech synthesis.';
    }
  }
}

function renderLogsList() {
  const list = document.getElementById('dashboard-logs-list');
  list.innerHTML = '';

  if (state.logs.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <i data-lucide="history"></i>
        <p>No recent activity. Try finding leads and launching a call simulation!</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  // Display top 10 logs
  state.logs.slice(0, 10).forEach(log => {
    const status = String(log.status || '');
    const lower = status.toLowerCase();
    const isSuccess = lower.includes('success') || lower.includes('advanced') || lower.includes('booked');
    const isRejected = lower.includes('rejected');

    let statusClass = 'info';
    if (isSuccess) statusClass = 'success';
    if (isRejected) statusClass = 'danger';

    const timeAgo = formatTimeAgo(new Date(log.timestamp));
    const icon = log.type === 'Call' ? 'phone' : 'message-square';
    const badgeClass = log.type === 'Call' ? 'call' : 'sms';

    const logEl = document.createElement('div');
    logEl.className = 'log-item';
    logEl.innerHTML = `
      <div class="log-meta">
        <div class="log-type-badge ${badgeClass}">
          <i data-lucide="${icon}"></i>
        </div>
        <div class="log-details">
          <h5>${esc(log.contactPerson || 'Unknown contact')} (${esc(log.businessName)})</h5>
          <span>${esc(log.type)} Outreach • ${esc(timeAgo)}</span>
        </div>
      </div>
      <div class="log-status">
        <span class="status-badge ${statusClass}">${esc(status)}</span>
      </div>
    `;
    list.appendChild(logEl);
  });

  lucide.createIcons();
}

// --- LEADS FINDER RENDERING ---
function renderLeadsTable() {
  const tbody = document.getElementById('leads-table-body');
  const countBadge = document.getElementById('lead-count-badge');
  tbody.innerHTML = '';

  countBadge.textContent = `${state.leads.length} Prospects`;

  if (state.leads.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="table-empty">
          <div class="empty-state">
            <i data-lucide="users-2"></i>
            <p>No prospects yet. Search an industry and location above, or add one manually.</p>
          </div>
        </td>
      </tr>
    `;
    lucide.createIcons();
    return;
  }

  state.leads.forEach(lead => {
    // Warmth mapping
    const warmth = Number(lead.warmthScore) || 0;
    let warmthText = 'Cold';
    let warmthClass = 'cold';
    if (warmth > 75) {
      warmthText = 'Hot';
      warmthClass = 'hot';
    } else if (warmth >= 50) {
      warmthText = 'Warm';
      warmthClass = 'warm';
    }

    // Status classes
    let statusClass = 'info';
    if (lead.status === 'In Progress') statusClass = 'warning';
    else if (lead.status === 'Qualified') statusClass = 'success';
    else if (lead.status === 'Rejected') statusClass = 'danger';

    const websiteCell = lead.website
      ? ` • <a href="https://${encodeURI(lead.website)}" target="_blank" rel="noopener noreferrer" class="lead-subtext">${esc(lead.website)}</a>`
      : '';

    // Rows are labelled by where they came from, so a real listing is never
    // confused with one of the AI sample profiles the lead finder used to
    // create. Manually added rows need no label — the operator entered them.
    let sourceTag = '';
    if (lead.source === 'ai-sample') {
      sourceTag = ' <span class="sample-tag" title="AI-generated sample profile — not a real business">sample</span>';
    } else if (lead.source === 'osm') {
      sourceTag = ' <span class="source-tag" title="Real business listing from OpenStreetMap">listed</span>';
    }

    // Directory listings have no contact name, which is different from a name
    // that was never filled in — say so on hover.
    const contactName = lead.contactPerson
      ? esc(lead.contactPerson)
      : `<span title="${lead.source === 'osm' ? 'Not published in the directory — add once you know it' : 'No contact name recorded'}">—</span>`;

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>
        <div class="lead-business-info">
          <span class="lead-name">${esc(lead.businessName)}${sourceTag}</span>
          <span class="lead-subtext">${esc(lead.location)}${websiteCell}</span>
        </div>
      </td>
      <td>
        <div class="lead-business-info">
          <span style="font-weight: 500;">${contactName}</span>
          <span class="lead-subtext">${esc(lead.phone)}</span>
        </div>
      </td>
      <td>
        <div class="warmth-indicator">
          <div class="warmth-dot ${warmthClass}"></div>
          <span>${warmthText} (${warmth}%)</span>
        </div>
      </td>
      <td>
        <div class="table-pain-text" title="${esc(lead.painPoints)}">${esc(lead.painPoints)}</div>
      </td>
      <td>
        <span class="status-badge ${statusClass}">${esc(lead.status)}</span>
      </td>
      <td>
        <span class="lead-subtext">${esc(lead.lastInteraction || 'None')}</span>
      </td>
      <td class="text-right">
        <div class="table-actions">
          <button class="btn-table-icon" title="Call AI Simulator" data-action="call" data-id="${esc(lead.id)}">
            <i data-lucide="phone"></i>
          </button>
          <button class="btn-table-icon" title="View SMS Outreach" data-action="sms" data-id="${esc(lead.id)}">
            <i data-lucide="message-square"></i>
          </button>
          <button class="btn-table-icon" title="Delete Prospect" data-action="delete" data-id="${esc(lead.id)}">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(row);
  });

  lucide.createIcons();
}

// --- CAMPAIGN CONFIGURATION ---
function populateCampaignForms() {
  const c = state.campaign;
  document.getElementById('campaign-company-name').value = c.companyName || '';
  document.getElementById('campaign-service-name').value = c.serviceName || '';
  document.getElementById('campaign-pricing').value = c.pricing || '';
  document.getElementById('campaign-agent-name').value = c.agentName || '';
  document.getElementById('campaign-personality').value = c.personality || '';
  document.getElementById('campaign-description').value = c.productDescription || '';
  document.getElementById('campaign-hook').value = c.primaryHook || '';

  const objections = c.objectionHandling || {};
  document.getElementById('objection-pricing').value = objections.pricing || '';
  document.getElementById('objection-trust').value = objections.trust || '';
  document.getElementById('objection-complexity').value = objections.complexity || '';

  // The saved key is deliberately never sent to the browser, so this field
  // always starts empty and blank means "leave the stored key alone".
  document.getElementById('elevenlabs-key').value = '';
  const clearBox = document.getElementById('elevenlabs-clear');
  if (clearBox) clearBox.checked = false;

  applyVoiceSelection('elevenlabs-agent-voice', c.elevenLabsAgentVoice || 'Xb7hH2yqWyRel9GQ555e');
  applyVoiceSelection('elevenlabs-customer-voice', c.elevenLabsCustomerVoice || 'JBF2rCBphFnJZjxrOi8j');
}

// Selects a saved voice, falling back to the custom-id input when the saved
// value is not one of the presets.
function applyVoiceSelection(selectId, savedVoice) {
  const select = document.getElementById(selectId);
  const customInput = document.getElementById(`${selectId}-custom`);
  if (!select || !customInput) return;

  const options = Array.from(select.options).map(opt => opt.value);
  if (options.includes(savedVoice)) {
    select.value = savedVoice;
    customInput.style.display = 'none';
    customInput.value = '';
  } else {
    select.value = 'custom';
    customInput.style.display = 'block';
    customInput.value = savedVoice;
  }
}

// --- CALL SIMULATOR CONTROLLERS ---
function populateCallDropdowns() {
  const select = document.getElementById('sim-select-lead');
  const previous = select.value;
  select.innerHTML = '<option value="">-- Choose Lead --</option>';

  state.leads.forEach(lead => {
    const opt = document.createElement('option');
    opt.value = lead.id;
    opt.textContent = `${lead.businessName} - ${lead.contactPerson || 'Unknown contact'}`;
    select.appendChild(opt);
  });

  // Keep the operator's selection across a refresh where possible.
  if (previous && state.leads.some(l => l.id === previous)) select.value = previous;
}

// --- CAMPAIGN IDENTITY PRESETS ---
/**
 * The fixed pitches, held as plain field maps rather than as code that pokes at
 * inputs one by one, so that every way of filling the campaign — including the
 * per-prospect one below — goes through the same single path.
 */
const CAMPAIGN_PRESETS = {
  echolift: {
    agentVoice: 'EXAVITQu4vr4xnSDxMaL', // Sarah (UK Female)
    customerVoice: 'JBF2rCBphFnJZjxrOi8j', // George (UK Male)
    fields: {
      'campaign-company-name': 'EchoLift AI',
      'campaign-service-name': 'AI Competitor Gap Analysis & Automated SEO',
      'campaign-pricing': '£149/month',
      'campaign-agent-name': 'Sarah',
      'campaign-personality': 'Professional, consultative, expert SEO strategist',
      'campaign-description': 'We offer a 6-in-1 automated growth platform built for UK businesses. We deploy AI voice receptionists that pick up missed calls instantly, and an automated SEO intelligence engine that writes ranking content to outrank your competitors.',
      'campaign-hook': 'Did you know that 62% of incoming calls to local businesses go unanswered, and most websites rank too low on Google? We deploy EchoLift AI to automate your SEO rankings and answer every missed call, booking customers while you sleep.',
      'objection-pricing': 'At £149/month, saving just one single customer booking completely pays for the software. Plus, there is a 14-day free trial so you can see the local traffic and call bookings before you spend anything.',
      'objection-trust': "We generate a free custom SEO audit and competitive gap analysis for your site first. You'll see exactly where your competitors are weak before we begin.",
      'objection-complexity': 'Our team handles 100% of the initial keywords and calendar connections. It takes under 15 minutes of your time, then runs automatically.',
    },
  },
  agency: {
    agentVoice: 'Xb7hH2yqWyRel9GQ555e', // Alice (UK Female)
    customerVoice: 'JBF2rCBphFnJZjxrOi8j', // George (UK Male)
    fields: {
      'campaign-company-name': 'ApexVoice Agency',
      'campaign-service-name': 'B2B AI Call Assistants & Receptionist Integration',
      'campaign-pricing': '£249/month',
      'campaign-agent-name': 'Alice',
      'campaign-personality': 'Friendly, prompt, and business-focused receptionist',
      'campaign-description': 'We build and deploy customized conversational AI phone receptionists that pick up client lines in under 2 seconds, answer company FAQs, and book bookings directly into calendars to capture lost leads.',
      'campaign-hook': 'We install custom AI phone receptionists for local UK businesses. It acts as a 24/7 backup assistant so you never lose emergency customer inquiries or jobs to your voicemail again.',
      'objection-pricing': 'Our receptionist service costs less than a human receptionist for a single day, but runs 24/7. Saving one average plumbing or roofing job pays for the entire year.',
      'objection-trust': 'We build and configure a custom dialer prototype with your company information for free. You can call and test it from your own phone before making any decision.',
      'objection-complexity': 'We handle the phone line set up, voice testing, and booking integrations. It is a completely hands-free installation that syncs with your Google Calendar.',
    },
  },
};

function applyCampaignFields(fields) {
  Object.entries(fields).forEach(([id, value]) => {
    const input = document.getElementById(id);
    if (input) input.value = value;
  });
}

/**
 * Pull a town out of a stored location.
 *
 * Prospect locations come from the directory as a street address with the
 * postcode appended ("29B Wadeson Road, Manchester M13 9UG"), which reads badly
 * in a sales line. Dropping the postcode and taking the last remaining segment
 * gets to "Manchester"; anything unexpected falls back to the whole string,
 * since a slightly long town beats an empty one.
 */
function shortPlace(location) {
  const withoutPostcode = (location || '')
    .replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i, '')
    .trim()
    .replace(/,\s*$/, '');
  const parts = withoutPostcode.split(',').map(p => p.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

/**
 * Build a pitch around one real prospect.
 *
 * The company name is deliberately left alone. The campaign describes the
 * *caller*, and the simulator prompts with "the agent is <name> from
 * <company>", so overwriting it with the prospect's own business would have the
 * AI ringing them on their own behalf. Their details go into the offer, the
 * hook and the objection handling instead — which is what makes the call sound
 * researched — while the caller stays you.
 */
function customerPresetFields(lead) {
  const business = lead.businessName || 'the business';
  const trade = (lead.industry || '').trim().toLowerCase();
  const tradeLabel = trade || 'local trade';
  const town = shortPlace(lead.location);
  const inTown = town ? ` in ${town}` : '';
  const noWebsite = !lead.website;

  return {
    'campaign-service-name': `AI Receptionist for ${business}`,
    'campaign-personality': 'Friendly, well-researched, straight-talking',
    'campaign-description': `A conversational AI phone receptionist set up specifically for ${business}, which does ${tradeLabel} work${inTown}. It answers their line in under two seconds, handles the questions their customers actually ask, and books jobs straight into the calendar so an unanswered ring stops costing them work.`,
    'campaign-hook': noWebsite
      ? `Hi, I'm calling about ${business} — I noticed you're taking ${tradeLabel} work${inTown} on the phone alone, with no website for people to check. I've set up an AI receptionist that answers every call you miss and books the job for you. Can I show you what it sounds like?`
      : `Hi, I'm calling about ${business} — I set up AI receptionists for ${tradeLabel} work${inTown}. It answers the calls you can't get to while you're on a job and books them in for you. Worth two minutes?`,
    'objection-pricing': `One ${tradeLabel} job you'd otherwise have missed covers it. If it never catches a single call, you've paid for nothing — so we start with a month and you judge it on the bookings.`,
    'objection-trust': `I'll build it for ${business} first, free, using your own details. You ring it from your own phone and hear exactly how it answers before you decide anything.`,
    'objection-complexity': `Nothing changes on your side — your existing number keeps working and we sit behind it. Setup is fifteen minutes on a call with me, and we handle the rest.`,
  };
}

/** Prospect picker for the "potential customer" campaign choice. */
function populateCustomerPresetDropdown() {
  const select = document.getElementById('campaign-customer-lead');
  if (!select) return;

  const previous = select.value;
  select.innerHTML = state.leads.length
    ? '<option value="">-- Choose a prospect --</option>'
    : '<option value="">No prospects yet — find some on the Prospects tab</option>';

  state.leads.forEach(lead => {
    const opt = document.createElement('option');
    opt.value = lead.id;
    const place = shortPlace(lead.location);
    opt.textContent = place ? `${lead.businessName} — ${place}` : lead.businessName;
    select.appendChild(opt);
  });

  if (previous && state.leads.some(l => l.id === previous)) select.value = previous;
}

// --- VOICE SYNTHESIS (TTS) WITH ELEVENLABS SUPPORT ---
function stopActiveAudio() {
  if (state.activeAudio) {
    state.activeAudio.pause();
    state.activeAudio = null;
  }
}

function speakText(text, speaker, persona, callback) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  stopActiveAudio();

  if (speaker === 'system') {
    setTimeout(callback, 1500);
    return;
  }

  // Strip bracketed text
  const cleanText = text.replace(/\[.*?\]/g, '').trim();
  if (!cleanText) {
    setTimeout(callback, 1000);
    return;
  }

  // Local Web Speech fallback function
  function speakLocal() {
    if (!('speechSynthesis' in window)) {
      setTimeout(callback, 3500);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(cleanText);
    const voices = window.speechSynthesis.getVoices();
    let ukVoices = voices.filter(v => v.lang.includes('en-GB') || v.lang.includes('en_GB'));
    if (ukVoices.length === 0) {
      ukVoices = voices.filter(v => v.lang.startsWith('en'));
    }

    if (speaker === 'agent') {
      const agentVoice = ukVoices.find(v => v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('zira') || v.name.toLowerCase().includes('hazel') || v.name.toLowerCase().includes('susan'));
      if (agentVoice) utterance.voice = agentVoice;
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
    } else {
      const customerVoice = ukVoices.find(v => v.name.toLowerCase().includes('male') || v.name.toLowerCase().includes('david') || v.name.toLowerCase().includes('george') || v.name.toLowerCase().includes('peter'));
      if (customerVoice) utterance.voice = customerVoice;

      if (persona === 'busy') {
        utterance.rate = 1.25;
        utterance.pitch = 1.05;
      } else if (persona === 'hostile') {
        utterance.rate = 1.05;
        utterance.pitch = 0.8;
      } else if (persona === 'skeptical') {
        utterance.rate = 0.88;
        utterance.pitch = 0.95;
      } else {
        utterance.rate = 0.98;
        utterance.pitch = 1.0;
      }
    }

    let hasProgressed = false;
    const advance = () => {
      if (!hasProgressed) {
        hasProgressed = true;
        callback();
      }
    };

    utterance.onend = advance;
    utterance.onerror = (err) => {
      console.warn('Speech synthesis error:', err);
      advance();
    };

    // Watchdog: never let a silent or stalled voice freeze the call.
    setTimeout(advance, Math.max(cleanText.length * 80, 5000));

    window.speechSynthesis.speak(utterance);
  }

  // Premium neural voices are proxied server-side; the browser never holds the
  // ElevenLabs key and only says which side is speaking.
  if (state.campaign.elevenLabsConfigured) {
    fetch(`${API_BASE}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleanText, speaker })
    })
      .then(async (res) => {
        if (res.status === 401) {
          redirectToLogin();
          throw new Error('Session expired');
        }
        if (!res.ok) throw new Error(`TTS unavailable (${res.status})`);
        const blob = await res.blob();
        const audioUrl = URL.createObjectURL(blob);

        if (!state.isCallSimulating) return; // Hung up before audio was ready

        const audio = new Audio(audioUrl);
        state.activeAudio = audio;
        let audioDone = false;

        audio.onended = () => {
          if (!audioDone) {
            audioDone = true;
            URL.revokeObjectURL(audioUrl);
            callback();
          }
        };

        audio.onerror = (err) => {
          console.warn('Audio playback error, falling back to Web Speech Synthesis:', err);
          if (!audioDone) {
            audioDone = true;
            URL.revokeObjectURL(audioUrl);
            speakLocal();
          }
        };

        audio.play();
      })
      .catch((err) => {
        console.warn('ElevenLabs proxy error, falling back to Web Speech Synthesis:', err);
        speakLocal();
      });
  } else {
    speakLocal();
  }
}

// Pre-fetch voices for browser caching
if ('speechSynthesis' in window) {
  window.speechSynthesis.getVoices();
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }
}

function startCallSim(leadId) {
  navigateToTab('call-sim');
  document.getElementById('sim-select-lead').value = leadId;
}

// Returns the simulator to its idle state.
function resetCallUI() {
  if (state.activeCallInterval) {
    clearInterval(state.activeCallInterval);
    state.activeCallInterval = null;
  }
  state.isCallSimulating = false;
  document.getElementById('call-state-active').style.display = 'none';
  document.getElementById('call-state-setup').style.display = 'flex';
}

async function triggerCallSimulation() {
  const leadId = document.getElementById('sim-select-lead').value;
  const persona = document.getElementById('sim-select-persona').value;

  if (!leadId) {
    alert('Please select a lead to call first.');
    return;
  }

  const lead = state.leads.find(l => l.id === leadId);
  if (!lead) return;

  // Invalidate any previous playback loop still in flight.
  state.callToken += 1;
  const token = state.callToken;

  state.isCallSimulating = true;
  document.getElementById('call-state-setup').style.display = 'none';
  document.getElementById('call-state-active').style.display = 'flex';

  document.getElementById('call-active-contact').textContent = lead.contactPerson || 'Unknown contact';
  document.getElementById('call-active-business').textContent = lead.businessName;
  document.getElementById('call-active-phone').textContent = lead.phone || 'No number on file';
  document.getElementById('call-active-timer').textContent = '00:00';

  const statusLabel = document.getElementById('call-active-status');
  statusLabel.textContent = 'Connecting...';
  statusLabel.style.color = '';

  const transcriptBox = document.getElementById('transcript-feed-box');
  transcriptBox.innerHTML = '';

  state.activeCallDuration = 0;
  if (state.activeCallInterval) clearInterval(state.activeCallInterval);
  state.activeCallInterval = setInterval(() => {
    state.activeCallDuration++;
    const mins = Math.floor(state.activeCallDuration / 60).toString().padStart(2, '0');
    const secs = (state.activeCallDuration % 60).toString().padStart(2, '0');
    document.getElementById('call-active-timer').textContent = `${mins}:${secs}`;
  }, 1000);

  let simResult;
  try {
    simResult = await apiFetch('/simulate-call', {
      method: 'POST',
      body: JSON.stringify({ leadId, persona })
    });
  } catch (err) {
    // Return to the setup screen rather than leaving a dead handset on screen.
    resetCallUI();
    showBanner(`Could not start the call: ${err.message}`);
    return;
  }

  if (token !== state.callToken) return; // Hung up while waiting

  const dialogue = (simResult && simResult.dialogue) || [];
  if (!dialogue.length) {
    resetCallUI();
    showBanner('The simulator returned an empty conversation. Please try again.');
    return;
  }

  if (simResult.generated === false) {
    showBanner('AI dialogue is unavailable, so a scripted call built from your campaign settings is playing instead.', 'notice');
  }

  let currentStep = 0;

  function playNextTurn() {
    if (!state.isCallSimulating || token !== state.callToken) return;

    if (currentStep >= dialogue.length) {
      if (state.activeCallInterval) {
        clearInterval(state.activeCallInterval);
        state.activeCallInterval = null;
      }
      state.isCallSimulating = false;

      statusLabel.textContent = simResult.isSuccessful ? 'Completed - Deal Advanced' : 'Call Rejected';
      statusLabel.style.color = simResult.isSuccessful ? 'var(--color-success)' : 'var(--color-danger)';

      // Outcome was persisted server-side; refresh to pick it up.
      loadAllData();
      return;
    }

    const turn = dialogue[currentStep];
    const bubble = document.createElement('div');

    if (turn.speaker === 'system') {
      bubble.className = 'chat-bubble system-log';
      bubble.textContent = turn.text;

      if (turn.text.includes('Ringing')) {
        statusLabel.textContent = 'Ringing...';
      } else if (turn.text.includes('Call Ended')) {
        statusLabel.textContent = 'Ending Call...';
      }
    } else {
      bubble.className = `chat-bubble ${turn.speaker === 'agent' ? 'agent' : 'customer'}`;

      const speakerName = turn.speaker === 'agent'
        ? (state.campaign.agentName || 'Agent')
        : (lead.contactPerson || 'Prospect');
      bubble.innerHTML = `<strong>${esc(speakerName)}:</strong> ${esc(turn.text)}`;

      statusLabel.textContent = `${speakerName} is speaking...`;
    }

    transcriptBox.appendChild(bubble);
    transcriptBox.scrollTop = transcriptBox.scrollHeight;

    currentStep++;
    speakText(turn.text, turn.speaker, persona, playNextTurn);
  }

  playNextTurn();
}

function hangUpCall() {
  state.callToken += 1;
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  stopActiveAudio();
  resetCallUI();
  loadAllData();
}

// --- SMS OUTREACH CONTROLLERS ---
function startSmsSim(leadId) {
  navigateToTab('sms-hub');
  state.selectedSMSLeadId = leadId;
  renderSMSList();
  selectSMSLead(leadId);
}

// Initials for the conversation avatars. Contact names are optional, so this
// always has to produce something rather than assuming a full name exists.
function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  return parts.map(p => p[0]).join('').substring(0, 2).toUpperCase();
}

function renderSMSList() {
  const container = document.getElementById('sms-contacts-list');
  container.innerHTML = '';

  if (state.leads.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding: 24px 12px;"><p>No prospects yet.</p></div>';
    return;
  }

  state.leads.forEach(lead => {
    const isActive = lead.id === state.selectedSMSLeadId;

    const item = document.createElement('div');
    item.className = `sms-contact-item ${isActive ? 'active' : ''}`;
    item.dataset.leadId = lead.id;
    item.onclick = () => selectSMSLead(lead.id);

    const lastMsg = lead.lastInteraction || 'No conversations yet.';

    item.innerHTML = `
      <div class="sms-contact-avatar">${esc(initials(lead.contactPerson))}</div>
      <div class="sms-contact-details">
        <div class="sms-contact-meta">
          <span class="sms-contact-name">${esc(lead.contactPerson || lead.businessName)}</span>
          <span class="sms-contact-time">${esc(lead.status)}</span>
        </div>
        <div class="sms-contact-preview">${esc(lastMsg)}</div>
      </div>
    `;
    container.appendChild(item);
  });
}

function renderThread(lead) {
  const msgBox = document.getElementById('chat-messages-box');
  msgBox.innerHTML = '';

  if (state.thread.length === 0) {
    msgBox.innerHTML = `
      <div class="empty-state" style="padding: 20px 0;">
        <i data-lucide="sparkles"></i>
        <p>No active message thread with ${esc(lead.contactPerson || lead.businessName)}.</p>
        <button class="btn btn-primary" id="start-sms-btn">
          <i data-lucide="message-square"></i> Simulate AI Automated Outreach
        </button>
      </div>
    `;
    const startBtn = document.getElementById('start-sms-btn');
    if (startBtn) startBtn.addEventListener('click', () => triggerSmsSimulation(lead.id));
    lucide.createIcons();
    return;
  }

  state.thread.forEach(message => {
    const bubble = document.createElement('div');
    // 'agent' is the AI (or a human taking over) and renders on the left;
    // 'customer' is the prospect and renders on the right.
    bubble.className = `sms-bubble ${message.sender === 'agent' ? 'agent' : 'customer'}`;
    bubble.innerHTML = `${esc(message.body)} <span class="sms-time">${esc(formatClockTime(message.sentAt))}</span>`;
    msgBox.appendChild(bubble);
  });

  msgBox.scrollTop = msgBox.scrollHeight;
}

async function selectSMSLead(leadId) {
  state.selectedSMSLeadId = leadId;

  // Highlight by id rather than by list position.
  document.querySelectorAll('.sms-contact-item').forEach(item => {
    item.classList.toggle('active', item.dataset.leadId === leadId);
  });

  const lead = state.leads.find(l => l.id === leadId);
  if (!lead) return;

  document.getElementById('sms-chat-empty').style.display = 'none';
  document.getElementById('sms-chat-active').style.display = 'flex';

  document.getElementById('chat-header-name').textContent = lead.contactPerson || lead.businessName;
  document.getElementById('chat-header-business').textContent = lead.businessName;
  document.getElementById('chat-header-avatar').textContent = initials(lead.contactPerson);

  const msgBox = document.getElementById('chat-messages-box');
  msgBox.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 24px;">Loading thread...</div>';

  try {
    const res = await apiFetch(`/prospects/${encodeURIComponent(leadId)}/messages`);
    state.thread = (res && res.messages) || [];
  } catch (err) {
    state.thread = [];
    msgBox.innerHTML = `<div style="text-align: center; color: var(--color-danger); padding: 24px;">${esc(err.message)}</div>`;
    return;
  }

  // Ignore a response that arrived after the operator moved on.
  if (state.selectedSMSLeadId !== leadId) return;
  renderThread(lead);
}

async function triggerSmsSimulation(leadId) {
  const msgBox = document.getElementById('chat-messages-box');
  msgBox.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 40px;">Generating conversational AI thread...</div>';

  try {
    await apiFetch('/simulate-sms', {
      method: 'POST',
      body: JSON.stringify({ leadId })
    });
  } catch (err) {
    msgBox.innerHTML = `<div style="text-align: center; color: var(--color-danger); padding: 40px;">${esc(err.message)}</div>`;
    return;
  }

  await loadAllData();
  await selectSMSLead(leadId);
}

async function sendManualSMS() {
  const textInput = document.getElementById('sms-manual-reply');
  const sendBtn = document.getElementById('sms-send-btn');
  const body = textInput.value.trim();
  const leadId = state.selectedSMSLeadId;

  if (!body || !leadId) return;

  const lead = state.leads.find(l => l.id === leadId);
  if (!lead) return;

  textInput.value = '';
  sendBtn.disabled = true;

  try {
    // The message is stored server-side, so it survives a reload — and any
    // reply comes back in the same response.
    const res = await apiFetch(`/prospects/${encodeURIComponent(leadId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body })
    });
    state.thread = (res && res.messages) || state.thread;
    renderThread(lead);
  } catch (err) {
    textInput.value = body; // Give the operator their text back
    showBanner(`Message not sent: ${err.message}`);
  } finally {
    sendBtn.disabled = false;
  }
}

async function deleteLead(leadId) {
  if (!confirm('Are you sure you want to delete this prospect?')) return;

  try {
    await apiFetch(`/prospects/${encodeURIComponent(leadId)}`, { method: 'DELETE' });
  } catch (err) {
    showBanner(`Could not delete the prospect: ${err.message}`);
    return;
  }

  if (state.selectedSMSLeadId === leadId) {
    state.selectedSMSLeadId = null;
    state.thread = [];
    document.getElementById('sms-chat-active').style.display = 'none';
    document.getElementById('sms-chat-empty').style.display = 'flex';
  }

  await loadAllData();
}

// --- EVENT HANDLERS & HELPERS ---
function setupEventListeners() {
  // Sign out — clears the session cookie server-side, then returns to the form.
  const signOutBtn = document.getElementById('portal-signout-btn');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', async () => {
      signOutBtn.disabled = true;
      try {
        await fetch('/api/portal/logout', { method: 'POST' });
      } catch (err) {
        // The cookie may survive an offline logout, so say so rather than
        // pretending the session is gone.
        signOutBtn.disabled = false;
        showBanner('Could not reach the server to sign out. Check your connection and try again.');
        return;
      }
      redirectToLogin();
    });
  }

  // Lead manual modal buttons
  const addLeadBtn = document.getElementById('add-lead-btn');
  const modal = document.getElementById('add-lead-modal');
  const closeBtn = document.getElementById('modal-close-btn');
  const cancelBtn = document.getElementById('modal-cancel-btn');
  const addLeadForm = document.getElementById('add-lead-form');

  addLeadBtn.addEventListener('click', () => modal.classList.add('active'));
  closeBtn.addEventListener('click', () => modal.classList.remove('active'));
  cancelBtn.addEventListener('click', () => modal.classList.remove('active'));

  addLeadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      businessName: document.getElementById('lead-modal-business').value,
      contactPerson: document.getElementById('lead-modal-contact').value,
      industry: document.getElementById('lead-modal-industry').value,
      location: document.getElementById('lead-modal-location').value,
      phone: document.getElementById('lead-modal-phone').value,
      email: document.getElementById('lead-modal-email').value,
      website: document.getElementById('lead-modal-website').value,
      painPoints: document.getElementById('lead-modal-pain').value
    };

    try {
      await apiFetch('/prospects', { method: 'POST', body: JSON.stringify(data) });
    } catch (err) {
      alert(`Could not add the prospect: ${err.message}`);
      return;
    }

    modal.classList.remove('active');
    addLeadForm.reset();
    await loadAllData();
  });

  // Prospect table row actions
  document.getElementById('leads-table-body').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.action === 'call') startCallSim(id);
    else if (btn.dataset.action === 'sms') startSmsSim(id);
    else if (btn.dataset.action === 'delete') deleteLead(id);
  });

  // Lead finder search form
  const searchForm = document.getElementById('lead-search-form');
  const searchBtn = document.getElementById('search-leads-submit');

  searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const industry = document.getElementById('search-industry').value;
    const location = document.getElementById('search-location').value;

    searchBtn.disabled = true;
    searchBtn.innerHTML = '<span class="status-indicator-pulse" style="margin-right: 8px;"></span> Finding Leads...';

    let res = null;
    let error = null;
    try {
      res = await apiFetch('/search', {
        method: 'POST',
        body: JSON.stringify({ industry, location })
      });
    } catch (err) {
      error = err;
    }

    searchBtn.disabled = false;
    searchBtn.innerHTML = '<i data-lucide="search"></i> Find New Prospects';
    lucide.createIcons();

    if (error) {
      alert(error.message);
      return;
    }

    // A search can legitimately add nothing: every match may already be in the
    // pipeline from an earlier run. Say which happened rather than reporting
    // "added 0" and leaving the operator to guess whether it broke.
    const where = res.locationName || location;
    if (res.count === 0) {
      alert(`No new prospects — all ${res.skipped} matching business${res.skipped === 1 ? '' : 'es'} in ${where} are already in your pipeline.`);
    } else {
      const alsoSkipped = res.skipped
        ? ` ${res.skipped} more were already in your pipeline.`
        : '';
      alert(`Added ${res.count} real business${res.count === 1 ? '' : 'es'} in ${where}.${alsoSkipped} Contact names are not in the directory — add them as you qualify each lead.`);
    }
    searchForm.reset();
    await loadAllData();
  });

  // Campaign settings save
  const campaignForm = document.getElementById('campaign-form');
  const campaignResetBtn = document.getElementById('campaign-reset-btn');
  const unsavedBadge = document.getElementById('unsaved-badge');

  // Track unsaved states
  campaignForm.querySelectorAll('input, textarea').forEach(el => {
    el.addEventListener('input', () => {
      unsavedBadge.style.display = 'inline';
    });
  });

  // Dynamic Voice selection display changes
  const agentSelect = document.getElementById('elevenlabs-agent-voice');
  const agentCustomInput = document.getElementById('elevenlabs-agent-voice-custom');
  agentSelect.addEventListener('change', () => {
    agentCustomInput.style.display = agentSelect.value === 'custom' ? 'block' : 'none';
    unsavedBadge.style.display = 'inline';
  });

  const customerSelect = document.getElementById('elevenlabs-customer-voice');
  const customerCustomInput = document.getElementById('elevenlabs-customer-voice-custom');
  customerSelect.addEventListener('change', () => {
    customerCustomInput.style.display = customerSelect.value === 'custom' ? 'block' : 'none';
    unsavedBadge.style.display = 'inline';
  });

  // Campaign identity chooser: EchoLift's own offer, the generic white-label
  // agency pitch, or one built around a real prospect.
  const presetDropdown = document.getElementById('campaign-preset-dropdown');
  const customerRow = document.getElementById('campaign-customer-row');
  const customerSelectLead = document.getElementById('campaign-customer-lead');

  presetDropdown.addEventListener('change', () => {
    const val = presetDropdown.value;
    const isCustomer = val === 'customer';
    customerRow.style.display = isCustomer ? 'block' : 'none';

    if (!val) return;

    if (isCustomer) {
      // Nothing is filled until a prospect is picked — there are no details to
      // use yet, and silently writing a half-finished pitch would be worse than
      // leaving the form as the operator left it.
      populateCustomerPresetDropdown();
      if (customerSelectLead.value) customerSelectLead.dispatchEvent(new Event('change'));
      return;
    }

    const preset = CAMPAIGN_PRESETS[val];
    if (!preset) return;

    unsavedBadge.style.display = 'inline';
    applyCampaignFields(preset.fields);
    applyVoiceSelection('elevenlabs-agent-voice', preset.agentVoice);
    applyVoiceSelection('elevenlabs-customer-voice', preset.customerVoice);
  });

  customerSelectLead.addEventListener('change', () => {
    const lead = state.leads.find(l => l.id === customerSelectLead.value);
    if (!lead) return;

    unsavedBadge.style.display = 'inline';
    applyCampaignFields(customerPresetFields(lead));

    // The caller's own identity is left as-is, so make sure there is one rather
    // than saving a pitch from a nameless company.
    const companyInput = document.getElementById('campaign-company-name');
    const agentInput = document.getElementById('campaign-agent-name');
    if (!companyInput.value.trim()) companyInput.value = 'ApexVoice Agency';
    if (!agentInput.value.trim()) agentInput.value = 'Alice';
    if (!document.getElementById('campaign-pricing').value.trim()) {
      document.getElementById('campaign-pricing').value = '£249/month';
    }

    applyVoiceSelection('elevenlabs-agent-voice', 'Xb7hH2yqWyRel9GQ555e');
    applyVoiceSelection('elevenlabs-customer-voice', 'JBF2rCBphFnJZjxrOi8j');
  });

  campaignForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const agentVoiceSelect = document.getElementById('elevenlabs-agent-voice').value;
    const agentVoiceCustom = document.getElementById('elevenlabs-agent-voice-custom').value;
    const agentVoice = agentVoiceSelect === 'custom' ? agentVoiceCustom : agentVoiceSelect;

    const customerVoiceSelect = document.getElementById('elevenlabs-customer-voice').value;
    const customerVoiceCustom = document.getElementById('elevenlabs-customer-voice-custom').value;
    const customerVoice = customerVoiceSelect === 'custom' ? customerVoiceCustom : customerVoiceSelect;

    const keyInput = document.getElementById('elevenlabs-key');
    const clearKey = document.getElementById('elevenlabs-clear');

    const data = {
      companyName: document.getElementById('campaign-company-name').value,
      serviceName: document.getElementById('campaign-service-name').value,
      pricing: document.getElementById('campaign-pricing').value,
      agentName: document.getElementById('campaign-agent-name').value,
      personality: document.getElementById('campaign-personality').value,
      productDescription: document.getElementById('campaign-description').value,
      primaryHook: document.getElementById('campaign-hook').value,
      objectionHandling: {
        pricing: document.getElementById('objection-pricing').value,
        trust: document.getElementById('objection-trust').value,
        complexity: document.getElementById('objection-complexity').value
      },
      elevenLabsAgentVoice: agentVoice,
      elevenLabsCustomerVoice: customerVoice
    };

    // Only send a key when one was actually typed; blank means "keep it".
    if (keyInput.value.trim()) data.elevenLabsKey = keyInput.value.trim();
    if (clearKey && clearKey.checked) data.clearElevenLabsKey = true;

    try {
      await apiFetch('/campaign', { method: 'POST', body: JSON.stringify(data) });
    } catch (err) {
      alert(`Could not save the campaign: ${err.message}`);
      return;
    }

    unsavedBadge.style.display = 'none';
    alert('Campaign configurations updated successfully.');
    await loadAllData();
  });

  // Reset campaign to defaults
  campaignResetBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to reset your campaign to default settings?')) return;

    const defaults = {
      companyName: 'OmniFlow Automation',
      serviceName: 'AI Customer Receptionist & SMS Lead Booker',
      pricing: '$199/month',
      agentName: 'Alex',
      personality: 'Friendly, consultative, and highly professional',
      productDescription: 'We install custom AI voice receptionists that answer missed calls 24/7, book appointments directly into calendars, and send instant follow-up texts so local businesses never lose a lead to voicemail.',
      primaryHook: 'Did you know that 62% of incoming calls to small businesses go unanswered? We prevent that by deploying a custom AI receptionist that picks up in 2 seconds, answers customer questions, and books bookings right into your system.',
      objectionHandling: {
        pricing: 'At just $199/month, it pays for itself if it saves just one single customer booking. Plus, there is no long-term contract and we offer a 14-day free trial to prove it works.',
        trust: 'We build a fully custom prototype for your business first. You can call and test it yourself before you pay a single penny.',
        complexity: 'Our team handles 100% of the setup. It takes under 15 minutes of your time to link your calendar, and we handle the rest.'
      }
    };

    try {
      // Voice settings and the saved key are intentionally omitted, and the API
      // leaves omitted fields untouched.
      await apiFetch('/campaign', { method: 'POST', body: JSON.stringify(defaults) });
    } catch (err) {
      alert(`Could not reset the campaign: ${err.message}`);
      return;
    }

    unsavedBadge.style.display = 'none';
    await loadAllData();
  });

  // Call simulator buttons
  document.getElementById('start-simulation-btn').addEventListener('click', triggerCallSimulation);
  document.getElementById('hangup-call-btn').addEventListener('click', hangUpCall);

  // SMS manual chat send
  document.getElementById('sms-send-btn').addEventListener('click', sendManualSMS);
  document.getElementById('sms-manual-reply').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendManualSMS();
  });

  // Refresh logs button
  document.getElementById('refresh-logs-btn').addEventListener('click', async () => {
    await loadAllData();
  });
}

// Format a timestamp as a short local clock time.
function formatClockTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Format date into human relative time
function formatTimeAgo(date) {
  if (!date || Number.isNaN(date.getTime())) return 'unknown time';

  const seconds = Math.floor((new Date() - date) / 1000);

  let interval = Math.floor(seconds / 31536000);
  if (interval >= 1) return interval === 1 ? '1 year ago' : `${interval} years ago`;

  interval = Math.floor(seconds / 2592000);
  if (interval >= 1) return interval === 1 ? '1 month ago' : `${interval} months ago`;

  interval = Math.floor(seconds / 86400);
  if (interval >= 1) return interval === 1 ? '1 day ago' : `${interval} days ago`;

  interval = Math.floor(seconds / 3600);
  if (interval >= 1) return interval === 1 ? '1 hour ago' : `${interval} hours ago`;

  interval = Math.floor(seconds / 60);
  if (interval >= 1) return interval === 1 ? '1 minute ago' : `${interval} minutes ago`;

  return 'just now';
}
