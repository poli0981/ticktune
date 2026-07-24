# TickTune — Chính sách quyền riêng tư (Bản nháp)

Version 1.0-draft · 2026-07-21 · Bản tiếng Anh là bản gốc có hiệu lực; đây là
bản dịch cung cấp cho thuận tiện.

TickTune được xây dựng để biết về bạn càng ít càng tốt.

## 1. Những điều chúng tôi KHÔNG làm

- Không tài khoản, không đăng nhập.
- Không phân tích hành vi, không pixel theo dõi, không lấy dấu vân tay thiết bị,
  không quảng cáo.
- Không tải tệp của bạn lên: âm thanh, hình ảnh và danh sách phát được xử lý
  hoàn toàn trong trình duyệt của bạn và **không bao giờ được truyền đi** tới
  máy chủ của chúng tôi.
- Bản thân TickTune không đặt cookie nào.
- Phông chữ được tự lưu trữ — không có yêu cầu nào tới CDN phông chữ của bên thứ
  ba.

## 2. Dữ liệu lưu trên thiết bị của bạn

Các thiết lập (ngôn ngữ, giao diện, tùy chọn phát) và việc bạn chấp nhận ở Cổng
pháp lý được lưu cục bộ qua IndexedDB/localStorage trên thiết bị của bạn. Danh
sách phát và các tệp của bạn chỉ tồn tại trong bộ nhớ cho phiên làm việc hiện
tại và biến mất khi tải lại. Chức năng "Đặt lại ứng dụng" trong phần Cài đặt sẽ
xóa toàn bộ dữ liệu lưu cục bộ.

## 3. Các yêu cầu mạng mà ứng dụng thực hiện

- **Tài nguyên tĩnh** của chính trang web, phân phối qua Cloudflare.
- **`/api/yt/oembed`** (chỉ khi bạn thêm liên kết YouTube): ứng dụng gửi mã
  video 11 ký tự tới điểm cuối biên của chúng tôi, nơi này hỏi dịch vụ oEmbed
  công khai của YouTube để lấy tiêu đề/tác giả/ảnh thu nhỏ. Không có dữ liệu nào
  khác được gửi đi.
- **Ảnh thu nhỏ của YouTube** (`i.ytimg.com`) khi trong hàng đợi có liên kết
  YouTube.

## 4. Bên thứ ba

- **YouTube / Google.** Chỉ khi bạn dùng chế độ YouTube: trình phát nhúng chính
  thức (dùng máy chủ tăng cường quyền riêng tư `youtube-nocookie.com`) sẽ tải mã
  của Google và có thể đặt cookie cũng như thu thập dữ liệu như mô tả trong
  Chính sách quyền riêng tư của Google, kể từ khi bạn tương tác với trình phát.
  Các chế độ chạy trên máy không tạo yêu cầu nào tới Google.
- **Cloudflare.** Trang web được phân phối bởi Cloudflare, bên xử lý dữ liệu kỹ
  thuật của yêu cầu (chẳng hạn địa chỉ IP) một cách tạm thời ở tầng mạng để phục
  vụ và bảo vệ trang web, theo tài liệu về quyền riêng tư của Cloudflare.
  TickTune không dùng dữ liệu này để nhận dạng bạn và không tự lưu bất kỳ nhật
  ký phía máy chủ nào về bạn. Các biện pháp chống lạm dụng cơ bản (giới hạn tần
  suất, giảm thiểu bot) chạy ở tầng này.

## 5. Thông tin chẩn đoán do bạn chủ động chia sẻ

Chức năng **Sao chép thông tin chẩn đoán** tạo một bản chụp JSON (phiên bản ứng
dụng, chuỗi user-agent của trình duyệt, các thiết lập, nhật ký nội bộ gần đây)
ngay trên máy bạn, để *bạn* có thể dán vào một issue trên GitHub. Không có gì
được gửi đi đâu trừ khi chính bạn dán nó. Hãy xem lại nội dung trước khi chia sẻ.

## 6. Trẻ em

TickTune không thu thập dữ liệu cá nhân của bất kỳ ai, kể cả trẻ em, và không có
tính năng nào giới hạn theo độ tuổi.

## 7. Thay đổi

Những thay đổi trọng yếu sẽ kích hoạt lại Cổng pháp lý. Lịch sử tài liệu có thể
xem trong kho Git: `https://github.com/poli0981/ticktune`.
