// Vercel serverless entry: all /api/* requests are rewritten here (see vercel.json).
// Static files in public/ are served by Vercel's CDN, not this function.
import { createHandler } from '../server.mjs';

export default createHandler();
