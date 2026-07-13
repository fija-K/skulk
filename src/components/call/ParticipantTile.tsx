import type { Participant } from '../../App';
import { ParticipantVideo } from './ParticipantVideo';

interface ParticipantTileProps {
  p: Participant;
  isThumbnail?: boolean;
  myId: string;
  isMicMuted: boolean;
  isCamOff: boolean;
  cameraError: boolean;
  spotlightParticipantId: string | null;
  setSpotlightParticipantId: (id: string | null) => void;
  handleViewParticipantShare: (p: Participant) => void;
  isGalleryView: boolean;
  activeMenuParticipantId: string | null;
  setActiveMenuParticipantId: (id: string | null) => void;
  callParticipants: Participant[];
  checkCanMute: (myRole: string, targetRole: string) => boolean;
  handleParticipantMuteToggle: (id: string, name: string) => void;
  handleParticipantCameraToggle: (id: string, name: string) => void;
  handleParticipantRoleChange: (id: string, role: 'host' | 'cohost' | 'member') => void | Promise<void>;
  checkCanKick: (myRole: string, targetRole: string) => boolean;
  handleParticipantRemove: (id: string, name: string) => void;
}

export function ParticipantTile({
  p,
  isThumbnail = false,
  myId,
  isMicMuted,
  isCamOff,
  cameraError,
  spotlightParticipantId,
  setSpotlightParticipantId,
  handleViewParticipantShare,
  isGalleryView,
  activeMenuParticipantId,
  setActiveMenuParticipantId,
  callParticipants,
  checkCanMute,
  handleParticipantMuteToggle,
  handleParticipantCameraToggle,
  handleParticipantRoleChange,
  checkCanKick,
  handleParticipantRemove
}: ParticipantTileProps) {
  const isUser = p.id === myId;
  const showMuted = isUser ? isMicMuted : p.isMuted;
  const showCamOff = isUser ? isCamOff : p.isCamOff;
  const isSpeaking = p.isSpeaking && !showMuted;

  // If it's a thumbnail strip tile:
  if (isThumbnail) {
    const isSpotlightActive = p.id === spotlightParticipantId;
    return (
      <div 
        className={`spotlight-thumbnail-tile ${isUser ? 'user-tile' : ''} ${isSpeaking ? 'speaker-active' : ''} ${isSpotlightActive ? 'active' : ''} ${showCamOff ? 'camera-off' : ''}`}
        onClick={() => setSpotlightParticipantId(p.id)}
        style={{ 
          cursor: 'pointer',
          position: 'relative',
          width: '120px',
          height: '75px',
          minWidth: '120px',
          borderRadius: '6px',
          overflow: 'hidden',
          backgroundColor: p.color,
          boxSizing: 'border-box',
          border: isSpotlightActive ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
          boxShadow: isSpotlightActive ? '0 0 10px var(--primary-color)' : 'none',
          flexShrink: 0
        }}
      >
        {p.sharing === 'youtube' ? (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'radial-gradient(circle, rgba(241, 196, 15, 0.15) 0%, rgba(15, 16, 19, 0.95) 100%)',
            animation: 'pulse 2s infinite',
            zIndex: 2
          }}>
            <span style={{ fontSize: '16px', color: 'var(--primary-color)' }}>▶</span>
          </div>
        ) : (
          <>
            <div className="tile-video-wrapper">
              {!(isUser && cameraError) && (
                <ParticipantVideo participantId={p.id} objectFit="cover" />
              )}
            </div>
            <div className="tile-avatar-wrapper">
              {p.photoURL ? (
                <img 
                  src={p.photoURL} 
                  alt={p.name} 
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: '16px', fontWeight: 'bold', color: '#fff' }}>
                  {p.initials}
                </div>
              )}
            </div>
          </>
        )}

        {/* Micro status indicator (Muted status) */}
        <div style={{
          position: 'absolute',
          top: '4px',
          right: '4px',
          zIndex: 10,
          backgroundColor: 'rgba(0,0,0,0.6)',
          borderRadius: '50%',
          width: '16px',
          height: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          {showMuted ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="1" y1="1" x2="23" y2="23"></line>
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
              <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
            </svg>
          )}
        </div>
        
        {/* Small overlay name tag */}
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'rgba(0, 0, 0, 0.65)',
          padding: '3px 6px',
          fontSize: '9px',
          fontWeight: 600,
          color: '#fff',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          zIndex: 5
        }}>
          {p.name.replace(' (You)', '')}
        </div>
      </div>
    );
  }
  
  // Check if we should do a media sharing visual state takeover
  const showMediaTakeover = p.sharing === 'youtube';
  
  return (
    <div 
      className={`participant-tile ${isUser ? 'user-tile' : ''} ${isSpeaking ? 'speaker-active' : ''} ${showCamOff ? 'camera-off' : ''}`}
      onClick={() => {
        if (p.sharing) {
          handleViewParticipantShare(p);
        } else if (!spotlightParticipantId) {
          setSpotlightParticipantId(p.id);
        }
      }}
      style={{ 
        cursor: (p.sharing || !spotlightParticipantId) ? 'pointer' : 'default',
        // Show container border glow if they are sharing media
        ...p.sharing === 'youtube' ? {
          boxShadow: '0 0 16px rgba(241, 196, 15, 0.3)',
          border: '2.5px solid var(--primary-color)'
        } : {},
        // Keep tiles equal size, prevent overflow/overlap, and auto-shrink to fit in gallery view
        ...(!isThumbnail && isGalleryView) ? {
          width: '100%',
          height: '100%',
          maxWidth: '100%',
          maxHeight: '100%',
          aspectRatio: '16/10'
        } : {}
      }}
    >
      {isGalleryView && !isThumbnail ? (
        // Gallery Layout or camera is ON: Full Card Video/Avatar
        showMediaTakeover ? (
          /* Takeover card for gallery layout - beautifully contained */
          <div 
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '12px',
              background: 'radial-gradient(circle, rgba(241, 196, 15, 0.15) 0%, rgba(15, 16, 19, 0.95) 100%)',
              boxSizing: 'border-box'
            }}
          >
            <div style={{
              width: '42px',
              height: '42px',
              borderRadius: '50%',
              backgroundColor: 'rgba(241, 196, 15, 0.15)',
              border: '2px dashed var(--primary-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              animation: 'pulse 2s infinite'
            }}>
              <span style={{ fontSize: '18px', color: 'var(--primary-color)', marginLeft: '3px' }}>▶</span>
            </div>
            <span style={{ fontSize: '9px', fontWeight: 800, color: 'var(--primary-color)', letterSpacing: '0.1em', textTransform: 'uppercase', textAlign: 'center' }}>
              Watching Together
            </span>
            <span style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>Click to join</span>
          </div>
        ) : (
          <>
            {/* Keep video element in DOM */}
            <div className="tile-video-wrapper">
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
                <ParticipantVideo participantId={p.id} objectFit={spotlightParticipantId === p.id ? 'contain' : 'cover'} />
              )}
            </div>
            
            {/* Keep large avatar circle in DOM */}
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
            </div>

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
        )
      ) : (
        // Compact Grid Layout OR Floating Avatar
        <div 
          className="participant-avatar-large" 
          style={{ 
            backgroundColor: p.color, 
            cursor: p.sharing ? 'pointer' : 'default',
            position: 'relative',
            boxShadow: p.sharing ? '0 0 12px var(--primary-color)' : 'none',
            border: p.sharing ? '2px solid var(--primary-color)' : 'none',
            overflow: 'hidden',
            background: p.sharing === 'youtube' ? 'radial-gradient(circle, rgba(241, 196, 15, 0.15) 0%, rgba(15, 16, 19, 0.95) 100%)' : undefined,
            // Shrink for thumbnail strip
            ...isThumbnail ? { width: '48px', height: '48px', minWidth: '48px' } : {}
          }}
        >
          {p.sharing === 'youtube' ? (
            /* Pulsing play icon inside circular avatar circle */
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              animation: 'pulse 2s infinite',
              zIndex: 2
            }}>
              <span style={{ fontSize: isThumbnail ? '14px' : '20px', color: 'var(--primary-color)' }}>▶</span>
            </div>
          ) : (
            <>
              <div className="tile-video-wrapper">
                {!(isUser && cameraError) && (
                  <ParticipantVideo participantId={p.id} />
                )}
              </div>
              <div className="tile-avatar-wrapper">
                {p.photoURL ? (
                  <img 
                    src={p.photoURL} 
                    alt={p.name} 
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="tile-avatar-initials">{p.initials}</span>
                )}
              </div>
            </>
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
      
      {/* Name Tag + Muted Status Overlay */}
      {!isThumbnail && (
        <div className="participant-info-overlay">
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
          </div>
          <div className={`tile-mic-badge ${showMuted ? 'muted' : 'active'}`}>
            <svg className="tile-icon-muted" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="1" y1="1" x2="23" y2="23"></line>
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
              <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
              <line x1="12" y1="19" x2="12" y2="23"></line>
              <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
            <svg className="tile-icon-active" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
              <line x1="12" y1="19" x2="12" y2="22"></line>
            </svg>
          </div>
        </div>
      )}

      {/* Host Actions Hover Trigger Menu */}
      {!isThumbnail && !isUser && (callParticipants.find(part => part.id === myId)?.role === 'admin' || 
                                   callParticipants.find(part => part.id === myId)?.role === 'host' || 
                                   callParticipants.find(part => part.id === myId)?.role === 'cohost') && (
        <div>
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
              {checkCanMute(callParticipants.find(part => part.id === myId)?.role || 'member', p.role || 'member') && (
                <button 
                  onClick={() => handleParticipantMuteToggle(p.id, p.name)} 
                  className="tile-menu-item"
                >
                  {p.isMuted ? 'Unmute' : 'Mute'}
                </button>
              )}
              
              {/* Camera off action */}
              {checkCanMute(callParticipants.find(part => part.id === myId)?.role || 'member', p.role || 'member') && (
                <button 
                  onClick={() => handleParticipantCameraToggle(p.id, p.name)} 
                  className="tile-menu-item"
                >
                  {p.isCamOff ? 'Turn camera on' : 'Turn camera off'}
                </button>
              )}
              
              {/* Role Promotion/Demotion Actions */}
              {callParticipants.find(part => part.id === myId)?.role === 'admin' && (
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

              {callParticipants.find(part => part.id === myId)?.role === 'host' && (
                <>
                  {p.role !== 'host' && (
                    <button 
                      onClick={() => handleParticipantRoleChange(p.id, 'host')} 
                      className="tile-menu-item"
                    >
                      Make Host (Transfer)
                    </button>
                  )}
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
              {checkCanKick(callParticipants.find(part => part.id === myId)?.role || 'member', p.role || 'member') && (
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
}
