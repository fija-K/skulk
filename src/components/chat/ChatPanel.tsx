import React, { useState, useEffect, useRef } from 'react';
import type { ChatMessage, Participant } from '../../App';

interface ChatPanelProps {
  chatMessages: ChatMessage[];
  systemMessages: any[];
  callParticipants: Participant[];
  sendChatMessage: (text: string) => Promise<void>;
  callTab: string;
}

export function ChatPanel({
  chatMessages,
  systemMessages,
  callParticipants,
  sendChatMessage,
  callTab
}: ChatPanelProps) {
  const [chatMessageText, setChatMessageText] = useState('');
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll chat to bottom
  const prevMessagesLengthRef = useRef(0);
  const prevTabRef = useRef<string | null>(null);

  useEffect(() => {
    const currentLength = chatMessages.length + systemMessages.length;
    const prevLength = prevMessagesLengthRef.current;
    
    if (callTab === 'chat' && chatEndRef.current) {
      const container = chatEndRef.current.parentElement;
      if (container) {
        const isTabSwitch = prevTabRef.current !== 'chat' && prevTabRef.current !== null;
        const isNewMessage = currentLength > prevLength && prevLength > 0;
        
        if (isTabSwitch || prevLength === 0) {
          setTimeout(() => {
            chatEndRef.current?.scrollIntoView({ behavior: 'auto' });
          }, 50);
        } else if (isNewMessage) {
          const threshold = 150;
          const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
          if (isNearBottom) {
            chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
          }
        }
      }
    }
    
    prevTabRef.current = callTab;
    prevMessagesLengthRef.current = currentLength;
  }, [chatMessages, systemMessages, callTab]);

  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessageText.trim()) return;
    await sendChatMessage(chatMessageText);
    setChatMessageText('');
  };

  return (
    <>
      <div className="chat-messages-list">
        {(() => {
          const combined = [
            ...chatMessages.map(m => ({ ...m, type: 'chat' as const })),
            ...systemMessages.map(m => ({ ...m, type: 'system' as const }))
          ].sort((a, b) => {
            const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return timeA - timeB;
          });

          return combined.map((msg) => {
            if (msg.type === 'system') {
              return (
                <div 
                  key={msg.id} 
                  className="chat-message-item chat-system-message animate-fade-in" 
                  style={{ 
                    textAlign: 'center', 
                    padding: '8px 12px', 
                    color: 'var(--text-secondary, #94a3b8)', 
                    fontSize: '11px',
                    fontStyle: 'italic',
                    opacity: 0.8,
                    borderBottom: '1px solid rgba(255,255,255,0.02)'
                  }}
                >
                  {msg.text}
                </div>
              );
            }

            const role = msg.senderRole || (callParticipants.find(p => p.id === msg.senderId || p.name === msg.sender)?.role) || 'member';
            return (
              <div key={msg.id} className="chat-message-item animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '3px', padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span className="chat-sender" style={{ fontWeight: 700, fontSize: '13px' }}>{msg.sender}</span>
                  {role && role !== 'member' && (
                    <span className={`role-badge-${role}`} style={{
                      fontSize: '8px',
                      fontWeight: 'bold',
                      padding: '1px 4px',
                      borderRadius: '3px',
                      border: '1px solid',
                      textTransform: 'uppercase',
                      lineHeight: '1.2',
                      ...role === 'admin' ? {
                        backgroundColor: 'rgba(241, 196, 15, 0.15)',
                        borderColor: 'var(--primary-color, #f1c40f)',
                        color: 'var(--primary-color, #f1c40f)'
                      } : role === 'host' ? {
                        backgroundColor: 'rgba(59, 130, 246, 0.15)',
                        borderColor: '#3b82f6',
                        color: '#3b82f6'
                      } : {
                        backgroundColor: 'rgba(16, 185, 129, 0.15)',
                        borderColor: '#10b981',
                        color: '#10b981'
                      }
                    }}>
                      {role === 'admin' ? '👑 Admin' : role === 'host' ? '⭐ Host' : '🛡️ Co-host'}
                    </span>
                  )}
                </div>
                <span className="chat-text" style={{ fontSize: '13px', color: 'var(--text-secondary, #94a3b8)', marginTop: '2px', wordBreak: 'break-word' }}>{msg.text}</span>
              </div>
            );
          });
        })()}
        <div ref={chatEndRef} />
      </div>
      
      <form onSubmit={handleSendChatMessage} className="chat-input-form">
        <input 
          type="text" 
          placeholder="Message the room..." 
          className="search-input"
          style={{ paddingLeft: '14px', fontSize: '13px' }}
          value={chatMessageText}
          onChange={(e) => setChatMessageText(e.target.value)}
          required
        />
        <button type="submit" className="btn-signin" style={{ padding: '8px 12px' }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </form>
    </>
  );
}
