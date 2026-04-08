// Offscreen document — handles PDF download with chrome.downloads + URL.createObjectURL

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'offscreen-dl') return;

  console.log('[Offscreen] Port connected');

  port.onMessage.addListener((msg) => {
    if (msg.type !== 'downloadPdf') return;

    const { filename, buffer } = msg;
    console.log(`[Offscreen] Received PDF (${(buffer.byteLength / 1024 / 1024).toFixed(2)}MB), downloading...`);

    const blob = new Blob([buffer], { type: 'application/pdf' });
    const blobUrl = URL.createObjectURL(blob);

    chrome.downloads.download({
      url: blobUrl,
      filename: filename,
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('[Offscreen] Error:', chrome.runtime.lastError.message);
        port.postMessage({ success: false, error: chrome.runtime.lastError.message });
      } else {
        console.log(`[Offscreen] ✓ Saved: ${filename} (id=${downloadId})`);
        port.postMessage({ success: true });
      }
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    });
  });
});
