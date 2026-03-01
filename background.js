// Background service worker for Chrome Extension v3
// Handles extension icon click event and CORS bypass for fetching chapters

chrome.action.onClicked.addListener((tab) => {
  // Open the index page in a new tab
  chrome.tabs.create({
    url: chrome.runtime.getURL('index.html')
  });
});

// Handle messages from the extension page
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
    // Fetch image as blob (bypasses CORS)
    fetch(request.url)
      .then(response => response.blob())
      .then(blob => {
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
