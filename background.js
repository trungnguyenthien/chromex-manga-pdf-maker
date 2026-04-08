// Helper: timestamp string like [HH:MM:SS.mmm]
function ts() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}.${String(d.getMilliseconds()).padStart(3,'0')}`;
}

// Background service worker for Chrome Extension v3
// Injects content script into current tab when extension icon is clicked

// Store current referer for dynamic header modification
let currentReferer = '';

// Log enabled rulesets on startup
chrome.declarativeNetRequest.getEnabledRulesets().then(rulesets => {
  console.log('✓ Enabled Rulesets:', rulesets);
  
  // Also get static rules
  chrome.declarativeNetRequest.getDynamicRules().then(dynamicRules => {
    console.log('✓ Dynamic Rules:', dynamicRules);
  });
  
  chrome.declarativeNetRequest.getSessionRules().then(sessionRules => {
    console.log('✓ Session Rules:', sessionRules);
  });
});

chrome.action.onClicked.addListener((tab) => {
  // Inject content script to show modal in current page
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content.js']
  });
});

// Handle messages from the extension iframe for CORS bypass
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'setReferer') {
    // Update global referer and update session rule
    currentReferer = request.referer;
    
    if (!currentReferer) {
      console.warn('Warning: No referer provided, skipping rule update');
      sendResponse({ success: false, error: 'Base URL is required' });
      return true;
    }
    
    console.log('=== Setting Referer Header ===');
    console.log('New Referer:', currentReferer);
    
    // Update session rules to set Referer header for all image requests
    chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [1], // Remove old rule if exists
      addRules: [{
        id: 1,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Referer', operation: 'set', value: currentReferer }
          ]
        },
        condition: {
          urlFilter: '*://*/*',  // Apply to all URLs
          resourceTypes: ['xmlhttprequest']
        }
      }]
    }).then(() => {
      console.log('✓ Referer header rule updated successfully');
      console.log('==============================\n');
      sendResponse({ success: true });
    }).catch(error => {
      console.error('✗ Failed to update Referer rule:', error);
      sendResponse({ success: false, error: error.message });
    });
    
    return true; // Keep channel open for async response
  }
  
  if (request.action === 'fetchHtml') {
    // Fetch HTML content from the given URL (bypasses CORS)
    fetch(request.url)
      .then(response => response.text())
      .then(html => {
        sendResponse({ success: true, html: html });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    
    // Return true to indicate we'll send response asynchronously
    return true;
  }
  
  if (request.action === 'fetchChapterImages') {
    // Open chapter in new tab, wait for JS to load, then extract images
    const chapterUrl = request.url;
    const filter = request.filter || '';
    
    console.log('=== Fetch Chapter Images (Real Tab) ===');
    console.log('URL:', chapterUrl);
    console.log('Filter:', filter);
    
    // Use async IIFE to clear cookies before creating tab
    (async () => {
      // Clear common session cookies for this domain before loading
      try {
        const url = new URL(chapterUrl);
        const domain = url.hostname;
        
        // List of common session cookie names
        const sessionCookieNames = [
          'session_id',
          'sessionid', 
          'PHPSESSID',
          'JSESSIONID',
          'connect.sid',
          'ASP.NET_SessionId',
          'sid',
          'sess',
          '_session'
        ];
        
        console.log('Clearing session cookies for domain:', domain);
        let clearedCount = 0;
        
        for (const cookieName of sessionCookieNames) {
          const cookie = await chrome.cookies.get({
            url: chapterUrl,
            name: cookieName
          });
          
          if (cookie) {
            await chrome.cookies.remove({
              url: chapterUrl,
              name: cookieName
            });
            console.log(`  ✓ Cleared: ${cookieName}`);
            clearedCount++;
          }
        }
        
        if (clearedCount > 0) {
          console.log(`✓ Total ${clearedCount} session cookie(s) cleared`);
        } else {
          console.log('No session cookies found');
        }
      } catch (error) {
        console.warn('Failed to clear session cookies:', error.message);
      }
      
      // Create new tab
      console.log(`[${ts()} →] Opening tab: ${chapterUrl}`);
      chrome.tabs.create({ url: chapterUrl, active: false }, async (tab) => {
      try {
        const tabId = tab.id;
        const tabOpenTime = Date.now();

        console.log(`[${ts()}] Tab created (id=${tabId}), waiting for load...`);

        // Wait for tab to finish loading
        await new Promise((resolve) => {
          const listener = (changedTabId, changeInfo) => {
            if (changedTabId === tabId && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
        });

        const loadTime = Date.now() - tabOpenTime;
        console.log(`[${ts()}] Tab load complete (+${loadTime}ms) — waiting JS/lazy-load delay...`);

        // Wait additional time for JavaScript to execute and images to lazy-load
        const LOAD_DELAY = 200; // 200ms
        const delayStart = Date.now();
        await new Promise(resolve => setTimeout(resolve, LOAD_DELAY));
        console.log(`[${ts()}] JS delay done (+${Date.now() - delayStart}ms) — extracting images...`);

        const extractStart = Date.now();

        // Inject script to extract image URLs
        const results = await chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: (filterParam) => {
            const currentUrl = window.location.href;
            const baseUrl = new URL(currentUrl);

            // Check if filter is a CSS selector
            let imagesToProcess;
            let isFilterSelector = false;

            if (filterParam && filterParam.trim()) {
              const trimmedFilter = filterParam.trim();
              const hasClassOrIdOrAttr = trimmedFilter.includes('.') ||
                                        trimmedFilter.includes('#') ||
                                        trimmedFilter.includes('[');
              const hasUrlPattern = trimmedFilter.includes('http') ||
                                   trimmedFilter.includes('cdn') ||
                                   trimmedFilter.includes('.jpg') ||
                                   trimmedFilter.includes('.png') ||
                                   trimmedFilter.includes('.webp') ||
                                   trimmedFilter.includes('.gif');

              const looksLikeSelector = hasClassOrIdOrAttr && !hasUrlPattern;

              if (looksLikeSelector) {
                // Try to use filter as CSS selector
                try {
                  const containers = document.querySelectorAll(trimmedFilter);
                  if (containers.length > 0) {
                    isFilterSelector = true;
                    const allImagesInContainers = [];
                    containers.forEach(container => {
                      const imgsInContainer = container.querySelectorAll('img');
                      allImagesInContainers.push(...imgsInContainer);
                    });
                    imagesToProcess = allImagesInContainers;
                  }
                } catch (e) {
                  // Invalid selector, fall back to all images
                  console.warn('Invalid CSS selector, using all images');
                }
              }
            }

            // If no selector or selector didn't work, get all images
            if (!imagesToProcess) {
              imagesToProcess = document.querySelectorAll('img');
            }

            const imageUrls = [];

            imagesToProcess.forEach(img => {
              let src = img.getAttribute('src') ||
                       img.getAttribute('data-src') ||
                       img.getAttribute('data-original') ||
                       img.getAttribute('data-lazy-src') ||
                       img.currentSrc;

              if (src) {
                // Convert relative URLs to absolute
                if (src.startsWith('//')) {
                  src = baseUrl.protocol + src;
                } else if (src.startsWith('/')) {
                  src = baseUrl.origin + src;
                } else if (!src.startsWith('http')) {
                  try {
                    src = new URL(src, currentUrl).href;
                  } catch (e) {
                    console.warn('Failed to parse URL:', src);
                  }
                }

                imageUrls.push(src);
              }
            });

            return { urls: imageUrls, pageUrl: currentUrl };
          },
          args: [filter]
        });

        const extractTime = Date.now() - extractStart;
        const totalTime = Date.now() - tabOpenTime;

        console.log(`[${ts()}] Images extracted (+${extractTime}ms) — closing tab (id=${tabId})...`);

        // Close the tab
        chrome.tabs.remove(tabId);

        const imageData = results[0].result;
        console.log(`[${ts()}] ✓ Tab closed. Total chapter time: +${totalTime}ms | ${imageData.urls.length} images`);
        console.log('===================================\n');

        sendResponse({
          success: true,
          imageUrls: imageData.urls,
          pageUrl: imageData.pageUrl
        });

      } catch (error) {
        console.error('✗ Error extracting images:', error);
        // Try to close tab if it exists
        if (tab && tab.id) {
          chrome.tabs.remove(tab.id).catch(() => {});
        }
        sendResponse({ success: false, error: error.message });
      }
    });
    })(); // Close async IIFE
    
    return true; // Keep channel open for async response
  }
  
  if (request.action === 'fetchImage') {
    // Log request details
    console.log('=== Image Fetch Request ===');
    console.log('URL:', request.url);
    console.log('Current Referer (set globally):', currentReferer);
    console.log('Timestamp:', new Date().toISOString());
    
    // Log active declarativeNetRequest rules
    chrome.declarativeNetRequest.getSessionRules().then(rules => {
      console.log('Active Session Rules:', rules.length);
      rules.forEach(rule => {
        console.log('  Rule ID:', rule.id, '| Condition:', rule.condition);
      });
    });
    
    // Fetch image as blob (bypasses CORS, Referer set by declarativeNetRequest)
    fetch(request.url)
      .then(response => {
        // Log response details
        console.log('=== Image Fetch Response ===');
        console.log('URL:', request.url);
        console.log('Status:', response.status, response.statusText);
        console.log('Content-Type:', response.headers.get('content-type'));
        console.log('Content-Length:', response.headers.get('content-length'));
        
        // Log all response headers
        const headers = {};
        response.headers.forEach((value, key) => {
          headers[key] = value;
        });
        console.log('Response Headers:', headers);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.blob();
      })
      .then(blob => {
        console.log('Blob Type:', blob.type);
        console.log('Blob Size:', blob.size, 'bytes');
        
        // Validate that we got an image
        if (!blob.type.startsWith('image/')) {
          console.error('ERROR: Expected image but got', blob.type);
          throw new Error(`Expected image but got ${blob.type}`);
        }
        
        console.log('✓ Image fetch successful');
        console.log('===========================\n');
        
        // Convert blob to base64
        const reader = new FileReader();
        reader.onloadend = () => {
          sendResponse({ success: true, dataUrl: reader.result });
        };
        reader.readAsDataURL(blob);
      })
      .catch(error => {
        console.error('=== Image Fetch ERROR ===');
        console.error('URL:', request.url);
        console.error('Error:', error.message);
        console.error('===========================\n');
        sendResponse({ success: false, error: error.message });
      });
    
    // Return true to indicate we'll send response asynchronously
    return true;
  }

  // downloadPdf: create offscreen doc, forward blob URL so it can fetch + chrome.downloads.download
  if (request.action === 'downloadPdf') {
    const { blobUrl, filename } = request;
    console.log(`[Download] Requesting offscreen for: ${filename}`);

    // Ensure offscreen document exists (Chrome 116+)
    chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOWNLOADS'],
      justification: 'Download PDF to subfolder in Downloads/'
    }).then(() => {
      // Forward blob URL (tiny message, ~200 bytes) to offscreen
      chrome.runtime.sendMessage({
        target: 'offscreen',
        action: 'downloadPdf',
        blobUrl: blobUrl,
        filename: filename
      }, (response) => {
        sendResponse(response || { success: false, error: chrome.runtime.lastError?.message });
      });
    }).catch((err) => {
      console.error('[Download] Offscreen createDocument failed:', err.message);
      sendResponse({ success: false, error: err.message });
    });

    return true;
  }
});
