import { useEffect, useRef } from 'react';
import { useParticipants, useLocalParticipant } from '@livekit/components-react';
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
  handleOpenProfile?: (profile: any, view?: 'card' | 'followers' | 'following' | 'connections' | 'report') => void;
  handleClearParticipantChat?: (participantId: string, participantName: string) => void;
}

const drawWaveform = (canvas: HTMLCanvasElement, volume: number, phase: number) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  ctx.clearRect(0, 0, width, height);

  // Get active theme's primary color dynamically
  const rootStyle = getComputedStyle(document.documentElement);
  const primaryColor = rootStyle.getPropertyValue('--primary-color').trim() || '#f1c40f';

  // Apply volume sensitivity boost multiplier, clamped at 1.0
  const boostedVolume = Math.min(volume * 4.5, 1.0);

  // Apply a subtle neon-line glow using canvas shadow properties
  ctx.shadowColor = primaryColor;
  ctx.shadowBlur = boostedVolume > 0 ? 8 : 2; // enhanced neon glow when speaking
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  ctx.strokeStyle = primaryColor;
  ctx.lineWidth = 2.0; // thin line
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();

  const centerY = height / 2;
  const maxAmplitude = centerY - 4; // leave margin
  const amplitude = maxAmplitude * boostedVolume;

  // Wavy lines frequency scales with boosted volume
  const frequency = 0.04 + boostedVolume * 0.04;

  ctx.moveTo(0, centerY);

  // Draw the smooth sine wave step-by-step
  for (let x = 0; x <= width; x += 2) {
    // Fade out amplitude at the edges (0 and width) using a bell-curve window
    const edgeWindow = Math.sin((x / width) * Math.PI);
    const y = centerY + amplitude * edgeWindow * Math.sin(x * frequency - phase);
    ctx.lineTo(x, y);
  }

  ctx.stroke();

  // Reset shadow for performance
  ctx.shadowBlur = 0;
};

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
  handleParticipantRemove,
  handleOpenProfile,
  handleClearParticipantChat
}: ParticipantTileProps) {
  const isUser = p.id === myId;
  const showMuted = isUser ? isMicMuted : p.isMuted;
  const showCamOff = isUser ? isCamOff : p.isCamOff;
  const isSpeaking = p.isSpeaking && !showMuted;

  // Cache active canvas elements to avoid querying the DOM inside the 60 FPS RAF loop
  const activeCanvasesRef = useRef<HTMLCanvasElement[]>([]);
  const registerCanvas = (el: HTMLCanvasElement | null) => {
    if (el) {
      if (!activeCanvasesRef.current.includes(el)) {
        activeCanvasesRef.current.push(el);
      }
    } else {
      activeCanvasesRef.current = activeCanvasesRef.current.filter(c => c.isConnected);
    }
  };

  const { localParticipant } = useLocalParticipant();
  const lkParticipants = useParticipants();
  const lkParticipant = isUser ? localParticipant : lkParticipants.find(lp => lp.identity === p.id);

  useEffect(() => {
    return () => {
      activeCanvasesRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!lkParticipant) return;

    let animId: number;
    let currentVolume = 0;
    let phase = 0;

    const updateECG = () => {
      const isSp = lkParticipant.isSpeaking && !showMuted;
      const targetVol = isSp ? lkParticipant.audioLevel : 0;

      // Faster reactivity tracking (0.35 instead of 0.15) to follow raw speech peaks
      currentVolume = currentVolume + (targetVol - currentVolume) * 0.35;
      if (currentVolume < 0.001) {
        currentVolume = 0;
      }

      // Continuous phase increment for sine wave undulation
      phase += 0.15;

      // Render to all registered canvases
      activeCanvasesRef.current.forEach((canvas) => {
        if (showMuted) {
          canvas.style.display = 'none';
        } else {
          canvas.style.display = 'block';
          drawWaveform(canvas, currentVolume, phase);
        }
      });

      animId = requestAnimationFrame(updateECG);
    };

    updateECG();

    return () => {
      cancelAnimationFrame(animId);
      activeCanvasesRef.current.forEach((canvas) => {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        canvas.style.display = 'none';
      });
    };
  }, [lkParticipant, showMuted]);

  // Determine if menu should open upwards to prevent clipping at the bottom of the screen
  const indexInList = callParticipants.findIndex(part => part.id === p.id);
  const totalCount = callParticipants.length;
  const rowSize = totalCount <= 4 ? 2 : 3;
  const isBottomRow = indexInList >= 0 && (indexInList >= totalCount - rowSize);

  // If it's a thumbnail strip tile:
  if (isThumbnail) {
    const isSpotlightActive = p.id === spotlightParticipantId;
    return (
      <div 
        className={`spotlight-thumbnail-tile ${isUser ? 'user-tile' : ''} ${isSpeaking ? 'speaker-active' : ''} ${isSpotlightActive ? 'active' : ''} ${showCamOff ? 'camera-off' : ''}`}
        onClick={() => {
          if (p.sharing) {
            handleViewParticipantShare(p);
          } else {
            setSpotlightParticipantId(p.id);
          }
        }}
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
        {p.sharing ? (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: p.sharing === 'youtube' 
              ? 'radial-gradient(circle, rgba(241, 196, 15, 0.15) 0%, rgba(15, 16, 19, 0.95) 100%)'
              : p.sharing === 'whiteboard'
              ? 'radial-gradient(circle, rgba(16, 185, 129, 0.15) 0%, rgba(15, 16, 19, 0.95) 100%)'
              : p.sharing === 'spotify'
              ? 'radial-gradient(circle, rgba(29, 185, 84, 0.15) 0%, rgba(15, 16, 19, 0.95) 100%)'
              : 'radial-gradient(circle, rgba(59, 130, 246, 0.15) 0%, rgba(15, 16, 19, 0.95) 100%)',
            zIndex: 2
          }}>
            <span style={{ 
              fontSize: '14px', 
              color: p.sharing === 'youtube' ? 'var(--primary-color)' : p.sharing === 'whiteboard' ? '#10b981' : p.sharing === 'spotify' ? '#1db954' : '#3b82f6',
              animation: 'pulse 2s infinite'
            }}>
              {p.sharing === 'youtube' ? '▶' : p.sharing === 'whiteboard' ? '✎' : p.sharing === 'spotify' ? '♫' : '⛶'}
            </span>
            <span style={{ 
              fontSize: '8px', 
              color: p.sharing === 'youtube' ? 'var(--primary-color)' : p.sharing === 'whiteboard' ? '#10b981' : p.sharing === 'spotify' ? '#1db954' : '#3b82f6',
              fontWeight: 'bold',
              marginTop: '4px'
            }}>
              {p.sharing === 'youtube' ? 'Watch' : p.sharing === 'whiteboard' ? 'Draw' : p.sharing === 'spotify' ? 'Music' : 'Screen'}
            </span>
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

        {/* Status badge Overlay inside thumbnail */}
        {p.status && p.status !== 'none' && (() => {
          const STATUS_EMOJI: Record<string, string> = {
            dnd: '⛔', zZ: '💤', brb: '🚶', chillin: '😎'
          };
          const STATUS_COLOR: Record<string, string> = {
            dnd: '#ef4444', zZ: '#8b5cf6', brb: '#f59e0b', chillin: '#10b981'
          };
          const emoji = STATUS_EMOJI[p.status] || '';
          const bgColor = STATUS_COLOR[p.status] || '#64748b';
          return (
            <div
              className="participant-status-badge"
              style={{
                position: 'absolute',
                bottom: '18px',
                left: '4px',
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                backgroundColor: bgColor,
                border: '1.5px solid #0f1013',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '9px',
                lineHeight: 1,
                zIndex: 10,
                pointerEvents: 'none',
                boxShadow: `0 0 6px ${bgColor}66`
              }}
              title={p.status.toUpperCase()}
            >
              {emoji}
            </div>
          );
        })()}

        {/* Micro status indicator (Muted status) */}
        {showMuted && (
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
            <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="1" y1="1" x2="23" y2="23"></line>
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
              <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
            </svg>
          </div>
        )}
        
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

        {/* Dynamic ECG Line Canvas */}
        <canvas 
          className="ecg-canvas" 
          ref={registerCanvas} 
          style={{ 
            position: 'absolute', 
            bottom: 0, 
            left: 0, 
            width: '100%', 
            height: '20px', 
            pointerEvents: 'none', 
            zIndex: 6, 
            display: showMuted ? 'none' : 'block' 
          }} 
        />
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
        } : p.sharing === 'spotify' ? {
          boxShadow: '0 0 16px rgba(29, 185, 84, 0.3)',
          border: '2.5px solid #1db954'
        } : {},
        // Keep tiles equal size, prevent overflow/overlap, and auto-shrink to fit in gallery view
        ...(!isThumbnail && isGalleryView) ? {
          width: '100%',
          height: '100%',
          maxWidth: '100%',
          maxHeight: '100%'
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
              <canvas className="ecg-canvas" ref={registerCanvas} style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '24px', pointerEvents: 'none', zIndex: 6, display: showMuted ? 'none' : 'block' }} />
            </div>
            
            {/* Large avatar circle wrapper – status badge lives outside overflow:hidden */}
            <div style={{ position: 'relative', display: 'inline-block' }}>
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
                  } else if (handleOpenProfile) {
                    handleOpenProfile({
                      id: p.uid || p.id,
                      name: p.name.replace(' (You)', ''),
                      initials: p.initials,
                      color: p.color || '#3b82f6',
                      photoURL: p.photoURL
                    }, 'card');
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
                <canvas className="ecg-canvas" ref={registerCanvas} style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '24px', pointerEvents: 'none', zIndex: 6, display: showMuted ? 'none' : 'block' }} />
              </div>
              {/* Status badge — covers bottom-left ~1/8 of avatar */}
              {p.status && p.status !== 'none' && (() => {
                const STATUS_EMOJI: Record<string, string> = {
                  dnd: '⛔', zZ: '💤', brb: '🚶', chillin: '😎'
                };
                const STATUS_COLOR: Record<string, string> = {
                  dnd: '#ef4444', zZ: '#8b5cf6', brb: '#f59e0b', chillin: '#10b981'
                };
                const emoji = STATUS_EMOJI[p.status] || '';
                const bgColor = STATUS_COLOR[p.status] || '#64748b';
                // Badge = ~1/8 the circle area. Avatar is 96px → badge ~28px
                return (
                  <div
                    className="participant-status-badge"
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      backgroundColor: bgColor,
                      border: '2px solid #0f1013',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 14,
                      lineHeight: 1,
                      zIndex: 5,
                      pointerEvents: 'none',
                      boxShadow: `0 0 8px ${bgColor}66`
                    }}
                    title={p.status.toUpperCase()}
                  >
                    {emoji}
                  </div>
                );
              })()}
            </div>

            {p.sharing && (
              <div className="sharing-badge-overlay" style={{
                position: 'absolute',
                bottom: '12px',
                right: '12px',
                backgroundColor: p.sharing === 'youtube' ? 'var(--primary-color)' : p.sharing === 'whiteboard' ? '#10b981' : p.sharing === 'spotify' ? '#1db954' : '#3b82f6',
                color: (p.sharing === 'youtube' || p.sharing === 'whiteboard' || p.sharing === 'spotify') ? '#0f1013' : '#ffffff',
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
                {p.sharing === 'youtube' ? '▶' : p.sharing === 'whiteboard' ? '✎' : p.sharing === 'spotify' ? '♫' : '⛶'}
              </div>
            )}
          </>
        )
      ) : (
        // Compact Grid Layout OR Floating Avatar
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <div 
            className="participant-avatar-large" 
            style={{ 
              backgroundColor: p.color, 
              cursor: p.sharing ? 'pointer' : 'default',
              position: 'relative',
              boxShadow: p.sharing === 'youtube'
                ? '0 0 12px var(--primary-color)'
                : p.sharing === 'whiteboard'
                ? '0 0 12px #10b981'
                : p.sharing === 'spotify'
                ? '0 0 12px #1db954'
                : p.sharing
                ? '0 0 12px #3b82f6'
                : 'none',
              border: p.sharing === 'youtube'
                ? '2px solid var(--primary-color)'
                : p.sharing === 'whiteboard'
                ? '2px solid #10b981'
                : p.sharing === 'spotify'
                ? '2px solid #1db954'
                : p.sharing
                ? '2px solid #3b82f6'
                : 'none',
              overflow: 'hidden',
              background: p.sharing === 'youtube'
                ? 'radial-gradient(circle, rgba(241, 196, 15, 0.15) 0%, rgba(15, 16, 19, 0.95) 100%)'
                : p.sharing === 'whiteboard'
                ? 'radial-gradient(circle, rgba(16, 185, 129, 0.15) 0%, rgba(15, 16, 19, 0.95) 100%)'
                : p.sharing === 'spotify'
                ? 'radial-gradient(circle, rgba(29, 185, 84, 0.15) 0%, rgba(15, 16, 19, 0.95) 100%)'
                : undefined,
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
            ) : p.sharing === 'spotify' ? (
              /* Pulsing music icon inside circular avatar circle */
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
                <span style={{ fontSize: isThumbnail ? '14px' : '20px', color: '#1db954' }}>♫</span>
              </div>
            ) : (
              <>
                <div className="tile-video-wrapper">
                  {!(isUser && cameraError) && (
                    <ParticipantVideo participantId={p.id} />
                  )}
                  <canvas className="ecg-canvas" ref={registerCanvas} style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '20px', pointerEvents: 'none', zIndex: 6, display: showMuted ? 'none' : 'block' }} />
                </div>
                <div 
                  className="tile-avatar-wrapper"
                  style={{ cursor: 'pointer', position: 'relative' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (handleOpenProfile) {
                      handleOpenProfile({
                        id: p.uid || p.id,
                        name: p.name.replace(' (You)', ''),
                        initials: p.initials,
                        color: p.color || '#3b82f6',
                        photoURL: p.photoURL
                      }, 'card');
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
                     <span className="tile-avatar-initials">{p.initials}</span>
                   )}
                   <canvas className="ecg-canvas" ref={registerCanvas} style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '20px', pointerEvents: 'none', zIndex: 6, display: showMuted ? 'none' : 'block' }} />
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
                backgroundColor: p.sharing === 'youtube' ? 'var(--primary-color)' : p.sharing === 'whiteboard' ? '#10b981' : p.sharing === 'spotify' ? '#1db954' : '#3b82f6',
                color: (p.sharing === 'youtube' || p.sharing === 'whiteboard' || p.sharing === 'spotify') ? '#0f1013' : '#ffffff',
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
                {p.sharing === 'youtube' ? '▶' : p.sharing === 'whiteboard' ? '✎' : p.sharing === 'spotify' ? '♫' : '⛶'}
              </div>
            )}
          </div>
          {/* Status badge Overlay inside wrapper */}
          {p.status && p.status !== 'none' && (() => {
            const STATUS_EMOJI: Record<string, string> = {
              dnd: '⛔', zZ: '💤', brb: '🚶', chillin: '😎'
            };
            const STATUS_COLOR: Record<string, string> = {
              dnd: '#ef4444', zZ: '#8b5cf6', brb: '#f59e0b', chillin: '#10b981'
            };
            const emoji = STATUS_EMOJI[p.status] || '';
            const bgColor = STATUS_COLOR[p.status] || '#64748b';
            const size = isThumbnail ? 16 : 28;
            const fontSize = isThumbnail ? 9 : 14;
            return (
              <div
                className="participant-status-badge"
                style={{
                  position: 'absolute',
                  bottom: isThumbnail ? -2 : 0,
                  left: isThumbnail ? -2 : 0,
                  width: size,
                  height: size,
                  borderRadius: '50%',
                  backgroundColor: bgColor,
                  border: '2px solid #0f1013',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: fontSize,
                  lineHeight: 1,
                  zIndex: 20,
                  pointerEvents: 'none',
                  boxShadow: `0 0 8px ${bgColor}66`
                }}
                title={p.status.toUpperCase()}
              >
                {emoji}
              </div>
            );
          })()}
        </div>
      )}
      
      {/* Name Tag + Muted Status Overlay */}
      {!isThumbnail && (
        <div className="participant-info-overlay">
          <div 
            className="participant-name-tag" 
            style={{ gap: '6px', cursor: 'pointer' }}
            onClick={(e) => {
              e.stopPropagation();
              if (handleOpenProfile) {
                handleOpenProfile({
                  id: p.uid || p.id,
                  name: p.name.replace(' (You)', ''),
                  initials: p.initials,
                  color: p.color || '#3b82f6',
                  photoURL: p.photoURL
                }, 'card');
              }
            }}
          >
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
                } : p.role === 'bot' ? {
                  backgroundColor: 'rgba(29, 185, 84, 0.15)',
                  borderColor: '#1db954',
                  color: '#1db954'
                } : {
                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                  borderColor: '#10b981',
                  color: '#10b981'
                }
              }}>
                {p.role === 'admin' ? '👑 Admin' : p.role === 'host' ? '⭐ Host' : p.role === 'bot' ? '🤖 Buddy' : '🛡️ Co-host'}
              </span>
            )}
          </div>
          {p.handRaised && (
            <div className="tile-hand-badge" title="Hand raised">
              <span>✋</span>
            </div>
          )}
          {showMuted && (
            <div className="tile-mic-badge muted">
              <svg className="tile-icon-muted" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="1" y1="1" x2="23" y2="23"></line>
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
                <line x1="12" y1="19" x2="12" y2="23"></line>
                <line x1="8" y1="23" x2="16" y2="23"></line>
              </svg>
            </div>
          )}
        </div>
      )}

      {/* Host Actions Hover Trigger Menu */}
      {!isThumbnail && !isUser && p.role !== 'bot' && (callParticipants.find(part => part.id === myId)?.role === 'admin' || 
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
            <div className="tile-actions-menu animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '140px', ...isBottomRow ? { bottom: '40px', top: 'auto' } : { top: '40px', bottom: 'auto' } }} onClick={e => e.stopPropagation()}>
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
                  {p.camRestricted ? 'Unrestrict camera' : 'Restrict camera'}
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

              {/* Clear participant's chat action – moderators only, not on own tile */}
              {p.id !== myId && handleClearParticipantChat && (['host', 'cohost', 'admin'].includes(
                callParticipants.find(part => part.id === myId)?.role || 'member'
              )) && (
                <button
                  onClick={() => {
                    if (window.confirm(`Clear all messages from ${p.name}? This cannot be undone.`)) {
                      handleClearParticipantChat(p.id, p.name);
                    }
                  }}
                  className="tile-menu-item"
                  style={{ color: '#f97316' }}
                >
                  🗑️ Clear {p.name.split(' ')[0]}'s Chat
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {!isThumbnail && !isGalleryView && (
        <canvas 
          className="ecg-canvas" 
          ref={registerCanvas} 
          style={{ 
            position: 'absolute', 
            bottom: '4px', 
            left: 0, 
            width: '100%', 
            height: '24px', 
            pointerEvents: 'none', 
            zIndex: 6, 
            display: showMuted ? 'none' : 'block' 
          }} 
        />
      )}
    </div>
  );
}
