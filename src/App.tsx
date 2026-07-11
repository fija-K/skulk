import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { 
  collection, 
  doc, 
  setDoc, 
  deleteDoc, 
  getDoc,
  getDocs, 
  onSnapshot, 
  updateDoc,
  runTransaction
} from 'firebase/firestore';
import { auth, googleProvider, signInWithPopup, signOut, db } from './firebase';
import {
  LiveKitRoom,
  VideoTrack,
  useTracks,
  RoomAudioRenderer,
  useLocalParticipant
} from '@livekit/components-react';
import '@livekit/components-styles';
import { Track, ParticipantEvent } from 'livekit-client';

interface Room {
  id: string;
  name: string;
  type: 'private' | 'public-ask' | 'public';
  buttonText: string;
  participants: string[];
  maxParticipants: number;
  scheduledDate?: string;
  scheduledTime?: string;
  link?: string;
  creatorId?: string; // Room creator is the Admin
  creatorName?: string;
  createdAt?: string;
}

interface Participant {
  id: string;
  name: string;
  initials: string;
  color: string;
  photoURL?: string | null;
  isMuted: boolean;
  isCamOff: boolean;
  isSpeaking: boolean;
  isPinned: boolean;
  isHost?: boolean;
  sharing?: 'youtube' | 'whiteboard' | 'screen' | null;
  sharingYoutubeId?: string | null;
  whiteboardData?: string;
  role?: 'admin' | 'host' | 'cohost' | 'member'; // admin, host, cohost, member
  mutedBy?: string;
  camOffBy?: string;
}

type ViewingShare = {
  participantId: string;
  type: 'youtube' | 'whiteboard' | 'screen';
  youtubeVideoId?: string;
};

interface ChatMessage {
  id: string;
  sender: string;
  senderId?: string;
  senderRole?: 'admin' | 'host' | 'cohost' | 'member';
  text: string;
  createdAt?: string;
}

function ParticipantVideo({ participantId }: { participantId: string }) {
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: false }]);
  const trackRef = tracks.find(t => t.participant.identity === participantId) as any;

  if (!trackRef) return null;

  return (
    <VideoTrack 
      trackRef={trackRef} 
      style={{ 
        width: '100%', 
        height: '100%', 
        objectFit: 'cover', 
        borderRadius: '8px',
        position: 'absolute',
        top: 0,
        left: 0,
        zIndex: 1
      }} 
    />
  );
}

function DeviceRecoveryManager({ 
  isCamOff, 
  isMicMuted,
  onErrorChange 
}: { 
  isCamOff: boolean; 
  isMicMuted: boolean;
  onErrorChange: (camErr: boolean, micErr: boolean) => void;
}) {
  const { localParticipant } = useLocalParticipant();

  useEffect(() => {
    if (!localParticipant) return;

    let currentCamErr = false;
    let currentMicErr = false;
    const reportErrors = () => onErrorChange(currentCamErr, currentMicErr);

    // Sync active enabled states dynamically with local participant tracks
    localParticipant.setCameraEnabled(!isCamOff).catch((err) => {
      console.warn("Failed to sync camera state", err);
      currentCamErr = true;
      reportErrors();
    });
    localParticipant.setMicrophoneEnabled(!isMicMuted).catch((err) => {
      console.warn("Failed to sync mic state", err);
      currentMicErr = true;
      reportErrors();
    });

    const handleCameraRecovery = async () => {
      if (isCamOff) {
        currentCamErr = false;
        reportErrors();
        return;
      }
      try {
        await localParticipant.setCameraEnabled(true);
        currentCamErr = false;
        reportErrors();
      } catch (err) {
        console.warn("Camera auto-recovery failed", err);
        currentCamErr = true;
        reportErrors();
      }
    };

    const handleMicRecovery = async () => {
      if (isMicMuted) {
        currentMicErr = false;
        reportErrors();
        return;
      }
      try {
        await localParticipant.setMicrophoneEnabled(true);
        currentMicErr = false;
        reportErrors();
      } catch (err) {
        console.warn("Mic auto-recovery failed", err);
        currentMicErr = true;
        reportErrors();
      }
    };

    // 1. Permissions API listener
    const setupPermissions = async () => {
      try {
        const camStatus = await navigator.permissions.query({ name: 'camera' as PermissionName });
        camStatus.onchange = () => {
          if (camStatus.state === 'granted') handleCameraRecovery();
        };
      } catch (e) { /* ignore */ }

      try {
        const micStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        micStatus.onchange = () => {
          if (micStatus.state === 'granted') handleMicRecovery();
        };
      } catch (e) { /* ignore */ }
    };

    setupPermissions();

    // 2. Track onended listener
    const checkTracks = () => {
      const camTrack = localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack?.mediaStreamTrack;
      if (camTrack) {
        camTrack.onended = () => {
          console.warn("Camera track unexpectedly ended (hardware switch?)");
          handleCameraRecovery();
        };
        if (currentCamErr) {
          currentCamErr = false;
          reportErrors();
        }
      }

      const micTrack = localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack?.mediaStreamTrack;
      if (micTrack) {
        micTrack.onended = () => {
          console.warn("Mic track unexpectedly ended");
          handleMicRecovery();
        };
        if (currentMicErr) {
          currentMicErr = false;
          reportErrors();
        }
      }
    };

    checkTracks();

    const onMediaError = (error: Error) => {
      console.warn("Media devices error:", error);
      if (!isCamOff) currentCamErr = true;
      if (!isMicMuted) currentMicErr = true;
      reportErrors();
    };
    
    localParticipant.on(ParticipantEvent.LocalTrackPublished, checkTracks);
    localParticipant.on(ParticipantEvent.LocalTrackUnpublished, checkTracks);
    localParticipant.on(ParticipantEvent.MediaDevicesError, onMediaError);

    const onRetryDevice = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail === 'camera') handleCameraRecovery();
      if (customEvent.detail === 'mic') handleMicRecovery();
    };
    window.addEventListener('retry-device', onRetryDevice);
    
    return () => {
      localParticipant.off(ParticipantEvent.LocalTrackPublished, checkTracks);
      localParticipant.off(ParticipantEvent.LocalTrackUnpublished, checkTracks);
      localParticipant.off(ParticipantEvent.MediaDevicesError, onMediaError);
      window.removeEventListener('retry-device', onRetryDevice);
    };
  }, [localParticipant, isCamOff, isMicMuted, onErrorChange]);

  return null;
}

// Export the global app wrapper
export default function App() {
  return <AppContent />;
}

