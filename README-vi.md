# Manga-Pdf-Maker Chrome Extension

## Hướng dẫn cài đặt

1. Mở Chrome và truy cập `chrome://extensions/`
2. Bật "Developer mode" (Chế độ nhà phát triển) ở góc trên bên phải
3. Click "Load unpacked" (Tải tiện ích đã giải nén)
4. Chọn thư mục `chromex-manga-pdf-maker`
5. Click vào icon extension trên toolbar để mở trang web ở tab mới

## Hướng dẫn sử dụng

1. Click vào icon **Manga-Pdf-Maker** trên toolbar để mở ứng dụng trong tab mới

2. **Base URL**: Nhập URL gốc của trang web manga (ví dụ: `https://comics.vn/`)

3. **Image Url Filter**: (Tùy chọn) Nhập pattern để lọc URL hình ảnh

4. **GroupBy**: Chọn cách nhóm các chapter:
   - `1`: Mỗi part có 1 chapter
   - `2`: Mỗi part có 2 chapter (mặc định)
   - `5`: Mỗi part có 5 chapter
   - `10`: Mỗi part có 10 chapter
   - `All`: Tất cả chapter trong 1 part

5. **URL's chapters**: Dán HTML chứa các link chapter vào đây
   - Extension sẽ tự động trích xuất tất cả thẻ `<a>` 
   - Kết hợp href với Base URL để tạo URL hoàn chỉnh
   - Hỗ trợ cả đường dẫn tương đối và tuyệt đối

6. **Chapters**: Bên phải sẽ hiển thị danh sách các chapter đã được nhóm
   - Mỗi part có nút "Make Part X"
   - Click vào để tạo PDF cho part đó (chức năng đang phát triển)

## Ví dụ

### Input HTML trong URL's chapters:
```html
<a href="/truyen-tranh/phong-van-manhua-14809-chap-1.html">Chapter 1</a>
<a href="/truyen-tranh/phong-van-manhua-14809-chap-2.html">Chapter 2</a>
<a href="/truyen-tranh/phong-van-manhua-14809-chap-3.html">Chapter 3</a>
<a href="/truyen-tranh/phong-van-manhua-14809-chap-4.html">Chapter 4</a>
```

### Với Base URL: `https://comics.vn/` và GroupBy: `2`

Kết quả sẽ được nhóm thành:
- **Part 1**: 
  - https://comics.vn/truyen-tranh/phong-van-manhua-14809-chap-1.html
  - https://comics.vn/truyen-tranh/phong-van-manhua-14809-chap-2.html
- **Part 2**: 
  - https://comics.vn/truyen-tranh/phong-van-manhua-14809-chap-3.html
  - https://comics.vn/truyen-tranh/phong-van-manhua-14809-chap-4.html

## Tính năng

- ✅ Tự động lưu cài đặt (dữ liệu được lưu trong Chrome Storage)
- ✅ Hỗ trợ đường dẫn tương đối và tuyệt đối
- ✅ Nhóm chapter linh hoạt
- ✅ Giao diện thân thiện
- 🚧 Tạo PDF từ hình ảnh (đang phát triển)
- 🚧 Tải xuống PDF (đang phát triển)

## Cấu trúc Project

```
chromex-manga-pdf-maker/
├── manifest.json       # Chrome extension manifest (v3)
├── background.js       # Service worker xử lý click event
├── index.html          # Trang chính hiển thị ở tab mới
├── index.css          # Styles cho trang chính
├── index.js           # Logic xử lý
├── icons/             # Icons cho extension
│   ├── icon16.png     # Icon 16x16
│   ├── icon48.png     # Icon 48x48
│   └── icon128.png    # Icon 128x128
├── create-icons.sh    # Script tạo icons
├── .gitignore         # Git ignore file
├── README.md          # Tài liệu (English)
└── README-vi.md       # Tài liệu (Tiếng Việt)
```

## Phát triển tiếp

Để phát triển thêm tính năng tạo PDF, cần:

1. Thêm permission để truy cập các trang chapter
2. Tạo content script để extract hình ảnh
3. Sử dụng thư viện như jsPDF hoặc pdfmake để tạo PDF
4. Implement download manager

## License

MIT
