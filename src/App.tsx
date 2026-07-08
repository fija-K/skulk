import { useState, useEffect, useRef } from 'react';

interface Room {
  id: string;
  name: string;
  type: 'private' | 'public-ask' | 'public';
  buttonText: string;
  participants: string[];
  scheduledDate?: string;
  scheduledTime?: string;
  link?: string;
}

interface Participant {
  id: string;
  name: string;
  initials: string;
  color: string;
  isMuted: boolean;
  isCamOff: boolean;
  isSpeaking: boolean;
  isPinned: boolean;
  isHost?: boolean;
}

interface ChatMessage {
  id: string;
  sender: string;
  text: string;
}

export default function App() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'rooms' | 'community'>('rooms');
  
  // Rooms state list (Topics entirely removed)
  const [rooms, setRooms] = useState<Room[]>([
    {
      id: '1',
      name: 'DSA grind - arrays',
      type: 'public',
      buttonText: 'Join',
      participants: ['JD', 'AM'], // 2/3 filled
      link: 'skulk.app/room/dsa123'
    },
    {
      id: '2',
      name: 'GATE CS - OS revision',
      type: 'public-ask',
      buttonText: 'Ask to join',
      participants: ['SK', 'PL', 'RK'], // 3/3 filled
      link: 'skulk.app/room/gate45'
    },
    {
      id: '3',
      name: 'IELTS speaking practice',
      type: 'public',
      buttonText: 'Join',
      participants: ['JS'], // 1/3 filled
      link: 'skulk.app/room/ielts9'
    },
    {
      id: '4',
      name: 'General study session',
      type: 'public',
      buttonText: 'Join',
      participants: [], // 0/3 filled
      link: 'skulk.app/room/study5'
    },
  ]);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomType, setNewRoomType] = useState<'private' | 'public-ask' | 'public'>('public-ask');
  const [newMaxParticipants, setNewMaxParticipants] = useState(10);
  
  // Scheduling State
  const [startOption, setStartOption] = useState<'now' | 'later'>('now');
  const [scheduleDate, setScheduleDate] = useState('2026-07-08');
  const [scheduleTime, setScheduleTime] = useState('12:00');
  
  // Confirmation state
  const [modalStep, setModalStep] = useState<'form' | 'confirmation'>('form');
  const [generatedRoomLink, setGeneratedRoomLink] = useState('');
  const [isCopied, setIsCopied] = useState(false);

  // Theme Picker State (7 selectable themes, nightwatch default)
  const [theme, setTheme] = useState<string>('nightwatch');
  const [isThemePickerOpen, setIsThemePickerOpen] = useState(false);

  // Active call view state
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [pendingJoinRoom, setPendingJoinRoom] = useState<Room | null>(null);
  
  // Call hardware controls state
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCamOff, setIsCamOff] = useState(false);
  const [isGalleryView, setIsGalleryView] = useState(false);
  
  // Sidebar tabs in-call panel
  const [callTab, setCallTab] = useState<'chat' | 'people' | 'tools'>('chat');
  const [chatMessageText, setChatMessageText] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  
  // In-call participants state
  const [callParticipants, setCallParticipants] = useState<Participant[]>([]);
  const [activeMenuParticipantId, setActiveMenuParticipantId] = useState<string | null>(null);

  // Toast feedback state
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Tools and Shared Stage States
  const [isWhiteboardActive, setIsWhiteboardActive] = useState(false);
  const [screenShareStream, setScreenShareStream] = useState<MediaStream | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawColor, setDrawColor] = useState('#f1c40f'); // Neon gold as default

  // Guest Profile Identity State
  const [guestName, setGuestName] = useState('');
  const [guestColor, setGuestColor] = useState('');
  const [guestInitials, setGuestInitials] = useState('');
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [profileEditName, setProfileEditName] = useState('');
  const [profileEditColor, setProfileEditColor] = useState('');

  const modalRef = useRef<HTMLDivElement>(null);
  const themePickerRef = useRef<HTMLDivElement>(null);
  const sidebarMenuRef = useRef<HTMLDivElement>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const themes = [
    { id: 'nightwatch', name: 'Nightwatch', bg: '#0f1013', accent: '#f1c40f' },
    { id: 'reactor', name: 'Reactor', bg: '#0b0c10', accent: '#e74c3c' },
    { id: 'crimson', name: 'Crimson', bg: '#000000', accent: '#dc2626' },
    { id: 'deduction', name: 'Deduction', bg: '#000000', accent: '#ffffff' },
    { id: 'bloom', name: 'Bloom', bg: '#fff9fa', accent: '#ec4899' },
    { id: 'symbiote', name: 'Symbiote', bg: '#040404', accent: '#84cc16' },
    { id: 'webslinger', name: 'Webslinger', bg: '#070913', accent: '#e11d48' },
  ];

  // Sync theme class to html element
  useEffect(() => {
    const root = window.document.documentElement;
    // Strip other theme classes
    const classesToRemove = Array.from(root.classList).filter(c => c.startsWith('theme-'));
    classesToRemove.forEach(c => root.classList.remove(c));
    root.classList.add(`theme-${theme}`);
  }, [theme]);

  // Load or auto-generate Guest Identity
  useEffect(() => {
    const stored = localStorage.getItem('skulk_guest_identity');
    if (stored) {
      try {
        const data = JSON.parse(stored);
        if (data.name && data.color && data.initials) {
          setGuestName(data.name);
          setGuestColor(data.color);
          setGuestInitials(data.initials);
          setProfileEditName(data.name);
          setProfileEditColor(data.color);
          return;
        }
      } catch (e) {
        // fallback
      }
    }
    
    // Auto-generate adjective + animal nickname
    const adjectives = ['Quiet', 'Clever', 'Smart', 'Bright', 'Calm', 'Active', 'Swift', 'Wise', 'Happy', 'Gentle'];
    const animals = ['Fox', 'Owl', 'Panda', 'Koala', 'Rabbit', 'Deer', 'Otter', 'Falcon', 'Wolf', 'Badger'];
    const colors = ['#8b5cf6', '#3b82f6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444'];
    
    const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const randomAnim = animals[Math.floor(Math.random() * animals.length)];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    const initials = randomAdj[0] + randomAnim[0];
    const name = `${randomAdj} ${randomAnim}`;
    
    setGuestName(name);
    setGuestColor(randomColor);
    setGuestInitials(initials);
    setProfileEditName(name);
    setProfileEditColor(randomColor);
    
    localStorage.setItem('skulk_guest_identity', JSON.stringify({ name, color: randomColor, initials }));
  }, []);

  // Sync guest identity edits into active call in real time
  useEffect(() => {
    if (currentRoom) {
      setCallParticipants(prev => prev.map(p => {
        if (p.id === 'user_you') {
          return {
            ...p,
            name: `${guestName} (You)`,
            initials: guestInitials,
            color: guestColor
          };
        }
        return p;
      }));
    }
  }, [guestName, guestColor, guestInitials, currentRoom]);

  // Click outside handlers
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      // Theme picker click outside close
      if (themePickerRef.current && !themePickerRef.current.contains(e.target as Node)) {
        setIsThemePickerOpen(false);
      }
      // Hover participant action dropdown click outside close
      if (sidebarMenuRef.current && !sidebarMenuRef.current.contains(e.target as Node)) {
        setActiveMenuParticipantId(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Lock body scroll when modal is active
  useEffect(() => {
    if (isModalOpen || pendingJoinRoom) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isModalOpen, pendingJoinRoom]);

  // Close modal on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const openModal = () => {
    setIsModalOpen(true);
    setNewRoomName('');
    setNewRoomType('public-ask');
    setNewMaxParticipants(10);
    setStartOption('now');
    setModalStep('form');
    setGeneratedRoomLink('');
    setIsCopied(false);
  };

  const closeModal = () => {
    setIsModalOpen(false);
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    // Only allow clicking backdrop to close if on the 'form' step (not confirmation screen)
    if (modalStep === 'form' && modalRef.current && !modalRef.current.contains(e.target as Node)) {
      closeModal();
    }
  };

  // Toast feedback trigger helper
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  // Join Room Handlers (wiring direct vs pending status)
  const handleJoinRoomClick = (room: Room) => {
    if (room.type === 'public') {
      enterCallRoom(room);
    } else if (room.type === 'public-ask') {
      // 1. Show waiting dialog banner
      setPendingJoinRoom(room);
      
      // 2. Simulate host auto-approval after 2.5 seconds
      setTimeout(() => {
        setPendingJoinRoom(prev => {
          if (prev && prev.id === room.id) {
            enterCallRoom(room);
            showToast(`Host approved request! Joined "${room.name}"`);
          }
          return null; // Clears pending join state
        });
      }, 2500);
    }
  };

  // Setup conference shell room data
  const enterCallRoom = (room: Room) => {
    setCurrentRoom(room);
    setIsMicMuted(false);
    setIsCamOff(false);
    setIsGalleryView(false);
    setCallTab('chat');
    
    // Setup initial mock call participant states
    const initialParticipants: Participant[] = [
      {
        id: 'user_you',
        name: `${guestName || 'You'} (You)`,
        initials: guestInitials || 'Y',
        color: guestColor || '#8b5cf6',
        isMuted: false,
        isCamOff: false,
        isSpeaking: false,
        isPinned: false,
        isHost: true
      },
      {
        id: 'part_jd',
        name: 'John Doe',
        initials: 'JD',
        color: '#3b82f6', // Blue
        isMuted: true,
        isCamOff: false,
        isSpeaking: false,
        isPinned: false
      },
      {
        id: 'part_am',
        name: 'Anna Miller',
        initials: 'AM',
        color: '#ec4899', // Pink
        isMuted: false,
        isCamOff: false,
        isSpeaking: true, // Speaking highlight active
        isPinned: false
      }
    ];

    // Adjust list based on who was already in the room in the mock dashboard data
    const list = [...initialParticipants];
    if (room.participants.length === 1 && room.participants[0] === 'JS') {
      // IELTS room has only JS
      list.splice(1, 2); // Remove JD and AM
      list.push({
        id: 'part_js',
        name: 'James Smith',
        initials: 'JS',
        color: '#06b6d4',
        isMuted: false,
        isCamOff: false,
        isSpeaking: false,
        isPinned: false
      });
    } else if (room.participants.length === 0) {
      // Empty study session has only you
      list.splice(1, 2);
    }
    
    setCallParticipants(list);

    // Initial mock messages
    setChatMessages([
      { id: 'msg_1', sender: 'John Doe', text: 'Hey everyone! Ready to study?' },
      { id: 'msg_2', sender: 'Anna Miller', text: "Yes! Let's get started on this." },
    ]);
  };

  const handleLeaveCall = () => {
    setCurrentRoom(null);
    setCallParticipants([]);
    setChatMessages([]);
  };

  // Clean up screen presenting tracks when leaving call
  useEffect(() => {
    if (!currentRoom) {
      if (screenShareStream) {
        screenShareStream.getTracks().forEach(track => track.stop());
        setScreenShareStream(null);
      }
      setIsWhiteboardActive(false);
    }
  }, [currentRoom, screenShareStream]);

  // Bind screen presenter stream to video element
  useEffect(() => {
    if (videoRef.current && screenShareStream) {
      videoRef.current.srcObject = screenShareStream;
    }
  }, [screenShareStream]);

  // Resize canvas when whiteboard opens or draw color changes
  useEffect(() => {
    if (isWhiteboardActive && canvasRef.current) {
      const canvas = canvasRef.current;
      canvas.width = canvas.parentElement?.clientWidth || 800;
      canvas.height = canvas.parentElement?.clientHeight || 500;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.lineCap = 'round';
        ctx.lineWidth = 3;
        ctx.strokeStyle = drawColor;
      }
    }
  }, [isWhiteboardActive]);

  // Mouse drawing handlers
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.strokeStyle = drawColor;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  // Touch drawing handlers (for mobile support)
  const startDrawingTouch = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(touch.clientX - rect.left, touch.clientY - rect.top);
    ctx.strokeStyle = drawColor;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    setIsDrawing(true);
  };

  const drawTouch = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(touch.clientX - rect.left, touch.clientY - rect.top);
    ctx.stroke();
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    showToast('Whiteboard cleared');
  };

  // Screen share trigger
  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      });
      setScreenShareStream(stream);
      
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          setScreenShareStream(null);
        };
      }
      showToast('Screen sharing started!');
    } catch (err) {
      console.error('Error starting screen share:', err);
      showToast('Screen share failed or cancelled');
    }
  };

  const stopScreenShare = () => {
    if (screenShareStream) {
      screenShareStream.getTracks().forEach(track => track.stop());
      setScreenShareStream(null);
      showToast('Screen sharing stopped');
    }
  };

  // Submit Handler for modal creation
  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();

    const randomId = Math.random().toString(36).substring(2, 8);
    const roomLink = `skulk.app/room/${randomId}`;

    const roomDetails = {
      name: newRoomName || 'Untitled Room',
      type: newRoomType,
      maxParticipants: newMaxParticipants,
      startOption,
      scheduledDate: startOption === 'later' ? scheduleDate : undefined,
      scheduledTime: startOption === 'later' ? scheduleTime : undefined,
      link: roomLink
    };

    console.log('Creating room:', roomDetails);

    const newRoomObj: Room = {
      id: Date.now().toString(),
      name: roomDetails.name,
      type: roomDetails.type,
      buttonText: roomDetails.type === 'public-ask' ? 'Ask to join' : 'Join',
      participants: [], 
      scheduledDate: roomDetails.scheduledDate,
      scheduledTime: roomDetails.scheduledTime,
      link: roomDetails.link
    };

    setRooms(prev => [...prev, newRoomObj]);
    setGeneratedRoomLink(roomLink);
    setModalStep('confirmation');
  };

  // Clipboard copy helper
  const handleCopyLink = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(generatedRoomLink);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  // Save guest profile edits
  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileEditName.trim()) return;

    // Generate initials from first letters
    const words = profileEditName.trim().split(/\s+/);
    let initials = 'G';
    if (words.length >= 2) {
      initials = (words[0][0] + words[1][0]).toUpperCase();
    } else if (words[0].length >= 2) {
      initials = words[0].substring(0, 2).toUpperCase();
    } else if (words[0].length > 0) {
      initials = words[0][0].toUpperCase();
    }

    setGuestName(profileEditName);
    setGuestColor(profileEditColor);
    setGuestInitials(initials);

    localStorage.setItem('skulk_guest_identity', JSON.stringify({ 
      name: profileEditName, 
      color: profileEditColor, 
      initials 
    }));
    setIsProfileModalOpen(false);
    showToast('Profile updated!');
  };

  // Local chat submission
  const handleSendChatMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessageText.trim()) return;

    const newMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: 'You',
      text: chatMessageText
    };

    setChatMessages(prev => [...prev, newMsg]);
    setChatMessageText('');
  };

  // Co-host control triggers (Mute, Pin, Remove)
  const handleParticipantMuteToggle = (id: string, name: string) => {
    setCallParticipants(prev => prev.map(p => {
      if (p.id === id) {
        const nextMute = !p.isMuted;
        showToast(nextMute ? `Muted ${name}` : `Unmuted ${name}`);
        return { ...p, isMuted: nextMute };
      }
      return p;
    }));
    setActiveMenuParticipantId(null);
  };

  const handleParticipantPinToggle = (id: string, name: string) => {
    setCallParticipants(prev => prev.map(p => {
      if (p.id === id) {
        const nextPin = !p.isPinned;
        showToast(nextPin ? `Pinned ${name}` : `Unpinned ${name}`);
        return { ...p, isPinned: nextPin };
      }
      return p;
    }));
    setActiveMenuParticipantId(null);
  };

  const handleParticipantRemove = (id: string, name: string) => {
    setCallParticipants(prev => prev.filter(p => p.id !== id));
    showToast(`Removed ${name} from room`);
    setActiveMenuParticipantId(null);
  };

  // Format date nicely for human eyes
  const formatFriendlyDate = (dateStr?: string) => {
    if (!dateStr) return '';
    try {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
    } catch (e) {
      // fallback
    }
    return dateStr;
  };

  // Map participant initials to theme-appropriate color circles
  const getAvatarColor = (initials: string) => {
    const colorMap: Record<string, string> = {
      'JD': '#3b82f6',
      'AM': '#ec4899',
      'SK': '#f59e0b',
      'PL': '#8b5cf6',
      'RK': '#10b981',
      'JS': '#06b6d4',
    };
    return colorMap[initials] || '#64748b';
  };

  // Filtered rooms based on name search
  const filteredRooms = rooms.filter(room => {
    if (room.type === 'private') {
      return false;
    }
    return room.name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <div className="app-container">
      
      {/* 1. Dashboard View (rendered if currentRoom is null) */}
      {!currentRoom ? (
        <>
          {/* Header (top bar) */}
          <header className="header">
            <a href="/" className="logo-container">
              <div className="logo-circle">S</div>
              <span>Skulk</span>
            </a>
            
            <div className="nav-container">
              <a href="#about" className="nav-link">About</a>
              <a href="#privacy" className="nav-link">Privacy policy</a>
              
              {/* LinkedIn Icon Link pointing to specific URL */}
              <a 
                href="https://www.linkedin.com/in/fija-khan-69515b3a9/" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="icon-link" 
                aria-label="LinkedIn"
              >
                <svg 
                  xmlns="http://www.w3.org/2000/svg" 
                  width="20" 
                  height="20" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2" 
                  strokeLinecap="round" 
                  strokeLinejoin="round"
                >
                  <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"></path>
                  <rect x="2" y="9" width="4" height="12"></rect>
                  <circle cx="4" cy="4" r="2"></circle>
                </svg>
              </a>

              {/* Theme Picker Popover */}
              <div className="theme-picker-container" ref={themePickerRef}>
                <button 
                  onClick={() => setIsThemePickerOpen(!isThemePickerOpen)} 
                  className="theme-picker-btn" 
                  aria-label="Theme settings"
                  title="Select theme palette"
                >
                  <svg 
                    xmlns="http://www.w3.org/2000/svg" 
                    width="20" 
                    height="20" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                  >
                    <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 14.7255 3.09032 17.1962 4.85857 19C5.32832 19.4797 5.5632 19.7196 5.86178 19.8598C6.16035 20 6.56847 20 7.38471 20H8C9.10457 20 10 19.1046 10 18C10 16.8954 10.8954 16 12 16C13.1046 16 14 16.8954 14 18C14 20.2091 15.7909 22 18 22H12Z"></path>
                    <circle cx="7.5" cy="10.5" r="1.5" fill="currentColor"></circle>
                    <circle cx="11.5" cy="7.5" r="1.5" fill="currentColor"></circle>
                    <circle cx="16.5" cy="9.5" r="1.5" fill="currentColor"></circle>
                    <circle cx="15.5" cy="14.5" r="1.5" fill="currentColor"></circle>
                  </svg>
                </button>

                {isThemePickerOpen && (
                  <div className="theme-picker-dropdown animate-fade-in">
                    {themes.map((t) => (
                      <button 
                        key={t.id} 
                        onClick={() => {
                          setTheme(t.id);
                          setIsThemePickerOpen(false);
                        }} 
                        className="theme-item-btn"
                      >
                        <div className="theme-item-left">
                          <div 
                            className="theme-color-preview" 
                            style={{ background: `linear-gradient(135deg, ${t.bg} 50%, ${t.accent} 50%)` }}
                          />
                          <span>{t.name}</span>
                        </div>
                        {theme === t.id && (
                          <svg 
                            className="theme-check-icon" 
                            xmlns="http://www.w3.org/2000/svg" 
                            width="16" 
                            height="16" 
                            viewBox="0 0 24 24" 
                            fill="none" 
                            stroke="currentColor" 
                            strokeWidth="3" 
                            strokeLinecap="round" 
                            strokeLinejoin="round"
                          >
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Guest Profile Identity Badge */}
              {guestName && (
                <button 
                  onClick={() => {
                    setProfileEditName(guestName);
                    setProfileEditColor(guestColor);
                    setIsProfileModalOpen(true);
                  }}
                  className="guest-profile-badge"
                  title="Edit guest profile"
                >
                  <div className="guest-badge-avatar" style={{ backgroundColor: guestColor }}>
                    {guestInitials}
                  </div>
                  <span>{guestName}</span>
                </button>
              )}

              <button className="btn-signin">Sign in</button>
            </div>
          </header>

          {/* Tabs */}
          <div className="tabs-container">
            <button 
              onClick={() => setActiveTab('rooms')} 
              className={`tab-btn ${activeTab === 'rooms' ? 'active' : ''}`}
            >
              Rooms
            </button>
            <button 
              onClick={() => setActiveTab('community')} 
              className={`tab-btn ${activeTab === 'community' ? 'active' : ''}`}
            >
              Community
            </button>
          </div>

          {/* Rooms Tab Content */}
          {activeTab === 'rooms' ? (
            <div>
              {/* Search & Create Row */}
              <div className="filter-row">
                <div className="search-input-wrapper">
                  <svg 
                    className="search-icon" 
                    xmlns="http://www.w3.org/2000/svg" 
                    width="18" 
                    height="18" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                  <input 
                    type="text" 
                    placeholder="Search rooms" 
                    className="search-input"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                <button onClick={openModal} className="btn-create">
                  <svg 
                    xmlns="http://www.w3.org/2000/svg" 
                    width="16" 
                    height="16" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2.5" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                  >
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                  Create room
                </button>
              </div>

              {/* Section Title */}
              <h2 className="section-title">Live rooms</h2>

              {/* Grid Layout of Room Cards */}
              <div className="rooms-grid">
                {filteredRooms.map((room) => {
                  const isScheduled = room.scheduledDate && room.scheduledTime;
                  return (
                    <div className="room-card" key={room.id}>
                      {/* Room Header */}
                      <div className="room-card-header">
                        <div 
                          className="room-dot" 
                          style={{ 
                            backgroundColor: isScheduled ? 'var(--primary-color)' : 'var(--dot-color)',
                            boxShadow: isScheduled ? '0 0 8px var(--primary-color)' : '0 0 8px var(--dot-color)'
                          }}
                        ></div>
                        <h3 className="room-title">{room.name}</h3>
                      </div>
                      
                      {/* Room Subtitle */}
                      <p className="room-subtitle">
                        {isScheduled 
                          ? `Scheduled for ${formatFriendlyDate(room.scheduledDate)} at ${room.scheduledTime} · ${room.type === 'public-ask' ? 'ask to join' : 'public'}`
                          : `${room.type === 'public-ask' ? 'ask to join' : 'public'}`
                        }
                      </p>
                      
                      {/* Participant Avatars Row */}
                      <div className="avatar-row">
                        {[0, 1, 2].map((index) => {
                          const participant = room.participants[index];
                          if (participant) {
                            return (
                              <div 
                                key={index} 
                                className="avatar-slot avatar-filled"
                                style={{ backgroundColor: getAvatarColor(participant) }}
                              >
                                {participant}
                              </div>
                            );
                          } else {
                            return (
                              <div key={index} className="avatar-slot avatar-empty" />
                            );
                          }
                        })}
                      </div>
                      
                      {/* Room Footer */}
                      <div className="room-footer">
                        <button 
                          onClick={() => handleJoinRoomClick(room)} 
                          className="btn-join"
                        >
                          {isScheduled ? 'Register' : room.buttonText}
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* Locked private rooms card */}
                <div className="room-card-locked">
                  <svg 
                    className="lock-icon" 
                    xmlns="http://www.w3.org/2000/svg" 
                    width="24" 
                    height="24" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                  </svg>
                  <p className="locked-text">
                    Private rooms don't show up here — share a link instead
                  </p>
                </div>
              </div>
            </div>
          ) : (
            /* Community Tab Content Placeholder */
            <div className="placeholder-container">
              <svg 
                xmlns="http://www.w3.org/2000/svg" 
                width="48" 
                height="48" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="1.5" 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                style={{ marginBottom: '16px', opacity: 0.6 }}
              >
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
              <h3 className="placeholder-title">Community</h3>
              <p>Coming soon</p>
            </div>
          )}
        </>
      ) : (
        
        /* 2. In-Call Room Stage View (rendered if currentRoom is NOT null) */
        <div className="call-layout animate-fade-in">
          
          {/* Call Header */}
          <div className="call-top-bar">
            <div className="call-room-info">
              <a href="/" onClick={(e) => { e.preventDefault(); handleLeaveCall(); }} className="logo-circle" style={{ width: '28px', height: '28px', fontSize: '15px', textDecoration: 'none' }}>S</a>
              <h1 className="room-title" style={{ fontSize: '18px' }}>{currentRoom.name}</h1>
              <div className="recording-dot-wrapper">
                <div className="recording-dot"></div>
                <span>LIVE</span>
              </div>
            </div>
            
            <div className="nav-container" style={{ gap: '16px' }}>
              {/* Theme Selector inside Call */}
              <div className="theme-picker-container" ref={themePickerRef}>
                <button 
                  onClick={() => setIsThemePickerOpen(!isThemePickerOpen)} 
                  className="theme-picker-btn"
                  aria-label="Theme settings"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 14.7255 3.09032 17.1962 4.85857 19C5.32832 19.4797 5.5632 19.7196 5.86178 19.8598C6.16035 20 6.56847 20 7.38471 20H8C9.10457 20 10 19.1046 10 18C10 16.8954 10.8954 16 12 16C13.1046 16 14 16.8954 14 18C14 20.2091 15.7909 22 18 22H12Z"></path>
                    <circle cx="7.5" cy="10.5" r="1.5" fill="currentColor"></circle>
                    <circle cx="11.5" cy="7.5" r="1.5" fill="currentColor"></circle>
                    <circle cx="16.5" cy="9.5" r="1.5" fill="currentColor"></circle>
                    <circle cx="15.5" cy="14.5" r="1.5" fill="currentColor"></circle>
                  </svg>
                </button>
                {isThemePickerOpen && (
                  <div className="theme-picker-dropdown animate-fade-in" style={{ top: '100%', right: '0' }}>
                    {themes.map((t) => (
                      <button 
                        key={t.id} 
                        onClick={() => { setTheme(t.id); setIsThemePickerOpen(false); }} 
                        className="theme-item-btn"
                      >
                        <div className="theme-item-left">
                          <div className="theme-color-preview" style={{ background: `linear-gradient(135deg, ${t.bg} 50%, ${t.accent} 50%)` }} />
                          <span>{t.name}</span>
                        </div>
                        {theme === t.id && (
                          <svg className="theme-check-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* Guest Profile Identity Badge in Call */}
              {guestName && (
                <button 
                  onClick={() => {
                    setProfileEditName(guestName);
                    setProfileEditColor(guestColor);
                    setIsProfileModalOpen(true);
                  }}
                  className="guest-profile-badge"
                  style={{ padding: '4px 10px 4px 4px', fontSize: '12px' }}
                  title="Edit guest profile"
                >
                  <div className="guest-badge-avatar" style={{ backgroundColor: guestColor, width: '20px', height: '20px', fontSize: '9px' }}>
                    {guestInitials}
                  </div>
                  <span>{guestName}</span>
                </button>
              )}

              <button className="btn-signin" style={{ padding: '6px 14px', fontSize: '13px' }}>Sign in</button>
            </div>
          </div>

          {/* Call Body */}
          <div className="call-main-content">
            
            {/* Call Main Stage (Left) */}
            <div className="call-stage">
              {isWhiteboardActive ? (
                /* Shared Whiteboard stage display */
                <div className="whiteboard-container">
                  <div className="whiteboard-toolbar">
                    <div className="whiteboard-tools-left">
                      <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>Whiteboard</span>
                      <div className="whiteboard-color-pickers">
                        {['#f1c40f', '#ef4444', '#10b981', '#3b82f6', '#ffffff'].map(color => (
                          <div 
                            key={color}
                            className={`whiteboard-color-dot ${drawColor === color ? 'selected' : ''}`}
                            style={{ backgroundColor: color }}
                            onClick={() => setDrawColor(color)}
                            title={`Select ${color} pen`}
                          />
                        ))}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={clearCanvas} className="btn-signin" style={{ padding: '6px 12px', fontSize: '12px', backgroundColor: 'var(--button-secondary-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>
                        Clear
                      </button>
                      <button onClick={() => setIsWhiteboardActive(false)} className="btn-create" style={{ padding: '6px 12px', fontSize: '12px' }}>
                        Close whiteboard
                      </button>
                    </div>
                  </div>
                  <canvas 
                    ref={canvasRef}
                    className="whiteboard-canvas"
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawingTouch}
                    onTouchMove={drawTouch}
                    onTouchEnd={stopDrawing}
                  />
                </div>
              ) : screenShareStream ? (
                /* Screen Presenting layout stage display */
                <div className="screenshare-stage-layout">
                  <div className="screenshare-video-wrapper">
                    <video ref={videoRef} autoPlay playsInline muted className="screenshare-video"></video>
                    <div style={{ position: 'absolute', bottom: '12px', left: '12px', backgroundColor: 'rgba(0,0,0,0.6)', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, color: '#ffffff' }}>
                      Presenting Screen
                    </div>
                  </div>
                  <div className="screenshare-tiles-strip">
                    {callParticipants.map((p) => {
                      const isUser = p.id === 'user_you';
                      const showMuted = isUser ? isMicMuted : p.isMuted;
                      
                      return (
                        <div 
                          key={p.id} 
                          className={`participant-tile ${isUser ? 'user-tile' : ''} ${p.isSpeaking && !showMuted ? 'speaker-active' : ''}`}
                        >
                          <div className="participant-avatar-large" style={{ backgroundColor: p.color }}>
                            {p.initials}
                          </div>
                          <div className="participant-name-tag">
                            <span>{p.name}</span>
                            {showMuted && (
                              <svg className="tile-icon-muted" xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="1" y1="1" x2="23" y2="23"></line>
                                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
                                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
                                <line x1="12" y1="19" x2="12" y2="23"></line>
                                <line x1="8" y1="23" x2="16" y2="23"></line>
                              </svg>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                /* Standard conference participants grid layout display */
                <>
                  <div className={`participants-container ${isGalleryView ? 'gallery-layout' : 'grid-layout'}`}>
                    {callParticipants.map((p) => {
                      const isUser = p.id === 'user_you';
                      const showMuted = isUser ? isMicMuted : p.isMuted;
                      
                      return (
                        <div 
                          key={p.id} 
                          className={`participant-tile ${isUser ? 'user-tile' : ''} ${p.isSpeaking && !showMuted ? 'speaker-active' : ''}`}
                        >
                          {/* Avatar Square */}
                          <div 
                            className="participant-avatar-large" 
                            style={{ backgroundColor: p.color }}
                          >
                            {p.initials}
                          </div>
                          
                          {/* Name Tag + Muted Status */}
                          <div className="participant-name-tag">
                            <span>{p.name}</span>
                            {showMuted && (
                              <svg className="tile-icon-muted" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="1" y1="1" x2="23" y2="23"></line>
                                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
                                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
                                <line x1="12" y1="19" x2="12" y2="23"></line>
                                <line x1="8" y1="23" x2="16" y2="23"></line>
                              </svg>
                            )}
                            {p.isPinned && (
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--primary-color)' }}>
                                <line x1="12" y1="17" x2="12" y2="22"></line>
                                <path d="M5 17h14v-1.76a2 2 0 0 0-.44-1.24l-2.33-2.91a2 2 0 0 1-.43-1.23V4a1 1 0 0 0-1-1h-5.6a1 1 0 0 0-1 1v5.86c0 .44-.16.86-.43 1.23l-2.33 2.91a2 2 0 0 0-.44 1.24V17Z"></path>
                              </svg>
                            )}
                          </div>

                          {/* Host Actions Hover Trigger Menu (Not visible for yourself) */}
                          {!isUser && (
                            <div ref={sidebarMenuRef}>
                              <button 
                                onClick={() => setActiveMenuParticipantId(activeMenuParticipantId === p.id ? null : p.id)}
                                className="tile-actions-trigger" 
                                aria-label="Participant options"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <circle cx="12" cy="12" r="1"></circle>
                                  <circle cx="12" cy="5" r="1"></circle>
                                  <circle cx="12" cy="19" r="1"></circle>
                                </svg>
                              </button>
                              
                              {/* Option Dropdown List */}
                              {activeMenuParticipantId === p.id && (
                                <div className="tile-actions-menu animate-fade-in">
                                  <button 
                                    onClick={() => handleParticipantMuteToggle(p.id, p.name)} 
                                    className="tile-menu-item"
                                  >
                                    {p.isMuted ? 'Unmute' : 'Mute'}
                                  </button>
                                  <button 
                                    onClick={() => handleParticipantPinToggle(p.id, p.name)} 
                                    className="tile-menu-item"
                                  >
                                    {p.isPinned ? 'Unpin' : 'Pin'}
                                  </button>
                                  <button 
                                    onClick={() => handleParticipantRemove(p.id, p.name)} 
                                    className="tile-menu-item" 
                                    style={{ color: '#ef4444' }}
                                  >
                                    Remove
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Layout Caption toggle */}
                  <p className="stage-caption" onClick={() => setIsGalleryView(!isGalleryView)}>
                    Tap the grid icon to switch to {isGalleryView ? 'compact grid' : 'full gallery'} view
                  </p>
                </>
              )}
            </div>

            {/* Call Sidebar (Right Panel) */}
            <div className="call-sidebar">
              {/* Sidebar Header Tabs */}
              <div className="call-sidebar-header">
                <button 
                  onClick={() => setCallTab('chat')} 
                  className={`sidebar-tab-btn ${callTab === 'chat' ? 'active' : ''}`}
                >
                  Chat
                </button>
                <button 
                  onClick={() => setCallTab('people')} 
                  className={`sidebar-tab-btn ${callTab === 'people' ? 'active' : ''}`}
                >
                  People ({callParticipants.length})
                </button>
                <button 
                  onClick={() => setCallTab('tools')} 
                  className={`sidebar-tab-btn ${callTab === 'tools' ? 'active' : ''}`}
                >
                  Tools
                </button>
              </div>

              {/* Sidebar Body Content Panels */}
              <div className="sidebar-content">
                
                {/* 2A. Chat Tab Panel */}
                {callTab === 'chat' && (
                  <>
                    <div className="chat-messages-list">
                      {chatMessages.map((msg) => (
                        <div key={msg.id} className="chat-message-item animate-fade-in">
                          <span className="chat-sender">{msg.sender}:</span>
                          <span className="chat-text">{msg.text}</span>
                        </div>
                      ))}
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
                )}

                {/* 2B. People Tab Panel */}
                {callTab === 'people' && (
                  <div className="people-list animate-fade-in">
                    {callParticipants.map((p) => {
                      const isUser = p.id === 'user_you';
                      const showMuted = isUser ? isMicMuted : p.isMuted;
                      
                      return (
                        <div key={p.id} className="person-row">
                          <div className="person-info">
                            <div className="person-avatar" style={{ backgroundColor: p.color }}>
                              {p.initials}
                            </div>
                            <div className="person-name-wrapper">
                              <span className="person-name">{p.name}</span>
                              {p.isHost && <span className="person-badge">Host</span>}
                            </div>
                          </div>
                          <div className="person-status-icons">
                            {/* mic icon status */}
                            <svg className={`person-status-icon ${showMuted ? 'muted' : ''}`} xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              {showMuted ? (
                                <>
                                  <line x1="1" y1="1" x2="23" y2="23"></line>
                                  <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
                                  <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
                                </>
                              ) : (
                                <>
                                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                                  <line x1="12" y1="19" x2="12" y2="23"></line>
                                  <line x1="8" y1="23" x2="16" y2="23"></line>
                                </>
                              )}
                            </svg>
                            {/* camera icon status */}
                            <svg className="person-status-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              {isUser && isCamOff ? (
                                <>
                                  <line x1="1" y1="1" x2="23" y2="23"></line>
                                  <path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3 0h9a2 2 0 0 1 2 2v8a2 2 0 0 1-.18.83l-4-4"></path>
                                </>
                              ) : (
                                <>
                                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                                  <circle cx="12" cy="13" r="4"></circle>
                                </>
                              )}
                            </svg>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* 2C. Tools Tab Panel (Functional whiteboard and screen share) */}
                {callTab === 'tools' && (
                  <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <h4 style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                      Collaborative Tools
                    </h4>
                    
                    <div className="tools-cards-grid">
                      {/* Whiteboard card button */}
                      <div 
                        className={`tool-card ${isWhiteboardActive ? 'active' : ''}`}
                        onClick={() => setIsWhiteboardActive(!isWhiteboardActive)}
                        title="Toggle whiteboard drawing pad"
                      >
                        <div className="tool-card-icon-wrapper">
                          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 20h9"></path>
                            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                          </svg>
                        </div>
                        <div className="tool-card-info">
                          <span className="tool-card-title">Shared Whiteboard</span>
                          <span className="tool-card-desc">Draw and brainstorm with neon markers.</span>
                        </div>
                      </div>

                      {/* Screen Share card button */}
                      <div 
                        className={`tool-card ${screenShareStream ? 'active' : ''}`}
                        onClick={screenShareStream ? stopScreenShare : startScreenShare}
                        title={screenShareStream ? 'Stop screen sharing' : 'Start sharing screen'}
                      >
                        <div className="tool-card-icon-wrapper" style={{ color: screenShareStream ? '#ef4444' : 'inherit' }}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                            <line x1="8" y1="21" x2="16" y2="21"></line>
                            <line x1="12" y1="17" x2="12" y2="21"></line>
                          </svg>
                        </div>
                        <div className="tool-card-info">
                          <span className="tool-card-title">
                            {screenShareStream ? 'Stop Presenting' : 'Share Screen'}
                          </span>
                          <span className="tool-card-desc">
                            {screenShareStream ? 'Stop sharing your screen.' : 'Present a tab, window, or full screen.'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            </div>

          </div>

          {/* Call Control Dock (Bottom Toolbar) */}
          <div className="call-bottom-dock">
            
            {/* Mic Toggle Button */}
            <button 
              onClick={() => setIsMicMuted(!isMicMuted)} 
              className={`dock-btn ${isMicMuted ? 'active-off' : ''}`}
              title={isMicMuted ? 'Unmute microphone' : 'Mute microphone'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {isMicMuted ? (
                  <>
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
                    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
                  </>
                ) : (
                  <>
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                    <line x1="12" y1="19" x2="12" y2="23"></line>
                    <line x1="8" y1="23" x2="16" y2="23"></line>
                  </>
                )}
              </svg>
            </button>
            
            {/* Camera Toggle Button */}
            <button 
              onClick={() => setIsCamOff(!isCamOff)} 
              className={`dock-btn ${isCamOff ? 'active-off' : ''}`}
              title={isCamOff ? 'Turn camera on' : 'Turn camera off'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {isCamOff ? (
                  <>
                    <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m4 0h5a2 2 0 0 1 2 2v3m-2.11-.11l3.44-5.16a1 1 0 0 1 1.67 1.1l-2.22 3.34"></path>
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                  </>
                ) : (
                  <>
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                    <circle cx="12" cy="13" r="4"></circle>
                  </>
                )}
              </svg>
            </button>
            
            {/* Layout Toggle Button */}
            <button 
              onClick={() => setIsGalleryView(!isGalleryView)} 
              className="dock-btn"
              title={isGalleryView ? 'Switch to Grid View' : 'Switch to Gallery View'}
            >
              {isGalleryView ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="9"></rect>
                  <rect x="14" y="3" width="7" height="5"></rect>
                  <rect x="14" y="12" width="7" height="9"></rect>
                  <rect x="3" y="16" width="7" height="5"></rect>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7"></rect>
                  <rect x="14" y="3" width="7" height="7"></rect>
                  <rect x="14" y="14" width="7" height="7"></rect>
                  <rect x="3" y="14" width="7" height="7"></rect>
                </svg>
              )}
            </button>
            
            {/* Leave / End Call Button */}
            <button 
              onClick={handleLeaveCall} 
              className="dock-btn dock-btn-leave"
              title="Leave room call"
            >
              Leave
            </button>

          </div>

        </div>
      )}

      {/* 3. Join Request Loading/Waiting Screen for "Ask to Join" rooms */}
      {pendingJoinRoom && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div className="modal-container animate-fade-in" style={{ maxWidth: '380px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '32px' }}>
            <div className="spinner" style={{ marginBottom: '24px' }}></div>
            <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
              Waiting for host approval
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: 1.5 }}>
              You have requested to join **"{pendingJoinRoom.name}"**. You will enter the room as soon as the host accepts.
            </p>
            <button 
              onClick={() => setPendingJoinRoom(null)} 
              className="btn-create" 
              style={{ width: '100%', padding: '10px', fontSize: '14px', justifyContent: 'center' }}
            >
              Cancel request
            </button>
          </div>
        </div>
      )}

      {/* 4. Create Room Modal Dialog (rendered on dashboard) */}
      {isModalOpen && !currentRoom && (
        <div className="modal-overlay" onClick={handleBackdropClick}>
          <div className="modal-container animate-fade-in" ref={modalRef}>
            
            {/* Modal Header */}
            <div className="modal-header">
              <h2 className="modal-title">{modalStep === 'form' ? 'Create room' : 'Success'}</h2>
              {/* Only show close X on form step */}
              {modalStep === 'form' && (
                <button onClick={closeModal} className="modal-close-btn" aria-label="Close modal">
                  <svg 
                    xmlns="http://www.w3.org/2000/svg" 
                    width="20" 
                    height="20" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              )}
            </div>

            {modalStep === 'form' ? (
              /* Modal Form Page */
              <form onSubmit={handleCreateRoom}>
                
                {/* Start Now vs Schedule Button Toggle Group */}
                <div className="form-group" style={{ marginBottom: '20px' }}>
                  <label className="form-label">Timing</label>
                  <div className="toggle-buttons">
                    <button 
                      type="button"
                      className={`toggle-button ${startOption === 'now' ? 'active' : ''}`}
                      onClick={() => setStartOption('now')}
                    >
                      Start now
                    </button>
                    <button 
                      type="button"
                      className={`toggle-button ${startOption === 'later' ? 'active' : ''}`}
                      onClick={() => setStartOption('later')}
                    >
                      Schedule for later
                    </button>
                  </div>
                </div>

                {/* Conditional Schedule Fields */}
                {startOption === 'later' && (
                  <div className="form-group animate-fade-in" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
                    <div>
                      <label htmlFor="scheduleDate" className="form-label">Date</label>
                      <input 
                        type="date" 
                        id="scheduleDate"
                        className="search-input"
                        style={{ paddingLeft: '12px', width: '100%' }}
                        value={scheduleDate}
                        onChange={(e) => setScheduleDate(e.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <label htmlFor="scheduleTime" className="form-label">Time</label>
                      <input 
                        type="time" 
                        id="scheduleTime"
                        className="search-input"
                        style={{ paddingLeft: '12px', width: '100%' }}
                        value={scheduleTime}
                        onChange={(e) => setScheduleTime(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                )}
                
                {/* Room Name Input */}
                <div className="form-group" style={{ marginBottom: '20px' }}>
                  <label htmlFor="roomName" className="form-label">Room name</label>
                  <input 
                    type="text" 
                    id="roomName" 
                    placeholder="DSA grind - arrays" 
                    className="search-input" 
                    style={{ paddingLeft: '16px' }} 
                    value={newRoomName}
                    onChange={(e) => setNewRoomName(e.target.value)}
                    required
                    autoFocus
                  />
                </div>

                {/* Room Type Stacked Radios */}
                <div className="form-group" style={{ marginBottom: '20px' }}>
                  <label className="form-label">Room type</label>
                  <div className="radio-group">
                    
                    {/* Private Card */}
                    <div 
                      className={`radio-card ${newRoomType === 'private' ? 'active' : ''}`}
                      onClick={() => setNewRoomType('private')}
                    >
                      <div className="radio-indicator">
                        {newRoomType === 'private' && <div className="radio-dot" />}
                      </div>
                      <div className="radio-content">
                        <span className="radio-title">Private</span>
                        <span className="radio-desc">Only people with the link can join. Not listed anywhere.</span>
                      </div>
                    </div>

                    {/* Public - Ask to Join Card */}
                    <div 
                      className={`radio-card ${newRoomType === 'public-ask' ? 'active' : ''}`}
                      onClick={() => setNewRoomType('public-ask')}
                    >
                      <div className="radio-indicator">
                        {newRoomType === 'public-ask' && <div className="radio-dot" />}
                      </div>
                      <div className="radio-content">
                        <span className="radio-title">Public - ask to join</span>
                        <span className="radio-desc">Listed on the dashboard. Host approves each join request.</span>
                      </div>
                    </div>

                    {/* Public Card */}
                    <div 
                      className={`radio-card ${newRoomType === 'public' ? 'active' : ''}`}
                      onClick={() => setNewRoomType('public')}
                    >
                      <div className="radio-indicator">
                        {newRoomType === 'public' && <div className="radio-dot" />}
                      </div>
                      <div className="radio-content">
                        <span className="radio-title">Public</span>
                        <span className="radio-desc">Listed on the dashboard. Anyone can join instantly.</span>
                      </div>
                    </div>

                  </div>
                </div>

                {/* Max Participants Input */}
                <div className="form-group" style={{ marginBottom: '28px' }}>
                  <label htmlFor="maxParticipants" className="form-label">Max participants</label>
                  <input 
                    type="number" 
                    id="maxParticipants" 
                    min="1" 
                    max="100"
                    className="search-input"
                    style={{ paddingLeft: '16px' }}
                    value={newMaxParticipants}
                    onChange={(e) => setNewMaxParticipants(parseInt(e.target.value) || 10)}
                    required
                  />
                </div>

                {/* Bottom Create Button */}
                <button type="submit" className="btn-signin" style={{ width: '100%', padding: '12px 16px', fontSize: '15px' }}>
                  {startOption === 'later' ? 'Schedule room' : 'Create room'}
                </button>

              </form>
            ) : (
              /* Success / Share Link Confirmation Page */
              <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '8px 0' }}>
                {/* Success Icon */}
                <div style={{ 
                  width: '56px', 
                  height: '56px', 
                  borderRadius: '50%', 
                  backgroundColor: 'rgba(34, 197, 94, 0.1)', 
                  color: '#22c55e', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  marginBottom: '16px'
                }}>
                  <svg 
                    xmlns="http://www.w3.org/2000/svg" 
                    width="28" 
                    height="28" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="3" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </div>

                <h3 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
                  {startOption === 'later' ? 'Room scheduled!' : 'Room created!'}
                </h3>

                <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px', maxWidth: '320px', lineHeight: 1.5 }}>
                  {startOption === 'later' 
                    ? `Room scheduled for ${formatFriendlyDate(scheduleDate)} at ${scheduleTime}. Copy the link to invite participants in advance.`
                    : 'Your study room is active. Share the link below to invite participants.'
                  }
                </p>

                {/* Link Copy Field Box */}
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  width: '100%', 
                  backgroundColor: 'var(--input-bg)', 
                  border: '1px solid var(--input-border)', 
                  borderRadius: 'var(--btn-radius)', 
                  padding: '4px',
                  marginBottom: '32px'
                }}>
                  <span style={{ 
                    fontFamily: 'monospace', 
                    fontSize: '14px', 
                    color: 'var(--text-primary)', 
                    padding: '8px 12px',
                    textAlign: 'left',
                    flexGrow: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {generatedRoomLink}
                  </span>
                  
                  <button 
                    type="button" 
                    onClick={handleCopyLink}
                    className="btn-signin"
                    style={{ 
                      padding: '8px 16px', 
                      fontSize: '13px', 
                      borderRadius: 'calc(var(--btn-radius) * 0.83)',
                      whiteSpace: 'nowrap',
                      backgroundColor: isCopied ? '#22c55e' : 'var(--primary-color)',
                      color: isCopied ? '#ffffff' : 'var(--primary-text)',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {isCopied ? 'Copied!' : 'Copy link'}
                  </button>
                </div>

                {/* Done close button */}
                <button 
                  onClick={closeModal} 
                  className="btn-create" 
                  style={{ width: '100%', padding: '12px 16px', fontSize: '15px', justifyContent: 'center' }}
                >
                  Done
                </button>
              </div>
            )}

          </div>
        </div>
      )}

      {/* 5. Custom Toast Alerts Popup */}
      {toastMessage && (
        <div className="toast-container animate-fade-in">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--primary-color)' }}>
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 6. Guest Profile Editor Modal */}
      {isProfileModalOpen && (
        <div className="modal-overlay" onClick={() => setIsProfileModalOpen(false)} style={{ zIndex: 1200 }}>
          <div className="modal-container animate-fade-in" style={{ maxWidth: '360px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Edit profile</h2>
              <button onClick={() => setIsProfileModalOpen(false)} className="modal-close-btn" aria-label="Close modal">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            <form onSubmit={handleSaveProfile}>
              <div className="form-group" style={{ marginBottom: '20px' }}>
                <label htmlFor="profileName" className="form-label">Nickname</label>
                <input 
                  type="text" 
                  id="profileName"
                  className="search-input"
                  style={{ paddingLeft: '16px' }}
                  value={profileEditName}
                  onChange={(e) => setProfileEditName(e.target.value)}
                  required
                  maxLength={25}
                />
              </div>

              <div className="form-group" style={{ marginBottom: '28px' }}>
                <label className="form-label">Avatar Color</label>
                <div className="color-swatch-picker">
                  {['#8b5cf6', '#3b82f6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444'].map(color => (
                    <div 
                      key={color}
                      className={`color-swatch-circle ${profileEditColor === color ? 'selected' : ''}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setProfileEditColor(color)}
                    >
                      {profileEditColor === color && (
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <button type="submit" className="btn-signin" style={{ width: '100%', padding: '12px 16px', fontSize: '15px' }}>
                Save changes
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
