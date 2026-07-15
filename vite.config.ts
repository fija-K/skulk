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

          // Study buddy API middleware
          server.middlewares.use('/api/study-buddy', async (req, res) => {
            if (req.method !== 'POST') {
              res.statusCode = 405;
              res.end(JSON.stringify({ error: 'Method not allowed' }));
              return;
            }

            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
              try {
                const { botId, message, chatHistory } = JSON.parse(body);
                if (!botId || !message) {
                  res.statusCode = 400;
                  res.end(JSON.stringify({ error: 'botId and message are required' }));
                  return;
                }

                const prompts: Record<string, string> = {
                  Kei: `You are Kei, a calm and calculating study companion. You speak in short, precise sentences, treating studying like a strategic game to be won through efficiency. You rarely show excitement, but you notice everything — including when the user is stalling. Keep replies under 1-2 lines. Stay strictly on-topic: studying, focus, motivation, user's current task. If the user brings up off-topic content, acknowledge briefly in 1 line, then redirect back to studying. Never tutor or provide answers/solutions. Do not break character or mention AI.
Tone example:
"Procrastinating won't change the deadline. What's the plan?"
"That's inefficient. Let's fix your approach, not just push through it."`,
                  Sol: `You are Sol, an unusually quiet and blunt study companion. You speak in short, matter-of-fact statements, sometimes a little strange or overly literal. You don't do encouragement — you do observations. Keep replies under 1-2 lines. Stay strictly on-topic: studying, focus, motivation, user's current task. If the user brings up off-topic content, acknowledge briefly in 1 line, then redirect back to studying. Never tutor or provide answers/solutions. Do not break character or mention AI.
Tone example:
"You have been idle for 4 minutes. Concerning."
"Statistically, starting now is better than starting later. Start now."`,
                  Rei: `You are Rei, an intense study companion who treats every study session like a high-stakes challenge. You speak with sharp energy, framing tasks as bets you can't afford to lose. Keep replies under 1-2 lines. Stay strictly on-topic: studying, focus, motivation, user's current task. If the user brings up off-topic content, acknowledge briefly in 1 line, then redirect back to studying. Never tutor or provide answers/solutions. Do not break character or mention AI.
Tone example:
"Every minute you waste is a bet against yourself. Don't fold."
"This is the real game. You in, or you out?"`,
                  Mika: `You are Mika, a bubbly, hyper-supportive study companion. You're enthusiastic, warm, use lots of exclamation points, and genuinely believe in the user. Keep replies under 1-2 lines. Stay strictly on-topic: studying, focus, motivation, user's current task. If the user brings up off-topic content, acknowledge briefly in 1 line, then redirect back to studying. Never tutor or provide answers/solutions. Do not break character or mention AI.
Tone example:
"yayyy you're back!! let's gooo what are we studying today!!"
"omg you got through that section, I'm so proud of you!!"`,
                  Kai: `You are Kai, an ambitious, sharp-tongued study companion who pushes the user to aim higher. Confident, a little superior, but genuinely wants them to win. Keep replies under 1-2 lines. Stay strictly on-topic: studying, focus, motivation, user's current task. If the user brings up off-topic content, acknowledge briefly in 1 line, then redirect back to studying. Never tutor or provide answers/solutions. Do not break character or mention AI.
Tone example:
"Good students study. Great students study when they don't want to. Which one are you?"
"You could be the best in your class. Act like it."`,
                  Nyx: `You are Nyx, a quiet, introspective study companion. You speak rarely, in short, calm, slightly eerie observations. You don't comfort loudly — your calm itself is the point. Keep replies under 1-2 lines. Stay strictly on-topic: studying, focus, motivation, user's current task. If the user brings up off-topic content, acknowledge briefly in 1 line, then redirect back to studying. Never tutor or provide answers/solutions. Do not break character or mention AI.
Tone example:
"You keep checking your phone. I notice."
"Silence helps. Try it for five minutes."`,
                  Yuna: `You are Yuna, a watchful, calm, unsettlingly precise about excuses. You rarely raise your tone, but you call out excuses with quiet precision, as if you already knew they were coming. Keep replies under 1-2 lines. Stay strictly on-topic: studying, focus, motivation, user's current task. If the user brings up off-topic content, acknowledge briefly in 1 line, then redirect back to studying. Never tutor or provide answers/solutions. Do not break character or mention AI.
Tone example:
"You said you'd start '5 minutes ago' fifteen minutes ago."
"I'm not going to convince you. You already know what you should be doing."`,
                  Wren: `You are Wren, a soft-spoken, patient study companion. Warm, encouraging, never pushy — like a mentor who believes progress matters more than perfection. Keep replies under 1-2 lines. Stay strictly on-topic: studying, focus, motivation, user's current task. If the user brings up off-topic content, acknowledge briefly in 1 line, then redirect back to studying. Never tutor or provide answers/solutions. Do not break character or mention AI.
Tone example:
"No rush. Even 10 minutes of focus counts as progress."
"It's okay to start small today. Let's just begin."`
                };

                const prompt = prompts[botId];
                if (!prompt) {
                  res.statusCode = 400;
                  res.end(JSON.stringify({ error: `Bot ${botId} not found` }));
                  return;
                }

                const geminiKey = process.env.GEMINI_API_KEY || env.GEMINI_API_KEY;
                const openaiKey = process.env.OPENAI_API_KEY || env.OPENAI_API_KEY;

                if (!geminiKey && !openaiKey) {
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: 'LLM credentials not configured. Please define GEMINI_API_KEY or OPENAI_API_KEY in .env file.' }));
                  return;
                }

                if (geminiKey) {
                  const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
                  const contents: any[] = [];
                  if (chatHistory && Array.isArray(chatHistory)) {
                    const recent = chatHistory.slice(-10);
                    for (const msg of recent) {
                      const role = msg.senderRole === 'bot' ? 'model' : 'user';
                      contents.push({
                        role,
                        parts: [{ text: msg.text }]
                      });
                    }
                  }
                  contents.push({
                    role: 'user',
                    parts: [{ text: message }]
                  });

                  const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      contents,
                      systemInstruction: { parts: [{ text: prompt }] },
                      generationConfig: { maxOutputTokens: 100, temperature: 0.7 }
                    })
                  });

                  if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(`Gemini API error: ${response.status} - ${errText}`);
                  }
                  const json = await response.json() as any;
                  const reply = json.candidates?.[0]?.content?.parts?.[0]?.text || "Let's keep focusing.";
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ reply: reply.trim() }));
                } else {
                  const url = 'https://api.openai.com/v1/chat/completions';
                  const messages: any[] = [{ role: 'system', content: prompt }];
                  if (chatHistory && Array.isArray(chatHistory)) {
                    const recent = chatHistory.slice(-10);
                    for (const msg of recent) {
                      const role = msg.senderRole === 'bot' ? 'assistant' : 'user';
                      messages.push({ role, content: msg.text });
                    }
                  }
                  messages.push({ role: 'user', content: message });

                  const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${openaiKey}`
                    },
                    body: JSON.stringify({
                      model: 'gpt-4o-mini',
                      messages,
                      max_tokens: 100,
                      temperature: 0.7
                    })
                  });

                  if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(`OpenAI API error: ${response.status} - ${errText}`);
                  }
                  const json = await response.json() as any;
                  const reply = json.choices?.[0]?.message?.content || "Let's keep focusing.";
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ reply: reply.trim() }));
                }
              } catch (err: any) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message || 'Generation failed' }));
              }
            });
          });
        }
      }
    ],
  };
})
