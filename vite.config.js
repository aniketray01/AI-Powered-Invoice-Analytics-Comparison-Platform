import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

function openAiDevProxyPlugin() {
  return {
    name: 'openai-dev-proxy',
    configureServer(server) {
      // Handle browser -> local proxy -> OpenAI. This avoids CORS issues and keeps the API key off the client.
      server.middlewares.use('/api/openai', async (req, res, next) => {
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }

        if (req.method !== 'POST') {
          next();
          return;
        }

        // Vite injects env via loadEnv in the outer config scope, so we read from process.env.
        const apiKey = process.env.VITE_OPENAI_KEY || '';
        if (!apiKey) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: { message: 'Missing VITE_OPENAI_KEY. Set it in .env.local and restart dev server.' } }));
          return;
        }

        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const rawBody = Buffer.concat(chunks).toString('utf8');
          const jsonBody = rawBody ? JSON.parse(rawBody) : {};

          // req.url example: "/chat/completions"
          const openAiPath = (req.url || '').replace(/^\//, '');
          const targetUrl = `https://api.openai.com/v1/${openAiPath}`;

          const upstreamResp = await fetch(targetUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(jsonBody),
          });

          const text = await upstreamResp.text();
          res.statusCode = upstreamResp.status;
          res.setHeader('Content-Type', upstreamResp.headers.get('content-type') || 'application/json');
          res.end(text);
        } catch (e) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: { message: e?.message || 'Proxy error' } }));
        }
      });
    }
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Make sure env is available to the proxy middleware.
  const env = loadEnv(mode, process.cwd(), '');
  process.env.VITE_OPENAI_KEY = env.VITE_OPENAI_KEY || process.env.VITE_OPENAI_KEY || '';

  return {
    plugins: [react(), openAiDevProxyPlugin()],
  };
});
