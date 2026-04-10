// DOM Elements
const baseUrlInput = document.getElementById('baseUrl');
const imageUrlFilterInput = document.getElementById('imageUrlFilter');
const urlsChapterTextarea = document.getElementById('urlsChapter');
const mangaTitleInput = document.getElementById('mangaTitle');
const chaptersList = document.getElementById('chaptersList');
const groupByButtons = document.querySelectorAll('.groupby-btn');
const revertListBtn = document.getElementById('revertListBtn');
const numPartsInput = document.getElementById('numParts');

// State
let currentGroupBy = 2;
let numParts = null; // null means "use currentGroupBy", number means "divide evenly"
let chapterUrls = [];
let chapterImageCounts = {}; // Store image count for each chapter URL
let hasReceivedPageInfo = false; // Flag to track first pageInfo
let hasAutoReversed = false; // Flag to track if list was auto-reversed once
let currentPageUrl = ''; // Store current page URL
let partStatuses = []; // Track status per part: 'idle' | 'GettingChap' | 'GettingImages' | 'Completed'

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadSavedData();
  setupEventListeners();
  
  // Listen for messages from content script
  window.addEventListener('message', (event) => {
    // Handle page info from content script
    if (event.data.action === 'pageInfo') {
      console.log('Received page info:', event.data);
      
      // Save current page URL
      currentPageUrl = event.data.url;
      
      // Auto-fill Base URL if not already set
      if (!baseUrlInput.value.trim() || baseUrlInput.value === 'https://comics.vn/') {
        baseUrlInput.value = event.data.origin;
      }
      
      // Auto-fill Manga Title from page title - always update on first pageInfo
      if (!hasReceivedPageInfo) {
        hasReceivedPageInfo = true;
        // Clean up the title (remove common suffixes like " - Read Online", etc.)
        let cleanTitle = event.data.title
          .replace(/\s*[-|]\s*(Read Online|Manga|Chapter|Latest).*$/i, '')
          .trim();
        mangaTitleInput.value = cleanTitle;
        saveData();
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
      saveData();
      updateChaptersList();
    });
  });

  // URL's chapter textarea
  urlsChapterTextarea.addEventListener('input', () => {
    parseChapterUrls();
  });

  // Base URL input
  baseUrlInput.addEventListener('input', () => {
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
    updateChaptersList();
    saveData();
  });

  // NumParts input
  numPartsInput.addEventListener('input', () => {
    const val = parseInt(numPartsInput.value.trim());
    numParts = (isNaN(val) || val < 1) ? null : val;
    saveData();
    updateChaptersList();
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

  const partsInfo = parts.map((p, i) => {
    const isLast = i === parts.length - 1;
    const label = isLast ? ' (last)' : '';
    return `Part ${i + 1}: ${p.length} chap${label}`;
  }).join(' &nbsp;|&nbsp; ');

  let html = `<div class="parts-summary-box">
    <div class="summary-row">
      <span class="summary-label">Total:</span>
      <span class="summary-value">${total} chapters &nbsp;|&nbsp; ${parts.length} parts</span>
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
    return `
      <div class="chapter-part" id="part-${partIndex}">
        <div class="chapter-part-header">
          <span class="part-status-badge status-${status}" id="part-status-${partIndex}">${status}</span>
          <button class="make-part-btn" data-part="${partIndex}">Make Part ${partIndex + 1} — ${chapCountLabel}</button>
          <div class="part-progress" style="display: none;">
            <div class="progress-bar-inline">
              <div class="progress-fill-inline"></div>
            </div>
            <div class="progress-text-inline">Initializing...</div>
          </div>
        </div>
        <div class="chapter-urls">
          ${part.map((url) => {
            const currentIndex = globalIndex++;
            const imageCount = chapterImageCounts[url];
            const imageCountText = imageCount !== undefined ? ` <span class="image-count">(${imageCount} images)</span>` : '';
            return `
              <div class="chapter-url-item">
                <button class="remove-chapter-btn" data-index="${currentIndex}" title="Remove this chapter">&times;</button>
                <div class="chapter-url">${url}${imageCountText}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');

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

// Make PDF from a part
async function makePart(urls, partNumber, partIndex, baseUrl = '', totalParts = 1) {
  console.log(`Making Part ${partNumber}:`, urls);
  
  const filter = imageUrlFilterInput.value.trim();
  
  // Show progress UI for this specific part
  showPartProgress(partIndex, true);
  setPartStatus(partIndex, 'GettingChap');

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
    for (let i = 0; i < urls.length; i++) {
      const chapterUrl = urls[i];
      updatePartProgress(
        partIndex,
        ((i / totalChapters) * 5),
        `Fetching chapter ${i + 1}/${totalChapters}...`
      );
      
      const imageUrls = await fetchAndExtractImages(chapterUrl, filter);
      
      // Store image count for this chapter
      chapterImageCounts[chapterUrl] = imageUrls.length;
      
      // Log image URLs for this chapter
      console.log(`\n=== Chapter ${i + 1}/${totalChapters} ===`);
      console.log(`URL: ${chapterUrl}`);
      console.log(`Found ${imageUrls.length} images:`);
      imageUrls.forEach((url, idx) => {
        console.log(`  [${idx + 1}] ${url}`);
      });
      console.log(`==================\n`);
      
      allImages.push(...imageUrls);

      // Add 1 second delay between chapter requests (except for the last one)
      if (i < urls.length - 1) {
        await delay(1000); // 1 second
      }
    }

    if (allImages.length === 0) {
      updatePartProgress(partIndex, 0, 'No images found!');
      setTimeout(() => showPartProgress(partIndex, false), 2000);
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
    const removedCount = originalCount - deduplicatedImages.length;

    if (removedCount > 0) {
      console.log(`[AdFilter] Removed ${removedCount} duplicate/ad images (${originalCount} → ${deduplicatedImages.length})`);
    }

    updatePartProgress(partIndex, 5, `Found ${deduplicatedImages.length} images${removedCount > 0 ? ` (${removedCount} duplicates removed)` : ''}. Processing...`);
    setPartStatus(partIndex, 'GettingImages');

    // Step 2: Download and resize images (5-97%, 92% total)
    const processedImages = [];
    for (let i = 0; i < deduplicatedImages.length; i++) {
      updatePartProgress(
        partIndex,
        5 + ((i / deduplicatedImages.length) * 92),
        `Download image ${i + 1}/${deduplicatedImages.length}...`
      );
      
      try {
        const imgData = await downloadAndResizeImage(deduplicatedImages[i]);
        if (imgData) {
          processedImages.push(imgData);
        }
      } catch (error) {
        console.error(`Failed to process image ${deduplicatedImages[i]}:`, error);
      }
    }
    
    if (processedImages.length === 0) {
      updatePartProgress(partIndex, 0, 'Failed to process images!');
      setTimeout(() => showPartProgress(partIndex, false), 2000);
      return;
    }
    
    // Step 3: Generate PDF (97-100%, 3% total)
    updatePartProgress(partIndex, 97, 'Creating PDF...');
    await generatePDF(processedImages, partNumber, totalParts);

    updatePartProgress(partIndex, 100, 'Done!');
    setPartStatus(partIndex, 'Completed');
    showPartProgress(partIndex, false);
    updateChaptersList(); // Update to show image counts
    saveData();           // Save the image counts

  } catch (error) {
    console.error('Error creating PDF:', error);
    updatePartProgress(partIndex, 0, `Error: ${error.message}`);
    setPartStatus(partIndex, 'idle');
    setTimeout(() => showPartProgress(partIndex, false), 3000);
  }
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
    
    // Apply filter if provided
    if (filter && filter.trim()) {
      const trimmedFilter = filter.trim();
      const hasClassOrIdOrAttr = trimmedFilter.includes('.') || 
                                  trimmedFilter.includes('#') || 
                                  trimmedFilter.includes('[');
      const hasUrlPattern = trimmedFilter.includes('http') || 
                           trimmedFilter.includes('cdn') ||
                           trimmedFilter.includes('.jpg') ||
                           trimmedFilter.includes('.png') ||
                           trimmedFilter.includes('.webp') ||
                           trimmedFilter.includes('.gif');
      
      // If filter looks like a CSS selector, we already handled it server-side
      // If it's a text filter, apply it here
      const looksLikeSelector = hasClassOrIdOrAttr && !hasUrlPattern;
      
      if (!looksLikeSelector) {
        // Apply text filter
        imageUrls = imageUrls.filter(url => url.includes(trimmedFilter));
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
    // Use background script to fetch image (bypasses CORS, Referer set by declarativeNetRequest)
    const response = await chrome.runtime.sendMessage({
      action: 'fetchImage',
      url: url
    });
    
    if (!response.success) {
      throw new Error(response.error);
    }
    
    // Validate data URL
    if (!response.dataUrl || !response.dataUrl.startsWith('data:')) {
      throw new Error(`Invalid data URL received for ${url}`);
    }
    
    // Create image from base64 data URL
    return new Promise((resolve, reject) => {
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
            data: imageData,
            width: newWidth,
            height: newHeight,
            isLandscape: isLandscape
          });
        } catch (error) {
          reject(error);
        }
      };
      
      img.onerror = (e) => {
        console.error('Image load error:', url, 'Data URL prefix:', response.dataUrl.substring(0, 100));
        reject(new Error(`Failed to load image: ${url}`));
      };
      
      img.src = response.dataUrl;
    });
  } catch (error) {
    throw new Error(`Failed to fetch image ${url}: ${error.message}`);
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

  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  setTimeout(() => {
    URL.revokeObjectURL(blobUrl);
    console.log(`[Download] ✓ Download triggered: ${filename}`);
  }, 3000);
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
  const badge = document.getElementById(`part-status-${partIndex}`);
  if (badge) {
    badge.className = `part-status-badge status-${status}`;
    badge.textContent = status;
  }
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
    chapterImageCounts: chapterImageCounts
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
    
    // Update the chapters list display
    updateChaptersList();
    
  } catch (error) {
    console.error('Error loading saved data:', error);
  }
}
