// DOM Elements
const baseUrlInput = document.getElementById('baseUrl');
const imageUrlFilterInput = document.getElementById('imageUrlFilter');
const urlsChapterTextarea = document.getElementById('urlsChapter');
const chaptersList = document.getElementById('chaptersList');
const groupByButtons = document.querySelectorAll('.groupby-btn');
const revertListBtn = document.getElementById('revertListBtn');

// State
let currentGroupBy = 2;
let chapterUrls = [];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadSavedData();
  setupEventListeners();
});

// Setup event listeners
function setupEventListeners() {
  // GroupBy buttons
  groupByButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      groupByButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentGroupBy = btn.dataset.value === 'all' ? 'all' : parseInt(btn.dataset.value);
      saveData();
      updateChaptersList();
    });
  });

  // URL's chapter textarea
  urlsChapterTextarea.addEventListener('input', () => {
    parseChapterUrls();
  });

  // Base URL input
  baseUrlInput.addEventListener('input', () => {
    parseChapterUrls();
  });

  // Image URL Filter input
  imageUrlFilterInput.addEventListener('input', () => {
    saveData();
  });

  // Revert List button
  revertListBtn.addEventListener('click', () => {
    chapterUrls.reverse();
    updateChaptersList();
    saveData();
  });
}

// Parse chapter URLs from HTML
function parseChapterUrls() {
  const htmlContent = urlsChapterTextarea.value;
  const baseUrl = baseUrlInput.value.trim();
  
  if (!htmlContent) {
    chapterUrls = [];
    updateChaptersList();
    saveData();
    return;
  }

  // Create a temporary DOM element to parse HTML
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = htmlContent;
  
  // Extract all <a> tags
  const anchorTags = tempDiv.querySelectorAll('a');
  chapterUrls = [];
  
  anchorTags.forEach(anchor => {
    let href = anchor.getAttribute('href');
    if (href) {
      // Combine with base URL if href is relative
      if (href.startsWith('/')) {
        href = baseUrl.replace(/\/$/, '') + href;
      } else if (!href.startsWith('http')) {
        href = baseUrl.replace(/\/$/, '') + '/' + href;
      }
      chapterUrls.push(href);
    }
  });

  updateChaptersList();
  saveData();
}

// Update chapters list display
function updateChaptersList() {
  if (chapterUrls.length === 0) {
    chaptersList.innerHTML = '<div class="empty-message">No chapters yet. Paste HTML with links in the URL\'s chapters field.</div>';
    return;
  }

  const parts = groupChapters(chapterUrls, currentGroupBy);
  
  chaptersList.innerHTML = parts.map((part, index) => {
    return `
      <div class="chapter-part">
        <div class="chapter-part-header">
          <button class="make-part-btn" data-part="${index}">Make Part ${index + 1}</button>
        </div>
        <div class="chapter-urls">
          ${part.map(url => `<div class="chapter-url">${url}</div>`).join('')}
        </div>
      </div>
    `;
  }).join('');

  // Add event listeners to "Make Part" buttons
  document.querySelectorAll('.make-part-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const partIndex = parseInt(e.target.dataset.part);
      makePart(parts[partIndex], partIndex + 1);
    });
  });
}

// Group chapters based on groupBy value
function groupChapters(urls, groupBy) {
  if (groupBy === 'all') {
    return [urls];
  }

  const parts = [];
  for (let i = 0; i < urls.length; i += groupBy) {
    parts.push(urls.slice(i, i + groupBy));
  }
  return parts;
}

