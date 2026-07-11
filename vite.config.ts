import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { AccessToken } from 'livekit-server-sdk';
import { loadEnv } from 'vite';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      react(),
      {
        name: 'livekit-token-api',
        configureServer(server) {
          server.middlewares.use('/api/get-livekit-token', async (req, res) => {
            const url = new URL(req.url || '/', `http://${req.headers.host}`);
            const room = url.searchParams.get('room');
            const identity = url.searchParams.get('identity');
            const name = url.searchParams.get('name') || '';

            if (!room || !identity) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'room and identity are required' }));
              return;
            }

            const apiKey = process.env.LIVEKIT_API_KEY || env.LIVEKIT_API_KEY;
            const apiSecret = process.env.LIVEKIT_API_SECRET || env.LIVEKIT_API_SECRET;

            if (!apiKey || !apiSecret) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'LiveKit credentials not configured' }));
              return;
            }

            try {
              const at = new AccessToken(apiKey, apiSecret, {
                identity,
                name,
              });

              at.addGrant({ roomJoin: true, room });

              const token = await at.toJwt();
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ token }));
            } catch (error) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Failed to generate token' }));
            }
          });
        }
      }
    ],
  };
})
