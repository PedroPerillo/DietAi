// Vercel serverless entry: all /api/* requests are rewritten here (see vercel.json).
// Static files in public/ are served by Vercel's CDN, not this function.
import { createHandler } from '../lib/http.mjs';

export default createHandler();