let globalPendingLeavePromise: Promise<void> | null = null;
function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();

  // Helper to extract room ID from pathname since useParams() is empty at App level
  const getRoomIdFromPath = (path: string) => {
    const match = path.match(/^\/room\/([^/]+)/);
    return match ? match[1] : undefined;
  };
  const roomId = getRoomIdFromPath(location.pathname);

  // Firebase auth state
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
  const userDropdownRef = useRef<HTMLDivElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'rooms' | 'community'>('rooms');
  
  // Real-time rooms state list
  const [rooms, setRooms] = useState<Room[]>([]);
  // Map of participant lists for rooms: room.id -> Participant[]
  const [roomsParticipants, setRoomsParticipants] = useState<Record<string, any[]>>({});

  // Persistent Guest ID
  const [guestId, setGuestId] = useState<string>('');

  useEffect(() => {
    let gid = localStorage.getItem('skulk_guest_id');
    if (!gid) {
      gid = 'guest_' + Math.random().toString(36).substring(2, 9);
      localStorage.setItem('skulk_guest_id', gid);
    }
    setGuestId(gid);
  }, []);
  // Load local rooms from localStorage as a fallback when Firestore is blocked
  const getLocalRooms = (): Room[] => {
    try {
      const stored = localStorage.getItem('skulk_local_rooms');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  };

  const saveLocalRoom = (room: Room) => {
    try {
      const existing = getLocalRooms();
      if (!existing.some(r => r.id === room.id)) {
        localStorage.setItem('skulk_local_rooms', JSON.stringify([...existing, room]));
      }
    } catch (e) {
      console.error('Failed to save room to localStorage:', e);
    }
  };
  // Load and synchronize rooms list from Firestore in real time
  useEffect(() => {
    const roomsRef = collection(db, 'rooms');
    
    const unsubscribe = onSnapshot(roomsRef, async (snapshot) => {
      if (snapshot.empty) {
        setRooms(getLocalRooms());
      } else {
        const list: Room[] = [];
        snapshot.forEach(doc => {
          list.push({ id: doc.id, ...doc.data() } as Room);
        });
        // Sort client-side by createdAt to ensure consistent ordering without index requirements
        list.sort((a, b) => {
          const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return timeA - timeB;
        });
        // Merge Firestore rooms with local rooms to make sure local creations are also visible on refresh!
        const local = getLocalRooms();
        const merged = [...list];
        const updatedLocal = [...local];
        
        local.forEach(r => {
          if (!list.some(m => m.id === r.id)) {
            // Remove from updatedLocal
            const idx = updatedLocal.findIndex(ul => ul.id === r.id);
            if (idx !== -1) {
              updatedLocal.splice(idx, 1);
            }
          } else {
            if (!merged.some(m => m.id === r.id)) {
              merged.push(r);
            }
          }
        });
        localStorage.setItem('skulk_local_rooms', JSON.stringify(updatedLocal));
        setRooms(merged);
      }
    }, (error) => {
      console.warn("Firestore subscription failed, falling back to local mock data:", error);
      setIsFirestoreBlocked(true);
      setRooms(getLocalRooms());
    });
    return () => unsubscribe();
  }, []);

  // Listen to participants subcollection for each room listed on the dashboard
  useEffect(() => {
    if (rooms.length === 0) return;
    
    const unsubscribes = rooms.map(room => {
      return onSnapshot(collection(db, 'rooms', room.id, 'participants'), (snapshot) => {
        const participantsList = snapshot.docs.map(doc => doc.data());
        setRoomsParticipants(prev => ({
          ...prev,
          [room.id]: participantsList
        }));
      });
    });
    
    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [rooms]);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showSignInPrompt, setShowSignInPrompt] = useState(false);
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
  const [cameraError, setCameraError] = useState(false);
  const [micError, setMicError] = useState(false);
  const [isGalleryView, setIsGalleryView] = useState(false);
  const [liveKitToken, setLiveKitToken] = useState<string | null>(null);
  
  // Sidebar tabs in-call panel
  const [callTab, setCallTab] = useState<'chat' | 'people' | 'tools'>('chat');
  const [chatMessageText, setChatMessageText] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  
  // In-call participants state
  const [callParticipants, setCallParticipants] = useState<Participant[]>([]);
  const [activeMenuParticipantId, setActiveMenuParticipantId] = useState<string | null>(null);

  // Toast feedback state
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // const [isWhiteboardActive, setIsWhiteboardActive] = useState(false);
  const [viewingShare, setViewingShare] = useState<ViewingShare | null>(null);
  const [screenShareStream, setScreenShareStream] = useState<MediaStream | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawColor, setDrawColor] = useState('#f1c40f'); // Neon gold as default

  // Tools sub-panel toggle
  const [activeToolDetail, setActiveToolDetail] = useState<'none' | 'youtube' | 'games' | 'pomodoro' | 'targets' | 'deadline' | 'loose'>('none');

  // Watch Together (YouTube) States
  const [youtubeVideoId, setYoutubeVideoId] = useState<string | null>(null);
  const [ytInputUrl, setYtInputUrl] = useState('');

  // Games Party States
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const [gameInviteInput, setGameInviteInput] = useState('');

  // Shared Pomodoro Timer States (Default 25 focus / 5 break)
  const [pomodoroFocusLength, setPomodoroFocusLength] = useState(25);
  const [pomodoroBreakLength, setPomodoroBreakLength] = useState(5);
  const [pomodoroMinutes, setPomodoroMinutes] = useState(25);
  const [pomodoroSeconds, setPomodoroSeconds] = useState(0);
  const [pomodoroIsRunning, setPomodoroIsRunning] = useState(false);
  const [pomodoroPhase, setPomodoroPhase] = useState<'focus' | 'break'>('focus');

  // Session Target States
  const [targetInputText, setTargetInputText] = useState('');
  const [targetsList, setTargetsList] = useState([
    { id: 't1', text: 'Finish arrays sheet', completed: true },
    { id: 't2', text: 'Two pointers practice', completed: true },
    { id: 't3', text: 'Sliding window notes', completed: true },
    { id: 't4', text: 'GATE mock test 1', completed: false },
    { id: 't5', text: 'Review binary search', completed: false }
  ]);
  const [targetsHistory, setTargetsHistory] = useState([
    { date: 'Jun 29', completedCount: 5, totalCount: 5 },
    { date: 'Jun 22', completedCount: 4, totalCount: 4 },
    { date: 'Jun 15', completedCount: 2, totalCount: 5 },
    { date: 'Jun 8', completedCount: 6, totalCount: 6 }
  ]);

  // Mini Deadline Clock States
  const [deadlineNewStepName, setDeadlineNewStepName] = useState('');
  const [isAddingDeadlineStep, setIsAddingDeadlineStep] = useState(false);
  const [deadlineSteps, setDeadlineSteps] = useState([
    { id: 'd1', name: 'Notes', minutes: 0 },
    { id: 'd2', name: 'Solve without hints', minutes: 0 },
    { id: 'd3', name: 'Solve with hint', minutes: 0 },
    { id: 'd4', name: 'Analyse', minutes: 0 },
    { id: 'd5', name: 'Notes', minutes: 0 }
  ]);
  const [deadlineActiveIndex, setDeadlineActiveIndex] = useState(0);
  const [deadlineTimerMinutes, setDeadlineTimerMinutes] = useState(0);
  const [deadlineTimerSeconds, setDeadlineTimerSeconds] = useState(0);
  const [deadlineIsRunning, setDeadlineIsRunning] = useState(false);

  // Loose Timer States
  const [looseNewStepName, setLooseNewStepName] = useState('');
  const [isAddingLooseStep, setIsAddingLooseStep] = useState(false);
  const [looseSteps, setLooseSteps] = useState([
    { id: 'l1', name: 'Notes', status: 'pending' as 'pending' | 'active' | 'completed', elapsedSeconds: 0 },
    { id: 'l2', name: 'Solve without hints', status: 'pending' as 'pending' | 'active' | 'completed', elapsedSeconds: 0 },
    { id: 'l3', name: 'Solve with hint', status: 'pending' as 'pending' | 'active' | 'completed', elapsedSeconds: 0 },
    { id: 'l4', name: 'Analyse', status: 'pending' as 'pending' | 'active' | 'completed', elapsedSeconds: 0 },
    { id: 'l5', name: 'Notes', status: 'pending' as 'pending' | 'active' | 'completed', elapsedSeconds: 0 }
  ]);
  const [looseActiveIndex, setLooseActiveIndex] = useState(0);
  const [looseTimerSeconds, setLooseTimerSeconds] = useState(0);
  const [looseIsRunning, setLooseIsRunning] = useState(false);

  // Guest Profile Identity State
  const [guestName, setGuestName] = useState('');
  const [guestColor, setGuestColor] = useState('');
  const [guestInitials, setGuestInitials] = useState('');
  const [guestPhotoURL, setGuestPhotoURL] = useState<string | null>(null);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [profileEditName, setProfileEditName] = useState('');
  const [profileEditColor, setProfileEditColor] = useState('');
  const [profileEditPhotoURL, setProfileEditPhotoURL] = useState('');

  // Spotlight view state
  const [spotlightParticipantId, setSpotlightParticipantId] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const themePickerRef = useRef<HTMLDivElement>(null);
  const sidebarMenuRef = useRef<HTMLDivElement>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [isFirestoreBlocked, setIsFirestoreBlocked] = useState(false);
  const hasSeenSelfInListRef = useRef(false);
  const currentSessionIdRef = useRef<string | null>(null);

  // Helper to determine role dynamically based on auth email and room creator
  const determineRole = (roomCreatorId?: string) => {
    const myId = getMyId();
    if (!myId) return 'member';
    const adminEmails = ['fijakhan7127@gmail.com', '000fijakhan123@gmail.com'];
    if (user && user.email && adminEmails.includes(user.email.toLowerCase())) {
      return 'admin';
    }
    if (roomCreatorId && myId === roomCreatorId) {
      return 'host';
    }
    return 'member';
  };

  // Helper to enforce kick permissions hierarchy
  const checkCanKick = (myRole: string, targetRole: string) => {
    if (targetRole === 'admin') return false; // Nobody can kick admin
    if (myRole === 'admin') return true; // Admin can kick anybody
    if (targetRole === 'host') return false; // Nobody except admin can kick host
    if (myRole === 'host' && (targetRole === 'cohost' || targetRole === 'member')) return true; // Host kicks cohost/member
    if (myRole === 'cohost' && targetRole === 'member') return true; // Cohost kicks member
    return false;
  };

  // Helper to enforce mute permissions hierarchy
  const checkCanMute = (myRole: string, targetRole: string) => {
    if (targetRole === 'admin') return false; // Nobody can mute admin
    if (myRole === 'admin') return true; // Admin can mute anybody
    if (targetRole === 'host') return false; // Nobody except admin can mute host
    if (myRole === 'host' && (targetRole === 'cohost' || targetRole === 'member')) return true; // Host mutes cohost/member
    if (myRole === 'cohost' && targetRole === 'member') return true; // Cohost mutes member
    return false;
  };

  // Client-side garbage collection for empty custom rooms older than 3 minutes
  useEffect(() => {
    const cleanupInterval = setInterval(async () => {
      const now = new Date().getTime();
      const roomsToDelete: string[] = [];
      
      rooms.forEach(room => {
        if (currentRoom && room.id === roomDocId(currentRoom)) return;
        
        const participants = roomsParticipants[room.id] || [];
        if (participants.length === 0) {
          const createdTime = room.createdAt ? new Date(room.createdAt).getTime() : now;
          const ageMinutes = (now - createdTime) / 60000;
          if (ageMinutes >= 3) {
            roomsToDelete.push(room.id);
          }
        }
      });
      
      for (const rid of roomsToDelete) {
        try {
          // Remove from localStorage first
          const local = getLocalRooms();
          const updatedLocal = local.filter(r => r.id !== rid);
          localStorage.setItem('skulk_local_rooms', JSON.stringify(updatedLocal));

          await deleteDoc(doc(db, 'rooms', rid));
          console.log(`Garbage collected empty room: ${rid}`);
          showToast(`Cleaned up empty room: ${rid}`);
        } catch (e) {
          console.warn(`Failed to garbage collect room ${rid}:`, e);
        }
      }
    }, 10000); // Check every 10 seconds for faster testing response
    
    return () => clearInterval(cleanupInterval);
  }, [rooms, roomsParticipants, currentRoom]);

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
          setGuestPhotoURL(data.photoURL || null);
          setProfileEditName(data.name);
          setProfileEditColor(data.color);
          setProfileEditPhotoURL(data.photoURL || '');
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
    setGuestPhotoURL(null);
    setProfileEditName(name);
    setProfileEditColor(randomColor);
    setProfileEditPhotoURL('');
    
    localStorage.setItem('skulk_guest_identity', JSON.stringify({ name, color: randomColor, initials, photoURL: null }));
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
            color: guestColor,
            photoURL: user ? user.photoURL : guestPhotoURL
          };
        }
        return p;
      }));
    }
  }, [guestName, guestColor, guestInitials, guestPhotoURL, currentRoom, user]);

  // Cleanup old pre-existing default rooms from Firestore if they exist
  useEffect(() => {
    const defaultIds = ['dsa123', 'gate45', 'ielts9', 'study5'];
    defaultIds.forEach(async (id) => {
      try {
        await deleteDoc(doc(db, 'rooms', id));
      } catch (e) {}
    });
  }, []);

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
      // User dropdown click outside close
      if (userDropdownRef.current && !userDropdownRef.current.contains(e.target as Node)) {
        setIsUserDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Listen to Firebase authentication status
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthLoading(false);
      
      if (currentUser) {
        // Override guest identity with Google sign-in details
        const name = currentUser.displayName || 'Google User';
        setGuestName(name);
        
        // Generate initials
        const parts = name.trim().split(/\s+/);
        const initials = parts.length >= 2 
          ? (parts[0][0] + parts[1][0]).toUpperCase() 
          : name.substring(0, 2).toUpperCase();
        setGuestInitials(initials);
        
        // Sync into active call if in a room
        setCallParticipants(prev => prev.map(p => {
          if (p.id === 'user_you') {
            return {
              ...p,
              name: `${name} (You)`,
              initials: initials,
              color: '#8b5cf6',
              photoURL: currentUser.photoURL
            };
          }
          return p;
        }));
      } else {
        // Re-read local guest profile when logged out
        const stored = localStorage.getItem('skulk_guest_identity');
        if (stored) {
          try {
            const data = JSON.parse(stored);
            setGuestName(data.name || '');
            setGuestColor(data.color || '#8b5cf6');
            setGuestInitials(data.initials || 'G');
            setGuestPhotoURL(data.photoURL || null);
            
            // Sync into active call if in a room
            setCallParticipants(prev => prev.map(p => {
              if (p.id === 'user_you') {
                return {
                  ...p,
                  name: `${data.name} (You)`,
                  initials: data.initials,
                  color: data.color,
                  photoURL: data.photoURL || null
                };
              }
              return p;
            }));
          } catch (e) {
            // ignore
          }
        }
      }
    });
    return () => unsubscribe();
  }, [currentRoom]);

  const handleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      showToast('Signed in successfully!');
    } catch (error: any) {
      console.error('Sign-in error:', error);
      showToast(`Sign-in failed: ${error.message}`);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setIsUserDropdownOpen(false);
      showToast('Signed out.');
    } catch (error: any) {
      console.error('Sign-out error:', error);
      showToast('Sign-out failed');
    }
  };

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
    if (!user) {
      setShowSignInPrompt(true);
      return;
    }
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

  // Helper to extract room identifier (e.g. ielts9 from skulk.app/room/ielts9)
  const getRoomIdFromLink = (link?: string) => {
    if (!link) return '';
    const parts = link.split('/');
    return parts[parts.length - 1];
  };

  // Canonical Firestore room ID — always matches the URL slug so all users sync to the same room
  const roomDocId = (room: Room | null | undefined) => {
    if (!room) return '';
    return getRoomIdFromLink(room.link) || room.id;
  };

  const getMyId = () => user ? user.uid : (guestId || localStorage.getItem('skulk_guest_id') || '');

  const updateMySharing = async (fields: Record<string, unknown>) => {
    const myId = getMyId();
    const rid = roomDocId(currentRoom);
    if (!myId || !rid) return;
    try {
      await updateDoc(doc(db, 'rooms', rid, 'participants', myId), fields);
    } catch (e) {
      console.warn('Failed to update sharing state:', e);
    }
  };

  const clearMySharing = async () => {
    await updateMySharing({ sharing: null, sharingYoutubeId: null, whiteboardData: '' });
  };

  const handleViewParticipantShare = (p: Participant) => {
    if (!p.sharing) return;
    const myId = getMyId();
    if (p.sharing === 'screen' && p.id !== myId) {
      showToast(`${p.name.replace(' (You)', '')} is sharing their screen — only they can see it live.`);
      return;
    }
    setViewingShare({
      participantId: p.id,
      type: p.sharing,
      youtubeVideoId: p.sharingYoutubeId || undefined,
    });
  };

  // const renderSharingBadge = (sharing: Participant['sharing']) => {
  //   if (!sharing) return null;
  //   const icons: Record<string, string> = { youtube: '▶', whiteboard: '✎', screen: '⛶' };
  //   const titles: Record<string, string> = {
  //     youtube: 'Sharing YouTube — click to watch',
  //     whiteboard: 'Sharing whiteboard — click to view',
  //     screen: 'Sharing screen — click to view',
  //   };
  //   return (
  //     <span className="sharing-badge" title={titles[sharing]}>
  //       {icons[sharing]}
  //     </span>
  //   );
  // };

  const leavePresence = async (roomIdToLeave: string, sessionIdToDelete?: string | null) => {
    const myId = getMyId();
    if (!myId || !roomIdToLeave) return;

    const performLeave = async () => {
      try {
        const presenceDocRef = doc(db, 'rooms', roomIdToLeave, 'participants', myId);
        
        await runTransaction(db, async (transaction) => {
          const snap = await transaction.get(presenceDocRef);
          if (snap.exists()) {
            const data = snap.data();
            if (!sessionIdToDelete || data.sessionId === sessionIdToDelete) {
              transaction.delete(presenceDocRef);
            } else {
              console.log('leavePresence bypassed: presence belongs to a newer session (transaction).');
            }
          }
        });

        // Delete any signals associated with this user
        const signalsRef = collection(db, 'rooms', roomIdToLeave, 'signals');
        const snapshot = await getDocs(signalsRef);
        for (const docSnap of snapshot.docs) {
          if (docSnap.id.includes(myId)) {
            try {
              // Delete candidates subcollection first
              const candidatesRef = collection(db, 'rooms', roomIdToLeave, 'signals', docSnap.id, 'candidates');
              const candSnap = await getDocs(candidatesRef);
              for (const d of candSnap.docs) {
                try { await deleteDoc(d.ref); } catch (e) {}
              }
              await deleteDoc(docSnap.ref);
            } catch (e) {}
          }
        }
        // Delete my join request doc if any exists
        await deleteDoc(doc(db, 'rooms', roomIdToLeave, 'joinRequests', myId));
      } catch (e) {
        console.error('Error removing presence document:', e);
      }
    };

    globalPendingLeavePromise = (globalPendingLeavePromise || Promise.resolve())
      .then(performLeave)
      .catch(() => {});
      
    await globalPendingLeavePromise;
  };

  const canJoin = async (targetRoom: Room) => {
    const adminEmails = ['fijakhan7127@gmail.com', '000fijakhan123@gmail.com'];
    if (user && user.email && adminEmails.includes(user.email.toLowerCase())) {
      return true; // Admin bypasses room capacity limit!
    }
    const myId = user ? user.uid : (guestId || localStorage.getItem('skulk_guest_id') || '');
    if (!myId) return false;
    try {
      const presenceRef = collection(db, 'rooms', targetRoom.id, 'participants');
      const snapshot = await getDocs(presenceRef);
      const activeParts = snapshot.docs.map(doc => doc.id);
      
      if (activeParts.length >= (targetRoom.maxParticipants || 10) && !activeParts.includes(myId)) {
        return false;
      }
    } catch (e) {
      console.warn("Failed to check room capacity in Firestore, allowing access (Offline Fallback):", e);
    }
    return true;
  };

  // Join Room Handlers (wiring direct vs pending status)
  const handleJoinRoomClick = async (room: Room) => {
    const id = getRoomIdFromLink(room.link);
    const allowed = await canJoin(room);
    if (!allowed) {
      showToast(`This room is full (${room.maxParticipants}/${room.maxParticipants})`);
      return;
    }

    const myId = getMyId();
    const isCreator = room.creatorId === myId;

    if (room.type === 'public') {
      window.open(`/room/${id}`, '_blank');
    } else if (room.type === 'public-ask') {
      const myRole = determineRole(room.creatorId);
      if (isCreator || myRole === 'admin') {
        window.open(`/room/${id}`, '_blank');
      } else {
        // Show waiting modal triggering the request status useEffect
        setPendingJoinRoom(room);
      }
    }
  };

  // Setup conference shell room data
  const enterCallRoom = async (room: Room) => {
    if (globalPendingLeavePromise) {
      try {
        await globalPendingLeavePromise;
      } catch (e) {}
    }
    const normalizedRoom = { ...room, id: roomDocId(room) };
    const myId = getMyId();
    const newSessionId = Math.random().toString(36).substring(2, 10);
    currentSessionIdRef.current = newSessionId;
    hasSeenSelfInListRef.current = false; // Reset on initial join
    if (myId) {
      const myRole = determineRole(normalizedRoom.creatorId);
      try {
        const presenceRef = doc(db, 'rooms', normalizedRoom.id, 'participants', myId);
        await setDoc(presenceRef, {
          uid: myId,
          name: user ? user.displayName || 'Google User' : guestName,
          photoURL: user ? user.photoURL : guestPhotoURL,
          initials: guestInitials,
          color: guestColor,
          joinedAt: new Date().toISOString(),
          sharing: null,
          role: myRole,
          mutedBy: myId,
          camOffBy: myId,
          sessionId: newSessionId
        });
      } catch (err) {
        console.warn("Failed to set presence in Firestore, joining locally:", err);
      }
    }

    setCurrentRoom(normalizedRoom);
    setIsMicMuted(false);
    setIsCamOff(false);
    setIsGalleryView(false);
    setCallTab('chat');
    setViewingShare(null);
    setChatMessages([]);

    // Fetch LiveKit Token
    try {
      const myId = getMyId();
      const myName = user ? user.displayName || 'Google User' : guestName;
      const res = await fetch(`/api/get-livekit-token?room=${normalizedRoom.id}&identity=${myId}&name=${encodeURIComponent(myName)}`);
      const data = await res.json();
      if (data.token) {
        setLiveKitToken(data.token);
      } else {
        showToast("⚠️ Failed to connect to LiveKit server");
      }
    } catch (e) {
      console.warn("Failed to fetch token:", e);
      showToast("⚠️ Failed to fetch LiveKit token");
    }

    // Set initial presence (both true or false depending on your preference, we default to unmuted/on)
    if (myId) {
      try {
        await updateDoc(doc(db, 'rooms', normalizedRoom.id, 'participants', myId), {
          isMuted: false,
          isCamOff: false,
          mutedBy: myId,
          camOffBy: myId
        });
      } catch (e) {}
    }
  };

  const handleLeaveCall = () => {
    hasSeenSelfInListRef.current = false;
    if (currentRoom) {
      const prevRoomId = roomDocId(currentRoom);
      leavePresence(prevRoomId, currentSessionIdRef.current);
      clearMySharing();
      setCurrentRoom(null);
      setCallParticipants([]);
      setChatMessages([]);
      setViewingShare(null);
      setLiveKitToken(null);
    }
    navigate('/');
  };

  const toggleMic = async () => {
    const nextVal = !isMicMuted;
    setIsMicMuted(nextVal);
    await updateMySharing({ isMuted: nextVal, mutedBy: getMyId() });
  };

  const toggleCamera = async () => {
    const nextVal = !isCamOff;
    setIsCamOff(nextVal);
    await updateMySharing({ isCamOff: nextVal, camOffBy: getMyId() });
  };

  // Synchronize route changes with active room state (handles back/forward buttons)
  useEffect(() => {
    if (isAuthLoading) return;
    
    if (roomId) {
      const currentRoomId = currentRoom ? getRoomIdFromLink(currentRoom.link) : null;
      if (!currentRoom || currentRoomId !== roomId) {
        const match = rooms.find(r => getRoomIdFromLink(r.link) === roomId);
        const roomObj = match || {
          id: roomId,
          name: `Room - ${roomId}`,
          type: 'public',
          buttonText: 'Join',
          participants: [],
          maxParticipants: 10,
          link: `http://skulk.vercel.app/room/${roomId}`
        };
        
        canJoin(roomObj).then(async (allowed) => {
          if (!allowed) {
            showToast(`This room is full (${roomObj.maxParticipants}/${roomObj.maxParticipants})`);
            navigate('/');
            return;
          }
          
          const myId = getMyId();
          const isCreator = roomObj.creatorId === myId;
          
          const myRole = determineRole(roomObj.creatorId);
          if (roomObj.type === 'public-ask' && !isCreator && myRole !== 'admin') {
            // Halt user and verify presence status in joinRequests document
            try {
              const reqDocRef = doc(db, 'rooms', roomObj.id, 'joinRequests', myId);
              const reqDocSnap = await getDoc(reqDocRef);
              const isAlreadyApproved = reqDocSnap.exists() && reqDocSnap.data()?.status === 'approved';
              if (!isAlreadyApproved) {
                setPendingJoinRoom(roomObj);
                return;
              }
            } catch (e) {
              console.warn("Direct link capacity verification failed, joining room.");
            }
          }
          
          enterCallRoom(roomObj);
        });
      }
    } else {
      if (currentRoom) {
        const prevRoomId = roomDocId(currentRoom);
        leavePresence(prevRoomId, currentSessionIdRef.current);
        clearMySharing();
        setCurrentRoom(null);
        setCallParticipants([]);
        setChatMessages([]);
        setViewingShare(null);
        setLiveKitToken(null);
      }
    }
  }, [roomId, rooms, user, guestId, isAuthLoading, currentRoom]);

  // Clean up presence when component unmounts or call ends
  useEffect(() => {
    const sessionIdToClean = currentSessionIdRef.current;
    return () => {
      if (currentRoom) {
        const prevRoomId = roomDocId(currentRoom);
        leavePresence(prevRoomId, sessionIdToClean);
      }
    };
  }, [currentRoom]);



  // Update or migrate Firestore presence document when authentication state changes
  useEffect(() => {
    if (!currentRoom) return;
    
    const syncAuthPresence = async () => {
      const myId = getMyId();
      if (!myId) return;
      const rid = roomDocId(currentRoom);

      // If user signed in, remove the old guest presence document
      if (user) {
        const storedGid = localStorage.getItem('skulk_guest_id');
        if (storedGid && storedGid !== user.uid) {
          try {
            await deleteDoc(doc(db, 'rooms', rid, 'participants', storedGid));
          } catch (e) {
            // ignore
          }
        }
      }
      
      const myRole = determineRole(currentRoom.creatorId);
      const presenceRef = doc(db, 'rooms', rid, 'participants', myId);
      await setDoc(presenceRef, {
        uid: myId,
        name: user ? user.displayName || 'Google User' : guestName,
        photoURL: user ? user.photoURL : guestPhotoURL,
        initials: guestInitials,
        color: guestColor,
        joinedAt: new Date().toISOString(),
        role: myRole,
        mutedBy: myId,
        camOffBy: myId
      }, { merge: true });
    };
    
    syncAuthPresence();
  }, [user, currentRoom, guestName, guestInitials, guestColor, guestPhotoURL, guestId]);

  // Clean up presence immediately on tab/browser close using fetch keepalive
  useEffect(() => {
    const handleUnload = () => {
      if (currentRoom) {
        const myId = getMyId();
        const rid = roomDocId(currentRoom);
        if (myId && rid) {
          const url = `https://firestore.googleapis.com/v1/projects/skulk-45c23/databases/(default)/documents/rooms/${rid}/participants/${myId}`;
          fetch(url, { method: 'DELETE', keepalive: true }).catch(() => {});
        }
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [currentRoom, user, guestId]);

  // Real-time synchronization of call participants list inside calls
  useEffect(() => {
    if (!currentRoom) return;
    
    hasSeenSelfInListRef.current = false; // Reset on every subscription/auth change to block race conditions!
    const rid = roomDocId(currentRoom);
    const presenceRef = collection(db, 'rooms', rid, 'participants');
    const unsubscribe = onSnapshot(presenceRef, (snapshot) => {
      const myId = getMyId();
      const list = snapshot.docs.map(docSnap => {
        const data = docSnap.data();
        const isMe = docSnap.id === myId;
        
        return {
          id: docSnap.id,
          name: isMe ? `${data.name} (You)` : data.name,
          initials: data.initials,
          color: data.color,
          photoURL: data.photoURL,
          isMuted: isMe ? isMicMuted : (data.isMuted ?? false),
          isCamOff: isMe ? isCamOff : (data.isCamOff ?? false),
          isSpeaking: false,
          isPinned: false,
          role: data.role || (currentRoom.creatorId === docSnap.id ? 'host' : 'member'),
          sharing: data.sharing || null,
          sharingYoutubeId: data.sharingYoutubeId || null,
          whiteboardData: data.whiteboardData,
          mutedBy: data.mutedBy || null,
          camOffBy: data.camOffBy || null,
        } as Participant;
      });

      // Kick detection: Only trigger if we have seen ourselves in the active list first to prevent join race conditions
      const meStillInRoom = list.some(p => p.id === myId);
      if (myId && meStillInRoom) {
        hasSeenSelfInListRef.current = true;
      }
      
      if (myId && hasSeenSelfInListRef.current && !meStillInRoom) {
        showToast("❌ You have been removed from the room by a host.");
        handleLeaveCall();
        return;
      }
      
      setCallParticipants(list);
    }, (error) => {
      console.warn("Firestore call presence subscription failed, falling back to local user presence:", error);
      const myId = getMyId();
      setCallParticipants([
        {
          id: myId,
          name: `${user ? user.displayName || 'Google User' : guestName} (You)`,
          initials: guestInitials,
          color: guestColor,
          photoURL: user ? user.photoURL : null,
          isMuted: isMicMuted,
          isCamOff: isCamOff,
          isSpeaking: false,
          isPinned: false,
          role: determineRole(currentRoom.creatorId)
        }
      ]);
    });
    
    return () => unsubscribe();
  }, [currentRoom, user, guestId, isMicMuted, isCamOff]);
  // Synchronize remote mute actions with local microphone state
  useEffect(() => {
    if (!currentRoom) return;
    const myId = getMyId();
    const myPresence = callParticipants.find(p => p.id === myId);
    if (myPresence && myPresence.isMuted !== isMicMuted) {
      // ONLY apply remote changes if they were initiated by another user (moderator)
      if (myPresence.mutedBy && myPresence.mutedBy !== myId) {
        setIsMicMuted(myPresence.isMuted);
        showToast(myPresence.isMuted ? "🎤 You have been muted by a host." : "🎤 You have been unmuted by a host.");
      }
    }
  }, [callParticipants, currentRoom, isMicMuted]);

  // Synchronize remote camera actions with local camera state
  useEffect(() => {
    if (!currentRoom) return;
    const myId = getMyId();
    const myPresence = callParticipants.find(p => p.id === myId);
    if (myPresence && myPresence.isCamOff !== isCamOff) {
      // ONLY apply remote changes if they were initiated by another user (moderator)
      if (myPresence.camOffBy && myPresence.camOffBy !== myId) {
        setIsCamOff(myPresence.isCamOff);
        showToast(myPresence.isCamOff ? "📷 Your camera has been turned off by a host." : "📷 Your camera has been turned on by a host.");
      }
    }
  }, [callParticipants, currentRoom, isCamOff]);

  // Listen to pending join requests (for Admin, Host, Co-host)
  useEffect(() => {
    if (!currentRoom) return;
    const myId = getMyId();
    const myRole = callParticipants.find(p => p.id === myId)?.role || 'member';
    
    if (myRole !== 'admin' && myRole !== 'host' && myRole !== 'cohost') {
      setPendingRequests([]);
      return;
    }
    
    const rid = roomDocId(currentRoom);
    const requestsRef = collection(db, 'rooms', rid, 'joinRequests');
    
    const unsubscribe = onSnapshot(requestsRef, (snapshot) => {
      const reqList = snapshot.docs
        .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
        .filter((req: any) => req.status === 'pending');
      setPendingRequests(reqList);
    });
    
    return () => unsubscribe();
  }, [currentRoom, callParticipants]);

  // Listen to the local user's own join request status (when waiting to join)
  useEffect(() => {
    if (!pendingJoinRoom) return;
    const myId = getMyId();
    const rid = roomDocId(pendingJoinRoom);
    
    const reqDoc = doc(db, 'rooms', rid, 'joinRequests', myId);
    setDoc(reqDoc, {
      id: myId,
      uid: myId,
      name: user ? user.displayName || 'Google User' : guestName,
      initials: guestInitials,
      color: guestColor,
      status: 'pending',
      requestedAt: new Date().toISOString()
    }).catch(e => console.warn("Failed to create join request:", e));
    
    const unsubscribe = onSnapshot(reqDoc, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.status === 'approved') {
        const targetRoom = pendingJoinRoom;
        setPendingJoinRoom(null);
        if (window.location.pathname.startsWith('/room/')) {
          enterCallRoom(targetRoom);
        } else {
          window.open(`/room/${targetRoom.id}`, '_blank');
        }
      } else if (data.status === 'denied') {
        setPendingJoinRoom(null);
        showToast(`❌ Join request was denied by the hosts.`);
        if (window.location.pathname.startsWith('/room/')) {
          navigate('/');
        }
      }
    });
    
    return () => {
      unsubscribe();
      deleteDoc(reqDoc).catch(() => {});
    };
  }, [pendingJoinRoom, user, guestName, guestInitials, guestColor]);

  const handleApproveRequest = async (req: any) => {
    if (!currentRoom) return;
    const rid = roomDocId(currentRoom);
    try {
      await setDoc(doc(db, 'rooms', rid, 'joinRequests', req.id), { status: 'approved' }, { merge: true });
      showToast(`Accepted ${req.name}'s request.`);
    } catch (e) {
      console.warn("Failed to approve request:", e);
    }
  };

  const handleDenyRequest = async (req: any) => {
    if (!currentRoom) return;
    const rid = roomDocId(currentRoom);
    try {
      await setDoc(doc(db, 'rooms', rid, 'joinRequests', req.id), { status: 'denied' }, { merge: true });
      showToast(`Denied ${req.name}'s request.`);
    } catch (e) {
      console.warn("Failed to deny request:", e);
    }
  };
  // Real-time synchronization of room document updates (Pomodoro, etc.)
  useEffect(() => {
    if (!currentRoom) return;
    
    const roomRef = doc(db, 'rooms', roomDocId(currentRoom));
    const unsubscribe = onSnapshot(roomRef, (docSnap) => {
      if (!docSnap.exists()) {
        showToast("⚠️ This room has been closed by the host.");
        handleLeaveCall();
        return;
      }
      const data = docSnap.data();
      
      // Update room metadata in state to sync Firestore room name
      setCurrentRoom(prev => {
        if (!prev) return null;
        if (prev.name === data.name && prev.creatorName === data.creatorName && prev.type === data.type) {
          return prev;
        }
        return {
          ...prev,
          name: data.name || prev.name,
          creatorName: data.creatorName || prev.creatorName,
          type: data.type || prev.type
        };
      });

      // Sync Pomodoro (shared room tool — still room-level)
      if (data.pomodoroIsRunning !== undefined) {
        setPomodoroIsRunning(data.pomodoroIsRunning);
      }
      if (data.pomodoroMinutes !== undefined && !pomodoroIsRunning) {
        setPomodoroMinutes(data.pomodoroMinutes);
      }
      if (data.pomodoroSeconds !== undefined && !pomodoroIsRunning) {
        setPomodoroSeconds(data.pomodoroSeconds);
      }
      if (data.pomodoroPhase !== undefined) {
        setPomodoroPhase(data.pomodoroPhase);
      }
    }, (error) => {
      console.warn("Room document subscription failed:", error);
    });
    
    return () => unsubscribe();
  }, [currentRoom, pomodoroIsRunning]);

  // Sync whiteboard canvas from the participant being viewed
  useEffect(() => {
    if (!viewingShare || viewingShare.type !== 'whiteboard' || !currentRoom) return;

    const partRef = doc(db, 'rooms', roomDocId(currentRoom), 'participants', viewingShare.participantId);
    const unsubscribe = onSnapshot(partRef, (snapshot) => {
      if (!snapshot.exists()) return;
      const data = snapshot.data();
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (data.whiteboardData !== undefined) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          if (!data.whiteboardData) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
          } else {
            const img = new Image();
            img.onload = () => {
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(img, 0, 0);
            };
            img.src = data.whiteboardData;
          }
        }
      }
      // Close view if sharer stopped sharing
      if (!data.sharing && viewingShare.participantId !== getMyId()) {
        setViewingShare(null);
      }
    });
    return () => unsubscribe();
  }, [viewingShare, currentRoom, user, guestId]);

  // Sync YouTube video ID when viewing someone's share
  useEffect(() => {
    if (!viewingShare || viewingShare.type !== 'youtube' || !currentRoom) return;

    const partRef = doc(db, 'rooms', roomDocId(currentRoom), 'participants', viewingShare.participantId);
    const unsubscribe = onSnapshot(partRef, (snapshot) => {
      if (!snapshot.exists()) return;
      const data = snapshot.data();
      if (data.sharingYoutubeId) {
        setViewingShare(prev => prev ? { ...prev, youtubeVideoId: data.sharingYoutubeId } : null);
      }
      if (!data.sharing && viewingShare.participantId !== getMyId()) {
        setViewingShare(null);
      }
    });
    return () => unsubscribe();
  }, [viewingShare?.participantId, viewingShare?.type, currentRoom, user, guestId]);

  // Real-time synchronization of chat messages inside calls
  useEffect(() => {
    if (!currentRoom) return;
    
    const messagesRef = collection(db, 'rooms', roomDocId(currentRoom), 'messages');
    
    const unsubscribe = onSnapshot(messagesRef, (snapshot) => {
      const list = snapshot.docs.map(docSnap => docSnap.data() as ChatMessage);
      // Sort client-side by createdAt to prevent query index requirements
      list.sort((a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeA - timeB;
      });
      setChatMessages(list);
    }, (error) => {
      console.warn("Firestore chat subscription failed:", error);
    });
    
    return () => unsubscribe();
  }, [currentRoom]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages]);

  // Clean up screen presenting tracks when leaving call
  useEffect(() => {
    if (!currentRoom) {
      if (screenShareStream) {
        screenShareStream.getTracks().forEach(track => track.stop());
        setScreenShareStream(null);
      }
      setViewingShare(null);
    }
  }, [currentRoom, screenShareStream]);

  // Bind screen presenter stream to video element
  useEffect(() => {
    if (videoRef.current && screenShareStream) {
      videoRef.current.srcObject = screenShareStream;
    }
  }, [screenShareStream]);

  // Resize canvas when whiteboard view opens or draw color changes
  useEffect(() => {
    if (viewingShare?.type === 'whiteboard' && canvasRef.current) {
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
  }, [viewingShare?.type]);

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

  const stopDrawing = async () => {
    setIsDrawing(false);
    const canvas = canvasRef.current;
    const myId = getMyId();
    if (canvas && currentRoom && viewingShare?.participantId === myId && viewingShare?.type === 'whiteboard') {
      const dataUrl = canvas.toDataURL();
      try {
        await updateDoc(doc(db, 'rooms', roomDocId(currentRoom), 'participants', myId), { whiteboardData: dataUrl });
      } catch (e) {
        console.warn("Failed to sync whiteboard to Firestore:", e);
      }
    }
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

  const clearCanvas = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    showToast('Whiteboard cleared');
    if (currentRoom) {
      const myId = getMyId();
      try {
        await updateDoc(doc(db, 'rooms', roomDocId(currentRoom), 'participants', myId), { whiteboardData: '' });
      } catch (e) {
        console.warn("Failed to clear whiteboard in Firestore:", e);
      }
    }
  };

  // Screen share trigger
  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      });
      setScreenShareStream(stream);
      const myId = getMyId();
      await updateMySharing({ sharing: 'screen' });
      setViewingShare({ participantId: myId, type: 'screen' });
      
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          stopScreenShare();
        };
      }
      showToast('Screen sharing started — others can see the badge on your avatar');
    } catch (err) {
      console.error('Error starting screen share:', err);
      showToast('Screen share failed or cancelled');
    }
  };

  const stopScreenShare = async () => {
    if (screenShareStream) {
      screenShareStream.getTracks().forEach(track => track.stop());
      setScreenShareStream(null);
    }
    await clearMySharing();
    if (viewingShare?.type === 'screen') {
      setViewingShare(null);
    }
    showToast('Screen sharing stopped');
  };

  // Watch Together Submit Handler
  const handleWatchTogetherSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ytInputUrl.trim() || !currentRoom) return;

    const videoId = extractYoutubeVideoId(ytInputUrl.trim());
    if (videoId) {
      setYtInputUrl('');
      const myId = getMyId();
      setYoutubeVideoId(videoId);

      try {
        await updateMySharing({ sharing: 'youtube', sharingYoutubeId: videoId, whiteboardData: '' });
        setViewingShare({ participantId: myId, type: 'youtube', youtubeVideoId: videoId });
        showToast('YouTube video loaded — others can click your avatar to watch');
      } catch (err) {
        console.warn("Failed to update YouTube sharing state:", err);
        setViewingShare({ participantId: myId, type: 'youtube', youtubeVideoId: videoId });
        showToast('YouTube video loaded locally!');
      }
    } else {
      showToast('Invalid YouTube URL. Please paste a valid link.');
    }
  };

  const extractYoutubeVideoId = (url: string) => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  };

  // Games Action Handlers
  const handleLaunchGame = (gameId: string) => {
    if (gameId === 'agar' || gameId === 'slither') {
      const url = gameId === 'agar' ? 'https://agar.io' : 'https://slither.io';
      window.open(url, '_blank');
      showToast(`Opened ${gameId === 'agar' ? 'Agar.io' : 'Slither.io'} in a new tab!`);
      setActiveToolDetail('none'); // Return to main panel
    } else {
      // Invite games
      setActiveGameId(gameId);
      const randomId = Math.random().toString(36).substring(2, 8);
      let prefilledLink = '';
      if (gameId === 'codenames') prefilledLink = `https://codenames.game/room/sklk-${randomId}`;
      if (gameId === 'skribbl') prefilledLink = `https://skribbl.io/?room=sklk-${randomId}`;
      if (gameId === 'jklm') prefilledLink = `https://jklm.fun/room/sklk-${randomId}`;
      setGameInviteInput(prefilledLink);
    }
  };

  const handleShareGameInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!gameInviteInput.trim()) return;

    // Open link in new tab
    window.open(gameInviteInput.trim(), '_blank');

    // Automatically post message to the room chat from "You"
    const gameNames: Record<string, string> = {
      codenames: 'Codenames',
      skribbl: 'Skribbl.io',
      jklm: 'JKLM.fun'
    };
    const gameName = gameNames[activeGameId || ''] || 'a game';
    
    const newMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: 'You',
      text: `🎮 Let's play ${gameName}! Join here: ${gameInviteInput.trim()}`
    };
    setChatMessages(prev => [...prev, newMsg]);

    showToast(`Invite link shared in chat!`);
    setActiveGameId(null);
    setActiveToolDetail('none');
  };

  // Pomodoro countdown effect
  useEffect(() => {
    let interval: any = null;
    if (pomodoroIsRunning) {
      interval = setInterval(() => {
        if (pomodoroSeconds > 0) {
          setPomodoroSeconds(prev => prev - 1);
        } else if (pomodoroMinutes > 0) {
          setPomodoroMinutes(prev => prev - 1);
          setPomodoroSeconds(59);
        } else {
          // Transition phase
          if (pomodoroPhase === 'focus') {
            setPomodoroPhase('break');
            setPomodoroMinutes(pomodoroBreakLength);
            setPomodoroSeconds(0);
            showToast('Focus session complete! Time for a short break.');
          } else {
            setPomodoroPhase('focus');
            setPomodoroMinutes(pomodoroFocusLength);
            setPomodoroSeconds(0);
            showToast('Break complete! Back to focus.');
          }
        }
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [pomodoroIsRunning, pomodoroMinutes, pomodoroSeconds, pomodoroPhase, pomodoroFocusLength, pomodoroBreakLength]);

  // Helper cleanups on leave room
  useEffect(() => {
    if (!currentRoom) {
      setPomodoroIsRunning(false);
      setPomodoroPhase('focus');
      setPomodoroMinutes(pomodoroFocusLength);
      setPomodoroSeconds(0);
      setYoutubeVideoId(null);
      setActiveToolDetail('none');
      setActiveGameId(null);

      // Reset Target list inputs
      setTargetInputText('');

      // Reset Deadline timer
      setDeadlineIsRunning(false);
      setDeadlineActiveIndex(0);
      setDeadlineTimerMinutes(0);
      setDeadlineTimerSeconds(0);

      // Reset Loose timer
      setLooseIsRunning(false);
      setLooseActiveIndex(0);
      setLooseTimerSeconds(0);
      setLooseSteps(prev => prev.map(s => ({ ...s, status: 'pending' as const, elapsedSeconds: 0 })));
    }
  }, [currentRoom, pomodoroFocusLength]);

  const togglePomodoro = async () => {
    const nextVal = !pomodoroIsRunning;
    if (currentRoom) {
      try {
        await updateDoc(doc(db, 'rooms', roomDocId(currentRoom)), { 
          pomodoroIsRunning: nextVal,
          pomodoroMinutes,
          pomodoroSeconds,
          pomodoroPhase
        });
      } catch {
        setPomodoroIsRunning(nextVal);
      }
    } else {
      setPomodoroIsRunning(nextVal);
    }
  };

  const skipPomodoroPhase = async () => {
    let nextPhase: 'focus' | 'break' = 'focus';
    let nextMinutes = pomodoroFocusLength;
    if (pomodoroPhase === 'focus') {
      nextPhase = 'break';
      nextMinutes = pomodoroBreakLength;
    }
    
    if (currentRoom) {
      try {
        await updateDoc(doc(db, 'rooms', roomDocId(currentRoom)), {
          pomodoroPhase: nextPhase,
          pomodoroMinutes: nextMinutes,
          pomodoroSeconds: 0
        });
        showToast(`Skipped to ${nextPhase} phase`);
      } catch {
        // local fallback
        setPomodoroPhase(nextPhase);
        setPomodoroMinutes(nextMinutes);
        setPomodoroSeconds(0);
      }
    } else {
      setPomodoroPhase(nextPhase);
      setPomodoroMinutes(nextMinutes);
      setPomodoroSeconds(0);
    }
  };

  const adjustPomodoroLength = async (type: 'focus' | 'break', amount: number) => {
    let nextFocus = pomodoroFocusLength;
    let nextBreak = pomodoroBreakLength;
    if (type === 'focus') {
      nextFocus = Math.max(1, pomodoroFocusLength + amount);
      setPomodoroFocusLength(nextFocus);
      if (!pomodoroIsRunning && pomodoroPhase === 'focus') {
        setPomodoroMinutes(nextFocus);
        setPomodoroSeconds(0);
      }
    } else {
      nextBreak = Math.max(1, pomodoroBreakLength + amount);
      setPomodoroBreakLength(nextBreak);
      if (!pomodoroIsRunning && pomodoroPhase === 'break') {
        setPomodoroMinutes(nextBreak);
        setPomodoroSeconds(0);
      }
    }
    
    if (currentRoom) {
      try {
        await updateDoc(doc(db, 'rooms', roomDocId(currentRoom)), {
          pomodoroMinutes: !pomodoroIsRunning && pomodoroPhase === 'focus' ? nextFocus : (!pomodoroIsRunning && pomodoroPhase === 'break' ? nextBreak : pomodoroMinutes),
          pomodoroSeconds: !pomodoroIsRunning ? 0 : pomodoroSeconds
        });
      } catch (e) {
        // ignore
      }
    }
  };

  // Session Target Handlers
  const handleAddTarget = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetInputText.trim()) return;
    setTargetsList(prev => [...prev, { id: Date.now().toString(), text: targetInputText.trim(), completed: false }]);
    setTargetInputText('');
    showToast('Weekly target added!');
  };

  const handleToggleTarget = (id: string) => {
    setTargetsList(prev => prev.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
  };

  const handleStartNewWeek = () => {
    const totalCount = targetsList.length;
    const completedCount = targetsList.filter(t => t.completed).length;
    const startOfWeek = new Date();
    const formattedDate = startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    
    setTargetsHistory(prev => [
      { date: formattedDate, completedCount, totalCount },
      ...prev
    ]);
    setTargetsList([]);
    showToast('Started new week! Archived progress to history.');
  };

  // Mini Deadline Clock Timer Effect
  useEffect(() => {
    let interval: any = null;
    if (deadlineIsRunning) {
      interval = setInterval(() => {
        if (deadlineTimerSeconds > 0) {
          setDeadlineTimerSeconds(prev => prev - 1);
        } else if (deadlineTimerMinutes > 0) {
          setDeadlineTimerMinutes(prev => prev - 1);
          setDeadlineTimerSeconds(59);
        } else {
          // Time is up!
          setDeadlineIsRunning(false);
          showToast(`Deadline reached for ${deadlineSteps[deadlineActiveIndex]?.name || 'current step'}!`);
        }
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [deadlineIsRunning, deadlineTimerMinutes, deadlineTimerSeconds, deadlineActiveIndex, deadlineSteps]);

  const startDeadlineTimer = () => {
    const currentStep = deadlineSteps[deadlineActiveIndex];
    if (deadlineTimerMinutes === 0 && deadlineTimerSeconds === 0 && currentStep && currentStep.minutes > 0) {
      setDeadlineTimerMinutes(currentStep.minutes);
      setDeadlineTimerSeconds(0);
    }
    setDeadlineIsRunning(true);
  };

  const resetDeadlineTimer = () => {
    setDeadlineIsRunning(false);
    const currentStep = deadlineSteps[deadlineActiveIndex];
    setDeadlineTimerMinutes(currentStep ? currentStep.minutes : 0);
    setDeadlineTimerSeconds(0);
    showToast('Step timer reset');
  };

  const finishDeadlineStep = () => {
    setDeadlineIsRunning(false);
    if (deadlineActiveIndex < deadlineSteps.length - 1) {
      const nextIndex = deadlineActiveIndex + 1;
      setDeadlineActiveIndex(nextIndex);
      const nextStep = deadlineSteps[nextIndex];
      setDeadlineTimerMinutes(nextStep ? nextStep.minutes : 0);
      setDeadlineTimerSeconds(0);
      showToast(`Advanced to next step: ${nextStep?.name}`);
    } else {
      showToast('All deadline steps completed!');
    }
  };

  const adjustDeadlineMinutes = (id: string, amount: number) => {
    setDeadlineSteps(prev => prev.map(step => 
      step.id === id 
        ? { ...step, minutes: Math.max(0, step.minutes + amount) }
        : step
    ));
    
    // Sync current active step's timer state if not running
    const stepIdx = deadlineSteps.findIndex(s => s.id === id);
    if (stepIdx === deadlineActiveIndex && !deadlineIsRunning) {
      setDeadlineTimerMinutes(prev => Math.max(0, prev + amount));
      setDeadlineTimerSeconds(0);
    }
  };

  const deleteDeadlineStep = (id: string) => {
    const stepIdx = deadlineSteps.findIndex(s => s.id === id);
    if (deadlineSteps.length <= 1) {
      showToast('Cannot delete the last remaining step!');
      return;
    }
    
    setDeadlineSteps(prev => prev.filter(step => step.id !== id));
    
    if (stepIdx === deadlineActiveIndex) {
      const nextIndex = Math.min(deadlineActiveIndex, deadlineSteps.length - 2);
      setDeadlineActiveIndex(nextIndex);
      setDeadlineIsRunning(false);
      setDeadlineTimerMinutes(0);
      setDeadlineTimerSeconds(0);
    } else if (stepIdx < deadlineActiveIndex) {
      setDeadlineActiveIndex(prev => prev - 1);
    }
    showToast('Step deleted');
  };

  const handleAddDeadlineStep = (e: React.FormEvent) => {
    e.preventDefault();
    if (!deadlineNewStepName.trim()) return;
    setDeadlineSteps(prev => [...prev, { id: Date.now().toString(), name: deadlineNewStepName.trim(), minutes: 0 }]);
    setDeadlineNewStepName('');
    setIsAddingDeadlineStep(false);
    showToast('Deadline step added!');
  };

  const resetDeadlineClockDefault = () => {
    setDeadlineIsRunning(false);
    setDeadlineActiveIndex(0);
    setDeadlineTimerMinutes(0);
    setDeadlineTimerSeconds(0);
    setDeadlineSteps([
      { id: 'd1', name: 'Notes', minutes: 0 },
      { id: 'd2', name: 'Solve without hints', minutes: 0 },
      { id: 'd3', name: 'Solve with hint', minutes: 0 },
      { id: 'd4', name: 'Analyse', minutes: 0 },
      { id: 'd5', name: 'Notes', minutes: 0 }
    ]);
    showToast('Reset steps to default');
  };

  // Loose Timer Effect
  useEffect(() => {
    let interval: any = null;
    if (looseIsRunning) {
      // Mark active step as 'active' status if it's pending
      setLooseSteps(prev => prev.map((step, idx) => 
        idx === looseActiveIndex && step.status === 'pending'
          ? { ...step, status: 'active' as const }
          : step
      ));
      
      interval = setInterval(() => {
        setLooseTimerSeconds(prev => prev + 1);
        setLooseSteps(prev => prev.map((step, idx) => 
          idx === looseActiveIndex 
            ? { ...step, elapsedSeconds: step.elapsedSeconds + 1 }
            : step
        ));
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [looseIsRunning, looseActiveIndex]);

  const finishLooseStep = () => {
    setLooseSteps(prev => prev.map((step, idx) => 
      idx === looseActiveIndex 
        ? { ...step, status: 'completed' as const }
        : step
    ));
    
    if (looseActiveIndex < looseSteps.length - 1) {
      const nextIndex = looseActiveIndex + 1;
      setLooseActiveIndex(nextIndex);
      setLooseTimerSeconds(0);
      showToast(`Advanced to next step: ${looseSteps[nextIndex]?.name}`);
    } else {
      setLooseIsRunning(false);
      showToast('All loose steps completed!');
    }
  };

  const resetLooseTimer = () => {
    setLooseIsRunning(false);
    setLooseActiveIndex(0);
    setLooseTimerSeconds(0);
    setLooseSteps(prev => prev.map(step => ({ ...step, status: 'pending' as const, elapsedSeconds: 0 })));
    showToast('Loose timer reset');
  };

  const handleAddLooseStep = (e: React.FormEvent) => {
    e.preventDefault();
    if (!looseNewStepName.trim()) return;
    setLooseSteps(prev => [...prev, { id: Date.now().toString(), name: looseNewStepName.trim(), status: 'pending', elapsedSeconds: 0 }]);
    setLooseNewStepName('');
    setIsAddingLooseStep(false);
    showToast('Loose step added!');
  };

  const deleteLooseStep = (id: string) => {
    const stepIdx = looseSteps.findIndex(s => s.id === id);
    if (looseSteps.length <= 1) {
      showToast('Cannot delete the last remaining step!');
      return;
    }
    
    setLooseSteps(prev => prev.filter(step => step.id !== id));
    
    if (stepIdx === looseActiveIndex) {
      const nextIndex = Math.min(looseActiveIndex, looseSteps.length - 2);
      setLooseActiveIndex(nextIndex);
      setLooseIsRunning(false);
      setLooseTimerSeconds(0);
    } else if (stepIdx < looseActiveIndex) {
      setLooseActiveIndex(prev => prev - 1);
    }
    showToast('Step deleted');
  };

  const resetLooseClockDefault = () => {
    setLooseIsRunning(false);
    setLooseActiveIndex(0);
    setLooseTimerSeconds(0);
    setLooseSteps([
      { id: 'l1', name: 'Notes', status: 'pending', elapsedSeconds: 0 },
      { id: 'l2', name: 'Solve without hints', status: 'pending', elapsedSeconds: 0 },
      { id: 'l3', name: 'Solve with hint', status: 'pending', elapsedSeconds: 0 },
      { id: 'l4', name: 'Analyse', status: 'pending', elapsedSeconds: 0 },
      { id: 'l5', name: 'Notes', status: 'pending', elapsedSeconds: 0 }
    ]);
    showToast('Reset steps to default');
  };

  // Submit Handler for modal creation
  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newMaxParticipants === 0) {
      showToast("At least 1 participant is required");
      return;
    }

    const randomId = Math.random().toString(36).substring(2, 8);
    const roomLink = `${window.location.origin}/room/${randomId}`;

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
      id: randomId,
      name: roomDetails.name,
      type: roomDetails.type,
      buttonText: roomDetails.type === 'public-ask' ? 'Ask to join' : 'Join',
      participants: [], 
      maxParticipants: roomDetails.maxParticipants,
      link: roomDetails.link,
      creatorId: getMyId(),
      creatorName: user ? user.displayName || 'Google User' : 'Unknown',
      createdAt: new Date().toISOString()
    };

    if (roomDetails.scheduledDate !== undefined) {
      newRoomObj.scheduledDate = roomDetails.scheduledDate;
    }
    if (roomDetails.scheduledTime !== undefined) {
      newRoomObj.scheduledTime = roomDetails.scheduledTime;
    }

    try {
      await setDoc(doc(db, 'rooms', newRoomObj.id), newRoomObj);
      setGeneratedRoomLink(roomLink);
      setModalStep('confirmation');
    } catch (err) {
      console.warn('Error saving room to Firestore, fallback to local creation:', err);
      saveLocalRoom(newRoomObj); // Save to localStorage so it persists on refresh!
      setRooms(prev => {
        if (prev.some(r => r.id === newRoomObj.id)) return prev;
        return [...prev, newRoomObj];
      });
      setGeneratedRoomLink(roomLink);
      setModalStep('confirmation');
      
      showToast(`⚠️ Database Write Blocked (Permission Denied). Room created locally. Please enable read/write rules in your Firebase Console.`);
    }
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

    const photoURLVal = profileEditPhotoURL.trim() || null;

    setGuestName(profileEditName);
    setGuestColor(profileEditColor);
    setGuestInitials(initials);
    setGuestPhotoURL(photoURLVal);

    localStorage.setItem('skulk_guest_identity', JSON.stringify({ 
      name: profileEditName, 
      color: profileEditColor, 
      initials,
      photoURL: photoURLVal
    }));
    setIsProfileModalOpen(false);
    showToast('Profile updated!');
  };

  // Local chat submission
  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessageText.trim() || !currentRoom) return;

    const senderName = user ? user.displayName || 'Google User' : guestName;
    const myId = getMyId();
    const myRole = callParticipants.find(p => p.id === myId)?.role || determineRole(currentRoom.creatorId);
    
    const msgId = Date.now().toString();
    const newMsg: ChatMessage = {
      id: msgId,
      sender: senderName,
      senderId: myId,
      senderRole: myRole,
      text: chatMessageText.trim(),
      createdAt: new Date().toISOString()
    };
    
    setChatMessageText('');

    try {
      await setDoc(doc(db, 'rooms', roomDocId(currentRoom), 'messages', msgId), newMsg);
    } catch (err) {
      console.warn("Failed to write chat to Firestore, fallback locally:", err);
      setChatMessages(prev => [...prev, newMsg]);
      showToast('Message saved locally — check your connection');
    }
  };

  // Co-host control triggers (Mute, Pin, Remove)
  const handleParticipantMuteToggle = async (id: string, name: string) => {
    if (!currentRoom) return;
    const rid = roomDocId(currentRoom);
    const target = callParticipants.find(p => p.id === id);
    if (!target) return;
    const nextMute = !target.isMuted;
    try {
      await updateDoc(doc(db, 'rooms', rid, 'participants', id), { isMuted: nextMute, mutedBy: getMyId() });
      showToast(nextMute ? `Muted ${name}` : `Unmuted ${name}`);
    } catch (e) {
      console.warn("Failed to toggle remote mute in Firestore:", e);
    }
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

  const handleParticipantRemove = async (id: string, name: string) => {
    if (!currentRoom) return;
    const rid = roomDocId(currentRoom);
    try {
      await deleteDoc(doc(db, 'rooms', rid, 'participants', id));
      const signalsRef = collection(db, 'rooms', rid, 'signals');
      const snapshot = await getDocs(signalsRef);
      snapshot.forEach(async (docSnap) => {
        if (docSnap.id.includes(id)) {
          try {
            await deleteDoc(docSnap.ref);
          } catch (e) {}
        }
      });
      showToast(`Kicked ${name} from room`);
    } catch (e) {
      console.warn("Failed to kick participant from Firestore:", e);
      setCallParticipants(prev => prev.filter(p => p.id !== id));
      showToast(`Removed ${name} from room`);
    }
    setActiveMenuParticipantId(null);
  };

  const handleParticipantRoleChange = async (id: string, newRole: 'host' | 'cohost' | 'member') => {
    if (!currentRoom) return;
    const rid = roomDocId(currentRoom);
    try {
      await updateDoc(doc(db, 'rooms', rid, 'participants', id), { role: newRole });
      showToast(`Updated role to ${newRole}`);
    } catch (e) {
      console.warn("Failed to update role in Firestore:", e);
    }
    setActiveMenuParticipantId(null);
  };

  const handleParticipantCameraToggle = async (id: string, name: string) => {
    if (!currentRoom) return;
    const rid = roomDocId(currentRoom);
    const target = callParticipants.find(p => p.id === id);
    if (!target) return;
    
    const nextVal = !target.isCamOff;
    try {
      await updateDoc(doc(db, 'rooms', rid, 'participants', id), { isCamOff: nextVal, camOffBy: getMyId() });
      showToast(`${nextVal ? 'Disabled' : 'Enabled'} camera for ${name}`);
    } catch (e) {
      console.warn("Failed to toggle remote camera in Firestore:", e);
    }
    setActiveMenuParticipantId(null);
  };
  const handleEndRoom = async () => {
    if (!currentRoom) return;
    const rid = roomDocId(currentRoom);
    try {
      // Clean up localStorage first
      const local = getLocalRooms();
      const updatedLocal = local.filter(r => r.id !== rid);
      localStorage.setItem('skulk_local_rooms', JSON.stringify(updatedLocal));

      // 1. Delete the main room document (triggers snapshot callback on all clients to leave)
      await deleteDoc(doc(db, 'rooms', rid));
      
      // 2. Clean up participants collection
      const presenceRef = collection(db, 'rooms', rid, 'participants');
      const snapshot = await getDocs(presenceRef);
      for (const docSnap of snapshot.docs) {
        await deleteDoc(docSnap.ref);
      }
      
      showToast("Room closed successfully.");
    } catch (e) {
      console.warn("Failed to delete room:", e);
      showToast("Failed to close room.");
    }
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


  const getGalleryColumns = (count: number) => {
    if (count === 1) return '1fr';
    if (count === 2) return 'repeat(2, 1fr)';
    if (count <= 4) return 'repeat(2, 1fr)';
    if (count <= 6) return 'repeat(3, 1fr)';
    return 'repeat(auto-fit, minmax(280px, 1fr))';
  };

  const getGalleryMaxWidth = (count: number) => {
    if (count === 1) return '800px';
    if (count === 2) return '1000px';
    if (count <= 4) return '1000px';
    return '100%';
  };

  const renderParticipantTile = (p: Participant, isThumbnail: boolean = false) => {
    const isUser = p.id === getMyId();
    const showMuted = isUser ? isMicMuted : p.isMuted;
    const showCamOff = isUser ? isCamOff : p.isCamOff;
    const isSpeaking = p.isSpeaking && !showMuted;
    
    return (
      <div 
        key={p.id} 
        className={`${isThumbnail ? 'spotlight-thumbnail-tile' : 'participant-tile'} ${isUser ? 'user-tile' : ''} ${isSpeaking ? 'speaker-active' : ''} ${p.id === spotlightParticipantId && isThumbnail ? 'active' : ''}`}
        onClick={() => {
          if (isThumbnail) {
            setSpotlightParticipantId(p.id);
          } else if (!spotlightParticipantId) {
            setSpotlightParticipantId(p.id);
          }
        }}
        style={{ cursor: 'pointer' }}
      >
        {isGalleryView && !isThumbnail ? (
          // Gallery Layout: Full Card Video/Avatar
          !showCamOff ? (
            <>
              {isUser && cameraError ? (
                // Refined camera error display: show PFP/initials background + a small centered retry box!
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {p.photoURL ? (
                    <img 
                      src={p.photoURL} 
                      alt={p.name} 
                      style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.3 }} 
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div style={{ fontSize: '32px', fontWeight: 'bold', color: 'rgba(255,255,255,0.2)' }}>{p.initials}</div>
                  )}
                  <div 
                    onClick={(e) => {
                      e.stopPropagation();
                      window.dispatchEvent(new CustomEvent('retry-device', { detail: 'camera' }));
                    }}
                    style={{
                      position: 'absolute',
                      padding: '8px 16px', background: 'rgba(15, 16, 19, 0.85)',
                      border: '1px solid var(--border-color)', borderRadius: '6px',
                      cursor: 'pointer', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px'
                    }}
                  >
                    <span style={{ fontSize: '11px', color: '#ef4444', fontWeight: 'bold' }}>Camera Unavailable</span>
                    <span style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>Click to retry</span>
                  </div>
                </div>
              ) : (
                <ParticipantVideo participantId={p.id} />
              )}
              
              {p.sharing && (
                <div className="sharing-badge-overlay" style={{
                  position: 'absolute',
                  bottom: '12px',
                  right: '12px',
                  backgroundColor: 'var(--primary-color)',
                  color: '#0f1013',
                  borderRadius: '50%',
                  width: '22px',
                  height: '22px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  border: '2px solid var(--card-bg, #1a1c23)',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                  zIndex: 10
                }} title={`Sharing ${p.sharing} - click to view`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleViewParticipantShare(p);
                  }}
                >
                  {p.sharing === 'youtube' ? '▶' : p.sharing === 'whiteboard' ? '✎' : '⛶'}
                </div>
              )}
            </>
          ) : (
            /* Avatar Square (Gallery Mode) */
            <div 
              className="participant-avatar-large" 
              style={{ 
                backgroundColor: p.color, 
                cursor: p.sharing ? 'pointer' : 'default',
                position: 'relative',
                boxShadow: p.sharing ? '0 0 12px var(--primary-color)' : 'none',
                border: p.sharing ? '2px solid var(--primary-color)' : 'none',
                overflow: 'hidden',
                width: '96px',
                height: '96px',
                borderRadius: '50%',
                fontSize: '32px',
                marginBottom: '0'
              }}
              onClick={() => {
                if (p.sharing) {
                  handleViewParticipantShare(p);
                }
              }}
            >
              {p.photoURL ? (
                <img 
                  src={p.photoURL} 
                  alt={p.name} 
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                  referrerPolicy="no-referrer"
                />
              ) : (
                p.initials
              )}
              {p.sharing && (
                <div className="sharing-badge-overlay" style={{
                  position: 'absolute',
                  bottom: '-6px',
                  right: '-6px',
                  backgroundColor: 'var(--primary-color)',
                  color: '#0f1013',
                  borderRadius: '50%',
                  width: '22px',
                  height: '22px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  border: '2px solid var(--card-bg, #1a1c23)',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                  zIndex: 10
                }} title={`Sharing ${p.sharing} - click to view`}>
                  {p.sharing === 'youtube' ? '▶' : p.sharing === 'whiteboard' ? '✎' : '⛶'}
                </div>
              )}
            </div>
          )
        ) : (
          // Compact Grid Layout OR Thumbnail view: Floating Avatar
          <div 
            className="participant-avatar-large" 
            style={{ 
              backgroundColor: p.color, 
              cursor: p.sharing ? 'pointer' : 'default',
              position: 'relative',
              boxShadow: p.sharing ? '0 0 12px var(--primary-color)' : 'none',
              border: p.sharing ? '2px solid var(--primary-color)' : 'none',
              overflow: 'hidden',
              // Shrink for thumbnail strip
              ...isThumbnail ? { width: '48px', height: '48px', minWidth: '48px' } : {}
            }}
            onClick={() => {
              if (p.sharing) {
                handleViewParticipantShare(p);
              }
            }}
          >
            {!showCamOff && !(isUser && cameraError) ? (
              <ParticipantVideo participantId={p.id} />
            ) : p.photoURL ? (
              <img 
                src={p.photoURL} 
                alt={p.name} 
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                referrerPolicy="no-referrer"
              />
            ) : (
              p.initials
            )}
            
            {/* Clickable Retry warning indicator in compact view */}
            {isUser && !showCamOff && cameraError && (
              <div 
                onClick={(e) => {
                  e.stopPropagation();
                  window.dispatchEvent(new CustomEvent('retry-device', { detail: 'camera' }));
                }}
                style={{
                  position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                  backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', zIndex: 15,
                  cursor: 'pointer'
                }} 
                title="Camera error - check hardware switch and click to retry"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '2px' }}>
                  <path d="m18.84 12.84 1.83 1.83a1 1 0 0 0 1.63-.77v-3.8a1 1 0 0 0-1.63-.77l-1.83 1.83"></path>
                  <rect x="2" y="5" width="14" height="14" rx="2" stroke="#ef4444"></rect>
                  <line x1="2" y1="2" x2="22" y2="22" stroke="#ef4444"></line>
                </svg>
                <span style={{ fontSize: '9px', color: '#ef4444', fontWeight: 'bold' }}>RETRY</span>
              </div>
            )}
  
            {p.sharing && (
              <div className="sharing-badge-overlay" style={{
                position: 'absolute',
                bottom: '-6px',
                right: '-6px',
                backgroundColor: 'var(--primary-color)',
                color: '#0f1013',
                borderRadius: '50%',
                width: '22px',
                height: '22px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '11px',
                fontWeight: 'bold',
                border: '2px solid var(--card-bg, #1a1c23)',
                boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                zIndex: 10
              }} title={`Sharing ${p.sharing} - click to view`}>
                {p.sharing === 'youtube' ? '▶' : p.sharing === 'whiteboard' ? '✎' : '⛶'}
              </div>
            )}
          </div>
        )}
        
        {/* Name Tag + Muted Status */}
        {!isThumbnail && (
          <div className="participant-name-tag" style={{ gap: '6px' }}>
            <span>{p.name}</span>
            {p.role && p.role !== 'member' && (
              <span className={`role-tag-${p.role}`} style={{
                fontSize: '9px',
                fontWeight: 'bold',
                padding: '1px 5px',
                borderRadius: '4px',
                textTransform: 'uppercase',
                border: '1px solid',
                lineHeight: '1.2',
                ...p.role === 'admin' ? {
                  backgroundColor: 'rgba(241, 196, 15, 0.15)',
                  borderColor: 'var(--primary-color, #f1c40f)',
                  color: 'var(--primary-color, #f1c40f)'
                } : p.role === 'host' ? {
                  backgroundColor: 'rgba(59, 130, 246, 0.15)',
                  borderColor: '#3b82f6',
                  color: '#3b82f6'
                } : {
                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                  borderColor: '#10b981',
                  color: '#10b981'
                }
              }}>
                {p.role === 'admin' ? '👑 Admin' : p.role === 'host' ? '⭐ Host' : '🛡️ Co-host'}
              </span>
            )}
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
        )}
  
        {/* Host Actions Hover Trigger Menu */}
        {!isThumbnail && !isUser && (callParticipants.find(part => part.id === getMyId())?.role === 'admin' || 
                                     callParticipants.find(part => part.id === getMyId())?.role === 'host' || 
                                     callParticipants.find(part => part.id === getMyId())?.role === 'cohost') && (
          <div ref={sidebarMenuRef}>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setActiveMenuParticipantId(activeMenuParticipantId === p.id ? null : p.id);
              }}
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
              <div className="tile-actions-menu animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '140px' }} onClick={e => e.stopPropagation()}>
                {/* Mute action */}
                {checkCanMute(callParticipants.find(part => part.id === getMyId())?.role || 'member', p.role || 'member') && (
                  <button 
                    onClick={() => handleParticipantMuteToggle(p.id, p.name)} 
                    className="tile-menu-item"
                  >
                    {p.isMuted ? 'Unmute' : 'Mute'}
                  </button>
                )}
                
                {/* Camera off action */}
                {checkCanMute(callParticipants.find(part => part.id === getMyId())?.role || 'member', p.role || 'member') && (
                  <button 
                    onClick={() => handleParticipantCameraToggle(p.id, p.name)} 
                    className="tile-menu-item"
                  >
                    {p.isCamOff ? 'Turn camera on' : 'Turn camera off'}
                  </button>
                )}
                
                {/* Pin action */}
                <button 
                  onClick={() => handleParticipantPinToggle(p.id, p.name)} 
                  className="tile-menu-item"
                >
                  {p.isPinned ? 'Unpin' : 'Pin'}
                </button>
                
                {/* Role Promotion/Demotion Actions */}
                {callParticipants.find(part => part.id === getMyId())?.role === 'admin' && (
                  <>
                    {p.role !== 'host' && (
                      <button 
                        onClick={() => handleParticipantRoleChange(p.id, 'host')} 
                        className="tile-menu-item"
                      >
                        Make Host
                      </button>
                    )}
                    {p.role !== 'cohost' && (
                      <button 
                        onClick={() => handleParticipantRoleChange(p.id, 'cohost')} 
                        className="tile-menu-item"
                      >
                        Make Co-host
                      </button>
                    )}
                    {p.role !== 'member' && (
                      <button 
                        onClick={() => handleParticipantRoleChange(p.id, 'member')} 
                        className="tile-menu-item"
                      >
                        Demote to Member
                      </button>
                    )}
                  </>
                )}
  
                {callParticipants.find(part => part.id === getMyId())?.role === 'host' && (
                  <>
                    {p.role === 'member' && (
                      <button 
                        onClick={() => handleParticipantRoleChange(p.id, 'cohost')} 
                        className="tile-menu-item"
                      >
                        Make Co-host
                      </button>
                    )}
                    {p.role === 'cohost' && (
                      <button 
                        onClick={() => handleParticipantRoleChange(p.id, 'member')} 
                        className="tile-menu-item"
                      >
                        Demote to Member
                      </button>
                    )}
                  </>
                )}
  
                {/* Kick action */}
                {checkCanKick(callParticipants.find(part => part.id === getMyId())?.role || 'member', p.role || 'member') && (
                  <button 
                    onClick={() => handleParticipantRemove(p.id, p.name)} 
                    className="tile-menu-item" 
                    style={{ color: '#ef4444' }}
                  >
                    Kick out
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // Filtered rooms based on name search
  const filteredRooms = rooms.filter(room => {
    if (room.type === 'private') {
      return false;
    }
    return room.name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  if (isAuthLoading) {
    return (
      <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: '16px' }}>
        <div 
          style={{ 
            width: '40px', 
            height: '40px', 
            borderRadius: '50%',
            border: '3px solid rgba(255,255,255,0.1)', 
            borderTopColor: 'var(--primary-color)', 
            animation: 'spin 1s linear infinite' 
          }}
        />
        <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Loading profile...</span>
      </div>
    );
  }

  return (
    <div className="app-container">
      
      <Routes>
        <Route path="/" element={
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
              {guestName && !user && (
                <button 
                  onClick={() => {
                    setProfileEditName(guestName);
                    setProfileEditColor(guestColor);
                    setProfileEditPhotoURL(guestPhotoURL || '');
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

              {!user ? (
                <button onClick={handleSignIn} className="btn-signin">Sign in</button>
              ) : (
                <div className="user-profile-container" ref={userDropdownRef} style={{ position: 'relative' }}>
                  <button 
                    onClick={() => setIsUserDropdownOpen(!isUserDropdownOpen)} 
                    className="guest-profile-badge"
                    style={{ border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 12px 4px 4px' }}
                  >
                    {user.photoURL ? (
                      <img 
                        src={user.photoURL} 
                        alt={user.displayName || 'User'} 
                        style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }} 
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="guest-badge-avatar" style={{ backgroundColor: '#8b5cf6' }}>
                        {guestInitials}
                      </div>
                    )}
                    <span style={{ maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {user.displayName || 'Google User'}
                    </span>
                  </button>
                  
                  {isUserDropdownOpen && (
                    <div className="theme-picker-dropdown animate-fade-in" style={{ top: '100%', right: 0, marginTop: '8px', minWidth: '150px' }}>
                      <button 
                        onClick={handleSignOut} 
                        className="theme-item-btn"
                        style={{ color: '#ef4444', width: '100%', textAlign: 'left', padding: '10px 16px' }}
                      >
                        Sign out
                      </button>
                    </div>
                  )}
                </div>
              )}
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
              {isFirestoreBlocked && (
                <div className="animate-fade-in" style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  backgroundColor: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.15)',
                  borderRadius: 'var(--border-radius)',
                  padding: '12px 16px',
                  marginBottom: '24px',
                  color: '#ef4444',
                  fontSize: '13px',
                  lineHeight: '1.5'
                }}>
                  <span style={{ fontSize: '18px' }}>⚠️</span>
                  <span>
                    <strong>Firebase permissions blocked:</strong> Rooms and chat are operating in local offline fallback mode. Rooms you create will only be visible in this browser window. To enable real-time synchronization, please update your <strong>Firestore Security Rules</strong> in the Firebase Console to allow public access.
                  </span>
                </div>
              )}

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
                  const currentRoomParticipants = roomsParticipants[room.id] || [];
                  const isRoomFull = currentRoomParticipants.length >= (room.maxParticipants || 10);
                  
                  return (
                    <div className="room-card" key={room.id}>
                      {/* Room Header */}
                      <div className="room-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div 
                            className="room-dot" 
                            style={{ 
                              backgroundColor: isScheduled ? 'var(--primary-color)' : 'var(--dot-color)',
                              boxShadow: isScheduled ? '0 0 8px var(--primary-color)' : '0 0 8px var(--dot-color)'
                            }}
                          ></div>
                          <h3 className="room-title">{room.name}</h3>
                        </div>
                        {isRoomFull && (
                          <div className="recording-dot-wrapper" style={{ backgroundColor: '#ef4444', borderColor: '#ef4444', height: '20px', padding: '0 8px', gap: '4px' }}>
                            <div className="recording-dot" style={{ backgroundColor: '#ffffff' }}></div>
                            <span style={{ color: '#ffffff', fontSize: '9px', fontWeight: 800 }}>FULL</span>
                          </div>
                        )}
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
                        {Array.from({ length: room.maxParticipants || 10 }).map((_, index) => {
                          const participant = currentRoomParticipants[index];
                          if (participant) {
                            return participant.photoURL ? (
                              <img 
                                key={index}
                                src={participant.photoURL}
                                alt={participant.name}
                                className="avatar-slot avatar-filled"
                                style={{ objectFit: 'cover', border: '1px solid var(--border-color)' }}
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div 
                                key={index} 
                                className="avatar-slot avatar-filled"
                                style={{ backgroundColor: participant.color || '#8b5cf6' }}
                              >
                                {participant.initials}
                              </div>
                            );
                          } else {
                            return (
                              <div 
                                key={index} 
                                className="avatar-slot avatar-empty" 
                                style={{ borderStyle: 'dashed' }}
                              />
                            );
                          }
                        })}
                      </div>
                      
                      {/* Room Footer */}
                      <div className="room-footer">
                        <button 
                          onClick={() => handleJoinRoomClick(room)} 
                          className="btn-join"
                          disabled={isRoomFull}
                          style={{
                            opacity: isRoomFull ? 0.5 : 1,
                            cursor: isRoomFull ? 'not-allowed' : 'pointer',
                            backgroundColor: isRoomFull ? 'var(--button-secondary-bg)' : 'var(--primary-color)',
                            color: isRoomFull ? 'var(--text-secondary)' : 'var(--primary-text)'
                          }}
                        >
                          {isRoomFull ? 'Full' : (isScheduled ? 'Register' : room.buttonText)}
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
      } />

      <Route path="/room/:roomId" element={
        currentRoom ? (
          !liveKitToken ? (
            <div className="call-layout animate-fade-in" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <div className="loading-spinner" style={{ margin: '0 auto 16px', borderTopColor: 'var(--primary-color)', width: '32px', height: '32px', border: '3px solid var(--border-color)', borderRadius: '50%', borderTop: '3px solid var(--primary-color)', animation: 'spin 1s linear infinite' }}></div>
                <p style={{ color: 'var(--text-secondary)' }}>Connecting to secure media server...</p>
              </div>
              <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
            </div>
          ) : (
          /* 2. In-Call Room Stage View (rendered if currentRoom is NOT null) */
          <div className="call-layout animate-fade-in" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100, backgroundColor: 'var(--bg-color)', overflow: 'hidden', height: '100vh', maxHeight: '100vh', width: '100vw', display: 'flex', flexDirection: 'column' }}>
            <LiveKitRoom
              token={liveKitToken}
              serverUrl={import.meta.env.VITE_LIVEKIT_URL}
              audio={!isMicMuted}
              video={!isCamOff}
              style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', width: '100%', overflow: 'hidden' }}
            >
            <DeviceRecoveryManager 
              isCamOff={isCamOff} 
              isMicMuted={isMicMuted} 
              onErrorChange={(cam, mic) => {
                if (cameraError !== cam) setCameraError(cam);
                if (micError !== mic) setMicError(mic);
              }} 
            />
            <RoomAudioRenderer />
            
          {/* Call Header */}
          <div className="call-top-bar">
            <div className="call-room-info">
              <a href="/" onClick={(e) => { e.preventDefault(); handleLeaveCall(); }} className="logo-circle" style={{ width: '28px', height: '28px', fontSize: '15px', textDecoration: 'none' }}>S</a>
              <h1 className="room-title" style={{ fontSize: '18px' }}>{currentRoom.name}</h1>
              {currentRoom.creatorName && (
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginLeft: '12px', borderLeft: '1px solid var(--border-color)', paddingLeft: '12px', display: 'flex', alignItems: 'center' }}>
                  Created by <strong style={{ marginLeft: '4px', color: 'var(--text-primary)' }}>{currentRoom.creatorName}</strong>
                </span>
              )}
              <div className="recording-dot-wrapper">
                <div className="recording-dot"></div>
                <span>LIVE</span>
              </div>

              {/* Shared Pomodoro Status Badge */}
              <div 
                onClick={() => setCallTab('tools')}
                className={`topbar-pomodoro-badge ${pomodoroPhase === 'focus' ? 'focus-phase' : 'break-phase'}`}
                title="View Pomodoro Timer details"
              >
                <span>⏱️</span>
                <span>
                  {pomodoroMinutes.toString().padStart(2, '0')}:
                  {pomodoroSeconds.toString().padStart(2, '0')}
                </span>
                <span style={{ fontSize: '9px', opacity: 0.8, textTransform: 'uppercase', marginLeft: '4px' }}>
                  ({pomodoroPhase})
                </span>
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
              {guestName && !user && (
                <button 
                  onClick={() => {
                    setProfileEditName(guestName);
                    setProfileEditColor(guestColor);
                    setProfileEditPhotoURL(guestPhotoURL || '');
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

              {!user ? (
                <button onClick={handleSignIn} className="btn-signin" style={{ padding: '6px 14px', fontSize: '13px' }}>Sign in</button>
              ) : (
                <div className="user-profile-container" ref={userDropdownRef} style={{ position: 'relative' }}>
                  <button 
                    onClick={() => setIsUserDropdownOpen(!isUserDropdownOpen)} 
                    className="guest-profile-badge"
                    style={{ border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 10px 4px 4px', fontSize: '12px' }}
                  >
                    {user.photoURL ? (
                      <img 
                        src={user.photoURL} 
                        alt={user.displayName || 'User'} 
                        style={{ width: '20px', height: '20px', borderRadius: '50%', objectFit: 'cover' }} 
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="guest-badge-avatar" style={{ backgroundColor: '#8b5cf6', width: '20px', height: '20px', fontSize: '9px' }}>
                        {guestInitials}
                      </div>
                    )}
                    <span style={{ maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {user.displayName || 'Google User'}
                    </span>
                  </button>
                  
                  {isUserDropdownOpen && (
                    <div className="theme-picker-dropdown animate-fade-in" style={{ top: '100%', right: 0, marginTop: '8px', minWidth: '150px', zIndex: 1000 }}>
                      <button 
                        onClick={handleSignOut} 
                        className="theme-item-btn"
                        style={{ color: '#ef4444', width: '100%', textAlign: 'left', padding: '10px 16px' }}
                      >
                        Sign out
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Call Body */}
          <div className="call-main-content">
            
            {/* Call Main Stage (Left) */}
            <div className="call-stage">
              {viewingShare ? (
                viewingShare.type === 'whiteboard' ? (
                <div className="whiteboard-container">
                  <div className="whiteboard-toolbar">
                    <div className="whiteboard-tools-left">
                      <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                        Whiteboard {viewingShare.participantId !== getMyId() ? `(viewing ${callParticipants.find(p => p.id === viewingShare.participantId)?.name.replace(' (You)', '') || 'participant'})` : '(You)'}
                      </span>
                      {viewingShare.participantId === getMyId() && (
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
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {viewingShare.participantId === getMyId() && (
                        <button onClick={clearCanvas} className="btn-signin" style={{ padding: '6px 12px', fontSize: '12px', backgroundColor: 'var(--button-secondary-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>
                          Clear
                        </button>
                      )}
                      <button 
                        onClick={async () => {
                          if (viewingShare.participantId === getMyId()) {
                            await clearMySharing();
                          }
                          setViewingShare(null);
                        }} 
                        className="btn-create" 
                        style={{ padding: '6px 12px', fontSize: '12px' }}
                      >
                        {viewingShare.participantId === getMyId() ? 'Stop sharing' : 'Close view'}
                      </button>
                    </div>
                  </div>
                  <canvas 
                    ref={canvasRef}
                    className="whiteboard-canvas"
                    onMouseDown={viewingShare.participantId === getMyId() ? startDrawing : undefined}
                    onMouseMove={viewingShare.participantId === getMyId() ? draw : undefined}
                    onMouseUp={viewingShare.participantId === getMyId() ? stopDrawing : undefined}
                    onMouseLeave={viewingShare.participantId === getMyId() ? stopDrawing : undefined}
                    onTouchStart={viewingShare.participantId === getMyId() ? startDrawingTouch : undefined}
                    onTouchMove={viewingShare.participantId === getMyId() ? drawTouch : undefined}
                    onTouchEnd={viewingShare.participantId === getMyId() ? stopDrawing : undefined}
                    style={{ cursor: viewingShare.participantId === getMyId() ? 'crosshair' : 'default' }}
                  />
                </div>
              ) : (
                <div className="screenshare-stage-layout animate-fade-in">
                  <div className="screenshare-video-wrapper">
                    {viewingShare.type === 'screen' ? (
                      viewingShare.participantId === getMyId() && screenShareStream ? (
                        <video ref={videoRef} autoPlay playsInline muted className="screenshare-video"></video>
                      ) : (
                        <div style={{ 
                          display: 'flex', 
                          flexDirection: 'column',
                          alignItems: 'center', 
                          justifyContent: 'center', 
                          height: '100%', 
                          color: 'var(--text-primary)',
                          background: 'linear-gradient(135deg, rgba(15, 16, 19, 0.95) 0%, rgba(26, 28, 35, 0.95) 100%)',
                          borderRadius: 'var(--border-radius)',
                          border: '1px dashed var(--border-color)',
                          position: 'relative',
                          overflow: 'hidden',
                          padding: '24px',
                          textAlign: 'center'
                        }}>
                          {/* Animated browser mockup */}
                          <div style={{
                            width: '90%',
                            maxWidth: '560px',
                            height: '240px',
                            backgroundColor: '#1e222b',
                            borderRadius: '8px',
                            border: '1px solid rgba(255,255,255,0.1)',
                            boxShadow: '0 12px 36px rgba(0,0,0,0.5)',
                            display: 'flex',
                            flexDirection: 'column',
                            overflow: 'hidden',
                            marginBottom: '16px'
                          }}>
                            {/* Browser bar */}
                            <div style={{
                              height: '28px',
                              backgroundColor: '#14171e',
                              display: 'flex',
                              alignItems: 'center',
                              padding: '0 12px',
                              gap: '6px',
                              borderBottom: '1px solid rgba(255,255,255,0.05)'
                            }}>
                              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#ef4444' }} />
                              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#f59e0b' }} />
                              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981' }} />
                              <div style={{ 
                                height: '16px', 
                                backgroundColor: 'rgba(255,255,255,0.05)', 
                                borderRadius: '4px', 
                                flex: 1, 
                                marginLeft: '12px',
                                display: 'flex',
                                alignItems: 'center',
                                paddingLeft: '8px',
                                fontSize: '9px',
                                color: 'rgba(255,255,255,0.4)',
                                fontFamily: 'monospace'
                              }}>
                                skulk.app/workspace/dsa-arrays
                              </div>
                            </div>
                            {/* Browser content: Simulated IDE */}
                            <div style={{
                              flex: 1,
                              padding: '16px',
                              fontFamily: 'monospace',
                              fontSize: '11px',
                              color: '#a9b2c3',
                              textAlign: 'left',
                              lineHeight: '1.6',
                              backgroundColor: '#1b1d24'
                            }}>
                              <span style={{ color: '#e06c75' }}>const</span> <span style={{ color: '#61afef' }}>findDuplicate</span> = (<span style={{ color: '#abb2bf' }}>nums</span>) =&gt; &#123;<br />
                              &nbsp;&nbsp;<span style={{ color: '#e5c07b' }}>let</span> <span style={{ color: '#abb2bf' }}>seen = </span><span style={{ color: '#c678dd' }}>new</span> <span style={{ color: '#e5c07b' }}>Set</span>();<br />
                              &nbsp;&nbsp;<span style={{ color: '#c678dd' }}>for</span> (<span style={{ color: '#e06c75' }}>let</span> <span style={{ color: '#abb2bf' }}>num of nums</span>) &#123;<br />
                              &nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: '#c678dd' }}>if</span> (seen.<span style={{ color: '#61afef' }}>has</span>(num)) <span style={{ color: '#c678dd' }}>return</span> num;<br />
                              &nbsp;&nbsp;&nbsp;&nbsp;seen.<span style={{ color: '#61afef' }}>add</span>(num);<br />
                              &nbsp;&nbsp;&#125;<br />
                              &#125;;
                            </div>
                          </div>
                          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--primary-color)' }}>
                            Viewing {callParticipants.find(p => p.id === viewingShare.participantId)?.name.replace(' (You)', '') || 'Participant'}'s Screen
                          </span>
                          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                            Live screen presentation stream is active
                          </span>
                        </div>
                      )
                    ) : viewingShare.type === 'youtube' && viewingShare.youtubeVideoId ? (
                      <iframe 
                        width="100%" 
                        height="100%" 
                        src={`https://www.youtube.com/embed/${viewingShare.youtubeVideoId}?autoplay=1`}
                        title="YouTube video player" 
                        frameBorder="0" 
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
                        allowFullScreen
                        style={{ border: 'none', borderRadius: 'var(--border-radius)' }}
                      />
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)' }}>
                        Content unavailable
                      </div>
                    )}
                    <button 
                      onClick={async () => {
                        if (viewingShare.participantId === getMyId()) {
                          if (viewingShare.type === 'screen') {
                            await stopScreenShare();
                          } else if (viewingShare.type === 'youtube') {
                            setYoutubeVideoId(null);
                            await clearMySharing();
                            setViewingShare(null);
                            showToast('YouTube sharing stopped');
                          }
                        } else {
                          setViewingShare(null);
                        }
                      }} 
                      className="btn-create" 
                      style={{ position: 'absolute', top: '12px', right: '12px', padding: '6px 12px', fontSize: '12px', backgroundColor: '#ef4444', borderColor: '#ef4444', color: '#ffffff' }}
                    >
                      {viewingShare.participantId === getMyId() ? 'Stop sharing' : 'Close view'}
                    </button>
                  </div>
                </div>
              )
              ) : (
                /* Standard conference participants grid layout display */
                <>
                  {pendingRequests.length > 0 && (
                    <div className="animate-fade-in" style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px',
                      backgroundColor: 'rgba(59, 130, 246, 0.08)',
                      border: '1px solid rgba(59, 130, 246, 0.15)',
                      borderRadius: 'var(--border-radius)',
                      padding: '16px',
                      marginBottom: '24px',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '18px' }}>🔔</span>
                        <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                          Pending Join Requests ({pendingRequests.length})
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                        {pendingRequests.map((req) => (
                          <div key={req.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--card-bg, #1a1c23)', padding: '10px 14px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <div style={{ backgroundColor: req.color || '#3b82f6', width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 'bold', color: '#fff' }}>
                                {req.initials || 'P'}
                              </div>
                              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{req.name}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button onClick={() => handleApproveRequest(req)} className="btn-create" style={{ padding: '4px 10px', fontSize: '12px' }}>
                                Accept
                              </button>
                              <button onClick={() => handleDenyRequest(req)} className="btn-signin" style={{ padding: '4px 10px', fontSize: '12px', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.2)', color: '#ef4444' }}>
                                Deny
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                  {spotlightParticipantId ? (
                    <div className="spotlight-stage-layout animate-fade-in">
                      <div className="spotlight-strip">
                        {callParticipants.map((p) => renderParticipantTile(p, true))}
                      </div>
                      <div className="spotlight-main">
                        {(() => {
                          const spotlightedPart = callParticipants.find(p => p.id === spotlightParticipantId);
                          return spotlightedPart ? (
                            <>
                              {renderParticipantTile(spotlightedPart, false)}
                              <button 
                                className="btn-exit-spotlight" 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSpotlightParticipantId(null);
                                }}
                              >
                                Exit Spotlight
                              </button>
                            </>
                          ) : null;
                        })()}
                      </div>
                    </div>
                  ) : (
                    <div 
                      className={`participants-container ${isGalleryView ? 'gallery-layout' : 'grid-layout'}`}
                      style={isGalleryView ? {
                        gridTemplateColumns: getGalleryColumns(callParticipants.length),
                        maxWidth: getGalleryMaxWidth(callParticipants.length)
                      } : {}}
                    >
                      {callParticipants.map((p) => renderParticipantTile(p, false))}
                    </div>
                  )}

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
                      {chatMessages.map((msg) => {
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
                      })}
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
                )}

                {/* 2B. People Tab Panel */}
                {callTab === 'people' && (
                  <div className="people-list animate-fade-in">
                    {callParticipants.map((p) => {
                      const isUser = p.id === getMyId();
                      const showMuted = isUser ? isMicMuted : p.isMuted;
                      
                      return (
                        <div key={p.id} className="person-row">
                          <div className="person-info">
                            <div 
                              className="person-avatar" 
                              style={{ 
                                backgroundColor: p.color, 
                                position: 'relative',
                                cursor: p.sharing ? 'pointer' : 'default',
                                border: p.sharing ? '1px solid var(--primary-color)' : 'none'
                              }}
                              onClick={() => {
                                if (p.sharing) {
                                  handleViewParticipantShare(p);
                                }
                              }}
                            >
                              {p.initials}
                              {p.sharing && (
                                <span style={{
                                  position: 'absolute',
                                  bottom: '-4px',
                                  right: '-4px',
                                  backgroundColor: 'var(--primary-color)',
                                  color: '#0f1013',
                                  borderRadius: '50%',
                                  width: '12px',
                                  height: '12px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '7px',
                                  fontWeight: 'bold',
                                  border: '1px solid var(--card-bg, #1a1c23)'
                                }}>
                                  {p.sharing === 'youtube' ? '▶' : p.sharing === 'whiteboard' ? '✎' : '⛶'}
                                </span>
                              )}
                            </div>
                            <div className="person-name-wrapper" style={{ display: 'flex', alignItems: 'center' }}>
                              <span className="person-name">{p.name}</span>
                              {p.role && p.role !== 'member' && (
                                <span className={`role-badge-${p.role}`} style={{
                                  fontSize: '9px',
                                  fontWeight: 'bold',
                                  padding: '1px 4px',
                                  borderRadius: '3px',
                                  border: '1px solid',
                                  textTransform: 'uppercase',
                                  lineHeight: '1',
                                  marginLeft: '6px',
                                  ...p.role === 'admin' ? {
                                    backgroundColor: 'rgba(241, 196, 15, 0.15)',
                                    borderColor: 'var(--primary-color, #f1c40f)',
                                    color: 'var(--primary-color, #f1c40f)'
                                  } : p.role === 'host' ? {
                                    backgroundColor: 'rgba(59, 130, 246, 0.15)',
                                    borderColor: '#3b82f6',
                                    color: '#3b82f6'
                                  } : {
                                    backgroundColor: 'rgba(16, 185, 129, 0.15)',
                                    borderColor: '#10b981',
                                    color: '#10b981'
                                  }
                                }}>
                                  {p.role === 'admin' ? '👑 Admin' : p.role === 'host' ? '⭐ Host' : '🛡️ Co-host'}
                                </span>
                              )}
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

                {/* 2C. Tools Tab Panel (Multi-view tools and sub-panels) */}
                {callTab === 'tools' && (
                  <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    
                    {activeToolDetail === 'none' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        {/* Section 1: Collaborative Tools */}
                        <div>
                          <h4 style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                            Collaborative Tools
                          </h4>
                          
                          <div className="tools-cards-grid">
                            {/* Whiteboard card button */}
                            <div 
                              className={`tool-card ${viewingShare?.type === 'whiteboard' && viewingShare?.participantId === getMyId() ? 'active' : ''}`}
                              onClick={async () => {
                                const myId = getMyId();
                                if (viewingShare?.type === 'whiteboard' && viewingShare?.participantId === myId) {
                                  await clearMySharing();
                                  setViewingShare(null);
                                  showToast('Whiteboard sharing stopped');
                                } else {
                                  await updateMySharing({ sharing: 'whiteboard', whiteboardData: '' });
                                  setViewingShare({ participantId: myId, type: 'whiteboard' });
                                  showToast('Whiteboard sharing started — click your avatar to view');
                                }
                              }}
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

                        {/* Section 2: Focus & Fun */}
                        <div>
                          <h4 style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                            Focus & Fun
                          </h4>
                          
                          <div className="tools-cards-grid">
                            
                            {/* Watch Together Card */}
                            <div 
                              className={`tool-card ${youtubeVideoId ? 'active' : ''}`}
                              onClick={() => {
                                setActiveToolDetail('youtube');
                                setActiveGameId(null);
                              }}
                              title="Watch YouTube together"
                            >
                              <div className="tool-card-icon-wrapper">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"></path>
                                  <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"></polygon>
                                </svg>
                              </div>
                              <div className="tool-card-info">
                                <span className="tool-card-title">Watch Together</span>
                                <span className="tool-card-desc">Play and stream YouTube links in call.</span>
                              </div>
                            </div>

                            {/* Games Party Card */}
                            <div 
                              className="tool-card"
                              onClick={() => {
                                setActiveToolDetail('games');
                                setActiveGameId(null);
                              }}
                              title="Play games together"
                            >
                              <div className="tool-card-icon-wrapper">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <rect x="2" y="6" width="20" height="12" rx="2"></rect>
                                  <path d="M6 12h4m-2-2v4m7-2h.01m2.99 0h.01"></path>
                                </svg>
                              </div>
                              <div className="tool-card-info">
                                <span className="tool-card-title">Games Party</span>
                                <span className="tool-card-desc">Play slither.io, JKLM, and party games.</span>
                              </div>
                            </div>

                            {/* Pomodoro Timer Card */}
                            <div 
                              className={`tool-card ${pomodoroIsRunning ? 'active' : ''}`}
                              onClick={() => {
                                setActiveToolDetail('pomodoro');
                                setActiveGameId(null);
                              }}
                              title="Shared Pomodoro Timer session"
                            >
                              <div className="tool-card-icon-wrapper" style={{ color: pomodoroIsRunning ? 'var(--primary-color)' : 'inherit' }}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <circle cx="12" cy="12" r="10"></circle>
                                  <polyline points="12 6 12 12 16 14"></polyline>
                                </svg>
                              </div>
                              <div className="tool-card-info">
                                <span className="tool-card-title">Pomodoro Timer</span>
                                <span className="tool-card-desc">
                                  {pomodoroIsRunning ? `Running (${pomodoroPhase})` : 'Start work/break cycle timer.'}
                                </span>
                              </div>
                            </div>

                          </div>
                        </div>

                        {/* Section 3: Progress & Focus */}
                        <div>
                          <h4 style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                            Progress & Focus
                          </h4>
                          
                          <div className="tools-cards-grid">
                            
                            {/* Session Target Card */}
                            <div 
                              className={`tool-card ${targetsList.some(t => !t.completed) ? 'active' : ''}`}
                              onClick={() => {
                                setActiveToolDetail('targets');
                                setActiveGameId(null);
                              }}
                              title="This week's target checklist"
                            >
                              <div className="tool-card-icon-wrapper">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="9 11 12 14 22 4"></polyline>
                                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
                                </svg>
                              </div>
                              <div className="tool-card-info">
                                <span className="tool-card-title">Session Target</span>
                                <span className="tool-card-desc">Weekly checklist and progress tracker.</span>
                              </div>
                            </div>

                            {/* Mini Deadline Clock Card */}
                            <div 
                              className={`tool-card ${deadlineIsRunning ? 'active' : ''}`}
                              onClick={() => {
                                setActiveToolDetail('deadline');
                                setActiveGameId(null);
                              }}
                              title="Stage-by-stage deadline budgets"
                            >
                              <div className="tool-card-icon-wrapper">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <circle cx="12" cy="12" r="10"></circle>
                                  <polyline points="12 6 12 12 15 15"></polyline>
                                </svg>
                              </div>
                              <div className="tool-card-info">
                                <span className="tool-card-title">Deadline Clock</span>
                                <span className="tool-card-desc">Budgeted session steps countdown.</span>
                              </div>
                            </div>

                            {/* Loose Timer Card */}
                            <div 
                              className={`tool-card ${looseIsRunning ? 'active' : ''}`}
                              onClick={() => {
                                setActiveToolDetail('loose');
                                setActiveGameId(null);
                              }}
                              title="Countup timer with per-step summary"
                            >
                              <div className="tool-card-icon-wrapper">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                                  <line x1="16" y1="2" x2="16" y2="6"></line>
                                  <line x1="8" y1="2" x2="8" y2="6"></line>
                                  <line x1="3" y1="10" x2="21" y2="10"></line>
                                </svg>
                              </div>
                              <div className="tool-card-info">
                                <span className="tool-card-title">Loose Timer</span>
                                <span className="tool-card-desc">Uncapped step-by-step elapsed timer.</span>
                              </div>
                            </div>

                          </div>
                        </div>

                      </div>
                    )}

                    {/* Sub-panel View 1: YouTube details */}
                    {activeToolDetail === 'youtube' && (
                      <div className="animate-fade-in">
                        <div className="tools-sub-panel-header">
                          <button onClick={() => setActiveToolDetail('none')} className="tools-back-btn" title="Back to tools list">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="19" y1="12" x2="5" y2="12"></line>
                              <polyline points="12 19 5 12 12 5"></polyline>
                            </svg>
                          </button>
                          <span className="tools-sub-panel-title">Watch Together</span>
                        </div>

                        <form onSubmit={handleWatchTogetherSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          <div className="form-group">
                            <label htmlFor="ytUrl" className="form-label" style={{ fontSize: '11px' }}>YouTube URL or Video ID</label>
                            <input 
                              type="text"
                              id="ytUrl"
                              placeholder="e.g. https://www.youtube.com/watch?v=dQw4w9WgXcQ"
                              className="search-input"
                              style={{ paddingLeft: '12px', fontSize: '13px' }}
                              value={ytInputUrl}
                              onChange={(e) => setYtInputUrl(e.target.value)}
                              required
                            />
                          </div>
                          <button type="submit" className="btn-signin" style={{ width: '100%', padding: '10px' }}>
                            Load Video
                          </button>
                        </form>
                        
                        {youtubeVideoId && (
                          <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Currently Playing Video ID: <strong>{youtubeVideoId}</strong></span>
                            <button 
                              onClick={async () => {
                                setYoutubeVideoId(null);
                                await clearMySharing();
                                setViewingShare(null);
                                showToast('YouTube presentation stopped');
                              }} 
                              className="btn-signin" 
                              style={{ width: '100%', backgroundColor: '#ef4444', borderColor: '#ef4444', color: '#ffffff' }}
                            >
                              Stop Watching
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Sub-panel View 2: Games Selector Details */}
                    {activeToolDetail === 'games' && (
                      <div className="animate-fade-in">
                        <div className="tools-sub-panel-header">
                          <button 
                            onClick={() => {
                              if (activeGameId) {
                                setActiveGameId(null);
                              } else {
                                setActiveToolDetail('none');
                              }
                            }} 
                            className="tools-back-btn" 
                            title="Back"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="19" y1="12" x2="5" y2="12"></line>
                              <polyline points="12 19 5 12 12 5"></polyline>
                            </svg>
                          </button>
                          <span className="tools-sub-panel-title">
                            {activeGameId ? `Play ${activeGameId.toUpperCase()}` : 'Games Party'}
                          </span>
                        </div>

                        {!activeGameId ? (
                          /* Grid of game options */
                          <div className="games-options-grid">
                            
                            {/* Agar.io */}
                            <div className="game-card-item" onClick={() => handleLaunchGame('agar')}>
                              <div className="game-item-icon-wrapper">🦠</div>
                              <span className="game-card-name">Agar.io</span>
                            </div>

                            {/* Slither.io */}
                            <div className="game-card-item" onClick={() => handleLaunchGame('slither')}>
                              <div className="game-item-icon-wrapper">🐍</div>
                              <span className="game-card-name">Slither.io</span>
                            </div>

                            {/* Skribbl.io */}
                            <div className="game-card-item" onClick={() => handleLaunchGame('skribbl')}>
                              <div className="game-item-icon-wrapper">✏️</div>
                              <span className="game-card-name">Skribbl.io</span>
                            </div>

                            {/* Codenames */}
                            <div className="game-card-item" onClick={() => handleLaunchGame('codenames')}>
                              <div className="game-item-icon-wrapper">🕵️</div>
                              <span className="game-card-name">Codenames</span>
                            </div>

                            {/* JKLM */}
                            <div className="game-card-item" onClick={() => handleLaunchGame('jklm')}>
                              <div className="game-item-icon-wrapper">💣</div>
                              <span className="game-card-name">JKLM.fun</span>
                            </div>

                          </div>
                        ) : (
                          /* Form to generate or paste invite links */
                          <form onSubmit={handleShareGameInvite} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div className="form-group">
                              <label htmlFor="inviteUrl" className="form-label" style={{ fontSize: '11px' }}>Game Room Invite Link</label>
                              <input 
                                type="text"
                                id="inviteUrl"
                                className="search-input"
                                style={{ paddingLeft: '12px', fontSize: '13px' }}
                                value={gameInviteInput}
                                onChange={(e) => setGameInviteInput(e.target.value)}
                                required
                              />
                            </div>
                            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                              Clicking "Start sharing" will launch the game in a new browser tab and automatically share the invite URL in the room chat for others to join!
                            </span>
                            <button type="submit" className="btn-signin" style={{ width: '100%', padding: '10px' }}>
                              Start Sharing & Launch
                            </button>
                          </form>
                        )}
                      </div>
                    )}

                    {/* Sub-panel View 3: Pomodoro Timer Controls */}
                    {activeToolDetail === 'pomodoro' && (
                      <div className="animate-fade-in">
                        <div className="tools-sub-panel-header">
                          <button onClick={() => setActiveToolDetail('none')} className="tools-back-btn" title="Back">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="19" y1="12" x2="5" y2="12"></line>
                              <polyline points="12 19 5 12 12 5"></polyline>
                            </svg>
                          </button>
                          <span className="tools-sub-panel-title">Pomodoro Timer</span>
                        </div>

                        <div className="pomodoro-panel-container">
                          
                          {/* Timer circle display */}
                          <div className={`pomodoro-timer-circle ${pomodoroPhase === 'focus' ? 'active-focus' : 'active-break'}`}>
                            <span className="pomodoro-time-digits">
                              {pomodoroMinutes.toString().padStart(2, '0')}:
                              {pomodoroSeconds.toString().padStart(2, '0')}
                            </span>
                            <span className={`pomodoro-phase-label ${pomodoroPhase}`}>
                              {pomodoroPhase === 'focus' ? 'Focus Session' : 'Short Break'}
                            </span>
                          </div>

                          {/* Host Controls */}
                          <div className="pomodoro-button-row">
                            <button 
                              onClick={togglePomodoro} 
                              className="btn-create" 
                              style={{ 
                                padding: '8px 16px', 
                                fontSize: '13px', 
                                backgroundColor: pomodoroIsRunning ? 'var(--button-secondary-bg)' : 'var(--primary-color)',
                                color: pomodoroIsRunning ? 'var(--text-primary)' : 'var(--primary-text)',
                                border: '1px solid var(--border-color)' 
                              }}
                            >
                              {pomodoroIsRunning ? 'Pause' : 'Start'}
                            </button>
                            
                            <button 
                              onClick={skipPomodoroPhase} 
                              className="btn-signin" 
                              style={{ padding: '8px 16px', fontSize: '13px', backgroundColor: 'var(--button-secondary-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                            >
                              Skip
                            </button>
                          </div>

                          {/* Adjust Lengths Row controls */}
                          <div className="pomodoro-adjusters-container">
                            
                            {/* Focus adjust */}
                            <div className="pomodoro-adjust-row">
                              <span className="pomodoro-adjust-label">Focus Length</span>
                              <div className="pomodoro-adjust-controls">
                                <button type="button" onClick={() => adjustPomodoroLength('focus', -1)} className="pomodoro-adjust-btn">-</button>
                                <span className="pomodoro-adjust-val">{pomodoroFocusLength}m</span>
                                <button type="button" onClick={() => adjustPomodoroLength('focus', 1)} className="pomodoro-adjust-btn">+</button>
                              </div>
                            </div>

                            {/* Break adjust */}
                            <div className="pomodoro-adjust-row">
                              <span className="pomodoro-adjust-label">Break Length</span>
                              <div className="pomodoro-adjust-controls">
                                <button type="button" onClick={() => adjustPomodoroLength('break', -1)} className="pomodoro-adjust-btn">-</button>
                                <span className="pomodoro-adjust-val">{pomodoroBreakLength}m</span>
                                <button type="button" onClick={() => adjustPomodoroLength('break', 1)} className="pomodoro-adjust-btn">+</button>
                              </div>
                            </div>

                          </div>

                        </div>
                      </div>
                    )}

                    {/* Sub-panel View 4: Session Target checklist */}
                    {activeToolDetail === 'targets' && (
                      <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column' }}>
                        <div className="tools-sub-panel-header">
                          <button onClick={() => setActiveToolDetail('none')} className="tools-back-btn" title="Back">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="19" y1="12" x2="5" y2="12"></line>
                              <polyline points="12 19 5 12 12 5"></polyline>
                            </svg>
                          </button>
                          <span className="tools-sub-panel-title">Session Target</span>
                        </div>

                        {/* Checklist Container */}
                        <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius)', padding: '16px', marginBottom: '16px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                            <div>
                              <h5 style={{ fontSize: '14px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>This week's targets</h5>
                              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Week of Jul 6 – Jul 12</span>
                            </div>
                            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--primary-color)' }}>
                              {targetsList.filter(t => t.completed).length} / {targetsList.length} done
                            </span>
                          </div>

                          {/* List of items */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', margin: '16px 0' }}>
                            {targetsList.map(item => (
                              <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px', color: item.completed ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
                                <input 
                                  type="checkbox" 
                                  checked={item.completed}
                                  onChange={() => handleToggleTarget(item.id)}
                                  style={{
                                    width: '16px',
                                    height: '16px',
                                    borderRadius: '4px',
                                    border: '1px solid var(--border-color)',
                                    cursor: 'pointer',
                                    accentColor: 'var(--primary-color)'
                                  }}
                                />
                                <span style={{ textDecoration: item.completed ? 'line-through' : 'none' }}>
                                  {item.text}
                                </span>
                              </label>
                            ))}
                            {targetsList.length === 0 && (
                              <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontStyle: 'italic', textAlign: 'center', display: 'block', padding: '12px 0' }}>
                                No targets set for this week yet.
                              </span>
                            )}
                          </div>

                          {/* Add target form */}
                          <form onSubmit={handleAddTarget} style={{ display: 'flex', gap: '8px' }}>
                            <input 
                              type="text"
                              placeholder="Add a target for this week"
                              className="search-input"
                              style={{ paddingLeft: '12px', fontSize: '13px', height: '36px' }}
                              value={targetInputText}
                              onChange={(e) => setTargetInputText(e.target.value)}
                              required
                            />
                            <button type="submit" className="btn-signin" style={{ width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                              +
                            </button>
                          </form>
                        </div>

                        {/* Progress History strip */}
                        <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '16px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                              Progress History
                            </span>
                            <button 
                              onClick={handleStartNewWeek} 
                              className="btn-signin" 
                              style={{ padding: '4px 8px', fontSize: '10px', height: 'auto', backgroundColor: 'var(--button-secondary-bg)', border: '1px solid var(--border-color)' }}
                              title="Archive current checklist and start a new week"
                            >
                              New Week
                            </button>
                          </div>

                          {/* History Bars Row */}
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                            {targetsHistory.map((hist, idx) => {
                              const fullyDone = hist.completedCount === hist.totalCount && hist.totalCount > 0;
                              const barColor = fullyDone ? '#10b981' : '#f59e0b'; // Green vs Amber
                              return (
                                <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                  <div 
                                    style={{ 
                                      height: '32px', 
                                      borderRadius: '4px', 
                                      backgroundColor: barColor, 
                                      opacity: 0.8,
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      fontSize: '9px',
                                      fontWeight: 800,
                                      color: '#000000'
                                    }}
                                    title={`${hist.completedCount}/${hist.totalCount} completed`}
                                  >
                                    {hist.completedCount}/{hist.totalCount}
                                  </div>
                                  <span style={{ fontSize: '9px', color: 'var(--text-secondary)', textAlign: 'center' }}>
                                    {hist.date}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                      </div>
                    )}

                    {/* Sub-panel View 5: Mini Deadline Clock */}
                    {activeToolDetail === 'deadline' && (
                      <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column' }}>
                        <div className="tools-sub-panel-header">
                          <button onClick={() => setActiveToolDetail('none')} className="tools-back-btn" title="Back">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="19" y1="12" x2="5" y2="12"></line>
                              <polyline points="12 19 5 12 12 5"></polyline>
                            </svg>
                          </button>
                          <span className="tools-sub-panel-title">Deadline Clock</span>
                        </div>

                        {/* Top Area: Current Step + Countdown */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: '16px' }}>
                          <span style={{ fontSize: '9px', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.05em' }}>CURRENT STEP</span>
                          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '2px' }}>
                            {deadlineActiveIndex + 1}. {deadlineSteps[deadlineActiveIndex]?.name || 'No steps'}
                          </span>
                          <span style={{ fontSize: '32px', fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-primary)', margin: '8px 0' }}>
                            {deadlineTimerMinutes.toString().padStart(2, '0')}:
                            {deadlineTimerSeconds.toString().padStart(2, '0')}
                          </span>

                          {/* Control Row */}
                          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                            <button 
                              onClick={deadlineIsRunning ? () => setDeadlineIsRunning(false) : startDeadlineTimer} 
                              className="btn-create" 
                              style={{ 
                                padding: '6px 12px', 
                                fontSize: '12px', 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '4px',
                                backgroundColor: deadlineIsRunning ? 'var(--button-secondary-bg)' : 'var(--primary-color)',
                                color: deadlineIsRunning ? 'var(--text-primary)' : 'var(--primary-text)'
                              }}
                            >
                              {deadlineIsRunning ? 'Pause' : 'Start'}
                            </button>
                            <button 
                              onClick={finishDeadlineStep} 
                              className="btn-signin" 
                              style={{ padding: '6px 12px', fontSize: '12px', backgroundColor: 'var(--button-secondary-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                            >
                              Finish step
                            </button>
                            <button 
                              onClick={resetDeadlineTimer} 
                              className="btn-signin" 
                              style={{ padding: '6px 8px', fontSize: '12px', backgroundColor: 'var(--button-secondary-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                              title="Reset step timer"
                            >
                              🔄
                            </button>
                          </div>
                        </div>

                        {/* Middle Area: Scrollable Step List (inside a fixed-height parent) */}
                        <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', padding: '12px 0', height: '220px', overflowY: 'auto' }}>
                          <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>
                            STEPS · SCROLL FOR MORE
                          </span>
                          
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {deadlineSteps.map((step, idx) => {
                              const isActive = idx === deadlineActiveIndex;
                              return (
                                <div 
                                  key={step.id} 
                                  style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    justifyContent: 'space-between',
                                    backgroundColor: isActive ? 'rgba(241, 196, 15, 0.08)' : 'rgba(255, 255, 255, 0.01)',
                                    border: isActive ? '1px solid var(--primary-color)' : '1px solid var(--border-color)',
                                    borderRadius: 'var(--btn-radius)',
                                    padding: '8px 10px',
                                    transition: 'all var(--transition-speed) ease'
                                  }}
                                >
                                  {/* Dot + Step Title */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                                    <div 
                                      style={{ 
                                        width: '8px', 
                                        height: '8px', 
                                        borderRadius: '50%', 
                                        border: '1px solid var(--text-secondary)',
                                        backgroundColor: isActive ? 'var(--primary-color)' : 'transparent',
                                        flexShrink: 0
                                      }}
                                    />
                                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {idx + 1}. {step.name}
                                    </span>
                                  </div>

                                  {/* Budget Controls */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '12px', flexShrink: 0 }}>
                                    <button 
                                      type="button" 
                                      onClick={() => adjustDeadlineMinutes(step.id, -1)} 
                                      style={{ width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-color)', borderRadius: '3px', backgroundColor: 'var(--button-secondary-bg)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}
                                    >-</button>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '32px' }}>
                                      <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>{step.minutes}</span>
                                      <span style={{ fontSize: '8px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>min</span>
                                    </div>
                                    <button 
                                      type="button" 
                                      onClick={() => adjustDeadlineMinutes(step.id, 1)} 
                                      style={{ width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-color)', borderRadius: '3px', backgroundColor: 'var(--button-secondary-bg)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}
                                    >+</button>
                                    <button 
                                      type="button" 
                                      onClick={() => deleteDeadlineStep(step.id)} 
                                      style={{ width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: '3px', backgroundColor: 'transparent', color: '#ef4444', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold', marginLeft: '4px' }}
                                      title="Delete step"
                                    >×</button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Bottom Area: Add step and Reset controls (fixed layout) */}
                        <div style={{ paddingTop: '12px' }}>
                          {isAddingDeadlineStep ? (
                            <form 
                              onSubmit={handleAddDeadlineStep} 
                              style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}
                            >
                              <input 
                                type="text"
                                placeholder="Step name..."
                                className="search-input"
                                style={{ paddingLeft: '8px', fontSize: '12px', height: '32px' }}
                                value={deadlineNewStepName}
                                onChange={(e) => setDeadlineNewStepName(e.target.value)}
                                autoFocus
                                required
                              />
                              <button type="submit" className="btn-signin" style={{ padding: '0 12px', height: '32px', fontSize: '12px' }}>
                                Add
                              </button>
                              <button type="button" onClick={() => setIsAddingDeadlineStep(false)} className="btn-signin" style={{ padding: '0 8px', height: '32px', fontSize: '12px', backgroundColor: 'transparent', border: 'none' }}>
                                Cancel
                              </button>
                            </form>
                          ) : (
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button 
                                onClick={() => setIsAddingDeadlineStep(true)} 
                                className="btn-signin" 
                                style={{ flex: 1, padding: '8px', fontSize: '12px', backgroundColor: 'var(--button-secondary-bg)', border: '1px solid var(--border-color)' }}
                              >
                                + Add step
                              </button>
                              <button 
                                onClick={resetDeadlineClockDefault} 
                                className="btn-signin" 
                                style={{ flex: 1, padding: '8px', fontSize: '12px', backgroundColor: 'var(--button-secondary-bg)', border: '1px solid var(--border-color)' }}
                              >
                                Reset to default
                              </button>
                            </div>
                          )}
                        </div>

                      </div>
                    )}

                    {/* Sub-panel View 6: Loose Timer */}
                    {activeToolDetail === 'loose' && (
                      <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column' }}>
                        <div className="tools-sub-panel-header">
                          <button onClick={() => setActiveToolDetail('none')} className="tools-back-btn" title="Back">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="19" y1="12" x2="5" y2="12"></line>
                              <polyline points="12 19 5 12 12 5"></polyline>
                            </svg>
                          </button>
                          <span className="tools-sub-panel-title">Loose Timer</span>
                        </div>

                        {/* Top Area: Current Step + Countup */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: '16px' }}>
                          <span style={{ fontSize: '9px', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.05em' }}>CURRENT STEP</span>
                          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '2px' }}>
                            {looseActiveIndex + 1}. {looseSteps[looseActiveIndex]?.name || 'No steps'}
                          </span>
                          <span style={{ fontSize: '32px', fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-primary)', marginTop: '8px' }}>
                            {(Math.floor(looseTimerSeconds / 60)).toString().padStart(2, '0')}:
                            {(looseTimerSeconds % 60).toString().padStart(2, '0')}
                          </span>
                          <span style={{ fontSize: '9px', color: 'var(--text-secondary)', textTransform: 'uppercase', margin: '4px 0 10px 0', letterSpacing: '0.02em' }}>
                            No time limit · counting up
                          </span>

                          {/* Control Row */}
                          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                            <button 
                              onClick={() => setLooseIsRunning(!looseIsRunning)} 
                              className="btn-create" 
                              style={{ 
                                padding: '6px 12px', 
                                fontSize: '12px', 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '4px',
                                backgroundColor: looseIsRunning ? 'var(--button-secondary-bg)' : 'var(--primary-color)',
                                color: looseIsRunning ? 'var(--text-primary)' : 'var(--primary-text)'
                              }}
                            >
                              {looseIsRunning ? 'Pause' : 'Start'}
                            </button>
                            <button 
                              onClick={finishLooseStep} 
                              className="btn-signin" 
                              style={{ padding: '6px 12px', fontSize: '12px', backgroundColor: 'var(--button-secondary-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                            >
                              Finish step
                            </button>
                            <button 
                              onClick={resetLooseTimer} 
                              className="btn-signin" 
                              style={{ padding: '6px 8px', fontSize: '12px', backgroundColor: 'var(--button-secondary-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                              title="Reset timer"
                            >
                              🔄
                            </button>
                          </div>
                        </div>

                        {/* Middle Area: Scrollable Step List */}
                        <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', padding: '12px 0', height: '160px', overflowY: 'auto' }}>
                          <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>
                            STEPS · SCROLL FOR MORE
                          </span>
                          
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {looseSteps.map((step, idx) => {
                              const isActive = idx === looseActiveIndex;
                              return (
                                <div 
                                  key={step.id} 
                                  style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    justifyContent: 'space-between',
                                    backgroundColor: isActive ? 'rgba(241, 196, 15, 0.08)' : 'rgba(255, 255, 255, 0.01)',
                                    border: isActive ? '1px solid var(--primary-color)' : '1px solid var(--border-color)',
                                    borderRadius: 'var(--btn-radius)',
                                    padding: '8px 10px',
                                    transition: 'all var(--transition-speed) ease'
                                  }}
                                >
                                  {/* Dot + Step Title */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                                    <div 
                                      style={{ 
                                        width: '8px', 
                                        height: '8px', 
                                        borderRadius: '50%', 
                                        border: '1px solid var(--text-secondary)',
                                        backgroundColor: step.status === 'completed' ? 'var(--text-secondary)' : isActive ? 'var(--primary-color)' : 'transparent',
                                        flexShrink: 0
                                      }}
                                    />
                                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: step.status === 'completed' ? 'line-through' : 'none' }}>
                                      {idx + 1}. {step.name}
                                    </span>
                                  </div>

                                  {/* Delete button */}
                                  <button 
                                    type="button" 
                                    onClick={() => deleteLooseStep(step.id)} 
                                    style={{ width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: '3px', backgroundColor: 'transparent', color: '#ef4444', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}
                                    title="Delete step"
                                  >×</button>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Add / Reset controls (fixed layout at the bottom) */}
                        <div style={{ padding: '12px 0 16px 0', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                          {isAddingLooseStep ? (
                            <form 
                              onSubmit={handleAddLooseStep} 
                              style={{ display: 'flex', gap: '6px' }}
                            >
                              <input 
                                type="text"
                                placeholder="Step name..."
                                className="search-input"
                                style={{ paddingLeft: '8px', fontSize: '12px', height: '32px' }}
                                value={looseNewStepName}
                                onChange={(e) => setLooseNewStepName(e.target.value)}
                                autoFocus
                                required
                              />
                              <button type="submit" className="btn-signin" style={{ padding: '0 12px', height: '32px', fontSize: '12px' }}>
                                Add
                              </button>
                              <button type="button" onClick={() => setIsAddingLooseStep(false)} className="btn-signin" style={{ padding: '0 8px', height: '32px', fontSize: '12px', backgroundColor: 'transparent', border: 'none' }}>
                                Cancel
                              </button>
                            </form>
                          ) : (
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button 
                                onClick={() => setIsAddingLooseStep(true)} 
                                className="btn-signin" 
                                style={{ flex: 1, padding: '8px', fontSize: '12px', backgroundColor: 'var(--button-secondary-bg)', border: '1px solid var(--border-color)' }}
                              >
                                + Add step
                              </button>
                              <button 
                                onClick={resetLooseClockDefault} 
                                className="btn-signin" 
                                style={{ flex: 1, padding: '8px', fontSize: '12px', backgroundColor: 'var(--button-secondary-bg)', border: '1px solid var(--border-color)' }}
                              >
                                Reset to default
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Bottom summary block */}
                        <div style={{ padding: '12px 0 4px 0' }}>
                          <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>
                            STEP TIME SUMMARY
                          </span>
                          
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '120px', overflowY: 'auto' }}>
                            {looseSteps.map((step) => {
                              const minutes = Math.floor(step.elapsedSeconds / 60);
                              const seconds = step.elapsedSeconds % 60;
                              const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                              
                              return (
                                <div key={step.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                                  <span style={{ color: 'var(--text-secondary)' }}>{step.name}</span>
                                  {step.status === 'completed' && (
                                    <span style={{ color: '#10b981', fontWeight: 600 }}>done · {timeStr}</span>
                                  )}
                                  {step.status === 'active' && (
                                    <span style={{ color: 'var(--primary-color)', fontWeight: 600, animation: 'pulse 1.5s infinite' }}>in progress · {timeStr}</span>
                                  )}
                                  {step.status === 'pending' && (
                                    <span style={{ color: 'var(--text-secondary)', opacity: 0.5 }}>not completed</span>
                                  )}
                                </div>
                              );
                            })}

                            {/* Total summary once all done */}
                            {looseSteps.every(s => s.status === 'completed') && (
                              <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px dashed rgba(255, 255, 255, 0.1)', display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 700, color: 'var(--primary-color)' }}>
                                <span>TOTAL TIME</span>
                                <span>
                                  {Math.floor(looseSteps.reduce((acc, s) => acc + s.elapsedSeconds, 0) / 60).toString().padStart(2, '0')}:
                                  {(looseSteps.reduce((acc, s) => acc + s.elapsedSeconds, 0) % 60).toString().padStart(2, '0')}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                      </div>
                    )}

                  </div>
                )}

              </div>
            </div>

          </div>

          {/* Call Control Dock (Bottom Toolbar) */}
          <div className="call-bottom-dock">
            
            {/* Mic Toggle Button */}
            <button 
              onClick={toggleMic} 
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
              onClick={toggleCamera} 
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
              style={{ marginRight: '8px' }}
              title="Leave room call"
            >
              Leave
            </button>
            
            {/* End Room Button */}
            {(callParticipants.find(part => part.id === getMyId())?.role === 'admin' || 
              (callParticipants.find(part => part.id === getMyId())?.role === 'host' && currentRoom && currentRoom.creatorId === getMyId())) && (
              <button 
                onClick={handleEndRoom} 
                className="dock-btn dock-btn-leave"
                style={{ backgroundColor: '#ef4444', borderColor: '#ef4444', color: '#ffffff' }}
                title="End room call for everyone"
              >
                End Room
              </button>
            )}

          </div>

        </LiveKitRoom>
          </div>
          )
        ) : (
          <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: '16px' }}>
            <div 
              style={{ 
                width: '40px', 
                height: '40px', 
                borderRadius: '50%',
                border: '3px solid rgba(255,255,255,0.1)', 
                borderTopColor: 'var(--primary-color)', 
                animation: 'spin 1s linear infinite' 
              }}
            />
            <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Joining study room...</span>
          </div>
        )
      } />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>

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

      {/* Sign In Prompt Modal */}
      {showSignInPrompt && !user && (
        <div className="modal-overlay" style={{ zIndex: 1200 }}>
          <div className="modal-container animate-fade-in" style={{ maxWidth: '400px', textAlign: 'center' }}>
            <h3 style={{ fontSize: '18px', marginBottom: '12px', fontWeight: '600' }}>Sign in to create a room</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '14px', lineHeight: '1.5' }}>
              You need a Google account to create and host rooms.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button type="button" className="btn-secondary" onClick={() => setShowSignInPrompt(false)} style={{ padding: '8px 16px' }}>Cancel</button>
              <button type="button" className="btn-signin" onClick={() => {
                setShowSignInPrompt(false);
                handleSignIn().then(() => {
                  // After successful sign in, open the modal
                  setTimeout(() => setIsModalOpen(true), 500);
                });
              }} style={{ padding: '8px 16px' }}>Sign in</button>
            </div>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button 
                      type="button"
                      onClick={() => setNewMaxParticipants(Math.max(0, newMaxParticipants - 1))}
                      style={{ width: '44px', height: '44px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--panel-bg)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </button>
                    <input 
                      type="number" 
                      id="maxParticipants" 
                      min="0" 
                      max="100"
                      className="search-input"
                      style={{ textAlign: 'center', flex: 1, padding: '0' }}
                      value={newMaxParticipants}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setNewMaxParticipants(isNaN(val) ? 0 : val);
                      }}
                      required
                    />
                    <button 
                      type="button"
                      onClick={() => setNewMaxParticipants(Math.min(100, newMaxParticipants + 1))}
                      style={{ width: '44px', height: '44px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--panel-bg)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </button>
                  </div>
                  {newMaxParticipants === 0 && (
                    <div style={{ color: '#ef4444', fontSize: '13px', marginTop: '8px', fontWeight: 500 }}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline', marginRight: '4px', verticalAlign: 'text-bottom' }}><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                      At least 1 participant is required.
                    </div>
                  )}
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
                  <a 
                    href={`/room/${generatedRoomLink.split('/').pop()}`}
                    onClick={(e) => {
                      e.preventDefault();
                      closeModal();
                      window.open(`/room/${generatedRoomLink.split('/').pop()}`, '_blank');
                    }}
                    style={{ 
                      fontFamily: 'monospace', 
                      fontSize: '14px', 
                      color: 'var(--primary-color)', 
                      padding: '8px 12px',
                      textAlign: 'left',
                      flexGrow: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      textDecoration: 'underline',
                      cursor: 'pointer'
                    }}
                  >
                    {generatedRoomLink}
                  </a>
                  
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

              <div className="form-group" style={{ marginBottom: '20px' }}>
                <label htmlFor="profilePhotoURL" className="form-label">Avatar Image URL (optional)</label>
                <input 
                  type="url" 
                  id="profilePhotoURL"
                  className="search-input"
                  style={{ paddingLeft: '16px' }}
                  value={profileEditPhotoURL}
                  onChange={(e) => setProfileEditPhotoURL(e.target.value)}
                  placeholder="https://example.com/avatar.png"
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
