import { useState, useEffect, useRef, useMemo } from 'react';
import { 
  collection, 
  doc, 
  setDoc, 
  addDoc, 
  query, 
  orderBy, 
  onSnapshot, 
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { db } from '../../firebase';
import type { ChatMessage } from '../../App';

interface DMPanelProps {
  user: any;
  dmThreads: any[];
  communityUsers: any[];
  followingUserIds: string[];
  followerUserIds: string[];
  showToast: (msg: string) => void;
  targetsList?: any[];
}

const POPULAR_EMOJIS = [
  '😀', '😂', '😍', '🥰', '😎', '😭', '😡', '😱', '👍', '👎', '👏', '🙌', '🎉', '🔥', '❤️', '💀', '🤔', '👀', '💯', '🚀', '🥳', '💡', '🎮', '🍕', '✨', '👑', '⭐'
];

const DEFAULT_GIFS = [
  'https://media.giphy.com/media/3NtY188QaxDdC/giphy.gif', // cat typing
  'https://media.giphy.com/media/t3s3EZmJr7vwY/giphy.gif', // coding dog
  'https://media.giphy.com/media/26uf3jBf9yBM1ZsFO/giphy.gif', // thumbs up
  'https://media.giphy.com/media/l3q2Z6G1OE6mK0IOk/giphy.gif', // clapping
  'https://media.giphy.com/media/9s73S0Jz2Z1lK/giphy.gif', // minion celebrate
  'https://media.giphy.com/media/b09xElu8umMm4/giphy.gif', // dance cat
  'https://media.giphy.com/media/13HgwGsXF0G6wU/giphy.gif', // yes nod
  'https://media.giphy.com/media/d1E1msP6kmXCza6I/giphy.gif', // mind blown
  'https://media.giphy.com/media/xT0xeJpD8e4DYnMGsw/giphy.gif' // facepalm
];

export function DMPanel({
  user,
  dmThreads,
  followingUserIds,
  followerUserIds,
  showToast,
  targetsList
}: DMPanelProps) {
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [gifQuery, setGifQuery] = useState('');
  const [gifs, setGifs] = useState<string[]>(DEFAULT_GIFS);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [searchConnectionText, setSearchConnectionText] = useState('');
  const [showReminderForm, setShowReminderForm] = useState(false);
  const [reminderText, setReminderText] = useState('');
  const [reminderTime, setReminderTime] = useState('');
  
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Compute mutual connection IDs
  const mutualIds = followingUserIds.filter(id => followerUserIds.includes(id));

  // Merge permanent Mentor thread
  const mergedThreads = useMemo(() => {
    if (!user) return dmThreads;
    const mentorThreadId = `mentor_${user.uid}`;
    const hasMentorDoc = dmThreads.some(t => t.id === mentorThreadId);
    
    if (hasMentorDoc) {
      return dmThreads;
    } else {
      // Add a virtual/default mentor thread
      const virtualMentorThread = {
        id: mentorThreadId,
        participants: [user.uid, 'bot_mentor'],
        lastMessageText: 'Your personal study mentor is ready.',
        lastMessageTime: null,
        unread: { [user.uid]: false },
        createdAt: null
      };
      return [virtualMentorThread, ...dmThreads];
    }
  }, [dmThreads, user?.uid]);

  // State to hold resolved user profiles of participants and mutual connections in real time
  const [resolvedConnections, setResolvedConnections] = useState<any[]>([]);

  // Get unique user IDs we need profiles for: mutualIds + other participants in active DM threads
  const resolveUserIds = useMemo(() => {
    const ids = new Set<string>(mutualIds);
    mergedThreads.forEach(t => {
      if (t.participants) {
        t.participants.forEach((pId: string) => {
          if (pId !== user?.uid) {
            ids.add(pId);
          }
        });
      }
    });
    return Array.from(ids);
  }, [mutualIds, mergedThreads, user?.uid]);

  // Subscribe to profile documents of required users in real time
  useEffect(() => {
    if (resolveUserIds.length === 0) {
      setResolvedConnections([]);
      return;
    }

    const unsubscribes = resolveUserIds.map(uid => {
      if (uid === 'bot_mentor') {
        const profile = {
          id: 'bot_mentor',
          name: 'Mentor',
          initials: '🧠',
          color: '#10b981',
          photoURL: null
        };
        setResolvedConnections(prev => {
          const filtered = prev.filter(p => p.id !== uid);
          return [...filtered, profile];
        });
        return () => {}; // Dummy unsubscribe
      }

      return onSnapshot(doc(db, 'users', uid), (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          const name = data.displayName || 'Google User';
          const initials = name.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase() || '??';
          const profile = {
            id: uid,
            name,
            initials,
            color: data.color || '#3b82f6',
            photoURL: data.photoURL || null
          };
          setResolvedConnections(prev => {
            const filtered = prev.filter(p => p.id !== uid);
            return [...filtered, profile];
          });
        } else {
          // Fallback user profile
          const profile = {
            id: uid,
            name: 'Guest User',
            initials: 'GU',
            color: '#4b5563',
            photoURL: null
          };
          setResolvedConnections(prev => {
            const filtered = prev.filter(p => p.id !== uid);
            return [...filtered, profile];
          });
        }
      }, (err) => {
        console.warn(`Failed to listen to profile ${uid}:`, err);
      });
    });

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [JSON.stringify(resolveUserIds)]);

  // Compute mutualConnections list from resolvedConnections
  const mutualConnections = useMemo(() => {
    return resolvedConnections.filter(c => mutualIds.includes(c.id));
  }, [resolvedConnections, mutualIds]);

  // Subscribe to messages in active thread
  useEffect(() => {
    if (!activeThreadId) {
      setMessages([]);
      return;
    }

    const messagesRef = collection(db, 'dm_threads', activeThreadId, 'messages');
    const q = query(messagesRef, orderBy('createdAt', 'asc'));

    const unsubscribe = onSnapshot(q, (snap) => {
      const list = snap.docs.map(docSnap => {
        const data = docSnap.data();
        let formattedCreatedAt = '';
        if (data.createdAt) {
          formattedCreatedAt = data.createdAt instanceof Timestamp 
            ? data.createdAt.toDate().toISOString() 
            : new Date(data.createdAt).toISOString();
        }
        return {
          id: docSnap.id,
          sender: data.senderName || 'Anonymous',
          senderId: data.senderId,
          text: data.text || '',
          createdAt: formattedCreatedAt
        } as ChatMessage;
      });
      setMessages(list);

      // Auto-scroll
      setTimeout(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    }, (err) => {
      console.warn("Failed to listen to DM messages:", err);
    });

    // Mark thread as read
    const markAsRead = async () => {
      try {
        const threadRef = doc(db, 'dm_threads', activeThreadId);
        // Use setDoc+merge so it works even if the Mentor thread doc doesn't exist yet
        await setDoc(threadRef, {
          [`unread.${user.uid}`]: false
        }, { merge: true });
      } catch (e) {
        console.warn("Failed to mark thread as read:", e);
      }
    };
    markAsRead();

    return () => unsubscribe();
  }, [activeThreadId, user?.uid]);

  // Debounced Giphy query
  useEffect(() => {
    if (!showGifPicker) return;
    if (!gifQuery.trim()) {
      setGifs(DEFAULT_GIFS);
      return;
    }

    const fetchGifs = async () => {
      try {
        const apiKey = import.meta.env.VITE_GIPHY_API_KEY || 'dc6zaTOxFJmzC';
        const url = `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(gifQuery)}&limit=12`;
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          const urls = json.data.map((item: any) => item.images?.fixed_height?.url || `https://i.giphy.com/${item.id}.gif`);
          setGifs(urls);
        }
      } catch (e) {
        console.warn("Failed to query Giphy in DMs:", e);
      }
    };

    const timer = setTimeout(fetchGifs, 400);
    return () => clearTimeout(timer);
  }, [gifQuery, showGifPicker]);

  // Send Message function
  const handleSendMessage = async (textToSend?: string) => {
    const finalVal = textToSend || inputText;
    if (!finalVal.trim() || !activeThreadId || !user) return;

    const thread = mergedThreads.find(t => t.id === activeThreadId);
    if (!thread) return;

    const otherUid = thread.participants.find((pId: string) => pId !== user.uid);
    if (!otherUid) return;

    const isMentor = otherUid === 'bot_mentor';

    // Check if connection is still active (for frontend gating toast)
    const activeConnection = isMentor || mutualIds.includes(otherUid);
    if (!activeConnection) {
      showToast("❌ DMs are only allowed between mutual Connections.");
      return;
    }

    try {
      if (!textToSend) setInputText('');
      
      const serverTime = serverTimestamp();
      const expiresTime = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000); // 10 days

      // 1. Add message document
      const messagesRef = collection(db, 'dm_threads', activeThreadId, 'messages');
      const msgData: any = {
        senderId: user.uid,
        senderName: user.displayName || 'Google User',
        text: finalVal,
        createdAt: serverTime
      };
      if (!isMentor) {
        msgData.expiresAt = expiresTime;
      }
      await addDoc(messagesRef, msgData);

      // 2. Update or create thread document
      const threadRef = doc(db, 'dm_threads', activeThreadId);
      await setDoc(threadRef, {
        participants: thread.participants,
        lastMessageText: finalVal.startsWith('[GIF]:') ? 'GIF 🖼️' : finalVal,
        lastMessageTime: serverTime,
        unread: {
          [otherUid]: true,
          [user.uid]: false
        },
        // Write createdAt only if thread doesn't exist
        ...(thread.createdAt ? {} : { createdAt: serverTime })
      }, { merge: true });

      // 3. Trigger Mentor AI response if applicable
      if (isMentor) {
        // Run asynchronously
        setTimeout(async () => {
          try {
            // Prepare chat history (exclude system/wellness markers if needed, or send all)
            const history = messages.slice(-10).map(m => ({
              senderRole: m.senderId === 'bot_mentor' ? 'bot' : 'user',
              text: m.text
            }));

            const topPriorityTask = targetsList?.find((t: any) => !t.completed)?.text || '';

            const response = await fetch('/api/study-buddy', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                botId: 'Mentor',
                message: finalVal.trim(),
                chatHistory: history,
                topPriorityTask
              })
            });

            const data = await response.json();
            if (!response.ok) {
              throw new Error(data.error || 'Failed to get mentor response');
            }

            // Write Mentor response message
            const replyServerTime = serverTimestamp();
            await addDoc(collection(db, 'dm_threads', activeThreadId, 'messages'), {
              senderId: 'bot_mentor',
              senderName: 'Mentor',
              text: data.reply,
              createdAt: replyServerTime
            });

            // Update thread with last message
            await setDoc(threadRef, {
              lastMessageText: data.reply,
              lastMessageTime: replyServerTime,
              unread: {
                [user.uid]: true
              }
            }, { merge: true });

          } catch (err: any) {
            console.error("Mentor reply generation failed:", err);
            showToast("⚠️ Mentor response failed. Please try again.");
          }
        }, 500);
      }

    } catch (e) {
      console.warn("Failed to send DM message:", e);
      showToast("⚠️ Failed to send message. Connections may have changed.");
    }
  };

  // Start new DM conversation
  const handleStartNewChat = async (targetUid: string) => {
    if (!user) return;
    
    // alphabetical combination for deterministic thread id
    const threadId = user.uid < targetUid ? `${user.uid}_${targetUid}` : `${targetUid}_${user.uid}`;
    
    try {
      const threadRef = doc(db, 'dm_threads', threadId);
      await setDoc(threadRef, {
        participants: [user.uid, targetUid].sort(),
        lastMessageText: 'Conversation started',
        lastMessageTime: serverTimestamp(),
        unread: {
          [user.uid]: false,
          [targetUid]: false
        },
        createdAt: serverTimestamp()
      }, { merge: true });

      setActiveThreadId(threadId);
      setShowNewChatModal(false);
      setSearchConnectionText('');
    } catch (e) {
      console.warn("Failed to create DM thread:", e);
      showToast("❌ Failed to start chat. Make sure you are mutual connections.");
    }
  };

  // Render inbox list of threads
  const renderInboxList = () => {
    // Sort active threads by last activity time descending
    const sortedThreads = [...mergedThreads].sort((a, b) => {
      const getSecs = (t: any) => {
        if (!t) return 0;
        if (t.seconds !== undefined) return t.seconds;
        if (t.toDate) return t.toDate().getTime() / 1000;
        return new Date(t).getTime() / 1000 || 0;
      };
      // Give Mentor a slight fallback advantage to stay near the top if no messages yet
      const timeA = a.id.startsWith('mentor_') && !a.lastMessageTime ? Date.now() / 1000 - 100000 : getSecs(a.lastMessageTime);
      const timeB = b.id.startsWith('mentor_') && !b.lastMessageTime ? Date.now() / 1000 - 100000 : getSecs(b.lastMessageTime);
      return timeB - timeA;
    });

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 8px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 800, margin: 0 }}>Messages</h3>
          <button
            onClick={() => setShowNewChatModal(true)}
            style={{
              padding: '6px 12px',
              backgroundColor: 'var(--primary-color, #f1c40f)',
              color: '#0f1013',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 'bold',
              border: 'none',
              cursor: 'pointer'
            }}
          >
            New DM
          </button>
        </div>

        {showNewChatModal && (
          <div className="emoji-drawer-container animate-fade-in" style={{
            backgroundColor: 'rgba(255,255,255,0.02)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>Select Connection</span>
              <button 
                onClick={() => setShowNewChatModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '11px' }}
              >
                ✕ Cancel
              </button>
            </div>
            <input
              type="text"
              placeholder="Search mutual connections..."
              value={searchConnectionText}
              onChange={e => setSearchConnectionText(e.target.value)}
              style={{
                backgroundColor: 'rgba(0,0,0,0.2)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '12px',
                padding: '6px 10px',
                outline: 'none'
              }}
            />
            <div style={{ maxHeight: '160px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {mutualConnections
                .filter(u => u.name.toLowerCase().includes(searchConnectionText.toLowerCase()))
                .map(u => (
                  <div
                    key={u.id}
                    onClick={() => handleStartNewChat(u.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '6px 8px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      transition: 'background 0.2s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: u.color || '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', fontWeight: 'bold' }}>
                      {u.photoURL ? <img src={u.photoURL} alt={u.name} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /> : (u.initials || u.name.substring(0, 2).toUpperCase())}
                    </div>
                    <span style={{ fontSize: '12px', fontWeight: 600 }}>{u.name}</span>
                  </div>
                ))}
              {mutualConnections.length === 0 && (
                <div style={{ textAlign: 'center', padding: '12px 0', fontSize: '11px', color: 'var(--text-secondary)' }}>
                  Add connections by following each other in the Community tab to start a DM.
                </div>
              )}
            </div>
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {sortedThreads.map(thread => {
            const otherUid = thread.participants.find((pId: string) => pId !== user?.uid);
            const otherUser = resolvedConnections.find(u => u.id === otherUid);
            const otherName = otherUser ? otherUser.name : 'Anonymous User';
            const otherColor = otherUser ? otherUser.color : '#3b82f6';
            const otherInitials = otherUser ? otherUser.initials : '??';
            const otherPhoto = otherUser ? otherUser.photoURL : null;

            const isUnread = thread.unread && thread.unread[user?.uid] === true;

            return (
              <div
                key={thread.id}
                onClick={() => setActiveThreadId(thread.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 12px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(255, 255, 255, 0.02)',
                  border: isUnread ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid rgba(255, 255, 255, 0.03)',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  position: 'relative'
                }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.02)'}
              >
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  backgroundColor: otherColor,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  flexShrink: 0
                }}>
                  {otherPhoto ? <img src={otherPhoto} alt={otherName} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /> : otherInitials}
                </div>
                
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {otherName}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {thread.lastMessageText || 'No messages yet'}
                  </span>
                </div>

                {isUnread && (
                  <span
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      backgroundColor: '#3b82f6',
                      boxShadow: '0 0 6px #3b82f6',
                      flexShrink: 0,
                      marginLeft: '6px'
                    }}
                  />
                )}
              </div>
            );
          })}

          {sortedThreads.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-secondary)', fontSize: '12px' }}>
              No messages yet. Click "New DM" to select a mutual connection and start studying!
            </div>
          )}
        </div>
      </div>
    );
  };

  // Render conversation thread view
  const renderThreadView = () => {
    const thread = mergedThreads.find(t => t.id === activeThreadId);
    if (!thread) return null;

    const otherUid = thread.participants.find((pId: string) => pId !== user?.uid);
    const otherUser = resolvedConnections.find(u => u.id === otherUid);
    const isMentorThread = otherUid === 'bot_mentor';
    const otherName = isMentorThread ? 'Mentor' : (otherUser ? otherUser.name : 'Anonymous User');
    const otherColor = isMentorThread ? '#10b981' : (otherUser ? otherUser.color : '#3b82f6');
    const otherPhoto = isMentorThread ? null : (otherUser ? otherUser.photoURL : null);
    const otherInitials = isMentorThread ? '🧠' : (otherUser ? otherUser.initials : '??');

    const isConnected = isMentorThread || mutualIds.includes(otherUid);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Thread Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          borderBottom: '1px solid var(--border-color)',
          paddingBottom: '12px',
          marginBottom: '12px'
        }}>
          <button
            onClick={() => setActiveThreadId(null)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              padding: '4px 0'
            }}
          >
            ← Back
          </button>
          
          <div style={{
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            backgroundColor: otherColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: isMentorThread ? '14px' : '10px',
            fontWeight: 'bold',
            flexShrink: 0,
            boxShadow: isMentorThread ? '0 0 10px #10b98140' : 'none'
          }}>
            {otherPhoto ? <img src={otherPhoto} alt={otherName} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /> : otherInitials}
          </div>

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {otherName}
            </span>
            {isMentorThread ? (
              <span style={{ fontSize: '9px', color: '#10b981', fontWeight: 'bold', textTransform: 'uppercase' }}>
                ● Your Personal Mentor
              </span>
            ) : (
              <span style={{ fontSize: '9px', color: isConnected ? '#10b981' : '#ef4444', fontWeight: 'bold', textTransform: 'uppercase' }}>
                {isConnected ? '● Connected' : '✕ Disconnected'}
              </span>
            )}
          </div>
        </div>

        {/* Message history */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '4px' }}>
          {messages.map((msg) => {
            const isMe = msg.senderId === user?.uid;
            const isMedia = msg.text.startsWith('[IMAGE]:') || msg.text.startsWith('[GIF]:') || msg.text.startsWith('[STICKER]:');
            
            return (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: isMe ? 'flex-end' : 'flex-start',
                  gap: '2px',
                  maxWidth: '85%',
                  alignSelf: isMe ? 'flex-end' : 'flex-start'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '10px', fontWeight: 700, opacity: 0.8 }}>
                    {isMe ? 'You' : msg.sender}
                  </span>
                  {msg.createdAt && (
                    <span style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>

                {isMedia ? (
                  <img
                    src={msg.text.slice(msg.text.indexOf(':') + 1)}
                    alt="shared media"
                    style={{
                      maxWidth: '100%',
                      maxHeight: '120px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      marginTop: '2px',
                      objectFit: 'contain'
                    }}
                  />
                ) : (
                  <div style={{
                    padding: '8px 12px',
                    borderRadius: '10px',
                    fontSize: '13px',
                    lineHeight: '1.4',
                    wordBreak: 'break-word',
                    backgroundColor: isMe
                      ? 'var(--primary-color, #f1c40f)'
                      : msg.senderId === 'bot_mentor'
                        ? 'rgba(16, 185, 129, 0.12)'
                        : 'rgba(255, 255, 255, 0.05)',
                    color: isMe ? '#0f1013' : 'var(--text-primary)',
                    fontWeight: isMe ? 500 : 'normal',
                    borderLeft: msg.senderId === 'bot_mentor' ? '3px solid #10b981' : 'none'
                  }}>
                    {msg.text}
                  </div>
                )}
              </div>
            );
          })}
          <div ref={chatEndRef} />
        </div>

        {/* Input area */}
        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '10px', marginTop: '10px', position: 'relative' }}>
          
          {!isMentorThread && (
            <div style={{
              fontSize: '9px',
              color: 'var(--text-secondary)',
              marginBottom: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              paddingLeft: '4px'
            }}>
              ✋ Messages disappear after 10 days
            </div>
          )}
          {isMentorThread && (
            <div style={{
              fontSize: '9px',
              color: '#10b981',
              marginBottom: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              paddingLeft: '4px'
            }}>
              🧠 Mentor messages persist forever
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {!isMentorThread && (
              <button
                type="button"
                onClick={() => { setShowEmojiPicker(!showEmojiPicker); setShowGifPicker(false); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '4px' }}
                title="Emoji Picker"
              >
                😀
              </button>
            )}
            {!isMentorThread && (
              <button
                type="button"
                onClick={() => { setShowGifPicker(!showGifPicker); setShowEmojiPicker(false); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '4px' }}
                title="GIF Picker"
              >
                🖼️
              </button>
            )}

            <input
              type="text"
              placeholder={isMentorThread ? "Talk to your Mentor..." : (isConnected ? "Type a direct message..." : "Direct messaging disabled (not connected)")}
              disabled={!isConnected}
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSendMessage();
              }}
              style={{
                flex: 1,
                backgroundColor: 'rgba(0,0,0,0.2)',
                border: isMentorThread ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid var(--border-color)',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '12px',
                padding: '6px 10px',
                outline: 'none',
                opacity: isConnected ? 1 : 0.6
              }}
            />

            <button
              type="button"
              disabled={!isConnected || !inputText.trim()}
              onClick={() => handleSendMessage()}
              style={{
                padding: '6px 12px',
                backgroundColor: isConnected && inputText.trim() ? 'var(--primary-color, #f1c40f)' : 'rgba(255,255,255,0.05)',
                color: isConnected && inputText.trim() ? '#0f1013' : 'var(--text-secondary)',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 'bold',
                border: 'none',
                cursor: isConnected && inputText.trim() ? 'pointer' : 'default'
              }}
            >
              Send
            </button>
          </div>

          {/* Tier 2: Add Reminder button (Mentor thread only) */}
          {isMentorThread && (
            <div style={{ marginTop: '10px', borderTop: '1px solid rgba(16,185,129,0.15)', paddingTop: '8px' }}>
              {!showReminderForm ? (
                <button
                  type="button"
                  onClick={() => setShowReminderForm(true)}
                  style={{
                    background: 'none',
                    border: '1px dashed rgba(16,185,129,0.4)',
                    color: '#10b981',
                    borderRadius: '6px',
                    padding: '5px 12px',
                    fontSize: '11px',
                    cursor: 'pointer',
                    width: '100%',
                    fontWeight: 600
                  }}
                >
                  + Set a Reminder
                </button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      type="text"
                      placeholder="Reminder text (e.g. Review chapter 5)"
                      value={reminderText}
                      onChange={e => setReminderText(e.target.value)}
                      style={{
                        flex: 2,
                        backgroundColor: 'rgba(0,0,0,0.2)',
                        border: '1px solid rgba(16,185,129,0.3)',
                        borderRadius: '6px',
                        color: '#fff',
                        fontSize: '11px',
                        padding: '5px 8px',
                        outline: 'none'
                      }}
                    />
                    <input
                      type="datetime-local"
                      value={reminderTime}
                      onChange={e => setReminderTime(e.target.value)}
                      style={{
                        flex: 1,
                        backgroundColor: 'rgba(0,0,0,0.2)',
                        border: '1px solid rgba(16,185,129,0.3)',
                        borderRadius: '6px',
                        color: '#fff',
                        fontSize: '11px',
                        padding: '5px 8px',
                        outline: 'none'
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => { setShowReminderForm(false); setReminderText(''); setReminderTime(''); }}
                      style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '11px' }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={!reminderText.trim() || !reminderTime}
                      onClick={async () => {
                        if (!user || !reminderText.trim() || !reminderTime) return;
                        try {
                          const fireAt = new Date(reminderTime);
                          await addDoc(collection(db, 'users', user.uid, 'reminders'), {
                            text: reminderText.trim(),
                            fireAt,
                            fired: false,
                            createdAt: serverTimestamp()
                          });
                          showToast('⏰ Reminder set!');
                          setShowReminderForm(false);
                          setReminderText('');
                          setReminderTime('');
                        } catch (err) {
                          console.warn('Failed to save reminder:', err);
                          showToast('❌ Failed to save reminder.');
                        }
                      }}
                      style={{
                        padding: '5px 12px',
                        backgroundColor: reminderText.trim() && reminderTime ? '#10b981' : 'rgba(255,255,255,0.05)',
                        color: reminderText.trim() && reminderTime ? '#fff' : 'var(--text-secondary)',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: 'bold',
                        border: 'none',
                        cursor: reminderText.trim() && reminderTime ? 'pointer' : 'default'
                      }}
                    >
                      Save Reminder
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Emoji Picker Drawer */}
          {showEmojiPicker && (
            <div className="emoji-drawer-container animate-fade-in" style={{
              position: 'absolute',
              bottom: '45px',
              left: 0,
              right: 0,
              backgroundColor: 'var(--panel-bg)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '8px',
              zIndex: 15,
              maxHeight: '120px',
              overflowY: 'auto',
              boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gap: '6px'
            }}>
              {POPULAR_EMOJIS.map(emoji => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    setInputText(prev => prev + emoji);
                    setShowEmojiPicker(false);
                  }}
                  style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', padding: '2px' }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          {/* GIF Picker Drawer */}
          {showGifPicker && (
            <div className="gif-drawer-container animate-fade-in" style={{
              position: 'absolute',
              bottom: '45px',
              left: 0,
              right: 0,
              backgroundColor: 'var(--panel-bg)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              zIndex: 15,
              maxHeight: '180px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.6)'
            }}>
              <input
                type="text"
                placeholder="Search Giphy..."
                value={gifQuery}
                onChange={e => setGifQuery(e.target.value)}
                style={{
                  backgroundColor: 'rgba(0,0,0,0.2)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '11px',
                  padding: '4px 8px',
                  outline: 'none'
                }}
              />
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '4px',
                overflowY: 'auto',
                flex: 1
              }}>
                {gifs.map(gifUrl => (
                  <img
                    key={gifUrl}
                    src={gifUrl}
                    alt="gif"
                    onClick={() => {
                      handleSendMessage(`[GIF]:${gifUrl}`);
                      setShowGifPicker(false);
                    }}
                    style={{ width: '100%', height: '40px', objectFit: 'cover', borderRadius: '4px', cursor: 'pointer' }}
                  />
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {activeThreadId ? renderThreadView() : renderInboxList()}
    </div>
  );
}
