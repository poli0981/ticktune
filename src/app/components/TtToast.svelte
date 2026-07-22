<script lang="ts">
  import type { TtImportResult } from '../engine/importer/types';

  /**
   * The import summary toast — docs/02 §4 ("Added 12 · Skipped 3") plus one row
   * per distinct rejection code.
   *
   * Every skip is surfaced, not just counted: docs/01 §2 principle 5 is "fail
   * visible, log everything", and a file that vanished with no explanation is
   * the thing that makes an importer feel broken.
   *
   * The `data-tt-code` attribute is how E2E asserts a specific rejection
   * without a Settings panel to read the log from. Codes are non-identifying by
   * construction (docs/12 §6), so exposing them is safe.
   */

  interface Props {
    result: TtImportResult;
    ondismiss: () => void;
  }

  const { result, ondismiss }: Props = $props();

  const MESSAGES: Record<string, string> = {
    'TT-IMP-001': 'Định dạng không được hỗ trợ',
    'TT-IMP-002': 'Dài hơn giới hạn 10:02',
    'TT-IMP-003': 'Vượt tổng thời lượng 91:00',
    'TT-IMP-004': 'Vượt số lượng cho phép',
    'TT-IMP-005': 'Trùng với tệp đã có',
    'TT-IMP-006': 'Không đọc được thẻ — dùng tên tệp',
    'TT-IMP-007': 'Thẻ bị lỗi mã hoá — dùng tên tệp',
    'TT-IMP-008': 'Quá nhiều mục trong thư mục thả vào',
    // docs/06 §5. Without these the toast falls back to the bare "Đã bỏ qua",
    // which is the one thing docs/01 §2 principle 5 exists to prevent: a link
    // that vanished with no reason is what makes an importer feel broken.
    'TT-YT-001': 'Chưa kiểm tra được — sẽ thử lại khi bắt đầu',
    'TT-YT-002': 'Không phải link video YouTube',
    'TT-YT-003': 'Vượt giới hạn 50 link',
    'TT-YT-004': 'YouTube từ chối, không rõ lý do',
    'TT-YT-100': 'Video đã xoá hoặc ở chế độ riêng tư',
    'TT-YT-101': 'Chủ video không cho phép nhúng',
  };

  // Grouped by code: 40 files rejected for the same reason is one row saying
  // "×40", not forty rows the user has to scroll past.
  //
  // A plain object rather than a Map: `svelte/prefer-svelte-reactivity` flags a
  // mutable Map inside a component, and it is right to — a Map is not deeply
  // reactive in runes mode, so one used as state would silently fail to update.
  // Here it is local to a derivation, but the rule cannot know that, and the
  // object form is just as clear.
  const groups = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const s of [...result.skipped, ...result.notes]) {
      counts[s.code] = (counts[s.code] ?? 0) + 1;
    }
    return Object.entries(counts);
  });
</script>

<div class="tt-toast" role="status" data-testid="tt-toast">
  <p class="tt-summary">
    Đã thêm {result.added.length} · Bỏ qua {result.skipped.length}
  </p>

  {#if groups.length}
    <ul>
      {#each groups as [code, count] (code)}
        <li data-tt-code={code}>
          <code>{code}</code>
          <span>{MESSAGES[code] ?? 'Đã bỏ qua'}</span>
          {#if count > 1}<span class="tt-count">×{count}</span>{/if}
        </li>
      {/each}
    </ul>
  {/if}

  <button class="tt-dismiss" onclick={ondismiss} data-testid="tt-toast-dismiss">Đóng</button>
</div>

<style>
  .tt-toast {
    display: grid;
    gap: 0.4rem;
    max-width: 26rem;
    padding: 0.7rem 0.9rem;
    font-size: 0.8rem;
    background: var(--color-tt-surface);
    border: 1px solid var(--color-tt-line);
    border-radius: 0.5rem;
  }
  .tt-summary {
    color: var(--color-tt-text);
    font-weight: 500;
  }
  ul {
    display: grid;
    gap: 0.2rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    color: var(--color-tt-warn);
  }
  code {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--color-tt-muted);
  }
  .tt-count {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
  }
  .tt-dismiss {
    justify-self: end;
    padding: 0.15rem 0.6rem;
    color: var(--color-tt-signal);
    background: transparent;
    border: 1px solid var(--color-tt-line);
    border-radius: 0.25rem;
  }
</style>
