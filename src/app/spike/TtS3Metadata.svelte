<script lang="ts">
  import { parseBlob } from 'music-metadata';

  /**
   * Spike S3 harness — docs/15 §S3, feeding docs/05 §4-5.
   *
   * Answers three questions the corpus alone cannot:
   *   1. do Vietnamese tags survive v2.3 UTF-16 / v2.4 UTF-8 / Vorbis / MP4?
   *   2. does ID3v1-only produce U+FFFD, so TT-IMP-007's filename fallback fires?
   *   3. does a 95-file batch parse in under 10 s on the dev box?
   *
   * Deliberately parses in the browser, via the same `parseBlob` entry point the
   * importer will use (docs/05 §5) — a Node-side check would not exercise the
   * same code path or the same File semantics.
   */

  interface Row {
    name: string;
    sizeKb: number;
    ms: number;
    title: string | null;
    artist: string | null;
    codec: string | null;
    container: string | null;
    durationS: number | null;
    bitrateKbps: number | null;
    sampleRate: number | null;
    channels: number | null;
    coverBytes: number | null;
    /** Which tag containers were present, e.g. ['ID3v1'] or ['ID3v2.4']. */
    tagTypes: string[];
    /** docs/05 §5's rule: decoded string contains U+FFFD. */
    mojibake: boolean;
    /**
     * Candidate replacement rule. ID3v1 carries NO charset field, so any byte
     * >= 0x80 in an ID3v1-only tag was written in some unknown 8-bit encoding
     * and cannot be trusted — regardless of whether it decoded "cleanly".
     */
    id3v1Unreliable: boolean;
    error: string | null;
  }

  let rows = $state<Row[]>([]);
  let busy = $state(false);
  let totalMs = $state(0);
  let progress = $state('');

  const hasReplacementChar = (s: string | null | undefined) => !!s && s.includes('�');

  async function handle(files: FileList | null) {
    if (!files?.length) return;
    busy = true;
    rows = [];
    progress = '';
    const started = performance.now();
    const out: Row[] = [];

    // Sequential, like the real importer (docs/02 §4 "batch processed
    // sequentially") — parsing 95 files in parallel would measure something the
    // app will never do.
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      progress = `${i + 1} / ${files.length}`;
      const t0 = performance.now();
      const row: Row = {
        name: f.name,
        sizeKb: Math.round(f.size / 1024),
        ms: 0,
        title: null,
        artist: null,
        codec: null,
        container: null,
        durationS: null,
        bitrateKbps: null,
        sampleRate: null,
        channels: null,
        coverBytes: null,
        tagTypes: [],
        mojibake: false,
        id3v1Unreliable: false,
        error: null,
      };
      try {
        const m = await parseBlob(f);
        row.title = m.common.title ?? null;
        row.artist = m.common.artist ?? null;
        row.codec = m.format.codec ?? null;
        row.container = m.format.container ?? null;
        row.durationS = m.format.duration ?? null;
        row.bitrateKbps = m.format.bitrate ? Math.round(m.format.bitrate / 1000) : null;
        row.sampleRate = m.format.sampleRate ?? null;
        row.channels = m.format.numberOfChannels ?? null;
        row.coverBytes = m.common.picture?.[0]?.data.length ?? null;
        row.tagTypes = m.format.tagTypes ? [...m.format.tagTypes] : [];
        row.mojibake = hasReplacementChar(row.title) || hasReplacementChar(row.artist);
        const onlyV1 = row.tagTypes.length > 0 && row.tagTypes.every((t) => t === 'ID3v1');
        const nonAscii = (v: string | null) => !!v && [...v].some((c) => c.codePointAt(0)! > 0x7f);
        row.id3v1Unreliable = onlyV1 && (nonAscii(row.title) || nonAscii(row.artist));
      } catch (e) {
        // docs/02 §4 step 5: parse failure is NOT import failure — the track is
        // kept with a file-name title (TT-IMP-006).
        row.error = e instanceof Error ? e.message : String(e);
      }
      row.ms = Math.round(performance.now() - t0);
      out.push(row);
      rows = [...out];
    }

    totalMs = Math.round(performance.now() - started);
    busy = false;
    progress = '';
  }

  const withCover = $derived(rows.filter((r) => r.coverBytes).length);
  const mojibakeCount = $derived(rows.filter((r) => r.mojibake).length);
  const v1Unreliable = $derived(rows.filter((r) => r.id3v1Unreliable).length);
  const failed = $derived(rows.filter((r) => r.error).length);

  async function copyReport() {
    await navigator.clipboard.writeText(
      JSON.stringify({ ua: navigator.userAgent, totalMs, count: rows.length, rows }, null, 2),
    );
  }
