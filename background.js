// Background service worker for Chrome Extension v3
// Handles extension icon click event

chrome.action.onClicked.addListener((tab) => {
  // Open the index page in a new tab
  chrome.tabs.create({
    url: chrome.runtime.getURL('index.html')
  });
});
