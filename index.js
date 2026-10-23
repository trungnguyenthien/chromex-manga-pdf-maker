// DOM Elements
const baseUrlInput = document.getElementById('baseUrl');
const imageUrlFilterInput = document.getElementById('imageUrlFilter');
const urlsChapterTextarea = document.getElementById('urlsChapter');
const mangaTitleInput = document.getElementById('mangaTitle');
const chaptersList = document.getElementById('chaptersList');
const groupByButtons = document.querySelectorAll('.groupby-btn');
const revertListBtn = document.getElementById('revertListBtn');
const numPartsInput = document.getElementById('numParts');
const siteConfigSelect = document.getElementById('siteConfigSelect');
const saveSiteConfigBtn = document.getElementById('saveSiteConfigBtn');
const deleteSiteConfigBtn = document.getElementById('deleteSiteConfigBtn');
const currentDomainBadge = document.getElementById('currentDomainBadge');
const siteConfigStatus = document.getElementById('siteConfigStatus');

// State
let currentGroupBy = 2;
let numParts = null; // null means "use currentGroupBy", number means "divide evenly"
let chapterUrls = [];
let chapterImageCounts = {}; // Store image count for each chapter URL
let hasReceivedPageInfo = false; // Flag to track first pageInfo
let hasAutoReversed = false; // Flag to track if list was auto-reversed once
let currentPageUrl = ''; // Store current page URL
let partStatuses = []; // Track status per part: 'idle' | 'GettingChap' | 'GettingImages' | 'Completed' | 'Error'
let partReports = {}; // Track image status reports per partIndex
let autoDownloadActive = false;
let autoDownloadParts = []; // { urls, partNumber, partIndex }
let autoDownloadQueue = []; // parts waiting to start GettingChap
let hasEverDownloaded = false;

// Compute download state for tab title indicator
function getDownloadState() {
  const isDownloading = autoDownloadActive || (Array.isArray(partStatuses) && partStatuses.some(s => s === 'GettingChap' || s === 'GettingImages'));
  const hasCompletedParts = Array.isArray(partStatuses) && partStatuses.some(s => s === 'Completed');
  const hasStopped = !isDownloading && (hasEverDownloaded || hasCompletedParts);
  return {
    isDownloading,
    hasCompletedParts,
    hasEverDownloaded,
    hasStopped,
    mangaTitle: (mangaTitleInput && mangaTitleInput.value) ? mangaTitleInput.value.trim() : ''
  };
}

// Report download state to parent content script (runs in top-level tab)
function reportDownloadStatusToParent() {
  const state = getDownloadState();
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        action: 'tabDownloadStatus',
        ...state
      }, '*');
    }
  } catch (e) {
    console.warn('[Status] Error reporting download status to parent:', e);
  }
}

// Helper: readable label for part status
function getStatusBadgeText(status) {
  switch (status) {
    case 'Completed': return '🟣 Hoàn thành';
    case 'GettingChap': return '⏳ Đang quét chap';
    case 'GettingImages': return '⏳ Đang tải ảnh';
    case 'Error': return '❌ Lỗi';
    case 'idle':
    default: return 'Sẵn sàng';
  }
}

// ── Site Configuration Storage (Domain Presets) ────────────────────────────────
const STORAGE_SITE_CONFIGS_KEY = 'mangaSiteConfigs';