// Make PDF from a part
async function makePart(urls, partNumber) {
  console.log(`Making Part ${partNumber}:`, urls);
  
  const filter = imageUrlFilterInput.value.trim();
  
  try {
    showProgress(true);
    updateProgress(0, 'Initializing...');
    
    const allImages = [];
    const totalChapters = urls.length;
    
    // Step 1: Fetch all chapters and extract images
    for (let i = 0; i < urls.length; i++) {
      const chapterUrl = urls[i];
      updateProgress(
        ((i / totalChapters) * 50),
        `Fetching chapter ${i + 1}/${totalChapters}...`
      );
      
      const imageUrls = await fetchAndExtractImages(chapterUrl, filter);
      allImages.push(...imageUrls);
    }
    
    if (allImages.length === 0) {
      alert('No images found in the chapters!');
      showProgress(false);
      return;
    }
    
    updateProgress(50, `Found ${allImages.length} images. Downloading and processing...`);
    
    // Step 2: Download and resize images
    const processedImages = [];
    for (let i = 0; i < allImages.length; i++) {
      updateProgress(
        50 + ((i / allImages.length) * 40),
        `Processing image ${i + 1}/${allImages.length}...`
      );
      
      try {
        const imgData = await downloadAndResizeImage(allImages[i], 700);
        if (imgData) {
          processedImages.push(imgData);
        }
      } catch (error) {
        console.error(`Failed to process image ${allImages[i]}:`, error);
      }
    }
    
    if (processedImages.length === 0) {
      alert('Failed to process any images!');
      showProgress(false);
      return;
    }
    
    // Step 3: Generate PDF
    updateProgress(90, 'Creating PDF...');
    await generatePDF(processedImages, partNumber);
    
    updateProgress(100, 'Done!');
    setTimeout(() => showProgress(false), 1000);
    
  } catch (error) {
    console.error('Error creating PDF:', error);
    alert(`Error creating PDF: ${error.message}`);
    showProgress(false);
  }
}

// Fetch chapter HTML and extract image URLs
async function fetchAndExtractImages(url, filter) {
  try {
    // Use background script to fetch HTML (bypasses CORS)
    const response = await chrome.runtime.sendMessage({
      action: 'fetchHtml',
      url: url
    });
    
    if (!response.success) {
      throw new Error(response.error);
    }
    
    const html = response.html;
    
    // Parse HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // Get base URL for resolving relative paths
    const baseUrl = new URL(url);
    
    // Extract all img tags
    const images = doc.querySelectorAll('img');
    const imageUrls = [];
    
    images.forEach(img => {
      // Get src from various attributes (use getAttribute to get original value)
      let src = img.getAttribute('src') || 
                img.getAttribute('data-src') || 
                img.getAttribute('data-original') ||
                img.getAttribute('data-lazy-src');
      
      if (src) {
        // Convert relative URLs to absolute URLs
        if (src.startsWith('//')) {
          src = baseUrl.protocol + src;
        } else if (src.startsWith('/')) {
          src = baseUrl.origin + src;
        } else if (!src.startsWith('http')) {
          src = new URL(src, url).href;
        }
        
        // Apply filter if provided
        if (!filter || src.includes(filter)) {
          imageUrls.push(src);
        }
      }
    });
    
    return imageUrls;
    
  } catch (error) {
    console.error(`Failed to fetch ${url}:`, error);
    return [];
  }
}

// Download and resize image to target width
async function downloadAndResizeImage(url, targetWidth) {
  try {
    // Use background script to fetch image (bypasses CORS)
    const response = await chrome.runtime.sendMessage({
      action: 'fetchImage',
      url: url
    });
    
    if (!response.success) {
      throw new Error(response.error);
    }
    
    // Create image from base64 data URL
    return new Promise((resolve, reject) => {
      const img = new Image();
      
      img.onload = () => {
        try {
          // Calculate new dimensions
          const aspectRatio = img.height / img.width;
          const newWidth = targetWidth;
          const newHeight = Math.floor(targetWidth * aspectRatio);
          
          // Create canvas
          const canvas = document.createElement('canvas');
          canvas.width = newWidth;
          canvas.height = newHeight;
          
          // Draw resized image
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, newWidth, newHeight);
          
          // Get image data
          const imageData = canvas.toDataURL('image/jpeg', 0.9);
          
          resolve({
            data: imageData,
            width: newWidth,
            height: newHeight
          });
        } catch (error) {
          reject(error);
        }
      };
      
      img.onerror = () => {
        reject(new Error(`Failed to load image: ${url}`));
      };
      
      img.src = response.dataUrl;
    });
  } catch (error) {
    throw new Error(`Failed to fetch image ${url}: ${error.message}`);
  }
}

