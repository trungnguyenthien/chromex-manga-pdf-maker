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
function makePart(urls, partNumber) {
  console.log(`Making Part ${partNumber}:`, urls);
  alert(`Making Part ${partNumber} with ${urls.length} chapter(s).\n\nThis feature will download images and create PDF.\n\n(Implementation in progress...)`);
  
  // TODO: Implement actual PDF creation logic
  // This would involve:
  // 1. Fetching each chapter URL
  // 2. Extracting images (using imageUrlFilter if provided)
  // 3. Creating a PDF from the images
  // 4. Downloading the PDF
}localStorage
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
  } updateChaptersList();
    }
  });
}
