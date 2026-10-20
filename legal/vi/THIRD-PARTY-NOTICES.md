# TickTune — Thông báo về thành phần của bên thứ ba

Version 2.0 · 2026-10-21 · Bản tiếng Anh là bản gốc có hiệu lực; đây là bản dịch
cung cấp cho thuận tiện.

Mã nguồn của chính TickTune theo giấy phép **GPL-3.0-only** — © 2026 poli0981.
Câu hỏi về giấy phép và ghi nhận tác giả: **copyright@poli0981.dev**.

## Ghi nhận đầy đủ

Trang này là bản tổng quan có chọn lọc. Thông báo đầy đủ — toàn văn giấy phép,
dòng bản quyền và tệp NOTICE của mọi gói nằm trong bản phát hành, kể cả các gói
phụ thuộc gián tiếp — được tạo lúc dựng và phục vụ tại
[`/THIRD-PARTY-NOTICES.txt`](/THIRD-PARTY-NOTICES.txt).

## Thành phần đóng gói / nhúng kèm

| Component | License | Ghi chú |
|-----------|---------|---------|
| Astro | MIT | khung dựng trang |
| Svelte | MIT | thư viện giao diện |
| @astrojs/svelte | MIT | tích hợp |
| Tailwind CSS | MIT | định kiểu |
| music-metadata | MIT | đọc thẻ âm thanh |
| Dexie.js | Apache-2.0 | lớp bọc IndexedDB; tệp NOTICE của nó được sao lại trong phần ghi nhận đầy đủ |
| i18next | MIT | dịch giao diện trong ứng dụng |
| DSEG7 Classic (font) | SIL OFL 1.1 | © 2017 keshikan (http://www.keshikan.net), **Tên phông chữ được bảo lưu "DSEG"**. v0.46, nhúng kèm nguyên bản không sửa đổi; giấy phép phát hành kèm tại `/fonts/dseg7/OFL.txt` |
| DSEG14 Classic (font) | SIL OFL 1.1 | © 2017 keshikan (http://www.keshikan.net), **Tên phông chữ được bảo lưu "DSEG"**. v0.46, nhúng kèm nguyên bản không sửa đổi; giấy phép phát hành kèm tại `/fonts/dseg14/OFL.txt` |
| Chakra Petch (font) | SIL OFL 1.1 | qua @fontsource (phần đóng gói theo MIT) |
| Be Vietnam Pro (font) | SIL OFL 1.1 | qua @fontsource (phần đóng gói theo MIT) |
| JetBrains Mono (font) | SIL OFL 1.1 | qua @fontsource (phần đóng gói theo MIT) |

Các công cụ phát triển — bộ công cụ TypeScript, trình kiểm tra mã, trình chạy kiểm
thử, Wrangler, pnpm và tương tự — không được phân phối kèm ứng dụng nên không có
thông báo ở đây.

## Dịch vụ (không đóng gói kèm)

| Dịch vụ | Điều khoản |
|---------|------------|
| Trình phát nhúng YouTube & IFrame Player API | [Điều khoản dịch vụ của YouTube](https://www.youtube.com/t/terms); chỉ tải từ YouTube trong chế độ YouTube, không bao giờ được đóng gói hay sửa đổi |
| YouTube oEmbed (qua điểm cuối biên của chúng tôi) | Điểm cuối oEmbed công khai; chỉ mã video được chuyển tiếp |
| Cloudflare (lưu trữ, CDN, Workers) | Điều khoản dịch vụ của Cloudflare |
| Cloudflare Web Analytics | Điều khoản dịch vụ của Cloudflare; beacon tải từ `static.cloudflareinsights.com` (xem Chính sách quyền riêng tư) |

## Nội dung đa phương tiện

TickTune không phát hành âm thanh, hình ảnh hay video của bất kỳ ai khác. Tiếng
chuông khi hết giờ được tổng hợp lúc chạy bằng mã Web Audio của chính ứng dụng.