function getAllSiteConfigs() {
  try {
    const raw = localStorage.getItem(STORAGE_SITE_CONFIGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('Error reading site configs:', e);
    return {};
  }
}

function saveAllSiteConfigs(configs) {
  try {
    localStorage.setItem(STORAGE_SITE_CONFIGS_KEY, JSON.stringify(configs));
  } catch (e) {
    console.error('Error saving site configs:', e);
  }
}

function extractDomain(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return '';
  try {
    const trimmed = urlStr.trim();
    if (!trimmed) return '';
    const validUrl = trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : 'https://' + trimmed;
    return new URL(validUrl).hostname.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

function showConfigStatus(msg, type = 'success') {
  if (!siteConfigStatus) return;
  siteConfigStatus.textContent = msg;
  siteConfigStatus.className = `site-config-status ${type}`;
  clearTimeout(siteConfigStatus._timer);
  siteConfigStatus._timer = setTimeout(() => {
    siteConfigStatus.textContent = '';
  }, 4000);
}

function updateDomainBadge(domain) {
  if (!currentDomainBadge) return;
  if (domain) {
    currentDomainBadge.textContent = domain;
    currentDomainBadge.title = `Domain hiện tại: ${domain}`;
  } else {
    currentDomainBadge.textContent = 'Chưa xác định';
    currentDomainBadge.title = 'Chưa xác định domain';
  }
}

function populateSiteConfigsDropdown(selectedDomain = '') {
  if (!siteConfigSelect) return;
  const configs = getAllSiteConfigs();
  const domains = Object.keys(configs).sort();

  siteConfigSelect.innerHTML = '<option value="">-- Chọn cấu hình đã lưu --</option>';
  domains.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d;
    const item = configs[d];
    const filterCount = (item.imageUrlFilter || '').split('\n').filter(l => l.trim()).length;
    const filterInfo = filterCount > 0 ? ` (${filterCount} filter)` : '';
    opt.textContent = `${d}${filterInfo}`;
    if (d === selectedDomain) {
      opt.selected = true;
    }
    siteConfigSelect.appendChild(opt);
  });
}

function loadSiteConfigForDomain(domain, autoQuery = false) {
  if (!domain) return false;
  const configs = getAllSiteConfigs();
  const cfg = configs[domain];
  if (!cfg) return false;

  console.log(`[SiteConfig] Loading config for ${domain}:`, cfg);

  if (cfg.baseUrl) {
    baseUrlInput.value = cfg.baseUrl;
  }
  if (cfg.imageUrlFilter !== undefined) {
    imageUrlFilterInput.value = cfg.imageUrlFilter;
  }
  if (cfg.chapterSelector !== undefined && cfg.chapterSelector !== '') {
    urlsChapterTextarea.value = cfg.chapterSelector;
  }
  if (cfg.groupBy !== undefined) {
    currentGroupBy = cfg.groupBy;
    numParts = null;
    numPartsInput.value = '';
    groupByButtons.forEach(btn => {
      const btnValue = btn.dataset.value === 'all' ? 'all' : parseInt(btn.dataset.value);
      if (btnValue === currentGroupBy) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  updateDomainBadge(domain);
  populateSiteConfigsDropdown(domain);
  saveData();

  // If selector is present and autoQuery is true, trigger chapter links query
  const selector = (cfg.chapterSelector || urlsChapterTextarea.value || '').trim();
  if (autoQuery && selector && !selector.includes('<') && !selector.includes('>')) {
    console.log(`[SiteConfig] Auto-querying with selector: ${selector}`);
    window.parent.postMessage({
      action: 'queryChapterLinks',
      selector: selector,
      baseUrl: baseUrlInput.value.trim()
    }, '*');
  } else if (urlsChapterTextarea.value) {
    parseChapterUrls();
  }

  return true;
}

function saveCurrentSiteConfig() {
  const currentBase = baseUrlInput.value.trim();
  const domain = extractDomain(currentBase) || extractDomain(currentPageUrl);
  if (!domain) {
    alert('Vui lòng nhập Base URL hoặc mở trang truyện để xác định domain.');
    return;
  }

  const configs = getAllSiteConfigs();
  const newConfig = {
    domain: domain,
    baseUrl: currentBase || `https://${domain}`,
    imageUrlFilter: imageUrlFilterInput.value.trim(),
    chapterSelector: urlsChapterTextarea.value.trim(),
    groupBy: currentGroupBy,
    updatedAt: Date.now()
  };

  configs[domain] = newConfig;
  saveAllSiteConfigs(configs);
  populateSiteConfigsDropdown(domain);
  updateDomainBadge(domain);
  showConfigStatus(`✅ Đã lưu cấu hình cho "${domain}"!`, 'success');
  console.log(`[SiteConfig] Saved config for ${domain}:`, newConfig);
}

function deleteCurrentSiteConfig() {
  const selectedDomain = siteConfigSelect.value || extractDomain(baseUrlInput.value) || extractDomain(currentPageUrl);
  if (!selectedDomain) {
    alert('Vui lòng chọn domain cần xóa trong danh sách.');
    return;
  }

  const configs = getAllSiteConfigs();
  if (!configs[selectedDomain]) {
    alert(`Không tìm thấy cấu hình của domain "${selectedDomain}".`);
    return;
  }

  if (confirm(`Bạn có chắc muốn xóa cấu hình của domain "${selectedDomain}"?`)) {
    delete configs[selectedDomain];
    saveAllSiteConfigs(configs);
    populateSiteConfigsDropdown();
    showConfigStatus(`🗑️ Đã xóa cấu hình "${selectedDomain}"`, 'info');
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadSavedData();
  setupEventListeners();
  populateSiteConfigsDropdown();
  const initialDomain = extractDomain(baseUrlInput.value);
  if (initialDomain) updateDomainBadge(initialDomain);
  
  // Initial report and periodic 4-second check for tab title icon
  reportDownloadStatusToParent();
  setInterval(reportDownloadStatusToParent, 4000);
  
  // Listen for messages from content script
  window.addEventListener('message', (event) => {
    // Handle page info from content script
    if (event.data.action === 'pageInfo') {
      console.log('Received page info:', event.data);
      
      // Save current page URL
      currentPageUrl = event.data.url;
      const currentDomain = extractDomain(event.data.origin || event.data.url);
      updateDomainBadge(currentDomain);
      
      // Auto-fill Manga Title from page title - always update on first pageInfo
      if (!hasReceivedPageInfo) {
        hasReceivedPageInfo = true;
        // Clean up the title (remove status emojis and common suffixes like " - Read Online", etc.)
        let cleanTitle = event.data.title
          .replace(/^([🟣🟪💜🔮✅⏳⬇️✓✔]|\u2705|\u23f3|\u{1f7e3}|\u{1f7ea}|\u{1f49c})\s*/iu, '')
          .replace(/\s*[-|]\s*(Read Online|Manga|Chapter|Latest).*$/i, '')
          .trim();
        mangaTitleInput.value = cleanTitle;
      }
      
      // Check if we have a saved site config for this domain
      const configs = getAllSiteConfigs();
      if (currentDomain && configs[currentDomain]) {
        console.log(`[SiteConfig] Auto-applying saved config for ${currentDomain}`);
        loadSiteConfigForDomain(currentDomain, true); // true = autoQuery
        showConfigStatus(`✓ Tự động nạp cấu hình "${currentDomain}"`, 'success');
      } else {
        // Auto-fill Base URL if not already set
        if (!baseUrlInput.value.trim() || baseUrlInput.value === 'https://comics.vn/') {
          baseUrlInput.value = event.data.origin;
        }
        
        // Auto-query chapters if we have a saved selector
        const savedSelector = urlsChapterTextarea.value.trim();
        if (savedSelector && !savedSelector.includes('<') && !savedSelector.includes('>')) {
          console.log('Auto-querying with saved selector:', savedSelector);
          window.parent.postMessage({
            action: 'queryChapterLinks',
            selector: savedSelector,
            baseUrl: baseUrlInput.value.trim()
          }, '*');
        } else if (!savedSelector) {
          // If no selector/URLs provided, use current page as single chapter
          console.log('No chapter URLs provided, using current page as single chapter');
          chapterUrls = [currentPageUrl];
          updateChaptersList();
          saveData();
        }
      }
      
      saveData();
    }
    
    // Handle check download status query from parent
    if (event.data.action === 'checkDownloadStatus') {
      reportDownloadStatusToParent();
      return;
    }

    // Handle query results
    if (event.data.action === 'queryChapterLinksResult') {
      if (event.data.error) {
        console.error('Error querying page:', event.data.error);
        alert(`Error querying selector "${event.data.selector}": ${event.data.error}`);
        return;
      }
      
      console.log(`Found ${event.data.urls.length} URLs using selector: ${event.data.selector}`);
      chapterUrls = removeDuplicateUrls(event.data.urls);
      if (chapterUrls.length < event.data.urls.length) {
        console.log(`Removed ${event.data.urls.length - chapterUrls.length} duplicate URL(s). Final count: ${chapterUrls.length}`);
      }
      
      // If no URLs found and we have current page, use it as single chapter
      if (chapterUrls.length === 0 && currentPageUrl) {
        console.log('No chapter URLs found with selector, using current page as single chapter');
        chapterUrls = [currentPageUrl];
      }
      
      // Auto-reverse list once on first parse
      if (!hasAutoReversed && chapterUrls.length > 0) {
        console.log('Auto-reversing chapter list (first time)');
        chapterUrls.reverse();
        hasAutoReversed = true;
      }
      
      partStatuses = [];
      partReports = {};
      updateChaptersList();
      saveData();
    }
  });
});

// Setup event listeners
function setupEventListeners() {
  // GroupBy buttons
  groupByButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      groupByButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentGroupBy = btn.dataset.value === 'all' ? 'all' : parseInt(btn.dataset.value);
      // Clear numParts when switching to groupBy buttons
      numParts = null;
      numPartsInput.value = '';
      partStatuses = [];
      partReports = {};
      saveData();
      updateChaptersList();
    });
  });

  // Site Config dropdown change
  if (siteConfigSelect) {
    siteConfigSelect.addEventListener('change', () => {
      const selectedDomain = siteConfigSelect.value;
      if (selectedDomain) {
        loadSiteConfigForDomain(selectedDomain, true);
        showConfigStatus(`✓ Đã nạp cấu hình "${selectedDomain}"`, 'success');
      }
    });
  }

  // Save Site Config button
  if (saveSiteConfigBtn) {
    saveSiteConfigBtn.addEventListener('click', () => {
      saveCurrentSiteConfig();
    });
  }

  // Delete Site Config button
  if (deleteSiteConfigBtn) {
    deleteSiteConfigBtn.addEventListener('click', () => {
      deleteCurrentSiteConfig();
    });
  }

  // URL's chapter textarea
  urlsChapterTextarea.addEventListener('input', () => {
    parseChapterUrls();
  });

  // Base URL input
  baseUrlInput.addEventListener('input', () => {
    const domain = extractDomain(baseUrlInput.value);
    if (domain) updateDomainBadge(domain);
    parseChapterUrls();
  });

  // Image URL Filter input
  imageUrlFilterInput.addEventListener('input', () => {
    saveData();
  });

  // Manga Title input
  mangaTitleInput.addEventListener('input', () => {
    saveData();
  });

  // Revert List button
  revertListBtn.addEventListener('click', () => {
    chapterUrls.reverse();
    partStatuses = [];
    partReports = {};
    hasEverDownloaded = false;
    updateChaptersList();
    saveData();
    reportDownloadStatusToParent();
  });

  // NumParts input
  numPartsInput.addEventListener('input', () => {
    const val = parseInt(numPartsInput.value.trim());
    numParts = (isNaN(val) || val < 1) ? null : val;
    partStatuses = [];
    partReports = {};
    saveData();
    updateChaptersList();
  });

  // Auto-Download button
  document.getElementById('autoDownloadBtn').addEventListener('click', () => {
    if (autoDownloadActive) {
      stopAutoDownload();
    } else {
      startAutoDownload();
    }
  });
}

