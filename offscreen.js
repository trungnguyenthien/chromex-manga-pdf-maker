// Offscreen document — handles downloads with full DOM APIs (chrome.downloads available)

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== 'downloadPdf') return;

  const { dataUrl, filename } = message;

  console.log(`[Offscreen] Received PDF (${(dataUrl.length / 1024 / 1024).toFixed(2)}MB), downloading...`);

  // Convert data URL to Blob and use createObjectURL (available in this context)
  fetch(dataUrl)
    .then((res) => res.blob())
    .then((blob) => {
      const blobUrl = URL.createObjectURL(blob);

      chrome.downloads.download({
        url: blobUrl,
        filename: filename,
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error('[Offscreen] Download error:', chrome.runtime.lastError.message);
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          console.log(`[Offscreen] ✓ Saved: ${filename} (id=${downloadId})`);
          sendResponse({ success: true, downloadId: downloadId });
        }
        // Revoke after a delay to ensure download starts
        setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
      });
    })
    .catch((err) => {
      console.error('[Offscreen] Error:', err);
      sendResponse({ success: false, error: err.message });
    });

  return true; // async response
});
