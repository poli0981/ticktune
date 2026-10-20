/**
 * Build and preview the spike harnesses — docs/15.
 *
 *   pnpm spikes      → http://localhost:4330/spike/<slug>/
 *
 * The harnesses are routed only by `astro dev` or by a build with TT_SPIKES=1,
 * and that build goes to dist-spikes/ — never to the dist/ that CI tests and
 * deploy.yml ships (ttSpikeRoutes in astro.config.mjs). The flag is set here, in
 * the process, rather than on a command line: `TT_SPIKES=1 astro build` is not
 * PowerShell, and the dev box runs PowerShell.
 *
 * `astro dev` serves them too, with HMR, and is the right tool while editing a
 * harness. Use this when the measurement needs a production build — minified,
 * hashed, with no dev-server middleware between the page and the media.
 */
import { build, preview } from 'astro';

const PORT = 4330;

process.env['TT_SPIKES'] = '1';

await build({ root: process.cwd(), logLevel: 'warn' });
const server = await preview({ root: process.cwd(), logLevel: 'warn', server: { port: PORT } });
console.log(`spikes: http://localhost:${server.port}/spike/ — Ctrl+C to stop`);