// Parse chapter URLs from HTML or CSS selector
function parseChapterUrls() {
  const htmlContent = urlsChapterTextarea.value.trim();
  const baseUrl = baseUrlInput.value.trim();
  
  if (!htmlContent) {
    // If empty, use current page as single chapter
    if (currentPageUrl) {
      console.log('No chapter URLs provided, using current page as single chapter');
      chapterUrls = [currentPageUrl];
    } else {
      chapterUrls = [];
    }
    partStatuses = [];
    partReports = {};
    updateChaptersList();
    saveData();
    return;
  }

  // Check if input is a CSS selector (simple heuristic)
  // CSS selectors typically don't contain < or > and are relatively short single lines
  const looksLikeSelector = !htmlContent.includes('<') && 
                            !htmlContent.includes('>') && 
                            htmlContent.split('\n').length === 1 &&
                            htmlContent.length < 200;
  
  if (looksLikeSelector) {
    // Try to query current page DOM via content script
    console.log('Detected CSS selector, querying current page:', htmlContent);
    
    // Show temporary message
    chaptersList.innerHTML = '<div class="empty-message">Querying page with selector: ' + htmlContent + '...</div>';
    
    // Send message to parent window (content script)
    window.parent.postMessage({
      action: 'queryChapterLinks',
      selector: htmlContent,
      baseUrl: baseUrl
    }, '*');
    
    // Result will be handled by message listener
    return;
  }

  // Otherwise, parse as HTML
  console.log('Parsing as HTML content');
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = htmlContent;
  
  // Extract all <a> tags
  const anchorTags = tempDiv.querySelectorAll('a');
  chapterUrls = [];
  
  anchorTags.forEach(anchor => {
    let href = anchor.getAttribute('href');
    if (href) {
      // Combine with base URL if href is relative
      if (href.startsWith('//')) {
        // Protocol-relative URL
        href = 'https:' + href;
      } else if (href.startsWith('/')) {
        // Relative path
        href = baseUrl.replace(/\/$/, '') + href;
      } else if (!href.startsWith('http')) {
        href = baseUrl.replace(/\/$/, '') + '/' + href;
      }
      chapterUrls.push(href);
    }
  });

  // Remove duplicates
  chapterUrls = removeDuplicateUrls(chapterUrls);
  
  // If no URLs found and we have current page, use it as single chapter
  if (chapterUrls.length === 0 && currentPageUrl) {
    console.log('No chapter URLs parsed from HTML, using current page as single chapter');
    chapterUrls = [currentPageUrl];
  }

  // Auto-reverse list once on first parse
  if (!hasAutoReversed && chapterUrls.length > 0) {
    console.log('Auto-reversing chapter list (first time)');
    chapterUrls.reverse();
    hasAutoReversed = true;
  }

  partStatuses = [];
  partReports = {};
  updateChaptersList();
  saveData();
}

// Helper function to remove duplicate URLs while preserving order
function removeDuplicateUrls(urls) {
  return [...new Set(urls)];
}

// Render parts summary (total chapters + recommended part suggestions)
function renderPartsSummary(parts) {
  const total = chapterUrls.length;
  const partsSummary = document.getElementById('partsSummary');

  // Compute recommended part counts where the last part equals or is 1 chapter shorter
  // Strategy: try divisors of total, then total-1, total-2, ...
  const recommendations = [];
  const tried = new Set();

  // Priority 1: exact divisors (last part == others)
  for (let p = 2; p <= Math.min(total, 10); p++) {
    if (total % p === 0 && !tried.has(p)) {
      recommendations.push({ parts: p, chaptersEach: total / p, note: 'perfectly even' });
      tried.add(p);
    }
  }

  // Priority 2: near-even (last part ≤ others by exactly 1)
  for (let extra = 1; extra <= total && recommendations.length < 5; extra++) {
    const t = total - extra;
    for (let p = 2; p <= Math.min(t, 10); p++) {
      if (t % p === 0 && !tried.has(p)) {
        const base = t / p;
        recommendations.push({ parts: p, chaptersEach: base, extra: extra, note: `last part has ${base - 1}` });
        tried.add(p);
      }
    }
  }

  const completedCount = partStatuses.filter(s => s === 'Completed').length;
  const partsInfo = parts.map((p, i) => {
    const isLast = i === parts.length - 1;
    const label = isLast ? ' (last)' : '';
    const isCompleted = partStatuses[i] === 'Completed';
    const statusIcon = isCompleted ? ' <span class="summary-part-done">🟣</span>' : '';
    return `Part ${i + 1}: ${p.length} chap${label}${statusIcon}`;
  }).join(' &nbsp;|&nbsp; ');

  let html = `<div class="parts-summary-box">
    <div class="summary-row">
      <span class="summary-label">Total:</span>
      <span class="summary-value">${total} chapters &nbsp;|&nbsp; ${parts.length} parts${completedCount > 0 ? ` &nbsp;(<strong style="color: #7c3aed;">${completedCount}/${parts.length} đã hoàn thành 🟣</strong>)` : ''}</span>
    </div>
    <div class="summary-row summary-breakdown">${partsInfo}</div>`;

  if (recommendations.length > 0) {
    const suggestionItems = recommendations.slice(0, 5).map(r => {
      let label = `${r.parts} parts × ${r.chaptersEach} chap`;
      if (r.extra) label += ` <span class="rec-note">(${r.note})</span>`;
      return `<span class="rec-chip" data-parts="${r.parts}">${label}</span>`;
    }).join('');

    html += `<div class="summary-row summary-rec">
      <span class="summary-label">Suggested:</span>
      <div class="rec-chips">${suggestionItems}</div>
    </div>`;
  }

  html += '</div>';
  partsSummary.innerHTML = html;

  // Wire up clickable suggestion chips
  partsSummary.querySelectorAll('.rec-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const p = parseInt(chip.dataset.parts);
      numParts = p;
      numPartsInput.value = p;
      groupByButtons.forEach(b => b.classList.remove('active'));
      partStatuses = [];
      partReports = {};
      saveData();
      updateChaptersList();
    });
  });
}

