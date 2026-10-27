# Thiên Khôi CDC — Website thiết kế & thi công xây dựng

Website một trang cho **Thiên Khôi CDC** gồm:

- **Hero 3D tương tác, toàn màn hình**: người xem cuộn tới đâu thì máy quay đi tới đó (từ ngoài cổng → sảnh → phòng khách → bếp), video 60 fps chạy xuôi hoặc ngược theo tay cuộn. Điện thoại cầm dọc dùng video 9:16 riêng; máy tính và điện thoại xoay ngang dùng 16:9 (xoay máy thì tự đổi, giữ nguyên vị trí). Chuột, vuốt ngang hoặc nghiêng máy tạo chiều sâu 3D. Chữ của từng chương đặt dọc đường đi và lướt qua camera.
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
Thuộc tính `data-at` là vị trí của chương trên đường đi (0 = ngoài cổng, 1 = trong bếp).

Chân trang lấy thông tin tập đoàn từ mục `group` trong `data/content.json`. Mục nào có `"url": ""` (chưa có đường dẫn gốc) sẽ tạm dẫn về `https://thienkhoi.com`. Biểu tượng mạng xã hội và các liên kết chính sách chỉ hiện khi đã điền `url`.

## Thay video hero (tự động)

Hero phát **video thật 60 khung hình/giây** theo tay cuộn của người xem. Cuộn xuống là phát bản xuôi, cuộn lên là phát bản đảo chiều; tốc độ phát tỉ lệ với khoảng cách cần đi nên chuyển động luôn mượt.

Đổi sang video khác chỉ cần **một lệnh** (máy cần cài `ffmpeg`):

```bash
npm run video -- duong-dan/video-moi.mp4
# Video không có logo/watermark cần cắt: CROP=none npm run video -- video-moi.mp4
# Có sẵn video dọc 9:16 riêng cho điện thoại: MOBILE_SRC=video-doc.mp4 npm run video -- video-ngang.mp4
```

Script `scripts/build-video.sh` tự làm các bước sau:
1. Cắt góc có logo Gemini.
2. Nội suy chuyển động lên 60 fps.
3. Khử nhiễu, giữ bản gốc 60 fps ở độ phân giải gốc rồi mỗi bản xuất chỉ phóng to **một lần** (Lanczos) và làm nét theo đúng kích thước đó.
4. Tự tìm chỗ cắt cảnh đầu tiên và chỉ lấy đoạn đi liền mạch làm hiệu ứng cuộn.
5. Xuất bản xuôi và bản đảo chiều: 16:9 1920×1080 (máy tính, điện thoại xoay ngang), 16:9 1280×720 (màn hình độ phân giải thấp), 9:16 1080×1920 (điện thoại cầm dọc). Mỗi file khoảng 13 MB trở xuống; bản đảo chiều chỉ tải sau khi bản xuôi đã tải xong.
6. Tạo ảnh bìa cho cả hai tỉ lệ.

**Video 9:16 cho điện thoại:** nếu không có `MOBILE_SRC`, script tự cắt dọc từ video ngang. Khung dọc trượt mượt qua các điểm nhìn khai báo trong `scripts/reframe-916.json` (mỗi giây một điểm, `[giây, vị trí 0–1 từ trái sang phải]`). File này viết riêng cho video hiện tại: đổi video thì xóa file (cắt giữa) hoặc khai báo lại điểm nhìn.

Không cần sửa mốc thời gian: vị trí chương (`data-at`) tính theo tỉ lệ đường đi nên tự khớp với video mới.

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
