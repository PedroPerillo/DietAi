// Local/dev server. Kept out of the project root so Vercel never mistakes it for an
// app entry point; on Vercel, api/index.mjs serves the API instead.
import { aiEnabled, MODEL } from '../lib/ai.mjs';
import { PROVIDERS } from '../lib/stores/index.mjs';
import { createServer } from '../lib/http.mjs';

const port = Number(process.env.PORT) || 3000;
// Loopback by default; set HOST=0.0.0.0 to expose it (e.g. in a container).
const host = process.env.HOST || '127.0.0.1';
createServer().listen(port, host, () => {
  console.log(`FitBite on http://${host}:${port}  (AI: ${aiEnabled() ? MODEL : 'off'}, Instacart: ${PROVIDERS.instacart.ready() ? 'on' : 'off'})`);
});