// Update chapters list display
function updateChaptersList() {
  if (chapterUrls.length === 0) {
    chaptersList.innerHTML = '<div class="empty-message">No chapters yet. Paste HTML with links in the URL\'s chapters field.</div>';
    document.getElementById('partsSummary').innerHTML = '';
    return;
  }

  const parts = groupChapters(chapterUrls, currentGroupBy, numParts);

  // Render parts summary
  renderPartsSummary(parts);

  let globalIndex = 0; // Track global index across all parts

  // Ensure partStatuses length matches number of parts
  while (partStatuses.length < parts.length) partStatuses.push('idle');

  chaptersList.innerHTML = parts.map((part, partIndex) => {
    const isLastPart = partIndex === parts.length - 1;
    const chapCountLabel = isLastPart ? `${part.length} chap (last)` : `${part.length} chap`;
    const status = partStatuses[partIndex] || 'idle';
    const isCompleted = status === 'Completed';

    const statusBadgeText = getStatusBadgeText(status);
    const partCardClass = isCompleted ? 'chapter-part is-completed' : 'chapter-part';
    const btnClass = isCompleted ? 'make-part-btn completed' : 'make-part-btn';
    const btnText = isCompleted
      ? `🟣 Đã tạo xong Part ${partIndex + 1} — ${chapCountLabel} (Tạo lại)`
      : `Make Part ${partIndex + 1} — ${chapCountLabel}`;

    return `
      <div class="${partCardClass}" id="part-${partIndex}">
        <div class="chapter-part-header">
          <span class="part-status-badge status-${status}" id="part-status-${partIndex}">${statusBadgeText}</span>
          <button class="${btnClass}" data-part="${partIndex}">${btnText}</button>
          <div class="part-progress" style="display: none;">
            <div class="progress-bar-inline">
              <div class="progress-fill-inline"></div>
            </div>
            <div class="progress-text-inline">Initializing...</div>
          </div>
        </div>
        <div class="chapter-urls">
          ${part.map((url, localIdx) => {
            const currentIndex = globalIndex++;
            const imageCount = chapterImageCounts[url];
            const imageCountText = imageCount !== undefined ? ` <span class="image-count">(${imageCount} images)</span>` : '';
            return `
              <div class="chapter-url-item" id="chapter-item-${partIndex}-${localIdx}">
                <button class="remove-chapter-btn" data-index="${currentIndex}" title="Remove this chapter">&times;</button>
                <div class="chapter-url">${url}${imageCountText}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');

  // Restore chapter image statuses for parts that have reports
  for (let i = 0; i < parts.length; i++) {
    if (partReports[i]) {
      const { urls: rUrls, chapImageUrls, imageStatuses, chapterStartIndices } = partReports[i];
      showChapterImageStatuses(i, rUrls, chapImageUrls, imageStatuses, chapterStartIndices);
    }
  }

  // Add event listeners to "Make Part" buttons
  document.querySelectorAll('.make-part-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const partIndex = parseInt(e.target.dataset.part);
      const baseUrl = baseUrlInput.value.trim();
      makePart(parts[partIndex], partIndex + 1, partIndex, baseUrl, parts.length);
    });
  });

  // Add event listeners to "Remove Chapter" buttons
  document.querySelectorAll('.remove-chapter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const urlIndex = parseInt(e.target.dataset.index);
      removeChapterUrl(urlIndex);
    });
  });
}

// Remove a chapter URL by index
function removeChapterUrl(index) {
  if (index >= 0 && index < chapterUrls.length) {
    const removedUrl = chapterUrls[index];
    chapterUrls.splice(index, 1);
    console.log(`Removed chapter URL at index ${index}: ${removedUrl}`);
    console.log(`Remaining chapters: ${chapterUrls.length}`);
    partStatuses = [];
    partReports = {};
    // Re-group and update display
    updateChaptersList();
    saveData();
  }
}

// Group chapters based on groupBy value or numParts value
function groupChapters(urls, groupBy, numParts) {
  if (groupBy === 'all') {
    return [urls];
  }

  // If numParts is set, divide chapters evenly across that many parts
  if (numParts !== null && numParts > 0) {
    return groupChaptersEvenly(urls, numParts);
  }

  // Otherwise, use the classic groupBy (chapters per part)
  const parts = [];
  for (let i = 0; i < urls.length; i += groupBy) {
    parts.push(urls.slice(i, i + groupBy));
  }
  return parts;
}

// Divide chapters as evenly as possible across numParts parts
// Last part equals or is 1 chapter shorter than others
// (extra chapters go to FIRST parts so the last part stays smaller/equal)
function groupChaptersEvenly(urls, numParts) {
  const total = urls.length;
  const parts = Math.min(Math.max(1, numParts), total);

  // base = floor, remainder = how many chapters are "left over" after equal split
  const base = Math.floor(total / parts);
  const remainder = total % parts;
  // => total = base * parts + remainder

  // FIRST (remainder) parts get (base + 1) chapters
  // LAST (parts - remainder) parts get base chapters
  // => Last part always gets base, which is <= any +1 part

  const result = [];
  let index = 0;

  for (let i = 0; i < parts; i++) {
    // Put +1 on the FIRST parts so the last part stays at base (smallest)
    const count = i < remainder ? base + 1 : base;
    result.push(urls.slice(index, index + count));
    index += count;
  }

  return result;
}

