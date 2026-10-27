# Thiên Khôi CDC — Website thiết kế & thi công xây dựng

Website một trang cho **Thiên Khôi CDC** gồm:

- **Hero cuộn 3D**: video fly-through (ngoại thất → sảnh → phòng khách → bếp) được tua theo thanh cuộn. Các chương chữ bay vào/ra theo trục Z, khung cảnh nghiêng 3D theo chuột, ảnh chuyển mượt giữa các khung hình.
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

Tạo bản xem trước tĩnh (không cần server): `node scripts/build-preview.js` → thư mục `preview-dist/`.

Nội dung chữ của 5 chương trong hero nằm trong `public/index.html` (các khối `data-chap`).
Thuộc tính `data-in` / `data-out` là vị trí cuộn (từ 0 đến 1) mà chương đó xuất hiện và biến mất.

## Thay video hero

Hero dùng chuỗi ảnh WebP để tua mượt, không phát trực tiếp video. Muốn đổi sang video khác:

```bash
V=video-moi.mp4
ffmpeg -i "$V" -vf "fps=6" -c:v libwebp -quality 62 public/assets/frames/lg/f%03d.webp
ffmpeg -i "$V" -vf "fps=6,scale=640:-2" -c:v libwebp -quality 60 public/assets/frames/sm/f%03d.webp
```

Sau đó sửa `data-frames="180"` trong `public/index.html` thành số ảnh vừa tạo.
Video mẫu hiện tại đã được cắt khung để bỏ logo Gemini ở góc phải.

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
public/assets/       khung hình hero, ảnh dự án, favicon
test/                kiểm thử API
```
