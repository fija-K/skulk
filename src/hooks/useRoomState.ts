import { useState, useEffect } from 'react';
import type { MutableRefObject } from 'react';
import { 
  doc, 
  collection, 
  onSnapshot
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Room, ChatMessage, ViewingShare } from '../App';

export function useRoomState(
  roomId: string | null,
  user: any,
  guestId: string,
  localJoinTimeRef: MutableRefObject<number | null>,
  showToast: (msg: string) => void,
  handleLeaveCall: () => void
) {
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [systemMessages, setSystemMessages] = useState<any[]>([]);
  const [activeBots, setActiveBots] = useState<{ id: string; name: string; addedBy: string }[]>([]);
  const [viewingShare, setViewingShare] = useState<ViewingShare | null>(null);

  // Theme states or widgets can stay in App, but tools states are synced from room document:
  const [allowFunTools, setAllowFunTools] = useState(true);
  const [todSpinResult, setTodSpinResult] = useState<any>(null);
  const [todSpinPool, setTodSpinPool] = useState<string[]>([]);
  const [todState, setTodState] = useState<'idle' | 'spinning' | 'choice' | 'reveal'>('idle');
  const [todChoice, setTodChoice] = useState<'Truth' | 'Dare' | null>(null);
  const [todText, setTodText] = useState<string>('');
  const [todSelectedId, setTodSelectedId] = useState<string>('');
  const [spinResult, setSpinResult] = useState<any>(null);
  const [spinCheckedIds, setSpinCheckedIds] = useState<string[]>([]);
  const [spinPool, setSpinPool] = useState<string[]>([]);

  // Pomodoro states that sync from room doc:
  const [pomodoroIsRunning, setPomodoroIsRunning] = useState(false);
  const [pomodoroMinutes, setPomodoroMinutes] = useState(25);
  const [pomodoroSeconds, setPomodoroSeconds] = useState(0);
  const [pomodoroPhase, setPomodoroPhase] = useState<'focus' | 'break'>('focus');

  const getMyId = () => user ? user.uid : (guestId || localStorage.getItem('skulk_guest_id') || '');

  // Real-time synchronization of room document updates (Pomodoro, Fun tools, etc.)
  useEffect(() => {
    if (!roomId) {
      setCurrentRoom(null);
      return;
    }

    const roomRef = doc(db, 'rooms', roomId);
    const unsubscribe = onSnapshot(roomRef, (docSnap) => {
      if (!docSnap.exists()) {
        showToast("⚠️ This room has been closed by the host.");
        handleLeaveCall();
        return;
      }
      const data = docSnap.data();
      
      setCurrentRoom((prev: Room | null) => {
        const base = prev || ({
          id: docSnap.id,
          name: data.name || '',
          type: data.type || 'public',
          buttonText: data.type === 'public-ask' ? 'Ask to join' : 'Join',
          participants: data.participants || [],
          maxParticipants: data.maxParticipants || 10,
        } as Room);
        return {
          ...base,
          name: data.name ?? base.name,
          creatorName: data.creatorName ?? base.creatorName,
          creatorEmail: data.creatorEmail ?? base.creatorEmail,
          type: data.type ?? base.type,
          roomMode: data.roomMode ?? base.roomMode ?? 'chill',
          allowFunTools: data.allowFunTools ?? base.allowFunTools ?? true
        };
      });

      // Sync Pomodoro
      if (data.pomodoroIsRunning !== undefined) {
        setPomodoroIsRunning(data.pomodoroIsRunning);
      }
      if (data.pomodoroMinutes !== undefined && !data.pomodoroIsRunning) {
        setPomodoroMinutes(data.pomodoroMinutes);
      }
      if (data.pomodoroSeconds !== undefined && !data.pomodoroIsRunning) {
        setPomodoroSeconds(data.pomodoroSeconds);
      }
      if (data.pomodoroPhase !== undefined) {
        setPomodoroPhase(data.pomodoroPhase);
      }

      // Sync new tools tab fields
      if (data.allowFunTools !== undefined) {
        setAllowFunTools(data.allowFunTools);
      }
      if (data.todSpinResult !== undefined) {
        setTodSpinResult(data.todSpinResult);
      }
      if (data.todSpinPool !== undefined) {
        setTodSpinPool(data.todSpinPool);
      }
      if (data.todState !== undefined) {
        setTodState(data.todState);
      }
      if (data.todChoice !== undefined) {
        setTodChoice(data.todChoice);
      }
      if (data.todText !== undefined) {
        setTodText(data.todText);
      }
      if (data.todSelectedId !== undefined) {
        setTodSelectedId(data.todSelectedId);
      }
      if (data.spinResult !== undefined) {
        setSpinResult(data.spinResult);
      }
      if (data.spinCheckedIds !== undefined) {
        setSpinCheckedIds(data.spinCheckedIds);
      }
      if (data.spinPool !== undefined) {
        setSpinPool(data.spinPool);
      }
    }, (error) => {
      console.warn("Room document subscription failed:", error);
    });
    
    return () => unsubscribe();
  }, [roomId, pomodoroIsRunning]);

  // Sync YouTube / Spotify video ID when viewing someone's share
  useEffect(() => {
    if (!viewingShare || (viewingShare.type !== 'youtube' && viewingShare.type !== 'spotify') || !roomId) return;

    const partRef = doc(db, 'rooms', roomId, 'participants', viewingShare.participantId);
    const unsubscribe = onSnapshot(partRef, (snapshot) => {
      if (!snapshot.exists()) {
        if (viewingShare.participantId !== getMyId()) {
          setViewingShare(null);
          showToast(`${viewingShare.type === 'youtube' ? 'YouTube' : 'Spotify'} presenter has left. Ending session.`);
        }
        return;
      }
      const data = snapshot.data();
      if (data.sharingYoutubeId && viewingShare.participantId !== getMyId()) {
        setViewingShare((prev: ViewingShare | null) => prev ? { ...prev, youtubeVideoId: data.sharingYoutubeId } : null);
      }
      if (!data.sharing && viewingShare.participantId !== getMyId()) {
        setViewingShare(null);
      }
    }, (error) => {
      console.warn("Spotify/YouTube presenter sync failed:", error);
    });
    return () => unsubscribe();
  }, [viewingShare?.participantId, viewingShare?.type, roomId, user, guestId]);

  // Sync screen share state when viewing someone's share
  useEffect(() => {
    if (!viewingShare || viewingShare.type !== 'screen' || !roomId) return;

    const partRef = doc(db, 'rooms', roomId, 'participants', viewingShare.participantId);
    const unsubscribe = onSnapshot(partRef, (snapshot) => {
      if (!snapshot.exists()) {
        if (viewingShare.participantId !== getMyId()) {
          setViewingShare(null);
          showToast('Screen presenter has left. Ending session.');
        }
        return;
      }
      const data = snapshot.data();
      if (!data.sharing && viewingShare.participantId !== getMyId()) {
        setViewingShare(null);
      }
    }, (error) => {
      console.warn("Screen presenter sync failed:", error);
    });
    return () => unsubscribe();
  }, [viewingShare?.participantId, viewingShare?.type, roomId, user, guestId]);

  // Real-time synchronization of chat messages inside calls
  useEffect(() => {
    if (!roomId) return;
    
    const messagesRef = collection(db, 'rooms', roomId, 'messages');
    
    const unsubscribe = onSnapshot(messagesRef, (snapshot) => {
      const list = snapshot.docs.map(docSnap => docSnap.data() as ChatMessage);
      
      const joinTime = localJoinTimeRef.current || Date.now();
      const filtered = list.filter(msg => {
        if (!msg.createdAt) return true;
        return new Date(msg.createdAt).getTime() >= joinTime;
      });

      filtered.sort((a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeA - timeB;
      });
      setChatMessages(filtered);
    }, (error) => {
      console.warn("Firestore chat subscription failed:", error);
    });
    
    return () => unsubscribe();
  }, [roomId]);

  // Sync active bots
  useEffect(() => {
    if (!roomId) {
      setActiveBots([]);
      return;
    }
    
    const botsRef = collection(db, 'rooms', roomId, 'bots');
    const unsubscribe = onSnapshot(botsRef, (snapshot) => {
      const list = snapshot.docs.map(docSnap => docSnap.data() as { id: string; name: string; addedBy: string });
      setActiveBots(list);
    }, (error) => {
      console.warn("Firestore bots subscription failed:", error);
    });
    
    return () => unsubscribe();
  }, [roomId]);

  return {
    currentRoom,
    setCurrentRoom,
    chatMessages,
    setChatMessages,
    systemMessages,
    setSystemMessages,
    viewingShare,
    setViewingShare,

    // Fun tools state
    allowFunTools,
    setAllowFunTools,
    todSpinResult,
    setTodSpinResult,
    todSpinPool,
    setTodSpinPool,
    todState,
    setTodState,
    todChoice,
    setTodChoice,
    todText,
    setTodText,
    todSelectedId,
    setTodSelectedId,
    spinResult,
    setSpinResult,
    spinCheckedIds,
    setSpinCheckedIds,
    spinPool,
    setSpinPool,

    // Pomodoro states
    pomodoroIsRunning,
    setPomodoroIsRunning,
    pomodoroMinutes,
    setPomodoroMinutes,
    pomodoroSeconds,
    setPomodoroSeconds,
    pomodoroPhase,
    setPomodoroPhase,
    
    // Active Bots state
    activeBots
  };
}
