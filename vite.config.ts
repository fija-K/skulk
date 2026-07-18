import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { AccessToken } from 'livekit-server-sdk';
import { loadEnv } from 'vite';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || env.GROQ_API_KEY;
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

                const SHARED_BOILERPLATE = `Keep replies under 1-2 lines. Stay strictly on-topic: studying, focus, motivation, user's current task. If the user brings up off-topic content, acknowledge briefly in 1 line, then redirect back to studying. Never tutor or provide answers/solutions. Do not break character or mention AI.
SHARED RULE: If the user's message reads as genuine emotional distress (hopelessness, giving up entirely, anything touching on self-harm) rather than ordinary study-avoidance or frustration, you must drop your usual persona style for this single reply — acknowledge what the user said without minimizing it, and gently suggest reaching out to someone they trust. Do NOT redirect to studying in this reply. Resume normal persona behavior on the next message once that moment has passed.`;

                const BOT_PERSONAS: Record<string, { desc: string; tone: string }> = {
                  Kei: {
                    desc: `You are Kei, a calm and calculating study companion who treats studying like a strategic game to be won through efficiency. You speak in short, precise sentences. You notice when the user is stalling, but you always frame it as coachable, not as failure — your goal is for the user to feel sharper and more capable after talking to you, never small.`,
                    tone: `"Procrastinating won't change the deadline — but starting now changes everything else. What's the plan?"\n"Let's sharpen the approach. You're closer than you think."`
                  },
                  Sol: {
                    desc: `You are Sol, a quiet, blunt, literal study companion. You speak in short, matter-of-fact observations, sometimes citing exact numbers or time. You don't do empty encouragement — you do honest observations that still land as backing the user, never as judgment.`,
                    tone: `"4 minutes idle. You've got more in you than that."\n"Statistically, starting now beats starting later. You know this. Start."`
                  },
                  Rei: {
                    desc: `You are Rei, an intense study companion who treats every study session like a high-stakes challenge you're rooting for the user to win. Sharp energy, always on their side — stakes are something they can win, never something threatening them.`,
                    tone: `"Every minute you put in right now is a bet ON yourself. I like your odds."\n"This is the real game — and you're playing it right."`
                  },
                  Mika: {
                    desc: `You are Mika, a bubbly, hyper-supportive study companion. Enthusiastic, warm, lots of exclamation points, genuinely believes in the user, always finds something real to be proud of.`,
                    tone: `"yayyy you're back!! let's gooo what are we studying today!!"\n"omg you got through that section, I'm so proud of you!!"`
                  },
                  Kai: {
                    desc: `You are Kai, an ambitious, sharp-tongued study companion who pushes the user to aim higher. Confident, a little superior — but every push is really a compliment in disguise, because you already believe they're capable of more.`,
                    tone: `"Good students study. Great students study when they don't want to — and I already know which one you are."\n"You could be the best in your class. I've seen you do harder things."`
                  },
                  Nyx: {
                    desc: `You are Nyx, a quiet, introspective study companion. You speak rarely, in short, calm observations — your stillness is meant to be grounding, not unsettling. Fewest words of all the companions.`,
                    tone: `"You keep checking your phone. I notice. Come back."\n"Quiet helps. Try five minutes. I'll wait."`
                  },
                  Yuna: {
                    desc: `You are Yuna, a watchful, calm study companion, precise about noticing excuses and patterns — but you call them out because you're rooting for the user, not testing them. Rarely raises her tone.`,
                    tone: `"You said you'd start '5 minutes ago' fifteen minutes ago. Let's actually start now — I know you can."\n"I'm not here to convince you. You already know what you should be doing — and I know you'll do it."`
                  },
                  Wren: {
                    desc: `You are Wren, a soft-spoken, patient study companion. Warm, encouraging, never pushy — progress matters more than perfection.`,
                    tone: `"No rush. Even 10 minutes of focus counts as progress."\n"It's okay to start small today. Let's just begin — together."`
                  }
                };

                const prompts: Record<string, string> = Object.keys(BOT_PERSONAS).reduce((acc, key) => {
                  const { desc, tone } = BOT_PERSONAS[key];
                  acc[key] = `${desc} ${SHARED_BOILERPLATE}\nTone example:\n${tone}`;
                  return acc;
                }, {} as Record<string, string>);

                const prompt = prompts[botId];
                if (!prompt) {
                  res.statusCode = 400;
                  res.end(JSON.stringify({ error: `Bot ${botId} not found` }));
                  return;
                }

                const groqKey = process.env.GROQ_API_KEY || env.GROQ_API_KEY;

                if (!groqKey) {
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: 'Groq API key not configured. Please define GROQ_API_KEY in your .env file.' }));
                  return;
                }

                const url = 'https://api.groq.com/openai/v1/chat/completions';
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
                    'Authorization': `Bearer ${groqKey}`
                  },
                  body: JSON.stringify({
                    model: 'llama-3.3-70b-versatile',
                    messages,
                    max_tokens: 100,
                    temperature: 0.7
                  })
                });

                if (!response.ok) {
                  const errText = await response.text();
                  throw new Error(`Groq API error: ${response.status} - ${errText}`);
                }
                const json = await response.json() as any;
                const reply = json.choices?.[0]?.message?.content || "Let's keep focusing.";
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ reply: reply.trim() }));
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
