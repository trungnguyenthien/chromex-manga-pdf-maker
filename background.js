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
