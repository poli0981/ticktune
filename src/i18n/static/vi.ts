import type { StaticDict } from './en';

/**
 * Static-page strings — Vietnamese, the UI default (docs/08).
 *
 * The `: StaticDict` annotation is the guard: a missing key, an extra key or a
 * mis-nested one fails `pnpm check`, in both directions and before any test
 * runs. `en.ts` is the reference — add there first.
 *
 * What the type CANNOT catch is value-level: an empty string, a mismatched
 * array length, or an entry left in English. `tests/unit/tt-static-i18n.test.ts`
 * covers those, exactly as `tt-i18n-keys.test.ts` does for the island.
 */
export const vi: StaticDict = {
  common: {
    openApp: 'Mở TickTune →',
    backHome: '← Về trang chủ',
    sourceOffer: 'Mã nguồn — GPL-3.0',
    switchTo: 'English',
    switchToLabel: 'Switch to English',
  },

  landing: {
    title: 'TickTune — đếm ngược toàn màn hình với nhạc của bạn',
    description:
      'Đếm ngược toàn màn hình với nhạc của riêng bạn. Mọi thứ chạy trong trình duyệt — không tệp nào rời khỏi máy bạn.',
    heroHeadline: 'Đồng hồ của bạn. Nhạc của bạn. Máy của bạn.',
    heroSub:
      'Một đồng hồ đếm ngược bảy đoạn cỡ lớn, nhạc của bạn phía sau, và không có gì được tải lên đâu cả.',
    heroMediaAlt: 'TickTune đang đếm ngược với hiệu ứng nhạc phía sau',
    heroPlaceholderNote: 'Ảnh minh hoạ tạm — bản demo thật sẽ có trước v1.0.',

    featuresTitle: 'TickTune làm được gì',
    features: [
      {
        title: 'Chạy hoàn toàn trong trình duyệt',
        body: 'Tệp của bạn được đọc trong bộ nhớ của phiên và không bao giờ được tải lên. Không có tài khoản, cũng không có máy chủ nào để gửi đi.',
      },
      {
        title: 'Được làm ra để ngắm',
        body: 'Đồng hồ bảy đoạn phát sáng trên nền tối, kèm hình nền, hiệu ứng nhạc và một đèn tally nhấp theo nhịp.',
      },
      {
        title: 'Thuộc về bạn',
        body: 'GPL-3.0, mã nguồn công khai, không đo đạc và không phân tích hành vi. Bạn thấy gì thì nó là tất cả.',
      },
    ],

    modesTitle: 'Ba cách phát',
    modes: [
      {
        name: 'Một bài',
        body: 'Một bài, lặp lại phía sau đồng hồ. Cách đơn giản nhất để bắt đầu.',
      },
      {
        name: 'Danh sách',
        body: 'Hàng chờ có thể đổi thứ tự bằng cách kéo hoặc bằng Alt+↑/↓, kèm trộn bài và lặp lại.',
      },
      {
        name: 'YouTube',
        body: 'Dán link và chúng phát bằng chính trình phát nhúng của YouTube — trình phát luôn hiển thị, đúng như điều khoản của họ yêu cầu.',
      },
    ],
    modesNote: 'Một hàng chờ hoặc toàn tệp trên máy, hoặc toàn link — hai loại không trộn lẫn.',

    limitsTitle: 'Giới hạn',
    limitsNote: 'Được chọn để phiên làm việc luôn mượt, và được kiểm ngay khi bạn nhập.',
    limitsHead: { what: 'Hạng mục', limit: 'Giới hạn' },
    limits: [
      { what: 'Chế độ một bài', limit: 'một tệp, tối đa 10:02' },
      { what: 'Số tệp trong danh sách', limit: 'tối đa 95 tệp' },
      { what: 'Mỗi tệp trong danh sách', limit: 'tối đa 10:02' },
      { what: 'Tổng danh sách', limit: 'tối đa 91:00' },
      { what: 'Link YouTube', limit: 'tối đa 50 (không giới hạn thời lượng)' },
      { what: 'Đồng hồ đếm ngược', limit: '1 giây đến 24 giờ' },
    ],

    faqTitle: 'Câu hỏi thường gặp',
    legalTitle: 'Phần pháp lý',
    legalNote: 'Bản tiếng Anh là bản gốc có hiệu lực của mỗi văn bản.',
  },

  faq: [
    {
      /* docs/04 §2 item 6 — nói thẳng ở nơi người dùng quyết định có tin hay không. */
      q: 'Đồng hồ có chính xác không nếu tôi chuyển sang tab khác?',
      a: 'Đồng hồ chính xác khi tab đang hiển thị. Khi tab chạy nền thì nó ở mức tốt nhất có thể: thời gian đã trôi luôn được tính đúng, nhưng trình duyệt có thể không cho ứng dụng phản ứng cho tới khi bạn quay lại. Nếu đồng hồ về 0 lúc bạn đang đi vắng, màn hình Kết thúc sẽ cho biết thời điểm thực sự về 0 chứ không giả vờ như vừa mới xảy ra.',
    },
    {
      q: 'Tệp của tôi có bị tải lên đâu không?',
      a: 'Không. Tệp trên máy được đọc ngay trong trình duyệt và chỉ giữ trong bộ nhớ của phiên. Không có điểm tiếp nhận tải lên, không đo đạc, không phân tích hành vi. Đóng hoặc tải lại tab là hàng chờ mất — ứng dụng sẽ hỏi bạn trước.',
    },
    {
      q: 'Sao điện thoại của tôi không dùng được?',
      a: 'TickTune chỉ dành cho máy tính, và đó là chủ ý. Bố cục được dựng quanh một đồng hồ cỡ lớn kèm bảng bên, còn phần âm thanh và xử lý tệp đều giả định trình duyệt máy tính. Điện thoại và máy tính bảng chỉ cảm ứng sẽ thấy một thông báo ngắn.',
    },
    {
      q: 'Link YouTube thì sao?',
      a: 'Chúng phát bằng trình phát nhúng chính thức của YouTube, và trình phát luôn hiển thị vì điều khoản của họ yêu cầu vậy. TickTune không tải xuống, không trích xuất và không phát lại lậu âm thanh hay video, và cũng không đọc được âm thanh của video YouTube — nên chế độ này không có hiệu ứng nhạc.',
    },
    {
      q: 'Có gì được lưu trên máy tôi không?',
      a: 'Chỉ cài đặt của bạn — ngôn ngữ, hình nền, đồng hồ và tuỳ chọn phát lại — cùng với ghi nhận rằng bạn đã đồng ý điều khoản. Tệp, hàng chờ và link của bạn không bao giờ được lưu.',
    },
    {
      q: 'Có thật là miễn phí không?',
      a: 'Đúng vậy, và còn là phần mềm tự do: GPL-3.0-only, mã nguồn công khai. Bạn được đọc, chạy, sửa và chia sẻ lại theo cùng giấy phép đó.',
    },
  ],

  notFound: {
    title: '404 — Không tìm thấy kênh · TickTune',
    heading: 'Không tìm thấy kênh',
    body: 'Trang đó không nằm trên tần số này.',
  },

  legal: {
    canonicalEn: 'Bản tiếng Anh này là bản gốc có hiệu lực của văn bản.',
    canonicalVi:
      'Đây là bản dịch để tiện theo dõi. Bản tiếng Anh mới là bản có hiệu lực khi cần diễn giải.',
    versionLabel: 'Phiên bản',
    docs: {
      eula: 'Điều khoản sử dụng',
      disclaimer: 'Tuyên bố miễn trừ',
      privacy: 'Chính sách riêng tư',
      thirdParty: 'Ghi chú bên thứ ba',
    },
  },
};
