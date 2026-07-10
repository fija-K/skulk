import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;

  if (twilioSid && twilioAuthToken) {
    try {
      const auth = Buffer.from(`${twilioSid}:${twilioAuthToken}`).toString('base64');
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Tokens.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        return res.status(200).json({ iceServers: data.ice_servers });
      } else {
        const errorText = await response.text();
        console.warn('Twilio Token generation failed:', errorText);
      }
    } catch (err) {
      console.error('Error fetching Twilio TURN credentials:', err);
    }
  }

  const xirsysChannel = process.env.XIRSYS_CHANNEL;
  const xirsysSecret = process.env.XIRSYS_SECRET;
  const xirsysUser = process.env.XIRSYS_USER;

  if (xirsysChannel && xirsysSecret && xirsysUser) {
    try {
      const auth = Buffer.from(`${xirsysUser}:${xirsysSecret}`).toString('base64');
      const response = await fetch('https://global.xirsys.net/_turn/' + xirsysChannel, {
        method: 'PUT',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.v && data.v.iceServers) {
          return res.status(200).json({ iceServers: data.v.iceServers });
        }
      }
    } catch (err) {
      console.error('Error fetching Xirsys TURN credentials:', err);
    }
  }

  // If no credentials configured, return a default list of public STUN servers
  return res.status(200).json({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
    ],
    warning: 'No Twilio or Xirsys environment variables found on serverless runtime. Please add them to your Vercel project configuration.'
  });
}