</script>

<section class="mx-auto max-w-5xl p-8 font-mono text-sm">
  <h1 class="mb-1 text-xl font-semibold">S3 — music-metadata coverage &amp; Vietnamese tags</h1>
  <p class="text-tt-muted mb-6 text-xs">
    docs/15 §S3 → docs/05 §4–5. Point this at <code>tests/e2e/fixtures/</code> for the tag matrix,
    then at <code>test/test_playlist/</code> (95+ files) for the batch-timing criterion.
  </p>

  <label class="tt-drop">
    <input
      type="file"
      multiple
      accept="audio/*,.mp3,.m4a,.aac,.flac,.wav,.ogg,.oga,.opus,.webm,.aiff,.aif,.alac,.ac3"
      disabled={busy}
      onchange={(e) => handle((e.currentTarget as HTMLInputElement).files)}
    />
    <span>{busy ? `parsing ${progress}…` : 'Choose audio files'}</span>
  </label>

  {#if rows.length}
    <div class="border-tt-line mt-6 mb-4 flex flex-wrap gap-6 border-y py-3">
      <span>files <strong>{rows.length}</strong></span>
      <span>total <strong>{totalMs} ms</strong></span>
      <span>avg <strong>{Math.round(totalMs / rows.length)} ms</strong></span>
      <span>cover art <strong>{withCover}</strong></span>
      <span>U+FFFD <strong>{mojibakeCount}</strong></span>
      <span class:bad={v1Unreliable > 0}>ID3v1 unreliable <strong>{v1Unreliable}</strong></span>
      <span class:bad={failed > 0}>parse failed <strong>{failed}</strong></span>
      <span class:bad={rows.length >= 95 && totalMs > 10_000}>
        {rows.length >= 95
          ? totalMs <= 10_000
            ? '✓ 95-file batch < 10 s'
            : '✗ batch over 10 s'
          : ''}
      </span>
      <button class="ml-auto underline" onclick={copyReport}>copy JSON</button>
    </div>

    <table class="w-full text-xs">
      <thead class="text-tt-muted text-left">
        <tr>
          <th>file</th><th>title</th><th>tags</th><th>container/codec</th>
          <th class="text-right">dur</th><th class="text-right">kbps</th>
          <th class="text-right">cover</th><th class="text-right">ms</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.name)}
          <tr class="border-tt-line border-t align-top" class:bad={r.mojibake || r.error}>
            <td class="pr-2">{r.name}</td>
            <td class="pr-2">
              {r.title ?? '—'}{r.mojibake ? '  ⚠U+FFFD' : ''}{r.id3v1Unreliable
                ? '  ⚠v1-unreliable'
                : ''}
            </td>
            <td class="pr-2">{r.tagTypes.join(',') || '—'}</td>
            <td class="pr-2">{r.container ?? '—'} / {r.codec ?? '—'}</td>
            <td class="text-right">{r.durationS ? r.durationS.toFixed(1) : '–'}</td>
            <td class="text-right">{r.bitrateKbps ?? '–'}</td>
            <td class="text-right">{r.coverBytes ? `${Math.round(r.coverBytes / 1024)}k` : '–'}</td>
            <td class="text-right">{r.ms}</td>
          </tr>
          {#if r.error}
            <tr class="bad"><td colspan="8" class="pb-1 pl-4 text-xs">TT-IMP-006 {r.error}</td></tr>
          {/if}
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<style>
  .tt-drop {
    display: block;
    padding: 2rem;
    text-align: center;
    border: 1px dashed var(--color-tt-line);
    border-radius: 0.5rem;
    cursor: pointer;
  }
  .tt-drop:hover {
    border-color: var(--color-tt-signal);
  }
  .tt-drop input {
    display: block;
    margin: 0 auto 0.75rem;
  }
  .bad {
    color: var(--color-tt-danger);
  }
  th,
  td {
    padding-block: 0.25rem;
  }
</style>
