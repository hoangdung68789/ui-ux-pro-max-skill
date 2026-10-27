# Thiên Khôi CDC — Website thiết kế & thi công xây dựng

Website một trang cho **Thiên Khôi CDC** gồm:

- **Hero cuộn 3D**: video fly-through 60 fps (ngoại thất → sảnh → phòng khách → bếp). Mỗi lần cuộn, video tự chạy đến cảnh tiếp theo. Chữ của từng chương bay vào/ra theo trục Z, khung cảnh nghiêng 3D theo chuột hoặc theo độ nghiêng điện thoại. Có nút xem toàn màn hình.
- **Front-end** thuần HTML/CSS/JS, không cần build. Font: Cormorant Garamond, Be Vietnam Pro, Allura (đều hỗ trợ tiếng Việt).
- **Back-end Node.js** (không cần cài thư viện, chỉ cần Node 18 trở lên):
  - Render trang từ `data/content.json` để tốt cho SEO.
  - API nhận yêu cầu báo giá, có kiểm tra dữ liệu, chống spam (giới hạn số lần gửi và honeypot).
  - Trang quản trị `/admin` có lọc, tìm kiếm, đổi trạng thái, ghi chú và xuất CSV (mở được bằng Excel).
  - Báo lead mới qua Telegram (tùy chọn).

## Chạy thử

```bash
cd projects/thien-khoi-cdc
cp .env.example .env      # đặt ADMIN_TOKEN của bạn
npm start                 # http://localhost:3000  ·  quản trị: http://localhost:3000/admin
npm test                  # kiểm thử API
```

Nếu chưa đặt `ADMIN_TOKEN`, server in một mã tạm ra màn hình mỗi lần khởi động.

## Chỉnh nội dung (không cần sửa code)

Mọi thông tin nằm trong **`data/content.json`**. Lưu file là trang tự cập nhật, không cần khởi động lại server.

| Mục | Nội dung |
|---|---|
| `company` | Tên, **số điện thoại, Zalo, email, địa chỉ, giờ làm việc**, tên miền |
| `commitments` | 3 cam kết ở phần Giới thiệu |
| `services` | 6 dịch vụ (cũng là danh sách trong form báo giá) |
| `process` | 6 bước quy trình |
| `projects` | Ảnh và mô tả dự án (ảnh đặt trong `public/assets/img/`) |
| `budgets` | Các mức ngân sách trong form |

> ⚠️ Số điện thoại `0900 000 000`, email và tên miền hiện là **giá trị mẫu**. Cần thay bằng thông tin thật trước khi chạy chính thức.

Tạo bản xem trước tĩnh (không cần server): `npm run preview` → thư mục `preview-dist/`.

Nội dung chữ của 5 chương trong hero nằm trong `public/index.html` (các khối `data-chap`).
Thuộc tính `data-in` / `data-out` là vị trí cuộn (từ 0 đến 1) mà chương đó xuất hiện và biến mất.

## Thay video hero (tự động)

Hero phát **video thật 60 khung hình/giây**. Mỗi lần cuộn, video tự chạy mượt đến cảnh kế tiếp rồi dừng lại kèm chữ của chương đó. Cuộn ngược thì phát bản video đảo chiều. Nút **Xem toàn màn hình** mở cả video (có âm thanh) ở chế độ toàn màn hình của điện thoại.

Đổi sang video khác chỉ cần **một lệnh** (máy cần cài `ffmpeg`):

```bash
npm run video -- duong-dan/video-moi.mp4
# Video không có logo/watermark cần cắt: CROP=none npm run video -- video-moi.mp4
```

Script `scripts/build-video.sh` tự làm các bước sau:
1. Cắt góc có logo Gemini.
2. Nội suy chuyển động lên 60 fps.
3. Khử nhiễu, phóng lên 1080p và làm nét.
4. Xuất bản xuôi (có âm thanh) và bản đảo chiều.
5. Xuất bản 720p cho điện thoại.
6. Tạo ảnh poster.

Sau khi chạy xong, sửa `data-stops` trong `public/index.html`. Đây là các mốc thời gian (giây) mà video dừng lại cho từng chương, ví dụ `data-stops="0,3.5,8,12.5,19"` cho 5 chương (nên tránh các điểm cắt cảnh).

## Triển khai

- Chạy lâu dài trên VPS bằng `pm2 start server.js --name thienkhoi`, đặt sau Nginx và bật `TRUST_PROXY=1` trong `.env`.
- Lead được lưu ở `data/leads.json` (file này không đưa lên git). Nên sao lưu định kỳ.

## Cấu trúc

```
server.js            máy chủ + API + render nội dung
data/content.json    toàn bộ nội dung website
public/index.html    giao diện (template)
public/styles.css    thiết kế
public/app.js        hero cuộn 3D, hiệu ứng, form
public/admin.*       trang quản trị lead
public/assets/       video hero, poster, ảnh dự án, favicon
scripts/             build-video.sh (xử lý video tự động), build-preview.js
test/                kiểm thử API
```
