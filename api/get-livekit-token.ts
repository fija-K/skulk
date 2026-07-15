import { AccessToken } from 'livekit-server-sdk';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const room = req.query.room || req.body?.room;
  const identity = req.query.identity || req.body?.identity;
  const name = req.query.name || req.body?.name;

  if (!room || !identity) {
    return res.status(400).json({ error: 'room and identity are required' });
  }

  const apiKey = process.env.LIVEKIT_API_KEY || 'APIRBZfhkjwCboR';
  const apiSecret = process.env.LIVEKIT_API_SECRET || 'YH50Q9Rz3DQKbIBYPSV5kte8IwtqZCj9BuXen0jsFcJ';

  try {
    const at = new AccessToken(apiKey, apiSecret, {
      identity: String(identity),
      name: name ? String(name) : undefined,
    });

    at.addGrant({ roomJoin: true, room: String(room) });

    const token = await at.toJwt();
    res.status(200).json({ token });
  } catch (error) {
    console.error('Failed to generate token:', error);
    res.status(500).json({ error: 'Failed to generate token' });
  }
}
