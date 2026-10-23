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
  
  // Store original title and state for tab title indicator
  let originalDocumentTitle = document.title;
  let currentDownloadState = {
    isDownloading: false,
    hasStopped: false,
    hasCompletedParts: false,
    hasEverDownloaded: false,
    mangaTitle: ''
  };

  let originalFaviconHref = null;
  let currentFaviconType = 'default';

  function cleanTitle(title) {
    if (!title || typeof title !== 'string') return '';
    return title.replace(/^([🟣🟪💜🔮✅⏳⬇️✓✔]|\u2705|\u23f3|\u{1f7e3}|\u{1f7ea}|\u{1f49c})\s*/iu, '').trim();
  }

  // Dynamically update tab favicon to a stylish purple indicator
  function updateTabFavicon(type) {
    if (currentFaviconType === type) return;
    currentFaviconType = type;

    try {
      let link = document.querySelector("link[rel*='icon']");
      if (!originalFaviconHref) {
        originalFaviconHref = link ? link.href : '';
      }

      if (type === 'default') {
        if (originalFaviconHref && link) {
          link.href = originalFaviconHref;
        }
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (type === 'stopped') {
        // Purple gradient circular badge
        const grad = ctx.createLinearGradient(0, 0, 32, 32);
        grad.addColorStop(0, '#8b5cf6'); // vibrant violet
        grad.addColorStop(1, '#6d28d9'); // deep purple

        ctx.beginPath();
        ctx.arc(16, 16, 14.5, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        // Subtle outer glow ring
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#c4b5fd';
        ctx.stroke();

        // Modern crisp white checkmark
        ctx.beginPath();
        ctx.moveTo(9, 16);
        ctx.lineTo(14, 21);
        ctx.lineTo(23, 11);
        ctx.lineWidth = 3.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      } else if (type === 'downloading') {
        // Purple downloading ring indicator
        const grad = ctx.createLinearGradient(0, 0, 32, 32);
        grad.addColorStop(0, '#a855f7');
        grad.addColorStop(1, '#7c3aed');

        ctx.beginPath();
        ctx.arc(16, 16, 14.5, 0, Math.PI * 2);
        ctx.fillStyle = '#f5f3ff';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(16, 16, 14.5, 0, Math.PI * 2);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = grad;
        ctx.stroke();

        // Down arrow in purple
        ctx.beginPath();
        ctx.moveTo(16, 8.5);
        ctx.lineTo(16, 18.5);
        ctx.moveTo(11, 14);
        ctx.lineTo(16, 19);
        ctx.lineTo(21, 14);
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#7c3aed';
        ctx.stroke();
      }

      const dataUrl = canvas.toDataURL('image/png');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = dataUrl;
    } catch (e) {
      console.warn('[Favicon] Could not update favicon:', e);
    }
  }

  function syncTabTitle() {
    const currentClean = cleanTitle(document.title);
    const baseTitle = currentClean || cleanTitle(originalDocumentTitle) || currentDownloadState.mangaTitle || window.location.hostname;
    
    if (currentDownloadState.isDownloading) {
      const newTitle = `⏳ ${baseTitle}`;
      if (document.title !== newTitle) {
        document.title = newTitle;
      }
      updateTabFavicon('downloading');
    } else if (currentDownloadState.hasStopped) {
      const newTitle = `🟣 ${baseTitle}`;
      if (document.title !== newTitle) {
        document.title = newTitle;
      }
      updateTabFavicon('stopped');
    } else {
      // Idle state: restore base title if it had status icons
      if (document.title.startsWith('🟣 ') || document.title.startsWith('✅ ') || document.title.startsWith('⏳ ')) {
        const newTitle = baseTitle;
        if (document.title !== newTitle) {
          document.title = newTitle;
        }
      }
      updateTabFavicon('default');
    }
  }

  // Periodic 4-second check: check download status and maintain icon 🟣 on tab title
  setInterval(() => {
    if (iframe && iframe.contentWindow) {
      try {
        iframe.contentWindow.postMessage({ action: 'checkDownloadStatus' }, '*');
      } catch (e) {}
    }
    syncTabTitle();
  }, 4000);

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
  
  // Listen for messages from iframe to query current page DOM and track download status
  window.addEventListener('message', (event) => {
    // Only accept messages from our iframe
    if (event.source !== iframe.contentWindow) return;
    
    if (event.data.action === 'tabDownloadStatus') {
      currentDownloadState.isDownloading = !!event.data.isDownloading;
      currentDownloadState.hasCompletedParts = !!event.data.hasCompletedParts;
      currentDownloadState.hasEverDownloaded = !!event.data.hasEverDownloaded;
      currentDownloadState.hasStopped = !!event.data.hasStopped;
      if (event.data.mangaTitle) {
        currentDownloadState.mangaTitle = event.data.mangaTitle;
      }
      syncTabTitle();
      return;
    }

    if (event.data.action === 'queryChapterLinks') {
      try {
        const selector = event.data.selector;
        const baseUrl = event.data.baseUrl || window.location.origin;
        
        // Query DOM with selector
        const elements = document.querySelectorAll(selector);
        const urls = [];
        
        elements.forEach(element => {
          // Check if element is an <a> tag
          if (element.tagName === 'A') {
            // Direct <a> tag, get its href
            let href = element.getAttribute('href');
            if (href) {
              // Convert relative URLs to absolute
              if (href.startsWith('//')) {
                // Protocol-relative URL
                href = 'https:' + href;
              } else if (href.startsWith('/')) {
                // Relative path
                href = baseUrl.replace(/\/$/, '') + href;
              } else if (!href.startsWith('http')) {
                href = baseUrl.replace(/\/$/, '') + '/' + href;
              }
              urls.push(href);
            }
          } else {
            // Container element, find all <a> tags inside
            const anchorsInside = element.querySelectorAll('a');
            anchorsInside.forEach(anchor => {
              let href = anchor.getAttribute('href');
              if (href) {
                // Convert relative URLs to absolute
                if (href.startsWith('//')) {
                  // Protocol-relative URL
                  href = 'https:' + href;
                } else if (href.startsWith('/')) {
                  // Relative path
                  href = baseUrl.replace(/\/$/, '') + href;
                } else if (!href.startsWith('http')) {
                  href = baseUrl.replace(/\/$/, '') + '/' + href;
                }
                urls.push(href);
              }
            });
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