// Helper function to add delay between requests
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Auto-Download ──────────────────────────────────────────────────────────────

function startAutoDownload() {
  if (chapterUrls.length === 0) {
    alert('No chapters to download.');
    return;
  }
  const parts = groupChapters(chapterUrls, currentGroupBy, numParts);
  autoDownloadParts = parts.map((urls, i) => ({ urls, partNumber: i + 1, partIndex: i }));
  autoDownloadQueue = [...autoDownloadParts]; // copy
  hasEverDownloaded = true;
  autoDownloadActive = true;
  partStatuses = new Array(parts.length).fill('idle');
  partReports = {};
  updateChaptersList();
  updateAutoDownloadUI();
  reportDownloadStatusToParent();
  processNextPart();
}

function stopAutoDownload() {
  autoDownloadActive = false;
  autoDownloadQueue = [];
  updateAutoDownloadUI();
  reportDownloadStatusToParent();
}

function updateAutoDownloadUI() {
  const btn = document.getElementById('autoDownloadBtn');
  if (!btn) return;
  if (autoDownloadActive) {
    btn.textContent = 'Stop Auto-DL';
    btn.classList.add('active');
  } else {
    btn.textContent = 'Auto-Download';
    btn.classList.remove('active');
  }
}

function processNextPart() {
  if (!autoDownloadActive || autoDownloadQueue.length === 0) {
    // All parts started; wait for GettingImages to finish (handled by each makePart callback)
    return;
  }
  const next = autoDownloadQueue.shift();
  const baseUrl = baseUrlInput.value.trim();
  makePart(next.urls, next.partNumber, next.partIndex, baseUrl, autoDownloadParts.length, true);
}

function onPartGettingChapDone() {
  // No-op: GettingChap done → just wait for GettingImages to finish in this part
}

function onPartCompleted() {
  reportDownloadStatusToParent();
  if (!autoDownloadActive) return;
  // Start next part only after current part is FULLY complete (sequential)
  if (autoDownloadQueue.length > 0) {
    processNextPart();
  } else {
    // All parts done
    const allDone = partStatuses.every(s => s === 'Completed' || s === 'idle');
    if (allDone) {
      autoDownloadActive = false;
      updateAutoDownloadUI();
      reportDownloadStatusToParent();
      console.log('[AutoDL] All parts completed.');
    }
  }
}

// ── makePart ───────────────────────────────────────────────────────────────────

// Make PDF from a part
async function makePart(urls, partNumber, partIndex, baseUrl = '', totalParts = 1, autoMode = false) {
  console.log(`Making Part ${partNumber}:`, urls);
  hasEverDownloaded = true;
  
  const filter = imageUrlFilterInput.value.trim();
  
  // Show progress UI for this specific part
  showPartProgress(partIndex, true);
  setPartStatus(partIndex, 'GettingChap');
  reportDownloadStatusToParent();

  try {
    updatePartProgress(partIndex, 0, 'Initializing...');
    
    // Set referer header for all image requests
    if (baseUrl) {
      await chrome.runtime.sendMessage({
        action: 'setReferer',
        referer: baseUrl
      });
    }
    
    const allImages = [];
    const totalChapters = urls.length;
    
    // Step 1: Fetch all chapters and extract images (0-5%)
    const bestUrlsByChapter = []; // store per-chapter image URLs for status tracking

    for (let i = 0; i < urls.length; i++) {
      const chapterUrl = urls[i];
      updatePartProgress(
        partIndex,
        ((i / totalChapters) * 5),
        `Fetching chapter ${i + 1}/${totalChapters}...`
      );

      // Retry logic: if < 10 images found, retry up to 2 more times
      let imageUrls = await fetchAndExtractImages(chapterUrl, filter);
      let bestUrls = [...imageUrls];
      let attempt = 1;

      while (imageUrls.length < 10 && attempt < 3) {
        attempt++;
        console.log(`[Retry] Chapter ${chapterUrl} — attempt ${attempt} (${imageUrls.length} images < 10), retrying...`);
        await delay(2000); // wait 2s before retry
        imageUrls = await fetchAndExtractImages(chapterUrl, filter);
        if (imageUrls.length > bestUrls.length) {
          bestUrls = imageUrls;
        }
      }

      if (imageUrls.length < bestUrls.length) {
        console.log(`[Retry] Chapter ${chapterUrl}: best=${bestUrls.length}, last=${imageUrls.length} — using best result`);
      }

      // Store image count for this chapter
      chapterImageCounts[chapterUrl] = bestUrls.length;
      bestUrlsByChapter.push([...bestUrls]);

      // Log image URLs for this chapter
      console.log(`\n=== Chapter ${i + 1}/${totalChapters} ===`);
      console.log(`URL: ${chapterUrl}`);
      console.log(`Found ${bestUrls.length} images:`);
      bestUrls.forEach((url, idx) => {
        console.log(`  [${idx + 1}] ${url}`);
      });
      console.log(`==================\n`);

      allImages.push(...bestUrls);

      // Add 1 second delay between chapter requests (except for the last one)
      if (i < urls.length - 1) {
        await delay(1000); // 1 second
      }
    }

    if (allImages.length === 0) {
      updatePartProgress(partIndex, 0, 'No images found!');
      setPartStatus(partIndex, 'idle');
      setTimeout(() => showPartProgress(partIndex, false), 2000);
      onPartCompleted();
      return;
    }

    // Deduplicate: remove repeated URLs (ads, shared images across chapters)
    const originalCount = allImages.length;
    const uniqueImageMap = new Map();
    allImages.forEach(url => {
      if (!uniqueImageMap.has(url)) {
        uniqueImageMap.set(url, true);
      }
    });
    const deduplicatedImages = Array.from(uniqueImageMap.keys());
    const removedUrlDupes = originalCount - deduplicatedImages.length;

    if (removedUrlDupes > 0) {
      console.log(`[AdFilter] Removed ${removedUrlDupes} duplicate URL images (${originalCount} → ${deduplicatedImages.length})`);
    }

    updatePartProgress(partIndex, 5, `Found ${deduplicatedImages.length} images${removedUrlDupes > 0 ? ` (${removedUrlDupes} dupes removed)` : ''}. Processing...`);
    setPartStatus(partIndex, 'GettingImages');
    // Auto-DL: GettingChap done — start next part's GettingChap immediately (parallel GettingImages allowed)
    onPartGettingChapDone();

    // Step 2: Download and resize images (5-97%, 92% total) — 5 concurrent
    const CONCURRENT = 5;
    const processedImages = [];
    let skippedByFilter = 0;

    // Track per-image status: { url, ok: bool }
    const imageStatuses = deduplicatedImages.map(url => ({ url, ok: null }));

    // Build chapterStartIndices based on ACTUAL deduplicated images (not chapterImageCounts)
    const chapterStartIndices = [];
    let globalIdx = 0;
    const chapImageUrls = []; // deduplicated URLs per chapter

    for (let c = 0; c < urls.length; c++) {
      chapterStartIndices.push(globalIdx);
      // Count how many of this chapter's bestUrls survived deduplication
      const chapUrls = bestUrlsByChapter[c] || [];
      const kept = chapUrls.filter(u => uniqueImageMap.has(u));
      chapImageUrls.push(kept);
      globalIdx += kept.length;
    }

    for (let batchStart = 0; batchStart < deduplicatedImages.length; batchStart += CONCURRENT) {
      const batch = deduplicatedImages.slice(batchStart, batchStart + CONCURRENT);

      const batchResults = await Promise.all(
        batch.map((url, localIdx) => {
          const globalIdx = batchStart + localIdx;
          updatePartProgress(
            partIndex,
            5 + ((globalIdx / deduplicatedImages.length) * 92),
            `Download image ${globalIdx + 1}/${deduplicatedImages.length}...`
          );
          return downloadAndResizeImage(url).then(imgData => ({ url, imgData, globalIdx }));
        })
      );

      for (const { url, imgData, globalIdx } of batchResults) {
        if (imgData && imgData.ok) {
          imageStatuses[globalIdx] = { url, ok: true };
          processedImages.push(imgData);
        } else {
          imageStatuses[globalIdx] = { url, ok: false, error: (imgData && imgData.error) || '' };
          skippedByFilter++;
        }
      }
    }

    // Show collapsible chapter image status
    showChapterImageStatuses(partIndex, urls, chapImageUrls, imageStatuses, chapterStartIndices);

    // Keep all images (only URL deduplication at parse step)
    const filteredImages = processedImages;

    if (filteredImages.length === 0) {
      updatePartProgress(partIndex, 0, 'Failed to process images!');
      setPartStatus(partIndex, 'idle');
      setTimeout(() => showPartProgress(partIndex, false), 2000);
      onPartCompleted();
      return;
    }

    const totalRemoved = removedUrlDupes + skippedByFilter;
    console.log(`[AdFilter] Total removed: ${totalRemoved} (URL dupes: ${removedUrlDupes}, filter-skip: ${skippedByFilter})`);
    updatePartProgress(partIndex, 97, `Creating PDF (${filteredImages.length} images)...`);

    // Step 3: Generate PDF
    await generatePDF(filteredImages, partNumber, totalParts);

    updatePartProgress(partIndex, 100, 'Done!');
    partReports[partIndex] = { urls, chapImageUrls, imageStatuses, chapterStartIndices };
    setPartStatus(partIndex, 'Completed');
    showPartProgress(partIndex, false);
    updateChaptersList(); // Rebuild DOM first with completed state
    saveData();           // Save the image counts & part statuses
    onPartCompleted();

  } catch (error) {
    console.error('Error creating PDF:', error);
    updatePartProgress(partIndex, 0, `Error: ${error.message}`);
    setPartStatus(partIndex, 'Error');
    setTimeout(() => {
      showPartProgress(partIndex, false);
      updateChaptersList();
    }, 3000);
    onPartCompleted();
  }
}

