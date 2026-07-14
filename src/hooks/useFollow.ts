import { useState, useEffect } from 'react';
import { doc, onSnapshot, writeBatch, increment, getDocs, query, collection, where } from 'firebase/firestore';
import { db } from '../firebase';

export function useFollow(currentUserId: string, targetUserId: string) {
  const [isFollowing, setIsFollowing] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // Sync relationship status and counters in real time
  useEffect(() => {
    if (!currentUserId || !targetUserId) {
      setIsLoading(false);
      return;
    }

    const followDocRef = doc(db, 'follows', `${currentUserId}_${targetUserId}`);
    const unsubFollow = onSnapshot(followDocRef, (docSnap) => {
      setIsFollowing(docSnap.exists());
    }, (err) => {
      console.warn("Failed to listen to follows doc:", err);
    });

    const targetUserRef = doc(db, 'users', targetUserId);
    const unsubUser = onSnapshot(targetUserRef, async (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        let fers = data.followersCount;
        let fing = data.followingCount;

        if (fers === undefined || fing === undefined) {
          try {
            if (fers === undefined) {
              const qFers = query(collection(db, 'follows'), where('followingId', '==', targetUserId));
              const snap = await getDocs(qFers);
              fers = snap.size;
            }
            if (fing === undefined) {
              const qFing = query(collection(db, 'follows'), where('followerId', '==', targetUserId));
              const snap = await getDocs(qFing);
              fing = snap.size;
            }
          } catch (e) {
            console.warn("Failed to query fallback follows count:", e);
          }
        }

        setFollowersCount(fers || 0);
        setFollowingCount(fing || 0);
      } else {
        setFollowersCount(0);
        setFollowingCount(0);
      }
      setIsLoading(false);
    }, (err) => {
      console.warn("Failed to listen to users doc:", err);
      setIsLoading(false);
    });

    return () => {
      unsubFollow();
      unsubUser();
    };
  }, [currentUserId, targetUserId]);

  const toggleFollow = async () => {
    if (!currentUserId || !targetUserId) return;

    const prevIsFollowing = isFollowing;
    const prevFollowersCount = followersCount;

    // Optimistic UI updates
    setIsFollowing(!prevIsFollowing);
    setFollowersCount(prevIsFollowing ? Math.max(0, prevFollowersCount - 1) : prevFollowersCount + 1);

    try {
      const followDocRef = doc(db, 'follows', `${currentUserId}_${targetUserId}`);
      const currentUserRef = doc(db, 'users', currentUserId);
      const targetUserRef = doc(db, 'users', targetUserId);

      const batch = writeBatch(db);

      if (!prevIsFollowing) {
        // Follow action: Create follow document
        batch.set(followDocRef, {
          followerId: currentUserId,
          followingId: targetUserId,
          createdAt: new Date().toISOString()
        });
        
        // Increment followingCount for current user, followersCount for target user
        batch.set(currentUserRef, { followingCount: increment(1) }, { merge: true });
        batch.set(targetUserRef, { followersCount: increment(1) }, { merge: true });
      } else {
        // Unfollow action: Delete follow document
        batch.delete(followDocRef);
        
        // Decrement followingCount for current user, followersCount for target user
        batch.set(currentUserRef, { followingCount: increment(-1) }, { merge: true });
        batch.set(targetUserRef, { followersCount: increment(-1) }, { merge: true });
      }

      await batch.commit();
    } catch (e) {
      console.error("Failed to toggle follow status:", e);
      // Revert optimistic UI updates on error
      setIsFollowing(prevIsFollowing);
      setFollowersCount(prevFollowersCount);
    }
  };

  return { isFollowing, followersCount, followingCount, isLoading, toggleFollow };
}
