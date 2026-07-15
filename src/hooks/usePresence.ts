import { useState, useEffect } from 'react';
import type { MutableRefObject } from 'react';
import type { User } from 'firebase/auth';
import { 
  collection, 
  doc, 
  setDoc, 
  updateDoc, 
  runTransaction, 
  getDocs,
  onSnapshot
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Participant, Room } from '../App';

export function usePresence(
  roomId: string | null,
  user: User | null,
  guestId: string,
  guestName: string,
  guestPhotoURL: string | null,
  guestInitials: string,
  guestColor: string,
  currentSessionIdRef: MutableRefObject<string | null>,
  localJoinTimeRef: MutableRefObject<number | null>,
  hasSeenSelfInListRef: MutableRefObject<boolean>,
  creatorId: string | null,
  onParticipantAdded: (docId: string, name: string, joinedAt: string | null) => void,
  onParticipantRemoved: (docId: string, name: string) => void,
  onEvicted: (reason: 'new_room' | 'kicked') => void
) {
  const [callParticipants, setCallParticipants] = useState<Participant[]>([]);
  const [activeMenuParticipantId, setActiveMenuParticipantId] = useState<string | null>(null);
  const [spotlightParticipantId, setSpotlightParticipantId] = useState<string | null>(null);

  const getMyId = () => user ? user.uid : (guestId || localStorage.getItem('skulk_guest_id') || '');

  const updateMySharing = async (fields: Record<string, unknown>) => {
    const myId = getMyId();
    if (!myId || !roomId) return;
    try {
      console.log("[FIRESTORE-WRITE] updateMySharing", {
        fields,
        roomId,
        myId,
        stack: new Error().stack
      });
      await updateDoc(doc(db, 'rooms', roomId, 'participants', myId), fields);
    } catch (e) {
      console.warn('Failed to update sharing state:', e);
    }
  };

  const clearMySharing = async () => {
    await updateMySharing({ 
      sharing: null, 
      sharingYoutubeId: null, 
      whiteboardData: '', 
      whiteboardEditAllowed: false 
    });
  };

  const leavePresence = async (roomIdToLeave: string, sessionIdToDelete?: string | null) => {
    const myId = getMyId();
    console.log("leavePresence called:", { roomIdToLeave, sessionIdToDelete, myId });
    if (!myId || !roomIdToLeave) return;

    try {
      await runTransaction(db, async (transaction) => {
        const presenceDocRef = doc(db, 'rooms', roomIdToLeave, 'participants', myId);
        const snap = await transaction.get(presenceDocRef);
        if (snap.exists()) {
          const data = snap.data();
          if (!sessionIdToDelete || data.sessionId === sessionIdToDelete) {
            console.log("leavePresence transaction deleting presence:", myId);
            transaction.delete(presenceDocRef);
          } else {
            console.log('leavePresence bypassed: presence belongs to a newer session.');
          }
        } else {
          console.log("leavePresence transaction: presence doc does not exist.");
        }
      });

      const snapshot = await getDocs(collection(db, 'rooms', roomIdToLeave, 'participants'));
      if (snapshot.empty) {
        await updateDoc(doc(db, 'rooms', roomIdToLeave), { emptySince: Date.now() });
        console.log(`[CLEANUP] Room ${roomIdToLeave} marked as empty.`);
      }
    } catch (e) {
      console.error('Error removing presence document:', e);
    }
  };

  const enterCallRoomPresence = async (room: Room, myId: string, role: string, newSessionId: string) => {
    if (!myId) return;
    currentSessionIdRef.current = newSessionId;
    localJoinTimeRef.current = Date.now();
    hasSeenSelfInListRef.current = false;

    try {
      await updateDoc(doc(db, 'rooms', room.id), { emptySince: null }).catch(() => {});
      const presenceRef = doc(db, 'rooms', room.id, 'participants', myId);
      await setDoc(presenceRef, {
        uid: myId,
        name: user ? user.displayName || 'Google User' : guestName,
        photoURL: user ? user.photoURL : guestPhotoURL,
        initials: guestInitials,
        color: guestColor,
        joinedAt: new Date().toISOString(),
        sharing: null,
        role: role,
        isMuted: true,
        isCamOff: true,
        mutedBy: myId,
        camOffBy: myId,
        sessionId: newSessionId,
        micOn: false,
        camOn: false,
        micRestricted: false,
        camRestricted: false
      });
      localStorage.setItem('skulk_active_session', JSON.stringify({
        roomId: room.id,
        sessionId: newSessionId,
        timestamp: Date.now()
      }));
    } catch (err) {
      console.error('enterCallRoom setDoc error:', err);
    }
  };

  // Sync participant presence collection
  useEffect(() => {
    if (!roomId) {
      setCallParticipants([]);
      return;
    }

    hasSeenSelfInListRef.current = false;
    const listenerMyId = getMyId();
    const presenceRef = collection(db, 'rooms', roomId, 'participants');
    
    const unsubscribe = onSnapshot(presenceRef, (snapshot) => {
      const myId = listenerMyId;
      if (myId !== getMyId()) {
        return;
      }

      snapshot.docChanges().forEach((change) => {
        const docId = change.doc.id;
        const data = change.doc.data();
        if (change.type === 'added') {
          onParticipantAdded(docId, data.name || 'Someone', data.joinedAt || null);
        }
        if (change.type === 'removed') {
          onParticipantRemoved(docId, data.name || 'Someone');
          if (docId === myId) {
            console.log("[PRESENCE] Local participant document removed by server. Triggering eviction.");
            let reason: 'new_room' | 'kicked' = 'kicked';
            try {
              const activeSessionStr = localStorage.getItem('skulk_active_session');
              if (activeSessionStr) {
                const activeSession = JSON.parse(activeSessionStr);
                if (activeSession.roomId && activeSession.roomId !== roomId) {
                  reason = 'new_room';
                }
              }
            } catch (e) {}
            onEvicted(reason);
            return;
          }
        }
      });

      const list: Participant[] = [];
      snapshot.docs.forEach((docSnap) => {
        const data = docSnap.data();
        const docId = docSnap.id;
        list.push({
          id: docId,
          name: data.name || 'Anonymous',
          photoURL: data.photoURL || null,
          initials: data.initials || '??',
          color: data.color || '#3b82f6',
          role: data.role || 'member',
          isMuted: data.isMuted ?? true,
          isCamOff: data.isCamOff ?? true,
          mutedBy: data.mutedBy || null,
          camOffBy: data.camOffBy || null,
          isSpeaking: data.isSpeaking ?? false,
          sharing: data.sharing || null,
          sharingYoutubeId: data.sharingYoutubeId || null,
          whiteboardData: data.whiteboardData || '',
          whiteboardEditAllowed: data.whiteboardEditAllowed ?? false,
          joinedAt: data.joinedAt || null,
          sessionId: data.sessionId || null,
          micRestricted: data.micRestricted ?? false,
          camRestricted: data.camRestricted ?? false,
          isPinned: data.isPinned ?? false,
          todJoined: data.todJoined ?? false,
          todPending: data.todPending ?? false,
          todRequestedSpin: data.todRequestedSpin || null,
          todRequestedChoice: data.todRequestedChoice || null,
          todRequestedReset: data.todRequestedReset || null
        });
      });

      const meStillInRoom = list.some(p => p.id === myId);
      if (myId && meStillInRoom) {
        hasSeenSelfInListRef.current = true;
      }
      
      setCallParticipants(list);
    }, (error) => {
      console.warn("Firestore call presence subscription failed, falling back to local user presence:", error);
      const myId = getMyId();
      
      const adminEmails = ['fijakhan7127@gmail.com', '000fijakhan123@gmail.com'];
      const determineRole = (cId: string | null) => {
        if (user && user.email && adminEmails.includes(user.email.toLowerCase())) {
          return 'admin';
        }
        return myId === cId ? 'host' : 'member';
      };

      setCallParticipants([
        {
          id: myId,
          name: `${user ? user.displayName || 'Google User' : guestName} (You)`,
          initials: guestInitials,
          color: guestColor,
          photoURL: user ? user.photoURL : null,
          isMuted: true,
          isCamOff: true,
          isSpeaking: false,
          role: determineRole(creatorId),
          sharing: null,
          sharingYoutubeId: null,
          whiteboardEditAllowed: false,
          joinedAt: null,
          sessionId: currentSessionIdRef.current,
          micRestricted: false,
          camRestricted: false,
          isPinned: false,
          todJoined: false,
          todPending: false,
          todRequestedSpin: null,
          todRequestedChoice: null,
          todRequestedReset: null
        }
      ]);
    });

    return () => {
      unsubscribe();
    };
  }, [roomId, user, guestId, creatorId]);

  return {
    callParticipants,
    setCallParticipants,
    activeMenuParticipantId,
    setActiveMenuParticipantId,
    spotlightParticipantId,
    setSpotlightParticipantId,
    updateMySharing,
    clearMySharing,
    leavePresence,
    enterCallRoomPresence
  };
}