// Parse multiline Image URL Filter (each option on a line)
function parseFilterRules(filterText) {
  if (!filterText || !filterText.trim()) {
    return { selectors: [], includes: [], excludes: [] };
  }
  const lines = filterText.split('\n').map(l => l.trim()).filter(Boolean);
  const selectors = [];
  const includes = [];
  const excludes = [];

  for (const line of lines) {
    if (line.startsWith('!') || line.startsWith('-')) {
      const ex = line.slice(1).trim();
      if (ex) excludes.push(ex);
    } else {
      const hasClassOrIdOrAttr = line.includes('.') || line.includes('#') || line.includes('[') || line.includes('>');
      const hasUrlPattern = /http|cdn|:\/|\.(jpg|png|webp|gif|jpeg)/i.test(line);
      const looksLikeSelector = hasClassOrIdOrAttr && !hasUrlPattern;

      if (looksLikeSelector) {
        selectors.push(line);
      } else {
        includes.push(line);
      }
    }
  }

  return { selectors, includes, excludes };
}

// Fetch chapter HTML and extract image URLs
// NEW: Opens chapter in real browser tab to allow JavaScript execution
// This enables support for lazy-loading and dynamic content
async function fetchAndExtractImages(url, filter) {
  try {
    // Use background script to open chapter in real tab and extract images
    // This allows JavaScript to execute and lazy-load images
    const response = await chrome.runtime.sendMessage({
      action: 'fetchChapterImages',
      url: url,
      filter: filter
    });
    
    if (!response.success) {
      throw new Error(response.error);
    }
    
    let imageUrls = response.imageUrls || [];
    
    // Apply multiline filter rules if provided
    if (filter && filter.trim()) {
      const rules = parseFilterRules(filter);
      if (rules.excludes.length > 0) {
        imageUrls = imageUrls.filter(u => {
          const lower = u.toLowerCase();
          return !rules.excludes.some(ex => lower.includes(ex.toLowerCase()));
        });
      }
      if (rules.includes.length > 0) {
        imageUrls = imageUrls.filter(u => {
          const lower = u.toLowerCase();
          return rules.includes.some(inc => lower.includes(inc.toLowerCase()));
        });
      }
    }
    
    return imageUrls;
    
  } catch (error) {
    console.error(`Failed to fetch ${url}:`, error);
    return [];
  }
}

