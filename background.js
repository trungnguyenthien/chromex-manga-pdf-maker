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
      
      // Create new tab in the same window (active: false = background tab, doesn't steal focus)
      console.log(`[${ts()} →] Opening tab: ${chapterUrl}`);
      chrome.tabs.create({ url: chapterUrl, active: false, windowId: chrome.windows.WINDOW_ID_CURRENT }, async (tab) => {
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
        console.log(`[${ts()}] Tab load complete (+${loadTime}ms) — extracting images (max 2s)...`);

        // Inject async script: poll images for up to 2s, then extract
        const extractStart = Date.now();

        const results = await chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: (filterParam) => {
            const MAX_WAIT = 2000;  // 2 seconds max
            const CHECK_INTERVAL = 100; // poll every 100ms

            const currentUrl = window.location.href;
            const baseUrl = new URL(currentUrl);

            // Helper: check if a src value is "loaded" (non-empty, not placeholder)
            const isLoaded = (src) => {
              if (!src || typeof src !== 'string' || src.trim() === '') return false;
              // Skip obvious placeholder/loading patterns
              const lower = src.toLowerCase();
              if (lower.includes('loading') || lower.includes('placeholder') ||
                  lower.includes('blank') || lower.endsWith('/blank') ||
                  lower.endsWith('.gif') && lower.includes('1x1')) return false;
              return true;
            };

            // Helper: resolve relative URL
            const resolveUrl = (src) => {
              if (src.startsWith('//')) return baseUrl.protocol + src;
              if (src.startsWith('/')) return baseUrl.origin + src;
              if (!src.startsWith('http')) {
                try { return new URL(src, currentUrl).href; } catch (e) {}
              }
              return src;
            };

            // Determine which containers/images to track
            let targetImages = null;

            if (filterParam && filterParam.trim()) {
              const trimmedFilter = filterParam.trim();
              const hasClassOrIdOrAttr = trimmedFilter.includes('.') ||
                                        trimmedFilter.includes('#') ||
                                        trimmedFilter.includes('[');
              const hasUrlPattern = /http|cdn|\.(jpg|png|webp|gif)/i.test(trimmedFilter);
              const looksLikeSelector = hasClassOrIdOrAttr && !hasUrlPattern;

              if (looksLikeSelector) {
                try {
                  const containers = document.querySelectorAll(trimmedFilter);
                  if (containers.length > 0) {
                    targetImages = [];
                    containers.forEach(c => {
                      targetImages.push(...Array.from(c.querySelectorAll('img')));
                    });
                  }
                } catch (e) {}
              }
            }

            if (!targetImages) {
              targetImages = Array.from(document.querySelectorAll('img'));
            }

            return new Promise((resolve) => {
              const startTime = Date.now();

              const tryExtract = () => {
                const elapsed = Date.now() - startTime;

                if (elapsed >= MAX_WAIT) {
                  // Timeout — extract whatever we have now
                  const imageUrls = targetImages.map(img => {
                    const src = img.getAttribute('src') ||
                                img.getAttribute('data-src') ||
                                img.getAttribute('data-original') ||
                                img.getAttribute('data-lazy-src');
                    return isLoaded(src) ? resolveUrl(src) : null;
                  }).filter(Boolean);

                  console.log(`[TabExtract] Timeout after ${elapsed}ms, found ${imageUrls.length} images`);
                  resolve({ urls: imageUrls, pageUrl: currentUrl, timedOut: true });
                  return;
                }

                // Check if all images have loaded src
                const allLoaded = targetImages.every(img => {
                  const src = img.getAttribute('src') ||
                              img.getAttribute('data-src') ||
                              img.getAttribute('data-original') ||
                              img.getAttribute('data-lazy-src');
                  return isLoaded(src);
                });

                if (allLoaded && targetImages.length > 0) {
                  const elapsed = Date.now() - startTime;
                  const imageUrls = targetImages.map(img => {
                    const src = img.getAttribute('src') ||
                                img.getAttribute('data-src') ||
                                img.getAttribute('data-original') ||
                                img.getAttribute('data-lazy-src');
                    return resolveUrl(src);
                  }).filter(Boolean);

                  console.log(`[TabExtract] All ${imageUrls.length} images loaded in ${elapsed}ms`);
                  resolve({ urls: imageUrls, pageUrl: currentUrl, timedOut: false });
                  return;
                }

                // Not ready yet — check again soon
                setTimeout(tryExtract, CHECK_INTERVAL);
              };

              tryExtract();
            });
          },
          args: [filter]
        });

        const extractTime = Date.now() - extractStart;
        const totalTime = Date.now() - tabOpenTime;

        const imageData = results[0].result;
        const timeoutNote = imageData.timedOut ? ' (forced after 2s)' : '';
        console.log(`[${ts()}] Extracted ${imageData.urls.length} images (+${extractTime}ms)${timeoutNote} — closing tab (id=${tabId})...`);

        // Close the tab
        chrome.tabs.remove(tabId);

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
});
