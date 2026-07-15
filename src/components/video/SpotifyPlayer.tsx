import { useEffect, useRef, useState } from 'react';
import { doc, updateDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { loadSpotifyApi } from '../../utils/helpers';

export function SpotifyPlayer({
  spotifyUri,
  isPresenter,
  presenterId,
  roomId,
  myId
}: {
  spotifyUri: string;
  isPresenter: boolean;
  presenterId: string;
  roomId: string;
  myId: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const controllerRef = useRef<any>(null);
  const isLocalChangeRef = useRef(false);
  const lastPresenterDataRef = useRef<any>(null);
  const hasDoneInitialSeekRef = useRef(false);
  const scrollTimeoutRef = useRef<any>(null);
  const isDraggingRef = useRef(false);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.5); // Default to 50%
  const [isScrolling, setIsScrolling] = useState(false);
  const [playing, setPlaying] = useState(false);

  const presenterIdRef = useRef(presenterId);
  const isPresenterRef = useRef(isPresenter);
  const localPausedRef = useRef(true);
  const currentTimeRef = useRef(currentTime);

  // Keep refs up-to-date on every render
  presenterIdRef.current = presenterId;
  isPresenterRef.current = isPresenter;
  currentTimeRef.current = currentTime;

  const updateFirestorePlaybackState = async (isPlaying: boolean, time: number) => {
    try {
      console.log("[SPOTIFY-SYNC] Writing playback state to Firestore:", { isPlaying, time });
      await updateDoc(doc(db, 'rooms', roomId, 'participants', myId), {
        ytPlaying: isPlaying,
        ytTime: time,
        ytUpdateTimestamp: Date.now(),
        ytSpeed: 1,
        ytPlaylistIndex: 0
      });
    } catch (e) {
      console.warn("Failed to update Spotify playback in Firestore:", e);
    }
  };

  const syncToPresenterState = async (data: any, controller: any) => {
    if (isPresenterRef.current) return; // Viewers only sync to presenter!

    const targetPlaying = data.ytPlaying ?? false;
    const targetTime = data.ytTime ?? 0;
    const targetTimestamp = data.ytUpdateTimestamp ?? Date.now();

    let correctedTime = targetTime;
    if (targetPlaying && targetTimestamp) {
      const elapsedSeconds = (Date.now() - targetTimestamp) / 1000;
      correctedTime += elapsedSeconds;
    }

    if (!isDraggingRef.current) {
      setCurrentTime(correctedTime);
    }
    isLocalChangeRef.current = true;

    try {
      if (targetPlaying && localPausedRef.current) {
        controller.play();
        localPausedRef.current = false;
      } else if (!targetPlaying && !localPausedRef.current) {
        controller.pause();
        localPausedRef.current = true;
      }
    } catch (e) {
      console.warn("Spotify sync play/pause failed:", e);
    }

    try {
      controller.seek(Math.floor(correctedTime));
      hasDoneInitialSeekRef.current = true;
    } catch (e) {
      console.warn("Spotify sync seek failed:", e);
    }

    setTimeout(() => {
      isLocalChangeRef.current = false;
    }, 500);
  };

  const togglePlay = () => {
    if (!isPresenter) return;
    const newState = !playing;
    setPlaying(newState);
    localPausedRef.current = !newState;

    if (controllerRef.current) {
      try {
        if (newState) {
          controllerRef.current.play();
        } else {
          controllerRef.current.pause();
        }
      } catch (e) {
        console.warn("Presenter toggle play/pause failed:", e);
      }
    }
    updateFirestorePlaybackState(newState, currentTimeRef.current);
  };

  // Handle temporary pointer-events bypass while wheeling to support iframe tracklist scrolling
  const handleWheel = () => {
    if (isPresenter) return;
    setIsScrolling(true);
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      setIsScrolling(false);
    }, 250);
  };

  // Unified local progress bar tracking timer (drives playline increments for both clients independently)
  useEffect(() => {
    const isPlaying = isPresenter ? playing : !localPausedRef.current;
    if (!isPlaying) return;

    let ticks = 0;
    const interval = setInterval(() => {
      setCurrentTime((prev) => prev + 1);

      if (isPresenterRef.current) {
        ticks += 1;
        if (ticks >= 2) {
          ticks = 0;
          updateFirestorePlaybackState(true, currentTimeRef.current + 1);
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isPresenter, playing]);

  // 1. Initialize Spotify Embed Controller on the existing iframe (wait for iframe load to prevent CORS binding issues)
  useEffect(() => {
    let active = true;
    let initialized = false;
    hasDoneInitialSeekRef.current = false;

    if (!iframeRef.current) return;

    const initController = () => {
      if (initialized) return;
      initialized = true;

      loadSpotifyApi().then((IFrameAPI) => {
        if (!active || !iframeRef.current) return;

        const options = {};

        IFrameAPI.createController(iframeRef.current, options, (EmbedController: any) => {
          if (!active) return;

          controllerRef.current = EmbedController;
          console.log("[SPOTIFY-SYNC] Controller successfully bound to existing iframe.");

          // Set default volume level
          try {
            EmbedController.setVolume(volume);
          } catch (e) {}

          // Sync to latest presenter state immediately when controller mounts
          const presenterData = lastPresenterDataRef.current;
          if (presenterData && !isPresenterRef.current) {
            syncToPresenterState(presenterData, EmbedController);
          } else if (isPresenterRef.current) {
            updateFirestorePlaybackState(playing, currentTimeRef.current);
            hasDoneInitialSeekRef.current = true;
          }

          let lastStatePaused = true;
          let lastPositionSeconds = 0;
          let lastCheckTime = Date.now();

          // Listen to playback state changes on the controller (if they fire)
          EmbedController.on('playback_update', (e: any) => {
            if (!active) return;
            const { position, duration: dur, isPaused } = e.data;
            const timeSeconds = position / 1000;

            if (!isDraggingRef.current) {
              setCurrentTime(timeSeconds);
            }
            setDuration(dur / 1000);
            localPausedRef.current = isPaused;
            if (isPresenterRef.current) {
              setPlaying(!isPaused);
            }

            if (isPresenterRef.current) {
              // Presenter tracking logic
              if (!hasDoneInitialSeekRef.current) return;

              const now = Date.now();
              const stateChanged = isPaused !== lastStatePaused;
              const expectedTime = lastPositionSeconds + (isPaused ? 0 : (now - lastCheckTime) / 1000);
              const timeJumped = Math.abs(timeSeconds - expectedTime) > 3.5;

              if (stateChanged || timeJumped) {
                if (!isLocalChangeRef.current) {
                  updateFirestorePlaybackState(!isPaused, timeSeconds);
                }
              }

              lastStatePaused = isPaused;
              lastPositionSeconds = timeSeconds;
              lastCheckTime = now;
            }
          });
        });
      });
    };

    const iframe = iframeRef.current;
    iframe.addEventListener('load', initController);

    // Fallback: If load event already fired or fails to trigger, initialize after 800ms
    const timer = setTimeout(() => {
      if (active) initController();
    }, 800);

    return () => {
      active = false;
      iframe.removeEventListener('load', initController);
      clearTimeout(timer);
      controllerRef.current = null;
    };
  }, [spotifyUri, roomId]);

  // 2. Synchronize to presenter changes via Firestore subscription
  useEffect(() => {
    if (isPresenter || !roomId || !presenterId) return;

    const partRef = doc(db, 'rooms', roomId, 'participants', presenterId);
    const unsubscribe = onSnapshot(partRef, (snapshot) => {
      if (!snapshot.exists()) return;
      const data = snapshot.data();
      lastPresenterDataRef.current = data;

      if (controllerRef.current && !isLocalChangeRef.current) {
        syncToPresenterState(data, controllerRef.current);
      }
    }, (err) => {
      console.warn("Failed to subscribe to Spotify presenter changes:", err);
    });

    return () => unsubscribe();
  }, [isPresenter, presenterId, roomId]);

  // 3. Watcher auto-sync enforcement loop (runs every 2 seconds for watchers to handle buffering or missed states)
  useEffect(() => {
    if (isPresenter || !roomId || !presenterId) return;

    let active = true;
    const interval = setInterval(() => {
      if (!active) return;
      
      const presenterData = lastPresenterDataRef.current;
      const controller = controllerRef.current;
      if (!presenterData || !controller) return;

      const targetPlaying = presenterData.ytPlaying ?? false;
      const targetTime = presenterData.ytTime ?? 0;
      const targetTimestamp = presenterData.ytUpdateTimestamp ?? Date.now();

      let correctedTime = targetTime;
      if (targetPlaying && targetTimestamp) {
        const elapsedSeconds = (Date.now() - targetTimestamp) / 1000;
        correctedTime += elapsedSeconds;
      }

      if (isLocalChangeRef.current) return;

      const localTime = currentTime;
      const localPlaying = !localPausedRef.current;
      const stateMismatched = localPlaying !== targetPlaying;
      const timeDrift = Math.abs(localTime - correctedTime);

      if (stateMismatched || timeDrift > 4.5) {
        console.log("[SPOTIFY-SYNC] Enforcing auto-sync correction. Drift:", timeDrift, "State mismatch:", stateMismatched);
        syncToPresenterState(presenterData, controller);
      }
    }, 2000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [isPresenter, presenterId, roomId, currentTime]);

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div 
      onWheel={handleWheel}
      style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', position: 'relative' }}
    >
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <iframe
          ref={iframeRef}
          src={spotifyUri}
          width="100%"
          height="100%"
          frameBorder="0"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
          style={{ borderRadius: 'var(--border-radius)', border: 'none', background: '#000' }}
          title="Spotify Music Player"
        />
        {!isPresenter && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              zIndex: 10,
              background: 'transparent',
              pointerEvents: isScrolling ? 'none' : 'auto',
              cursor: isScrolling ? 'default' : 'not-allowed'
            }}
          />
        )}
      </div>

      {/* Custom Progress Bar & Volume Line */}
      <div style={{
        padding: '10px 16px',
        background: '#121212',
        borderBottomLeftRadius: 'var(--border-radius)',
        borderBottomRightRadius: 'var(--border-radius)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        color: '#b3b3b3',
        fontFamily: 'Inter, sans-serif',
        fontSize: '11px',
        borderTop: '1px solid #282828'
      }}>
        {/* Play/Pause Button */}
        {isPresenter && (
          <button
            onClick={togglePlay}
            style={{
              background: 'none',
              border: 'none',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '14px',
              padding: '0 4px',
              display: 'flex',
              alignItems: 'center',
              outline: 'none'
            }}
          >
            {playing ? '❚❚' : '▶'}
          </button>
        )}

        {/* Time Tracking */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '80px' }}>
          <span>{formatTime(currentTime)}</span>
          <span>/</span>
          <span>{formatTime(duration || 180)}</span>
        </div>

        {/* Progress Slider */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
          {isPresenter ? (
            <input
              type="range"
              min={0}
              max={duration || 180}
              value={currentTime}
              onMouseDown={() => {
                isDraggingRef.current = true;
              }}
              onTouchStart={() => {
                isDraggingRef.current = true;
              }}
              onMouseUp={() => {
                isDraggingRef.current = false;
              }}
              onTouchEnd={() => {
                isDraggingRef.current = false;
              }}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setCurrentTime(val);
                if (controllerRef.current) {
                  controllerRef.current.seek(Math.floor(val));
                  updateFirestorePlaybackState(playing, val);
                }
              }}
              style={{
                width: '100%',
                accentColor: '#1db954',
                background: '#535353',
                height: '4px',
                borderRadius: '2px',
                cursor: 'pointer',
                outline: 'none'
              }}
            />
          ) : (
            <div style={{ width: '100%', background: '#535353', height: '4px', borderRadius: '2px', position: 'relative' }}>
              <div style={{ width: `${progressPercent}%`, background: '#1db954', height: '100%', borderRadius: '2px' }} />
            </div>
          )}
        </div>

        {/* Volume Control */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '100px' }}>
          <span style={{ fontSize: '12px' }}>🔊</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setVolume(val);
              if (controllerRef.current) {
                controllerRef.current.setVolume(val);
              }
            }}
            style={{
              width: '60px',
              accentColor: '#1db954',
              background: '#535353',
              height: '4px',
              borderRadius: '2px',
              cursor: 'pointer',
              outline: 'none'
            }}
          />
        </div>
      </div>
    </div>
  );
}