// Download image and resize to 800px width
async function downloadAndResizeImage(url) {
  try {
    // Apply multiline filter rules
    const filter = imageUrlFilterInput.value.trim();
    if (filter) {
      const rules = parseFilterRules(filter);
      const lowerUrl = url.toLowerCase();

      // Check exclude rules (e.g. !ads, !banner)
      if (rules.excludes.length > 0 && rules.excludes.some(ex => lowerUrl.includes(ex.toLowerCase()))) {
        console.log(`[AdFilter] Skipped (exclude filter): ${url}`);
        return { url, ok: false, error: 'Bị lọc bởi Exclude Filter' };
      }

      // Check include rules (e.g. cdn.domain.com, /chapters/)
      if (rules.includes.length > 0 && !rules.includes.some(inc => lowerUrl.includes(inc.toLowerCase()))) {
        console.log(`[AdFilter] Skipped (filter miss): ${url}`);
        return { url, ok: false, error: 'Bị lọc bởi Image Url Filter' };
      }
    }

    // Reject known ad domains
    const adDomains = [
      'doubleclick', 'googlesyndication', 'googleadservices', 'adsense',
      'adsserver', 'adnxs', 'advertising', 'banner', 'serving-sys',
      'popads', 'popup', 'adcash', 'adcolony', 'admob', 'mopub',
      'reklama', 'adbutler', 'adform', 'criteo', 'taboola', 'outbrain',
      'revcontent', 'mgid', 'zergnet', 'teads', 'exponential',
      'bidswitch', 'casalemedia', 'openx', 'pubmatic', 'rubicon',
      'amazon-adsystem', 'media.net', 'quantserve'
    ];
    const lowerUrl = url.toLowerCase();
    if (adDomains.some(d => lowerUrl.includes(d))) {
      console.log(`[AdFilter] Skipped (ad domain): ${url}`);
      return { url, ok: false, error: 'Ad domain' };
    }

    // Use background script to fetch image (bypasses CORS, Referer set by declarativeNetRequest)
    const response = await chrome.runtime.sendMessage({
      action: 'fetchImage',
      url: url
    });

    if (!response.success) {
      console.error(`[ImageFetch] Failed: ${url} — ${response.error}`);
      return { url, ok: false, error: `Fetch failed: ${response.error}` };
    }

    // Validate data URL
    if (!response.dataUrl || !response.dataUrl.startsWith('data:')) {
      console.error(`[ImageFetch] Invalid data URL: ${url}`);
      return { url, ok: false, error: 'Invalid data URL' };
    }

    // Reject tiny images (<5KB) — ads / tracking pixels
    const byteSize = Math.round((response.dataUrl.length - response.dataUrl.indexOf(',') - 1) * 0.75);
    if (byteSize < 5000) {
      console.log(`[AdFilter] Skipped (tiny ${byteSize} bytes): ${url}`);
      return { url, ok: false, error: `Quá nhỏ (${byteSize} bytes)` };
    }

    // Create image from base64 data URL
    return new Promise((resolve) => {
      const img = new Image();

      img.onload = () => {
        try {
          const originalWidth = img.width;
          const originalHeight = img.height;

          // Always resize to 800px width
          const targetWidth = 800;
          const aspectRatio = originalHeight / originalWidth;
          const newWidth = targetWidth;
          const newHeight = Math.round(targetWidth * aspectRatio);

          // Detect orientation AFTER resize for PDF page layout
          const isLandscape = newWidth > newHeight;

          console.log(`Image: ${originalWidth}x${originalHeight} → Resize to ${newWidth}x${newHeight} (${isLandscape ? 'Landscape' : 'Portrait'})`);

          // Create canvas with target dimensions
          const canvas = document.createElement('canvas');
          canvas.width = newWidth;
          canvas.height = newHeight;

          // Draw resized image
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, newWidth, newHeight);

          // Get image data
          const imageData = canvas.toDataURL('image/jpeg', 1);

          resolve({
            url: url,
            ok: true,
            data: imageData,
            dataUrl: response.dataUrl,
            width: newWidth,
            height: newHeight,
            isLandscape: isLandscape
          });
        } catch (error) {
          console.error(`[ImageLoad] Resize error: ${url} — ${error.message}`);
          resolve({ url, ok: false, error: `Resize error: ${error.message}` });
        }
      };

      img.onerror = () => {
        console.error(`[ImageLoad] Load error: ${url}`);
        resolve({ url, ok: false, error: 'Image load error' });
      };

      img.src = response.dataUrl;
    });
  } catch (error) {
    console.error(`[ImageFetch] Catch: ${url} — ${error.message}`);
    return { url, ok: false, error: error.message };
  }
}

// Generate PDF from processed images
async function generatePDF(images, partNumber, totalParts = 1) {
  const { jsPDF } = window.jspdf;
  
  if (!images || images.length === 0) {
    throw new Error('No images to create PDF');
  }
  
  // PDF standard DPI is 72
  const PDF_DPI = 72;
  const MM_PER_INCH = 25.4;
  
  console.log(`Creating PDF with ${images.length} images (mixed orientations supported)`);
  
  // Create PDF - will use first image to initialize
  let pdf = null;
  
  // Add images to PDF - each page with its own dimensions and orientation
  images.forEach((img, index) => {
    // Calculate page dimensions in mm based on THIS image
    const pageMmWidth = (img.width / PDF_DPI) * MM_PER_INCH;
    const pageMmHeight = (img.height / PDF_DPI) * MM_PER_INCH;
    
    // Determine orientation based on image dimensions
    const orientation = img.isLandscape ? 'landscape' : 'portrait';
    
    console.log(`Page ${index + 1}: ${img.width}x${img.height}px (${orientation}) → ${pageMmWidth.toFixed(2)}x${pageMmHeight.toFixed(2)}mm`);
    
    if (index === 0) {
      // Create PDF with first image's dimensions and orientation
      pdf = new jsPDF({
        orientation: orientation,
        unit: 'mm',
        format: [pageMmWidth, pageMmHeight],
        compress: true
      });
    } else {
      // Add new page with THIS image's specific dimensions and orientation
      pdf.addPage([pageMmWidth, pageMmHeight], orientation);
    }
    
    // Add image to fill entire page exactly - no margins
    pdf.addImage(img.data, 'JPEG', 0, 0, pageMmWidth, pageMmHeight, undefined, 'FAST');
  });
  
  // Save PDF to Downloads/ folder via native anchor click
  const mangaTitle = mangaTitleInput.value.trim();
  const sanitize = (name) => name.replace(/[|/\\:*?"<>]/g, '_').trim();
  const safeTitle = sanitize(mangaTitle);
  let filename;

  if (totalParts === 1) {
    filename = safeTitle ? `${safeTitle}.pdf` : `manga.pdf`;
  } else {
    filename = safeTitle
      ? `${safeTitle}-part-${String(partNumber).padStart(2, '0')}.pdf`
      : `manga-part-${String(partNumber).padStart(2, '0')}.pdf`;
  }

  const pdfBlob = pdf.output('blob');
  const blobUrl = URL.createObjectURL(pdfBlob);
  console.log(`[Download] PDF blob (${(pdfBlob.size / 1024 / 1024).toFixed(2)}MB), saving as ${filename}...`);

  // Use background SW to download (chromium-compatible, no <a> click needed)
  // Keep blobUrl alive by NOT revoking immediately — SW needs time to fetch it
  await new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      action: 'downloadBlob',
      url: blobUrl,
      filename: filename
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[Download] Error:', chrome.runtime.lastError.message);
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response && !response.success) {
        console.error('[Download] Error:', response.error);
        reject(new Error(response.error || 'Download failed'));
      } else {
        console.log(`[Download] ✓ Saved: ${filename}`);
        resolve(response);
      }
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    });
  });

  console.log(`[Download] ✓ Download completed: ${filename}`);
}

