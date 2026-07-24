# TickTune — Thông báo về thành phần của bên thứ ba (Bản nháp)

Version 1.0-draft · 2026-07-21 · Bản tiếng Anh là bản gốc có hiệu lực; đây là
bản dịch cung cấp cho thuận tiện. Hiển thị tại `/legal/third-party` và được liên
kết từ Cổng pháp lý cùng bảng Giới thiệu. Quy tắc quy trình: mọi phụ thuộc mới
đều được thêm vào đây trong chính PR giới thiệu nó, sau khi đã kiểm tra tính
tương thích với GPL-3.0 (`docs/11 §5`).

⚠️ Một dòng trong bảng nghĩa là thành phần đó **được phát hành kèm ứng dụng**.
Motion từng có một dòng ghi "từ P5; chưa được cài đặt" — P5 đã phát hành mà
không có nó, nên bảng đang hứa ghi công cho một thứ chưa người dùng nào nhận
được. Đã gỡ ở P6 slice B. Đừng thêm dòng trước khi thêm phụ thuộc: tệp này trả
lời câu hỏi "tôi đang thực sự chạy những gì", không phải một bản kế hoạch.

Mã nguồn của chính TickTune: **GPL-3.0-only** — © 2026 poli0981.

## Thành phần được đóng gói / nhúng kèm

| Thành phần | Giấy phép | Ghi chú |
|-----------|---------|-------|
| Astro | MIT | khung dựng bản |
| Svelte | MIT | thư viện giao diện |
| @astrojs/svelte | MIT | tích hợp |
| Tailwind CSS | MIT | tạo kiểu |
| music-metadata | MIT | đọc thẻ dữ liệu âm thanh |
| Dexie.js | Apache-2.0 | lớp bọc IndexedDB (mã Apache-2.0 kết hợp vào một dự án GPL-3.0 — tương thích một chiều) |
| i18next | MIT | thư viện đa ngôn ngữ (26.3.6, cài đặt ở P5) |
| DSEG7 Classic (font) | SIL OFL 1.1 | © 2017 keshikan (http://www.keshikan.net), **Tên phông chữ được bảo lưu "DSEG"**. v0.46, nhúng kèm nguyên bản không sửa đổi; toàn văn giấy phép được phát hành cùng bản dựng tại `public/fonts/dseg7/OFL.txt` (OFL §2 yêu cầu giấy phép phải đi kèm phông chữ). Nguồn gốc và mã băm SHA-256: `public/fonts/dseg7/PROVENANCE.md`. Tên được bảo lưu nghĩa là không được tạo tập con hay dựng lại tệp mà vẫn giữ tên đó — một bản phái sinh bắt buộc phải đổi tên. |
| Be Vietnam Pro (font) | SIL OFL 1.1 | qua gói @fontsource (phần đóng gói theo MIT) |
| JetBrains Mono (font) | SIL OFL 1.1 | qua gói @fontsource (phần đóng gói theo MIT) |

Các công cụ chỉ dùng khi phát triển (TypeScript, ESLint, Prettier, knip, Vitest,
Testing Library, happy-dom, Playwright, ffmpeg-static, Wrangler, pnpm) **không
được phân phối kèm ứng dụng**, nên không phát sinh nghĩa vụ thông báo và không
có dòng nào ở bảng trên. Tính *tương thích* với GPL-3.0 của chúng vẫn được kiểm
tra trước khi đưa vào, theo `docs/11 §5` — đây là hai câu hỏi tách biệt và chỉ
một trong hai dừng lại ở ranh giới bản dựng.

## Dịch vụ (không đóng gói kèm)

| Dịch vụ | Điều khoản |
|---------|-------|
| Trình phát nhúng YouTube & IFrame Player API | Điều khoản dịch vụ của YouTube; tải từ YouTube lúc chạy và chỉ trong chế độ YouTube; không bao giờ được đóng gói kèm hay sửa đổi |
| YouTube oEmbed (qua proxy biên của chúng tôi) | Điểm cuối oEmbed công khai; chỉ mã video được chuyển tiếp |
| Cloudflare (lưu trữ/CDN/Workers) | Điều khoản dịch vụ của Cloudflare |

## Phương tiện

**TickTune không phát hành kèm bất kỳ tệp âm thanh nào.** Tiếng chuông báo hết
giờ được tổng hợp lúc chạy bằng chính mã Web Audio của ứng dụng — hai bộ dao
động và một đường bao biên độ (`docs/05 §7`) — nên trong bản dựng không có tài
sản âm thanh nào cần cấp phép, ghi công hay kê khai. TickTune **không** phát
hành kèm bất kỳ âm thanh, hình ảnh hay video nào của bên thứ ba.
