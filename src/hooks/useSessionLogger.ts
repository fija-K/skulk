import { useEffect, useRef } from 'react';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { User } from 'firebase/auth';
import type { Room } from '../App';

export function useSessionLogger(
  currentRoom: Room | null,
  user: User | null,
  currentSessionIdRef: React.MutableRefObject<string | null>,
  localJoinTimeRef: React.MutableRefObject<number | null>
) {
  const activeSessionRef = useRef<{ roomId: string; sessionId: string } | null>(null);
  const isSessionFinalizedRef = useRef<boolean>(false);

  // Helper: Update Streak & Activity Date
  const updateStreakAndActivity = async (uid: string) => {
    try {
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);
      const todayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD

      if (!userSnap.exists()) {
        // Automatically initialize user document with streak if it doesn't exist yet
        await setDoc(userRef, {
          lastActiveDate: todayStr,
          currentStreak: 1
        }, { merge: true });
        console.log(`[STREAK] Initialized user document and streak for ${uid}`);
        return;
      }

      const userData = userSnap.data();
      const currentStreak = userData.currentStreak || 0;
      const lastActiveDate = userData.lastActiveDate || "";

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toLocaleDateString('en-CA');

      let nextStreak = currentStreak;
      if (!lastActiveDate) {
        nextStreak = 1;
      } else if (lastActiveDate === yesterdayStr) {
        nextStreak = currentStreak + 1;
      } else if (lastActiveDate === todayStr) {
        // Already active today, no change
      } else {
        // Gap of 2+ days, reset to 1
        nextStreak = 1;
      }

      await setDoc(userRef, {
        lastActiveDate: todayStr,
        currentStreak: nextStreak
      }, { merge: true });
      console.log(`[STREAK] Streak updated for user ${uid}: currentStreak=${nextStreak}`);
    } catch (e) {
      console.warn("[STREAK] Failed to update streak:", e);
    }
  };

  // Helper: Initialize Session Log
  const initializeSessionLog = async (uid: string, roomId: string, roomName: string, sessionId: string, role: string) => {
    try {
      isSessionFinalizedRef.current = false;
      const logRef = doc(db, 'users', uid, 'sessionLogs', sessionId);
      await setDoc(logRef, {
        sessionId,
        roomId,
        roomName,
        joinedAt: new Date().toISOString(),
        leftAt: null,
        durationMinutes: 0,
        role
      });
      console.log(`[SESSION] Initialized session log for room: ${roomName} (${sessionId})`);
    } catch (e) {
      console.warn("[SESSION] Failed to initialize session log:", e);
    }
  };

  // Helper: Finalize Session Log
  const finalizeSessionLog = async (uid: string, sessionId: string, joinedAtTime: number) => {
    if (isSessionFinalizedRef.current) return;
    isSessionFinalizedRef.current = true;

    try {
      const durationMs = Date.now() - joinedAtTime;
      const durationMinutes = Math.max(1, Math.round(durationMs / 60000));
      const logRef = doc(db, 'users', uid, 'sessionLogs', sessionId);
      // Use setDoc with merge: true to avoid document-not-found errors if initialized and finalized in quick succession
      await setDoc(logRef, {
        leftAt: new Date().toISOString(),
        durationMinutes
      }, { merge: true });
      console.log(`[SESSION] Finalized session log for ${sessionId}: ${durationMinutes} minutes`);
    } catch (e) {
      console.warn("[SESSION] Failed to finalize session log:", e);
    }
  };

  // Effect: Handle Session Creation, Heartbeat, and Clean Leave Finalization
  useEffect(() => {
    // 1. Transition to no room or auth loss
    if (!currentRoom || !user) {
      if (activeSessionRef.current && user) {
        const { sessionId } = activeSessionRef.current;
        const joinedAtTime = localJoinTimeRef.current;
        if (sessionId && joinedAtTime) {
          finalizeSessionLog(user.uid, sessionId, joinedAtTime);
        }
        activeSessionRef.current = null;
      }
      return;
    }

    const roomId = currentRoom.id;
    const roomName = currentRoom.name || 'Study Room';
    const sessionId = currentSessionIdRef.current;
    if (!sessionId) return;

    activeSessionRef.current = { roomId, sessionId };

    // 2. Initialize log and update streak/activity immediately on join
    updateStreakAndActivity(user.uid);
    // Determine initial role
    const adminEmails = ['fijakhan7127@gmail.com', '000fijakhan123@gmail.com'];
    const myRole = user.email && adminEmails.includes(user.email.toLowerCase())
      ? 'admin'
      : (user.uid === currentRoom.creatorId ? 'host' : 'member');
    initializeSessionLog(user.uid, roomId, roomName, sessionId, myRole);

    // 3. Periodic heartbeat every 30 seconds to handle unclean leaves/crashes
    const interval = setInterval(async () => {
      // Guard against concurrent finalize calls
      if (isSessionFinalizedRef.current) return;

      const joinedAtTime = localJoinTimeRef.current;
      if (!joinedAtTime) return;
      try {
        const durationMs = Date.now() - joinedAtTime;
        const durationMinutes = Math.max(1, Math.round(durationMs / 60000));
        const logRef = doc(db, 'users', user.uid, 'sessionLogs', sessionId);
        await setDoc(logRef, {
          leftAt: new Date().toISOString(),
          durationMinutes
        }, { merge: true });
      } catch (e) {
        console.warn("[SESSION] Heartbeat write failed:", e);
      }
    }, 30000);

    return () => {
      clearInterval(interval);
    };
  }, [currentRoom?.id, user?.uid]);

  return {
    finalizeSession: () => {
      if (activeSessionRef.current && user) {
        const { sessionId } = activeSessionRef.current;
        const joinedAtTime = localJoinTimeRef.current;
        if (sessionId && joinedAtTime) {
          finalizeSessionLog(user.uid, sessionId, joinedAtTime);
        }
        activeSessionRef.current = null;
      }
    }
  };
}
