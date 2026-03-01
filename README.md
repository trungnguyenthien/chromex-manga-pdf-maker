# Manga-Pdf-Maker Chrome Extension

Chrome Extension v3 for creating PDFs from manga chapters. Opens in a new tab for a full-page experience.

## Features

- **Base URL**: Set the base URL of the manga website
- **Image URL Filter**: Filter images to include in the PDF
- **GroupBy**: Group chapters into parts (1, 2, 5, 10, or All)
- **URL's chapters**: Paste HTML containing chapter links
- **Auto-grouping**: Automatically groups chapters and displays them in parts
- **Make PDF**: Create PDF for each part (Coming soon)
- **Full-page UI**: Opens in a new tab for better user experience

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked"
4. Select the `chromex-manga-pdf-maker` folder
5. Click the extension icon on the toolbar to open the app in a new tab

## Usage

1. Click the **Manga-Pdf-Maker** extension icon on the toolbar to open the app in a new tab
2. Enter the base URL of the manga website (e.g., `https://comics.vn/`)
3. (Optional) Enter an image URL filter pattern
4. Select how you want to group chapters (default is 2)
5. Paste HTML containing chapter links in the "URL's chapters" textarea
   - The extension will extract all `<a>` tags and combine them with the base URL
6. View the grouped chapters in the right panel
7. Click "Make Part X" to create a PDF for that part

## Project Structure

```
chromex-manga-pdf-maker/
├── manifest.json       # Chrome extension manifest (v3)
├── background.js       # Service worker handling click events
├── index.html          # Main page displayed in new tab
├── index.css          # Styles for main page
├── index.js           # Main page logic
├── icons/             # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── create-icons.sh    # Script to generate icons
├── .gitignore
├── README.md          # This file
└── README-vi.md       # Vietnamese documentation
```

## Creating Icons

The extension requires icons in three sizes: 16x16, 48x48, and 128x128 pixels.

### Using ImageMagick (if available):

```bash
./create-icons.sh
```

### Manually:

Create PNG files for each size and place them in the `icons/` directory:
- `icon16.png` (16x16)
- `icon48.png` (48x48)
- `icon128.png` (128x128)

You can use any image editor to create these icons. Suggested design: A book or PDF icon with manga-style elements.

## Development

The extension saves your inputs to Chrome's local storage, so your settings persist between sessions.

### TODO:
- [ ] Implement actual PDF creation from chapter images
- [ ] Add progress indicator for PDF creation
- [ ] Support for different manga websites
- [ ] Custom image filtering logic
- [ ] Download management

## Technologies

- Chrome Extension Manifest V3
- Vanilla JavaScript
- Chrome Storage API
- HTML5 & CSS3

## License

MIT
