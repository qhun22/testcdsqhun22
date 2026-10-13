# Chợ Nhà

Monorepo JavaScript cho cửa hàng trực tuyến: HTML/CSS/JS mobile-first ở `apps/storefront`, Cloudflare Worker REST API ở `apps/api`, và Cloudflare D1 để lưu sản phẩm, khách hàng, đơn hàng.

## Chạy local

Yêu cầu Node.js 20+ và npm.

Trên Windows, chạy `run-local.bat` để tự cài dependencies nếu còn thiếu, áp dụng migration D1 local và khởi động ứng dụng. Mở URL Wrangler in ra; trang quản trị nằm ở `/admin.html`. Môi trường local không cần kết nối Workers AI từ xa; chatbot có thể dùng phản hồi dự phòng.

Để dùng các chức năng quản trị, tạo mã quản trị local một lần bằng lệnh `npx.cmd wrangler secret put ADMIN_TOKEN --local`.

Hoặc chạy thủ công:

1. Cài dependencies: `npm.cmd install`
2. Tạo database D1 local và nạp dữ liệu mẫu: `npm.cmd run db:local`
3. Chạy ứng dụng: `npm.cmd run dev`

 Wrangler tạo database local từ migration; không cần tạo D1 từ xa để phát triển. Giá trị `database_id` mẫu trong `wrangler.jsonc` chỉ cần thay bằng ID thật khi triển khai lên Cloudflare.

## Triển khai Cloudflare

1. Cấu hình `wrangler.jsonc` với account ID và D1 database ID thuộc cùng Cloudflare account. Dự án hiện dùng Worker `testcdsqhun22` và D1 database `cho-nha-db`.
2. Chạy `npm.cmd run db:remote` để áp dụng migration và dữ liệu khởi tạo; đặc biệt phải chạy khi có migration mới trước khi deploy. Migration `0005` bổ sung mã chuyển khoản ngẫu nhiên gồm 6 ký tự chữ in hoa và chữ số, dùng thống nhất trên QR và thông báo Telegram.
3. Chạy `npx.cmd wrangler secret put ADMIN_TOKEN` để đặt token quản trị production. Chat dùng `ORDER_STATUS_SECRET` để ký quyền xem trạng thái từng đơn; nếu chưa đặt, mã này được ký bằng `TELEGRAM_WEBHOOK_SECRET` (cả hai phải dài tối thiểu 32 ký tự).
4. Chạy `npm.cmd run deploy`.
5. Tạo hai Worker secrets `TELEGRAM_BOT_TOKEN` và `TELEGRAM_WEBHOOK_SECRET` bằng `npx.cmd wrangler secret put <TÊN_SECRET>`. Bot token phải là token riêng BotFather; webhook secret là một chuỗi ngẫu nhiên riêng dài tối thiểu 32 ký tự, không phải bot token. Không ghi các giá trị này vào Variables, mã nguồn, file `.vars` được commit hay tin nhắn hỗ trợ.
6. Đặt `TELEGRAM_BOT_TOKEN` và `TELEGRAM_WEBHOOK_SECRET` trong biến môi trường cục bộ hoặc file `.dev.vars` (file này đã bị Git bỏ qua). Sau khi deploy, chạy `npm.cmd run telegram:set-webhook`; script đăng ký URL Worker, secret header và chỉ nhận `callback_query`. Telegram sẽ gửi nút duyệt/từ chối về Worker; duyệt xác nhận đơn, từ chối hủy đơn và hoàn tồn kho.

API tra cứu trạng thái đơn yêu cầu `ORDER_STATUS_SECRET` và token ký riêng cho đơn được trả cùng phản hồi tạo đơn. Không đưa secret ký vào mã nguồn; nếu chưa cấu hình, ứng dụng vẫn tạo đơn nhưng tạm tắt việc tự cập nhật trạng thái thanh toán trong trình duyệt.

