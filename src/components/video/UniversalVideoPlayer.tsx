import { useEffect, useRef, useState } from 'react';
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
  getPlaylist?(): string[];
  getPlaylistIndex?(): number;
  playVideoAt?(index: number): void;
  loadVideo?(videoId: string): void;
  mute?(): void;
  unMute?(): void;
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
      const isPlaylist = videoId && typeof videoId === 'string' ? videoId.startsWith('playlist:') : false;
      let playlistId = '';
      let actualVideoId = videoId || '';
      let urlIndex = NaN;
      if (isPlaylist && videoId) {
        const parts = videoId.split(':');
        playlistId = parts[1] || '';
        actualVideoId = parts[2] || '';
        urlIndex = parts[3] ? parseInt(parts[3], 10) : NaN;
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
          if (!isNaN(urlIndex) && urlIndex > 0) {
            playerVars.index = urlIndex - 1;
          }
        }

        const playerOptions: any = {
          width: '100%',
          height: '100%',
          playerVars: playerVars,
          events: {
            onReady: () => {
              if (!isPresenter) {
                try {
                  player.mute();
                } catch (e) {}
              }
              try {
                player.playVideo();
              } catch (e) {}
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
                getPlaylist: () => {
                  try {
                    return player.getPlaylist() || [];
                  } catch (e) {
                    return [];
                  }
                },
                getPlaylistIndex: () => {
                  try {
                    return player.getPlaylistIndex() || 0;
                  } catch (e) {
                    return 0;
                  }
                },
                playVideoAt: (index: number) => {
                  try {
                    player.playVideoAt(index);
                  } catch (e) {
                    console.warn("playVideoAt failed:", e);
                  }
                },
                loadVideo: (vid: string) => {
                  try {
                    const isPlay = vid && typeof vid === 'string' ? vid.startsWith('playlist:') : false;
                    if (isPlay) {
                      const parts = vid.split(':');
                      const plistId = parts[1] || '';
                      const indexVal = parts[3] ? parseInt(parts[3], 10) : NaN;
                      const startIndex = (!isNaN(indexVal) && indexVal > 0) ? indexVal - 1 : 0;
                      player.loadPlaylist({
                        list: plistId,
                        listType: 'playlist',
                        index: startIndex,
                        suggestedQuality: 'default'
                      });
                    } else {
                      player.loadVideoById({
                        videoId: vid,
                        suggestedQuality: 'default'
                      });
                    }
                  } catch (e) {
                    console.warn("loadVideo failed:", e);
                  }
                },
                mute: () => {
                  try {
                    player.mute();
                  } catch (e) {}
                },
                unMute: () => {
                  try {
                    player.unMute();
                  } catch (e) {}
                },
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
              } else if (state === 2 || state === 0) {
                onStateChange(false, time);
              }
            }
          }
        };

        if (!isPlaylist && actualVideoId) {
          playerOptions.videoId = actualVideoId;
        }

        const player = new (window as any).YT.Player(targetElement, playerOptions);
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
        autoplay: true,
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

        try {
          player.play().catch(() => {});
        } catch (e) {}

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
          mute: () => {
            player.setVolume(0).catch(() => {});
          },
          unMute: () => {
            player.setVolume(1).catch(() => {});
          },
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
          autoplay: true,
          mute: !isPresenter,
          controls: true
        }
      }).then((player: any) => {
        try {
          player.play();
        } catch (e) {}
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
          mute: () => {
            try {
              player.setMute(true);
            } catch (e) {}
          },
          unMute: () => {
            try {
              player.setMute(false);
            } catch (e) {}
          },
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
        autoplay: true,
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
          let isPaused = false;
          try {
            player.play();
          } catch (e) {}

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
            mute: () => {
              try {
                player.setMuted(true);
              } catch (e) {}
            },
            unMute: () => {
              try {
                player.setMuted(false);
              } catch (e) {}
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

  const presenterIdRef = useRef(presenterId);
  const participantsRef = useRef(participants);
  const isPresenterRef = useRef(isPresenter);

  // Keep refs up-to-date on every render
  presenterIdRef.current = presenterId;
  participantsRef.current = participants;
  isPresenterRef.current = isPresenter;

  const isPlaylist = videoId.startsWith('playlist:');
  const [playlistIndex, setPlaylistIndex] = useState(0);
  const [playlistVideos, setPlaylistVideos] = useState<string[]>([]);
  const [videoTitles, setVideoTitles] = useState<Record<string, string>>({});
  const [showPlaylistSidebar, setShowPlaylistSidebar] = useState(true);



  // Load video titles via public noembed API
  useEffect(() => {
    if (playlistVideos.length === 0) return;
    playlistVideos.forEach(async (id: string) => {
      if (videoTitles[id]) return;
      try {
        const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${id}`);
        if (res.ok) {
          const data = await res.json();
          if (data.title) {
            setVideoTitles(prev => ({ ...prev, [id]: data.title }));
          }
        }
      } catch (e) {
        console.warn(`Failed to fetch title for video: ${id}`, e);
      }
    });
  }, [playlistVideos]);

  // Sync state loop to update playlistIndex state locally
  useEffect(() => {
    const interval = setInterval(async () => {
      if (playerRef.current && (playerRef.current as any).getPlaylistIndex) {
        const idx = await (playerRef.current as any).getPlaylistIndex();
        if (idx !== undefined && idx !== playlistIndex) {
          setPlaylistIndex(idx);
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [playlistIndex]);

  const getPresenterState = () => {
    return participantsRef.current.find(p => p.id === presenterIdRef.current) as any;
  };

  const syncToPresenterState = async (data: any, player: AbstractPlayer) => {
    if (isPresenterRef.current || isLive) return; // Viewers only sync to presenter!

    // Sync playlist index
    try {
      const targetPlaylistIndex = data.ytPlaylistIndex ?? 0;
      if (player.getPlaylistIndex && player.playVideoAt) {
        const playlist = (player as any).getPlaylist ? (player as any).getPlaylist() : [];
        if (!playlist || playlist.length > 0) {
          const currentIndex = player.getPlaylistIndex();
          if (currentIndex !== targetPlaylistIndex) {
            player.playVideoAt(targetPlaylistIndex);
          }
        }
      }
    } catch (e) {
      console.warn("Failed to sync playlist index:", e);
    }

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
        } else if (correctedTime > dur) {
          correctedTime = Math.max(0, dur - 0.5);
        }
      }

      if (canSeek) {
        if (Math.abs(currentTime - correctedTime) > 2) {
          player.seekTo(correctedTime);
        }
        hasDoneInitialSeekRef.current = true;
      }
    } catch (e) {
      console.warn("Failed to sync seek/time:", e);
    }
    
    isLocalChangeRef.current = false;
  };

  const syncPresenterToOwnState = async (player: AbstractPlayer) => {
    try {
      const presenterData = getPresenterState();
      if (!presenterData) return;

      if (presenterData.ytPlaying === undefined) {
        // No saved playback state exists yet. Mark initial seek as done immediately!
        hasDoneInitialSeekRef.current = true;
        return;
      }

      const targetPlaying = presenterData.ytPlaying ?? false;
      const targetTime = presenterData.ytTime ?? 0;
      const targetTimestamp = presenterData.ytUpdateTimestamp ?? Date.now();
      const speed = presenterData.ytSpeed ?? 1;

      let elapsed = 0;
      if (targetPlaying) {
        elapsed = Date.now() - targetTimestamp;
      }
      let correctedTime = targetTime + (targetPlaying ? (elapsed / 1000) * speed : 0);

      // Restore playlist index if applicable
      try {
        const targetPlaylistIndex = presenterData.ytPlaylistIndex ?? 0;
        if (player.getPlaylistIndex && player.playVideoAt) {
          const playlist = (player as any).getPlaylist ? (player as any).getPlaylist() : [];
          if (!playlist || playlist.length > 0) {
            const currentIndex = player.getPlaylistIndex();
            if (currentIndex !== targetPlaylistIndex) {
              player.playVideoAt(targetPlaylistIndex);
            }
          }
        }
      } catch (playlistErr) {
        console.warn("Failed to restore playlist index for presenter:", playlistErr);
      }

      let canSeek = true;
      if (player.getDuration) {
        const dur = await player.getDuration();
        if (dur === 0) {
          canSeek = false;
          // Force play to kickstart loading/buffering
          if (targetPlaying) {
            player.play();
          }
          setTimeout(() => {
            if (playerRef.current) syncPresenterToOwnState(playerRef.current);
          }, 250);
        } else if (correctedTime > dur) {
          correctedTime = Math.max(0, dur - 0.5);
        }
      }

      if (canSeek) {
        if (targetPlaying) {
          player.play();
        } else {
          player.pause();
        }
        player.seekTo(correctedTime);
        hasDoneInitialSeekRef.current = true;
      }
    } catch (e) {
      console.warn("Failed to sync presenter to own state on mount:", e);
    }
  };

  const lastLoadedVideoIdRef = useRef<string>(videoId);
  const videoIdDependency = platform === 'youtube' ? 'youtube' : videoId;

  useEffect(() => {
    let active = true;
    let timer: any = null;
    hasDoneInitialSeekRef.current = false;
    lastLoadedVideoIdRef.current = videoId;

    if (!containerRef.current) return;
    
    // Clear and restore a clean div inside the container to receive the player
    containerRef.current.innerHTML = '';
    const targetDiv = document.createElement('div');
    targetDiv.id = `skulk-media-player-${platform}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    targetDiv.style.width = '100%';
    targetDiv.style.height = '100%';
    containerRef.current.appendChild(targetDiv);

    const apiLoadPromise = platform === 'youtube' ? loadYoutubeApi() : Promise.resolve();
    apiLoadPromise.then(() => {
      if (!active) return;

      // Add a tiny 50ms delay to allow DOM/previous player cleanup to settle completely
      timer = setTimeout(() => {
        if (!active) return;
        createWrappedPlayer(
          platform,
          targetDiv,
          videoId,
          isPresenterRef.current,
          isLive,
          (playing, time) => {
            if (!active) return;
            if (!isPresenterRef.current || isLive) return; // ONLY presenter writes playback updates to Firestore!
            if (!hasDoneInitialSeekRef.current) {
              console.log("[YT-SYNC] Skipping Firestore state change write because initial seek is not complete yet.");
              return;
            }
            if (!isLocalChangeRef.current) {
              updateFirestorePlaybackState(playing, time);
            }
          },
          (state) => {
            if (!active) return;
            // State 1 is PLAYING, State 3 is BUFFERING.
            // Once the player is buffering or playing, metadata is loaded and seekTo is safe to call!
            if ((state === 1 || state === 3) && !hasDoneInitialSeekRef.current) {
              const presenterData = lastPresenterDataRef.current || getPresenterState();
              if (playerRef.current) {
                console.log("[YT-SYNC] Player buffering or playing, performing initial sync seek:", presenterData);
                if (isPresenterRef.current) {
                  if (presenterData && presenterData.ytPlaying !== undefined) {
                    syncPresenterToOwnState(playerRef.current);
                  } else {
                    hasDoneInitialSeekRef.current = true;
                  }
                } else if (presenterData) {
                  syncToPresenterState(presenterData, playerRef.current);
                }
              }
            }
          }
        ).then((wrappedPlayer) => {
          if (!active) {
            wrappedPlayer.destroy();
            return;
          }
          playerRef.current = wrappedPlayer;

          // If videoId changed while the player was initializing, load it now!
          if (lastLoadedVideoIdRef.current !== videoId && (wrappedPlayer as any).loadVideo) {
            (wrappedPlayer as any).loadVideo(lastLoadedVideoIdRef.current);
          }

          // Check for playlist videos immediately and with a small interval
          if (wrappedPlayer.getPlaylist) {
            const checkPlaylist = () => {
              if (!active) return;
              const list = wrappedPlayer.getPlaylist?.();
              if (list && list.length > 0) {
                setPlaylistVideos(list);
              } else {
                setTimeout(checkPlaylist, 500);
              }
            };
            checkPlaylist();
          }

          // Sync to latest presenter state immediately when player mounts
          const presenterData = lastPresenterDataRef.current || getPresenterState();
          if (isPresenterRef.current) {
            if (!presenterData || presenterData.ytPlaying === undefined) {
              hasDoneInitialSeekRef.current = true;
            } else {
              syncPresenterToOwnState(wrappedPlayer);
            }
          } else if (presenterData) {
            syncToPresenterState(presenterData, wrappedPlayer);
          }
        }).catch(err => {
          console.error("Failed to load player:", err);
        });
      }, 50);
    });

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
    };
  }, [videoIdDependency, platform, isLive, roomId]);

  // Dynamically mute/unmute player when switching between presenting/watching without recreating the iframe
  useEffect(() => {
    if (playerRef.current) {
      if (isPresenter) {
        try { playerRef.current.unMute?.(); } catch (e) {}
      } else {
        try { playerRef.current.mute?.(); } catch (e) {}
      }
    }
  }, [isPresenter]);

  // Sync video updates dynamically for reusable players (like YouTube)
  useEffect(() => {
    if (videoId === lastLoadedVideoIdRef.current) return;
    lastLoadedVideoIdRef.current = videoId;

    if (playerRef.current && (playerRef.current as any).loadVideo) {
      (playerRef.current as any).loadVideo(videoId);
    }
  }, [videoId]);

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

      let playlistIndex = 0;
      try {
        if (playerRef.current && (playerRef.current as any).getPlaylistIndex) {
          playlistIndex = (playerRef.current as any).getPlaylistIndex();
        }
      } catch (playlistErr) {
        console.warn("Failed to read playlist index:", playlistErr);
      }

      console.log("[FIRESTORE-WRITE] updateFirestorePlaybackState", {
        ytPlaying: playing,
        ytTime: time,
        ytSpeed: resolvedSpeed,
        ytPlaylistIndex: playlistIndex,
        roomId,
        myId,
        stack: new Error().stack
      });

      await updateDoc(doc(db, 'rooms', roomId, 'participants', myId), {
        ytPlaying: playing,
        ytTime: time,
        ytUpdateTimestamp: Date.now(),
        ytSpeed: resolvedSpeed,
        ytPlaylistIndex: playlistIndex
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
    let lastPlaylistIndex: number | null = null;
    let lastCheck = Date.now();
    let active = true;

    const interval = setInterval(async () => {
      if (playerRef.current) {
        if (!hasDoneInitialSeekRef.current) {
          console.log("[YT-SYNC] Presenter tracking loop: skipping update because initial sync seek is not done yet.");
          return;
        }
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

          let playlistIndex = 0;
          try {
            if ((playerRef.current as any).getPlaylistIndex) {
              playlistIndex = (playerRef.current as any).getPlaylistIndex();
            }
          } catch (err) {
            console.warn("Tracking loop failed to get playlist index:", err);
          }

          const now = Date.now();
          const playing = state === 1;
          const stateChanged = state !== lastState;
          const speedChanged = lastSpeed !== null && Math.abs(speed - lastSpeed) > 0.05;
          const playlistIndexChanged = lastPlaylistIndex !== null && playlistIndex !== lastPlaylistIndex;

          // Detect seek: time jumped by more than 2 seconds from expected elapsed time (scaled by speed)
          const expectedTime = lastTime + (playing ? ((now - lastCheck) / 1000) * speed : 0);
          const timeJumped = Math.abs(time - expectedTime) > 2.0;

          if (stateChanged || timeJumped || speedChanged || playlistIndexChanged) {
            if (!active) return;
            updateFirestorePlaybackState(playing, time, speed);
            lastState = state;
            lastTime = time;
            lastSpeed = speed;
            lastPlaylistIndex = playlistIndex;
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

    return () => {
      active = false;
      clearInterval(interval);
    };
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
    <div style={{ display: 'flex', width: '100%', height: '100%', gap: '10px', position: 'relative' }}>
      <div 
        ref={containerRef} 
        style={{ 
          flex: 1, 
          height: '100%', 
          borderRadius: 'var(--border-radius)', 
          overflow: 'hidden',
          backgroundColor: '#000'
        }} 
      />
      
      {isPlaylist && playlistVideos.length > 0 && showPlaylistSidebar && (
        <div 
          className="youtube-playlist-sidebar animate-fade-in"
          style={{
            width: '240px',
            height: '100%',
            backgroundColor: 'var(--panel-bg)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--border-radius)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            zIndex: 5
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', backgroundColor: 'rgba(0,0,0,0.15)' }}>
            <span style={{ fontSize: '12px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
              🎵 Playlist ({playlistVideos.length})
            </span>
            <button
              type="button"
              onClick={() => setShowPlaylistSidebar(false)}
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '10px' }}
              title="Hide Playlist"
            >
              ✕
            </button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px' }}>
            {playlistVideos.map((id: string, index: number) => {
              const isActive = index === playlistIndex;
              return (
                <div
                  key={id}
                  onClick={() => {
                    if (isPresenter) {
                      if (playerRef.current && (playerRef.current as any).playVideoAt) {
                        (playerRef.current as any).playVideoAt(index);
                        setPlaylistIndex(index);
                      }
                    } else {
                      alert("🔒 Only the presenter can select playlist videos.");
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px',
                    borderRadius: '6px',
                    cursor: isPresenter ? 'pointer' : 'not-allowed',
                    backgroundColor: isActive ? 'rgba(241, 196, 15, 0.12)' : 'rgba(255,255,255,0.02)',
                    border: isActive ? '1px solid var(--primary-color)' : '1px solid transparent',
                    transition: 'all 0.2s',
                    textAlign: 'left'
                  }}
                >
                  <img
                    src={`https://img.youtube.com/vi/${id}/default.jpg`}
                    alt="Thumbnail"
                    style={{ width: '40px', height: '30px', borderRadius: '2px', objectFit: 'cover' }}
                  />
                  <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span 
                      style={{ 
                        fontSize: '11px', 
                        color: isActive ? 'var(--primary-color)' : 'var(--text-primary)', 
                        fontWeight: isActive ? 'bold' : 'normal',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                    >
                      {videoTitles[id] || `Video ${index + 1}`}
                    </span>
                    <span style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>
                      #{index + 1}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isPlaylist && playlistVideos.length > 0 && !showPlaylistSidebar && (
        <button
          type="button"
          onClick={() => setShowPlaylistSidebar(true)}
          style={{
            position: 'absolute',
            top: '55px',
            right: '10px',
            backgroundColor: 'rgba(10,11,14,0.85)',
            border: '1px solid var(--border-color)',
            color: '#fff',
            padding: '6px 12px',
            borderRadius: '20px',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            zIndex: 10
          }}
        >
          🎵 Show Playlist
        </button>
      )}
    </div>
  );
}
