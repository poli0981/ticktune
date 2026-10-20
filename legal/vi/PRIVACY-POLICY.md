# TickTune — Chính sách quyền riêng tư

Version 1.1 · 2026-10-20 · Bản tiếng Anh là bản gốc có hiệu lực; đây là bản dịch
cung cấp cho thuận tiện.

TickTune được làm ra để biết về bạn càng ít càng tốt. **Tệp, danh sách phát và cài
đặt của bạn không bao giờ rời khỏi trình duyệt.**

## 1. Ai vận hành TickTune

Một dự án nguồn mở độc lập, phi thương mại, do một nhà phát triển — **poli0981** —
vận hành; không có công ty, không có nhân viên. Câu hỏi về quyền riêng tư:
**privacy@poli0981.dev** (thư được chuyển qua Google Workspace), hoặc một
[GitHub issue](https://github.com/poli0981/ticktune/issues) công khai. Chúng tôi
không lưu giữ gì có thể nhận diện bạn, nên không có dữ liệu cá nhân nào để xuất,
sửa hay xoá theo yêu cầu.

## 2. Trên thiết bị của bạn

- **Cài đặt** và việc bạn đã đồng ý tại Cổng pháp lý được lưu trong IndexedDB của
  trình duyệt — một cơ sở dữ liệu `ticktune`, chứa một dòng. "Đặt lại ứng dụng"
  trong Cài đặt sẽ xoá nó.
- **Tệp và danh sách phát** chỉ nằm trong bộ nhớ của phiên và mất khi bạn đóng
  hoặc tải lại thẻ. Chúng không bao giờ được tải lên.
- TickTune **không đặt cookie** và không dùng `localStorage` hay `sessionStorage`.

## 3. Những gì đi qua mạng

| Khi nào | Yêu cầu | Mang theo gì |
|---------|---------|--------------|
| Mọi trang | Chính trang web, do Cloudflare phục vụ | Dữ liệu yêu cầu thông thường, như địa chỉ IP và trình duyệt của bạn |
| Mọi trang | Beacon **Cloudflare Web Analytics** (`static.cloudflareinsights.com`, gửi về `cloudflareinsights.com`) | Địa chỉ trang, trang dẫn tới, trình duyệt và hệ điều hành của bạn, cùng thời gian tải trang |
| Khi bạn thêm liên kết YouTube | `/api/yt/oembed` trên tên miền của chúng tôi | Chỉ mã video 11 ký tự |
| Chế độ YouTube | YouTube IFrame API (`www.youtube.com`), trình phát (`youtube-nocookie.com`) và ảnh thu nhỏ (`i.ytimg.com`) | Những gì trình phát của YouTube yêu cầu |

Các chế độ phát tệp trên máy không gửi bất kỳ yêu cầu nào tới Google.

## 4. Cloudflare Web Analytics

Chúng tôi đếm lượt truy cập bằng Cloudflare Web Analytics. Theo Cloudflare, công
cụ này không đặt cookie hay lưu trữ cục bộ, không tạo dấu vân tay trình duyệt và
không theo dõi ai qua các trang web khác; Cloudflare suy ra quốc gia gần đúng từ
yêu cầu. Chúng tôi chỉ thấy số liệu tổng hợp — lượt xem trang, lượt truy cập, quốc
gia, trang dẫn tới, trình duyệt và hiệu năng tải — không bao giờ thấy lịch sử của
một người cụ thể. Cloudflare xử lý dữ liệu này theo chính sách quyền riêng tư của
họ.

## 5. YouTube và Google

Chế độ YouTube dùng Dịch vụ API của YouTube. Khi bạn tương tác với trình phát,
Google có thể đặt cookie và xử lý dữ liệu như mô tả trong
[Chính sách quyền riêng tư của Google](https://policies.google.com/privacy). Trình
phát được tạo trên máy chủ bảo vệ quyền riêng tư `youtube-nocookie.com`.

## 6. Người vận hành thấy được gì

- **Bảng điều khiển Cloudflare — chỉ số liệu tổng hợp:** số yêu cầu, băng thông,
  số khách truy cập ước tính, quốc gia, mã trạng thái, mức dùng bộ nhớ đệm, các mối
  đe doạ bị chặn, và số liệu Web Analytics ở `§4`. Không có địa chỉ IP hay chuỗi
  trình duyệt của từng người.
- **Nhật ký Worker — chỉ các lượt tra cứu YouTube:** mỗi lần gọi `/api/yt/oembed`
  được ghi lại (yêu cầu, phản hồi và quốc gia Cloudflare gắn vào) và được
  Cloudflare xoá sau **7 ngày**. Việc tải trang không bao giờ tạo ra mục nhật ký.

Những thông tin này dùng để giữ trang hoạt động, phát hiện lạm dụng và biết vì sao
một liên kết YouTube không phân giải được — không bao giờ để nhận diện bạn, lập hồ
sơ, quảng cáo hay chia sẻ cho ai, và không bao giờ được gắn với bất cứ việc gì bạn
làm trong ứng dụng.

## 7. Dữ liệu chẩn đoán bạn tự chia sẻ

**Chép thông tin chẩn đoán** tạo một bản JSON ngay trên thiết bị của bạn — phiên bản ứng
dụng, trình duyệt, cài đặt và nhật ký mã gần đây, không có tên tệp — để bạn dán vào
một GitHub issue. Không gì được gửi đi trừ khi bạn tự dán nó.

## 8. Trẻ em

TickTune không thu thập dữ liệu cá nhân của bất kỳ ai, kể cả trẻ em.

## 9. Thời hạn lưu trữ và thay đổi

Dữ liệu trên thiết bị còn cho đến khi bạn xoá; nhật ký Worker bị xoá sau 7 ngày;
số liệu phân tích tổng hợp được Cloudflare lưu theo thời hạn của họ. Thay đổi đáng
kể sẽ khiến Cổng pháp lý hiện lại; mọi bản sửa đổi đều có trong kho Git.

| Phiên bản | Ngày | Thay đổi |
|-----------|------|----------|
| 1.1 | 2026-10-20 | Cloudflare Web Analytics; nhật ký Worker lưu 7 ngày (Workers Paid); địa chỉ liên hệ quyền riêng tư; liên kết YouTube và Google; rút gọn |
| 1.0 | 2026-07-24 | Phiên bản chính thức đầu tiên |