// Inline progress helpers for each part
function showPartProgress(partIndex, show) {
  const partEl = document.getElementById(`part-${partIndex}`);
  if (!partEl) return;
  
  const btn = partEl.querySelector('.make-part-btn');
  const progress = partEl.querySelector('.part-progress');
  
  if (show) {
    btn.style.display = 'none';
    progress.style.display = 'flex';
  } else {
    btn.style.display = 'block';
    progress.style.display = 'none';
  }
}

// Show collapsible per-chapter image load status inside a part
function showChapterImageStatuses(partIndex, urls, chapImageUrls, imageStatuses, chapterStartIndices) {
  urls.forEach((_chapterUrl, cIdx) => {
    const start = chapterStartIndices[cIdx];
    const chapUrls = chapImageUrls[cIdx] || [];
    const count = chapUrls.length;
    const end = start + count;
    const chapStatuses = imageStatuses.slice(start, end);

    // Remove old status if any
    const chapterItem = document.getElementById(`chapter-item-${partIndex}-${cIdx}`);
    if (!chapterItem) return;

    const existing = chapterItem.querySelector('.chap-status-block');
    if (existing) existing.remove();

    const okCount = chapStatuses.filter(s => s.ok === true).length;
    const failCount = chapStatuses.filter(s => s.ok === false).length;

    const block = document.createElement('div');
    block.className = 'chap-status-block';

    // Header row
    const header = document.createElement('div');
    header.className = 'chap-status-header';
    header.textContent = `${okCount}✅ / ${failCount}❌ / ${count} total`;
    block.appendChild(header);

    // Toggle button
    const toggle = document.createElement('button');
    toggle.className = 'chap-status-toggle';
    toggle.textContent = '[+]';
    header.appendChild(toggle);

    // Image list
    const list = document.createElement('div');
    list.className = 'chap-status-list';
    list.style.display = 'none';

    chapStatuses.forEach((s, imgIdx) => {
      const item = document.createElement('div');
      item.className = 'chap-status-item ' + (s.ok === true ? 'ok' : s.ok === false ? 'fail' : 'pending');
      const icon = s.ok === true ? '✅' : s.ok === false ? '❌' : '⏳';
      const errInfo = (s.error && s.ok === false) ? ` — ${s.error}` : '';
      item.textContent = `${icon} ${imgIdx + 1}. ${s.url}${errInfo}`;
      list.appendChild(item);
    });

    toggle.addEventListener('click', () => {
      const visible = list.style.display !== 'none';
      list.style.display = visible ? 'none' : 'block';
      toggle.textContent = visible ? '[+]' : '[-]';
    });

    block.appendChild(list);
    chapterItem.appendChild(block);
  });
}

function updatePartProgress(partIndex, percent, text) {
  const partEl = document.getElementById(`part-${partIndex}`);
  if (!partEl) return;

  const fill = partEl.querySelector('.progress-fill-inline');
  const textEl = partEl.querySelector('.progress-text-inline');

  if (fill) fill.style.width = `${percent}%`;
  if (textEl) textEl.textContent = text;
}

function setPartStatus(partIndex, status) {
  partStatuses[partIndex] = status;
  if (status === 'Completed') {
    hasEverDownloaded = true;
  }
  const badge = document.getElementById(`part-status-${partIndex}`);
  if (badge) {
    badge.className = `part-status-badge status-${status}`;
    badge.textContent = getStatusBadgeText(status);
  }
  const partEl = document.getElementById(`part-${partIndex}`);
  if (partEl) {
    if (status === 'Completed') {
      partEl.classList.add('is-completed');
    } else {
      partEl.classList.remove('is-completed');
    }
  }
  reportDownloadStatusToParent();
}

// Save data to localStorage
function saveData() {
  const data = {
    baseUrl: baseUrlInput.value,
    imageUrlFilter: imageUrlFilterInput.value,
    urlsChapter: urlsChapterTextarea.value,
    mangaTitle: mangaTitleInput.value,
    groupBy: currentGroupBy,
    numParts: numParts,
    chapterUrls: chapterUrls,
    chapterImageCounts: chapterImageCounts,
    partStatuses: partStatuses
  };
  
  localStorage.setItem('mangaPdfMakerData', JSON.stringify(data));
}

// Load saved data from localStorage
function loadSavedData() {
  const savedData = localStorage.getItem('mangaPdfMakerData');
  
  if (!savedData) {
    return;
  }
  
  try {
    const data = JSON.parse(savedData);
    
    // Restore Base URL
    if (data.baseUrl) {
      baseUrlInput.value = data.baseUrl;
    }
    
    // Restore Image URL Filter
    if (data.imageUrlFilter) {
      imageUrlFilterInput.value = data.imageUrlFilter;
    }
    
    // Restore Manga Title
    if (data.mangaTitle) {
      mangaTitleInput.value = data.mangaTitle;
    }
    
    // Restore URL's chapter and chapter URLs
    if (data.urlsChapter) {
      urlsChapterTextarea.value = data.urlsChapter;
      
      // Use saved chapterUrls if available, otherwise parse from HTML
      if (data.chapterUrls && Array.isArray(data.chapterUrls)) {
        chapterUrls = data.chapterUrls;
      } else {
        parseChapterUrls();
      }
    }
    
    // Restore chapter image counts
    if (data.chapterImageCounts) {
      chapterImageCounts = data.chapterImageCounts;
    }
    
    // Restore GroupBy
    if (data.groupBy !== undefined) {
      currentGroupBy = data.groupBy;
    }

    // Restore NumParts
    if (data.numParts !== undefined && data.numParts !== null) {
      numParts = data.numParts;
      numPartsInput.value = numParts;
      // Deactivate all groupBy buttons when numParts is set
      groupByButtons.forEach(btn => btn.classList.remove('active'));
    } else {
      // Update active button
      groupByButtons.forEach(btn => {
        const btnValue = btn.dataset.value === 'all' ? 'all' : parseInt(btn.dataset.value);
        if (btnValue === currentGroupBy) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
    }

    // Restore part statuses
    if (data.partStatuses && Array.isArray(data.partStatuses)) {
      partStatuses = data.partStatuses;
      if (partStatuses.some(s => s === 'Completed')) {
        hasEverDownloaded = true;
      }
    }
    
    // Update the chapters list display
    updateChaptersList();
    
  } catch (error) {
    console.error('Error loading saved data:', error);
  }
}
