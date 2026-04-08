// Offscreen document — handles downloads with full DOM APIs (chrome.downloads available)

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== 'downloadPdf') return;

  const { blobUrl, filename } = message;
  console.log(`[Offscreen] Downloading: ${filename}`);

  // Convert blob URL to Blob (available in this DOM context)
  fetch(blobUrl)
    .then((res) => res.blob())
    .then((blob) => {
      console.log(`[Offscreen] Blob fetched (${(blob.size / 1024 / 1024).toFixed(2)}MB)`);

      // createObjectURL is available here (DOM context)
      const localUrl = URL.createObjectURL(blob);

      chrome.downloads.download({
        url: localUrl,
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
        // Revoke after delay to let download start
        setTimeout(() => URL.revokeObjectURL(localUrl), 20000);
      });
    })
    .catch((err) => {
      console.error('[Offscreen] Error:', err);
      sendResponse({ success: false, error: err.message });
    });

  return true; // async response
});