// Generate PDF from processed images
async function generatePDF(images, partNumber) {
  const { jsPDF } = window.jspdf;
  
  if (!images || images.length === 0) {
    throw new Error('No images to create PDF');
  }
  
  // Use first image to determine page size
  const firstImg = images[0];
  const pageWidth = firstImg.width;
  const pageHeight = firstImg.height;
  
  // Create PDF (dimensions in mm, convert from pixels assuming 96 DPI)
  const mmWidth = (pageWidth * 25.4) / 96;
  const mmHeight = (pageHeight * 25.4) / 96;
  
  const pdf = new jsPDF({
    orientation: pageHeight > pageWidth ? 'portrait' : 'landscape',
    unit: 'mm',
    format: [mmWidth, mmHeight]
  });
  
  // Add images to PDF
  images.forEach((img, index) => {
    if (index > 0) {
      pdf.addPage([mmWidth, mmHeight]);
    }
    
    const imgMmWidth = (img.width * 25.4) / 96;
    const imgMmHeight = (img.height * 25.4) / 96;
    
    pdf.addImage(img.data, 'JPEG', 0, 0, imgMmWidth, imgMmHeight);
  });
  
  // Save PDF
  const fileName = `manga-part-${partNumber}.pdf`;
  pdf.save(fileName);
}

// Progress modal helpers
function showProgress(show) {
  const modal = document.getElementById('progressModal');
  if (show) {
    modal.classList.add('active');
  } else {
    modal.classList.remove('active');
  }
}

function updateProgress(percent, text) {
  const fill = document.getElementById('progressFill');
  const textEl = document.getElementById('progressText');
  
  fill.style.width = `${percent}%`;
  textEl.textContent = text;
}

// Save data to localStorage
function saveData() {
  const data = {
    baseUrl: baseUrlInput.value,
    imageUrlFilter: imageUrlFilterInput.value,
    urlsChapter: urlsChapterTextarea.value,
    groupBy: currentGroupBy,
    chapterUrls: chapterUrls
  };
  
  localStorage.setItem('mangaPdfMakerData', JSON.stringify(data));
}

// Load saved data from localStorage
function loadSavedData() {
  const savedData = localStorage.getItem('mangaPdfMakerData');
  
  if (!savedData) {
    return;
  }
  
  try {
    const data = JSON.parse(savedData);
    
    // Restore Base URL
    if (data.baseUrl) {
      baseUrlInput.value = data.baseUrl;
    }
    
    // Restore Image URL Filter
    if (data.imageUrlFilter) {
      imageUrlFilterInput.value = data.imageUrlFilter;
    }
    
    // Restore URL's chapter and chapter URLs
    if (data.urlsChapter) {
      urlsChapterTextarea.value = data.urlsChapter;
      
      // Use saved chapterUrls if available, otherwise parse from HTML
      if (data.chapterUrls && Array.isArray(data.chapterUrls)) {
        chapterUrls = data.chapterUrls;
      } else {
        parseChapterUrls();
      }
    }
    
    // Restore GroupBy
    if (data.groupBy !== undefined) {
      currentGroupBy = data.groupBy;
      
      // Update active button
      groupByButtons.forEach(btn => {
        const btnValue = btn.dataset.value === 'all' ? 'all' : parseInt(btn.dataset.value);
        if (btnValue === currentGroupBy) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
    }
    
    // Update the chapters list display
    updateChaptersList();
    
  } catch (error) {
    console.error('Error loading saved data:', error);
  }
}
