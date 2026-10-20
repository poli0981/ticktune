import { mount } from 'svelte';
import TtS5Notify from './TtS5Notify.svelte';

// Same hand-mount as the app island (docs/01 §3) — the gate guard in the page
// decides whether this module is ever fetched.
const target = document.getElementById('tt-spike');
if (target) mount(TtS5Notify, { target });
