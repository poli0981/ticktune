# TickTune — Chính sách quyền riêng tư (Bản nháp)

Version 1.1-draft · 2026-07-24 · Bản tiếng Anh là bản gốc có hiệu lực; đây là
bản dịch cung cấp cho thuận tiện.

TickTune được xây dựng để biết về bạn càng ít càng tốt.

## 1. Những điều chúng tôi KHÔNG làm

- Không tài khoản, không đăng nhập.
- Không có mã phân tích hành vi, không pixel theo dõi, không lấy dấu vân tay
  thiết bị, không quảng cáo. (Vẫn có số liệu truy cập ở tầng mạng, và `§4.1`
  nói rõ đó là những gì và bên vận hành nhìn thấy được đến đâu.)
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
  thuật của yêu cầu (chẳng hạn địa chỉ IP) ở tầng mạng để phục vụ và bảo vệ trang
  web, theo tài liệu về quyền riêng tư của Cloudflare. Các biện pháp chống lạm
  dụng cơ bản như giới hạn tần suất chạy ở tầng này. Cloudflare lưu trữ và xử lý
  dữ liệu đó theo **chính sách và thời hạn lưu trữ của riêng họ**, không phải do
  chúng tôi đặt ra. Phần thực sự đến được với *chúng tôi* được nói ở mục kế tiếp.

### 4.1 Bên vận hành trang web nhìn thấy được những gì

Việc vận hành một trang web luôn sinh ra dữ liệu kỹ thuật, và bạn nên biết bao
nhiêu trong số đó đến được tay những người vận hành trang này. Có hai thứ.

**Số liệu trên bảng điều khiển Cloudflare — chỉ ở dạng tổng hợp.** Với tư cách
chủ sở hữu tên miền, chúng tôi thấy được các con số tổng: có bao nhiêu yêu cầu và
bao nhiêu băng thông đã phục vụ, số lượt khách truy cập ước tính, yêu cầu đến từ
những **quốc gia** nào, các mã trạng thái HTTP, bao nhiêu phần được trả từ bộ nhớ
đệm, và có bao nhiêu yêu cầu bị một quy tắc bảo mật chặn lại. Ở gói dịch vụ chúng
tôi dùng, đây là số liệu tổng hợp và trễ 24 giờ. Bảng điều khiển **không** hiển
thị địa chỉ IP hay chuỗi User-Agent của từng người — nhật ký thô theo từng yêu
cầu là tính năng dành cho gói doanh nghiệp mà chúng tôi không có — và phần phân
tích của Cloudflare cũng không theo dõi một cá nhân qua nhiều lượt truy cập bằng
IP, User-Agent hay bất kỳ dấu vân tay nào.

**Nhật ký Worker của chính chúng tôi — chỉ cho lời gọi API, và trong ba ngày.**
Điểm cuối `/api/yt/oembed` chạy trên một Cloudflare Worker có bật observability,
nên mỗi lời gọi sinh ra một bản ghi: yêu cầu, phản hồi, và quốc gia mà Cloudflare
gán cho lời gọi đó. **Việc mở một trang không tạo ra bản ghi nào** — các trang là
tệp tĩnh, được phục vụ mà không cần gọi tới Worker — nên một bản ghi chỉ tồn tại
vì bạn đã thêm một liên kết YouTube. Cloudflare xoá chúng sau **3 ngày**, và
chúng tôi không thể kéo dài thời hạn đó.

**Tất cả những số liệu này dùng để làm gì.** Để biết trang web còn chạy và thứ gì
đang lỗi; để thấy lượng truy cập và băng thông đang dùng bao nhiêu, bộ nhớ đệm có
hoạt động không; để nhận ra hành vi lạm dụng hay một đợt tăng truy cập bất
thường; và — đây chính là lý do nhật ký Worker tồn tại — để biết **vì sao** một
liên kết YouTube không tải được, bởi nhiệm vụ của điểm cuối đó là phân biệt một
video ở chế độ riêng tư, giới hạn độ tuổi, chặn theo khu vực hoặc đã bị xoá với
trường hợp dịch vụ của chính chúng tôi gặp sự cố.

**Những gì chúng tuyệt đối không dùng để làm.** Nhận dạng bạn, dựng hồ sơ về bạn,
theo dõi bạn giữa các lượt truy cập, quảng cáo, hay chia sẻ cho bất kỳ ai. Không
có dữ liệu nào ở trên được nối với những gì bạn làm bên trong ứng dụng: tệp, hàng
chờ và cài đặt của bạn không bao giờ rời khỏi trình duyệt (`§1`, `§2`), nên không
thứ gì kể trên có thể liên hệ được với những gì bạn thực sự đã phát.

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

**1.1-draft — 2026-07-24.** Bổ sung `§4.1`. Bản trước có câu rằng TickTune
"không tự lưu bất kỳ nhật ký phía máy chủ nào về bạn", và **câu đó không đúng**:
Worker `/api/yt/oembed` đã bật observability ngay từ khi được xây dựng, và nó giữ
lại một bản ghi cho mỗi lời gọi trong ba ngày. Cách ứng dụng hoạt động không thay
đổi gì — chính sách chỉ đang mô tả đúng những gì vốn đã diễn ra. Cổng pháp lý
hiện lại vì phần nội dung bạn đã đồng ý trước đây là không chính xác, mà sự đồng
ý dành cho một mô tả sai thì không phải là sự đồng ý.
