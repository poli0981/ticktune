import type { StaticDict } from './en';

/**
 * Static-page strings — Japanese (v2.0, docs/08).
 *
 * The landing (`/ja/`) and its 404 only. The legal documents are not
 * translated: a Japanese reader is sent to the English text, which is the
 * canonical version (`legal.legalNote` says so where the links are). The
 * `legal.*` and `common.switchTo*` values below exist because `StaticDict`
 * requires the full shape; nothing on a Japanese page renders the legal ones.
 *
 * The `: StaticDict` annotation makes a missing or extra key a type error, and
 * `tests/unit/tt-static-i18n.test.ts` covers what the type cannot — empty
 * strings, array lengths, and entries left in English.
 */
export const ja: StaticDict = {
  common: {
    openApp: 'TickTune を開く →',
    backHome: '← トップへ戻る',
    sourceOffer: 'ソースコード — GPL-3.0',
    switchTo: '英語版',
    switchToLabel: '英語版に切り替え',
    langNav: '言語',
  },

  landing: {
    title: 'TickTune — 好きな音楽で、全画面カウントダウン',
    description:
      '自分の音楽を流しながら使える全画面カウントダウン。すべてブラウザーの中で動き、ファイルが端末の外に出ることはありません。',
    // Three short lines of near-equal width: the hero breaks after each `。`, and
    // 「カウントダウン」 alone overran its column and split mid-word.
    heroHeadline: 'あなたの時計。あなたの音楽。あなたの端末。',
    heroSub:
      '大きな 7 セグメントのカウントダウンと、その後ろで流れるあなたの音楽。どこにも何もアップロードしません。',
    heroMediaAlt: 'ビジュアライザーを背景にカウントダウンを表示している TickTune',

    featuresTitle: 'できること',
    features: [
      {
        title: 'すべてブラウザーの中で',
        body: 'ファイルはこのセッションの間だけメモリで読み込まれ、アップロードされることはありません。アカウントも不要で、読み込んだものがどこかへ送られることもありません。',
      },
      {
        title: '眺めるためのデザイン',
        body: '暗いステージに光る 7 セグメントの時計。背景、ビジュアライザー、そしてビートに合わせて点滅するタリーランプ。',
      },
      {
        title: 'ずっと自由に',
        body: 'GPL-3.0 でソースは公開。計測するのは Cookie を使わない匿名のアクセス数だけで、ファイルには一切触れません。',
      },
    ],

    modesTitle: '3 つの再生モード',
    modes: [
      {
        name: 'シングル',
        body: '1 曲をカウントダウンの後ろでループ再生。いちばん手軽な始め方です。',
      },
      {
        name: 'プレイリスト',
        body: 'ドラッグや Alt+↑/↓ で並べ替えられるキュー。シャッフルとリピートにも対応。',
      },
      {
        name: 'YouTube',
        body: 'リンクを貼り付けると YouTube 公式の埋め込みプレーヤーで再生します。規約どおり、プレーヤーは常に表示されたままです。',
      },
    ],
    modesNote:
      'キューはローカルファイルだけか、リンクだけのどちらかです — 混ぜることはできません。',

    limitsTitle: '上限',
    limitsNote: 'セッションが軽快に動くように決めた値で、読み込みの時点で適用されます。',
    limitsHead: { what: '項目', limit: '上限' },
    limits: [
      { what: 'シングルモード', limit: 'ファイル 1 つ、最長 10:02' },
      { what: 'プレイリストの曲数', limit: '最大 95 ファイル' },
      { what: 'プレイリストの 1 曲', limit: 'それぞれ最長 10:02' },
      { what: 'プレイリストの合計', limit: '最長 91:00' },
      { what: 'YouTube のリンク', limit: '最大 50（長さの制限なし）' },
      { what: 'カウントダウン', limit: '1 秒から 24 時間' },
    ],

    faqTitle: 'よくある質問',
    legalTitle: '規約など',
    legalNote: '各文書は英語版が正本です。日本語訳はありません。',
    contactTitle: 'お問い合わせ',
    contactPress: '報道関係',
    contactCollab: 'コラボレーション',
    contactSecurity: 'セキュリティ',
  },

  faq: [
    {
      q: '別のタブに切り替えても、カウントダウンは正確ですか？',
      a: 'タブが表示されている間は正確です。バックグラウンドにある間はベストエフォートになります。経過時間は常に正しく計算されますが、戻ってくるまでブラウザーがアプリの反応を止めることがあります。離れている間に終わった場合、終了画面は「今終わった」とは言わず、実際にゼロになった時刻を表示します。',
    },
    {
      q: 'ファイルはどこかにアップロードされますか？',
      a: 'いいえ。ローカルファイルはブラウザーの中で読み込まれ、このセッションの間だけメモリに保持されます。アップロード先はありません。サイトが計測するのは匿名のアクセス数（Cloudflare Web Analytics、Cookie なし）だけで、ファイルを見ることはありません。タブを閉じたり再読み込みしたりするとキューは消えます — その前にアプリが確認します。',
    },
    {
      q: 'スマートフォンで使えないのはなぜですか？',
      a: 'TickTune は意図的にデスクトップ専用です。大きなカウントダウンとサイドレールを前提にしたレイアウトで、音声やファイルの扱いもデスクトップのブラウザーを想定しています。スマートフォンやタッチ専用のタブレットには短い案内が表示されます。',
    },
    {
      q: 'YouTube のリンクはどう扱われますか？',
      a: 'YouTube 公式の埋め込みプレーヤーで再生され、規約に従って常に表示されたままです。TickTune が音声や動画をダウンロード・抽出・再配信することはなく、YouTube の動画の音声を読み取ることもできません — そのため、このモードではビジュアライザーは使えません。',
    },
    {
      q: '端末に何か保存されますか？',
      a: '設定（言語、背景、カウントダウンと再生の好み）と、規約に同意した記録だけです。ファイル、キュー、リンクが保存されることはありません。',
    },
    {
      q: '本当に無料ですか？',
      a: 'はい。しかも自由ソフトウェアです。GPL-3.0-only でソースを公開しており、同じライセンスのもとで読む・動かす・変える・共有することができます。',
    },
  ],

  notFound: {
    title: '404 — チャンネルが見つかりません · TickTune',
    heading: 'チャンネルが見つかりません',
    body: 'そのページはこの周波数にはありません。',
  },

  legal: {
    canonicalEn: 'この英語のテキストがこの文書の正本です。',
    canonicalVi: 'これは便宜上の翻訳です。解釈には英語版が優先されます。',
    generatedNotices: '同梱コンポーネントのライセンス全文 →',
    versionLabel: 'バージョン',
    docs: {
      eula: '利用規約（英語）',
      disclaimer: '免責事項（英語）',
      privacy: 'プライバシーポリシー（英語）',
      thirdParty: 'サードパーティの通知（英語）',
    },
  },
};
