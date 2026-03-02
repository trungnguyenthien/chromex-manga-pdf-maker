// Content script - Inject modal with iframe into current page
(function() {
  'use strict';
  
  // Check if modal already exists
  if (document.getElementById('manga-pdf-maker-modal')) {
    // If exists, toggle visibility
    const existingModal = document.getElementById('manga-pdf-maker-modal');
    existingModal.style.display = existingModal.style.display === 'none' ? 'flex' : 'none';
    return;
  }
  
  // Create modal overlay
  const modal = document.createElement('div');
  modal.id = 'manga-pdf-maker-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.8);
    z-index: 999999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    box-sizing: border-box;
  `;
  
  // Create iframe container
  const iframeContainer = document.createElement('div');
  iframeContainer.style.cssText = `
    position: relative;
    width: 100%;
    max-width: 1400px;
    height: 90vh;
    background: white;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  `;
  
  // Create close button
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '&times;';
  closeBtn.style.cssText = `
    position: absolute;
    right: 10px;
    top: 10px;
    z-index: 10;
    font-size: 32px;
    font-weight: bold;
    color: #666;
    background: white;
    border: none;
    cursor: pointer;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  `;
  closeBtn.onmouseover = () => closeBtn.style.background = '#f0f0f0';
  closeBtn.onmouseout = () => closeBtn.style.background = 'white';
  closeBtn.onclick = () => modal.style.display = 'none';
  
  // Create iframe
  const iframe = document.createElement('iframe');
  iframe.src = chrome.runtime.getURL('index.html');
  iframe.style.cssText = `
    width: 100%;
    height: 100%;
    border: none;
  `;
  
  // Send page info to iframe once it's loaded
  iframe.onload = () => {
    iframe.contentWindow.postMessage({
      action: 'pageInfo',
      title: document.title,
      url: window.location.href,
      origin: window.location.origin
    }, '*');
  };
  
  // Assemble
  iframeContainer.appendChild(closeBtn);
  iframeContainer.appendChild(iframe);
  modal.appendChild(iframeContainer);
  document.body.appendChild(modal);
  
  // Listen for messages from iframe to query current page DOM
  window.addEventListener('message', (event) => {
    // Only accept messages from our iframe
    if (event.source !== iframe.contentWindow) return;
    
    if (event.data.action === 'queryChapterLinks') {
      try {
        const selector = event.data.selector;
        const baseUrl = event.data.baseUrl || window.location.origin;
        
        // Query DOM for matching <a> tags
        const anchors = document.querySelectorAll(selector);
        const urls = [];
        
        anchors.forEach(anchor => {
          let href = anchor.getAttribute('href');
          if (href) {
            // Convert relative URLs to absolute
            if (href.startsWith('/')) {
              href = baseUrl.replace(/\/$/, '') + href;
            } else if (!href.startsWith('http')) {
              href = baseUrl.replace(/\/$/, '') + '/' + href;
            }
            urls.push(href);
          }
        });
        
        // Send results back to iframe
        iframe.contentWindow.postMessage({
          action: 'queryChapterLinksResult',
          urls: urls,
          selector: selector
        }, '*');
        
      } catch (error) {
        iframe.contentWindow.postMessage({
          action: 'queryChapterLinksResult',
          error: error.message,
          selector: event.data.selector
        }, '*');
      }
    }
  });
  
  // Close on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  });
})();

