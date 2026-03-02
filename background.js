// Background service worker for Chrome Extension v3
// Injects content script into current tab when extension icon is clicked

// Store current referer for dynamic header modification
let currentReferer = 'https://nettruyenviet1.com/';

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
    // Update global referer
    currentReferer = request.referer || 'https://nettruyenviet1.com/';
    sendResponse({ success: true });
    return true;
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
    // Fetch image as blob (bypasses CORS, Referer set by declarativeNetRequest)
    fetch(request.url)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.blob();
      })
      .then(blob => {
        // Validate that we got an image
        if (!blob.type.startsWith('image/')) {
          throw new Error(`Expected image but got ${blob.type}`);
        }
        
        // Convert blob to base64
        const reader = new FileReader();
        reader.onloadend = () => {
          sendResponse({ success: true, dataUrl: reader.result });
        };
        reader.readAsDataURL(blob);
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    
    // Return true to indicate we'll send response asynchronously
    return true;
  }
});
