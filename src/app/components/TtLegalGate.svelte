<script lang="ts">
  import { TT_LEGAL_LINKS, TT_LEGAL_VERSION } from '../../lib/tt-legal-const';

  /**
   * Legal gate — docs/03 §3.2, docs/02 §1.
   *
   * Two jobs, and the second is easy to miss: it collects consent, **and its
   * Accept click is the user gesture that unlocks autoplay**. docs/05 §1 hangs
   * `AudioContext.resume()` off exactly this click, because it is the only
   * guaranteed gesture before playback. P2 drops that call into `onaccept`;
   * the seam exists now so P2 does not have to reopen this component.
   */

  interface Props {
    /** Called with the version the user accepted. */
    onaccept: (version: string) => void;
  }

  const { onaccept }: Props = $props();

  let agreed = $state(false);
  let dialog = $state<HTMLElement | null>(null);

  $effect(() => {
    // Focus lands inside the dialog, not on whatever was behind it (docs/03 §8).
    dialog?.querySelector<HTMLInputElement>('input')?.focus();
  });
</script>

<!--
  Blocking by construction: a fixed full-screen layer with nothing behind it
  reachable. role/aria-modal so assistive tech treats it as a dialog rather than
  as a region the user can escape by tabbing.
-->
<div
  class="tt-gate"
  role="dialog"
  aria-modal="true"
  aria-labelledby="tt-gate-title"
  bind:this={dialog}
>
  <div class="tt-gate-card">
    <div class="mb-4 flex items-center gap-2">
      <span class="bg-tt-danger inline-block size-2.5 rounded-full" aria-hidden="true"></span>
      <h1 id="tt-gate-title" class="text-lg font-semibold tracking-wide">TickTune</h1>
    </div>

    <p class="mb-3 text-sm">Trước khi bắt đầu, vui lòng đọc và đồng ý:</p>

    <ul class="text-tt-muted mb-4 space-y-1.5 text-sm">
      <li>
        <strong class="text-tt-text">Nhạc của bạn không rời khỏi máy.</strong> Tệp được giữ trong bộ nhớ
        của trình duyệt cho phiên hiện tại và không được tải lên bất kỳ máy chủ nào.
      </li>
      <li>
        <strong class="text-tt-text">Bạn chịu trách nhiệm về nội dung mình mở.</strong> TickTune không
        kiểm duyệt và không lưu trữ nội dung đó.
      </li>
      <li>
        <strong class="text-tt-text">Chế độ YouTube dùng trình phát chính thức</strong> của YouTube; khi
        dùng, bạn cũng chịu ràng buộc bởi điều khoản của YouTube và Google.
      </li>
      <li>Phần mềm cung cấp "NGUYÊN TRẠNG", không bảo hành.</li>
    </ul>

    <p class="text-tt-muted mb-4 text-xs">
      Toàn văn:
      <a href={TT_LEGAL_LINKS.eula} rel="noopener noreferrer" target="_blank">Điều khoản</a> ·
      <a href={TT_LEGAL_LINKS.disclaimer} rel="noopener noreferrer" target="_blank">Miễn trừ</a> ·
      <a href={TT_LEGAL_LINKS.privacy} rel="noopener noreferrer" target="_blank">Quyền riêng tư</a>
      ·
      <a href={TT_LEGAL_LINKS.thirdParty} rel="noopener noreferrer" target="_blank">Bên thứ ba</a>
    </p>

    <label class="mb-4 flex cursor-pointer items-start gap-2 text-sm">
      <input type="checkbox" bind:checked={agreed} class="mt-0.5" data-testid="tt-gate-agree" />
      <span>Tôi đã đọc và đồng ý với các điều khoản trên.</span>
    </label>

    <button
      class="tt-gate-accept"
      disabled={!agreed}
      data-testid="tt-gate-accept"
      onclick={() => onaccept(TT_LEGAL_VERSION)}
    >
      Đồng ý và tiếp tục
    </button>

    <p class="text-tt-muted mt-3 text-center font-mono text-[10px]">
      v{TT_LEGAL_VERSION} · lưu cục bộ trên máy bạn
    </p>
  </div>
</div>

<style>
  .tt-gate {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: center;
    padding: 1.5rem;
    background: color-mix(in srgb, var(--color-tt-void) 88%, transparent);
    backdrop-filter: blur(6px);
  }
  .tt-gate-card {
    width: 100%;
    max-width: 34rem;
    padding: 1.75rem;
    background: var(--color-tt-surface);
    border: 1px solid var(--color-tt-line);
    border-radius: 0.75rem;
  }
  .tt-gate a {
    color: var(--color-tt-signal);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .tt-gate-accept {
    width: 100%;
    padding: 0.6rem;
    font-weight: 500;
    color: var(--color-tt-signal);
    background: transparent;
    border: 1px solid var(--color-tt-line);
    border-radius: 0.375rem;
    transition: border-color var(--duration-tt-fast) var(--ease-tt);
  }
  .tt-gate-accept:hover:not(:disabled) {
    border-color: var(--color-tt-signal);
  }
  .tt-gate-accept:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
