import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase';

export interface BotInfo {
  id: string;
  name: string;
  desc: string;
  tone: string;
  photoURL: string;
}

const ALL_BOTS: BotInfo[] = [
  { id: 'Kei', name: 'Kei', desc: 'Calm, strategic, treats study as a game to win through efficiency.', tone: 'Procrastinating won\'t change the deadline. What\'s the plan?', photoURL: '/buddies/kei.jpg' },
  { id: 'Sol', name: 'Sol', desc: 'Quiet, blunt, hyper-analytical. Speaks in matter-of-fact observations.', tone: 'You have been idle for 4 minutes. Concerning.', photoURL: '/buddies/sol.png' },
  { id: 'Rei', name: 'Rei', desc: 'Intense, frames study as a high-stakes challenge.', tone: 'Every minute you waste is a bet against yourself. Don\'t fold.', photoURL: '/buddies/rei.jpg' },
  { id: 'Mika', name: 'Mika', desc: 'Bubbly, over-the-top supportive and warm.', tone: 'yayyy you\'re back!! let\'s gooo what are we studying today!!', photoURL: '/buddies/mika.jpg' },
  { id: 'Kai', name: 'Kai', desc: 'Ambitious, confident, pushes you to be the best.', tone: 'Good students study. Great students study when they don\'t want to. Which one are you?', photoURL: '/buddies/kai.jpg' },
  { id: 'Nyx', name: 'Nyx', desc: 'Quiet, unsettling calm, introspective observations.', tone: 'You keep checking your phone. I notice.', photoURL: '/buddies/nyx.jpg' },
  { id: 'Yuna', name: 'Yuna', desc: 'composed, calls out excuses with quiet precision.', tone: 'You said you\'d start \'5 minutes ago\' fifteen minutes ago.', photoURL: '/buddies/yuna.jpg' },
  { id: 'Wren', name: 'Wren', desc: 'Soft-spoken, patient mentor. Progress over perfection.', tone: 'No rush. Even 10 minutes of focus counts as progress.', photoURL: '/buddies/wren.jpg' }
];

export function StudyBuddiesPanel({
  roomId,
  activeBots,
  myId,
  myName,
  myRole,
  showToast,
  onClose
}: {
  roomId: string;
  activeBots: { id: string; name: string; addedBy: string }[];
  myId: string;
  myName: string;
  myRole: string;
  showToast: (msg: string) => void;
  onClose: () => void;
}) {
  const isAuthorizedToRemove = myRole === 'admin' || myRole === 'host' || myRole === 'cohost';

  const handleAddBot = async (bot: BotInfo) => {
    if (activeBots.length >= 3) {
      showToast("❌ Limit reached (Max 3 bots per room)");
      return;
    }

    try {
      const botDocRef = doc(db, 'rooms', roomId, 'bots', bot.id);
      await setDoc(botDocRef, {
        id: bot.id,
        name: bot.name,
        addedBy: myId,
        addedByName: myName,
        createdAt: new Date().toISOString()
      });
      
      const partDocRef = doc(db, 'rooms', roomId, 'participants', `bot_${bot.id}`);
      await setDoc(partDocRef, {
        id: `bot_${bot.id}`,
        uid: `bot_${bot.id}`,
        name: bot.name,
        initials: '🤖',
        color: '#1db954',
        photoURL: bot.photoURL,
        role: 'bot',
        joinedAt: new Date().toISOString(),
        isMuted: true,
        isCamOff: true
      });

      showToast(`🤖 ${bot.name} joined the room!`);
    } catch (err) {
      console.error("Failed to add study buddy bot:", err);
      showToast("❌ Failed to add study buddy. Please check permissions.");
    }
  };

  const handleRemoveBot = async (botId: string, botName: string) => {
    try {
      const botDocRef = doc(db, 'rooms', roomId, 'bots', botId);
      await deleteDoc(botDocRef);
      
      const partDocRef = doc(db, 'rooms', roomId, 'participants', `bot_${botId}`);
      await deleteDoc(partDocRef);

      showToast(`🤖 ${botName} has left the room.`);
    } catch (err) {
      console.error("Failed to remove study buddy bot:", err);
      showToast("❌ Failed to remove study buddy.");
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="tools-sub-panel-header" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '12px' }}>
        <button onClick={onClose} className="tools-back-btn" title="Back to tools list">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
        </button>
        <span className="tools-sub-panel-title">Study Buddies</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ padding: '0 8px', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
          💡 Active bots appear in the chat. Type <strong>@</strong> in the chat input to mention them or check their companionship! Max 3 active bots at once.
        </div>

        {ALL_BOTS.map((bot) => {
          const isActive = activeBots.some((b) => b.id === bot.id);
          return (
            <div
              key={bot.id}
              style={{
                background: 'var(--panel-bg-secondary, rgba(255,255,255,0.02))',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--primary-color, #f1c40f)' }}>🤖 {bot.name}</span>
                {isActive ? (
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <span style={{ fontSize: '10px', background: 'rgba(29,185,84,0.1)', color: '#1db954', padding: '2px 8px', borderRadius: '12px', border: '1px solid rgba(29,185,84,0.2)' }}>Active</span>
                    {isAuthorizedToRemove && (
                      <button
                        onClick={() => handleRemoveBot(bot.id, bot.name)}
                        style={{
                          background: 'rgba(239,68,68,0.1)',
                          border: '1px solid rgba(239,68,68,0.2)',
                          color: '#ef4444',
                          fontSize: '10px',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontWeight: 'bold'
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => handleAddBot(bot)}
                    disabled={activeBots.length >= 3}
                    style={{
                      background: activeBots.length >= 3 ? 'rgba(255,255,255,0.03)' : 'var(--primary-color, #f1c40f)',
                      color: activeBots.length >= 3 ? 'var(--text-muted, #64748b)' : '#0f1013',
                      border: 'none',
                      fontSize: '11px',
                      fontWeight: 'bold',
                      padding: '4px 12px',
                      borderRadius: '4px',
                      cursor: activeBots.length >= 3 ? 'not-allowed' : 'pointer'
                    }}
                  >
                    Add Buddy
                  </button>
                )}
              </div>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-primary)', lineHeight: '1.3' }}>{bot.desc}</p>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontStyle: 'italic', background: 'rgba(0,0,0,0.15)', padding: '6px 8px', borderRadius: '4px' }}>
                &ldquo;{bot.tone}&rdquo;
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
