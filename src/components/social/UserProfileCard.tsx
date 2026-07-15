import React, { useState, useEffect } from 'react';
import { collection, doc, getDoc, onSnapshot, addDoc, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { useFollow } from '../../hooks/useFollow';

interface UserProfile {
  id: string;
  name: string;
  initials: string;
  color: string;
  photoURL?: string | null;
}

interface UserProfileCardProps {
  currentUserId: string;
  targetUser: UserProfile;
  callParticipants: any[];
  onClose: () => void;
  onSelectUser: (user: UserProfile) => void;
  showToast: (msg: string) => void;
  initialView?: 'card' | 'followers' | 'following' | 'connections' | 'report';
}

export function UserProfileCard({
  currentUserId,
  targetUser,
  callParticipants,
  onClose,
  onSelectUser,
  showToast,
  initialView = 'card'
}: UserProfileCardProps) {
  const [view, setView] = useState<'card' | 'followers' | 'following' | 'connections' | 'report'>(initialView);
  const [listUserIds, setListUserIds] = useState<string[]>([]);
  const [isListLoading, setIsListLoading] = useState(false);
  
  // Report form states
  const [reportReason, setReportReason] = useState('Spam');
  const [reportDetails, setReportDetails] = useState('');
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);

  const [bio, setBio] = useState('');

  // Sync bio in real time
  useEffect(() => {
    if (!targetUser.id || targetUser.id.startsWith('bot_')) return;
    const userRef = doc(db, 'users', targetUser.id);
    const unsubscribe = onSnapshot(userRef, (docSnap) => {
      if (docSnap.exists()) {
        setBio(docSnap.data().bio || '');
      } else {
        setBio('');
      }
    }, (err) => {
      console.warn("Failed to listen to profile bio:", err);
    });
    return () => unsubscribe();
  }, [targetUser.id]);

  // Hook for follows relationships
  const { isFollowing, followersCount, followingCount, toggleFollow } = useFollow(
    currentUserId,
    targetUser.id
  );

  // Sync list of followers, following, or connections
  useEffect(() => {
    if (targetUser.id.startsWith('bot_')) return;
    if (view !== 'followers' && view !== 'following' && view !== 'connections') return;
    setIsListLoading(true);

    const followsRef = collection(db, 'follows');

    if (view === 'connections') {
      const qFollowers = query(followsRef, where('followingId', '==', targetUser.id));
      const qFollowing = query(followsRef, where('followerId', '==', targetUser.id));

      let followersIds: string[] = [];
      let followingIds: string[] = [];

      const unsubFollowers = onSnapshot(qFollowers, (snap) => {
        followersIds = snap.docs.map(doc => doc.data().followerId);
        updateMutual();
      }, (err) => {
        console.error("Failed to sync connections followers:", err);
      });

      const unsubFollowing = onSnapshot(qFollowing, (snap) => {
        followingIds = snap.docs.map(doc => doc.data().followingId);
        updateMutual();
      }, (err) => {
        console.error("Failed to sync connections following:", err);
      });

      function updateMutual() {
        const intersection = followersIds.filter(id => followingIds.includes(id));
        setListUserIds(intersection);
        setIsListLoading(false);
      }

      return () => {
        unsubFollowers();
        unsubFollowing();
      };
    } else {
      const q = query(
        followsRef,
        where(view === 'followers' ? 'followingId' : 'followerId', '==', targetUser.id)
      );

      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const ids = snapshot.docs.map((docSnap) => {
            const data = docSnap.data();
            return view === 'followers' ? data.followerId : data.followingId;
          });
          setListUserIds(ids);
          setIsListLoading(false);
        },
        (err) => {
          console.error('Failed to sync follows list:', err);
          setIsListLoading(false);
        }
      );

      return () => unsubscribe();
    }
  }, [view, targetUser.id]);

  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUserId || !targetUser.id) return;
    setIsSubmittingReport(true);

    try {
      await addDoc(collection(db, 'reports'), {
        reporterId: currentUserId,
        reportedUserId: targetUser.id,
        reason: reportReason,
        details: reportReason === 'Other' ? reportDetails : (reportDetails || ''),
        timestamp: new Date().toISOString()
      });
      showToast(`🛡️ Report submitted. Thank you.`);
      setView('card');
      setReportReason('Spam');
      setReportDetails('');
    } catch (err) {
      console.error('Failed to submit report:', err);
      showToast('❌ Failed to submit report. Please try again.');
    } finally {
      setIsSubmittingReport(false);
    }
  };

  return (
    <div 
      className="modal-overlay" 
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(9, 10, 13, 0.85)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999
      }}
    >
      <div 
        className="modal-container animate-fade-in" 
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '380px',
          backgroundColor: 'var(--card-bg, #1a1c23)',
          border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
          borderRadius: 'var(--border-radius, 12px)',
          padding: '24px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          position: 'relative'
        }}
      >
        {/* Close Button */}
        <button 
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary, #94a3b8)',
            fontSize: '18px',
            cursor: 'pointer',
            padding: '4px'
          }}
        >
          ✕
        </button>

        {/* 1. Main Profile Card View */}
        {view === 'card' && !targetUser.id.startsWith('bot_') && (
          <div style={{ textAlign: 'center' }}>
            {/* Avatar Circle */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
              <div 
                style={{
                  width: '96px',
                  height: '96px',
                  borderRadius: '50%',
                  backgroundColor: targetUser.color || '#3b82f6',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '36px',
                  fontWeight: 'bold',
                  color: '#ffffff',
                  border: '2px solid var(--border-color)',
                  overflow: 'hidden'
                }}
              >
                {targetUser.photoURL ? (
                  <img 
                    src={targetUser.photoURL} 
                    alt={targetUser.name} 
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  targetUser.initials
                )}
              </div>
            </div>

            {/* Name */}
            <h3 style={{ fontSize: '20px', fontWeight: 'bold', margin: '0 0 4px 0', color: 'var(--text-primary, #ffffff)' }}>
              {targetUser.name}
            </h3>

            {/* Bio */}
            <p style={{
              fontSize: '13px',
              color: 'var(--text-secondary, #94a3b8)',
              margin: '0 0 16px 0',
              padding: '0 16px',
              fontStyle: bio ? 'normal' : 'italic',
              wordBreak: 'break-word',
              lineHeight: '1.4'
            }}>
              {bio ? bio : (currentUserId === targetUser.id ? "No bio yet. Edit your bio in the Reflect tab." : "No bio yet.")}
            </p>

            {/* Followers / Following Counts Row */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: '32px', marginBottom: '24px' }}>
              <div 
                onClick={() => setView('followers')}
                style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
                className="hover-opacity"
              >
                <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--primary-color, #3b82f6)' }}>
                  {followersCount}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary, #94a3b8)' }}>Followers</div>
              </div>
              <div 
                onClick={() => setView('following')}
                style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
                className="hover-opacity"
              >
                <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--primary-color, #3b82f6)' }}>
                  {followingCount}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary, #94a3b8)' }}>Following</div>
              </div>
            </div>

            {/* Action Row */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {currentUserId !== targetUser.id && (
                <button 
                  onClick={toggleFollow}
                  className={isFollowing ? "btn-signin" : "btn-create"}
                  style={{
                    width: '100%',
                    padding: '12px',
                    fontSize: '15px',
                    fontWeight: 'bold',
                    justifyContent: 'center',
                    backgroundColor: isFollowing ? 'var(--input-bg, #272a37)' : 'var(--primary-color)',
                    color: isFollowing ? 'var(--text-primary)' : 'var(--primary-text)',
                    border: isFollowing ? '1px solid var(--border-color)' : 'none',
                    borderRadius: 'var(--btn-radius, 8px)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {isFollowing ? '✓ Following' : '+ Follow'}
                </button>
              )}

              {currentUserId !== targetUser.id && (
                <button 
                  onClick={() => setView('report')}
                  style={{
                    width: '100%',
                    padding: '10px',
                    fontSize: '13px',
                    color: '#ef4444',
                    background: 'rgba(239, 68, 68, 0.08)',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                    borderRadius: 'var(--btn-radius, 8px)',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    transition: 'all 0.15s ease'
                  }}
                >
                  🛡️ Report User
                </button>
              )}
            </div>
          </div>
        )}

        {view === 'card' && targetUser.id.startsWith('bot_') && (
          <div style={{ textAlign: 'center' }}>
            {/* Avatar Circle */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
              <div 
                style={{
                  width: '96px',
                  height: '96px',
                  borderRadius: '50%',
                  backgroundColor: '#1db954',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '48px',
                  fontWeight: 'bold',
                  color: '#0f1013',
                  border: '2px solid var(--border-color)',
                  overflow: 'hidden'
                }}
              >
                {targetUser.photoURL ? (
                  <img 
                    src={targetUser.photoURL} 
                    alt={targetUser.name} 
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  '🤖'
                )}
              </div>
            </div>

            {/* Name and Badge */}
            <h3 style={{ fontSize: '20px', fontWeight: 'bold', margin: '0 0 4px 0', color: 'var(--text-primary, #ffffff)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              {targetUser.name}
              <span style={{
                fontSize: '9px',
                fontWeight: 'bold',
                padding: '2px 6px',
                borderRadius: '3px',
                border: '1px solid rgba(29, 185, 84, 0.4)',
                backgroundColor: 'rgba(29, 185, 84, 0.1)',
                color: '#1db954',
                textTransform: 'uppercase'
              }}>
                Buddy
              </span>
            </h3>

            {/* Subtitle */}
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>
              Virtual Companion
            </div>

            {/* Bio/Description */}
            <p style={{
              fontSize: '13px',
              color: 'var(--text-primary, #e2e8f0)',
              margin: '0 0 16px 0',
              padding: '0 8px',
              lineHeight: '1.4'
            }}>
              {(() => {
                const botName = targetUser.name;
                const desc = {
                  Kei: 'Calm, strategic, treats study as a game to win through efficiency.',
                  Sol: 'Quiet, blunt, hyper-analytical. Speaks in matter-of-fact observations.',
                  Rei: 'Intense, frames study as a high-stakes challenge.',
                  Mika: 'Bubbly, over-the-top supportive and warm.',
                  Kai: 'Ambitious, confident, pushes you to be the best.',
                  Nyx: 'Quiet, unsettling calm, introspective observations.',
                  Yuna: 'composed, calls out excuses with quiet precision.',
                  Wren: 'Soft-spoken, patient mentor. Progress over perfection.'
                }[botName as 'Kei' | 'Sol' | 'Rei' | 'Mika' | 'Kai' | 'Nyx' | 'Yuna' | 'Wren'] || 'Your virtual study companion.';
                return desc;
              })()}
            </p>

            {/* Tone Quote */}
            <div style={{
              fontSize: '12px',
              color: 'var(--text-secondary)',
              fontStyle: 'italic',
              background: 'rgba(0,0,0,0.15)',
              padding: '10px 12px',
              borderRadius: '6px',
              border: '1px solid rgba(255,255,255,0.02)',
              marginBottom: '20px'
            }}>
              &ldquo;{(() => {
                const botName = targetUser.name;
                const tone = {
                  Kei: 'Procrastinating won\'t change the deadline. What\'s the plan?',
                  Sol: 'You have been idle for 4 minutes. Concerning.',
                  Rei: 'Every minute you waste is a bet against yourself. Don\'t fold.',
                  Mika: 'yayyy you\'re back!! let\'s gooo what are we studying today!!',
                  Kai: 'Good students study. Great students study when they don\'t want to. Which one are you?',
                  Nyx: 'You keep checking your phone. I notice.',
                  Yuna: 'You said you\'d start \'5 minutes ago\' fifteen minutes ago.',
                  Wren: 'No rush. Even 10 minutes of focus counts as progress.'
                }[botName as 'Kei' | 'Sol' | 'Rei' | 'Mika' | 'Kai' | 'Nyx' | 'Yuna' | 'Wren'] || 'Let\'s focus.';
                return tone;
              })()}&rdquo;
            </div>

            {/* Stats list */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: '8px',
              borderTop: '1px solid var(--border-color)',
              paddingTop: '16px',
              marginTop: '16px'
            }}>
              <div>
                <div style={{ fontSize: '16px', fontWeight: '800', color: 'var(--primary-color)' }}>
                  {(() => {
                    const stats = { Kei: '98%', Sol: '95%', Rei: '100%', Mika: '85%', Kai: '99%', Nyx: '92%', Yuna: '97%', Wren: '90%' };
                    return stats[targetUser.name as keyof typeof stats] || '95%';
                  })()}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Focus Drive</div>
              </div>
              <div>
                <div style={{ fontSize: '16px', fontWeight: '800', color: '#1db954' }}>Instant</div>
                <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Response</div>
              </div>
              <div>
                <div style={{ fontSize: '16px', fontWeight: '800', color: '#3b82f6' }}>100%</div>
                <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Accountability</div>
              </div>
            </div>
          </div>
        )}

        {/* 2. Followers / Following / Connections List View */}
        {(view === 'followers' || view === 'following' || view === 'connections') && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '20px', gap: '8px' }}>
              <button 
                onClick={() => setView('card')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--primary-color)',
                  cursor: 'pointer',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  padding: '4px'
                }}
              >
                ←
              </button>
              <h3 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0, textTransform: 'capitalize', color: 'var(--text-primary)' }}>
                {view}
              </h3>
            </div>

            {isListLoading ? (
              <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-secondary)' }}>Loading...</div>
            ) : listUserIds.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)', fontSize: '14px' }}>
                No {view} yet.
              </div>
            ) : (
              <div style={{ maxHeight: '280px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {listUserIds.map((userId) => (
                  <FollowListRow 
                    key={userId}
                    currentUserId={currentUserId}
                    userId={userId}
                    callParticipants={callParticipants}
                    onSelectUser={(profile) => {
                      setView('card');
                      onSelectUser(profile);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* 3. Report Form View */}
        {view === 'report' && (
          <form onSubmit={handleReportSubmit}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '20px', gap: '8px' }}>
              <button 
                type="button"
                onClick={() => setView('card')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--primary-color)',
                  cursor: 'pointer',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  padding: '4px'
                }}
              >
                ←
              </button>
              <h3 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0, color: 'var(--text-primary)' }}>
                Report {targetUser.name}
              </h3>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
              <div className="form-group">
                <label className="form-label" style={{ marginBottom: '8px', display: 'block' }}>Reason for report</label>
                <select 
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  className="search-input"
                  style={{
                    width: '100%',
                    padding: '10px 16px',
                    backgroundColor: 'var(--input-bg, #1a1c23)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--btn-radius, 8px)',
                    color: 'var(--text-primary)',
                    outline: 'none'
                  }}
                >
                  <option value="Spam">Spam</option>
                  <option value="Harassment / abusive behavior">Harassment / abusive behavior</option>
                  <option value="Inappropriate content">Inappropriate content</option>
                  <option value="Impersonation">Impersonation</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              {(reportReason === 'Other' || reportReason !== '') && (
                <div className="form-group">
                  <label className="form-label" style={{ marginBottom: '8px', display: 'block' }}>
                    {reportReason === 'Other' ? 'Please specify details (required)' : 'Additional details (optional)'}
                  </label>
                  <textarea 
                    value={reportDetails}
                    onChange={(e) => setReportDetails(e.target.value)}
                    required={reportReason === 'Other'}
                    placeholder="Provide details to help us investigate..."
                    className="search-input"
                    style={{
                      width: '100%',
                      minHeight: '80px',
                      padding: '12px 16px',
                      backgroundColor: 'var(--input-bg, #1a1c23)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--btn-radius, 8px)',
                      color: 'var(--text-primary)',
                      outline: 'none',
                      resize: 'vertical'
                    }}
                  />
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button 
                type="button" 
                onClick={() => setView('card')}
                className="btn-signin"
                style={{ flex: 1, padding: '10px', justifyContent: 'center' }}
              >
                Cancel
              </button>
              <button 
                type="submit" 
                disabled={isSubmittingReport}
                className="btn-create"
                style={{ flex: 1, padding: '10px', justifyContent: 'center', backgroundColor: '#ef4444', color: '#ffffff' }}
              >
                {isSubmittingReport ? 'Submitting...' : 'Submit Report'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

interface FollowListRowProps {
  currentUserId: string;
  userId: string;
  callParticipants: any[];
  onSelectUser: (profile: UserProfile) => void;
}

function FollowListRow({ currentUserId, userId, callParticipants, onSelectUser }: FollowListRowProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null);

  // Sync profile details
  useEffect(() => {
    const match = callParticipants?.find(p => p.id === userId || p.uid === userId);
    if (match) {
      setProfile({
        id: userId,
        name: match.name.replace(' (You)', ''),
        initials: match.initials,
        color: match.color,
        photoURL: match.photoURL || null
      });
      return;
    }

    const userDocRef = doc(db, 'users', userId);
    getDoc(userDocRef).then((docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const name = data.displayName || 'Anonymous';
        setProfile({
          id: userId,
          name,
          initials: name.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase() || '??',
          color: data.color || '#3b82f6',
          photoURL: data.photoURL || null
        });
      } else {
        setProfile({
          id: userId,
          name: 'Guest User',
          initials: 'GU',
          color: '#4b5563',
          photoURL: null
        });
      }
    }).catch(() => {
      setProfile({
        id: userId,
        name: 'Guest User',
        initials: 'GU',
        color: '#4b5563',
        photoURL: null
      });
    });
  }, [userId, callParticipants]);

  const { isFollowing, toggleFollow } = useFollow(currentUserId, userId);

  if (!profile) return null;

  return (
    <div 
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        borderRadius: '8px',
        backgroundColor: 'rgba(255, 255, 255, 0.02)',
        border: '1px solid rgba(255, 255, 255, 0.04)'
      }}
    >
      <div 
        onClick={() => onSelectUser(profile)}
        style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', flexGrow: 1 }}
      >
        <div 
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            backgroundColor: profile.color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '14px',
            fontWeight: 'bold',
            color: '#fff',
            overflow: 'hidden'
          }}
        >
          {profile.photoURL ? (
            <img 
              src={profile.photoURL} 
              alt={profile.name} 
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
              referrerPolicy="no-referrer"
            />
          ) : (
            profile.initials
          )}
        </div>
        <span style={{ fontSize: '14px', fontWeight: '500', color: 'var(--text-primary)' }}>
          {profile.name}
        </span>
      </div>

      {currentUserId !== userId && (
        <button 
          onClick={(e) => {
            e.stopPropagation();
            toggleFollow();
          }}
          className={isFollowing ? "btn-signin" : "btn-create"}
          style={{
            padding: '6px 12px',
            fontSize: '11px',
            fontWeight: 'bold',
            justifyContent: 'center',
            backgroundColor: isFollowing ? 'var(--input-bg, #272a37)' : 'var(--primary-color)',
            color: isFollowing ? 'var(--text-primary)' : 'var(--primary-text)',
            border: isFollowing ? '1px solid var(--border-color)' : 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            whiteSpace: 'nowrap'
          }}
        >
          {isFollowing ? '✓ Following' : '+ Follow'}
        </button>
      )}
    </div>
  );
}