Để thử callback trên local, đảm bảo Worker local cũng có đủ hai giá trị secret trong `.dev.vars`, sau đó chạy `npm.cmd run telegram:delete-webhook` rồi mới chạy `npm.cmd run telegram:poll` cùng lúc với `run-local.bat`. Xóa webhook làm ngừng nhận callback ở production cho đến khi chạy lại `npm.cmd run telegram:set-webhook`; poller không tự xóa webhook và chỉ chuyển tiếp tới localhost.

Chatbot lưu hội thoại, nội dung đang nhập và tiến trình chọn hàng trong `localStorage` của trình duyệt; nút làm mới trong tiêu đề chat chủ động xóa phiên hiện tại. Thông tin giao hàng trong biểu mẫu thanh toán chat cũng được giữ cục bộ cho đến khi hoàn tất hoặc tạo phiên mới.

Tab **Phân tích** trong quản trị thống kê lượt tải trang chủ theo ngày, quốc gia Cloudflare nhận diện và hệ điều hành phân loại từ user-agent. Dữ liệu được cộng gộp trong D1, không lưu IP, cookie, user-agent thô hay mã định danh khách; lượt xem không phải số khách duy nhất. Dữ liệu cũ hơn 90 ngày được xóa theo lịch chạy mỗi ngày. Do đây là thống kê tổng hợp trong D1, nó phù hợp quy mô cửa hàng vừa và nhỏ, không phải nền tảng big-data/streaming.

Đăng nhập quản trị tiếp tục yêu cầu secret `ADMIN_TOKEN` và được lưu trong session của tab; không sử dụng mật khẩu mặc định `admin|123`. Chạy `npm.cmd run db:remote` để áp dụng migration analytics trước khi deploy. Tab Phân tích có nút **Tạo dữ liệu demo** để tạo lại mẫu 30 ngày với nhiều quốc gia và hệ điều hành; lượt demo được lưu riêng, cộng vào biểu đồ/tổng số nhưng không xóa hoặc sửa lượt truy cập thật.

## Chức năng

- Khách hàng: xem sản phẩm, lọc danh mục, tìm kiếm, giỏ hàng lưu trên trình duyệt và tạo đơn hàng.
- Trợ lý chat dùng Cloudflare Workers AI khi binding `AI` khả dụng, tra cứu sản phẩm còn hàng và có phản hồi dự phòng theo câu hỏi thường gặp.
- Quản trị: xem tổng quan, quản lý sản phẩm/danh mục, xem khách hàng và cập nhật trạng thái đơn hàng.
- API quản trị yêu cầu `ADMIN_TOKEN` qua `Authorization: Bearer ...`; token trên giao diện chỉ lưu trong session của tab.
- Thanh toán hỗ trợ VietQR với số tiền và nội dung chuyển khoản gắn theo đơn; đơn vẫn chờ cửa hàng xác nhận thủ công vì chưa tích hợp webhook đối soát tiền về. Thanh toán khi nhận hàng và chuyển khoản thủ công vẫn khả dụng. MoMo và VNPay hiển thị là sắp hỗ trợ, chưa thể tạo đơn bằng hai phương thức này.
- Với VietQR, Worker gửi thông báo Telegram kèm nút duyệt/từ chối khi đã cấu hình bot token và webhook secret. Tác vụ webhook xác thực header secret, chat ID và người bấm. Duyệt đánh dấu đã nhận thanh toán; từ chối hủy đơn và hoàn lại số lượng tồn kho.

Workers AI cần được bật cho tài khoản Cloudflare trước khi triển khai. Nếu binding AI chưa dùng được, chatbot vẫn trả lời các câu hỏi cơ bản và tìm sản phẩm.

## Cấu trúc

```text
apps/
  api/src/index.js       Cloudflare Worker API
  storefront/            HTML, CSS và vanilla JavaScript
migrations/              D1 schema và dữ liệu mẫu
wrangler.jsonc           Worker, static assets và D1 binding
```