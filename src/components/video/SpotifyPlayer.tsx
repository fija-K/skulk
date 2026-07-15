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

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const presenterIdRef = useRef(presenterId);
  const isPresenterRef = useRef(isPresenter);

  // Keep refs up-to-date on every render
  presenterIdRef.current = presenterId;
  isPresenterRef.current = isPresenter;

  const updateFirestorePlaybackState = async (playing: boolean, time: number) => {
    try {
      console.log("[SPOTIFY-SYNC] Writing playback state to Firestore:", { playing, time });
      await updateDoc(doc(db, 'rooms', roomId, 'participants', myId), {
        ytPlaying: playing,
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

    setCurrentTime(correctedTime);
    isLocalChangeRef.current = true;

    try {
      if (targetPlaying) {
        controller.play();
      } else {
        controller.pause();
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

  // 1. Initialize Spotify Embed Controller on the existing iframe
  useEffect(() => {
    let active = true;
    hasDoneInitialSeekRef.current = false;

    if (!iframeRef.current) return;

    loadSpotifyApi().then((IFrameAPI) => {
      if (!active || !iframeRef.current) return;

      const options = {};

      IFrameAPI.createController(iframeRef.current, options, (EmbedController: any) => {
        if (!active) return;

        controllerRef.current = EmbedController;
        console.log("[SPOTIFY-SYNC] Controller successfully bound to existing iframe.");

        // Sync to latest presenter state immediately when controller mounts
        const presenterData = lastPresenterDataRef.current;
        if (presenterData && !isPresenterRef.current) {
          syncToPresenterState(presenterData, EmbedController);
        } else if (isPresenterRef.current) {
          updateFirestorePlaybackState(true, 0);
          hasDoneInitialSeekRef.current = true;
        }

        let lastStatePaused = true;
        let lastPositionSeconds = 0;
        let lastCheckTime = Date.now();

        // Listen to playback state changes on the controller
        EmbedController.on('playback_update', (e: any) => {
          if (!active) return;
          const { position, duration: dur, isPaused } = e.data;
          const timeSeconds = position / 1000;

          setCurrentTime(timeSeconds);
          setDuration(dur / 1000);

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

    return () => {
      active = false;
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

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', position: 'relative' }}>
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
              cursor: 'not-allowed'
            }}
          />
        )}
      </div>

      {/* Custom Progress Bar / Player Line */}
      {duration > 0 && (
        <div style={{
          padding: '10px 16px',
          background: '#121212',
          borderBottomLeftRadius: 'var(--border-radius)',
          borderBottomRightRadius: 'var(--border-radius)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          color: '#b3b3b3',
          fontFamily: 'Inter, sans-serif',
          fontSize: '11px',
          borderTop: '1px solid #282828'
        }}>
          <span>{formatTime(currentTime)}</span>
          <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center' }}>
            {isPresenter ? (
              <input
                type="range"
                min={0}
                max={duration}
                value={currentTime}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setCurrentTime(val);
                  if (controllerRef.current) {
                    controllerRef.current.seek(Math.floor(val));
                    updateFirestorePlaybackState(true, val);
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
          <span>{formatTime(duration)}</span>
        </div>
      )}
    </div>
  );
}
