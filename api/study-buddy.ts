import type { VercelRequest, VercelResponse } from '@vercel/node';
import { generateText } from './lib/ai.js';

const BOT_PROMPTS: Record<string, string> = {
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { botId, message, chatHistory } = req.body || {};

  if (!botId || !message) {
    return res.status(400).json({ error: 'botId and message are required' });
  }

  const prompt = BOT_PROMPTS[botId];
  if (!prompt) {
    return res.status(400).json({ error: `Bot ${botId} not found` });
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!geminiKey && !openaiKey) {
    return res.status(401).json({ error: 'LLM credentials not configured. Please define GEMINI_API_KEY or OPENAI_API_KEY.' });
  }

  try {
    if (geminiKey) {
      let promptText = `${prompt}\n\n`;
      if (chatHistory && Array.isArray(chatHistory)) {
        const recent = chatHistory.slice(-10);
        promptText += "Recent Chat History:\n";
        for (const msg of recent) {
          const sender = msg.senderRole === 'bot' ? botId : msg.sender;
          promptText += `${sender}: ${msg.text}\n`;
        }
        promptText += "\n";
      }
      promptText += `New Message from User: ${message}\n`;
      promptText += `Response from ${botId}:`;

      const reply = await generateText(promptText);
      return res.status(200).json({ reply });
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

      const json = await response.json();
      const reply = json.choices?.[0]?.message?.content || "I'm busy studying. Let's focus.";
      return res.status(200).json({ reply: reply.trim() });
    }
  } catch (error: any) {
    console.error('Study Buddy generation failed:', error);
    const messageStr = error.message || '';
    const status = error.status;

    if (messageStr.includes('MISSING_API_KEY')) {
      return res.status(401).json({ error: 'API key is missing in server environment variables.', details: messageStr });
    }
    if (messageStr.includes('INVALID_API_KEY') || status === 401 || status === 403 || messageStr.includes('API_KEY_INVALID')) {
      return res.status(403).json({ error: 'The provided API key is invalid or unauthorized.', details: messageStr });
    }
    if (status === 429 || messageStr.includes('429') || messageStr.includes('Quota exceeded') || messageStr.includes('RESOURCE_EXHAUSTED')) {
      return res.status(429).json({ error: 'Rate limit or API quota exceeded. Please try again later.', details: messageStr });
    }
    if (messageStr.includes('NO_COMPATIBLE_MODELS') || messageStr.includes('NO_MODELS_DISCOVERED') || status === 503) {
      return res.status(503).json({ error: 'No compatible or stable Gemini models are currently available.', details: messageStr });
    }
    if (status === 400 || messageStr.includes('400') || messageStr.includes('INVALID_ARGUMENT')) {
      return res.status(400).json({ error: 'Invalid request or prompt structure sent to the AI model.', details: messageStr });
    }

    return res.status(500).json({ error: 'An unexpected internal server error occurred during response generation.', details: messageStr });
  }
}
