import React, { useState, useEffect, useRef } from 'react';
import type { ChatMessage, Participant } from '../../App';

interface ChatPanelProps {
  chatMessages: ChatMessage[];
  systemMessages: any[];
  callParticipants: Participant[];
  sendChatMessage: (text: string) => Promise<void>;
  callTab: string;
}

const POPULAR_EMOJIS = [
  '😀', '😂', '😍', '🥰', '😎', '😭', '😡', '😱', '👍', '👎', '👏', '🙌', '🎉', '🔥', '❤️', '💀', '🤔', '👀', '💯', '🚀', '🥳', '💡', '🎮', '🍕', '🍻', '✨', '👑', '⭐'
];

const DEFAULT_GIFS = [
  'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExM3h2Z2VlNDh0dW15cHlta3pxZHp5MGQyMWh5MTRoY3p1YW0zN2k3YSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/3NtY188QaxDdC/giphy.gif', // cat typing
  'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExMmNxMDZ3NnM1cW15ejR4YzN1aGpxZ2h5MTRoY3p1YW0zN2k3YSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/t3s3EZmJr7vwY/giphy.gif', // coding dog
  'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExM3ZleHprMG40dDN1aGpxZ2h5MTRoY3p1YW0zN2k3YSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/26uf3jBf9yBM1ZsFO/giphy.gif', // thumbs up
  'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExM3ZleHprMG40dDN1aGpxZ2h5MTRoY3p1YW0zN2k3YSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/l3q2Z6G1OE6mK0IOk/giphy.gif', // clapping
  'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExM3ZleHprMG40dDN1aGpxZ2h5MTRoY3p1YW0zN2k3YSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/9s73S0Jz2Z1lK/giphy.gif', // minion celebrate
  'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExM3ZleHprMG40dDN1aGpxZ2h5MTRoY3p1YW0zN2k3YSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/b09xElu8umMm4/giphy.gif', // dance cat
  'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExM3ZleHprMG40dDN1aGpxZ2h5MTRoY3p1YW0zN2k3YSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/13HgwGsXF0G6wU/giphy.gif', // yes nod
  'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExM3ZleHprMG40dDN1aGpxZ2h5MTRoY3p1YW0zN2k3YSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/d1E1msP6kmXCza6I/giphy.gif', // mind blown
  'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExM3ZleHprMG40dDN1aGpxZ2h5MTRoY3p1YW0zN2k3YSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/xT0xeJpD8e4DYnMGsw/giphy.gif' // facepalm
];

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

  // Pickers states
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [gifTab, setGifTab] = useState<'gifs' | 'stickers'>('gifs');
  const [gifQuery, setGifQuery] = useState('');
  const [gifs, setGifs] = useState<string[]>([]);
  const [loadingGifs, setLoadingGifs] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [activeExpandedImageUrl, setActiveExpandedImageUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  // Debounced Giphy search effect (GIFs or Stickers)
  useEffect(() => {
    if (!showGifPicker) return;
    const fetchGifs = async () => {
      setLoadingGifs(true);
      try {
        const query = gifQuery.trim() || 'trending';
        const type = gifTab === 'gifs' ? 'gifs' : 'stickers';
        const url = query === 'trending'
          ? `https://api.giphy.com/v1/${type}/trending?api_key=dc6zaTOxFJmzC&limit=12`
          : `https://api.giphy.com/v1/${type}/search?api_key=dc6zaTOxFJmzC&q=${encodeURIComponent(query)}&limit=12`;
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          const urls = json.data.map((item: any) => `https://i.giphy.com/${item.id}.gif`);
          setGifs(urls);
        } else {
          setGifs(DEFAULT_GIFS);
        }
      } catch (err) {
        console.warn("Failed to fetch Giphy media:", err);
        setGifs(DEFAULT_GIFS);
      } finally {
        setLoadingGifs(false);
      }
    };

    const timer = setTimeout(fetchGifs, 400);
    return () => clearTimeout(timer);
  }, [gifQuery, showGifPicker, gifTab]);

  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessageText.trim()) return;
    await sendChatMessage(chatMessageText);
    setChatMessageText('');
  };

  const processAndSendImage = (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      console.warn("Raw image file size exceeds 5MB limit:", file.size);
      alert("❌ Image is too large. Please select an image under 5MB.");
      return;
    }

    const confirmSend = window.confirm("Do you want to send this image?");
    if (!confirmSend) return;

    setUploadingImage(true);
    const reader = new FileReader();
    reader.onerror = (err) => {
      console.error("FileReader failed to read image file:", err);
      alert("❌ Failed to read the selected image file.");
      setUploadingImage(false);
    };
    reader.onload = (event) => {
      const img = new Image();
      img.onerror = (err) => {
        console.error("Failed to load image element:", err);
        alert("❌ Failed to process the selected image.");
        setUploadingImage(false);
      };
      img.onload = () => {
        try {
          const maxDim = 400;
          let w = img.width;
          let h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, w, h);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.65);
            
            if (dataUrl.length > 800000) {
              console.error("Compressed base64 payload size is too large for Firestore:", dataUrl.length);
              alert("❌ Compressed image is too large to send via chat.");
              setUploadingImage(false);
              return;
            }

            sendChatMessage(`[IMAGE]:${dataUrl}`)
              .then(() => setUploadingImage(false))
              .catch((err) => {
                console.error("sendChatMessage failed to upload to Firestore:", err);
                alert("❌ Failed to send image message. The payload might be too large or there is a database permission error.");
                setUploadingImage(false);
              });
          } else {
            console.error("Failed to obtain canvas 2D context");
            alert("❌ Browser canvas processing failed.");
            setUploadingImage(false);
          }
        } catch (err) {
          console.error("Error processing image canvas:", err);
          alert("❌ Error processing image details.");
          setUploadingImage(false);
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processAndSendImage(file);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          processAndSendImage(file);
          break;
        }
      }
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.indexOf('image') !== -1) {
      processAndSendImage(file);
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const threshold = 60;
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
    setShowJumpToBottom(!isAtBottom);
  };

  return (
    <div 
      className="chat-panel-container"
      style={{ 
        position: 'relative', 
        height: '100%', 
        display: 'flex', 
        flexDirection: 'column', 
        overflow: 'hidden' 
      }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="chat-messages-list" onScroll={handleScroll} style={{ flex: 1, overflowY: 'auto' }}>
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
            const isMedia = msg.text.startsWith('[IMAGE]:') || msg.text.startsWith('[GIF]:') || msg.text.startsWith('[STICKER]:');
            
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
                {isMedia ? (
                  <img 
                    src={msg.text.slice(msg.text.indexOf(':') + 1)} 
                    alt="Shared media" 
                    style={{ 
                      maxWidth: '100%', 
                      maxHeight: '150px', 
                      borderRadius: '6px', 
                      marginTop: '4px', 
                      objectFit: 'contain', 
                      border: '1px solid var(--border-color)',
                      cursor: 'zoom-in'
                    }} 
                    onClick={() => {
                      const url = msg.text.slice(msg.text.indexOf(':') + 1);
                      setActiveExpandedImageUrl(url);
                    }}
                  />
                ) : (
                  <span className="chat-text" style={{ fontSize: '13px', color: 'var(--text-secondary, #94a3b8)', marginTop: '2px', wordBreak: 'break-word' }}>{msg.text}</span>
                )}
              </div>
            );
          });
        })()}
        <div ref={chatEndRef} />
      </div>

      {/* Jump to bottom floating arrow */}
      {showJumpToBottom && (
        <button
          type="button"
          onClick={() => {
            chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            setShowJumpToBottom(false);
          }}
          style={{
            position: 'absolute',
            bottom: '95px',
            right: '16px',
            backgroundColor: 'var(--primary-color, #f1c40f)',
            color: '#0f1013',
            border: 'none',
            borderRadius: '50%',
            width: '28px',
            height: '28px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            zIndex: 14
          }}
          title="Jump to latest"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
      )}

      {/* Pickers Tool Drawers */}
      {showEmojiPicker && (
        <div className="emoji-drawer-container animate-fade-in" style={{
          position: 'absolute',
          bottom: '95px',
          left: '12px',
          right: '12px',
          backgroundColor: 'var(--panel-bg)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '10px',
          zIndex: 15,
          maxHeight: '180px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '4px' }}>
            <span style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>Select Emoji</span>
            <button 
              type="button" 
              onClick={() => setShowEmojiPicker(false)}
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '14px', padding: '0 4px' }}
            >
              ✕
            </button>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, 1fr)',
            gap: '8px',
            overflowY: 'auto',
            flex: 1
          }}>
            {POPULAR_EMOJIS.map(emoji => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  setChatMessageText(prev => prev + emoji);
                  setShowEmojiPicker(false);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '20px',
                  cursor: 'pointer',
                  padding: '4px',
                  borderRadius: '4px',
                  transition: 'background 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      {showGifPicker && (
        <div className="gif-drawer-container animate-fade-in" style={{
          position: 'absolute',
          bottom: '95px',
          left: '12px',
          right: '12px',
          backgroundColor: 'var(--panel-bg)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '10px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          zIndex: 15,
          maxHeight: '260px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.6)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '4px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setGifTab('gifs')}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  color: gifTab === 'gifs' ? 'var(--primary-color)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: '2px 6px',
                  borderBottom: gifTab === 'gifs' ? '2px solid var(--primary-color)' : '2px solid transparent'
                }}
              >
                GIFs
              </button>
              <button
                type="button"
                onClick={() => setGifTab('stickers')}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  color: gifTab === 'stickers' ? 'var(--primary-color)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: '2px 6px',
                  borderBottom: gifTab === 'stickers' ? '2px solid var(--primary-color)' : '2px solid transparent'
                }}
              >
                Stickers
              </button>
            </div>
            <button 
              type="button" 
              onClick={() => setShowGifPicker(false)}
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '14px', padding: '0 4px' }}
            >
              ✕
            </button>
          </div>
          <input
            type="text"
            placeholder={gifTab === 'gifs' ? "Search GIFs..." : "Search Stickers..."}
            className="search-input"
            style={{ fontSize: '12px', padding: '6px 10px', width: '100%', boxSizing: 'border-box' }}
            value={gifQuery}
            onChange={(e) => setGifQuery(e.target.value)}
          />
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '6px',
            overflowY: 'auto',
            flex: 1,
            maxHeight: '150px'
          }}>
            {loadingGifs ? (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '20px', fontSize: '12px', color: 'var(--text-secondary)' }}>Loading...</div>
            ) : gifs.map((url, i) => (
              <img
                key={i}
                src={url}
                alt={gifTab === 'gifs' ? "gif" : "sticker"}
                style={{ 
                  width: '100%', 
                  height: '50px', 
                  objectFit: gifTab === 'gifs' ? 'cover' : 'contain', 
                  borderRadius: '4px', 
                  cursor: 'pointer',
                  backgroundColor: gifTab === 'stickers' ? 'rgba(255,255,255,0.03)' : 'transparent'
                }}
                onClick={() => {
                  const prefix = gifTab === 'gifs' ? 'GIF' : 'STICKER';
                  sendChatMessage(`[${prefix}]:${url}`);
                  setShowGifPicker(false);
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Pickers Toolbar */}
      <div style={{
        display: 'flex',
        gap: '14px',
        padding: '6px 14px',
        borderTop: '1px solid rgba(255,255,255,0.03)',
        backgroundColor: 'rgba(0,0,0,0.1)',
        alignItems: 'center'
      }}>
        {/* Emoji Button */}
        <button
          type="button"
          onClick={() => {
            setShowEmojiPicker(!showEmojiPicker);
            setShowGifPicker(false);
          }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '15px', padding: '4px', display: 'flex', alignItems: 'center', color: showEmojiPicker ? 'var(--primary-color)' : 'var(--text-secondary)' }}
          title="Insert Emoji"
        >
          😀
        </button>

        {/* GIF Button */}
        <button
          type="button"
          onClick={() => {
            setShowGifPicker(!showGifPicker);
            setShowEmojiPicker(false);
          }}
          style={{ background: 'none', cursor: 'pointer', fontSize: '10px', fontWeight: 800, padding: '2px 5px', borderRadius: '4px', border: showGifPicker ? '1.5px solid var(--primary-color)' : '1.5px solid var(--text-secondary)', color: showGifPicker ? 'var(--primary-color)' : 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}
          title="Search GIFs"
        >
          GIF
        </button>

        {/* Photo Upload Button */}
        <label
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', color: uploadingImage ? 'var(--primary-color)' : 'var(--text-secondary)', fontSize: '14px' }}
          title="Upload Photo"
        >
          <input
            type="file"
            ref={fileInputRef}
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleImageUpload}
            disabled={uploadingImage}
          />
          {uploadingImage ? (
            <div className="loading-spinner" style={{ width: '12px', height: '12px', borderWidth: '2px', borderTopColor: 'var(--primary-color)' }} />
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
          )}
        </label>
      </div>
      
      <form onSubmit={handleSendChatMessage} className="chat-input-form" style={{ borderTop: 'none' }}>
        <input 
          type="text" 
          placeholder="Message the room..." 
          className="search-input"
          style={{ paddingLeft: '14px', fontSize: '13px' }}
          value={chatMessageText}
          onChange={(e) => setChatMessageText(e.target.value)}
          onPaste={handlePaste}
          required
        />
        <button type="submit" className="btn-signin" style={{ padding: '8px 12px' }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </form>
      {activeExpandedImageUrl && (
        <div 
          className="image-modal-overlay animate-fade-in"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(10, 11, 14, 0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '24px',
            backdropFilter: 'blur(8px)'
          }}
          onClick={() => setActiveExpandedImageUrl(null)}
        >
          <div 
            style={{ position: 'relative', maxWidth: '90%', maxHeight: '90%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setActiveExpandedImageUrl(null)}
              style={{
                position: 'absolute',
                top: '-40px',
                right: '0',
                background: 'rgba(255,255,255,0.1)',
                border: 'none',
                color: '#fff',
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                cursor: 'pointer',
                fontSize: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 0.2s',
                zIndex: 1001
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.2)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)'}
            >
              ✕
            </button>
            <img 
              src={activeExpandedImageUrl} 
              alt="Expanded shared media" 
              style={{
                maxWidth: '100%',
                maxHeight: '80vh',
                objectFit: 'contain',
                borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.1)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.8)'
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
