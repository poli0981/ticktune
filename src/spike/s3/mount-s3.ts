import { mount } from 'svelte';
import TtS3Metadata from './TtS3Metadata.svelte';

// Same hand-mount as the app island (docs/01 §3) — the gate guard in the page
// decides whether this module is ever fetched.
const target = document.getElementById('tt-spike');
if (target) mount(TtS3Metadata, { target });
