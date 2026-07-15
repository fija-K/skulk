import { useEffect, useRef } from 'react';
import { doc, updateDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import {
  loadYoutubeApi,
  loadVimeoApi,
  loadTwitchApi,
  loadDailymotionApi
} from '../../utils/helpers';
import type { Participant } from '../../App';

export interface AbstractPlayer {
  play(): void;
  pause(): void;
  seekTo(seconds: number): void;
  getCurrentTime(): Promise<number> | number;
  getPlayerState(): Promise<number> | number;
  getPlaybackRate?(): Promise<number> | number;
  setPlaybackRate?(rate: number): Promise<void> | void;
  getDuration?(): Promise<number> | number;
  destroy(): void;
}

export function createWrappedPlayer(
  platform: string,
  targetElement: HTMLElement,
  videoId: string,
  isPresenter: boolean,
  isLive: boolean,
  onStateChange: (playing: boolean, time: number) => void,
  onNativeStateChange?: (state: number) => void
): Promise<AbstractPlayer> {
  if (platform === 'youtube') {
    return loadYoutubeApi().then(() => {
      if (!targetElement || !targetElement.parentNode) {
        throw new Error("Element detached before YouTube Player could load");
      }
      const isPlaylist = videoId.startsWith('playlist:');
      let playlistId = '';
      let actualVideoId = videoId;
      if (isPlaylist) {
        const parts = videoId.split(':');
        playlistId = parts[1];
        actualVideoId = parts[2] || '';
      }

      return new Promise<AbstractPlayer>((resolve) => {
        const playerVars: any = {
          autoplay: 1,
          controls: 1,
          disablekb: 0,
          rel: 0,
          mute: isPresenter ? 0 : 1,
          origin: window.location.origin,
          enablejsapi: 1
        };

        if (isPlaylist) {
          playerVars.listType = 'playlist';
          playerVars.list = playlistId;
        }

        const player = new (window as any).YT.Player(targetElement, {
          width: '100%',
          height: '100%',
          ...(!isPlaylist || actualVideoId ? { videoId: actualVideoId } : {}),
          playerVars: playerVars,
          events: {
            onReady: () => {
              if (!isPresenter) {
                try {
                  player.mute();
                } catch (e) {}
              }
              resolve({
                play: () => player.playVideo(),
                pause: () => player.pauseVideo(),
                seekTo: (sec) => player.seekTo(sec, true),
                getCurrentTime: () => player.getCurrentTime() || 0,
                getPlayerState: () => {
                  const s = player.getPlayerState();
                  return (s === 1 || s === 3) ? 1 : 2;
                },
                getPlaybackRate: () => player.getPlaybackRate() || 1,
                setPlaybackRate: (rate) => player.setPlaybackRate(rate),
                getDuration: () => player.getDuration() || 0,
                destroy: () => {
                  try {
                    player.destroy();
                  } catch (e) {}
                }
              });
            },
            onStateChange: (event: any) => {
              const state = event.data;
              if (onNativeStateChange) {
                onNativeStateChange(state);
              }
              const time = player.getCurrentTime() || 0;
              if (state === 1) {
                onStateChange(true, time);
              } else if (state === 2) {
                onStateChange(false, time);
              }
            }
          }
        });
      });
    });
  }

  if (platform === 'vimeo') {
    return loadVimeoApi().then(() => {
      if (!targetElement || !targetElement.parentNode) {
        throw new Error("Element detached before Vimeo Player could load");
      }
      targetElement.innerHTML = '';
      
      const player = new (window as any).Vimeo.Player(targetElement, {
        id: parseInt(videoId, 10),
        autoplay: isPresenter,
        muted: !isPresenter,
        controls: true,
        loop: false
      });

      return player.ready().then(() => {
        // style vimeo's auto-created iframe
        const iframe = targetElement.querySelector('iframe');
        if (iframe) {
          iframe.style.width = '100%';
          iframe.style.height = '100%';
          iframe.style.border = 'none';
        }

        if (isPresenter) {
          player.on('play', async () => {
            const time = await player.getCurrentTime().catch(() => 0);
            onStateChange(true, time);
          });
          player.on('pause', async () => {
            const time = await player.getCurrentTime().catch(() => 0);
            onStateChange(false, time);
          });
          player.on('seeked', async () => {
            const time = await player.getCurrentTime().catch(() => 0);
            const paused = await player.getPaused().catch(() => true);
            onStateChange(!paused, time);
          });
        }

        return {
          play: () => player.play().catch(() => {}),
          pause: () => player.pause().catch(() => {}),
          seekTo: (sec: number) => player.setCurrentTime(sec).catch(() => {}),
          getCurrentTime: () => player.getCurrentTime().catch(() => 0),
          getPlayerState: async () => {
            const paused = await player.getPaused().catch(() => true);
            return paused ? 2 : 1;
          },
          getPlaybackRate: () => player.getPlaybackRate().catch(() => 1),
          setPlaybackRate: (rate: number) => player.setPlaybackRate(rate).catch(() => {}),
          destroy: () => {
            try {
              player.unload();
            } catch (e) {}
            targetElement.innerHTML = '';
          }
        };
      });
    });
  }

  if (platform === 'dailymotion') {
    return loadDailymotionApi().then(() => {
      if (!targetElement || !targetElement.parentNode) {
        throw new Error("Element detached before Dailymotion Player could load");
      }
      targetElement.innerHTML = '';
      
      const playerDiv = document.createElement('div');
      playerDiv.id = 'dailymotion-player-' + Date.now();
      playerDiv.style.width = '100%';
      playerDiv.style.height = '100%';
      targetElement.appendChild(playerDiv);

      return (window as any).dailymotion.createPlayer(playerDiv.id, {
        video: videoId,
        params: {
          autoplay: isPresenter,
          mute: !isPresenter,
          controls: true
        }
      }).then((player: any) => {
        let localTime = 0;
        let isPlaying = isPresenter;

        player.on('play', () => {
          isPlaying = true;
          if (isPresenter) {
            onStateChange(true, localTime);
          }
        });

        player.on('pause', () => {
          isPlaying = false;
          if (isPresenter) {
            onStateChange(false, localTime);
          }
        });

        player.on('seeked', (e: any) => {
          if (e && typeof e.time === 'number') {
            localTime = e.time;
          } else if (e && typeof e.videoTime === 'number') {
            localTime = e.videoTime;
          }
          if (isPresenter) {
            onStateChange(isPlaying, localTime);
          }
        });

        player.on('timeupdate', (e: any) => {
          if (e && typeof e.time === 'number') {
            localTime = e.time;
          } else if (e && typeof e.videoTime === 'number') {
            localTime = e.videoTime;
          }
        });

        return {
          play: () => {
            try {
              player.play();
            } catch (e) {
              console.warn("Dailymotion play failed:", e);
            }
          },
          pause: () => {
            try {
              player.pause();
            } catch (e) {
              console.warn("Dailymotion pause failed:", e);
            }
          },
          seekTo: (sec: number) => {
            try {
              player.seek(sec);
            } catch (e) {
              console.warn("Dailymotion seek failed:", e);
            }
          },
          getCurrentTime: async () => {
            try {
              const state = await player.getState();
              if (state && typeof state.videoTime === 'number') {
                localTime = state.videoTime;
              }
            } catch (e) {}
            return localTime;
          },
          getPlayerState: async () => {
            try {
              const state = await player.getState();
              if (state && typeof state.playerIsPlaying === 'boolean') {
                isPlaying = state.playerIsPlaying;
              }
            } catch (e) {}
            return isPlaying ? 1 : 2;
          },
          getPlaybackRate: () => 1,
          setPlaybackRate: () => {},
          destroy: () => {
            try {
              player.destroy();
            } catch (e) {}
            try {
              (window as any).dailymotion.destroy(playerDiv.id);
            } catch (e) {}
            targetElement.innerHTML = '';
          }
        };
      });
    });
  }

  if (platform === 'twitch') {
    return loadTwitchApi().then(() => {
      if (!targetElement || !targetElement.parentNode) {
        throw new Error("Element detached before Twitch Player could load");
      }
      targetElement.innerHTML = '';

      const options: any = {
        width: '100%',
        height: '100%',
        autoplay: isPresenter,
        muted: !isPresenter,
        controls: true,
        parent: [window.location.hostname]
      };

      if (isLive) {
        options.channel = videoId;
      } else {
        options.video = videoId;
      }

      const player = new (window as any).Twitch.Player(targetElement, options);

      return new Promise<AbstractPlayer>((resolve) => {
        player.addEventListener((window as any).Twitch.Player.READY, () => {
          let isPaused = !isPresenter;

          player.addEventListener((window as any).Twitch.Player.PLAY, () => {
            isPaused = false;
            if (isPresenter && !isLive) {
              onStateChange(true, player.getCurrentTime());
            }
          });

          player.addEventListener((window as any).Twitch.Player.PAUSE, () => {
            isPaused = true;
            if (isPresenter && !isLive) {
              onStateChange(false, player.getCurrentTime());
            }
          });

          if (isPresenter && !isLive) {
            player.addEventListener((window as any).Twitch.Player.SEEK, () => {
              onStateChange(!isPaused, player.getCurrentTime());
            });
          }

          resolve({
            play: () => {
              try {
                player.play();
              } catch (e) {
                console.warn("Twitch play failed:", e);
              }
            },
            pause: () => {
              try {
                player.pause();
              } catch (e) {
                console.warn("Twitch pause failed:", e);
              }
            },
            seekTo: (sec) => {
              try {
                if (!isLive) player.seek(sec);
              } catch (e) {
                console.warn("Twitch seek failed:", e);
              }
            },
            getCurrentTime: () => {
              if (isLive) return 0;
              try {
                return player.getCurrentTime();
              } catch (e) {
                return 0;
              }
            },
            getPlayerState: () => {
              try {
                return player.isPaused() ? 2 : 1;
              } catch (e) {
                return isPaused ? 2 : 1;
              }
            },
            destroy: () => {
              targetElement.innerHTML = '';
            }
          });
        });
      });
    });
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

export function UniversalVideoPlayer({ 
  videoId, 
  platform,
  isLive,
  isPresenter, 
  presenterId,
  roomId,
  myId,
  participants
}: { 
  videoId: string; 
  platform: 'youtube' | 'vimeo' | 'dailymotion' | 'twitch';
  isLive: boolean;
  isPresenter: boolean; 
  presenterId: string;
  roomId: string;
  myId: string;
  participants: Participant[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<AbstractPlayer | null>(null);
  const isLocalChangeRef = useRef(false);
  const lastPresenterDataRef = useRef<any>(null);
  const hasDoneInitialSeekRef = useRef(false);

  const getPresenterState = () => {
    return participants.find(p => p.id === presenterId) as any;
  };

  const syncToPresenterState = async (data: any, player: AbstractPlayer) => {
    if (isPresenter || isLive) return; // Viewers only sync to presenter!

    const targetPlaying = data.ytPlaying ?? false;
    const targetTime = data.ytTime ?? 0;
    const targetTimestamp = data.ytUpdateTimestamp ?? Date.now();
    const targetSpeed = data.ytSpeed ?? 1;
    
    let correctedTime = targetTime;
    if (targetPlaying && targetTimestamp) {
      const elapsedSeconds = (Date.now() - targetTimestamp) / 1000;
      correctedTime += elapsedSeconds * targetSpeed;
    }

    isLocalChangeRef.current = true;
    
    // 1. Sync play/pause state
    try {
      const currentState = await player.getPlayerState();
      if (targetPlaying && currentState !== 1) {
        player.play();
      } else if (!targetPlaying && currentState === 1) {
        player.pause();
      }
    } catch (e) {
      console.warn("Failed to sync play/pause state:", e);
    }

    // 2. Sync playback rate (speed)
    try {
      if (player.getPlaybackRate && player.setPlaybackRate) {
        const currentSpeed = await player.getPlaybackRate();
        if (Math.abs(currentSpeed - targetSpeed) > 0.05) {
          player.setPlaybackRate(targetSpeed);
        }
      }
    } catch (e) {
      console.warn("Failed to sync playback rate:", e);
    }

    // 3. Sync seek/current time (with safe metadata duration check)
    try {
      const currentTime = await player.getCurrentTime();
      let canSeek = true;
      if (player.getDuration) {
        const dur = await player.getDuration();
        if (dur === 0) {
          canSeek = false;
          // Force a play command to kickstart the player buffering if it's stuck in UNSTARTED/CUED
          if (targetPlaying) {
            player.play();
          }
          // Retry sync in 250ms
          setTimeout(() => {
            if (playerRef.current) syncToPresenterState(data, playerRef.current);
          }, 250);
        }
      }

      if (canSeek && Math.abs(currentTime - correctedTime) > 2) {
        player.seekTo(correctedTime);
      }
    } catch (e) {
      console.warn("Failed to sync seek/time:", e);
    }
    
    isLocalChangeRef.current = false;
  };

  useEffect(() => {
    let active = true;
    hasDoneInitialSeekRef.current = false;

    if (!containerRef.current) return;
    
    // Clear and restore a clean div inside the container to receive the player
    containerRef.current.innerHTML = '';
    const targetDiv = document.createElement('div');
    targetDiv.id = `skulk-media-player-${platform}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    targetDiv.style.width = '100%';
    targetDiv.style.height = '100%';
    containerRef.current.appendChild(targetDiv);

    createWrappedPlayer(
      platform,
      targetDiv,
      videoId,
      isPresenter,
      isLive,
      (playing, time) => {
        if (!isPresenter || isLive) return; // ONLY presenter writes playback updates to Firestore!
        if (!isLocalChangeRef.current) {
          updateFirestorePlaybackState(playing, time);
        }
      },
      (state) => {
        // State 1 is PLAYING, State 3 is BUFFERING.
        // Once the player is buffering or playing, metadata is loaded and seekTo is safe to call!
        if ((state === 1 || state === 3) && !hasDoneInitialSeekRef.current) {
          hasDoneInitialSeekRef.current = true;
          const presenterData = lastPresenterDataRef.current || getPresenterState();
          if (presenterData && playerRef.current) {
            console.log("[YT-SYNC] Player buffering or playing, performing initial sync seek:", presenterData);
            syncToPresenterState(presenterData, playerRef.current);
          }
        }
      }
    ).then((wrappedPlayer) => {
      if (!active) {
        wrappedPlayer.destroy();
        return;
      }
      playerRef.current = wrappedPlayer;

      // Sync to latest presenter state immediately when player mounts
      const presenterData = lastPresenterDataRef.current || getPresenterState();
      if (presenterData) {
        syncToPresenterState(presenterData, wrappedPlayer);
      }
    }).catch(err => {
      console.error("Failed to load player:", err);
    });

    return () => {
      active = false;
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
    };
  }, [videoId, platform, isPresenter, isLive]);

  const updateFirestorePlaybackState = async (playing: boolean, time: number, speed?: number) => {
    try {
      let resolvedSpeed = 1;
      try {
        if (speed !== undefined) {
          resolvedSpeed = speed;
        } else if (playerRef.current?.getPlaybackRate) {
          resolvedSpeed = await playerRef.current.getPlaybackRate();
        }
      } catch (speedErr) {
        console.warn("Failed to read playback speed:", speedErr);
      }

      await updateDoc(doc(db, 'rooms', roomId, 'participants', myId), {
        ytPlaying: playing,
        ytTime: time,
        ytUpdateTimestamp: Date.now(),
        ytSpeed: resolvedSpeed
      });
    } catch (e) {
      console.warn("Failed to update media playback in Firestore:", e);
    }
  };

  // Host/Presenter playback tracking loop (detects seeks and speed changes)
  useEffect(() => {
    if (!isPresenter || isLive) return;

    let lastState: number | null = null;
    let lastTime = 0;
    let lastSpeed: number | null = null;
    let lastCheck = Date.now();

    const interval = setInterval(async () => {
      if (playerRef.current) {
        try {
          let state = 2; // Default to paused
          try {
            state = await playerRef.current.getPlayerState();
          } catch (err) {
            console.warn("Tracking loop failed to get player state:", err);
          }

          let time = 0;
          try {
            time = await playerRef.current.getCurrentTime();
          } catch (err) {
            console.warn("Tracking loop failed to get current time:", err);
          }

          let speed = 1;
          try {
            speed = playerRef.current.getPlaybackRate ? await playerRef.current.getPlaybackRate() : 1;
          } catch (err) {
            console.warn("Tracking loop failed to get speed:", err);
          }

          const now = Date.now();
          const playing = state === 1;
          const stateChanged = state !== lastState;
          const speedChanged = lastSpeed !== null && Math.abs(speed - lastSpeed) > 0.05;

          // Detect seek: time jumped by more than 2 seconds from expected elapsed time (scaled by speed)
          const expectedTime = lastTime + (playing ? ((now - lastCheck) / 1000) * speed : 0);
          const timeJumped = Math.abs(time - expectedTime) > 2.0;

          if (stateChanged || timeJumped || speedChanged) {
            updateFirestorePlaybackState(playing, time, speed);
            lastState = state;
            lastTime = time;
            lastSpeed = speed;
            lastCheck = now;
          } else {
            lastTime = time;
            lastCheck = now;
          }
        } catch (e) {
          console.error("Tracking loop encountered error:", e);
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isPresenter, isLive]);

  // Synchronize player to presenter's active state in the room via direct document subscription
  useEffect(() => {
    if (isPresenter || isLive || !roomId || !presenterId) return;

    const partRef = doc(db, 'rooms', roomId, 'participants', presenterId);
    const unsubscribe = onSnapshot(partRef, (snapshot) => {
      if (!snapshot.exists()) return;
      const data = snapshot.data();
      lastPresenterDataRef.current = data;
      if (playerRef.current) {
        syncToPresenterState(data, playerRef.current);
      }
    }, (err) => {
      console.warn("Failed to subscribe to presenter changes:", err);
    });

    return () => unsubscribe();
  }, [isPresenter, isLive, presenterId, roomId]);

  // Viewer proactive local force sync interval
  useEffect(() => {
    if (isPresenter || isLive) return;

    const interval = setInterval(() => {
      if (playerRef.current && lastPresenterDataRef.current) {
        syncToPresenterState(lastPresenterDataRef.current, playerRef.current);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [isPresenter, isLive]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div 
        ref={containerRef} 
        style={{ 
          width: '100%', 
          height: '100%', 
          borderRadius: 'var(--border-radius)', 
          overflow: 'hidden',
          backgroundColor: '#000'
        }} 
      />
    </div>
  );
}
