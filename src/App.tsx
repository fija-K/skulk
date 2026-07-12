import { useState, useEffect, useRef, memo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { 
  collection, 
  doc, 
  setDoc, 
  deleteDoc, 
  getDoc,
  getDocs, 
  getDocsFromServer,
  onSnapshot, 
  updateDoc,
  runTransaction,
  serverTimestamp
} from 'firebase/firestore';
import { auth, googleProvider, signInWithPopup, signOut, db } from './firebase';
import {
  LiveKitRoom,
  VideoTrack,
  useTracks,
  RoomAudioRenderer,
  useLocalParticipant,
  useParticipants
} from '@livekit/components-react';
import '@livekit/components-styles';
import { Track, ParticipantEvent } from 'livekit-client';

interface Room {
  id: string;
  name: string;
  type: 'private' | 'public-ask' | 'public';
  buttonText: string;
  participants: string[];
  maxParticipants: number;
  scheduledDate?: string;
  scheduledTime?: string;
  link?: string;
  creatorId?: string; // Room creator is the Admin
  creatorName?: string;
  createdAt?: string;
}

interface Participant {
  id: string;
  name: string;
  initials: string;
  color: string;
  photoURL?: string | null;
  isMuted: boolean;
  isCamOff: boolean;
  isSpeaking: boolean;
  isPinned: boolean;
  isHost?: boolean;
  sharing?: 'youtube' | 'whiteboard' | 'screen' | null;
  sharingYoutubeId?: string | null;
  whiteboardData?: string;
  role?: 'admin' | 'host' | 'cohost' | 'member'; // admin, host, cohost, member
  mutedBy?: string;
  camOffBy?: string;
}

type ViewingShare = {
  participantId: string;
  type: 'youtube' | 'whiteboard' | 'screen';
  youtubeVideoId?: string;
};

interface ChatMessage {
  id: string;
  sender: string;
  senderId?: string;
  senderRole?: 'admin' | 'host' | 'cohost' | 'member';
  text: string;
  createdAt?: string;
}

const ParticipantVideo = memo(function ParticipantVideo({ participantId }: { participantId: string }) {
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: false }]);
  const trackRef = tracks.find(t => t.participant.identity === participantId) as any;

  if (!trackRef) return null;

  return (
    <VideoTrack 
      trackRef={trackRef} 
      style={{ 
        width: '100%', 
        height: '100%', 
        objectFit: 'cover', 
        borderRadius: '8px',
        position: 'absolute',
        top: 0,
        left: 0,
        zIndex: 1
      }} 
    />
  );
});


function LocalScreenShareLinker({ screenShareStream }: { screenShareStream: MediaStream | null }) {
  const { localParticipant } = useLocalParticipant();

  useEffect(() => {
    if (!localParticipant) return;

    if (screenShareStream) {
      const videoTrack = screenShareStream.getVideoTracks()[0];
      if (videoTrack) {
        console.log("Publishing local screen share track to LiveKit:", videoTrack);
        localParticipant.publishTrack(videoTrack, { source: Track.Source.ScreenShare }).then((publication) => {
          console.log("Successfully published screen share track:", publication);
        }).catch((err) => {
          console.error("Failed to publish screen share track:", err);
        });
      }
    } else {
      const publications = localParticipant.getTrackPublications();
      publications.forEach(pub => {
        if (pub.source === Track.Source.ScreenShare && pub.track) {
          console.log("Unpublishing local screen share track from LiveKit:", pub.track);
          localParticipant.unpublishTrack(pub.track as any);
        }
      });
    }
  }, [screenShareStream, localParticipant]);

  return null;
}

const ScreenShareVideo = memo(function ScreenShareVideo({ participantId }: { participantId: string }) {
  const tracks = useTracks([{ source: Track.Source.ScreenShare, withPlaceholder: false }]);
  const trackRef = tracks.find(t => t.participant.identity === participantId) as any;

  if (!trackRef) {
    return (
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        justifyContent: 'center', 
        height: '100%', 
        color: 'var(--text-secondary)',
        gap: '12px'
      }}>
        <span>Connecting to screen presentation...</span>
      </div>
    );
  }

  return (
    <VideoTrack 
      trackRef={trackRef} 
      style={{ 
        width: '100%', 
        height: '100%', 
        objectFit: 'contain', 
        borderRadius: 'var(--border-radius)',
        backgroundColor: '#050505'
      }} 
    />
  );
});



interface ParsedMedia {
  platform: 'youtube' | 'vimeo' | 'dailymotion' | 'twitch';
  videoId: string;
  isLive?: boolean;
}

function parseMediaUrl(url: string): ParsedMedia | null {
  const cleanUrl = url.trim();
  if (!cleanUrl) return null;

  // 1. YouTube
  const ytRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
  const ytMatch = cleanUrl.match(ytRegex);
  if (ytMatch) {
    return { platform: 'youtube', videoId: ytMatch[1] };
  }
  if (/^[a-zA-Z0-9_-]{11}$/.test(cleanUrl)) {
    return { platform: 'youtube', videoId: cleanUrl };
  }

  // 2. Vimeo
  const vimeoRegex = /(?:vimeo\.com\/|player\.vimeo\.com\/video\/)(\d+)/;
  const vimeoMatch = cleanUrl.match(vimeoRegex);
  if (vimeoMatch) {
    return { platform: 'vimeo', videoId: vimeoMatch[1] };
  }

  // 3. Dailymotion
  const dmRegex = /(?:dailymotion\.com\/(?:video|embed\/video)\/|dai\.ly\/)([a-zA-Z0-9]+)/;
  const dmMatch = cleanUrl.match(dmRegex);
  if (dmMatch) {
    return { platform: 'dailymotion', videoId: dmMatch[1] };
  }

  // 4. Twitch
  const twitchVodRegex = /twitch\.tv\/videos\/(\d+)/;
  const twitchVodMatch = cleanUrl.match(twitchVodRegex);
  if (twitchVodMatch) {
    return { platform: 'twitch', videoId: twitchVodMatch[1], isLive: false };
  }

  const twitchChannelRegex = /twitch\.tv\/([a-zA-Z0-9_]+)/;
  const twitchChannelMatch = cleanUrl.match(twitchChannelRegex);
  if (twitchChannelMatch) {
    const channel = twitchChannelMatch[1].toLowerCase();
    const reservedWords = ['directory', 'videos', 'u', 'moderator', 'popout', 'search'];
    if (!reservedWords.includes(channel)) {
      return { platform: 'twitch', videoId: twitchChannelMatch[1], isLive: true };
    }
  }

  return null;
}

function isDrmBlockedUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes('netflix.com') || 
         lower.includes('disneyplus.com') || 
         lower.includes('amazon.com/gp/video') || 
         lower.includes('primevideo.com') ||
         lower.includes('hulu.com') ||
         lower.includes('max.com') ||
         lower.includes('hbo.com');
}

const scriptLoadPromises: Record<string, Promise<void> | undefined> = {};

function loadPlatformScript(platform: string, src: string, callbackName?: string): Promise<void> {
  const existing = scriptLoadPromises[platform];
  if (existing) return existing;

  scriptLoadPromises[platform] = new Promise((resolve) => {
    if (platform === 'youtube' && (window as any).YT && (window as any).YT.Player) {
      resolve();
      return;
    }
    if (platform === 'vimeo' && (window as any).Vimeo) {
      resolve();
      return;
    }
    if (platform === 'dailymotion' && (window as any).DM) {
      resolve();
      return;
    }
    if (platform === 'twitch' && (window as any).Twitch) {
      resolve();
      return;
    }

    if (callbackName) {
      const prevCallback = (window as any)[callbackName];
      (window as any)[callbackName] = () => {
        if (prevCallback) prevCallback();
        resolve();
      };
    }

    const tag = document.createElement('script');
    tag.src = src;
    if (!callbackName) {
      tag.onload = () => resolve();
    }
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
  });

  return scriptLoadPromises[platform];
}

interface AbstractPlayer {
  play(): void;
  pause(): void;
  seekTo(seconds: number): void;
  getCurrentTime(): Promise<number> | number;
  getPlayerState(): Promise<number> | number;
  destroy(): void;
}

function createWrappedPlayer(
  platform: string,
  elementId: string,
  videoId: string,
  isPresenter: boolean,
  isLive: boolean,
  onStateChange: (playing: boolean, time: number) => void
): Promise<AbstractPlayer> {
  if (platform === 'youtube') {
    return loadPlatformScript('youtube', 'https://www.youtube.com/iframe_api', 'onYouTubeIframeAPIReady').then(() => {
      return new Promise<AbstractPlayer>((resolve) => {
        const player = new (window as any).YT.Player(elementId, {
          videoId: videoId,
          playerVars: {
            autoplay: 1,
            controls: isPresenter ? 1 : 0,
            disablekb: isPresenter ? 0 : 1,
            rel: 0,
            modestbranding: 1
          },
          events: {
            onReady: () => {
              resolve({
                play: () => player.playVideo(),
                pause: () => player.pauseVideo(),
                seekTo: (sec) => player.seekTo(sec, true),
                getCurrentTime: () => player.getCurrentTime() || 0,
                getPlayerState: () => {
                  const s = player.getPlayerState();
                  return s === 1 ? 1 : 2;
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
              const time = player.getCurrentTime() || 0;
              onStateChange(state === 1, time);
            }
          }
        });
      });
    });
  }

  if (platform === 'vimeo') {
    return loadPlatformScript('vimeo', 'https://player.vimeo.com/api/player.js').then(() => {
      const container = document.getElementById(elementId);
      if (!container) throw new Error("Vimeo container not found");
      container.innerHTML = '';
      
      const iframe = document.createElement('iframe');
      iframe.src = `https://player.vimeo.com/video/${videoId}?autoplay=1&background=${isPresenter ? 0 : 1}&muted=${isPresenter ? 0 : 1}`;
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = 'none';
      container.appendChild(iframe);

      const player = new (window as any).Vimeo.Player(iframe);
      
      return new Promise<AbstractPlayer>((resolve) => {
        player.ready().then(() => {
          if (isPresenter) {
            player.on('play', async () => {
              const time = await player.getCurrentTime();
              onStateChange(true, time);
            });
            player.on('pause', async () => {
              const time = await player.getCurrentTime();
              onStateChange(false, time);
            });
            player.on('seeked', async () => {
              const time = await player.getCurrentTime();
              onStateChange(true, time);
            });
          }

          resolve({
            play: () => player.play().catch(() => {}),
            pause: () => player.pause().catch(() => {}),
            seekTo: (sec) => player.setCurrentTime(sec).catch(() => {}),
            getCurrentTime: () => player.getCurrentTime().catch(() => 0),
            getPlayerState: async () => {
              const paused = await player.getPaused().catch(() => true);
              return paused ? 2 : 1;
            },
            destroy: () => {
              try {
                player.unload();
              } catch (e) {}
            }
          });
        });
      });
    });
  }

  if (platform === 'dailymotion') {
    return loadPlatformScript('dailymotion', 'https://api.dmcdn.net/all.js').then(() => {
      const container = document.getElementById(elementId);
      if (!container) throw new Error("Dailymotion container not found");
      container.innerHTML = '';

      const playerDiv = document.createElement('div');
      playerDiv.id = `dm-player-inner-${Math.random().toString(36).substring(2, 9)}`;
      playerDiv.style.width = '100%';
      playerDiv.style.height = '100%';
      container.appendChild(playerDiv);

      const player = (window as any).DM.player(playerDiv, {
        video: videoId,
        width: '100%',
        height: '100%',
        params: {
          autoplay: true,
          controls: isPresenter,
          mute: !isPresenter
        }
      });

      return new Promise<AbstractPlayer>((resolve) => {
        player.addEventListener('apiready', () => {
          if (isPresenter) {
            player.addEventListener('play', () => {
              onStateChange(true, player.currentTime);
            });
            player.addEventListener('pause', () => {
              onStateChange(false, player.currentTime);
            });
            player.addEventListener('seeked', () => {
              onStateChange(true, player.currentTime);
            });
          }

          resolve({
            play: () => player.play(),
            pause: () => player.pause(),
            seekTo: (sec) => player.seek(sec),
            getCurrentTime: () => player.currentTime || 0,
            getPlayerState: () => player.paused ? 2 : 1,
            destroy: () => {
              container.innerHTML = '';
            }
          });
        });
      });
    });
  }

  if (platform === 'twitch') {
    return loadPlatformScript('twitch', 'https://embed.twitch.tv/v1/twitch.js').then(() => {
      const container = document.getElementById(elementId);
      if (!container) throw new Error("Twitch container not found");
      container.innerHTML = '';

      const options: any = {
        width: '100%',
        height: '100%',
        autoplay: true,
        muted: !isPresenter,
        controls: isPresenter
      };

      if (isLive) {
        options.channel = videoId;
      } else {
        options.video = videoId;
      }

      const player = new (window as any).Twitch.Player(elementId, options);

      return new Promise<AbstractPlayer>((resolve) => {
        player.addEventListener((window as any).Twitch.Player.READY, () => {
          if (isPresenter && !isLive) {
            player.addEventListener((window as any).Twitch.Player.PLAY, () => {
              onStateChange(true, player.getCurrentTime());
            });
            player.addEventListener((window as any).Twitch.Player.PAUSE, () => {
              onStateChange(false, player.getCurrentTime());
            });
          }

          resolve({
            play: () => player.play(),
            pause: () => player.pause(),
            seekTo: (sec) => {
              if (!isLive) player.seek(sec);
            },
            getCurrentTime: () => isLive ? 0 : player.getCurrentTime(),
            getPlayerState: () => player.isPaused() ? 2 : 1,
            destroy: () => {
              container.innerHTML = '';
            }
          });
        });
      });
    });
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

function UniversalVideoPlayer({ 
  videoId, 
  platform,
  isLive,
  isPresenter, 
  presenterId,
  roomId,
  myId
}: { 
  videoId: string; 
  platform: 'youtube' | 'vimeo' | 'dailymotion' | 'twitch';
  isLive: boolean;
  isPresenter: boolean; 
  presenterId: string;
  roomId: string;
  myId: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<AbstractPlayer | null>(null);
  const isLocalChangeRef = useRef(false);

  useEffect(() => {
    let active = true;
    const divId = `media-player-${Math.random().toString(36).substring(2, 9)}`;

    if (containerRef.current) {
      const targetDiv = document.createElement('div');
      targetDiv.id = divId;
      targetDiv.style.width = '100%';
      targetDiv.style.height = '100%';
      containerRef.current.innerHTML = '';
      containerRef.current.appendChild(targetDiv);
    }

    createWrappedPlayer(
      platform,
      divId,
      videoId,
      isPresenter,
      isLive,
      (playing, time) => {
        if (!isPresenter || isLive) return;
        if (!isLocalChangeRef.current) {
          updateFirestorePlaybackState(playing, time);
        }
      }
    ).then((wrappedPlayer) => {
      if (!active) {
        wrappedPlayer.destroy();
        return;
      }
      playerRef.current = wrappedPlayer;
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

  const updateFirestorePlaybackState = async (playing: boolean, time: number) => {
    try {
      await updateDoc(doc(db, 'rooms', roomId, 'participants', myId), {
        ytPlaying: playing,
        ytTime: time,
        ytUpdateTimestamp: Date.now()
      });
    } catch (e) {
      console.warn("Failed to update media playback in Firestore:", e);
    }
  };

  useEffect(() => {
    if (!isPresenter || isLive) return;

    const interval = setInterval(async () => {
      if (playerRef.current) {
        try {
          const state = await playerRef.current.getPlayerState();
          const time = await playerRef.current.getCurrentTime();
          if (state === 1) {
            updateFirestorePlaybackState(true, time);
          }
        } catch (e) {}
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isPresenter, isLive]);

  useEffect(() => {
    if (isPresenter || isLive) return;

    const partRef = doc(db, 'rooms', roomId, 'participants', presenterId);
    const unsubscribe = onSnapshot(partRef, async (snapshot) => {
      if (!snapshot.exists() || !playerRef.current) return;
      
      const data = snapshot.data();
      const targetPlaying = data.ytPlaying ?? false;
      const targetTime = data.ytTime ?? 0;
      const targetTimestamp = data.ytUpdateTimestamp ?? Date.now();
      
      let correctedTime = targetTime;
      if (targetPlaying && targetTimestamp) {
        const elapsedSeconds = (Date.now() - targetTimestamp) / 1000;
        correctedTime += elapsedSeconds;
      }

      isLocalChangeRef.current = true;

      try {
        const currentState = await playerRef.current.getPlayerState();
        if (targetPlaying && currentState !== 1) {
          playerRef.current.play();
        } else if (!targetPlaying && currentState === 1) {
          playerRef.current.pause();
        }

        const currentTime = await playerRef.current.getCurrentTime();
        if (Math.abs(currentTime - correctedTime) > 2) {
          playerRef.current.seekTo(correctedTime);
        }
      } catch (e) {}

      isLocalChangeRef.current = false;
    });

    return () => unsubscribe();
  }, [isPresenter, presenterId, roomId, isLive]);

  return (
    <div 
      ref={containerRef} 
      style={{ 
        width: '100%', 
        height: '100%', 
        position: 'relative', 
        borderRadius: 'var(--border-radius)', 
        overflow: 'hidden',
        backgroundColor: '#000'
      }} 
    />
  );
}

function DeviceRecoveryManager({ 
  isCamOff, 
  isMicMuted,
  onErrorChange 
}: { 
  isCamOff: boolean; 
  isMicMuted: boolean;
  onErrorChange: (camErr: boolean, micErr: boolean) => void;
}) {
  const { localParticipant } = useLocalParticipant();

  useEffect(() => {
    if (!localParticipant) return;

    let currentCamErr = false;
    let currentMicErr = false;
    const reportErrors = () => onErrorChange(currentCamErr, currentMicErr);

    // Sync active enabled states dynamically with local participant tracks
    localParticipant.setCameraEnabled(!isCamOff).catch((err) => {
      console.warn("Failed to sync camera state", err);
      currentCamErr = true;
      reportErrors();
    });
    localParticipant.setMicrophoneEnabled(!isMicMuted).catch((err) => {
      console.warn("Failed to sync mic state", err);
      currentMicErr = true;
      reportErrors();
    });

    const handleCameraRecovery = async () => {
      if (isCamOff) {
        currentCamErr = false;
        reportErrors();
        return;
      }
      try {
        await localParticipant.setCameraEnabled(true);
        currentCamErr = false;
        reportErrors();
      } catch (err) {
        console.warn("Camera auto-recovery failed", err);
        currentCamErr = true;
        reportErrors();
      }
    };

    const handleMicRecovery = async () => {
      if (isMicMuted) {
        currentMicErr = false;
        reportErrors();
        return;
      }
      try {
        await localParticipant.setMicrophoneEnabled(true);
        currentMicErr = false;
        reportErrors();
      } catch (err) {
        console.warn("Mic auto-recovery failed", err);
        currentMicErr = true;
        reportErrors();
      }
    };

    // 1. Permissions API listener
    const setupPermissions = async () => {
      try {
        const camStatus = await navigator.permissions.query({ name: 'camera' as PermissionName });
        camStatus.onchange = () => {
          if (camStatus.state === 'granted') handleCameraRecovery();
        };
      } catch (e) { /* ignore */ }

      try {
        const micStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        micStatus.onchange = () => {
          if (micStatus.state === 'granted') handleMicRecovery();
        };
      } catch (e) { /* ignore */ }
    };

    setupPermissions();

    // 2. Track onended listener
    const checkTracks = () => {
      const camTrack = localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack?.mediaStreamTrack;
      if (camTrack) {
        camTrack.onended = () => {
          console.warn("Camera track unexpectedly ended (hardware switch?)");
          handleCameraRecovery();
        };
        if (currentCamErr) {
          currentCamErr = false;
          reportErrors();
        }
      }

      const micTrack = localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack?.mediaStreamTrack;
      if (micTrack) {
        micTrack.onended = () => {
          console.warn("Mic track unexpectedly ended");
          handleMicRecovery();
        };
        if (currentMicErr) {
          currentMicErr = false;
          reportErrors();
        }
      }
    };

    checkTracks();

    const onMediaError = async (error: Error) => {
      console.warn("Media devices error:", error);
      const errMsg = (error?.message || '').toLowerCase();
      const errName = (error?.name || '').toLowerCase();
      const errKind = (error as any).kind || '';

      const isAudio = errKind === 'audio' || 
                      errMsg.includes('audio') || 
                      errMsg.includes('mic') || 
                      errMsg.includes('microphone') || 
                      errName.includes('audio') || 
                      errName.includes('mic') ||
                      errName.includes('input');
                      
      const isVideo = errKind === 'video' || 
                      errMsg.includes('video') || 
                      errMsg.includes('camera') || 
                      errMsg.includes('cam') || 
                      errName.includes('video') || 
                      errName.includes('camera');

      if (isAudio && !isVideo) {
        currentMicErr = true;
        reportErrors();
        return;
      } 
      
      if (isVideo && !isAudio) {
        currentCamErr = true;
        reportErrors();
        return;
      }

      // Fallback for generic/combined error events (e.g. NotAllowedError / Permission denied)
      let micDenied = false;
      let camDenied = false;
      try {
        const micPerm = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        if (micPerm.state === 'denied') micDenied = true;
      } catch (e) {}
      try {
        const camPerm = await navigator.permissions.query({ name: 'camera' as PermissionName });
        if (camPerm.state === 'denied') camDenied = true;
      } catch (e) {}

      if (camDenied) {
        currentCamErr = true;
      }
      if (micDenied) {
        currentMicErr = true;
      }

      // If neither is explicitly blocked, fallback only if the requested track is missing
      if (!micDenied && !camDenied) {
        const hasVideoTrack = !!localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack;
        if (!isCamOff && !hasVideoTrack) {
          currentCamErr = true;
        }
        const hasAudioTrack = !!localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
        if (!isMicMuted && !hasAudioTrack) {
          currentMicErr = true;
        }
      }
      reportErrors();
    };
    
    localParticipant.on(ParticipantEvent.LocalTrackPublished, checkTracks);
    localParticipant.on(ParticipantEvent.LocalTrackUnpublished, checkTracks);
    localParticipant.on(ParticipantEvent.MediaDevicesError, onMediaError);

    const onRetryDevice = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail === 'camera') handleCameraRecovery();
      if (customEvent.detail === 'mic') handleMicRecovery();
    };
    window.addEventListener('retry-device', onRetryDevice);
    
    return () => {
      localParticipant.off(ParticipantEvent.LocalTrackPublished, checkTracks);
      localParticipant.off(ParticipantEvent.LocalTrackUnpublished, checkTracks);
      localParticipant.off(ParticipantEvent.MediaDevicesError, onMediaError);
      window.removeEventListener('retry-device', onRetryDevice);
    };
  }, [localParticipant, isCamOff, isMicMuted, onErrorChange]);

  return null;
}

// Export the global app wrapper
export default function App() {
  return <AppContent />;
}

const truthQuestions = [
  "What is your biggest fear when it comes to exams?",
  "Have you ever cheated on a test? If so, did you get caught?",
  "What is the most embarrassing thing that happened to you in class?",
  "What subject do you secretly enjoy but pretend to dislike?",
  "What is your worst study habit that you want to break?",
  "Who was your favorite teacher and why?",
  "Have you ever fallen asleep in a class? Tell us the story.",
  "What is the longest time you've spent studying without sleeping?",
  "What is the most useless piece of trivia you know?",
  "If you could delete one academic subject from existence, what would it be?",
  "What is your dream job that you are too afraid to pursue?",
  "What was your worst grade ever, and what was the subject?",
  "Have you ever lied about your grades to your parents?",
  "What is the weirdest study snack you have ever eaten?",
  "If you could swap lives with any classmate for a day, who would it be and why?",
  "What is the most productive thing you did while procrastinating?",
  "What is your secret talent that nobody in this call knows about?",
  "Have you ever pretended to be sick to skip school/college?",
  "If you could have any superpower to help you study, what would it be?",
  "What is the most awkward text you sent to a study group by mistake?"
];

const dareQuestions = [
  "Sing a line of your favorite song out loud right now.",
  "Do 10 jumping jacks while keeping your microphone unmuted.",
  "Show the group the last photo you took on your phone.",
  "Draw a quick portrait of someone in the call and show it to the camera.",
  "Speak in a dramatic whisper for the next three turns.",
  "Balance a book on your head for the next 5 minutes without dropping it.",
  "Tell a really bad dad joke to the group.",
  "Show the group your most recently used emojis.",
  "Read the last text message you received out loud.",
  "Imitate your favorite teacher or professor for 15 seconds.",
  "Make a funny face and hold it for 10 seconds.",
  "Give a 30-second passionate speech about why pineapple belongs (or doesn't belong) on pizza.",
  "Do a quick 15-second dance move on camera.",
  "Speak in a different accent (e.g. British, Australian, etc.) for the next 2 minutes.",
  "Try to touch your nose with your tongue.",
  "Let the host/co-host choose a word that you must use in every sentence you speak for the next 3 minutes.",
  "Keep your hands on your head for the next 3 minutes.",
  "Spell your full name backwards as fast as you can.",
  "Act like a robot introducing themselves.",
  "Open your window (or door) and yell 'I love studying!' out loud."
];

interface PipWindowContentProps {
  myId: string;
  isMicMuted: boolean;
  isCamOff: boolean;
  toggleMic: () => void;
  toggleCamera: () => void;
  toggleMiniMode: () => void;
  handleLeaveCall: () => void;
  miniModeTab: 'call' | 'tool' | 'chat';
  setMiniModeTab: (tab: 'call' | 'tool' | 'chat') => void;
  expandedTool: 'none' | 'pomodoro' | 'deadline' | 'loose' | 'truthordare' | 'spin';
  setExpandedTool: (tool: 'none' | 'pomodoro' | 'deadline' | 'loose' | 'truthordare' | 'spin') => void;
  callParticipants: Participant[];
  pomodoroPhase: string;
  pomodoroMinutes: number;
  pomodoroSeconds: number;
  pomodoroIsRunning: boolean;
  togglePomodoro: () => void;
  deadlineSteps: any[];
  deadlineActiveIndex: number;
  deadlineTimerMinutes: number;
  deadlineTimerSeconds: number;
  deadlineIsRunning: boolean;
  setDeadlineIsRunning: (val: boolean) => void;
  looseSteps: any[];
  looseActiveIndex: number;
  looseTimerSeconds: number;
  looseIsRunning: boolean;
  setLooseIsRunning: (val: boolean) => void;
  spinResult: any;
  handleSpinWheel: () => void;
  todSelectedId: string;
  todChoice: string | null;
  todText: string;
  unreadChatCount: number;
  chatMessages: ChatMessage[];
  systemMessages: any[];
  sendChatMessage: (text: string) => Promise<void>;
}

function PipWindowContent({
  myId,
  isMicMuted,
  isCamOff,
  toggleMic,
  toggleCamera,
  toggleMiniMode,
  handleLeaveCall,
  miniModeTab,
  setMiniModeTab,
  expandedTool,
  setExpandedTool,
  callParticipants,
  pomodoroPhase,
  pomodoroMinutes,
  pomodoroSeconds,
  pomodoroIsRunning,
  togglePomodoro,
  deadlineSteps,
  deadlineActiveIndex,
  deadlineTimerMinutes,
  deadlineTimerSeconds,
  deadlineIsRunning,
  setDeadlineIsRunning,
  looseSteps,
  looseActiveIndex,
  looseTimerSeconds,
  looseIsRunning,
  setLooseIsRunning,
  spinResult,
  handleSpinWheel,
  todSelectedId,
  todChoice,
  todText,
  unreadChatCount,
  chatMessages,
  systemMessages,
  sendChatMessage
}: PipWindowContentProps) {
  const remoteParticipants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const allLkParticipants = [localParticipant, ...remoteParticipants].filter(Boolean);

  const lkActiveParticipants = allLkParticipants.map(lkPart => {
    const meta = callParticipants.find(p => p.id === lkPart.identity);
    return {
      lkPart,
      id: lkPart.identity,
      name: meta?.name || lkPart.name || lkPart.identity,
      initials: meta?.initials || 'U',
      color: meta?.color || '#8b5cf6',
      photoURL: meta?.photoURL,
      role: meta?.role || 'member',
      sharing: meta?.sharing || null,
      isSpeaking: lkPart.isSpeaking,
      isCamOn: lkPart.isCameraEnabled,
      isMicMuted: !lkPart.isMicrophoneEnabled,
    };
  });

  const hasOthers = lkActiveParticipants.length > 1;

  const getParticipantScore = (p: any) => {
    const isMe = p.id === myId;

    if (isMe && hasOthers) {
      return 0; // demote local user to bottom fallback
    }

    if (p.isSpeaking && !p.isMicMuted) {
      return 100;
    }
    if (p.sharing && p.sharing !== 'none') {
      return 90;
    }
    if (p.role === 'host') {
      return 80;
    }
    if (p.role === 'cohost') {
      return 70;
    }
    if (p.role === 'admin') {
      return 60;
    }
    if (p.isCamOn) {
      return 50;
    }
    return 20;
  };

  const sorted = [...lkActiveParticipants].sort((a, b) => {
    const scoreA = getParticipantScore(a);
    const scoreB = getParticipantScore(b);
    if (scoreA !== scoreB) {
      return scoreB - scoreA;
    }
    return a.id.localeCompare(b.id);
  });

  const activeSpeaker = sorted[0];
  const activeSpeakerCamOff = activeSpeaker ? !activeSpeaker.isCamOn : true;
  const activeSpeakerMicMuted = activeSpeaker ? activeSpeaker.isMicMuted : true;

  const showToolView = miniModeTab === 'tool' && expandedTool !== 'none';

  const combinedMessages = [
    ...chatMessages.map(m => ({ ...m, type: 'chat' as const })),
    ...systemMessages.map(m => ({ ...m, type: 'system' as const }))
  ].sort((a, b) => {
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return timeA - timeB;
  });

  const pipChatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (miniModeTab === 'chat' && pipChatEndRef.current) {
      pipChatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [combinedMessages.length, miniModeTab]);

  return (
    <div className="skulk-pip-window" style={{ 
      width: '100vw', 
      height: '100vh', 
      display: 'flex', 
      flexDirection: 'column', 
      backgroundColor: '#0f1013', 
      color: '#ffffff', 
      fontFamily: 'Inter, system-ui, sans-serif',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Top Switcher Bar */}
      <div style={{
        display: 'flex',
        backgroundColor: '#16181d',
        borderBottom: '1px solid #2d3139',
        height: '32px',
        alignItems: 'center',
        padding: '0 8px',
        gap: '4px',
        flexShrink: 0
      }}>
        <button 
          onClick={() => setMiniModeTab('call')}
          style={{
            flex: 1,
            height: '24px',
            backgroundColor: miniModeTab === 'call' ? '#2d3139' : 'transparent',
            border: 'none',
            borderRadius: '4px',
            color: miniModeTab === 'call' ? '#f1c40f' : '#94a3b8',
            fontSize: '11px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px'
          }}
        >
          <span>📞 Call</span>
        </button>

        <button 
          onClick={() => setMiniModeTab('chat')}
          style={{
            flex: 1,
            height: '24px',
            backgroundColor: miniModeTab === 'chat' ? '#2d3139' : 'transparent',
            border: 'none',
            borderRadius: '4px',
            color: miniModeTab === 'chat' ? '#f1c40f' : '#94a3b8',
            fontSize: '11px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            gap: '4px'
          }}
        >
          <span>💬 Chat</span>
          {unreadChatCount > 0 && (
            <span style={{
              width: '6px',
              height: '6px',
              backgroundColor: '#ef4444',
              borderRadius: '50%',
              display: 'inline-block'
            }} />
          )}
        </button>

        <button 
          onClick={() => {
            if (expandedTool !== 'none') {
              setMiniModeTab('tool');
            }
          }}
          disabled={expandedTool === 'none'}
          style={{
            flex: 1,
            height: '24px',
            backgroundColor: miniModeTab === 'tool' ? '#2d3139' : 'transparent',
            border: 'none',
            borderRadius: '4px',
            color: expandedTool === 'none' 
              ? 'rgba(255, 255, 255, 0.15)' 
              : miniModeTab === 'tool' 
                ? '#f1c40f' 
                : '#94a3b8',
            fontSize: '11px',
            fontWeight: 600,
            cursor: expandedTool === 'none' ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px'
          }}
        >
          <span>⚙️ Tool</span>
        </button>
      </div>

      {/* Main Viewport Content Area */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {miniModeTab === 'chat' ? (
          /* Chat View */
          <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {combinedMessages.length === 0 ? (
                <div style={{ textAlign: 'center', fontSize: '11px', color: '#94a3b8', marginTop: '20px', fontStyle: 'italic' }}>
                  No messages yet.
                </div>
              ) : (
                combinedMessages.map((msg) => {
                  if (msg.type === 'system') {
                    return (
                      <div key={msg.id} style={{ textAlign: 'center', fontSize: '10px', color: '#94a3b8', fontStyle: 'italic', padding: '2px 0' }}>
                        {msg.text}
                      </div>
                    );
                  }
                  const isMe = msg.senderId === myId || msg.sender === 'You';
                  return (
                    <div 
                      key={msg.id} 
                      style={{ 
                        display: 'flex', 
                        flexDirection: 'column', 
                        gap: '2px', 
                        backgroundColor: isMe ? 'rgba(241, 196, 15, 0.08)' : 'rgba(255,255,255,0.03)', 
                        padding: '6px 8px', 
                        borderRadius: '4px',
                        borderLeft: isMe ? '2px solid #f1c40f' : '2px solid transparent'
                      }}
                    >
                      <span style={{ fontSize: '10px', fontWeight: 700, color: isMe ? '#f1c40f' : '#94a3b8' }}>{msg.sender}</span>
                      <span style={{ fontSize: '11px', color: '#e2e8f0', wordBreak: 'break-word', marginTop: '1px' }}>{msg.text}</span>
                    </div>
                  );
                })
              )}
              <div ref={pipChatEndRef} />
            </div>
            <form 
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const input = form.elements.namedItem('pipChatInput') as HTMLInputElement;
                if (input && input.value.trim()) {
                  sendChatMessage(input.value);
                  input.value = '';
                }
              }}
              style={{
                display: 'flex',
                padding: '4px',
                backgroundColor: '#16181d',
                borderTop: '1px solid #2d3139',
                gap: '4px',
                flexShrink: 0
              }}
            >
              <input 
                name="pipChatInput"
                type="text" 
                placeholder="Message..." 
                autoComplete="off"
                style={{
                  flex: 1,
                  height: '24px',
                  backgroundColor: '#2d3139',
                  border: 'none',
                  borderRadius: '4px',
                  color: '#ffffff',
                  fontSize: '11px',
                  padding: '0 8px',
                  outline: 'none'
                }}
              />
              <button 
                type="submit"
                style={{
                  backgroundColor: '#f1c40f',
                  border: 'none',
                  borderRadius: '4px',
                  color: '#0f1013',
                  fontSize: '10px',
                  fontWeight: 'bold',
                  padding: '0 8px',
                  height: '24px',
                  cursor: 'pointer'
                }}
              >
                Send
              </button>
            </form>
          </div>
        ) : !showToolView ? (
          /* Call View */
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
            {activeSpeaker && !activeSpeakerCamOff ? (
              <ParticipantVideo participantId={activeSpeaker.id} />
            ) : (
              <div style={{
                width: '72px',
                height: '72px',
                borderRadius: '50%',
                backgroundColor: activeSpeaker?.color || '#8b5cf6',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '24px',
                fontWeight: 'bold',
                color: '#ffffff'
              }}>
                {activeSpeaker?.photoURL ? (
                  <img 
                    src={activeSpeaker.photoURL} 
                    alt={activeSpeaker.name} 
                    style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
                  />
                ) : (
                  activeSpeaker?.initials || 'S'
                )}
              </div>
            )}

            {/* Overlay nametag */}
            <div style={{
              position: 'absolute',
              bottom: '10px',
              left: '10px',
              backgroundColor: 'rgba(15, 16, 19, 0.75)',
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              zIndex: 10
            }}>
              <span>{activeSpeaker?.name || 'User'}</span>
              {activeSpeakerMicMuted && (
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="1" y1="1" x2="23" y2="23"></line>
                  <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
                  <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
                </svg>
              )}
            </div>
          </div>
        ) : (
          /* Tool View */
          <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '10px', boxSizing: 'border-box' }}>
            {expandedTool === 'pomodoro' && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <span style={{ fontSize: '10px', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 800 }}>
                  ⏱️ {pomodoroPhase === 'focus' ? 'Focus Phase' : 'Break Phase'}
                </span>
                <span style={{ fontSize: '28px', fontWeight: 800, fontFamily: 'monospace', color: '#ffffff', lineHeight: 1 }}>
                  {pomodoroMinutes.toString().padStart(2, '0')}:{pomodoroSeconds.toString().padStart(2, '0')}
                </span>
                <button 
                  onClick={togglePomodoro} 
                  style={{
                    padding: '4px 12px',
                    fontSize: '11px',
                    backgroundColor: '#2d3139',
                    border: '1px solid #475569',
                    borderRadius: '4px',
                    color: '#ffffff',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                >
                  {pomodoroIsRunning ? 'Pause' : 'Start'}
                </button>
              </div>
            )}

            {expandedTool === 'deadline' && (() => {
              const currentStep = deadlineSteps[deadlineActiveIndex];
              const stepName = currentStep ? `${deadlineActiveIndex + 1}. ${currentStep.name}` : 'No steps';
              return (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '6px', textAlign: 'center' }}>
                  <span 
                    style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '240px' }}
                    title={stepName}
                  >
                    ⏳ {stepName}
                  </span>
                  <span style={{ fontSize: '24px', fontWeight: 800, fontFamily: 'monospace', color: '#ffffff', lineHeight: 1 }}>
                    {deadlineTimerMinutes.toString().padStart(2, '0')}:{deadlineTimerSeconds.toString().padStart(2, '0')}
                  </span>
                  <button 
                    onClick={() => setDeadlineIsRunning(!deadlineIsRunning)} 
                    style={{
                      padding: '4px 12px',
                      fontSize: '11px',
                      backgroundColor: '#2d3139',
                      border: '1px solid #475569',
                      borderRadius: '4px',
                      color: '#ffffff',
                      cursor: 'pointer',
                      fontWeight: 600
                    }}
                  >
                    {deadlineIsRunning ? 'Pause' : 'Start'}
                  </button>
                </div>
              );
            })()}

            {expandedTool === 'loose' && (() => {
              const currentStep = looseSteps[looseActiveIndex];
              const stepName = currentStep ? `${looseActiveIndex + 1}. ${currentStep.name}` : 'No steps';
              return (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '6px', textAlign: 'center' }}>
                  <span 
                    style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '240px' }}
                    title={stepName}
                  >
                    🔄 {stepName}
                  </span>
                  <span style={{ fontSize: '24px', fontWeight: 800, fontFamily: 'monospace', color: '#ffffff', lineHeight: 1 }}>
                    {Math.floor(looseTimerSeconds / 60).toString().padStart(2, '0')}:{Math.floor(looseTimerSeconds % 60).toString().padStart(2, '0')}
                  </span>
                  <button 
                    onClick={() => setLooseIsRunning(!looseIsRunning)} 
                    style={{
                      padding: '4px 12px',
                      fontSize: '11px',
                      backgroundColor: '#2d3139',
                      border: '1px solid #475569',
                      borderRadius: '4px',
                      color: '#ffffff',
                      cursor: 'pointer',
                      fontWeight: 600
                    }}
                  >
                    {looseIsRunning ? 'Pause' : 'Start'}
                  </button>
                </div>
              );
            })()}

            {expandedTool === 'spin' && (() => {
              const lastSelectedName = spinResult 
                ? (callParticipants.find(p => p.id === spinResult.selectedId)?.name.replace(' (You)', '') || 'Participant') 
                : null;
              return (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 800 }}>
                    🎡 {lastSelectedName ? `Landed on: ${lastSelectedName}` : 'Ready to spin'}
                  </span>
                  <button 
                    onClick={() => {
                      toggleMiniMode();
                      setExpandedTool('spin');
                      handleSpinWheel();
                    }} 
                    style={{
                      padding: '6px 14px',
                      fontSize: '11px',
                      backgroundColor: 'var(--primary-color, #f1c40f)',
                      color: '#0f1013',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontWeight: 700
                    }}
                  >
                    Spin Wheel (Full)
                  </button>
                </div>
              );
            })()}

            {expandedTool === 'truthordare' && (() => {
              const selectedUser = callParticipants.find(p => p.id === todSelectedId);
              const titleText = selectedUser && todChoice ? `${selectedUser.name.replace(' (You)', '')} — ${todChoice}` : 'No turn active';
              return (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '6px', textAlign: 'center' }}>
                  <span style={{ fontSize: '10px', color: 'var(--primary-color, #f1c40f)', fontWeight: 800 }}>
                    🎲 {titleText}
                  </span>
                  <span style={{ fontSize: '11px', color: '#ffffff', fontStyle: 'italic', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.3, maxWidth: '240px' }}>
                    {todText ? `"${todText}"` : 'No prompt active.'}
                  </span>
                  <button 
                    onClick={() => {
                      toggleMiniMode();
                      setExpandedTool('truthordare');
                    }}
                    style={{
                      padding: '4px 10px',
                      fontSize: '10px',
                      backgroundColor: '#2d3139',
                      border: '1px solid #475569',
                      borderRadius: '4px',
                      color: '#ffffff',
                      cursor: 'pointer',
                      fontWeight: 600,
                      marginTop: '4px'
                    }}
                  >
                    Expand Game
                  </button>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Small bottom action controls bar */}
      <div style={{
        height: '40px',
        backgroundColor: '#16181d',
        borderTop: '1px solid #2d3139',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        flexShrink: 0,
        zIndex: 20
      }}>
        {/* Mute Mic control */}
        <button 
          onClick={toggleMic}
          style={{
            background: isMicMuted ? '#ef4444' : '#2d3139',
            border: 'none',
            borderRadius: '4px',
            color: '#ffffff',
            width: '28px',
            height: '28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer'
          }}
          title={isMicMuted ? 'Unmute microphone' : 'Mute microphone'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            {isMicMuted ? (
              <>
                <line x1="1" y1="1" x2="23" y2="23"></line>
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
              </>
            ) : (
              <>
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                <line x1="12" y1="19" x2="12" y2="23"></line>
              </>
            )}
          </svg>
        </button>

        {/* Camera toggle control */}
        <button 
          onClick={toggleCamera}
          style={{
            background: isCamOff ? '#ef4444' : '#2d3139',
            border: 'none',
            borderRadius: '4px',
            color: '#ffffff',
            width: '28px',
            height: '28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer'
          }}
          title={isCamOff ? 'Turn camera on' : 'Turn camera off'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            {isCamOff ? (
              <>
                <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10l-2.18-1.63"></path>
                <line x1="1" y1="1" x2="23" y2="23"></line>
              </>
            ) : (
              <>
                <path d="M23 7l-7 5 7 5V7z"></path>
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
              </>
            )}
          </svg>
        </button>

        {/* Restore / Expand to original size */}
        <button 
          onClick={toggleMiniMode}
          style={{
            background: '#2d3139',
            border: 'none',
            borderRadius: '4px',
            color: '#ffffff',
            width: '28px',
            height: '28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer'
          }}
          title="Return to full view"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9"></polyline>
            <polyline points="9 21 3 21 3 15"></polyline>
            <line x1="21" y1="3" x2="14" y2="10"></line>
            <line x1="3" y1="21" x2="10" y2="14"></line>
          </svg>
        </button>

        {/* Leave the call entirely */}
        <button 
          onClick={() => {
            handleLeaveCall();
            toggleMiniMode();
          }}
          style={{
            background: '#ef4444',
            border: 'none',
            borderRadius: '4px',
            color: '#ffffff',
            padding: '0 8px',
            height: '28px',
            fontSize: '11px',
            fontWeight: 'bold',
            cursor: 'pointer'
          }}
          title="Leave room call"
        >
          Leave
        </button>
      </div>
    </div>
  );
}

let globalPendingLeavePromise: Promise<void> | null = null;
function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();

  // Helper to extract room ID from pathname since useParams() is empty at App level
  const getRoomIdFromPath = (path: string) => {
    const match = path.match(/^\/room\/([^/]+)/);
    return match ? match[1] : undefined;
  };
  const roomId = getRoomIdFromPath(location.pathname);

  // Firebase auth state
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
  const userDropdownRef = useRef<HTMLDivElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'rooms' | 'community'>('rooms');
  
  // Real-time rooms state list
  const [rooms, setRooms] = useState<Room[]>([]);
  // Map of participant lists for rooms: room.id -> Participant[]
  const [roomsParticipants, setRoomsParticipants] = useState<Record<string, any[]>>({});

  // Persistent Guest ID
  const [guestId, setGuestId] = useState<string>('');
  // Load local rooms from localStorage as a fallback when Firestore is blocked
  const getLocalRooms = (): Room[] => {
    try {
      const stored = localStorage.getItem('skulk_local_rooms');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  };

  const saveLocalRoom = (room: Room) => {
    try {
      const existing = getLocalRooms();
      if (!existing.some(r => r.id === room.id)) {
        localStorage.setItem('skulk_local_rooms', JSON.stringify([...existing, room]));
      }
    } catch (e) {
      console.error('Failed to save room to localStorage:', e);
    }
  };
  // Load and synchronize rooms list from Firestore in real time
  useEffect(() => {
    const roomsRef = collection(db, 'rooms');
    
    const unsubscribe = onSnapshot(roomsRef, async (snapshot) => {
      if (snapshot.empty) {
        setRooms(getLocalRooms());
      } else {
        const list: Room[] = [];
        snapshot.forEach(doc => {
          list.push({ id: doc.id, ...doc.data() } as Room);
        });
        // Sort client-side by effective start time (createdAt for instant, scheduledDate/Time for scheduled)
        list.sort((a, b) => {
          const now = Date.now();
          
          const getStartTime = (r: Room) => {
            if (r.scheduledDate && r.scheduledTime) {
              try {
                const dt = new Date(`${r.scheduledDate}T${r.scheduledTime}`);
                if (!isNaN(dt.getTime())) return dt.getTime();
              } catch (e) {}
            }
            return r.createdAt ? new Date(r.createdAt).getTime() : 0;
          };

          const startA = getStartTime(a);
          const startB = getStartTime(b);

          const isFutureA = startA > now;
          const isFutureB = startB > now;

          if (isFutureA && !isFutureB) return 1;  // Future goes after past/live
          if (!isFutureA && isFutureB) return -1; // Past/live goes before future

          if (isFutureA && isFutureB) {
            // Both are future: sort ascending (soonest first)
            return startA - startB;
          } else {
            // Both are past/live: sort descending (most recent first)
            return startB - startA;
          }
        });
        // Merge Firestore rooms with local rooms to make sure local creations are also visible on refresh!
        const local = getLocalRooms();
        const merged = [...list];
        const updatedLocal = [...local];
        
        local.forEach(r => {
          if (!list.some(m => m.id === r.id)) {
            // Remove from updatedLocal
            const idx = updatedLocal.findIndex(ul => ul.id === r.id);
            if (idx !== -1) {
              updatedLocal.splice(idx, 1);
            }
          } else {
            if (!merged.some(m => m.id === r.id)) {
              merged.push(r);
            }
          }
        });
        localStorage.setItem('skulk_local_rooms', JSON.stringify(updatedLocal));
        setRooms(merged);
      }
    }, (error) => {
      console.warn("Firestore subscription failed, falling back to local mock data:", error);
      setIsFirestoreBlocked(true);
      setRooms(getLocalRooms());
    });
    return () => unsubscribe();
  }, []);

  // Listen to participants subcollection for each room listed on the dashboard
  useEffect(() => {
    if (rooms.length === 0) return;
    
    const unsubscribes = rooms.map(room => {
      return onSnapshot(collection(db, 'rooms', room.id, 'participants'), (snapshot) => {
        const participantsList = snapshot.docs.map(doc => doc.data());
        setRoomsParticipants(prev => ({
          ...prev,
          [room.id]: participantsList
        }));
      });
    });
    
    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [rooms]);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showSignInPrompt, setShowSignInPrompt] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomType, setNewRoomType] = useState<'private' | 'public-ask' | 'public'>('public-ask');
  const [newMaxParticipants, setNewMaxParticipants] = useState(18);
  
  // Scheduling State
  const [startOption, setStartOption] = useState<'now' | 'later'>('now');
  const [scheduleDate, setScheduleDate] = useState('2026-07-08');
  const [scheduleTime, setScheduleTime] = useState('12:00');
  
  // Confirmation state
  const [modalStep, setModalStep] = useState<'form' | 'confirmation'>('form');
  const [generatedRoomLink, setGeneratedRoomLink] = useState('');
  const [isCopied, setIsCopied] = useState(false);

  // Theme Picker State (7 selectable themes, nightwatch default)
  const [theme, setTheme] = useState<string>('nightwatch');
  const [isThemePickerOpen, setIsThemePickerOpen] = useState(false);

  // Active call view state
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [pendingJoinRoom, setPendingJoinRoom] = useState<Room | null>(null);
  
  // Call hardware controls state
  const [isMicMuted, setIsMicMuted] = useState(true);
  const [isCamOff, setIsCamOff] = useState(true);
  const [cameraError, setCameraError] = useState(false);
  const [micError, setMicError] = useState(false);
  const [isGalleryView, setIsGalleryView] = useState(false);
  const [liveKitToken, setLiveKitToken] = useState<string | null>(null);
  
  // Sidebar tabs in-call panel
  const [callTab, setCallTab] = useState<'chat' | 'people' | 'tools'>('chat');
  const [chatMessageText, setChatMessageText] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [systemMessages, setSystemMessages] = useState<any[]>([]);
  const isInitialLoadRef = useRef(true);
  const isChatInitialLoadRef = useRef(true);
  const localJoinTimeRef = useRef<number | null>(null);

  const isMicMutedRef = useRef(isMicMuted);
  const isCamOffRef = useRef(isCamOff);
  useEffect(() => {
    isMicMutedRef.current = isMicMuted;
  }, [isMicMuted]);
  useEffect(() => {
    isCamOffRef.current = isCamOff;
  }, [isCamOff]);
  
  // In-call participants state
  const [callParticipants, setCallParticipants] = useState<Participant[]>([]);
  const [activeMenuParticipantId, setActiveMenuParticipantId] = useState<string | null>(null);

  // Toast feedback state
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // const [isWhiteboardActive, setIsWhiteboardActive] = useState(false);
  const [viewingShare, setViewingShare] = useState<ViewingShare | null>(null);
  const [screenShareStream, setScreenShareStream] = useState<MediaStream | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawColor, setDrawColor] = useState('#f1c40f'); // Neon gold as default

  // Tools sub-panel toggle
  const [activeToolDetail, setActiveToolDetail] = useState<'none' | 'youtube' | 'games' | 'pomodoro' | 'targets' | 'deadline' | 'loose' | 'truthordare' | 'spin'>('none');

  // Fun Tools toggle & Truth or Dare synced spinner states
  const [allowFunTools, setAllowFunTools] = useState(true);
  const [todSpinResult, setTodSpinResult] = useState<{ selectedId: string, angle: number, spunBy: string, timestamp: number } | null>(null);
  const [todSpinCheckedIds, setTodSpinCheckedIds] = useState<string[]>([]);
  const [todSpinPool, setTodSpinPool] = useState<string[]>([]);
  const [todState, setTodState] = useState<'idle' | 'spinning' | 'choice' | 'reveal'>('idle');
  const [todChoice, setTodChoice] = useState<'Truth' | 'Dare' | null>(null);
  const [todText, setTodText] = useState('');
  const [todSelectedId, setTodSelectedId] = useState('');
  const [todLocalSpinning, setTodLocalSpinning] = useState(false);

  // Spin the Wheel synced state
  const [spinResult, setSpinResult] = useState<{ selectedId: string, angle: number, spunBy: string, timestamp: number } | null>(null);
  const [spinCheckedIds, setSpinCheckedIds] = useState<string[]>([]);
  const [spinPool, setSpinPool] = useState<string[]>([]);
  const [spinLocalSpinning, setSpinLocalSpinning] = useState(false);

  // Header popover states
  const [isRoomSettingsOpen, setIsRoomSettingsOpen] = useState(false);
  const [maxPartInput, setMaxPartInput] = useState<number | ''>('');
  const roomSettingsRef = useRef<HTMLDivElement>(null);
  const isEvictedRef = useRef(false);

  // Whole-call Mini Mode (Zoom-like Call PiP) states
  const [pipWindowInstance, setPipWindowInstance] = useState<Window | null>(null);
  const [isMiniModeActive, setIsMiniModeActive] = useState(false);
  const [miniModeTab, setMiniModeTab] = useState<'call' | 'tool' | 'chat'>('call');
  const [unreadChatCount, setUnreadChatCount] = useState(0);

  const isChatActiveRef = useRef(false);
  useEffect(() => {
    isChatActiveRef.current = isMiniModeActive ? (miniModeTab === 'chat') : (callTab === 'chat');
  }, [callTab, miniModeTab, isMiniModeActive]);

  // Clear unread count when chat is active either in sidebar or PiP
  useEffect(() => {
    const isChatActive = isMiniModeActive ? (miniModeTab === 'chat') : (callTab === 'chat');
    if (isChatActive) {
      setUnreadChatCount(0);
    }
  }, [callTab, miniModeTab, isMiniModeActive]);

  // Update browser tab title / badge when there are unread messages
  useEffect(() => {
    const originalTitle = currentRoom ? `Skulk - ${currentRoom.name}` : 'Skulk';
    if (unreadChatCount > 0) {
      document.title = `🔴 (${unreadChatCount}) ${originalTitle}`;
    } else {
      document.title = originalTitle;
    }
    return () => {
      document.title = 'Skulk';
    };
  }, [unreadChatCount, currentRoom]);

  // Sync Room Settings input capacity when currentRoom updates
  useEffect(() => {
    if (currentRoom) {
      setMaxPartInput(currentRoom.maxParticipants ?? 10);
    }
  }, [currentRoom?.maxParticipants]);

  // Local Full-size tool expand state
  const [expandedTool, setExpandedTool] = useState<'none' | 'pomodoro' | 'deadline' | 'loose' | 'truthordare' | 'spin'>('none');

  // Watch Together (YouTube) States
  const [youtubeVideoId, setYoutubeVideoId] = useState<string | null>(null);
  const [ytInputUrl, setYtInputUrl] = useState('');
  const [watchTogetherPlatform, setWatchTogetherPlatform] = useState<'youtube' | 'vimeo' | 'dailymotion' | 'twitch'>('youtube');

  // Games Party States
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const [gameInviteInput, setGameInviteInput] = useState('');

  // Shared Pomodoro Timer States (Default 25 focus / 5 break)
  const [pomodoroFocusLength, setPomodoroFocusLength] = useState(25);
  const [pomodoroBreakLength, setPomodoroBreakLength] = useState(5);
  const [pomodoroMinutes, setPomodoroMinutes] = useState(25);
  const [pomodoroSeconds, setPomodoroSeconds] = useState(0);
  const [pomodoroIsRunning, setPomodoroIsRunning] = useState(false);
  const [pomodoroPhase, setPomodoroPhase] = useState<'focus' | 'break'>('focus');

  // Session Target States
  const [targetInputText, setTargetInputText] = useState('');
  const [targetsList, setTargetsList] = useState<any[]>([]);
  const [targetsHistory, setTargetsHistory] = useState<any[]>([]);

  // Listen to Firestore for user's targets list and history
  useEffect(() => {
    if (!user) {
      // Guest fallback: load from local storage
      const localList = localStorage.getItem('skulk_guest_targets_list');
      const localHistory = localStorage.getItem('skulk_guest_targets_history');
      setTargetsList(localList ? JSON.parse(localList) : [
        { id: 't1', text: 'Finish arrays sheet', completed: true },
        { id: 't2', text: 'Two pointers practice', completed: true },
        { id: 't3', text: 'Sliding window notes', completed: true },
        { id: 't4', text: 'GATE mock test 1', completed: false },
        { id: 't5', text: 'Review binary search', completed: false }
      ]);
      setTargetsHistory(localHistory ? JSON.parse(localHistory) : [
        { date: 'Jun 29', completedCount: 5, totalCount: 5 },
        { date: 'Jun 22', completedCount: 4, totalCount: 4 },
        { date: 'Jun 15', completedCount: 2, totalCount: 5 },
        { date: 'Jun 8', completedCount: 6, totalCount: 6 }
      ]);
      return;
    }

    const userDocRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setTargetsList(data.targetsList || []);
        setTargetsHistory(data.targetsHistory || []);
      } else {
        // Initialize new user document with default templates
        const initialList = [
          { id: 't1', text: 'Finish arrays sheet', completed: true },
          { id: 't2', text: 'Two pointers practice', completed: true },
          { id: 't3', text: 'Sliding window notes', completed: true },
          { id: 't4', text: 'GATE mock test 1', completed: false },
          { id: 't5', text: 'Review binary search', completed: false }
        ];
        const initialHistory = [
          { date: 'Jun 29', completedCount: 5, totalCount: 5 },
          { date: 'Jun 22', completedCount: 4, totalCount: 4 },
          { date: 'Jun 15', completedCount: 2, totalCount: 5 },
          { date: 'Jun 8', completedCount: 6, totalCount: 6 }
        ];
        setDoc(userDocRef, {
          targetsList: initialList,
          targetsHistory: initialHistory
        }, { merge: true }).catch(err => {
          console.warn("Error initializing user targets in Firestore:", err);
        });
      }
    });

    return () => unsubscribe();
  }, [user]);

  // Mini Deadline Clock States
  const [deadlineNewStepName, setDeadlineNewStepName] = useState('');
  const [isAddingDeadlineStep, setIsAddingDeadlineStep] = useState(false);
  const [deadlineSteps, setDeadlineSteps] = useState([
    { id: 'd1', name: 'Notes', minutes: 0 },
    { id: 'd2', name: 'Solve without hints', minutes: 0 },
    { id: 'd3', name: 'Solve with hint', minutes: 0 },
    { id: 'd4', name: 'Analyse', minutes: 0 },
    { id: 'd5', name: 'Notes', minutes: 0 }
  ]);
  const [deadlineActiveIndex, setDeadlineActiveIndex] = useState(0);
  const [deadlineTimerMinutes, setDeadlineTimerMinutes] = useState(0);
  const [deadlineTimerSeconds, setDeadlineTimerSeconds] = useState(0);
  const [deadlineIsRunning, setDeadlineIsRunning] = useState(false);

  // Loose Timer States
  const [looseNewStepName, setLooseNewStepName] = useState('');
  const [isAddingLooseStep, setIsAddingLooseStep] = useState(false);
  const [looseSteps, setLooseSteps] = useState([
    { id: 'l1', name: 'Notes', status: 'pending' as 'pending' | 'active' | 'completed', elapsedSeconds: 0 },
    { id: 'l2', name: 'Solve without hints', status: 'pending' as 'pending' | 'active' | 'completed', elapsedSeconds: 0 },
    { id: 'l3', name: 'Solve with hint', status: 'pending' as 'pending' | 'active' | 'completed', elapsedSeconds: 0 },
    { id: 'l4', name: 'Analyse', status: 'pending' as 'pending' | 'active' | 'completed', elapsedSeconds: 0 },
    { id: 'l5', name: 'Notes', status: 'pending' as 'pending' | 'active' | 'completed', elapsedSeconds: 0 }
  ]);
  const [looseActiveIndex, setLooseActiveIndex] = useState(0);
  const [looseTimerSeconds, setLooseTimerSeconds] = useState(0);
  const [looseIsRunning, setLooseIsRunning] = useState(false);

  // Guest Profile Identity State
  const [guestName, setGuestName] = useState('');
  const [guestColor, setGuestColor] = useState('');
  const [guestInitials, setGuestInitials] = useState('');
  const [guestPhotoURL, setGuestPhotoURL] = useState<string | null>(null);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [profileEditName, setProfileEditName] = useState('');
  const [profileEditColor, setProfileEditColor] = useState('');
  const [profileEditPhotoURL, setProfileEditPhotoURL] = useState('');

  // Spotlight view state
  const [spotlightParticipantId, setSpotlightParticipantId] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const themePickerRef = useRef<HTMLDivElement>(null);
  const sidebarMenuRef = useRef<HTMLDivElement>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [isFirestoreBlocked, setIsFirestoreBlocked] = useState(false);
  const hasSeenSelfInListRef = useRef(false);
  const currentSessionIdRef = useRef<string | null>(null);
  const isEnteringRoomRef = useRef<string | null>(null);

  // Helper to determine role dynamically based on auth email and room creator
  const determineRole = (roomCreatorId?: string) => {
    const myId = getMyId();
    if (!myId) return 'member';
    const adminEmails = ['fijakhan7127@gmail.com', '000fijakhan123@gmail.com'];
    if (user && user.email && adminEmails.includes(user.email.toLowerCase())) {
      return 'admin';
    }
    if (roomCreatorId && myId === roomCreatorId) {
      return 'host';
    }
    return 'member';
  };

  // Helper to enforce kick permissions hierarchy
  const checkCanKick = (myRole: string, targetRole: string) => {
    if (targetRole === 'admin') return false; // Nobody can kick admin
    if (myRole === 'admin') return true; // Admin can kick anybody
    if (targetRole === 'host') return false; // Nobody except admin can kick host
    if (myRole === 'host' && (targetRole === 'cohost' || targetRole === 'member')) return true; // Host kicks cohost/member
    if (myRole === 'cohost' && targetRole === 'member') return true; // Cohost kicks member
    return false;
  };

  // Helper to enforce mute permissions hierarchy
  const checkCanMute = (myRole: string, targetRole: string) => {
    if (targetRole === 'admin') return false; // Nobody can mute admin
    if (myRole === 'admin') return true; // Admin can mute anybody
    if (targetRole === 'host') return false; // Nobody except admin can mute host
    if (myRole === 'host' && (targetRole === 'cohost' || targetRole === 'member')) return true; // Host mutes cohost/member
    if (myRole === 'cohost' && targetRole === 'member') return true; // Cohost mutes member
    return false;
  };

  // Client-side garbage collection for empty custom rooms older than 3 minutes
  useEffect(() => {
    const cleanupInterval = setInterval(async () => {
      const now = new Date().getTime();
      const roomsToDelete: string[] = [];
      
      rooms.forEach(room => {
        if (currentRoom && room.id === roomDocId(currentRoom)) return;
        
        const participants = roomsParticipants[room.id] || [];
        if (participants.length === 0) {
          const createdTime = room.createdAt ? new Date(room.createdAt).getTime() : now;
          const ageMinutes = (now - createdTime) / 60000;
          if (ageMinutes >= 3) {
            roomsToDelete.push(room.id);
          }
        }
      });
      
      for (const rid of roomsToDelete) {
        try {
          // Remove from localStorage first
          const local = getLocalRooms();
          const updatedLocal = local.filter(r => r.id !== rid);
          localStorage.setItem('skulk_local_rooms', JSON.stringify(updatedLocal));

          await deleteDoc(doc(db, 'rooms', rid));
          console.log(`Garbage collected empty room: ${rid}`);
          showToast(`Cleaned up empty room: ${rid}`);
        } catch (e) {
          console.warn(`Failed to garbage collect room ${rid}:`, e);
        }
      }
    }, 10000); // Check every 10 seconds for faster testing response
    
    return () => clearInterval(cleanupInterval);
  }, [rooms, roomsParticipants, currentRoom]);

  const themes = [
    { id: 'nightwatch', name: 'Nightwatch', bg: '#0f1013', accent: '#f1c40f' },
    { id: 'reactor', name: 'Reactor', bg: '#0b0c10', accent: '#e74c3c' },
    { id: 'crimson', name: 'Crimson', bg: '#000000', accent: '#dc2626' },
    { id: 'deduction', name: 'Deduction', bg: '#000000', accent: '#ffffff' },
    { id: 'bloom', name: 'Bloom', bg: '#fff9fa', accent: '#ec4899' },
    { id: 'symbiote', name: 'Symbiote', bg: '#040404', accent: '#84cc16' },
    { id: 'webslinger', name: 'Webslinger', bg: '#070913', accent: '#e11d48' },
  ];

  // Sync theme class to html element
  useEffect(() => {
    const root = window.document.documentElement;
    // Strip other theme classes
    const classesToRemove = Array.from(root.classList).filter(c => c.startsWith('theme-'));
    classesToRemove.forEach(c => root.classList.remove(c));
    root.classList.add(`theme-${theme}`);
  }, [theme]);

  // Load or auto-generate Guest Identity
  useEffect(() => {
    const stored = localStorage.getItem('skulk_guest_identity');
    if (stored) {
      try {
        const data = JSON.parse(stored);
        if (data.name && data.color && data.initials) {
          setGuestName(data.name);
          setGuestColor(data.color);
          setGuestInitials(data.initials);
          setGuestPhotoURL(data.photoURL || null);
          setProfileEditName(data.name);
          setProfileEditColor(data.color);
          setProfileEditPhotoURL(data.photoURL || '');
          return;
        }
      } catch (e) {
        // fallback
      }
    }
    
    // Auto-generate adjective + animal nickname
    const adjectives = ['Quiet', 'Clever', 'Smart', 'Bright', 'Calm', 'Active', 'Swift', 'Wise', 'Happy', 'Gentle'];
    const animals = ['Fox', 'Owl', 'Panda', 'Koala', 'Rabbit', 'Deer', 'Otter', 'Falcon', 'Wolf', 'Badger'];
    const colors = ['#8b5cf6', '#3b82f6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444'];
    
    const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const randomAnim = animals[Math.floor(Math.random() * animals.length)];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    const initials = randomAdj[0] + randomAnim[0];
    const name = `${randomAdj} ${randomAnim}`;
    
    setGuestName(name);
    setGuestColor(randomColor);
    setGuestInitials(initials);
    setGuestPhotoURL(null);
    setProfileEditName(name);
    setProfileEditColor(randomColor);
    setProfileEditPhotoURL('');
    
    localStorage.setItem('skulk_guest_identity', JSON.stringify({ name, color: randomColor, initials, photoURL: null }));
  }, []);

  // Sync guest identity edits into active call in real time
  useEffect(() => {
    if (currentRoom) {
      setCallParticipants(prev => prev.map(p => {
        if (p.id === 'user_you') {
          return {
            ...p,
            name: `${guestName} (You)`,
            initials: guestInitials,
            color: guestColor,
            photoURL: user ? user.photoURL : guestPhotoURL
          };
        }
        return p;
      }));
    }
  }, [guestName, guestColor, guestInitials, guestPhotoURL, currentRoom, user]);

  // Cleanup old pre-existing default rooms from Firestore if they exist
  useEffect(() => {
    const defaultIds = ['dsa123', 'gate45', 'ielts9', 'study5'];
    defaultIds.forEach(async (id) => {
      try {
        await deleteDoc(doc(db, 'rooms', id));
      } catch (e) {}
    });
  }, []);

  // Click outside handlers
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      // Theme picker click outside close
      if (themePickerRef.current && !themePickerRef.current.contains(e.target as Node)) {
        setIsThemePickerOpen(false);
      }
      // Room settings click outside close
      if (roomSettingsRef.current && !roomSettingsRef.current.contains(e.target as Node)) {
        setIsRoomSettingsOpen(false);
      }
      // Hover participant action dropdown click outside close
      if (sidebarMenuRef.current && !sidebarMenuRef.current.contains(e.target as Node)) {
        setActiveMenuParticipantId(null);
      }
      // User dropdown click outside close
      if (userDropdownRef.current && !userDropdownRef.current.contains(e.target as Node)) {
        setIsUserDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Listen to Firebase authentication status
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        setIsAuthLoading(true);
        try {
          await signInAnonymously(auth);
        } catch (e) {
          console.warn("Failed to sign in anonymously:", e);
          setIsAuthLoading(false);
        }
        return;
      }

      setUser(currentUser);
      setGuestId(currentUser.uid);
      setIsAuthLoading(false);
      
      if (!currentUser.isAnonymous) {
        // Override guest identity with Google sign-in details
        const name = currentUser.displayName || 'Google User';
        setGuestName(name);
        
        // Generate initials
        const parts = name.trim().split(/\s+/);
        const initials = parts.length >= 2 
          ? (parts[0][0] + parts[1][0]).toUpperCase() 
          : name.substring(0, 2).toUpperCase();
        setGuestInitials(initials);
        
        // Sync into active call if in a room
        setCallParticipants(prev => prev.map(p => {
          if (p.id === 'user_you') {
            return {
              ...p,
              name: `${name} (You)`,
              initials: initials,
              color: '#8b5cf6',
              photoURL: currentUser.photoURL
            };
          }
          return p;
        }));
      } else {
        // Re-read local guest profile when logged out / anonymous
        const stored = localStorage.getItem('skulk_guest_identity');
        if (stored) {
          try {
            const data = JSON.parse(stored);
            setGuestName(data.name || '');
            setGuestColor(data.color || '#8b5cf6');
            setGuestInitials(data.initials || 'G');
            setGuestPhotoURL(data.photoURL || null);
            
            // Sync into active call if in a room
            setCallParticipants(prev => prev.map(p => {
              if (p.id === 'user_you') {
                return {
                  ...p,
                  name: `${data.name} (You)`,
                  initials: data.initials,
                  color: data.color,
                  photoURL: data.photoURL || null
                };
              }
              return p;
            }));
          } catch (e) {
            // ignore
          }
        }
      }
    });
    return () => unsubscribe();
  }, [currentRoom]);

  const handleSignIn = async () => {
    const gid = getMyId();
    const rid = currentRoom ? roomDocId(currentRoom) : null;
    let deletedGid = false;

    try {
      if (rid && gid && user && user.isAnonymous) {
        console.log("[AUTH TRANSITION] Deleting guest presence before sign-in:", gid);
        try {
          await deleteDoc(doc(db, 'rooms', rid, 'participants', gid));
          deletedGid = true;
        } catch (e) {
          console.warn("Failed to delete guest presence before sign-in:", e);
        }
      }

      await signInWithPopup(auth, googleProvider);
      showToast('Signed in successfully!');
    } catch (error: any) {
      console.error('Sign-in error:', error);
      showToast(`Sign-in failed: ${error.message}`);
      
      // Re-create guest presence if it was deleted but sign-in was cancelled or failed
      if (deletedGid && rid && gid) {
        console.log("[AUTH TRANSITION] Re-creating guest presence after sign-in failed:", gid);
        try {
          const presenceRef = doc(db, 'rooms', rid, 'participants', gid);
          const myRole = determineRole(currentRoom?.creatorId);
          await setDoc(presenceRef, {
            uid: gid,
            name: guestName,
            photoURL: guestPhotoURL,
            initials: guestInitials,
            color: guestColor,
            joinedAt: new Date().toISOString(),
            role: myRole,
            mutedBy: gid,
            camOffBy: gid,
            sessionId: currentSessionIdRef.current
          });
        } catch (e) {
          console.error("Failed to restore guest presence:", e);
        }
      }
    }
  };

  const handleSignOut = async () => {
    try {
      const myId = getMyId();
      if (currentRoom && myId && user && !user.isAnonymous) {
        const rid = roomDocId(currentRoom);
        console.log("[AUTH TRANSITION] Deleting logged-in presence before sign-out:", myId);
        try {
          await deleteDoc(doc(db, 'rooms', rid, 'participants', myId));
        } catch (e) {
          console.warn("Failed to delete user presence before sign-out:", e);
        }
      }
      await signOut(auth);
      setIsUserDropdownOpen(false);
      showToast('Signed out.');
    } catch (error: any) {
      console.error('Sign-out error:', error);
      showToast('Sign-out failed');
    }
  };

  // Lock body scroll when modal is active
  useEffect(() => {
    if (isModalOpen || pendingJoinRoom) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isModalOpen, pendingJoinRoom]);

  // Close modal on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const openModal = () => {
    if (!user) {
      setShowSignInPrompt(true);
      return;
    }
    setIsModalOpen(true);
    setNewRoomName('');
    setNewRoomType('public-ask');
    setNewMaxParticipants(10);
    setStartOption('now');
    setModalStep('form');
    setGeneratedRoomLink('');
    setIsCopied(false);
  };

  const closeModal = () => {
    setIsModalOpen(false);
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    // Only allow clicking backdrop to close if on the 'form' step (not confirmation screen)
    if (modalStep === 'form' && modalRef.current && !modalRef.current.contains(e.target as Node)) {
      closeModal();
    }
  };

  // Toast feedback trigger helper
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  // Helper to extract room identifier (e.g. ielts9 from skulk.app/room/ielts9)
  const getRoomIdFromLink = (link?: string) => {
    if (!link) return '';
    const parts = link.split('/');
    return parts[parts.length - 1];
  };

  // Canonical Firestore room ID — always matches the URL slug so all users sync to the same room
  const roomDocId = (room: Room | null | undefined) => {
    if (!room) return '';
    return getRoomIdFromLink(room.link) || room.id;
  };

  const getMyId = () => user ? user.uid : (guestId || localStorage.getItem('skulk_guest_id') || '');

  const updateMySharing = async (fields: Record<string, unknown>) => {
    const myId = getMyId();
    const rid = roomDocId(currentRoom);
    if (!myId || !rid) return;
    try {
      await updateDoc(doc(db, 'rooms', rid, 'participants', myId), fields);
    } catch (e) {
      console.warn('Failed to update sharing state:', e);
    }
  };

  const clearMySharing = async () => {
    await updateMySharing({ sharing: null, sharingYoutubeId: null, whiteboardData: '' });
  };

  const handleViewParticipantShare = (p: Participant) => {
    if (!p.sharing) return;
    setViewingShare({
      participantId: p.id,
      type: p.sharing,
      youtubeVideoId: p.sharingYoutubeId || undefined,
    });
  };

  // const renderSharingBadge = (sharing: Participant['sharing']) => {
  //   if (!sharing) return null;
  //   const icons: Record<string, string> = { youtube: '▶', whiteboard: '✎', screen: '⛶' };
  //   const titles: Record<string, string> = {
  //     youtube: 'Sharing YouTube — click to watch',
  //     whiteboard: 'Sharing whiteboard — click to view',
  //     screen: 'Sharing screen — click to view',
  //   };
  //   return (
  //     <span className="sharing-badge" title={titles[sharing]}>
  //       {icons[sharing]}
  //     </span>
  //   );
  // };

  const leavePresence = async (roomIdToLeave: string, sessionIdToDelete?: string | null) => {
    const myId = getMyId();
    console.log("leavePresence called:", { roomIdToLeave, sessionIdToDelete, myId }, new Error().stack);
    if (!myId || !roomIdToLeave) return;

    const performLeave = async () => {
      try {
        const presenceDocRef = doc(db, 'rooms', roomIdToLeave, 'participants', myId);
        
        await runTransaction(db, async (transaction) => {
          const snap = await transaction.get(presenceDocRef);
          if (snap.exists()) {
            const data = snap.data();
            console.log("leavePresence transaction evaluate:", { storedSessionId: data.sessionId, sessionIdToDelete });
            if (!sessionIdToDelete || data.sessionId === sessionIdToDelete) {
              console.log("leavePresence transaction deleting presence:", myId);
              transaction.delete(presenceDocRef);
            } else {
              console.log('leavePresence bypassed: presence belongs to a newer session (transaction).');
            }
          } else {
            console.log("leavePresence transaction: presence doc does not exist.");
          }
        });

        // Delete any signals associated with this user
        const signalsRef = collection(db, 'rooms', roomIdToLeave, 'signals');
        const snapshot = await getDocs(signalsRef);
        for (const docSnap of snapshot.docs) {
          if (docSnap.id.includes(myId)) {
            try {
              // Delete candidates subcollection first
              const candidatesRef = collection(db, 'rooms', roomIdToLeave, 'signals', docSnap.id, 'candidates');
              const candSnap = await getDocs(candidatesRef);
              for (const d of candSnap.docs) {
                try { await deleteDoc(d.ref); } catch (e) {}
              }
              await deleteDoc(docSnap.ref);
            } catch (e) {}
          }
        }
        // Delete my join request doc if any exists
        await deleteDoc(doc(db, 'rooms', roomIdToLeave, 'joinRequests', myId));
      } catch (e) {
        console.error('Error removing presence document:', e);
      }
    };

    globalPendingLeavePromise = (globalPendingLeavePromise || Promise.resolve())
      .then(performLeave)
      .catch(() => {});
      
    await globalPendingLeavePromise;
  };

  const canJoin = async (targetRoom: Room) => {
    const adminEmails = ['fijakhan7127@gmail.com', '000fijakhan123@gmail.com'];
    if (user && user.email && adminEmails.includes(user.email.toLowerCase())) {
      return true; // Admin bypasses room capacity limit!
    }
    const myId = user ? user.uid : (guestId || localStorage.getItem('skulk_guest_id') || '');
    if (!myId) return false;
    try {
      const presenceRef = collection(db, 'rooms', targetRoom.id, 'participants');
      const snapshot = await getDocsFromServer(presenceRef);
      const activeParts = snapshot.docs.map(doc => doc.id);
      
      if (activeParts.length >= (targetRoom.maxParticipants || 10) && !activeParts.includes(myId)) {
        return false;
      }
    } catch (e) {
      console.warn("Failed to check room capacity in Firestore, allowing access (Offline Fallback):", e);
    }
    return true;
  };

  // Join Room Handlers (wiring direct vs pending status)
  const handleJoinRoomClick = async (room: Room) => {
    const id = getRoomIdFromLink(room.link);
    const allowed = await canJoin(room);
    if (!allowed) {
      showToast(`This room is full (${room.maxParticipants || 10}/${room.maxParticipants || 10})`);
      return;
    }

    const myId = getMyId();
    const isCreator = room.creatorId === myId;

    if (room.type === 'public') {
      window.open(`/room/${id}`, '_blank');
    } else if (room.type === 'public-ask') {
      const myRole = determineRole(room.creatorId);
      if (isCreator || myRole === 'admin') {
        window.open(`/room/${id}`, '_blank');
      } else {
        // Show waiting modal triggering the request status useEffect
        setPendingJoinRoom(room);
      }
    }
  };

  // Setup conference shell room data
  const enterCallRoom = async (room: Room) => {
    isEvictedRef.current = false;
    if (globalPendingLeavePromise) {
      try {
        await globalPendingLeavePromise;
      } catch (e) {}
    }
    const normalizedRoom = { ...room, id: roomDocId(room) };
    const myId = getMyId();
    const newSessionId = Math.random().toString(36).substring(2, 10);
    console.log(`[LOCAL JOIN ACTION] Initiated enterCallRoom: RoomID=${normalizedRoom.id}, MyID=${myId}, SessionID=${newSessionId}, EventTime=${new Date().toISOString()}`);
    
    // Set local join time and push the initial system message immediately
    localJoinTimeRef.current = Date.now();
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setSystemMessages([
      {
        id: `system_join_self_${Date.now()}`,
        text: `You joined · ${timeStr}`,
        createdAt: new Date().toISOString()
      }
    ]);

    currentSessionIdRef.current = newSessionId;
    hasSeenSelfInListRef.current = false; // Reset on initial join
    if (myId) {
      const myRole = determineRole(normalizedRoom.creatorId);
      try {
        const presenceRef = doc(db, 'rooms', normalizedRoom.id, 'participants', myId);
        await setDoc(presenceRef, {
          uid: myId,
          name: user ? user.displayName || 'Google User' : guestName,
          photoURL: user ? user.photoURL : guestPhotoURL,
          initials: guestInitials,
          color: guestColor,
          joinedAt: new Date().toISOString(),
          sharing: null,
          role: myRole,
          isMuted: true,
          isCamOff: true,
          mutedBy: myId,
          camOffBy: myId,
          sessionId: newSessionId
        });
        localStorage.setItem('skulk_active_session', JSON.stringify({
          roomId: normalizedRoom.id,
          sessionId: newSessionId,
          timestamp: Date.now()
        }));
      } catch (err) {
        console.warn("Failed to set presence in Firestore, joining locally:", err);
      }
    }

    setCurrentRoom(normalizedRoom);
    setIsMicMuted(true);
    setIsCamOff(true);
    setIsGalleryView(false);
    setCallTab('chat');
    setViewingShare(null);
    setChatMessages([]);
    setUnreadChatCount(0);
    isChatInitialLoadRef.current = true;

    // Fetch LiveKit Token
    try {
      const myId = getMyId();
      const myName = user ? user.displayName || 'Google User' : guestName;
      const res = await fetch(`/api/get-livekit-token?room=${normalizedRoom.id}&identity=${myId}&name=${encodeURIComponent(myName)}`);
      const data = await res.json();
      if (data.token) {
        setLiveKitToken(data.token);
      } else {
        showToast("⚠️ Failed to connect to LiveKit server");
      }
    } catch (e) {
      console.warn("Failed to fetch token:", e);
      showToast("⚠️ Failed to fetch LiveKit token");
    }

    // Set initial presence (both true or false depending on your preference, we default to unmuted/on)
    if (myId) {
      try {
        await updateDoc(doc(db, 'rooms', normalizedRoom.id, 'participants', myId), {
          isMuted: true,
          isCamOff: true,
          mutedBy: myId,
          camOffBy: myId
        });
      } catch (e) {}
    }
  };

  const handleLeaveCall = () => {
    isEvictedRef.current = true;
    hasSeenSelfInListRef.current = false;
    if (currentRoom) {
      const prevRoomId = roomDocId(currentRoom);
      console.log("[LEAVE EVENT] leavePresence triggered from handleLeaveCall, session:", currentSessionIdRef.current);
      leavePresence(prevRoomId, currentSessionIdRef.current);
      clearMySharing();
      setCurrentRoom(null);
      setCallParticipants([]);
      setChatMessages([]);
      setSystemMessages([]);
      isInitialLoadRef.current = true;
      isChatInitialLoadRef.current = true;
      setUnreadChatCount(0);
      setViewingShare(null);
      setLiveKitToken(null);
    }
    navigate('/');
  };

  const toggleMic = async () => {
    const nextVal = !isMicMuted;
    setIsMicMuted(nextVal);
    await updateMySharing({ isMuted: nextVal, mutedBy: getMyId() });
  };

  const toggleCamera = async () => {
    const nextVal = !isCamOff;
    setIsCamOff(nextVal);
    await updateMySharing({ isCamOff: nextVal, camOffBy: getMyId() });
  };

  // Synchronize route changes with active room state (handles back/forward buttons)
  useEffect(() => {
    if (isAuthLoading) return;
    
    if (!roomId) {
      // If we navigated away from the room route, reset the evicted flag so we can join other rooms normally in the future!
      isEvictedRef.current = false;
    }

    if (isEvictedRef.current) {
      return;
    }
    
    if (roomId) {
      const currentRoomId = currentRoom ? getRoomIdFromLink(currentRoom.link) : null;
      if (!currentRoom || currentRoomId !== roomId) {
        if (isEnteringRoomRef.current === roomId) return;
        isEnteringRoomRef.current = roomId;

        const match = rooms.find(r => getRoomIdFromLink(r.link) === roomId);

        const handleJoin = async () => {
          let roomObj: Room | null = match || null;
          if (!roomObj) {
            try {
              const docSnap = await getDoc(doc(db, 'rooms', roomId));
              if (docSnap.exists()) {
                roomObj = { id: docSnap.id, ...docSnap.data() } as Room;
              }
            } catch (err) {
              console.warn("Direct document fetch failed, using local room representation:", err);
            }
          }
          if (!roomObj) {
            roomObj = {
              id: roomId,
              name: `Room - ${roomId}`,
              type: 'public',
              buttonText: 'Join',
              participants: [],
              maxParticipants: 10,
              link: `http://skulk.vercel.app/room/${roomId}`
            };
          }

          const allowed = await canJoin(roomObj);
          if (!allowed) {
            showToast(`This room is full (${roomObj.maxParticipants || 10}/${roomObj.maxParticipants || 10})`);
            isEnteringRoomRef.current = null;
            navigate('/');
            return;
          }

          const myId = getMyId();
          const isCreator = roomObj.creatorId === myId;
          const myRole = determineRole(roomObj.creatorId);
          if (roomObj.type === 'public-ask' && !isCreator && myRole !== 'admin') {
            try {
              const reqDocRef = doc(db, 'rooms', roomObj.id, 'joinRequests', myId);
              const reqDocSnap = await getDoc(reqDocRef);
              const isAlreadyApproved = reqDocSnap.exists() && reqDocSnap.data()?.status === 'approved';
              if (!isAlreadyApproved) {
                isEnteringRoomRef.current = null;
                setPendingJoinRoom(roomObj);
                return;
              }
            } catch (e) {
              console.warn("Direct link capacity verification failed, joining room.");
            }
          }

          await enterCallRoom(roomObj);
          isEnteringRoomRef.current = null;
        };

        handleJoin().catch(() => {
          isEnteringRoomRef.current = null;
        });
      }
    } else {
      isEnteringRoomRef.current = null;
      if (currentRoom) {
        const prevRoomId = roomDocId(currentRoom);
        console.log("[LEAVE EVENT] leavePresence triggered from route sync useEffect else-block (dashboard route), session:", currentSessionIdRef.current);
        leavePresence(prevRoomId, currentSessionIdRef.current);
        clearMySharing();
        setCurrentRoom(null);
        setCallParticipants([]);
        setChatMessages([]);
        setSystemMessages([]);
        isInitialLoadRef.current = true;
        isChatInitialLoadRef.current = true;
        setUnreadChatCount(0);
        setViewingShare(null);
        setLiveKitToken(null);
      }
    }
  }, [roomId, rooms, user, guestId, isAuthLoading, currentRoom ? roomDocId(currentRoom) : null]);

  // Clean up presence when component unmounts or call ends
  useEffect(() => {
    const sessionIdToClean = currentSessionIdRef.current;
    console.log("[CLEANUP EFFECT SETUP] registering cleanup for session:", sessionIdToClean);
    return () => {
      if (currentRoom) {
        const prevRoomId = roomDocId(currentRoom);
        console.log("[CLEANUP EFFECT CLEANUP] leavePresence triggered from cleanup useEffect, session:", sessionIdToClean);
        leavePresence(prevRoomId, sessionIdToClean);
      }
    };
  }, [currentRoom ? roomDocId(currentRoom) : null]);



  // Update or migrate Firestore presence document when authentication state changes
  useEffect(() => {
    if (!currentRoom) return;
    
    const syncAuthPresence = async () => {
      const myId = getMyId();
      if (!myId) return;
      const rid = roomDocId(currentRoom);

      // If user signed in, remove the old guest presence document
      if (user) {
        const storedGid = localStorage.getItem('skulk_guest_id');
        if (storedGid && storedGid !== user.uid) {
          try {
            await deleteDoc(doc(db, 'rooms', rid, 'participants', storedGid));
          } catch (e) {
            // ignore
          }
        }
      }
      
      const myRole = determineRole(currentRoom.creatorId);
      const presenceRef = doc(db, 'rooms', rid, 'participants', myId);
      await setDoc(presenceRef, {
        uid: myId,
        name: user ? user.displayName || 'Google User' : guestName,
        photoURL: user ? user.photoURL : guestPhotoURL,
        initials: guestInitials,
        color: guestColor,
        joinedAt: new Date().toISOString(),
        role: myRole,
        isMuted: isMicMutedRef.current,
        isCamOff: isCamOffRef.current,
        mutedBy: myId,
        camOffBy: myId,
        sessionId: currentSessionIdRef.current
      }, { merge: true });
    };
    
    syncAuthPresence();
  }, [user, currentRoom, guestName, guestInitials, guestColor, guestPhotoURL, guestId]);

  // Clean up presence immediately on tab/browser close using fetch keepalive
  useEffect(() => {
    const handleUnload = () => {
      if (currentRoom) {
        const myId = getMyId();
        const rid = roomDocId(currentRoom);
        if (myId && rid) {
          const url = `https://firestore.googleapis.com/v1/projects/skulk-45c23/databases/(default)/documents/rooms/${rid}/participants/${myId}`;
          fetch(url, { method: 'DELETE', keepalive: true }).catch(() => {});
        }
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [currentRoom, user, guestId]);

  // Evict this tab to homepage if the same user joins any room from another tab/window
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'skulk_active_session' && e.newValue) {
        try {
          const activeSession = JSON.parse(e.newValue);
          if (currentRoom) {
            const currentRoomId = roomDocId(currentRoom);
            const mySessionId = currentSessionIdRef.current;
            
            // If the active session belongs to a different room or a different session ID in the same room
            if (activeSession.roomId !== currentRoomId || activeSession.sessionId !== mySessionId) {
              console.log("New session detected in another tab via localStorage:", activeSession);
              showToast("🔄 Joined from another tab/window. Redirecting to dashboard...");
              
              // Set evicted flag to block route-sync auto-rejoining
              isEvictedRef.current = true;

              // Clean up our presence in the room we are leaving
              leavePresence(currentRoomId, mySessionId);
              
              // Reset local state
              hasSeenSelfInListRef.current = false;
              clearMySharing();
              setCurrentRoom(null);
              setCallParticipants([]);
              setChatMessages([]);
              setViewingShare(null);
              setLiveKitToken(null);
              navigate('/');
            }
          }
        } catch (err) {
          console.error("Failed to parse active session from localStorage:", err);
        }
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [currentRoom ? roomDocId(currentRoom) : null]);

  // Real-time synchronization of call participants list inside calls
  useEffect(() => {
    if (!currentRoom) return;
    
    hasSeenSelfInListRef.current = false; // Reset on every subscription/auth change to block race conditions!
    const rid = roomDocId(currentRoom);
    const presenceRef = collection(db, 'rooms', rid, 'participants');
    const unsubscribe = onSnapshot(presenceRef, (snapshot) => {
      const myId = getMyId();
      
      snapshot.docChanges().forEach((change) => {
        const docId = change.doc.id;
        const data = change.doc.data();
        const timestamp = new Date().toISOString();
        const cleanName = data.name ? data.name.replace(' (You)', '') : 'Someone';
        
        // Helper to format local time as e.g. "3:42 PM"
        const getFormattedTime = () => {
          return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        };

        if (change.type === 'added') {
          console.log(`[PRESENCE EVENT] Participant ADDED: ID=${docId}, Name=${data.name}, SessionID=${data.sessionId || 'none'}, JoinTime=${data.joinedAt || 'none'}, EventTime=${timestamp}`);
          if (!isInitialLoadRef.current) {
            const timeStr = getFormattedTime();
            const displayName = docId === myId ? 'You' : cleanName;
            setSystemMessages(prev => [
              ...prev,
              {
                id: `system_join_${docId}_${Date.now()}`,
                text: `${displayName} joined · ${timeStr}`,
                createdAt: timestamp
              }
            ]);
            if (!isChatActiveRef.current) {
              setUnreadChatCount(prev => prev + 1);
            }
          }
        } else if (change.type === 'modified') {
          console.log(`[PRESENCE EVENT] Participant MODIFIED: ID=${docId}, Name=${data.name}, SessionID=${data.sessionId || 'none'}, EventTime=${timestamp}`);
        } else if (change.type === 'removed') {
          console.log(`[PRESENCE EVENT] Participant REMOVED: ID=${docId}, Name=${data.name}, EventTime=${timestamp}`);
          if (!isInitialLoadRef.current) {
            const timeStr = getFormattedTime();
            const displayName = docId === myId ? 'You' : cleanName;
            setSystemMessages(prev => [
              ...prev,
              {
                id: `system_leave_${docId}_${Date.now()}`,
                text: `${displayName} left · ${timeStr}`,
                createdAt: timestamp
              }
            ]);
            if (!isChatActiveRef.current) {
              setUnreadChatCount(prev => prev + 1);
            }
          }
        }
      });

      const list = snapshot.docs.map(docSnap => {
        const data = docSnap.data();
        const isMe = docSnap.id === myId;
        
        return {
          id: docSnap.id,
          name: isMe ? `${data.name} (You)` : data.name,
          initials: data.initials,
          color: data.color,
          photoURL: data.photoURL,
          isMuted: isMe ? isMicMutedRef.current : (data.isMuted ?? false),
          isCamOff: isMe ? isCamOffRef.current : (data.isCamOff ?? false),
          isSpeaking: false,
          isPinned: false,
          role: data.role || (currentRoom.creatorId === docSnap.id ? 'host' : 'member'),
          sharing: data.sharing || null,
          sharingYoutubeId: data.sharingYoutubeId || null,
          whiteboardData: data.whiteboardData,
          mutedBy: data.mutedBy || null,
          camOffBy: data.camOffBy || null,
        } as Participant;
      });

      // Kick detection: Only trigger if we have seen ourselves in the active list first to prevent join race conditions
      const meStillInRoom = list.some(p => p.id === myId);
      console.log("Kick check snapshot list:", {
        myId,
        meStillInRoom,
        hasSeenSelf: hasSeenSelfInListRef.current,
        listIds: list.map(p => p.id)
      });
      if (myId && meStillInRoom) {
        hasSeenSelfInListRef.current = true;
      }
      
      if (myId && hasSeenSelfInListRef.current && !meStillInRoom) {
        console.log("Kicking user out! meStillInRoom is false, hasSeenSelf is true.");
        showToast("❌ You have been removed from the room by a host.");
        handleLeaveCall();
        return;
      }
      
      setCallParticipants(list);
      isInitialLoadRef.current = false;
    }, (error) => {
      console.warn("Firestore call presence subscription failed, falling back to local user presence:", error);
      const myId = getMyId();
      setCallParticipants([
        {
          id: myId,
          name: `${user ? user.displayName || 'Google User' : guestName} (You)`,
          initials: guestInitials,
          color: guestColor,
          photoURL: user ? user.photoURL : null,
          isMuted: isMicMutedRef.current,
          isCamOff: isCamOffRef.current,
          isSpeaking: false,
          isPinned: false,
          role: determineRole(currentRoom.creatorId)
        }
      ]);
    });
    
    return () => unsubscribe();
  }, [currentRoom ? roomDocId(currentRoom) : null, user, guestId]);
  // Synchronize remote mute actions with local microphone state
  useEffect(() => {
    if (!currentRoom) return;
    const myId = getMyId();
    const myPresence = callParticipants.find(p => p.id === myId);
    if (myPresence && myPresence.isMuted !== isMicMuted) {
      // ONLY apply remote changes if they were initiated by another user (moderator)
      if (myPresence.mutedBy && myPresence.mutedBy !== myId) {
        setIsMicMuted(myPresence.isMuted);
        showToast(myPresence.isMuted ? "🎤 You have been muted by a host." : "🎤 You have been unmuted by a host.");
      }
    }
  }, [callParticipants, currentRoom ? roomDocId(currentRoom) : null, isMicMuted]);

  // Synchronize remote camera actions with local camera state
  useEffect(() => {
    if (!currentRoom) return;
    const myId = getMyId();
    const myPresence = callParticipants.find(p => p.id === myId);
    if (myPresence && myPresence.isCamOff !== isCamOff) {
      // ONLY apply remote changes if they were initiated by another user (moderator)
      if (myPresence.camOffBy && myPresence.camOffBy !== myId) {
        setIsCamOff(myPresence.isCamOff);
        showToast(myPresence.isCamOff ? "📷 Your camera has been turned off by a host." : "📷 Your camera has been turned on by a host.");
      }
    }
  }, [callParticipants, currentRoom ? roomDocId(currentRoom) : null, isCamOff]);

  // Listen to pending join requests (for Admin, Host, Co-host)
  useEffect(() => {
    if (!currentRoom) return;
    const myId = getMyId();
    const myRole = callParticipants.find(p => p.id === myId)?.role || 'member';
    
    if (myRole !== 'admin' && myRole !== 'host' && myRole !== 'cohost') {
      setPendingRequests([]);
      return;
    }
    
    const rid = roomDocId(currentRoom);
    const requestsRef = collection(db, 'rooms', rid, 'joinRequests');
    
    const unsubscribe = onSnapshot(requestsRef, (snapshot) => {
      const reqList = snapshot.docs
        .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
        .filter((req: any) => req.status === 'pending');
      setPendingRequests(reqList);
    });
    
    return () => unsubscribe();
  }, [currentRoom, callParticipants]);

  // Listen to the local user's own join request status (when waiting to join)
  useEffect(() => {
    if (!pendingJoinRoom) return;
    const myId = getMyId();
    const rid = roomDocId(pendingJoinRoom);
    
    const reqDoc = doc(db, 'rooms', rid, 'joinRequests', myId);
    setDoc(reqDoc, {
      id: myId,
      uid: myId,
      name: user ? user.displayName || 'Google User' : guestName,
      initials: guestInitials,
      color: guestColor,
      status: 'pending',
      requestedAt: new Date().toISOString()
    }).catch(e => console.warn("Failed to create join request:", e));
    
    const unsubscribe = onSnapshot(reqDoc, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.status === 'approved') {
        const targetRoom = pendingJoinRoom;
        setPendingJoinRoom(null);
        if (window.location.pathname.startsWith('/room/')) {
          enterCallRoom(targetRoom);
        } else {
          window.open(`/room/${targetRoom.id}`, '_blank');
        }
      } else if (data.status === 'denied') {
        setPendingJoinRoom(null);
        showToast(`❌ Join request was denied by the hosts.`);
        if (window.location.pathname.startsWith('/room/')) {
          navigate('/');
        }
      }
    });
    
    return () => {
      unsubscribe();
      deleteDoc(reqDoc).catch(() => {});
    };
  }, [pendingJoinRoom, user, guestName, guestInitials, guestColor]);

  const handleApproveRequest = async (req: any) => {
    if (!currentRoom) return;
    const rid = roomDocId(currentRoom);
    try {
      await setDoc(doc(db, 'rooms', rid, 'joinRequests', req.id), { status: 'approved' }, { merge: true });
      showToast(`Accepted ${req.name}'s request.`);
    } catch (e) {
      console.warn("Failed to approve request:", e);
    }
  };

  const handleDenyRequest = async (req: any) => {
    if (!currentRoom) return;
    const rid = roomDocId(currentRoom);
    try {
      await setDoc(doc(db, 'rooms', rid, 'joinRequests', req.id), { status: 'denied' }, { merge: true });
      showToast(`Denied ${req.name}'s request.`);
    } catch (e) {
      console.warn("Failed to deny request:", e);
    }
  };
  // Real-time synchronization of room document updates (Pomodoro, etc.)
  useEffect(() => {
    if (!currentRoom) return;
    
    const roomRef = doc(db, 'rooms', roomDocId(currentRoom));
    const unsubscribe = onSnapshot(roomRef, (docSnap) => {
      if (!docSnap.exists()) {
        showToast("⚠️ This room has been closed by the host.");
        handleLeaveCall();
        return;
      }
      const data = docSnap.data();
      
      // Update room metadata in state to sync Firestore room name
      setCurrentRoom(prev => {
        if (!prev) return null;
        if (prev.name === data.name && prev.creatorName === data.creatorName && prev.type === data.type) {
          return prev;
        }
        return {
          ...prev,
          name: data.name || prev.name,
          creatorName: data.creatorName || prev.creatorName,
          type: data.type || prev.type
        };
      });

      // Sync Pomodoro (shared room tool — still room-level)
      if (data.pomodoroIsRunning !== undefined) {
        setPomodoroIsRunning(data.pomodoroIsRunning);
      }
      if (data.pomodoroMinutes !== undefined && !pomodoroIsRunning) {
        setPomodoroMinutes(data.pomodoroMinutes);
      }
      if (data.pomodoroSeconds !== undefined && !pomodoroIsRunning) {
        setPomodoroSeconds(data.pomodoroSeconds);
      }
      if (data.pomodoroPhase !== undefined) {
        setPomodoroPhase(data.pomodoroPhase);
      }

      // Sync new tools tab fields
      if (data.allowFunTools !== undefined) {
        setAllowFunTools(data.allowFunTools);
        if (!data.allowFunTools) {
          // If fun tools are disabled, force close any active fun tool detail screen
          setActiveToolDetail(prev => (prev === 'games' || prev === 'truthordare') ? 'none' : prev);
          setExpandedTool(prev => (prev === 'truthordare') ? 'none' : prev);
        }
      }
      if (data.todSpinResult !== undefined) {
        setTodSpinResult(data.todSpinResult);
      }
      if (data.todSpinCheckedIds !== undefined) {
        setTodSpinCheckedIds(data.todSpinCheckedIds);
      }
      if (data.todSpinPool !== undefined) {
        setTodSpinPool(data.todSpinPool);
      }
      if (data.todState !== undefined) {
        setTodState(data.todState);
      }
      if (data.todChoice !== undefined) {
        setTodChoice(data.todChoice);
      }
      if (data.todText !== undefined) {
        setTodText(data.todText);
      }
      if (data.todSelectedId !== undefined) {
        setTodSelectedId(data.todSelectedId);
      }
      if (data.spinResult !== undefined) {
        setSpinResult(data.spinResult);
      }
      if (data.spinCheckedIds !== undefined) {
        setSpinCheckedIds(data.spinCheckedIds);
      }
      if (data.spinPool !== undefined) {
        setSpinPool(data.spinPool);
      }
    }, (error) => {
      console.warn("Room document subscription failed:", error);
    });
    
    return () => unsubscribe();
  }, [currentRoom ? roomDocId(currentRoom) : null, pomodoroIsRunning]);

  // Sync whiteboard canvas from the participant being viewed
  useEffect(() => {
    if (!viewingShare || viewingShare.type !== 'whiteboard' || !currentRoom) return;

    const partRef = doc(db, 'rooms', roomDocId(currentRoom), 'participants', viewingShare.participantId);
    const unsubscribe = onSnapshot(partRef, (snapshot) => {
      if (!snapshot.exists()) {
        if (viewingShare.participantId !== getMyId()) {
          setViewingShare(null);
          showToast('Whiteboard presenter has left. Ending session.');
        }
        return;
      }
      const data = snapshot.data();
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (data.whiteboardData !== undefined) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          if (!data.whiteboardData) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
          } else {
            const img = new Image();
            img.onload = () => {
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(img, 0, 0);
            };
            img.src = data.whiteboardData;
          }
        }
      }
      // Close view if sharer stopped sharing
      if (!data.sharing && viewingShare.participantId !== getMyId()) {
        setViewingShare(null);
      }
    });
    return () => unsubscribe();
  }, [viewingShare, currentRoom, user, guestId]);

  // Sync YouTube video ID when viewing someone's share
  useEffect(() => {
    if (!viewingShare || viewingShare.type !== 'youtube' || !currentRoom) return;

    const partRef = doc(db, 'rooms', roomDocId(currentRoom), 'participants', viewingShare.participantId);
    const unsubscribe = onSnapshot(partRef, (snapshot) => {
      if (!snapshot.exists()) {
        if (viewingShare.participantId !== getMyId()) {
          setViewingShare(null);
          showToast('YouTube presenter has left. Ending session.');
        }
        return;
      }
      const data = snapshot.data();
      if (data.sharingYoutubeId) {
        setViewingShare(prev => prev ? { ...prev, youtubeVideoId: data.sharingYoutubeId } : null);
      }
      if (!data.sharing && viewingShare.participantId !== getMyId()) {
        setViewingShare(null);
      }
    });
    return () => unsubscribe();
  }, [viewingShare?.participantId, viewingShare?.type, currentRoom, user, guestId]);

  // Sync screen share state when viewing someone's share
  useEffect(() => {
    if (!viewingShare || viewingShare.type !== 'screen' || !currentRoom) return;

    const partRef = doc(db, 'rooms', roomDocId(currentRoom), 'participants', viewingShare.participantId);
    const unsubscribe = onSnapshot(partRef, (snapshot) => {
      if (!snapshot.exists()) {
        if (viewingShare.participantId !== getMyId()) {
          setViewingShare(null);
          showToast('Screen presenter has left. Ending session.');
        }
        return;
      }
      const data = snapshot.data();
      if (!data.sharing && viewingShare.participantId !== getMyId()) {
        setViewingShare(null);
      }
    });
    return () => unsubscribe();
  }, [viewingShare?.participantId, viewingShare?.type, currentRoom, user, guestId]);

  // Real-time synchronization of chat messages inside calls
  useEffect(() => {
    if (!currentRoom) return;
    
    const messagesRef = collection(db, 'rooms', roomDocId(currentRoom), 'messages');
    
    const unsubscribe = onSnapshot(messagesRef, (snapshot) => {
      const list = snapshot.docs.map(docSnap => docSnap.data() as ChatMessage);
      
      // Filter out messages sent before the local user joined or refreshed this session
      const joinTime = localJoinTimeRef.current || Date.now();
      const filtered = list.filter(msg => {
        if (!msg.createdAt) return true;
        return new Date(msg.createdAt).getTime() >= joinTime;
      });

      // Sort client-side by createdAt to prevent query index requirements
      filtered.sort((a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeA - timeB;
      });
      setChatMessages(filtered);
    }, (error) => {
      console.warn("Firestore chat subscription failed:", error);
    });
    
    return () => unsubscribe();
  }, [currentRoom]);

  // Auto-scroll chat to bottom
  const prevMessagesLengthRef = useRef(0);
  const hasScrolledForTabRef = useRef<string | null>(null);

  useEffect(() => {
    const currentLength = chatMessages.length + systemMessages.length;
    const prevLength = prevMessagesLengthRef.current;
    
    if (callTab === 'chat' && chatEndRef.current) {
      const container = chatEndRef.current.parentElement;
      if (container) {
        const isTabSwitch = hasScrolledForTabRef.current !== callTab;
        const isNewMessage = currentLength > prevLength && prevLength > 0;
        
        if (isTabSwitch || prevLength === 0) {
          hasScrolledForTabRef.current = callTab;
          setTimeout(() => {
            chatEndRef.current?.scrollIntoView({ behavior: 'auto' });
          }, 50);
        } else if (isNewMessage) {
          const threshold = 150;
          const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
          if (isNearBottom) {
            chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
          }
        }
      }
    }
    
    prevMessagesLengthRef.current = currentLength;
  }, [chatMessages, systemMessages, callTab]);

  // Clean up screen presenting tracks when leaving call
  useEffect(() => {
    if (!currentRoom) {
      if (screenShareStream) {
        screenShareStream.getTracks().forEach(track => track.stop());
        setScreenShareStream(null);
      }
      setViewingShare(null);
    }
  }, [currentRoom, screenShareStream]);


  // Resize canvas when whiteboard view opens or draw color changes
  useEffect(() => {
    if (viewingShare?.type === 'whiteboard' && canvasRef.current) {
      const canvas = canvasRef.current;
      canvas.width = canvas.parentElement?.clientWidth || 800;
      canvas.height = canvas.parentElement?.clientHeight || 500;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.lineCap = 'round';
        ctx.lineWidth = 3;
        ctx.strokeStyle = drawColor;
      }
    }
  }, [viewingShare?.type]);

  // Mouse drawing handlers
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.strokeStyle = drawColor;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };

  const stopDrawing = async () => {
    setIsDrawing(false);
    const canvas = canvasRef.current;
    const myId = getMyId();
    if (canvas && currentRoom && viewingShare?.participantId === myId && viewingShare?.type === 'whiteboard') {
      const dataUrl = canvas.toDataURL();
      try {
        await updateDoc(doc(db, 'rooms', roomDocId(currentRoom), 'participants', myId), { whiteboardData: dataUrl });
      } catch (e) {
        console.warn("Failed to sync whiteboard to Firestore:", e);
      }
    }
  };

  // Touch drawing handlers (for mobile support)
  const startDrawingTouch = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(touch.clientX - rect.left, touch.clientY - rect.top);
    ctx.strokeStyle = drawColor;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    setIsDrawing(true);
  };

  const drawTouch = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(touch.clientX - rect.left, touch.clientY - rect.top);
    ctx.stroke();
  };

  const clearCanvas = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    showToast('Whiteboard cleared');
    if (currentRoom) {
      const myId = getMyId();
      try {
        await updateDoc(doc(db, 'rooms', roomDocId(currentRoom), 'participants', myId), { whiteboardData: '' });
      } catch (e) {
        console.warn("Failed to clear whiteboard in Firestore:", e);
      }
    }
  };

  // Screen share trigger
  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      });
      setScreenShareStream(stream);
      const myId = getMyId();
      await updateMySharing({ sharing: 'screen' });
      setViewingShare({ participantId: myId, type: 'screen' });
      
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          stopScreenShare();
        };
      }
      showToast('Screen sharing started — others can see the badge on your avatar');
    } catch (err) {
      console.error('Error starting screen share:', err);
      showToast('Screen share failed or cancelled');
    }
  };

  const stopScreenShare = async () => {
    if (screenShareStream) {
      screenShareStream.getTracks().forEach(track => track.stop());
      setScreenShareStream(null);
    }
    await clearMySharing();
    if (viewingShare?.type === 'screen') {
      setViewingShare(null);
    }
    showToast('Screen sharing stopped');
  };

  // Watch Together Submit Handler
  const handleWatchTogetherSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ytInputUrl.trim() || !currentRoom) return;

    const input = ytInputUrl.trim();
    if (isDrmBlockedUrl(input)) {
      showToast("This platform can't be embedded — try Screen Share instead.");
      return;
    }

    const parsed = parseMediaUrl(input);
    if (parsed) {
      setYtInputUrl('');
      const myId = getMyId();
      setYoutubeVideoId(input);

      try {
        await updateMySharing({ sharing: 'youtube', sharingYoutubeId: input, whiteboardData: '' });
        setViewingShare({ participantId: myId, type: 'youtube', youtubeVideoId: input });
        showToast(`${parsed.platform.toUpperCase()} media loaded — others can click your avatar to watch`);
      } catch (err) {
        console.warn("Failed to update Watch Together sharing state:", err);
        setViewingShare({ participantId: myId, type: 'youtube', youtubeVideoId: input });
        showToast(`${parsed.platform.toUpperCase()} media loaded locally!`);
      }
    } else {
      showToast("This platform can't be embedded — try Screen Share instead.");
    }
  };



  // Games Action Handlers
  const handleLaunchGame = (gameId: string) => {
    if (gameId === 'agar' || gameId === 'slither') {
      const url = gameId === 'agar' ? 'https://agar.io' : 'https://slither.io';
      window.open(url, '_blank');
      showToast(`Opened ${gameId === 'agar' ? 'Agar.io' : 'Slither.io'} in a new tab!`);
      setActiveToolDetail('none'); // Return to main panel
    } else {
      // Invite games
      setActiveGameId(gameId);
      const randomId = Math.random().toString(36).substring(2, 8);
      let prefilledLink = '';
      if (gameId === 'codenames') prefilledLink = `https://codenames.game/room/sklk-${randomId}`;
      if (gameId === 'skribbl') prefilledLink = `https://skribbl.io/?room=sklk-${randomId}`;
      if (gameId === 'jklm') prefilledLink = `https://jklm.fun/room/sklk-${randomId}`;
      setGameInviteInput(prefilledLink);
    }
  };

  const handleShareGameInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!gameInviteInput.trim()) return;

    // Open link in new tab
    window.open(gameInviteInput.trim(), '_blank');

    // Automatically post message to the room chat from "You"
    const gameNames: Record<string, string> = {
      codenames: 'Codenames',
      skribbl: 'Skribbl.io',
      jklm: 'JKLM.fun'
    };
    const gameName = gameNames[activeGameId || ''] || 'a game';
    
    const newMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: 'You',
      text: `🎮 Let's play ${gameName}! Join here: ${gameInviteInput.trim()}`
    };
    setChatMessages(prev => [...prev, newMsg]);

    showToast(`Invite link shared in chat!`);
    setActiveGameId(null);
    setActiveToolDetail('none');
  };

  // Pomodoro countdown effect
  useEffect(() => {
    let interval: any = null;
    if (pomodoroIsRunning) {
      interval = setInterval(() => {
        if (pomodoroSeconds > 0) {
          setPomodoroSeconds(prev => prev - 1);
        } else if (pomodoroMinutes > 0) {
          setPomodoroMinutes(prev => prev - 1);
          setPomodoroSeconds(59);
        } else {
          // Transition phase
          if (pomodoroPhase === 'focus') {
            setPomodoroPhase('break');
            setPomodoroMinutes(pomodoroBreakLength);
            setPomodoroSeconds(0);
            showToast('Focus session complete! Time for a short break.');
          } else {
            setPomodoroPhase('focus');
            setPomodoroMinutes(pomodoroFocusLength);
            setPomodoroSeconds(0);
            showToast('Break complete! Back to focus.');
          }
        }
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [pomodoroIsRunning, pomodoroMinutes, pomodoroSeconds, pomodoroPhase, pomodoroFocusLength, pomodoroBreakLength]);

  // Helper cleanups on leave room
  useEffect(() => {
    if (!currentRoom) {
      setPomodoroIsRunning(false);
      setPomodoroPhase('focus');
      setPomodoroMinutes(pomodoroFocusLength);
      setPomodoroSeconds(0);
      setYoutubeVideoId(null);
      setActiveToolDetail('none');
      setActiveGameId(null);

      // Reset Target list inputs
      setTargetInputText('');

      // Reset Deadline timer
      setDeadlineIsRunning(false);
      setDeadlineActiveIndex(0);
      setDeadlineTimerMinutes(0);
      setDeadlineTimerSeconds(0);

      // Reset Loose timer
      setLooseIsRunning(false);
      setLooseActiveIndex(0);
      setLooseTimerSeconds(0);
      setLooseSteps(prev => prev.map(s => ({ ...s, status: 'pending' as const, elapsedSeconds: 0 })));

      // Reset Truth or Dare spinner states
      setTodSpinResult(null);
      setTodSpinCheckedIds([]);
      setTodSpinPool([]);
      setTodState('idle');
      setTodChoice(null);
      setTodText('');
      setTodSelectedId('');
      setTodLocalSpinning(false);
      setSpinLocalSpinning(false);
    }
  }, [currentRoom, pomodoroFocusLength]);

  const togglePomodoro = async () => {
    const nextVal = !pomodoroIsRunning;
    if (currentRoom) {
      try {
        await updateDoc(doc(db, 'rooms', roomDocId(currentRoom)), { 
          pomodoroIsRunning: nextVal,
          pomodoroMinutes,
          pomodoroSeconds,
          pomodoroPhase
        });
      } catch {
        setPomodoroIsRunning(nextVal);
      }
    } else {
      setPomodoroIsRunning(nextVal);
    }
  };

  const skipPomodoroPhase = async () => {
    let nextPhase: 'focus' | 'break' = 'focus';
    let nextMinutes = pomodoroFocusLength;
    if (pomodoroPhase === 'focus') {
      nextPhase = 'break';
      nextMinutes = pomodoroBreakLength;
    }
    
    if (currentRoom) {
      try {
        await updateDoc(doc(db, 'rooms', roomDocId(currentRoom)), {
          pomodoroPhase: nextPhase,
          pomodoroMinutes: nextMinutes,
          pomodoroSeconds: 0
        });
        showToast(`Skipped to ${nextPhase} phase`);
      } catch {
        // local fallback
        setPomodoroPhase(nextPhase);
        setPomodoroMinutes(nextMinutes);
        setPomodoroSeconds(0);
      }
    } else {
      setPomodoroPhase(nextPhase);
      setPomodoroMinutes(nextMinutes);
      setPomodoroSeconds(0);
    }
  };

  const adjustPomodoroLength = async (type: 'focus' | 'break', amount: number) => {
    let nextFocus = pomodoroFocusLength;
    let nextBreak = pomodoroBreakLength;
    if (type === 'focus') {
      nextFocus = Math.max(1, pomodoroFocusLength + amount);
      setPomodoroFocusLength(nextFocus);
      if (!pomodoroIsRunning && pomodoroPhase === 'focus') {
        setPomodoroMinutes(nextFocus);
        setPomodoroSeconds(0);
      }
    } else {
      nextBreak = Math.max(1, pomodoroBreakLength + amount);
      setPomodoroBreakLength(nextBreak);
      if (!pomodoroIsRunning && pomodoroPhase === 'break') {
        setPomodoroMinutes(nextBreak);
        setPomodoroSeconds(0);
      }
    }
    
    if (currentRoom) {
      try {
        await updateDoc(doc(db, 'rooms', roomDocId(currentRoom)), {
          pomodoroMinutes: !pomodoroIsRunning && pomodoroPhase === 'focus' ? nextFocus : (!pomodoroIsRunning && pomodoroPhase === 'break' ? nextBreak : pomodoroMinutes),
          pomodoroSeconds: !pomodoroIsRunning ? 0 : pomodoroSeconds
        });
      } catch (e) {
        // ignore
      }
    }
  };

  // Room settings handlers (Privacy and topic changes)
  const handleChangeRoomType = async (type: 'public' | 'public-ask' | 'private') => {
    if (!currentRoom) return;
    const buttonText = type === 'public-ask' ? 'Ask to join' : 'Join';
    try {
      await updateDoc(doc(db, 'rooms', roomDocId(currentRoom)), { type, buttonText });
      showToast(`Privacy changed to: ${type === 'public' ? 'Public' : type === 'public-ask' ? 'Ask to Join' : 'Private'}`);
    } catch (e) {
      console.warn("Failed to change room privacy:", e);
    }
  };

  const handleChangeRoomName = async (newName: string) => {
    if (!currentRoom || !newName.trim()) return;
    try {
      await updateDoc(doc(db, 'rooms', roomDocId(currentRoom)), { name: newName.trim() });
      showToast(`Room topic updated to: ${newName.trim()}`);
    } catch (e) {
      console.warn("Failed to change room topic:", e);
    }
  };

  const handleChangeMaxParticipants = async (newVal: number) => {
    if (!currentRoom) return;
    if (isNaN(newVal)) return;

    if (newVal < 2 || newVal > 10) {
      showToast("⚠️ Maximum participants must be between 2 and 10.");
      setMaxPartInput(currentRoom.maxParticipants ?? 10);
      return;
    }

    const activeCount = callParticipants.length;
    if (newVal < activeCount) {
      showToast(`⚠️ Cannot set maximum below the current active count of ${activeCount}.`);
      setMaxPartInput(currentRoom.maxParticipants ?? 10);
      return;
    }

    try {
      await updateDoc(doc(db, 'rooms', roomDocId(currentRoom)), {
        maxParticipants: newVal
      });
      showToast(`Max participants updated to ${newVal}`);
    } catch (e) {
      console.warn("Failed to update maxParticipants in Firestore:", e);
      showToast("⚠️ Failed to update maximum participants.");
      setMaxPartInput(currentRoom.maxParticipants ?? 10);
    }
  };

  // Fun Tools & Settings Handlers
  const handleToggleFunTools = async (val: boolean) => {
    if (!currentRoom) return;
    try {
      await updateDoc(doc(db, 'rooms', roomDocId(currentRoom)), {
        allowFunTools: val
      });
      showToast(val ? "🔓 Fun tools enabled by host" : "🔒 Fun tools disabled by host");
    } catch (e) {
      console.warn("Failed to toggle fun tools:", e);
    }
  };

  const handleSpinTruthOrDare = async () => {
    if (!currentRoom || callParticipants.length === 0) return;

    const activeIds = todSpinCheckedIds.length > 0 
      ? todSpinCheckedIds.filter(id => callParticipants.some(p => p.id === id))
      : callParticipants.map(p => p.id);
      
    if (activeIds.length === 0) return;

    let candidates = todSpinPool.filter(id => activeIds.includes(id));
    if (candidates.length === 0) {
      candidates = [...activeIds];
    }

    const selectedId = candidates[Math.floor(Math.random() * candidates.length)];
    const newPool = candidates.filter(id => id !== selectedId);

    const idx = activeIds.indexOf(selectedId);
    const segmentAngle = 360 / activeIds.length;
    const targetAngle = 360 - (idx * segmentAngle + segmentAngle / 2);
    
    const prevAngle = todSpinResult ? todSpinResult.angle : 0;
    const prevFullSpins = Math.floor(prevAngle / 360);
    const newAngle = (prevFullSpins + 5) * 360 + targetAngle;

    const spunBy = user ? user.displayName || 'Google User' : guestName;

    try {
      await updateDoc(doc(db, 'rooms', roomDocId(currentRoom)), {
        todSpinResult: {
          selectedId,
          angle: newAngle,
          spunBy,
          timestamp: Date.now()
        },
        todSpinPool: newPool,
        todSpinCheckedIds: activeIds,
        todState: 'spinning',
        todChoice: null,
        todText: '',
        todSelectedId: selectedId
      });
    } catch (e) {
      console.warn("Failed to spin Truth or Dare:", e);
    }
  };

  const handleToggleTodSpinCheckedParticipant = async (id: string) => {
    if (!currentRoom) return;
    const defaultIds = callParticipants.map(p => p.id);
    const activeIds = todSpinCheckedIds.length > 0 ? todSpinCheckedIds : defaultIds;
    
    const nextChecked = activeIds.includes(id)
      ? activeIds.filter(x => x !== id)
      : [...activeIds, id];
      
    try {
      await updateDoc(doc(db, 'rooms', roomDocId(currentRoom)), {
        todSpinCheckedIds: nextChecked,
        todSpinPool: todSpinPool.filter(x => nextChecked.includes(x))
      });
    } catch (e) {
      console.warn("Failed to toggle tod spin participant:", e);
    }
  };

  const handleSelectTodChoice = async (choice: 'Truth' | 'Dare') => {
    if (!currentRoom) return;
    const questions = choice === 'Truth' ? truthQuestions : dareQuestions;
    const randomText = questions[Math.floor(Math.random() * questions.length)];
    try {
      await updateDoc(doc(db, 'rooms', roomDocId(currentRoom)), {
        todState: 'reveal',
        todChoice: choice,
        todText: randomText
      });
    } catch (e) {
      console.warn("Failed to select Truth or Dare choice:", e);
    }
  };

  const handleResetTod = async () => {
    if (!currentRoom) return;
    try {
      await updateDoc(doc(db, 'rooms', roomDocId(currentRoom)), {
        todState: 'idle',
        todChoice: null,
        todText: '',
        todSelectedId: ''
      });
    } catch (e) {
      console.warn("Failed to reset Truth or Dare:", e);
    }
  };

  // Spin the Wheel Handlers (Fairness Cycle Algorithm)
  const handleSpinWheel = async () => {
    if (!currentRoom || callParticipants.length === 0) return;
    
    // By default, if spinCheckedIds is empty, check all active participants
    const activeIds = spinCheckedIds.length > 0 
      ? spinCheckedIds.filter(id => callParticipants.some(p => p.id === id))
      : callParticipants.map(p => p.id);
      
    if (activeIds.length === 0) return;

    // Filter spinPool to only contain currently checked and present participants
    let candidates = spinPool.filter(id => activeIds.includes(id));
    
    // Fairness reset: If everyone has been picked or the pool is out-of-sync, refill it
    if (candidates.length === 0) {
      candidates = [...activeIds];
    }

    // Pick a random participant from the fairness candidates pool
    const selectedId = candidates[Math.floor(Math.random() * candidates.length)];
    const newPool = candidates.filter(id => id !== selectedId);

    // Calculate rotation angle targeting selected participant segment
    const idx = activeIds.indexOf(selectedId);
    const segmentAngle = 360 / activeIds.length;
    const targetAngle = 360 - (idx * segmentAngle + segmentAngle / 2);
    
    const prevAngle = spinResult ? spinResult.angle : 0;
    const prevFullSpins = Math.floor(prevAngle / 360);
    const newAngle = (prevFullSpins + 5) * 360 + targetAngle;

    const spunBy = user ? user.displayName || 'Google User' : guestName;

    try {
      await updateDoc(doc(db, 'rooms', roomDocId(currentRoom)), {
        spinResult: {
          selectedId,
          angle: newAngle,
          spunBy,
          timestamp: Date.now()
        },
        spinPool: newPool,
        spinCheckedIds: activeIds
      });
    } catch (e) {
      console.warn("Failed to spin wheel:", e);
    }
  };

  const handleToggleSpinCheckedParticipant = async (id: string) => {
    if (!currentRoom) return;
    const defaultIds = callParticipants.map(p => p.id);
    const activeIds = spinCheckedIds.length > 0 ? spinCheckedIds : defaultIds;
    
    const nextChecked = activeIds.includes(id)
      ? activeIds.filter(x => x !== id)
      : [...activeIds, id];
      
    try {
      await updateDoc(doc(db, 'rooms', roomDocId(currentRoom)), {
        spinCheckedIds: nextChecked,
        spinPool: spinPool.filter(x => nextChecked.includes(x))
      });
    } catch (e) {
      console.warn("Failed to toggle spin participant:", e);
    }
  };

  // Session Target Handlers
  const handleAddTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetInputText.trim()) return;
    
    const nextItem = { id: Date.now().toString(), text: targetInputText.trim(), completed: false };
    const nextList = [...targetsList, nextItem];
    
    if (user) {
      try {
        const userDocRef = doc(db, 'users', user.uid);
        await setDoc(userDocRef, { targetsList: nextList }, { merge: true });
      } catch (err) {
        console.error("Failed to add target to Firestore:", err);
      }
    } else {
      setTargetsList(nextList);
      localStorage.setItem('skulk_guest_targets_list', JSON.stringify(nextList));
    }
    
    setTargetInputText('');
    showToast('Weekly target added!');
  };

  const handleToggleTarget = async (id: string) => {
    const nextList = targetsList.map(t => t.id === id ? { ...t, completed: !t.completed } : t);
    
    if (user) {
      try {
        const userDocRef = doc(db, 'users', user.uid);
        await setDoc(userDocRef, { targetsList: nextList }, { merge: true });
      } catch (err) {
        console.error("Failed to toggle target in Firestore:", err);
      }
    } else {
      setTargetsList(nextList);
      localStorage.setItem('skulk_guest_targets_list', JSON.stringify(nextList));
    }
  };

  const handleStartNewWeek = async () => {
    const totalCount = targetsList.length;
    const completedCount = targetsList.filter(t => t.completed).length;
    const startOfWeek = new Date();
    const formattedDate = startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    
    const nextHistory = [
      { date: formattedDate, completedCount, totalCount },
      ...targetsHistory
    ];
    const nextList: any[] = [];
    
    if (user) {
      try {
        const userDocRef = doc(db, 'users', user.uid);
        await setDoc(userDocRef, {
          targetsList: nextList,
          targetsHistory: nextHistory
        }, { merge: true });
      } catch (err) {
        console.error("Failed to archive week in Firestore:", err);
      }
    } else {
      setTargetsList(nextList);
      setTargetsHistory(nextHistory);
      localStorage.setItem('skulk_guest_targets_list', JSON.stringify(nextList));
      localStorage.setItem('skulk_guest_targets_history', JSON.stringify(nextHistory));
    }
    
    showToast('Started new week! Archived progress to history.');
  };

  // Mini Deadline Clock Timer Effect
  useEffect(() => {
    let interval: any = null;
    if (deadlineIsRunning) {
      interval = setInterval(() => {
        if (deadlineTimerSeconds > 0) {
          setDeadlineTimerSeconds(prev => prev - 1);
        } else if (deadlineTimerMinutes > 0) {
          setDeadlineTimerMinutes(prev => prev - 1);
          setDeadlineTimerSeconds(59);
        } else {
          // Time is up!
          setDeadlineIsRunning(false);
          showToast(`Deadline reached for ${deadlineSteps[deadlineActiveIndex]?.name || 'current step'}!`);
        }
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [deadlineIsRunning, deadlineTimerMinutes, deadlineTimerSeconds, deadlineActiveIndex, deadlineSteps]);

  const startDeadlineTimer = () => {
    const currentStep = deadlineSteps[deadlineActiveIndex];
    if (deadlineTimerMinutes === 0 && deadlineTimerSeconds === 0 && currentStep && currentStep.minutes > 0) {
      setDeadlineTimerMinutes(currentStep.minutes);
      setDeadlineTimerSeconds(0);
    }
    setDeadlineIsRunning(true);
  };

  const resetDeadlineTimer = () => {
    setDeadlineIsRunning(false);
    const currentStep = deadlineSteps[deadlineActiveIndex];
    setDeadlineTimerMinutes(currentStep ? currentStep.minutes : 0);
    setDeadlineTimerSeconds(0);
    showToast('Step timer reset');
  };

  const finishDeadlineStep = () => {
    setDeadlineIsRunning(false);
    if (deadlineActiveIndex < deadlineSteps.length - 1) {
      const nextIndex = deadlineActiveIndex + 1;
      setDeadlineActiveIndex(nextIndex);
      const nextStep = deadlineSteps[nextIndex];
      setDeadlineTimerMinutes(nextStep ? nextStep.minutes : 0);
      setDeadlineTimerSeconds(0);
      showToast(`Advanced to next step: ${nextStep?.name}`);
    } else {
      showToast('All deadline steps completed!');
    }
  };

  const adjustDeadlineMinutes = (id: string, amount: number) => {
    setDeadlineSteps(prev => prev.map(step => 
      step.id === id 
        ? { ...step, minutes: Math.max(0, step.minutes + amount) }
        : step
    ));
    
    // Sync current active step's timer state if not running
    const stepIdx = deadlineSteps.findIndex(s => s.id === id);
    if (stepIdx === deadlineActiveIndex && !deadlineIsRunning) {
      setDeadlineTimerMinutes(prev => Math.max(0, prev + amount));
      setDeadlineTimerSeconds(0);
    }
  };

  const deleteDeadlineStep = (id: string) => {
    const stepIdx = deadlineSteps.findIndex(s => s.id === id);
    if (deadlineSteps.length <= 1) {
      showToast('Cannot delete the last remaining step!');
      return;
    }
    
    setDeadlineSteps(prev => prev.filter(step => step.id !== id));
    
    if (stepIdx === deadlineActiveIndex) {
      const nextIndex = Math.min(deadlineActiveIndex, deadlineSteps.length - 2);
      setDeadlineActiveIndex(nextIndex);
      setDeadlineIsRunning(false);
      setDeadlineTimerMinutes(0);
      setDeadlineTimerSeconds(0);
    } else if (stepIdx < deadlineActiveIndex) {
      setDeadlineActiveIndex(prev => prev - 1);
    }
    showToast('Step deleted');
  };

  const handleAddDeadlineStep = (e: React.FormEvent) => {
    e.preventDefault();
    if (!deadlineNewStepName.trim()) return;
    setDeadlineSteps(prev => [...prev, { id: Date.now().toString(), name: deadlineNewStepName.trim(), minutes: 0 }]);
    setDeadlineNewStepName('');
    setIsAddingDeadlineStep(false);
    showToast('Deadline step added!');
  };

  const resetDeadlineClockDefault = () => {
    setDeadlineIsRunning(false);
    setDeadlineActiveIndex(0);
    setDeadlineTimerMinutes(0);
    setDeadlineTimerSeconds(0);
    setDeadlineSteps([
      { id: 'd1', name: 'Notes', minutes: 0 },
      { id: 'd2', name: 'Solve without hints', minutes: 0 },
      { id: 'd3', name: 'Solve with hint', minutes: 0 },
      { id: 'd4', name: 'Analyse', minutes: 0 },
      { id: 'd5', name: 'Notes', minutes: 0 }
    ]);
    showToast('Reset steps to default');
  };

  // Loose Timer Effect
  useEffect(() => {
    let interval: any = null;
    if (looseIsRunning) {
      // Mark active step as 'active' status if it's pending
      setLooseSteps(prev => prev.map((step, idx) => 
        idx === looseActiveIndex && step.status === 'pending'
          ? { ...step, status: 'active' as const }
          : step
      ));
      
      interval = setInterval(() => {
        setLooseTimerSeconds(prev => prev + 1);
        setLooseSteps(prev => prev.map((step, idx) => 
          idx === looseActiveIndex 
            ? { ...step, elapsedSeconds: step.elapsedSeconds + 1 }
            : step
        ));
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [looseIsRunning, looseActiveIndex]);

  // Synchronize Spin the Wheel pointer rotation animation duration
  useEffect(() => {
    if (spinResult) {
      setSpinLocalSpinning(true);
      const timer = setTimeout(() => {
        setSpinLocalSpinning(false);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [spinResult?.timestamp]);

  // Synchronize Truth or Dare spinning animation and host/admin state transition
  useEffect(() => {
    if (todSpinResult && todState === 'spinning') {
      setTodLocalSpinning(true);
      const timer = setTimeout(() => {
        setTodLocalSpinning(false);
        const myId = getMyId();
        const myPresence = callParticipants.find(p => p.id === myId);
        const isHost = myPresence?.role === 'host' || myPresence?.role === 'cohost' || myPresence?.role === 'admin';
        if (isHost && currentRoom) {
          updateDoc(doc(db, 'rooms', roomDocId(currentRoom)), {
            todState: 'choice'
          }).catch((e) => console.warn("Failed to transition todState to choice:", e));
        }
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [todSpinResult?.timestamp, todState]);

  const finishLooseStep = () => {
    setLooseSteps(prev => prev.map((step, idx) => 
      idx === looseActiveIndex 
        ? { ...step, status: 'completed' as const }
        : step
    ));
    
    if (looseActiveIndex < looseSteps.length - 1) {
      const nextIndex = looseActiveIndex + 1;
      setLooseActiveIndex(nextIndex);
      setLooseTimerSeconds(0);
      showToast(`Advanced to next step: ${looseSteps[nextIndex]?.name}`);
    } else {
      setLooseIsRunning(false);
      showToast('All loose steps completed!');
    }
  };

  const resetLooseTimer = () => {
    setLooseIsRunning(false);
    setLooseActiveIndex(0);
    setLooseTimerSeconds(0);
    setLooseSteps(prev => prev.map(step => ({ ...step, status: 'pending' as const, elapsedSeconds: 0 })));
    showToast('Loose timer reset');
  };

  const handleAddLooseStep = (e: React.FormEvent) => {
    e.preventDefault();
    if (!looseNewStepName.trim()) return;
    setLooseSteps(prev => [...prev, { id: Date.now().toString(), name: looseNewStepName.trim(), status: 'pending', elapsedSeconds: 0 }]);
    setLooseNewStepName('');
    setIsAddingLooseStep(false);
    showToast('Loose step added!');
  };

  const deleteLooseStep = (id: string) => {
    const stepIdx = looseSteps.findIndex(s => s.id === id);
    if (looseSteps.length <= 1) {
      showToast('Cannot delete the last remaining step!');
      return;
    }
    
    setLooseSteps(prev => prev.filter(step => step.id !== id));
    
    if (stepIdx === looseActiveIndex) {
      const nextIndex = Math.min(looseActiveIndex, looseSteps.length - 2);
      setLooseActiveIndex(nextIndex);
      setLooseIsRunning(false);
      setLooseTimerSeconds(0);
    } else if (stepIdx < looseActiveIndex) {
      setLooseActiveIndex(prev => prev - 1);
    }
    showToast('Step deleted');
  };

  const resetLooseClockDefault = () => {
    setLooseIsRunning(false);
    setLooseActiveIndex(0);
    setLooseTimerSeconds(0);
    setLooseSteps([
      { id: 'l1', name: 'Notes', status: 'pending', elapsedSeconds: 0 },
      { id: 'l2', name: 'Solve without hints', status: 'pending', elapsedSeconds: 0 },
      { id: 'l3', name: 'Solve with hint', status: 'pending', elapsedSeconds: 0 },
      { id: 'l4', name: 'Analyse', status: 'pending', elapsedSeconds: 0 },
      { id: 'l5', name: 'Notes', status: 'pending', elapsedSeconds: 0 }
    ]);
    showToast('Reset steps to default');
  };

  // Submit Handler for modal creation
  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newMaxParticipants === 0) {
      showToast("At least 1 participant is required");
      return;
    }

    const randomId = Math.random().toString(36).substring(2, 8);
    const roomLink = `${window.location.origin}/room/${randomId}`;

    const roomDetails = {
      name: newRoomName || 'Untitled Room',
      type: newRoomType,
      maxParticipants: newMaxParticipants,
      startOption,
      scheduledDate: startOption === 'later' ? scheduleDate : undefined,
      scheduledTime: startOption === 'later' ? scheduleTime : undefined,
      link: roomLink
    };

    console.log('Creating room:', roomDetails);

    const newRoomObj: Room = {
      id: randomId,
      name: roomDetails.name,
      type: roomDetails.type,
      buttonText: roomDetails.type === 'public-ask' ? 'Ask to join' : 'Join',
      participants: [], 
      maxParticipants: roomDetails.maxParticipants,
      link: roomDetails.link,
      creatorId: getMyId(),
      creatorName: user ? user.displayName || 'Google User' : 'Unknown',
      createdAt: new Date().toISOString()
    };

    if (roomDetails.scheduledDate !== undefined) {
      newRoomObj.scheduledDate = roomDetails.scheduledDate;
    }
    if (roomDetails.scheduledTime !== undefined) {
      newRoomObj.scheduledTime = roomDetails.scheduledTime;
    }

    try {
      const myId = getMyId();
      if (myId) {
        const limitDocRef = doc(db, 'users', myId);
        const limitSnap = await getDoc(limitDocRef);
        if (limitSnap.exists()) {
          const limitData = limitSnap.data();
          const lastCreated = limitData.lastRoomCreatedTime?.toDate?.()?.getTime() || 0;
          if (Date.now() - lastCreated < 5000) {
            showToast("Slow down! Please wait a few seconds before creating another room.");
            return;
          }
        }
        await setDoc(limitDocRef, { lastRoomCreatedTime: serverTimestamp() }, { merge: true });
      }

      await setDoc(doc(db, 'rooms', newRoomObj.id), newRoomObj);
      setGeneratedRoomLink(roomLink);
      setModalStep('confirmation');
    } catch (err) {
      console.warn('Error saving room to Firestore, fallback to local creation:', err);
      saveLocalRoom(newRoomObj); // Save to localStorage so it persists on refresh!
      setRooms(prev => {
        if (prev.some(r => r.id === newRoomObj.id)) return prev;
        return [...prev, newRoomObj];
      });
      setGeneratedRoomLink(roomLink);
      setModalStep('confirmation');
      
      showToast(`⚠️ Database Write Blocked (Permission Denied). Room created locally. Please enable read/write rules in your Firebase Console.`);
    }
  };

  // Clipboard copy helper
  const handleCopyLink = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(generatedRoomLink);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  // Save guest profile edits
  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileEditName.trim()) return;

    // Generate initials from first letters
    const words = profileEditName.trim().split(/\s+/);
    let initials = 'G';
    if (words.length >= 2) {
      initials = (words[0][0] + words[1][0]).toUpperCase();
    } else if (words[0].length >= 2) {
      initials = words[0].substring(0, 2).toUpperCase();
    } else if (words[0].length > 0) {
      initials = words[0][0].toUpperCase();
    }

    const photoURLVal = profileEditPhotoURL.trim() || null;

    setGuestName(profileEditName);
    setGuestColor(profileEditColor);
    setGuestInitials(initials);
    setGuestPhotoURL(photoURLVal);

    localStorage.setItem('skulk_guest_identity', JSON.stringify({ 
      name: profileEditName, 
      color: profileEditColor, 
      initials,
      photoURL: photoURLVal
    }));
    setIsProfileModalOpen(false);
    showToast('Profile updated!');
  };

  // Reusable chat sending function for both main app and PiP window
  const sendChatMessage = async (text: string) => {
    if (!text.trim() || !currentRoom) return;

    const senderName = user ? user.displayName || 'Google User' : guestName;
    const myId = getMyId();
    const myRole = callParticipants.find(p => p.id === myId)?.role || determineRole(currentRoom.creatorId);

    const msgId = Date.now().toString();
    const newMsg: ChatMessage = {
      id: msgId,
      sender: senderName,
      senderId: myId,
      senderRole: myRole,
      text: text.trim(),
      createdAt: new Date().toISOString()
    };

    try {
      await setDoc(doc(db, 'rooms', roomDocId(currentRoom), 'messages', msgId), newMsg);
    } catch (err) {
      console.warn("Failed to write chat to Firestore, fallback locally:", err);
      setChatMessages(prev => [...prev, newMsg]);
      showToast('Message saved locally — check your connection');
    }
  };

  // Local chat submission
  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessageText.trim()) return;
    await sendChatMessage(chatMessageText);
    setChatMessageText('');
  };

  // Co-host control triggers (Mute, Pin, Remove)
  const handleParticipantMuteToggle = async (id: string, name: string) => {
    if (!currentRoom) return;
    const rid = roomDocId(currentRoom);
    const target = callParticipants.find(p => p.id === id);
    if (!target) return;
    const nextMute = !target.isMuted;
    try {
      await updateDoc(doc(db, 'rooms', rid, 'participants', id), { isMuted: nextMute, mutedBy: getMyId() });
      showToast(nextMute ? `Muted ${name}` : `Unmuted ${name}`);
    } catch (e) {
      console.warn("Failed to toggle remote mute in Firestore:", e);
    }
    setActiveMenuParticipantId(null);
  };

  const handleParticipantPinToggle = (id: string, name: string) => {
    setCallParticipants(prev => prev.map(p => {
      if (p.id === id) {
        const nextPin = !p.isPinned;
        showToast(nextPin ? `Pinned ${name}` : `Unpinned ${name}`);
        return { ...p, isPinned: nextPin };
      }
      return p;
    }));
    setActiveMenuParticipantId(null);
  };

  const handleParticipantRemove = async (id: string, name: string) => {
    if (!currentRoom) return;
    const rid = roomDocId(currentRoom);
    try {
      await deleteDoc(doc(db, 'rooms', rid, 'participants', id));
      const signalsRef = collection(db, 'rooms', rid, 'signals');
      const snapshot = await getDocs(signalsRef);
      snapshot.forEach(async (docSnap) => {
        if (docSnap.id.includes(id)) {
          try {
            await deleteDoc(docSnap.ref);
          } catch (e) {}
        }
      });
      showToast(`Kicked ${name} from room`);
    } catch (e) {
      console.warn("Failed to kick participant from Firestore:", e);
      setCallParticipants(prev => prev.filter(p => p.id !== id));
      showToast(`Removed ${name} from room`);
    }
    setActiveMenuParticipantId(null);
  };

  const handleParticipantRoleChange = async (id: string, newRole: 'host' | 'cohost' | 'member') => {
    if (!currentRoom) return;
    const rid = roomDocId(currentRoom);
    try {
      await updateDoc(doc(db, 'rooms', rid, 'participants', id), { role: newRole });
      showToast(`Updated role to ${newRole}`);
    } catch (e) {
      console.warn("Failed to update role in Firestore:", e);
    }
    setActiveMenuParticipantId(null);
  };

  const handleParticipantCameraToggle = async (id: string, name: string) => {
    if (!currentRoom) return;
    const rid = roomDocId(currentRoom);
    const target = callParticipants.find(p => p.id === id);
    if (!target) return;
    
    const nextVal = !target.isCamOff;
    try {
      await updateDoc(doc(db, 'rooms', rid, 'participants', id), { isCamOff: nextVal, camOffBy: getMyId() });
      showToast(`${nextVal ? 'Disabled' : 'Enabled'} camera for ${name}`);
    } catch (e) {
      console.warn("Failed to toggle remote camera in Firestore:", e);
    }
    setActiveMenuParticipantId(null);
  };
  const handleEndRoom = async () => {
    if (!currentRoom) return;
    const rid = roomDocId(currentRoom);
    try {
      // Clean up localStorage first
      const local = getLocalRooms();
      const updatedLocal = local.filter(r => r.id !== rid);
      localStorage.setItem('skulk_local_rooms', JSON.stringify(updatedLocal));

      // 1. Delete the main room document (triggers snapshot callback on all clients to leave)
      await deleteDoc(doc(db, 'rooms', rid));
      
      // 2. Clean up participants collection
      const presenceRef = collection(db, 'rooms', rid, 'participants');
      const snapshot = await getDocs(presenceRef);
      for (const docSnap of snapshot.docs) {
        try {
          await deleteDoc(docSnap.ref);
        } catch (e) {
          // Ignore if already deleted by other clients concurrently
        }
      }
      
      showToast("Room closed successfully.");
    } catch (e) {
      console.warn("Failed to delete room:", e);
      showToast("Failed to close room.");
    } finally {
      // Always leave call client-side to redirect to dashboard and reset local states!
      handleLeaveCall();
    }
  };

  // Format date nicely for human eyes
  const formatFriendlyDate = (dateStr?: string) => {
    if (!dateStr) return '';
    try {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
    } catch (e) {
      // fallback
    }
    return dateStr;
  };

  const formatRoomCreatedAt = (createdAtStr?: string) => {
    if (!createdAtStr) return '';
    try {
      const date = new Date(createdAtStr);
      if (isNaN(date.getTime())) return '';

      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);

      if (diffMs < 0) {
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }

      if (diffMins < 1) {
        return 'Just now';
      }
      if (diffMins < 60) {
        return `${diffMins}m ago`;
      }
      if (diffHours < 24) {
        return `${diffHours}h ago`;
      }
      
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  };


  const getGalleryColumns = (count: number) => {
    if (count === 1) return '1fr';
    if (count === 2) return 'repeat(2, 1fr)';
    if (count <= 4) return 'repeat(2, 1fr)';
    if (count <= 6) return 'repeat(3, 1fr)';
    return 'repeat(auto-fit, minmax(280px, 1fr))';
  };

  const getGalleryMaxWidth = (count: number) => {
    if (count === 1) return '800px';
    if (count === 2) return '1000px';
    if (count <= 4) return '1000px';
    return '100%';
  };

  const renderParticipantTile = (p: Participant, isThumbnail: boolean = false) => {
    const isUser = p.id === getMyId();
    const showMuted = isUser ? isMicMuted : p.isMuted;
    const showCamOff = isUser ? isCamOff : p.isCamOff;
    const isSpeaking = p.isSpeaking && !showMuted;
    
    return (
      <div 
        key={p.id} 
        className={`${isThumbnail ? 'spotlight-thumbnail-tile' : 'participant-tile'} ${isUser ? 'user-tile' : ''} ${isSpeaking ? 'speaker-active' : ''} ${p.id === spotlightParticipantId && isThumbnail ? 'active' : ''}`}
        onClick={() => {
          if (isThumbnail) {
            setSpotlightParticipantId(p.id);
          } else if (!spotlightParticipantId) {
            setSpotlightParticipantId(p.id);
          }
        }}
        style={{ cursor: 'pointer' }}
      >
        {isGalleryView && !isThumbnail ? (
          // Gallery Layout: Full Card Video/Avatar
          !showCamOff ? (
            <>
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
                <ParticipantVideo participantId={p.id} />
              )}
              
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
          ) : (
            /* Avatar Square (Gallery Mode) */
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
          )
        ) : (
          // Compact Grid Layout OR Thumbnail view: Floating Avatar
          <div 
            className="participant-avatar-large" 
            style={{ 
              backgroundColor: p.color, 
              cursor: p.sharing ? 'pointer' : 'default',
              position: 'relative',
              boxShadow: p.sharing ? '0 0 12px var(--primary-color)' : 'none',
              border: p.sharing ? '2px solid var(--primary-color)' : 'none',
              overflow: 'hidden',
              // Shrink for thumbnail strip
              ...isThumbnail ? { width: '48px', height: '48px', minWidth: '48px' } : {}
            }}
            onClick={() => {
              if (p.sharing) {
                handleViewParticipantShare(p);
              }
            }}
          >
            {!showCamOff && !(isUser && cameraError) ? (
              <ParticipantVideo participantId={p.id} />
            ) : p.photoURL ? (
              <img 
                src={p.photoURL} 
                alt={p.name} 
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                referrerPolicy="no-referrer"
              />
            ) : (
              p.initials
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
        
        {/* Name Tag + Muted Status */}
        {!isThumbnail && (
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
            {showMuted && (
              <svg className="tile-icon-muted" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="1" y1="1" x2="23" y2="23"></line>
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
                <line x1="12" y1="19" x2="12" y2="23"></line>
                <line x1="8" y1="23" x2="16" y2="23"></line>
              </svg>
            )}
            {p.isPinned && (
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--primary-color)' }}>
                <line x1="12" y1="17" x2="12" y2="22"></line>
                <path d="M5 17h14v-1.76a2 2 0 0 0-.44-1.24l-2.33-2.91a2 2 0 0 1-.43-1.23V4a1 1 0 0 0-1-1h-5.6a1 1 0 0 0-1 1v5.86c0 .44-.16.86-.43 1.23l-2.33 2.91a2 2 0 0 0-.44 1.24V17Z"></path>
              </svg>
            )}
          </div>
        )}
  
        {/* Host Actions Hover Trigger Menu */}
        {!isThumbnail && !isUser && (callParticipants.find(part => part.id === getMyId())?.role === 'admin' || 
                                     callParticipants.find(part => part.id === getMyId())?.role === 'host' || 
                                     callParticipants.find(part => part.id === getMyId())?.role === 'cohost') && (
          <div ref={sidebarMenuRef}>
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
                {checkCanMute(callParticipants.find(part => part.id === getMyId())?.role || 'member', p.role || 'member') && (
                  <button 
                    onClick={() => handleParticipantMuteToggle(p.id, p.name)} 
                    className="tile-menu-item"
                  >
                    {p.isMuted ? 'Unmute' : 'Mute'}
                  </button>
                )}
                
                {/* Camera off action */}
                {checkCanMute(callParticipants.find(part => part.id === getMyId())?.role || 'member', p.role || 'member') && (
                  <button 
                    onClick={() => handleParticipantCameraToggle(p.id, p.name)} 
                    className="tile-menu-item"
                  >
                    {p.isCamOff ? 'Turn camera on' : 'Turn camera off'}
                  </button>
                )}
                
                {/* Pin action */}
                <button 
                  onClick={() => handleParticipantPinToggle(p.id, p.name)} 
                  className="tile-menu-item"
                >
                  {p.isPinned ? 'Unpin' : 'Pin'}
                </button>
                
                {/* Role Promotion/Demotion Actions */}
                {callParticipants.find(part => part.id === getMyId())?.role === 'admin' && (
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
  
                {callParticipants.find(part => part.id === getMyId())?.role === 'host' && (
                  <>
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
                {checkCanKick(callParticipants.find(part => part.id === getMyId())?.role || 'member', p.role || 'member') && (
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
  };

  // Filtered rooms based on name search
  const filteredRooms = rooms.filter(room => {
    if (room.type === 'private') {
      return false;
    }
    return room.name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  if (isAuthLoading) {
    return (
      <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: '16px' }}>
        <div 
          style={{ 
            width: '40px', 
            height: '40px', 
            borderRadius: '50%',
            border: '3px solid rgba(255,255,255,0.1)', 
            borderTopColor: 'var(--primary-color)', 
            animation: 'spin 1s linear infinite' 
          }}
        />
        <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Loading profile...</span>
      </div>
    );
  }

  const renderPomodoroUI = (isExpanded: boolean) => {
    return (
      <div className={`pomodoro-panel-container ${isExpanded ? 'expanded' : ''}`}>
        {/* Timer circle display */}
        <div className={`pomodoro-timer-circle ${pomodoroPhase === 'focus' ? 'active-focus' : 'active-break'} ${isExpanded ? 'expanded' : ''}`}>
          <span className="pomodoro-time-digits">
            {pomodoroMinutes.toString().padStart(2, '0')}:
            {pomodoroSeconds.toString().padStart(2, '0')}
          </span>
          <span className={`pomodoro-phase-label ${pomodoroPhase}`}>
            {pomodoroPhase === 'focus' ? 'Focus Session' : 'Short Break'}
          </span>
        </div>

        {/* Host Controls */}
        <div className="pomodoro-button-row">
          <button 
            onClick={togglePomodoro} 
            className="btn-create" 
            style={{ 
              padding: '8px 16px', 
              fontSize: '13px', 
              backgroundColor: pomodoroIsRunning ? 'var(--button-secondary-bg)' : 'var(--primary-color)',
              color: pomodoroIsRunning ? 'var(--text-primary)' : 'var(--primary-text)',
              border: '1px solid var(--border-color)' 
            }}
          >
            {pomodoroIsRunning ? 'Pause' : 'Start'}
          </button>
          
          <button 
            onClick={skipPomodoroPhase} 
            className="btn-signin" 
            style={{ padding: '8px 16px', fontSize: '13px', backgroundColor: 'var(--button-secondary-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
          >
            Skip
          </button>
        </div>

        {/* Adjust Lengths Row controls */}
        <div className="pomodoro-adjusters-container">
          {/* Focus adjust */}
          <div className="pomodoro-adjust-row">
            <span className="pomodoro-adjust-label">Focus Length</span>
            <div className="pomodoro-adjust-controls">
              <button type="button" onClick={() => adjustPomodoroLength('focus', -1)} className="pomodoro-adjust-btn">-</button>
              <span className="pomodoro-adjust-val">{pomodoroFocusLength}m</span>
              <button type="button" onClick={() => adjustPomodoroLength('focus', 1)} className="pomodoro-adjust-btn">+</button>
            </div>
          </div>

          {/* Break adjust */}
          <div className="pomodoro-adjust-row">
            <span className="pomodoro-adjust-label">Break Length</span>
            <div className="pomodoro-adjust-controls">
              <button type="button" onClick={() => adjustPomodoroLength('break', -1)} className="pomodoro-adjust-btn">-</button>
              <span className="pomodoro-adjust-val">{pomodoroBreakLength}m</span>
              <button type="button" onClick={() => adjustPomodoroLength('break', 1)} className="pomodoro-adjust-btn">+</button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderDeadlineUI = (isExpanded: boolean) => {
    return (
      <div className={`deadline-panel-container ${isExpanded ? 'expanded' : ''}`} style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
        {/* Top Area: Current Step + Countdown */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: '16px' }}>
          <span style={{ fontSize: '9px', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.05em' }}>CURRENT STEP</span>
          <span style={{ fontSize: isExpanded ? '18px' : '13px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '2px' }}>
            {deadlineActiveIndex + 1}. {deadlineSteps[deadlineActiveIndex]?.name || 'No steps'}
          </span>
          <span style={{ fontSize: isExpanded ? '56px' : '32px', fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-primary)', margin: '8px 0' }}>
            {deadlineTimerMinutes.toString().padStart(2, '0')}:
            {deadlineTimerSeconds.toString().padStart(2, '0')}
          </span>

          {/* Control Row */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <button 
              onClick={deadlineIsRunning ? () => setDeadlineIsRunning(false) : startDeadlineTimer} 
              className="btn-create" 
              style={{ 
                padding: '6px 12px', 
                fontSize: '12px', 
                display: 'flex', 
                alignItems: 'center', 
                gap: '4px',
                backgroundColor: deadlineIsRunning ? 'var(--button-secondary-bg)' : 'var(--primary-color)',
                color: deadlineIsRunning ? 'var(--text-primary)' : 'var(--primary-text)'
              }}
            >
              {deadlineIsRunning ? 'Pause' : 'Start'}
            </button>
            <button 
              onClick={finishDeadlineStep} 
              className="btn-signin" 
              style={{ padding: '6px 12px', fontSize: '12px', backgroundColor: 'var(--button-secondary-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            >
              Finish step
            </button>
            <button 
              onClick={resetDeadlineTimer} 
              className="btn-signin" 
              style={{ padding: '6px 8px', fontSize: '12px', backgroundColor: 'var(--button-secondary-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              title="Reset step timer"
            >
              🔄
            </button>
          </div>
        </div>

        {/* Middle Area: Scrollable Step List */}
        <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', padding: '12px 0', height: isExpanded ? '320px' : '220px', overflowY: 'auto' }}>
          <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>
            STEPS · SCROLL FOR MORE
          </span>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {deadlineSteps.map((step, idx) => {
              const isActive = idx === deadlineActiveIndex;
              return (
                <div 
                  key={step.id} 
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between',
                    backgroundColor: isActive ? 'rgba(241, 196, 15, 0.08)' : 'rgba(255, 255, 255, 0.01)',
                    border: isActive ? '1px solid var(--primary-color)' : '1px solid var(--border-color)',
                    borderRadius: 'var(--btn-radius)',
                    padding: '8px 10px',
                    transition: 'all var(--transition-speed) ease'
                  }}
                >
                  {/* Dot + Step Title */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                    <div 
                      style={{ 
                        width: '8px', 
                        height: '8px', 
                        borderRadius: '50%', 
                        border: '1px solid var(--text-secondary)',
                        backgroundColor: isActive ? 'var(--primary-color)' : 'transparent',
                        flexShrink: 0
                      }}
                    />
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {idx + 1}. {step.name}
                    </span>
                  </div>

                  {/* Budget Controls */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '12px', flexShrink: 0 }}>
                    <button 
                      type="button" 
                      onClick={() => adjustDeadlineMinutes(step.id, -1)} 
                      style={{ width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-color)', borderRadius: '3px', backgroundColor: 'var(--button-secondary-bg)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}
                    >-</button>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '32px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>{step.minutes}</span>
                      <span style={{ fontSize: '8px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>min</span>
                    </div>
                    <button 
                      type="button" 
                      onClick={() => adjustDeadlineMinutes(step.id, 1)} 
                      style={{ width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-color)', borderRadius: '3px', backgroundColor: 'var(--button-secondary-bg)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}
                    >+</button>
                    <button 
                      type="button" 
                      onClick={() => deleteDeadlineStep(step.id)} 
                      style={{ width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: '3px', backgroundColor: 'transparent', color: '#ef4444', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold', marginLeft: '4px' }}
                      title="Delete step"
                    >×</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom Area: Add step and Reset controls */}
        <div style={{ paddingTop: '12px' }}>
          {isAddingDeadlineStep ? (
            <form 
              onSubmit={handleAddDeadlineStep} 
              style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}
            >
              <input 
                type="text"
                placeholder="Step name..."
                className="search-input"
                style={{ paddingLeft: '8px', fontSize: '12px', height: '32px' }}
                value={deadlineNewStepName}
                onChange={(e) => setDeadlineNewStepName(e.target.value)}
                autoFocus
                required
              />
              <button type="submit" className="btn-signin" style={{ padding: '0 12px', height: '32px', fontSize: '12px' }}>
                Add
              </button>
              <button type="button" onClick={() => setIsAddingDeadlineStep(false)} className="btn-signin" style={{ padding: '0 8px', height: '32px', fontSize: '12px', backgroundColor: 'transparent', border: 'none' }}>
                Cancel
              </button>
            </form>
          ) : (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                onClick={() => setIsAddingDeadlineStep(true)} 
                className="btn-signin" 
                style={{ flex: 1, padding: '8px', fontSize: '12px', backgroundColor: 'var(--button-secondary-bg)', border: '1px solid var(--border-color)' }}
              >
                + Add step
              </button>
              <button 
                onClick={resetDeadlineClockDefault} 
                className="btn-signin" 
                style={{ flex: 1, padding: '8px', fontSize: '12px', backgroundColor: 'var(--button-secondary-bg)', border: '1px solid var(--border-color)' }}
              >
                Reset to default
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderLooseTimerUI = (isExpanded: boolean) => {
    return (
      <div className={`loose-panel-container ${isExpanded ? 'expanded' : ''}`} style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
        {/* Top Area: Current Step + Countup */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: '16px' }}>
          <span style={{ fontSize: '9px', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.05em' }}>CURRENT FOCUS STEP</span>
          <span style={{ fontSize: isExpanded ? '18px' : '13px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '2px' }}>
            {looseActiveIndex + 1}. {looseSteps[looseActiveIndex]?.name || 'No steps'}
          </span>
          <span style={{ fontSize: isExpanded ? '56px' : '32px', fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-primary)', margin: '8px 0' }}>
            {Math.floor(looseTimerSeconds / 60).toString().padStart(2, '0')}:
            {(looseTimerSeconds % 60).toString().padStart(2, '0')}
          </span>

          {/* Control Row */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <button 
              onClick={() => setLooseIsRunning(!looseIsRunning)} 
              className="btn-create" 
              style={{ 
                padding: '6px 12px', 
                fontSize: '12px', 
                backgroundColor: looseIsRunning ? 'var(--button-secondary-bg)' : 'var(--primary-color)',
                color: looseIsRunning ? 'var(--text-primary)' : 'var(--primary-text)'
              }}
            >
              {looseIsRunning ? 'Pause' : 'Start'}
            </button>
            <button 
              onClick={finishLooseStep} 
              className="btn-signin" 
              style={{ padding: '6px 12px', fontSize: '12px', backgroundColor: 'var(--button-secondary-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            >
              Finish step
            </button>
            <button 
              onClick={resetLooseClockDefault} 
              className="btn-signin" 
              style={{ padding: '6px 8px', fontSize: '12px', backgroundColor: 'var(--button-secondary-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              title="Reset timer"
            >
              🔄
            </button>
          </div>
        </div>

        {/* Middle Area: Scrollable Step List */}
        <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', padding: '12px 0', height: isExpanded ? '260px' : '160px', overflowY: 'auto' }}>
          <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>
            STEPS LIST
          </span>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {looseSteps.map((step, idx) => {
              const isActive = idx === looseActiveIndex;
              const isCompleted = step.status === 'completed';
              return (
                <div 
                  key={step.id} 
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    backgroundColor: isActive ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                    border: isActive ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid rgba(255, 255, 255, 0.05)',
                  }}
                >
                  <span style={{ 
                    fontSize: '12px', 
                    fontWeight: isActive ? 600 : 500, 
                    color: isActive ? 'var(--primary-color)' : 'var(--text-primary)',
                    textDecoration: isCompleted ? 'line-through' : 'none',
                    opacity: isCompleted ? 0.6 : 1
                  }}>
                    {idx + 1}. {step.name}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 650 }}>
                      {Math.floor(step.elapsedSeconds / 60)}m {step.elapsedSeconds % 60}s
                    </span>
                    <button 
                      type="button" 
                      onClick={() => deleteLooseStep(step.id)} 
                      style={{ width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: '3px', backgroundColor: 'transparent', color: '#ef4444', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}
                      title="Delete step"
                    >×</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom Area: Add Step Form */}
        <div style={{ paddingTop: '12px' }}>
          {isAddingLooseStep ? (
            <form 
              onSubmit={handleAddLooseStep} 
              style={{ display: 'flex', gap: '6px' }}
            >
              <input 
                type="text" 
                placeholder="Step name..." 
                value={looseNewStepName} 
                onChange={(e) => setLooseNewStepName(e.target.value)} 
                className="search-input" 
                style={{ flex: 1, paddingLeft: '8px', fontSize: '12px', height: '32px' }}
                autoFocus
                required
              />
              <button type="submit" className="btn-signin" style={{ padding: '0 12px', height: '32px', fontSize: '12px' }}>
                Add
              </button>
              <button type="button" onClick={() => setIsAddingLooseStep(false)} className="btn-signin" style={{ padding: '0 8px', height: '32px', fontSize: '12px', backgroundColor: 'transparent', border: 'none' }}>
                Cancel
              </button>
            </form>
          ) : (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                onClick={() => setIsAddingLooseStep(true)} 
                className="btn-signin" 
                style={{ flex: 1, padding: '8px', fontSize: '12px', backgroundColor: 'var(--button-secondary-bg)', border: '1px solid var(--border-color)' }}
              >
                + Add step
              </button>
              <button 
                onClick={resetLooseTimer} 
                className="btn-signin" 
                style={{ flex: 1, padding: '8px', fontSize: '12px', backgroundColor: 'var(--button-secondary-bg)', border: '1px solid var(--border-color)' }}
              >
                Reset to default
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderWheelSVG = (
    spinParticipants: Participant[],
    angle: number,
    size: number,
    isExpanded: boolean,
    onSpin: () => void
  ) => {
    const cx = size / 2;
    const cy = size / 2;
    const radius = size * 0.42;
    const n = spinParticipants.length;
    const segmentAngle = n > 0 ? 360 / n : 360;

    return (
      <div className="wheel-outer-wrapper" style={{ width: size, height: size }}>
        <div className="wheel-pointer" style={{ top: isExpanded ? '-12px' : '-8px' }}>
          <svg width={isExpanded ? 28 : 20} height={isExpanded ? 28 : 20} viewBox="0 0 24 24" fill="var(--primary-color)" stroke="#fff" strokeWidth="2">
            <polygon points="12,24 4,8 20,8" />
          </svg>
        </div>

        {n > 0 ? (
          <svg 
            width={size} 
            height={size} 
            viewBox={`0 0 ${size} ${size}`} 
            style={{ 
              transform: `rotate(${angle}deg)`, 
              transition: 'transform 4s cubic-bezier(0.1, 0.8, 0.1, 1)' 
            }}
          >
            {spinParticipants.map((p, idx) => {
              const startAngle = idx * segmentAngle;
              const endAngle = (idx + 1) * segmentAngle;
              
              const x1 = cx + radius * Math.cos((startAngle - 90) * Math.PI / 180);
              const y1 = cy + radius * Math.sin((startAngle - 90) * Math.PI / 180);
              const x2 = cx + radius * Math.cos((endAngle - 90) * Math.PI / 180);
              const y2 = cy + radius * Math.sin((endAngle - 90) * Math.PI / 180);
              
              const largeArcFlag = segmentAngle > 180 ? 1 : 0;
              const pathData = `
                M ${cx} ${cy}
                L ${x1} ${y1}
                A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}
                Z
              `;
              
              const textAngle = startAngle + segmentAngle / 2;
              const textRadius = radius * 0.65;
              const tx = cx + textRadius * Math.cos((textAngle - 90) * Math.PI / 180);
              const ty = cy + textRadius * Math.sin((textAngle - 90) * Math.PI / 180);

              return (
                <g key={p.id}>
                  <path d={pathData} fill={p.color || '#3b82f6'} stroke="rgba(0,0,0,0.15)" strokeWidth="1.5" />
                  <text 
                    x={tx} 
                    y={ty} 
                    fill="#fff" 
                    fontSize={isExpanded ? 11 : 9} 
                    fontWeight="800" 
                    textAnchor="middle" 
                    transform={`rotate(${textAngle}, ${tx}, ${ty})`}
                  >
                    {p.initials || p.name.substring(0, 2)}
                  </text>
                </g>
              );
            })}
          </svg>
        ) : (
          <div className="wheel-empty-state">No participants checked</div>
        )}

        <button 
          type="button"
          onClick={onSpin} 
          className="wheel-center-button"
          style={{
            width: isExpanded ? '64px' : '44px',
            height: isExpanded ? '64px' : '44px',
            fontSize: isExpanded ? '12px' : '10px',
          }}
        >
          SPIN
        </button>
      </div>
    );
  };

  const renderTruthOrDareUI = (isExpanded: boolean) => {
    const size = isExpanded ? 320 : 180;
    const myId = getMyId();
    const myPresence = callParticipants.find(p => p.id === myId);
    const isHostOrAdmin = myPresence?.role === 'host' || myPresence?.role === 'cohost' || myPresence?.role === 'admin';

    const activeIds = todSpinCheckedIds.length > 0 
      ? todSpinCheckedIds.filter(id => callParticipants.some(p => p.id === id))
      : callParticipants.map(p => p.id);

    const spinParticipants = callParticipants.filter(p => activeIds.includes(p.id));
    const n = spinParticipants.length;

    return (
      <div className={`spinwheel-layout-container ${isExpanded ? 'expanded' : ''}`}>
        <div className="spinner-main-area" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          
          {/* Wheel rendering in IDLE or SPINNING state */}
          {(todState === 'idle' || todState === 'spinning') && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              {renderWheelSVG(spinParticipants, todSpinResult ? todSpinResult.angle : 0, size, isExpanded, handleSpinTruthOrDare)}
              
              {todSpinResult && todState === 'idle' && !todLocalSpinning && (
                <div style={{ marginTop: '16px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Spun by {todSpinResult.spunBy}
                </div>
              )}
            </div>
          )}

          {/* Choice phase */}
          {todState === 'choice' && (
            <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', gap: '16px', padding: '16px 0' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Landed on</div>
              
              {(() => {
                const selectedUser = callParticipants.find(p => p.id === todSelectedId);
                const isMeSelected = myId === todSelectedId;
                
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', gap: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div className="participant-avatar-large" style={{ backgroundColor: selectedUser?.color || '#3b82f6', width: '48px', height: '48px', border: '2px solid var(--primary-color)', position: 'relative', overflow: 'hidden' }}>
                        {selectedUser?.photoURL ? (
                          <img src={selectedUser.photoURL} alt={selectedUser.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} referrerPolicy="no-referrer" />
                        ) : (
                          selectedUser?.initials || selectedUser?.name.substring(0, 2)
                        )}
                      </div>
                      <span style={{ fontSize: '18px', fontWeight: 800, color: 'var(--primary-color)' }}>
                        {selectedUser?.name.replace(' (You)', '') || 'Participant'}
                      </span>
                    </div>

                    {/* Choice action buttons */}
                    {isMeSelected || isHostOrAdmin ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', gap: '8px' }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'center' }}>
                          {isMeSelected ? "Choose your challenge:" : "Choose on behalf of participant (Host Admin Bypass):"}
                        </span>
                        <div style={{ display: 'flex', gap: '12px', width: '100%', maxWidth: '240px' }}>
                          <button 
                            type="button"
                            onClick={() => handleSelectTodChoice('Truth')} 
                            className="btn-create" 
                            style={{ flex: 1, padding: '10px', fontSize: '13px', background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)', borderColor: 'transparent', color: '#fff', fontWeight: 700 }}
                          >
                            😇 Truth
                          </button>
                          <button 
                            type="button"
                            onClick={() => handleSelectTodChoice('Dare')} 
                            className="btn-create" 
                            style={{ flex: 1, padding: '10px', fontSize: '13px', background: 'linear-gradient(135deg, #ec4899, #be185d)', borderColor: 'transparent', color: '#fff', fontWeight: 700 }}
                          >
                            😈 Dare
                          </button>
                        </div>
                      </div>
                    ) : (
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        Waiting for {selectedUser?.name} to choose...
                      </span>
                    )}

                    {isHostOrAdmin && (
                      <button 
                        type="button"
                        onClick={handleResetTod} 
                        className="btn-signin"
                        style={{ marginTop: '16px', fontSize: '11px', padding: '6px 12px', backgroundColor: 'var(--button-secondary-bg)', border: '1px solid var(--border-color)' }}
                      >
                        Reset / Spin Again
                      </button>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {/* Reveal prompt phase */}
          {todState === 'reveal' && (
            <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', gap: '16px', padding: '16px 0' }}>
              {(() => {
                const selectedUser = callParticipants.find(p => p.id === todSelectedId);
                const isMeSelected = myId === todSelectedId;
                
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', gap: '16px' }}>
                    <div className={`truthordare-card type-${todChoice?.toLowerCase() || 'truth'} ${isExpanded ? 'expanded' : ''}`} style={{ width: '100%', maxWidth: isExpanded ? '500px' : 'none' }}>
                      <div className="card-badge" style={{
                        display: 'inline-block',
                        fontSize: '9px',
                        fontWeight: 800,
                        textTransform: 'uppercase',
                        padding: '3px 8px',
                        borderRadius: '4px',
                        marginBottom: '12px',
                        backgroundColor: todChoice === 'Truth' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(236, 72, 153, 0.15)',
                        color: todChoice === 'Truth' ? '#3b82f6' : '#ec4899'
                      }}>
                        {todChoice} for {selectedUser?.name.replace(' (You)', '')}
                      </div>
                      <div className="truthordare-text" style={{ fontSize: isExpanded ? '20px' : '15px', fontWeight: 700, margin: '8px 0 0 0' }}>
                        "{todText}"
                      </div>
                    </div>

                    {(isMeSelected || isHostOrAdmin) ? (
                      <button 
                        type="button"
                        onClick={handleResetTod} 
                        className="btn-signin"
                        style={{ width: '100%', maxWidth: '200px', padding: '10px', fontWeight: 700, backgroundColor: 'var(--primary-color)', color: '#0f1013', border: 'none' }}
                      >
                        Done (Next Turn)
                      </button>
                    ) : (
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        Waiting for completion...
                      </span>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

        </div>

        {/* Sidebar participant checkboxes list for the wheel */}
        {(todState === 'idle' || todState === 'spinning') && (
          <div className="spinner-participants-sidebar">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                Checked ({n}/{callParticipants.length})
              </span>
              <span style={{ fontSize: '9px', padding: '2px 6px', background: 'rgba(255,255,255,0.05)', borderRadius: '12px', color: 'var(--text-secondary)' }}>
                Pool: {todSpinPool.length} left
              </span>
            </div>

            <div className="spinner-participants-list">
              {callParticipants.map(p => {
                const isChecked = activeIds.includes(p.id);
                return (
                  <div key={p.id} className="spinner-participant-row" onClick={() => isHostOrAdmin && handleToggleTodSpinCheckedParticipant(p.id)} style={{ cursor: isHostOrAdmin ? 'pointer' : 'default' }}>
                    {isHostOrAdmin ? (
                      <input 
                        type="checkbox" 
                        checked={isChecked} 
                        onChange={() => {}} 
                        style={{ cursor: 'pointer' }}
                      />
                    ) : (
                      <span style={{ fontSize: '12px' }}>{isChecked ? '✅' : '⬜'}</span>
                    )}
                    <span style={{ fontSize: '12px', fontWeight: isChecked ? 600 : 400, color: isChecked ? 'var(--text-primary)' : 'var(--text-secondary)', flex: 1, marginLeft: '6px' }}>
                      {p.name}
                    </span>
                    {todSpinPool.includes(p.id) && isChecked && (
                      <span style={{ fontSize: '8px', color: 'var(--primary-color)', background: 'rgba(59, 130, 246, 0.1)', padding: '2px 4px', borderRadius: '4px' }}>
                        Pool
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderSpinWheelUI = (isExpanded: boolean) => {
    const myId = getMyId();
    const myPresence = callParticipants.find(p => p.id === myId);
    const isHostOrAdmin = myPresence?.role === 'host' || myPresence?.role === 'cohost' || myPresence?.role === 'admin';

    const activeIds = spinCheckedIds.length > 0 
      ? spinCheckedIds.filter(id => callParticipants.some(p => p.id === id))
      : callParticipants.map(p => p.id);

    const spinParticipants = callParticipants.filter(p => activeIds.includes(p.id));
    const n = spinParticipants.length;
    const size = isExpanded ? 360 : 200;

    return (
      <div className={`spinwheel-layout-container ${isExpanded ? 'expanded' : ''}`}>
        <div className="spinner-main-area">
          {renderWheelSVG(spinParticipants, spinResult ? spinResult.angle : 0, size, isExpanded, handleSpinWheel)}

          {spinResult && !spinLocalSpinning && (
            <div className="spin-result-banner animate-fade-in" style={{ marginTop: '16px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Landed on</div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--primary-color)', marginTop: '2px' }}>
                {callParticipants.find(p => p.id === spinResult.selectedId)?.name.replace(' (You)', '') || 'Participant'}
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '4px' }}>Spun by {spinResult.spunBy}</div>
            </div>
          )}
        </div>

        <div className="spinner-participants-sidebar">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Checked ({n}/{callParticipants.length})
            </span>
            <span style={{ fontSize: '9px', padding: '2px 6px', background: 'rgba(255,255,255,0.05)', borderRadius: '12px', color: 'var(--text-secondary)' }}>
              Pool: {spinPool.length} left
            </span>
          </div>

          <div className="spinner-participants-list">
            {callParticipants.map(p => {
              const isChecked = activeIds.includes(p.id);
              return (
                <div key={p.id} className="spinner-participant-row" onClick={() => isHostOrAdmin && handleToggleSpinCheckedParticipant(p.id)} style={{ cursor: isHostOrAdmin ? 'pointer' : 'default' }}>
                  {isHostOrAdmin ? (
                    <input 
                      type="checkbox" 
                      checked={isChecked} 
                      onChange={() => {}} 
                      style={{ cursor: 'pointer' }}
                    />
                  ) : (
                    <span style={{ fontSize: '12px' }}>{isChecked ? '✅' : '⬜'}</span>
                  )}
                  <span style={{ fontSize: '12px', fontWeight: isChecked ? 600 : 400, color: isChecked ? 'var(--text-primary)' : 'var(--text-secondary)', flex: 1, marginLeft: '6px' }}>
                    {p.name}
                  </span>
                  {spinPool.includes(p.id) && isChecked && (
                    <span style={{ fontSize: '8px', color: 'var(--primary-color)', background: 'rgba(59, 130, 246, 0.1)', padding: '2px 4px', borderRadius: '4px' }}>
                      Pool
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

      </div>
    );
  };

  const renderRoomSettingsUI = () => {
    const myId = getMyId();
    const myPresence = callParticipants.find(p => p.id === myId);
    const isHostOrAdmin = myPresence?.role === 'host' || myPresence?.role === 'cohost' || myPresence?.role === 'admin';

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '4px' }}>
        {/* Room Name setting */}
        <div>
          <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>Room Topic (Name)</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input 
              type="text" 
              defaultValue={currentRoom?.name || ''} 
              onBlur={(e) => handleChangeRoomName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleChangeRoomName(e.currentTarget.value);
                }
              }}
              className="room-input" 
              style={{ flex: 1, padding: '8px 12px', fontSize: '13px' }}
              placeholder="e.g. Algorithms Study Group"
            />
          </div>
          <span style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '4px', display: 'block' }}>Anyone can update the room topic/name.</span>
        </div>

        {/* Room Privacy setting */}
        <div>
          <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>Room Privacy Type</label>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-primary)', cursor: 'pointer' }}>
              <input 
                type="radio" 
                name="roomTypeSetting" 
                checked={currentRoom?.type === 'public'} 
                onChange={() => handleChangeRoomType('public')} 
              />
              Public
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-primary)', cursor: 'pointer' }}>
              <input 
                type="radio" 
                name="roomTypeSetting" 
                checked={currentRoom?.type === 'public-ask'} 
                onChange={() => handleChangeRoomType('public-ask')} 
              />
              Ask to Join
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-primary)', cursor: 'pointer' }}>
              <input 
                type="radio" 
                name="roomTypeSetting" 
                checked={currentRoom?.type === 'private'} 
                onChange={() => handleChangeRoomType('private')} 
              />
              Private
            </label>
          </div>
          <span style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '4px', display: 'block' }}>Anyone can change room privacy in this room.</span>
        </div>

        {/* Max Participants setting (Host/Cohost/Admin only) */}
        {isHostOrAdmin && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px' }}>
            <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>Max Participants</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button 
                type="button"
                onClick={() => {
                  const val = typeof maxPartInput === 'number' ? maxPartInput : 10;
                  const nextVal = Math.max(2, val - 1);
                  setMaxPartInput(nextVal);
                  handleChangeMaxParticipants(nextVal);
                }}
                style={{ width: '36px', height: '36px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--panel-bg)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              </button>
              <input 
                type="number" 
                min="2"
                max="10"
                className="room-input"
                style={{ textAlign: 'center', width: '60px', padding: '8px 0', fontSize: '13px' }}
                value={maxPartInput}
                onChange={(e) => {
                  const val = e.target.value === '' ? '' : parseInt(e.target.value);
                  setMaxPartInput(val);
                }}
                onBlur={() => {
                  if (maxPartInput === '') {
                    setMaxPartInput(currentRoom?.maxParticipants ?? 10);
                  } else {
                    handleChangeMaxParticipants(maxPartInput);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && maxPartInput !== '') {
                    handleChangeMaxParticipants(maxPartInput);
                  }
                }}
              />
              <button 
                type="button"
                onClick={() => {
                  const val = typeof maxPartInput === 'number' ? maxPartInput : 10;
                  const nextVal = Math.min(10, val + 1);
                  setMaxPartInput(nextVal);
                  handleChangeMaxParticipants(nextVal);
                }}
                style={{ width: '36px', height: '36px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--panel-bg)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              </button>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Capacity cap (10 max)</span>
            </div>
            <span style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '4px', display: 'block' }}>
              Current active participants: {callParticipants.length}
            </span>
          </div>
        )}

        {/* Fun Tools setting (Host-only) */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', display: 'block' }}>Allow Fun Tools for Members</span>
              <span style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px', display: 'block' }}>
                {isHostOrAdmin ? 'Enable or disable Fun tools tab for regular members.' : 'Only hosts or co-hosts can modify this setting.'}
              </span>
            </div>
            <label className="switch-toggle" style={{ opacity: isHostOrAdmin ? 1 : 0.5, pointerEvents: isHostOrAdmin ? 'auto' : 'none' }}>
              <input 
                type="checkbox" 
                checked={allowFunTools} 
                onChange={(e) => handleToggleFunTools(e.target.checked)} 
                disabled={!isHostOrAdmin}
              />
              <span className="switch-slider"></span>
            </label>
          </div>
        </div>
      </div>
    );
  };

  const isDocumentPipSupported = 'documentPictureInPicture' in window;
  const isVideoPipSupported = 'pictureInPictureEnabled' in document;

  const copyStyles = (targetDoc: Document) => {
    // Copy CSS stylesheets to floating window document
    const allStyleSheets = Array.from(document.styleSheets);
    allStyleSheets.forEach((styleSheet) => {
      try {
        if (styleSheet.cssRules) {
          const newStyle = targetDoc.createElement('style');
          Array.from(styleSheet.cssRules).forEach((rule) => {
            newStyle.appendChild(targetDoc.createTextNode(rule.cssText));
          });
          targetDoc.head.appendChild(newStyle);
        } else if (styleSheet.href) {
          const newLink = targetDoc.createElement('link');
          newLink.rel = 'stylesheet';
          newLink.href = styleSheet.href;
          targetDoc.head.appendChild(newLink);
        }
      } catch (e) {
        // Cross-origin styles safety catch
      }
    });
  };

  const toggleMiniMode = async () => {
    if (isMiniModeActive) {
      if (pipWindowInstance) {
        pipWindowInstance.close();
      }
      setIsMiniModeActive(false);
      setPipWindowInstance(null);
    } else {
      if (isDocumentPipSupported) {
        try {
          const pipWindow = await (window as any).documentPictureInPicture.requestWindow({
            width: 320,
            height: 240,
          });

          // Copy current active app styles
          copyStyles(pipWindow.document);

          // Standard body/window margin resets
          pipWindow.document.body.style.margin = '0';
          pipWindow.document.body.style.padding = '0';
          pipWindow.document.body.style.overflow = 'hidden';

          // Listen for browser UI close action
          pipWindow.addEventListener('pagehide', () => {
            setIsMiniModeActive(false);
            setPipWindowInstance(null);
          });

          setPipWindowInstance(pipWindow);
          setIsMiniModeActive(true);
        } catch (err) {
          console.warn("Document PiP request failed, falling back to video PiP:", err);
          handleVideoPipFallback();
        }
      } else {
        handleVideoPipFallback();
      }
    }
  };

  const handleVideoPipFallback = () => {
    const activeVideoEl = document.querySelector('.speaker-active video') || document.querySelector('.user-tile video') || document.querySelector('video');
    if (activeVideoEl) {
      (activeVideoEl as HTMLVideoElement).requestPictureInPicture().catch(err => {
        console.error("Failed to request standard PiP:", err);
        showToast("Picture-in-Picture failed to launch.");
      });
    } else {
      showToast("No active participant video found to launch standard PiP.");
    }
  };

  const renderPipWindow = () => {
    if (!isMiniModeActive || !pipWindowInstance) return null;

    return createPortal(
      <PipWindowContent
        myId={getMyId()}
        isMicMuted={isMicMuted}
        isCamOff={isCamOff}
        toggleMic={toggleMic}
        toggleCamera={toggleCamera}
        toggleMiniMode={toggleMiniMode}
        handleLeaveCall={handleLeaveCall}
        miniModeTab={miniModeTab}
        setMiniModeTab={setMiniModeTab}
        expandedTool={expandedTool}
        setExpandedTool={setExpandedTool}
        callParticipants={callParticipants}
        pomodoroPhase={pomodoroPhase}
        pomodoroMinutes={pomodoroMinutes}
        pomodoroSeconds={pomodoroSeconds}
        pomodoroIsRunning={pomodoroIsRunning}
        togglePomodoro={togglePomodoro}
        deadlineSteps={deadlineSteps}
        deadlineActiveIndex={deadlineActiveIndex}
        deadlineTimerMinutes={deadlineTimerMinutes}
        deadlineTimerSeconds={deadlineTimerSeconds}
        deadlineIsRunning={deadlineIsRunning}
        setDeadlineIsRunning={setDeadlineIsRunning}
        looseSteps={looseSteps}
        looseActiveIndex={looseActiveIndex}
        looseTimerSeconds={looseTimerSeconds}
        looseIsRunning={looseIsRunning}
        setLooseIsRunning={setLooseIsRunning}
        spinResult={spinResult}
        handleSpinWheel={handleSpinWheel}
        todSelectedId={todSelectedId}
        todChoice={todChoice}
        todText={todText}
        unreadChatCount={unreadChatCount}
        chatMessages={chatMessages}
        systemMessages={systemMessages}
        sendChatMessage={sendChatMessage}
      />,
      pipWindowInstance.document.body
    );
  };

  return (
    <div className="app-container">
      
      <Routes>
        <Route path="/" element={
          <>
            {/* Header (top bar) */}
          <header className="header">
            <a href="/" className="logo-container">
              <div className="logo-circle">S</div>
              <span>Skulk</span>
            </a>
            
            <div className="nav-container">
              <a href="#about" className="nav-link">About</a>
              <a href="#privacy" className="nav-link">Privacy policy</a>
              
              {/* LinkedIn Icon Link pointing to specific URL */}
              <a 
                href="https://www.linkedin.com/in/fija-khan-69515b3a9/" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="icon-link" 
                aria-label="LinkedIn"
              >
                <svg 
                  xmlns="http://www.w3.org/2000/svg" 
                  width="20" 
                  height="20" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2" 
                  strokeLinecap="round" 
                  strokeLinejoin="round"
                >
                  <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"></path>
                  <rect x="2" y="9" width="4" height="12"></rect>
                  <circle cx="4" cy="4" r="2"></circle>
                </svg>
              </a>

              {/* Theme Picker Popover */}
              <div className="theme-picker-container" ref={themePickerRef}>
                <button 
                  onClick={() => setIsThemePickerOpen(!isThemePickerOpen)} 
                  className="theme-picker-btn" 
                  aria-label="Theme settings"
                  title="Select theme palette"
                >
                  <svg 
                    xmlns="http://www.w3.org/2000/svg" 
                    width="20" 
                    height="20" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                  >
                    <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 14.7255 3.09032 17.1962 4.85857 19C5.32832 19.4797 5.5632 19.7196 5.86178 19.8598C6.16035 20 6.56847 20 7.38471 20H8C9.10457 20 10 19.1046 10 18C10 16.8954 10.8954 16 12 16C13.1046 16 14 16.8954 14 18C14 20.2091 15.7909 22 18 22H12Z"></path>
                    <circle cx="7.5" cy="10.5" r="1.5" fill="currentColor"></circle>
                    <circle cx="11.5" cy="7.5" r="1.5" fill="currentColor"></circle>
                    <circle cx="16.5" cy="9.5" r="1.5" fill="currentColor"></circle>
                    <circle cx="15.5" cy="14.5" r="1.5" fill="currentColor"></circle>
                  </svg>
                </button>

                {isThemePickerOpen && (
                  <div className="theme-picker-dropdown animate-fade-in">
                    {themes.map((t) => (
                      <button 
                        key={t.id} 
                        onClick={() => {
                          setTheme(t.id);
                          setIsThemePickerOpen(false);
                        }} 
                        className="theme-item-btn"
                      >
                        <div className="theme-item-left">
                          <div 
                            className="theme-color-preview" 
                            style={{ background: `linear-gradient(135deg, ${t.bg} 50%, ${t.accent} 50%)` }}
                          />
                          <span>{t.name}</span>
                        </div>
                        {theme === t.id && (
                          <svg 
                            className="theme-check-icon" 
                            xmlns="http://www.w3.org/2000/svg" 
                            width="16" 
                            height="16" 
                            viewBox="0 0 24 24" 
                            fill="none" 
                            stroke="currentColor" 
                            strokeWidth="3" 
                            strokeLinecap="round" 
                            strokeLinejoin="round"
                          >
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Guest Profile Identity Badge */}
              {guestName && !user && (
                <button 
                  onClick={() => {
                    setProfileEditName(guestName);
                    setProfileEditColor(guestColor);
                    setProfileEditPhotoURL(guestPhotoURL || '');
                    setIsProfileModalOpen(true);
                  }}
                  className="guest-profile-badge"
                  title="Edit guest profile"
                >
                  <div className="guest-badge-avatar" style={{ backgroundColor: guestColor }}>
                    {guestInitials}
                  </div>
                  <span>{guestName}</span>
                </button>
              )}

              {!user ? (
                <button onClick={handleSignIn} className="btn-signin">Sign in</button>
              ) : (
                <div className="user-profile-container" ref={userDropdownRef} style={{ position: 'relative' }}>
                  <button 
                    onClick={() => setIsUserDropdownOpen(!isUserDropdownOpen)} 
                    className="guest-profile-badge"
                    style={{ border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 12px 4px 4px' }}
                  >
                    {user.photoURL ? (
                      <img 
                        src={user.photoURL} 
                        alt={user.displayName || 'User'} 
                        style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }} 
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="guest-badge-avatar" style={{ backgroundColor: '#8b5cf6' }}>
                        {guestInitials}
                      </div>
                    )}
                    <span style={{ maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {user.displayName || 'Google User'}
                    </span>
                  </button>
                  
                  {isUserDropdownOpen && (
                    <div className="theme-picker-dropdown animate-fade-in" style={{ top: '100%', right: 0, marginTop: '8px', minWidth: '150px' }}>
                      <button 
                        onClick={handleSignOut} 
                        className="theme-item-btn"
                        style={{ color: '#ef4444', width: '100%', textAlign: 'left', padding: '10px 16px' }}
                      >
                        Sign out
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </header>

          {/* Tabs */}
          <div className="tabs-container">
            <button 
              onClick={() => setActiveTab('rooms')} 
              className={`tab-btn ${activeTab === 'rooms' ? 'active' : ''}`}
            >
              Rooms
            </button>
            <button 
              onClick={() => setActiveTab('community')} 
              className={`tab-btn ${activeTab === 'community' ? 'active' : ''}`}
            >
              Community
            </button>
          </div>

          {/* Rooms Tab Content */}
          {activeTab === 'rooms' ? (
            <div>
              {isFirestoreBlocked && (
                <div className="animate-fade-in" style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  backgroundColor: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.15)',
                  borderRadius: 'var(--border-radius)',
                  padding: '12px 16px',
                  marginBottom: '24px',
                  color: '#ef4444',
                  fontSize: '13px',
                  lineHeight: '1.5'
                }}>
                  <span style={{ fontSize: '18px' }}>⚠️</span>
                  <span>
                    <strong>Firebase permissions blocked:</strong> Rooms and chat are operating in local offline fallback mode. Rooms you create will only be visible in this browser window. To enable real-time synchronization, please update your <strong>Firestore Security Rules</strong> in the Firebase Console to allow public access.
                  </span>
                </div>
              )}

              {/* Search & Create Row */}
              <div className="filter-row">
                <div className="search-input-wrapper">
                  <svg 
                    className="search-icon" 
                    xmlns="http://www.w3.org/2000/svg" 
                    width="18" 
                    height="18" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                  <input 
                    type="text" 
                    placeholder="Search rooms" 
                    className="search-input"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                <button onClick={openModal} className="btn-create">
                  <svg 
                    xmlns="http://www.w3.org/2000/svg" 
                    width="16" 
                    height="16" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2.5" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                  >
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                  Create room
                </button>
              </div>

              {/* Section Title */}
              <h2 className="section-title">Live rooms</h2>

              {/* Grid Layout of Room Cards */}
              <div className="rooms-grid">
                {filteredRooms.map((room) => {
                  const isScheduled = room.scheduledDate && room.scheduledTime;
                  const currentRoomParticipants = roomsParticipants[room.id] || [];
                  const isRoomFull = currentRoomParticipants.length >= (room.maxParticipants || 10);
                  const isCreatorAdmin = currentRoomParticipants.some(p => p.uid === room.creatorId && p.role === 'admin');
                  const hostLabel = isCreatorAdmin ? 'Admin' : (room.creatorName || 'Unknown');
                  
                  return (
                    <div className="room-card" key={room.id}>
                      {/* Room Header */}
                      <div className="room-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div 
                            className="room-dot" 
                            style={{ 
                              backgroundColor: isScheduled ? 'var(--primary-color)' : 'var(--dot-color)',
                              boxShadow: isScheduled ? '0 0 8px var(--primary-color)' : '0 0 8px var(--dot-color)'
                            }}
                          ></div>
                          <h3 className="room-title">{room.name}</h3>
                        </div>
                        {isRoomFull && (
                          <div className="recording-dot-wrapper" style={{ backgroundColor: '#ef4444', borderColor: '#ef4444', height: '20px', padding: '0 8px', gap: '4px' }}>
                            <div className="recording-dot" style={{ backgroundColor: '#ffffff' }}></div>
                            <span style={{ color: '#ffffff', fontSize: '9px', fontWeight: 800 }}>FULL</span>
                          </div>
                        )}
                      </div>
                      
                      {/* Room Subtitle */}
                      <p className="room-subtitle">
                        {isScheduled ? (
                          `Scheduled for ${formatFriendlyDate(room.scheduledDate)} at ${room.scheduledTime}`
                        ) : (
                          `Hosted by ${hostLabel}`
                        )}
                        {room.createdAt && ` · ${formatRoomCreatedAt(room.createdAt)}`}
                      </p>
                      
                      {/* Participant Avatars Row */}
                      {(() => {
                        const totalParticipants = currentRoomParticipants.length;
                        if (totalParticipants > 18) {
                          return (
                            <div className="avatar-row">
                              {currentRoomParticipants.slice(0, 17).map((participant, index) => {
                                return participant.photoURL ? (
                                  <img 
                                    key={index}
                                    src={participant.photoURL}
                                    alt={participant.name}
                                    className="avatar-slot avatar-filled"
                                    style={{ objectFit: 'cover', border: '1px solid var(--border-color)' }}
                                    referrerPolicy="no-referrer"
                                  />
                                ) : (
                                  <div 
                                    key={index} 
                                    className="avatar-slot avatar-filled"
                                    style={{ backgroundColor: participant.color || '#8b5cf6' }}
                                  >
                                    {participant.initials}
                                  </div>
                                );
                              })}
                              <div 
                                className="avatar-slot avatar-filled"
                                style={{ 
                                  backgroundColor: 'var(--button-secondary-bg)',
                                  border: '1px solid var(--border-color)',
                                  color: 'var(--text-secondary)',
                                  fontSize: '14px',
                                  fontWeight: 'bold'
                                }}
                              >
                                +{totalParticipants - 17}
                              </div>
                            </div>
                          );
                        } else {
                          const maxSlots = Math.min(room.maxParticipants || 10, 18);
                          return (
                            <div className="avatar-row">
                              {Array.from({ length: maxSlots }).map((_, index) => {
                                const participant = currentRoomParticipants[index];
                                if (participant) {
                                  return participant.photoURL ? (
                                    <img 
                                      key={index}
                                      src={participant.photoURL}
                                      alt={participant.name}
                                      className="avatar-slot avatar-filled"
                                      style={{ objectFit: 'cover', border: '1px solid var(--border-color)' }}
                                      referrerPolicy="no-referrer"
                                    />
                                  ) : (
                                    <div 
                                      key={index} 
                                      className="avatar-slot avatar-filled"
                                      style={{ backgroundColor: participant.color || '#8b5cf6' }}
                                    >
                                      {participant.initials}
                                    </div>
                                  );
                                } else {
                                  return (
                                    <div 
                                      key={index} 
                                      className="avatar-slot avatar-empty" 
                                      style={{ borderStyle: 'dashed' }}
                                    />
                                  );
                                }
                              })}
                            </div>
                          );
                        }
                      })()}
                      
                      {/* Room Footer */}
                      <div className="room-footer">
                        <button 
                          onClick={() => handleJoinRoomClick(room)} 
                          className="btn-join"
                          disabled={isRoomFull}
                          style={{
                            opacity: isRoomFull ? 0.5 : 1,
                            cursor: isRoomFull ? 'not-allowed' : 'pointer',
                            backgroundColor: isRoomFull ? 'var(--button-secondary-bg)' : 'var(--primary-color)',
                            color: isRoomFull ? 'var(--text-secondary)' : 'var(--primary-text)'
                          }}
                        >
                          {isRoomFull ? 'Full' : (isScheduled ? 'Register' : room.buttonText)}
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* Locked private rooms card */}
                <div className="room-card-locked">
                  <svg 
                    className="lock-icon" 
                    xmlns="http://www.w3.org/2000/svg" 
                    width="24" 
                    height="24" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                  </svg>
                  <p className="locked-text">
                    Private rooms don't show up here — share a link instead
                  </p>
                </div>
              </div>
            </div>
          ) : (
            /* Community Tab Content Placeholder */
            <div className="placeholder-container">
              <svg 
                xmlns="http://www.w3.org/2000/svg" 
                width="48" 
                height="48" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="1.5" 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                style={{ marginBottom: '16px', opacity: 0.6 }}
              >
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
              <h3 className="placeholder-title">Community</h3>
              <p>Coming soon</p>
            </div>
          )}
        </>
      } />

      <Route path="/room/:roomId" element={
        currentRoom ? (
          !liveKitToken ? (
            <div className="call-layout animate-fade-in" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <div className="loading-spinner" style={{ margin: '0 auto 16px', borderTopColor: 'var(--primary-color)', width: '32px', height: '32px', border: '3px solid var(--border-color)', borderRadius: '50%', borderTop: '3px solid var(--primary-color)', animation: 'spin 1s linear infinite' }}></div>
                <p style={{ color: 'var(--text-secondary)' }}>Connecting to secure media server...</p>
              </div>
              <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
            </div>
          ) : (
          /* 2. In-Call Room Stage View (rendered if currentRoom is NOT null) */
          <div className="call-layout animate-fade-in" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100, backgroundColor: 'var(--bg-color)', overflow: 'hidden', height: '100vh', maxHeight: '100vh', width: '100vw', display: 'flex', flexDirection: 'column' }}>
            <LiveKitRoom
              token={liveKitToken}
              serverUrl={import.meta.env.VITE_LIVEKIT_URL}
              audio={false}
              video={false}
              style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', width: '100%', overflow: 'hidden' }}
            >
            <DeviceRecoveryManager 
              isCamOff={isCamOff} 
              isMicMuted={isMicMuted} 
              onErrorChange={(cam, mic) => {
                if (cameraError !== cam) setCameraError(cam);
                if (micError !== mic) setMicError(mic);
              }} 
            />
             <RoomAudioRenderer />
             <LocalScreenShareLinker screenShareStream={screenShareStream} />
            
            {isMiniModeActive ? (
              <div className="mini-mode-placeholder animate-fade-in" style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'var(--bg-color)',
                color: 'var(--text-primary)',
                padding: '24px',
                textAlign: 'center',
                gap: '16px'
              }}>
                <div style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(241, 196, 15, 0.1)',
                  color: 'var(--primary-color)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '28px'
                }}>
                  🗗
                </div>
                <div>
                  <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '6px', color: 'var(--text-primary)' }}>Skulk is in Mini Mode</h3>
                  <p style={{ fontSize: '13px', color: 'var(--text-secondary)', maxWidth: '320px', lineHeight: 1.5, margin: '0 auto' }}>
                    The call is running in a floating Picture-in-Picture window. You can return here by expanding or closing the floating window.
                  </p>
                </div>
                <button 
                  onClick={toggleMiniMode} 
                  className="btn-signin"
                  style={{ padding: '8px 20px', fontSize: '13px' }}
                >
                  Return to Full View
                </button>
              </div>
            ) : (
              <>
              {/* Call Header */}
              <div className="call-top-bar">
            <div className="call-room-info">
              <a href="/" onClick={(e) => { e.preventDefault(); handleLeaveCall(); }} className="logo-circle" style={{ width: '28px', height: '28px', fontSize: '15px', textDecoration: 'none' }}>S</a>
              <h1 className="room-title" style={{ fontSize: '18px' }}>{currentRoom.name}</h1>
              {currentRoom.creatorName && (
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginLeft: '12px', borderLeft: '1px solid var(--border-color)', paddingLeft: '12px', display: 'flex', alignItems: 'center' }}>
                  Created by <strong style={{ marginLeft: '4px', color: 'var(--text-primary)' }}>{currentRoom.creatorName}</strong>
                </span>
              )}
              <div className="recording-dot-wrapper">
                <div className="recording-dot"></div>
                <span>LIVE</span>
              </div>

              {/* Shared Pomodoro Status Badge */}
              <div 
                onClick={() => setCallTab('tools')}
                className={`topbar-pomodoro-badge ${pomodoroPhase === 'focus' ? 'focus-phase' : 'break-phase'}`}
                title="View Pomodoro Timer details"
              >
                <span>⏱️</span>
                <span>
                  {pomodoroMinutes.toString().padStart(2, '0')}:
                  {pomodoroSeconds.toString().padStart(2, '0')}
                </span>
                <span style={{ fontSize: '9px', opacity: 0.8, textTransform: 'uppercase', marginLeft: '4px' }}>
                  ({pomodoroPhase})
                </span>
              </div>
            </div>
            
            <div className="nav-container" style={{ gap: '16px' }}>
              {/* Theme Selector inside Call */}
              <div className="theme-picker-container" ref={themePickerRef}>
                <button 
                  onClick={() => setIsThemePickerOpen(!isThemePickerOpen)} 
                  className="theme-picker-btn"
                  aria-label="Theme settings"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 14.7255 3.09032 17.1962 4.85857 19C5.32832 19.4797 5.5632 19.7196 5.86178 19.8598C6.16035 20 6.56847 20 7.38471 20H8C9.10457 20 10 19.1046 10 18C10 16.8954 10.8954 16 12 16C13.1046 16 14 16.8954 14 18C14 20.2091 15.7909 22 18 22H12Z"></path>
                    <circle cx="7.5" cy="10.5" r="1.5" fill="currentColor"></circle>
                    <circle cx="11.5" cy="7.5" r="1.5" fill="currentColor"></circle>
                    <circle cx="16.5" cy="9.5" r="1.5" fill="currentColor"></circle>
                    <circle cx="15.5" cy="14.5" r="1.5" fill="currentColor"></circle>
                  </svg>
                </button>
                {isThemePickerOpen && (
                  <div className="theme-picker-dropdown animate-fade-in" style={{ top: '100%', right: '0' }}>
                    {themes.map((t) => (
                      <button 
                        key={t.id} 
                        onClick={() => { setTheme(t.id); setIsThemePickerOpen(false); }} 
                        className="theme-item-btn"
                      >
                        <div className="theme-item-left">
                          <div className="theme-color-preview" style={{ background: `linear-gradient(135deg, ${t.bg} 50%, ${t.accent} 50%)` }} />
                          <span>{t.name}</span>
                        </div>
                        {theme === t.id && (
                          <svg className="theme-check-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* Mini Mode Button */}
              {(isDocumentPipSupported || isVideoPipSupported) && (
                <button 
                  onClick={toggleMiniMode} 
                  className="theme-picker-btn"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  title="Enter Mini Mode"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <rect x="12" y="12" width="9" height="9" rx="1" ry="1"></rect>
                  </svg>
                </button>
              )}

              {/* Room Settings Popover inside Call */}
              <div className="theme-picker-container" ref={roomSettingsRef}>
                <button 
                  onClick={() => setIsRoomSettingsOpen(!isRoomSettingsOpen)} 
                  className="theme-picker-btn"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  aria-label="Room settings"
                  title="Room settings"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                  </svg>
                </button>
                {isRoomSettingsOpen && (
                  <div className="theme-picker-dropdown animate-fade-in" style={{ top: '100%', right: '0', width: '320px', padding: '16px', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '8px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>Room Settings</span>
                      <button onClick={() => setIsRoomSettingsOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '16px', padding: 0 }}>×</button>
                    </div>
                    {renderRoomSettingsUI()}
                  </div>
                )}
              </div>
              {/* Guest Profile Identity Badge in Call */}
              {guestName && !user && (
                <button 
                  onClick={() => {
                    setProfileEditName(guestName);
                    setProfileEditColor(guestColor);
                    setProfileEditPhotoURL(guestPhotoURL || '');
                    setIsProfileModalOpen(true);
                  }}
                  className="guest-profile-badge"
                  style={{ padding: '4px 10px 4px 4px', fontSize: '12px' }}
                  title="Edit guest profile"
                >
                  <div className="guest-badge-avatar" style={{ backgroundColor: guestColor, width: '20px', height: '20px', fontSize: '9px' }}>
                    {guestInitials}
                  </div>
                  <span>{guestName}</span>
                </button>
              )}

              {!user ? (
                <button onClick={handleSignIn} className="btn-signin" style={{ padding: '6px 14px', fontSize: '13px' }}>Sign in</button>
              ) : (
                <div className="user-profile-container" ref={userDropdownRef} style={{ position: 'relative' }}>
                  <button 
                    onClick={() => setIsUserDropdownOpen(!isUserDropdownOpen)} 
                    className="guest-profile-badge"
                    style={{ border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 10px 4px 4px', fontSize: '12px' }}
                  >
                    {user.photoURL ? (
                      <img 
                        src={user.photoURL} 
                        alt={user.displayName || 'User'} 
                        style={{ width: '20px', height: '20px', borderRadius: '50%', objectFit: 'cover' }} 
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="guest-badge-avatar" style={{ backgroundColor: '#8b5cf6', width: '20px', height: '20px', fontSize: '9px' }}>
                        {guestInitials}
                      </div>
                    )}
                    <span style={{ maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {user.displayName || 'Google User'}
                    </span>
                  </button>
                  
                  {isUserDropdownOpen && (
                    <div className="theme-picker-dropdown animate-fade-in" style={{ top: '100%', right: 0, marginTop: '8px', minWidth: '150px', zIndex: 1000 }}>
                      <button 
                        onClick={handleSignOut} 
                        className="theme-item-btn"
                        style={{ color: '#ef4444', width: '100%', textAlign: 'left', padding: '10px 16px' }}
                      >
                        Sign out
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Call Body */}
          <div className="call-main-content">
            
            {/* Call Main Stage (Left) */}
            <div className="call-stage">
              {expandedTool !== 'none' ? (
                <div className="expanded-tool-stage-wrapper animate-fade-in" style={{
                  display: 'flex',
                  flexDirection: 'column',
                  height: '100%',
                  backgroundColor: 'var(--card-bg)',
                  borderRadius: 'var(--border-radius)',
                  border: '1px solid var(--border-color)',
                  overflow: 'hidden',
                  position: 'relative'
                }}>
                  {/* Expanded Header */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                    backgroundColor: 'rgba(0, 0, 0, 0.2)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '16px' }}>
                        {expandedTool === 'pomodoro' && '⏱️'}
                        {expandedTool === 'deadline' && '⏳'}
                        {expandedTool === 'loose' && '🔄'}
                        {expandedTool === 'truthordare' && '🎲'}
                        {expandedTool === 'spin' && '🎡'}
                      </span>
                      <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>
                        {expandedTool === 'pomodoro' && 'Pomodoro Timer'}
                        {expandedTool === 'deadline' && 'Deadline Clock'}
                        {expandedTool === 'loose' && 'Loose Timer (Study Flow)'}
                        {expandedTool === 'truthordare' && 'Truth or Dare'}
                        {expandedTool === 'spin' && 'Spin the Wheel'}
                      </span>
                    </div>
                    <button 
                      onClick={() => setExpandedTool('none')} 
                      className="btn-signin" 
                      style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                      title="Collapse to sidebar"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="4 14 10 14 10 20"></polyline>
                        <polyline points="20 10 14 10 14 4"></polyline>
                        <line x1="14" y1="10" x2="21" y2="3"></line>
                        <line x1="10" y1="14" x2="3" y2="21"></line>
                      </svg>
                      Collapse
                    </button>
                  </div>
                  {/* Expanded Content Container */}
                  <div style={{ flex: 1, padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ width: '100%', maxWidth: '640px', display: 'flex', flexDirection: 'column' }}>
                      {expandedTool === 'pomodoro' && renderPomodoroUI(true)}
                      {expandedTool === 'deadline' && renderDeadlineUI(true)}
                      {expandedTool === 'loose' && renderLooseTimerUI(true)}
                      {expandedTool === 'truthordare' && renderTruthOrDareUI(true)}
                      {expandedTool === 'spin' && renderSpinWheelUI(true)}
                    </div>
                  </div>
                </div>
              ) : viewingShare ? (
                viewingShare.type === 'whiteboard' ? (
                <div className="whiteboard-container">
                  <div className="whiteboard-toolbar">
                    <div className="whiteboard-tools-left">
                      <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                        Whiteboard {viewingShare.participantId !== getMyId() ? `(viewing ${callParticipants.find(p => p.id === viewingShare.participantId)?.name.replace(' (You)', '') || 'participant'})` : '(You)'}
                      </span>
                      {viewingShare.participantId === getMyId() && (
                      <div className="whiteboard-color-pickers">
                        {['#f1c40f', '#ef4444', '#10b981', '#3b82f6', '#ffffff'].map(color => (
                          <div 
                            key={color}
                            className={`whiteboard-color-dot ${drawColor === color ? 'selected' : ''}`}
                            style={{ backgroundColor: color }}
                            onClick={() => setDrawColor(color)}
                            title={`Select ${color} pen`}
                          />
                        ))}
                      </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {viewingShare.participantId === getMyId() && (
                        <button onClick={clearCanvas} className="btn-signin" style={{ padding: '6px 12px', fontSize: '12px', backgroundColor: 'var(--button-secondary-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>
                          Clear
                        </button>
                      )}
                      <button 
                        onClick={async () => {
                          if (viewingShare.participantId === getMyId()) {
                            await clearMySharing();
                          }
                          setViewingShare(null);
                        }} 
                        className="btn-create" 
                        style={{ padding: '6px 12px', fontSize: '12px' }}
                      >
                        {viewingShare.participantId === getMyId() ? 'Stop sharing' : 'Close view'}
                      </button>
                    </div>
                  </div>
                  <canvas 
                    ref={canvasRef}
                    className="whiteboard-canvas"
                    onMouseDown={viewingShare.participantId === getMyId() ? startDrawing : undefined}
                    onMouseMove={viewingShare.participantId === getMyId() ? draw : undefined}
                    onMouseUp={viewingShare.participantId === getMyId() ? stopDrawing : undefined}
                    onMouseLeave={viewingShare.participantId === getMyId() ? stopDrawing : undefined}
                    onTouchStart={viewingShare.participantId === getMyId() ? startDrawingTouch : undefined}
                    onTouchMove={viewingShare.participantId === getMyId() ? drawTouch : undefined}
                    onTouchEnd={viewingShare.participantId === getMyId() ? stopDrawing : undefined}
                    style={{ cursor: viewingShare.participantId === getMyId() ? 'crosshair' : 'default' }}
                  />
                </div>
              ) : (
                <div className="screenshare-stage-layout animate-fade-in">
                  <div className="screenshare-video-wrapper">
                    {viewingShare.type === 'screen' ? (
                      <ScreenShareVideo participantId={viewingShare.participantId} />
                    ) : viewingShare.type === 'youtube' && viewingShare.youtubeVideoId ? (
                      (() => {
                        const parsed = parseMediaUrl(viewingShare.youtubeVideoId);
                        if (parsed) {
                          return (
                            <UniversalVideoPlayer
                              videoId={parsed.videoId}
                              platform={parsed.platform}
                              isLive={parsed.isLive ?? false}
                              isPresenter={viewingShare.participantId === getMyId()}
                              presenterId={viewingShare.participantId}
                              roomId={roomDocId(currentRoom!)}
                              myId={getMyId()}
                            />
                          );
                        } else {
                          return (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)' }}>
                              Content unavailable
                            </div>
                          );
                        }
                      })()
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)' }}>
                        Content unavailable
                      </div>
                    )}
                    <button 
                      onClick={async () => {
                        if (viewingShare.participantId === getMyId()) {
                          if (viewingShare.type === 'screen') {
                            await stopScreenShare();
                          } else if (viewingShare.type === 'youtube') {
                            setYoutubeVideoId(null);
                            await clearMySharing();
                            setViewingShare(null);
                            showToast('YouTube sharing stopped');
                          }
                        } else {
                          setViewingShare(null);
                        }
                      }} 
                      className="btn-create" 
                      style={{ position: 'absolute', top: '12px', right: '12px', padding: '6px 12px', fontSize: '12px', backgroundColor: '#ef4444', borderColor: '#ef4444', color: '#ffffff' }}
                    >
                      {viewingShare.participantId === getMyId() ? 'Stop sharing' : 'Close view'}
                    </button>
                  </div>
                </div>
              )
              ) : (
                /* Standard conference participants grid layout display */
                <>
                  {pendingRequests.length > 0 && (
                    <div className="animate-fade-in" style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px',
                      backgroundColor: 'rgba(59, 130, 246, 0.08)',
                      border: '1px solid rgba(59, 130, 246, 0.15)',
                      borderRadius: 'var(--border-radius)',
                      padding: '16px',
                      marginBottom: '24px',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '18px' }}>🔔</span>
                        <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                          Pending Join Requests ({pendingRequests.length})
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                        {pendingRequests.map((req) => (
                          <div key={req.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--card-bg, #1a1c23)', padding: '10px 14px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <div style={{ backgroundColor: req.color || '#3b82f6', width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 'bold', color: '#fff' }}>
                                {req.initials || 'P'}
                              </div>
                              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{req.name}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button onClick={() => handleApproveRequest(req)} className="btn-create" style={{ padding: '4px 10px', fontSize: '12px' }}>
                                Accept
                              </button>
                              <button onClick={() => handleDenyRequest(req)} className="btn-signin" style={{ padding: '4px 10px', fontSize: '12px', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.2)', color: '#ef4444' }}>
                                Deny
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                  {spotlightParticipantId ? (
                    <div className="spotlight-stage-layout animate-fade-in">
                      <div className="spotlight-strip">
                        {callParticipants.map((p) => renderParticipantTile(p, true))}
                      </div>
                      <div className="spotlight-main">
                        {(() => {
                          const spotlightedPart = callParticipants.find(p => p.id === spotlightParticipantId);
                          return spotlightedPart ? (
                            <>
                              {renderParticipantTile(spotlightedPart, false)}
                              <button 
                                className="btn-exit-spotlight" 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSpotlightParticipantId(null);
                                }}
                              >
                                Exit Spotlight
                              </button>
                            </>
                          ) : null;
                        })()}
                      </div>
                    </div>
                  ) : (
                    <div 
                      className={`participants-container ${isGalleryView ? 'gallery-layout' : 'grid-layout'}`}
                      style={isGalleryView ? {
                        gridTemplateColumns: getGalleryColumns(callParticipants.length),
                        maxWidth: getGalleryMaxWidth(callParticipants.length)
                      } : {}}
                    >
                      {callParticipants.map((p) => renderParticipantTile(p, false))}
                    </div>
                  )}

                  {/* Layout Caption toggle */}
                  <p className="stage-caption" onClick={() => setIsGalleryView(!isGalleryView)}>
                    Tap the grid icon to switch to {isGalleryView ? 'compact grid' : 'full gallery'} view
                  </p>
                </>
              )}
            </div>

            {/* Call Sidebar (Right Panel) */}
            <div className="call-sidebar">
              {/* Sidebar Header Tabs */}
              <div className="call-sidebar-header">
                <button 
                  onClick={() => setCallTab('chat')} 
                  className={`sidebar-tab-btn ${callTab === 'chat' ? 'active' : ''}`}
                >
                  Chat
                </button>
                <button 
                  onClick={() => setCallTab('people')} 
                  className={`sidebar-tab-btn ${callTab === 'people' ? 'active' : ''}`}
                >
                  People ({callParticipants.length})
                </button>
                <button 
                  onClick={() => setCallTab('tools')} 
                  className={`sidebar-tab-btn ${callTab === 'tools' ? 'active' : ''}`}
                >
                  Tools
                </button>
              </div>

              {/* Sidebar Body Content Panels */}
              <div className="sidebar-content">
                
                {/* 2A. Chat Tab Panel */}
                {callTab === 'chat' && (
                  <>
                    <div className="chat-messages-list">
                      {(() => {
                        const combined = [
                          ...chatMessages.map(m => ({ ...m, type: 'chat' as const })),
                          ...systemMessages.map(m => ({ ...m, type: 'system' as const }))
                        ].sort((a, b) => {
                          const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                          const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                          return timeA - timeB;
                        });

                        return combined.map((msg) => {
                          if (msg.type === 'system') {
                            return (
                              <div 
                                key={msg.id} 
                                className="chat-message-item chat-system-message animate-fade-in" 
                                style={{ 
                                  textAlign: 'center', 
                                  padding: '8px 12px', 
                                  color: 'var(--text-secondary, #94a3b8)', 
                                  fontSize: '11px',
                                  fontStyle: 'italic',
                                  opacity: 0.8,
                                  borderBottom: '1px solid rgba(255,255,255,0.02)'
                                }}
                              >
                                {msg.text}
                              </div>
                            );
                          }

                          const role = msg.senderRole || (callParticipants.find(p => p.id === msg.senderId || p.name === msg.sender)?.role) || 'member';
                          return (
                            <div key={msg.id} className="chat-message-item animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '3px', padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                <span className="chat-sender" style={{ fontWeight: 700, fontSize: '13px' }}>{msg.sender}</span>
                                {role && role !== 'member' && (
                                  <span className={`role-badge-${role}`} style={{
                                    fontSize: '8px',
                                    fontWeight: 'bold',
                                    padding: '1px 4px',
                                    borderRadius: '3px',
                                    border: '1px solid',
                                    textTransform: 'uppercase',
                                    lineHeight: '1.2',
                                    ...role === 'admin' ? {
                                      backgroundColor: 'rgba(241, 196, 15, 0.15)',
                                      borderColor: 'var(--primary-color, #f1c40f)',
                                      color: 'var(--primary-color, #f1c40f)'
                                    } : role === 'host' ? {
                                      backgroundColor: 'rgba(59, 130, 246, 0.15)',
                                      borderColor: '#3b82f6',
                                      color: '#3b82f6'
                                    } : {
                                      backgroundColor: 'rgba(16, 185, 129, 0.15)',
                                      borderColor: '#10b981',
                                      color: '#10b981'
                                    }
                                  }}>
                                    {role === 'admin' ? '👑 Admin' : role === 'host' ? '⭐ Host' : '🛡️ Co-host'}
                                  </span>
                                )}
                              </div>
                              <span className="chat-text" style={{ fontSize: '13px', color: 'var(--text-secondary, #94a3b8)', marginTop: '2px', wordBreak: 'break-word' }}>{msg.text}</span>
                            </div>
                          );
                        });
                      })()}
                      <div ref={chatEndRef} />
                    </div>
                    
                    <form onSubmit={handleSendChatMessage} className="chat-input-form">
                      <input 
                        type="text" 
                        placeholder="Message the room..." 
                        className="search-input"
                        style={{ paddingLeft: '14px', fontSize: '13px' }}
                        value={chatMessageText}
                        onChange={(e) => setChatMessageText(e.target.value)}
                        required
                      />
                      <button type="submit" className="btn-signin" style={{ padding: '8px 12px' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="22" y1="2" x2="11" y2="13"></line>
                          <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                        </svg>
                      </button>
                    </form>
                  </>
                )}

                {/* 2B. People Tab Panel */}
                {callTab === 'people' && (
                  <div className="people-list animate-fade-in">
                    {callParticipants.map((p) => {
                      const isUser = p.id === getMyId();
                      const showMuted = isUser ? isMicMuted : p.isMuted;
                      
                      return (
                        <div key={p.id} className="person-row">
                          <div className="person-info">
                            <div 
                              className="person-avatar" 
                              style={{ 
                                backgroundColor: p.color, 
                                position: 'relative',
                                cursor: p.sharing ? 'pointer' : 'default',
                                border: p.sharing ? '1px solid var(--primary-color)' : 'none'
                              }}
                              onClick={() => {
                                if (p.sharing) {
                                  handleViewParticipantShare(p);
                                }
                              }}
                            >
                              {p.initials}
                              {p.sharing && (
                                <span style={{
                                  position: 'absolute',
                                  bottom: '-4px',
                                  right: '-4px',
                                  backgroundColor: 'var(--primary-color)',
                                  color: '#0f1013',
                                  borderRadius: '50%',
                                  width: '12px',
                                  height: '12px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '7px',
                                  fontWeight: 'bold',
                                  border: '1px solid var(--card-bg, #1a1c23)'
                                }}>
                                  {p.sharing === 'youtube' ? '▶' : p.sharing === 'whiteboard' ? '✎' : '⛶'}
                                </span>
                              )}
                            </div>
                            <div className="person-name-wrapper" style={{ display: 'flex', alignItems: 'center' }}>
                              <span className="person-name">{p.name}</span>
                              {p.role && p.role !== 'member' && (
                                <span className={`role-badge-${p.role}`} style={{
                                  fontSize: '9px',
                                  fontWeight: 'bold',
                                  padding: '1px 4px',
                                  borderRadius: '3px',
                                  border: '1px solid',
                                  textTransform: 'uppercase',
                                  lineHeight: '1',
                                  marginLeft: '6px',
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
                          </div>
                          <div className="person-status-icons">
                            {/* mic icon status */}
                            <svg className={`person-status-icon ${showMuted ? 'muted' : ''}`} xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              {showMuted ? (
                                <>
                                  <line x1="1" y1="1" x2="23" y2="23"></line>
                                  <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
                                  <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
                                </>
                              ) : (
                                <>
                                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                                  <line x1="12" y1="19" x2="12" y2="23"></line>
                                  <line x1="8" y1="23" x2="16" y2="23"></line>
                                </>
                              )}
                            </svg>
                            {/* camera icon status */}
                            <svg className="person-status-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              {isUser && isCamOff ? (
                                <>
                                  <line x1="1" y1="1" x2="23" y2="23"></line>
                                  <path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3 0h9a2 2 0 0 1 2 2v8a2 2 0 0 1-.18.83l-4-4"></path>
                                </>
                              ) : (
                                <>
                                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                                  <circle cx="12" cy="13" r="4"></circle>
                                </>
                              )}
                            </svg>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                                     {callTab === 'tools' && (
                  <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
                    
                    {activeToolDetail === 'none' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        
                        {/* Section 1: Focus Tools */}
                        <div>
                          <h4 style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                            Focus Tools
                          </h4>
                          
                          <div className="tools-cards-grid">
                            {/* Whiteboard card button */}
                            <div 
                              className={`tool-card ${viewingShare?.type === 'whiteboard' && viewingShare?.participantId === getMyId() ? 'active' : ''}`}
                              onClick={async () => {
                                const myId = getMyId();
                                if (viewingShare?.type === 'whiteboard' && viewingShare?.participantId === myId) {
                                  await clearMySharing();
                                  setViewingShare(null);
                                  showToast('Whiteboard sharing stopped');
                                } else {
                                  await updateMySharing({ sharing: 'whiteboard', whiteboardData: '' });
                                  setViewingShare({ participantId: myId, type: 'whiteboard' });
                                  showToast('Whiteboard sharing started — click your avatar to view');
                                }
                              }}
                              title="Toggle whiteboard drawing pad"
                            >
                              <div className="tool-card-icon-wrapper">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M12 20h9"></path>
                                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                                </svg>
                              </div>
                              <div className="tool-card-info">
                                <span className="tool-card-title">Shared Whiteboard</span>
                                <span className="tool-card-desc">Draw and brainstorm with neon markers.</span>
                              </div>
                            </div>

                            {/* Screen Share card button */}
                            <div 
                              className={`tool-card ${screenShareStream ? 'active' : ''}`}
                              onClick={screenShareStream ? stopScreenShare : startScreenShare}
                              title={screenShareStream ? 'Stop screen sharing' : 'Start sharing screen'}
                            >
                              <div className="tool-card-icon-wrapper" style={{ color: screenShareStream ? '#ef4444' : 'inherit' }}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                                  <line x1="8" y1="21" x2="16" y2="21"></line>
                                  <line x1="12" y1="17" x2="12" y2="21"></line>
                                </svg>
                              </div>
                              <div className="tool-card-info">
                                <span className="tool-card-title">
                                  {screenShareStream ? 'Stop Presenting' : 'Share Screen'}
                                </span>
                                <span className="tool-card-desc">
                                  {screenShareStream ? 'Stop sharing your screen.' : 'Present a tab, window, or full screen.'}
                                </span>
                              </div>
                            </div>

                            {/* Watch Together Card */}
                            <div 
                              className={`tool-card ${youtubeVideoId ? 'active' : ''}`}
                              onClick={() => {
                                setActiveToolDetail('youtube');
                                setActiveGameId(null);
                              }}
                              title="Watch YouTube together"
                            >
                              <div className="tool-card-icon-wrapper">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"></path>
                                  <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"></polygon>
                                </svg>
                              </div>
                              <div className="tool-card-info">
                                <span className="tool-card-title">Watch Together</span>
                                <span className="tool-card-desc">Play and stream YouTube links in call.</span>
                              </div>
                            </div>

                            {/* Pomodoro Timer Card */}
                            <div 
                              className={`tool-card ${pomodoroIsRunning ? 'active' : ''}`}
                              onClick={() => {
                                setActiveToolDetail('pomodoro');
                                setActiveGameId(null);
                              }}
                              title="Shared Pomodoro Timer session"
                            >
                              <div className="tool-card-icon-wrapper" style={{ color: pomodoroIsRunning ? 'var(--primary-color)' : 'inherit' }}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <circle cx="12" cy="12" r="10"></circle>
                                  <polyline points="12 6 12 12 16 14"></polyline>
                                </svg>
                              </div>
                              <div className="tool-card-info">
                                <span className="tool-card-title">Pomodoro Timer</span>
                                <span className="tool-card-desc">
                                  {pomodoroIsRunning ? `Running (${pomodoroPhase})` : 'Start work/break cycle timer.'}
                                </span>
                              </div>
                            </div>

                            {/* Session Target Card */}
                            <div 
                              className={`tool-card ${targetsList.some(t => !t.completed) ? 'active' : ''}`}
                              onClick={() => {
                                setActiveToolDetail('targets');
                                setActiveGameId(null);
                              }}
                              title="This week's target checklist"
                            >
                              <div className="tool-card-icon-wrapper">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="9 11 12 14 22 4"></polyline>
                                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
                                </svg>
                              </div>
                              <div className="tool-card-info">
                                <span className="tool-card-title">Session Target</span>
                                <span className="tool-card-desc">Weekly checklist and progress tracker.</span>
                              </div>
                            </div>

                            {/* Loose Timer Card */}
                            <div 
                              className={`tool-card ${looseIsRunning ? 'active' : ''}`}
                              onClick={() => {
                                setActiveToolDetail('loose');
                                setActiveGameId(null);
                              }}
                              title="Countup timer with per-step summary"
                            >
                              <div className="tool-card-icon-wrapper">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                                  <line x1="16" y1="2" x2="16" y2="6"></line>
                                  <line x1="8" y1="2" x2="8" y2="6"></line>
                                  <line x1="3" y1="10" x2="21" y2="10"></line>
                                </svg>
                              </div>
                              <div className="tool-card-info">
                                <span className="tool-card-title">Loose Timer</span>
                                <span className="tool-card-desc">Uncapped step-by-step elapsed timer.</span>
                              </div>
                            </div>

                          </div>
                        </div>

                        {/* Section 2: Fun Section (Disabled for everyone if toggle is OFF) */}
                        {(() => {
                          const isFunLocked = !allowFunTools;

                          return (
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                <h4 style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
                                  Fun Section
                                </h4>
                                {isFunLocked && (
                                  <span style={{ fontSize: '9px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>
                                    🔒 Study Mode Active
                                  </span>
                                )}
                              </div>
                              
                              <div className="tools-cards-grid">
                                {/* Games Party Card */}
                                <div 
                                  className={`tool-card ${isFunLocked ? 'locked-disabled' : ''}`}
                                  onClick={() => {
                                    if (isFunLocked) {
                                      showToast("🔒 Fun tools are disabled. Turn them on in Room Settings to play.");
                                      return;
                                    }
                                    setActiveToolDetail('games');
                                    setActiveGameId(null);
                                  }}
                                  title="Play games together"
                                >
                                  <div className="tool-card-icon-wrapper">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      <rect x="2" y="6" width="20" height="12" rx="2"></rect>
                                      <path d="M6 12h4m-2-2v4m7-2h.01m2.99 0h.01"></path>
                                    </svg>
                                  </div>
                                  <div className="tool-card-info">
                                    <span className="tool-card-title">Games Party</span>
                                    <span className="tool-card-desc">Play JKLM and multiplayer party games.</span>
                                  </div>
                                </div>

                                {/* T/D Wheel Card */}
                                <div 
                                  className={`tool-card ${isFunLocked ? 'locked-disabled' : ''}`}
                                  onClick={() => {
                                    if (isFunLocked) {
                                      showToast("🔒 Fun tools are disabled. Turn them on in Room Settings to play.");
                                      return;
                                    }
                                    setActiveToolDetail('truthordare');
                                    setActiveGameId(null);
                                  }}
                                  title="Play Truth or Dare spinner wheel"
                                >
                                  <div className="tool-card-icon-wrapper">
                                    🎲
                                  </div>
                                  <div className="tool-card-info">
                                    <span className="tool-card-title">T/D Wheel</span>
                                    <span className="tool-card-desc">Spin the wheel to play Truth or Dare.</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })()}



                      </div>
                    )}

                    {/* Sub-panel View 1: YouTube details */}
                    {activeToolDetail === 'youtube' && (
                      <div className="animate-fade-in">
                        <div className="tools-sub-panel-header">
                          <button onClick={() => setActiveToolDetail('none')} className="tools-back-btn" title="Back to tools list">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="19" y1="12" x2="5" y2="12"></line>
                              <polyline points="12 19 5 12 12 5"></polyline>
                            </svg>
                          </button>
                          <span className="tools-sub-panel-title">Watch Together</span>
                        </div>

                        {/* Platform Tabs Selection */}
                        <div style={{ display: 'flex', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
                          {(['youtube', 'vimeo', 'dailymotion', 'twitch'] as const).map((plat) => (
                            <button
                              key={plat}
                              type="button"
                              onClick={() => setWatchTogetherPlatform(plat)}
                              style={{
                                flex: 1,
                                minWidth: '70px',
                                padding: '8px 4px',
                                fontSize: '11px',
                                borderRadius: '6px',
                                border: '1px solid',
                                borderColor: watchTogetherPlatform === plat ? 'var(--primary-color)' : 'rgba(255,255,255,0.08)',
                                backgroundColor: watchTogetherPlatform === plat ? 'rgba(241, 196, 15, 0.1)' : 'var(--panel-bg)',
                                color: watchTogetherPlatform === plat ? 'var(--primary-color)' : 'var(--text-secondary)',
                                cursor: 'pointer',
                                fontWeight: watchTogetherPlatform === plat ? '700' : '500',
                                textTransform: 'capitalize',
                                transition: 'all 0.2s ease',
                                textAlign: 'center'
                              }}
                            >
                              {plat === 'youtube' ? 'YouTube' : plat === 'vimeo' ? 'Vimeo' : plat === 'dailymotion' ? 'Dailymotion' : 'Twitch'}
                            </button>
                          ))}
                        </div>

                        <form onSubmit={handleWatchTogetherSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          <div className="form-group">
                            <label htmlFor="ytUrl" className="form-label" style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                              {watchTogetherPlatform === 'youtube' ? 'YouTube URL or Video ID' : 
                               watchTogetherPlatform === 'vimeo' ? 'Vimeo URL or Video ID' : 
                               watchTogetherPlatform === 'dailymotion' ? 'Dailymotion URL or Video ID' : 
                               'Twitch Channel or VOD URL'}
                            </label>
                            <input 
                              type="text"
                              id="ytUrl"
                              placeholder={
                                watchTogetherPlatform === 'youtube' ? 'e.g. https://www.youtube.com/watch?v=dQw4w9WgXcQ' : 
                                watchTogetherPlatform === 'vimeo' ? 'e.g. https://vimeo.com/76979871' : 
                                watchTogetherPlatform === 'dailymotion' ? 'e.g. https://www.dailymotion.com/video/x8j7o2m' : 
                                'e.g. https://www.twitch.tv/twitch'
                              }
                              className="search-input"
                              style={{ paddingLeft: '12px', fontSize: '13px' }}
                              value={ytInputUrl}
                              onChange={(e) => setYtInputUrl(e.target.value)}
                              required
                            />
                          </div>
                          <button type="submit" className="btn-signin" style={{ width: '100%', padding: '10px' }}>
                            Load Media
                          </button>
                        </form>
                        
                        {youtubeVideoId && (
                          <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Currently Playing Video ID: <strong>{youtubeVideoId}</strong></span>
                            <button 
                              onClick={async () => {
                                setYoutubeVideoId(null);
                                await clearMySharing();
                                setViewingShare(null);
                                showToast('YouTube presentation stopped');
                              }} 
                              className="btn-signin" 
                              style={{ width: '100%', backgroundColor: '#ef4444', borderColor: '#ef4444', color: '#ffffff' }}
                            >
                              Stop Watching
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Sub-panel View 2: Games Selector Details */}
                    {activeToolDetail === 'games' && (
                      <div className="animate-fade-in">
                        <div className="tools-sub-panel-header">
                          <button 
                            onClick={() => {
                              if (activeGameId) {
                                setActiveGameId(null);
                              } else {
                                setActiveToolDetail('none');
                              }
                            }} 
                            className="tools-back-btn" 
                            title="Back"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="19" y1="12" x2="5" y2="12"></line>
                              <polyline points="12 19 5 12 12 5"></polyline>
                            </svg>
                          </button>
                          <span className="tools-sub-panel-title">
                            {activeGameId ? `Play ${activeGameId.toUpperCase()}` : 'Games Party'}
                          </span>
                        </div>

                        {!activeGameId ? (
                          /* Grid of game options */
                          <div className="games-options-grid">
                            
                            {/* Agar.io */}
                            <div className="game-card-item" onClick={() => handleLaunchGame('agar')}>
                              <div className="game-item-icon-wrapper">🦠</div>
                              <span className="game-card-name">Agar.io</span>
                            </div>

                            {/* Slither.io */}
                            <div className="game-card-item" onClick={() => handleLaunchGame('slither')}>
                              <div className="game-item-icon-wrapper">🐍</div>
                              <span className="game-card-name">Slither.io</span>
                            </div>

                            {/* Skribbl.io */}
                            <div className="game-card-item" onClick={() => handleLaunchGame('skribbl')}>
                              <div className="game-item-icon-wrapper">✏️</div>
                              <span className="game-card-name">Skribbl.io</span>
                            </div>

                            {/* Codenames */}
                            <div className="game-card-item" onClick={() => handleLaunchGame('codenames')}>
                              <div className="game-item-icon-wrapper">🕵️</div>
                              <span className="game-card-name">Codenames</span>
                            </div>

                            {/* JKLM */}
                            <div className="game-card-item" onClick={() => handleLaunchGame('jklm')}>
                              <div className="game-item-icon-wrapper">💣</div>
                              <span className="game-card-name">JKLM.fun</span>
                            </div>

                          </div>
                        ) : (
                          /* Form to generate or paste invite links */
                          <form onSubmit={handleShareGameInvite} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div className="form-group">
                              <label htmlFor="inviteUrl" className="form-label" style={{ fontSize: '11px' }}>Game Room Invite Link</label>
                              <input 
                                type="text"
                                id="inviteUrl"
                                className="search-input"
                                style={{ paddingLeft: '12px', fontSize: '13px' }}
                                value={gameInviteInput}
                                onChange={(e) => setGameInviteInput(e.target.value)}
                                required
                              />
                            </div>
                            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                              Clicking "Start sharing" will launch the game in a new browser tab and automatically share the invite URL in the room chat for others to join!
                            </span>
                            <button type="submit" className="btn-signin" style={{ width: '100%', padding: '10px' }}>
                              Start Sharing & Launch
                            </button>
                          </form>
                        )}
                      </div>
                    )}

                    {/* Sub-panel View 3: Pomodoro Timer Controls */}
                    {activeToolDetail === 'pomodoro' && (
                      <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column' }}>
                        <div className="tools-sub-panel-header">
                          <button onClick={() => setActiveToolDetail('none')} className="tools-back-btn" title="Back">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="19" y1="12" x2="5" y2="12"></line>
                              <polyline points="12 19 5 12 12 5"></polyline>
                            </svg>
                          </button>
                          <span className="tools-sub-panel-title">Pomodoro Timer</span>
                          <button 
                            onClick={() => setExpandedTool(expandedTool === 'pomodoro' ? 'none' : 'pomodoro')} 
                            className={`tools-expand-btn ${expandedTool === 'pomodoro' ? 'active' : ''}`}
                            title="Expand to Stage"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="15 3 21 3 21 9"></polyline>
                              <polyline points="9 21 3 21 3 15"></polyline>
                              <line x1="21" y1="3" x2="14" y2="10"></line>
                              <line x1="3" y1="21" x2="10" y2="14"></line>
                            </svg>
                          </button>
                        </div>
                        {renderPomodoroUI(false)}
                      </div>
                    )}

                    {/* Sub-panel View 4: Session Target checklist */}
                    {activeToolDetail === 'targets' && (
                      <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column' }}>
                        <div className="tools-sub-panel-header">
                          <button onClick={() => setActiveToolDetail('none')} className="tools-back-btn" title="Back">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="19" y1="12" x2="5" y2="12"></line>
                              <polyline points="12 19 5 12 12 5"></polyline>
                            </svg>
                          </button>
                          <span className="tools-sub-panel-title">Session Target</span>
                        </div>

                        {/* Checklist Container */}
                        <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius)', padding: '16px', marginBottom: '16px' }}>
                          {!user && (
                            <div style={{ fontSize: '11px', color: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.05)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: '4px', padding: '8px', marginBottom: '12px', lineHeight: '1.4' }}>
                              ⚠️ You are a guest. <strong>Sign in</strong> to save your targets permanently across devices, otherwise progress will be lost on page reload.
                            </div>
                          )}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                            <div>
                              <h5 style={{ fontSize: '14px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>This week's targets</h5>
                              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Week of Jul 6 – Jul 12</span>
                            </div>
                            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--primary-color)' }}>
                              {targetsList.filter(t => t.completed).length} / {targetsList.length} done
                            </span>
                          </div>

                          {/* List of items */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', margin: '16px 0' }}>
                            {targetsList.map(item => (
                              <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px', color: item.completed ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
                                <input 
                                  type="checkbox" 
                                  checked={item.completed}
                                  onChange={() => handleToggleTarget(item.id)}
                                  style={{
                                    width: '16px',
                                    height: '16px',
                                    borderRadius: '4px',
                                    border: '1px solid var(--border-color)',
                                    cursor: 'pointer',
                                    accentColor: 'var(--primary-color)'
                                  }}
                                />
                                <span style={{ textDecoration: item.completed ? 'line-through' : 'none' }}>
                                  {item.text}
                                </span>
                              </label>
                            ))}
                            {targetsList.length === 0 && (
                              <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontStyle: 'italic', textAlign: 'center', display: 'block', padding: '12px 0' }}>
                                No targets set for this week yet.
                              </span>
                            )}
                          </div>

                          {/* Add target form */}
                          <form onSubmit={handleAddTarget} style={{ display: 'flex', gap: '8px' }}>
                            <input 
                              type="text"
                              placeholder="Add a target for this week"
                              className="search-input"
                              style={{ paddingLeft: '12px', fontSize: '13px', height: '36px' }}
                              value={targetInputText}
                              onChange={(e) => setTargetInputText(e.target.value)}
                              required
                            />
                            <button type="submit" className="btn-signin" style={{ width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                              +
                            </button>
                          </form>
                        </div>

                        {/* Progress History strip */}
                        <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '16px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                              Progress History
                            </span>
                            <button 
                              onClick={handleStartNewWeek} 
                              className="btn-signin" 
                              style={{ padding: '4px 8px', fontSize: '10px', height: 'auto', backgroundColor: 'var(--button-secondary-bg)', border: '1px solid var(--border-color)' }}
                              title="Archive current checklist and start a new week"
                            >
                              New Week
                            </button>
                          </div>

                          {/* History Bars Row */}
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                            {targetsHistory.map((hist, idx) => {
                              const fullyDone = hist.completedCount === hist.totalCount && hist.totalCount > 0;
                              const barColor = fullyDone ? '#10b981' : '#f59e0b'; // Green vs Amber
                              return (
                                <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                  <div 
                                    style={{ 
                                      height: '32px', 
                                      borderRadius: '4px', 
                                      backgroundColor: barColor, 
                                      opacity: 0.8,
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      fontSize: '9px',
                                      fontWeight: 800,
                                      color: '#000000'
                                    }}
                                    title={`${hist.completedCount}/${hist.totalCount} completed`}
                                  >
                                    {hist.completedCount}/{hist.totalCount}
                                  </div>
                                  <span style={{ fontSize: '9px', color: 'var(--text-secondary)', textAlign: 'center' }}>
                                    {hist.date}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                      </div>
                    )}

                    {/* Sub-panel View 5: Mini Deadline Clock */}
                    {activeToolDetail === 'deadline' && (
                      <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column' }}>
                        <div className="tools-sub-panel-header">
                          <button onClick={() => setActiveToolDetail('none')} className="tools-back-btn" title="Back">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="19" y1="12" x2="5" y2="12"></line>
                              <polyline points="12 19 5 12 12 5"></polyline>
                            </svg>
                          </button>
                          <span className="tools-sub-panel-title">Deadline Clock</span>
                          <button 
                            onClick={() => setExpandedTool(expandedTool === 'deadline' ? 'none' : 'deadline')} 
                            className={`tools-expand-btn ${expandedTool === 'deadline' ? 'active' : ''}`}
                            title="Expand to Stage"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="15 3 21 3 21 9"></polyline>
                              <polyline points="9 21 3 21 3 15"></polyline>
                              <line x1="21" y1="3" x2="14" y2="10"></line>
                              <line x1="3" y1="21" x2="10" y2="14"></line>
                            </svg>
                          </button>
                        </div>
                        {renderDeadlineUI(false)}
                      </div>
                    )}

                    {/* Sub-panel View 6: Loose Timer */}
                    {activeToolDetail === 'loose' && (
                      <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column' }}>
                        <div className="tools-sub-panel-header">
                          <button onClick={() => setActiveToolDetail('none')} className="tools-back-btn" title="Back">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="19" y1="12" x2="5" y2="12"></line>
                              <polyline points="12 19 5 12 12 5"></polyline>
                            </svg>
                          </button>
                          <span className="tools-sub-panel-title">Loose Timer</span>
                          <button 
                            onClick={() => setExpandedTool(expandedTool === 'loose' ? 'none' : 'loose')} 
                            className={`tools-expand-btn ${expandedTool === 'loose' ? 'active' : ''}`}
                            title="Expand to Stage"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="15 3 21 3 21 9"></polyline>
                              <polyline points="9 21 3 21 3 15"></polyline>
                              <line x1="21" y1="3" x2="14" y2="10"></line>
                              <line x1="3" y1="21" x2="10" y2="14"></line>
                            </svg>
                          </button>
                        </div>
                        {renderLooseTimerUI(false)}
                      </div>
                    )}

                    {/* Sub-panel View 7: Truth or Dare */}
                    {activeToolDetail === 'truthordare' && (
                      <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column' }}>
                        <div className="tools-sub-panel-header">
                          <button onClick={() => setActiveToolDetail('none')} className="tools-back-btn" title="Back">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="19" y1="12" x2="5" y2="12"></line>
                              <polyline points="12 19 5 12 12 5"></polyline>
                            </svg>
                          </button>
                          <span className="tools-sub-panel-title">Truth or Dare</span>
                          <button 
                            onClick={() => setExpandedTool(expandedTool === 'truthordare' ? 'none' : 'truthordare')} 
                            className={`tools-expand-btn ${expandedTool === 'truthordare' ? 'active' : ''}`}
                            title="Expand to Stage"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="15 3 21 3 21 9"></polyline>
                              <polyline points="9 21 3 21 3 15"></polyline>
                              <line x1="21" y1="3" x2="14" y2="10"></line>
                              <line x1="3" y1="21" x2="10" y2="14"></line>
                            </svg>
                          </button>
                        </div>
                        {renderTruthOrDareUI(false)}
                      </div>
                    )}

                    {/* Sub-panel View 8: Spin the Wheel */}
                    {activeToolDetail === 'spin' && (
                      <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column' }}>
                        <div className="tools-sub-panel-header">
                          <button onClick={() => setActiveToolDetail('none')} className="tools-back-btn" title="Back">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="19" y1="12" x2="5" y2="12"></line>
                              <polyline points="12 19 5 12 12 5"></polyline>
                            </svg>
                          </button>
                          <span className="tools-sub-panel-title">Spin the Wheel</span>
                          <button 
                            onClick={() => setExpandedTool(expandedTool === 'spin' ? 'none' : 'spin')} 
                            className={`tools-expand-btn ${expandedTool === 'spin' ? 'active' : ''}`}
                            title="Expand to Stage"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="15 3 21 3 21 9"></polyline>
                              <polyline points="9 21 3 21 3 15"></polyline>
                              <line x1="21" y1="3" x2="14" y2="10"></line>
                              <line x1="3" y1="21" x2="10" y2="14"></line>
                            </svg>
                          </button>
                        </div>
                        {renderSpinWheelUI(false)}
                      </div>
                    )}



                  </div>
                )}

              </div>
            </div>

          </div>

          {/* Call Control Dock (Bottom Toolbar) */}
          <div className="call-bottom-dock">
            
            {/* Mic Toggle Button */}
            <button 
              onClick={toggleMic} 
              className={`dock-btn ${isMicMuted ? 'active-off' : ''}`}
              title={isMicMuted ? 'Unmute microphone' : 'Mute microphone'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {isMicMuted ? (
                  <>
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
                    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
                  </>
                ) : (
                  <>
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                    <line x1="12" y1="19" x2="12" y2="23"></line>
                    <line x1="8" y1="23" x2="16" y2="23"></line>
                  </>
                )}
              </svg>
            </button>
            
            {/* Camera Toggle Button */}
            <button 
              onClick={toggleCamera} 
              className={`dock-btn ${isCamOff ? 'active-off' : ''}`}
              title={isCamOff ? 'Turn camera on' : 'Turn camera off'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {isCamOff ? (
                  <>
                    <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m4 0h5a2 2 0 0 1 2 2v3m-2.11-.11l3.44-5.16a1 1 0 0 1 1.67 1.1l-2.22 3.34"></path>
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                  </>
                ) : (
                  <>
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                    <circle cx="12" cy="13" r="4"></circle>
                  </>
                )}
              </svg>
            </button>
            
            {/* Layout Toggle Button */}
            <button 
              onClick={() => setIsGalleryView(!isGalleryView)} 
              className="dock-btn"
              title={isGalleryView ? 'Switch to Grid View' : 'Switch to Gallery View'}
            >
              {isGalleryView ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="9"></rect>
                  <rect x="14" y="3" width="7" height="5"></rect>
                  <rect x="14" y="12" width="7" height="9"></rect>
                  <rect x="3" y="16" width="7" height="5"></rect>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7"></rect>
                  <rect x="14" y="3" width="7" height="7"></rect>
                  <rect x="14" y="14" width="7" height="7"></rect>
                  <rect x="3" y="14" width="7" height="7"></rect>
                </svg>
              )}
            </button>
            
            {/* Leave / End Call Button */}
            <button 
              onClick={handleLeaveCall} 
              className="dock-btn dock-btn-leave"
              style={{ marginRight: '8px' }}
              title="Leave room call"
            >
              Leave
            </button>
            
            {/* End Room Button */}
            {(callParticipants.find(part => part.id === getMyId())?.role === 'admin' || 
              (callParticipants.find(part => part.id === getMyId())?.role === 'host' && currentRoom && currentRoom.creatorId === getMyId())) && (
              <button 
                onClick={handleEndRoom} 
                className="dock-btn dock-btn-leave"
                style={{ backgroundColor: '#ef4444', borderColor: '#ef4444', color: '#ffffff' }}
                title="End room call for everyone"
              >
                End Room
              </button>
            )}

          </div>
          </>
          )}

          {renderPipWindow()}

        </LiveKitRoom>
          </div>
          )
        ) : (
          <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: '16px' }}>
            <div 
              style={{ 
                width: '40px', 
                height: '40px', 
                borderRadius: '50%',
                border: '3px solid rgba(255,255,255,0.1)', 
                borderTopColor: 'var(--primary-color)', 
                animation: 'spin 1s linear infinite' 
              }}
            />
            <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Joining study room...</span>
          </div>
        )
      } />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>

      {/* 3. Join Request Loading/Waiting Screen for "Ask to Join" rooms */}
      {pendingJoinRoom && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div className="modal-container animate-fade-in" style={{ maxWidth: '380px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '32px' }}>
            <div className="spinner" style={{ marginBottom: '24px' }}></div>
            <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
              Waiting for host approval
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: 1.5 }}>
              You have requested to join **"{pendingJoinRoom.name}"**. You will enter the room as soon as the host accepts.
            </p>
            <button 
              onClick={() => setPendingJoinRoom(null)} 
              className="btn-create" 
              style={{ width: '100%', padding: '10px', fontSize: '14px', justifyContent: 'center' }}
            >
              Cancel request
            </button>
          </div>
        </div>
      )}

      {/* Sign In Prompt Modal */}
      {showSignInPrompt && !user && (
        <div className="modal-overlay" style={{ zIndex: 1200 }}>
          <div className="modal-container animate-fade-in" style={{ maxWidth: '400px', textAlign: 'center' }}>
            <h3 style={{ fontSize: '18px', marginBottom: '12px', fontWeight: '600' }}>Sign in to create a room</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '14px', lineHeight: '1.5' }}>
              You need a Google account to create and host rooms.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button type="button" className="btn-secondary" onClick={() => setShowSignInPrompt(false)} style={{ padding: '8px 16px' }}>Cancel</button>
              <button type="button" className="btn-signin" onClick={() => {
                setShowSignInPrompt(false);
                handleSignIn().then(() => {
                  // After successful sign in, open the modal
                  setTimeout(() => setIsModalOpen(true), 500);
                });
              }} style={{ padding: '8px 16px' }}>Sign in</button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Create Room Modal Dialog (rendered on dashboard) */}
      {isModalOpen && !currentRoom && (
        <div className="modal-overlay" onClick={handleBackdropClick}>
          <div className="modal-container animate-fade-in" ref={modalRef}>
            
            {/* Modal Header */}
            <div className="modal-header">
              <h2 className="modal-title">{modalStep === 'form' ? 'Create room' : 'Success'}</h2>
              {/* Only show close X on form step */}
              {modalStep === 'form' && (
                <button onClick={closeModal} className="modal-close-btn" aria-label="Close modal">
                  <svg 
                    xmlns="http://www.w3.org/2000/svg" 
                    width="20" 
                    height="20" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              )}
            </div>

            {modalStep === 'form' ? (
              /* Modal Form Page */
              <form onSubmit={handleCreateRoom}>
                
                {/* Start Now vs Schedule Button Toggle Group */}
                <div className="form-group" style={{ marginBottom: '20px' }}>
                  <label className="form-label">Timing</label>
                  <div className="toggle-buttons">
                    <button 
                      type="button"
                      className={`toggle-button ${startOption === 'now' ? 'active' : ''}`}
                      onClick={() => setStartOption('now')}
                    >
                      Start now
                    </button>
                    <button 
                      type="button"
                      className={`toggle-button ${startOption === 'later' ? 'active' : ''}`}
                      onClick={() => setStartOption('later')}
                    >
                      Schedule for later
                    </button>
                  </div>
                </div>

                {/* Conditional Schedule Fields */}
                {startOption === 'later' && (
                  <div className="form-group animate-fade-in" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
                    <div>
                      <label htmlFor="scheduleDate" className="form-label">Date</label>
                      <input 
                        type="date" 
                        id="scheduleDate"
                        className="search-input"
                        style={{ paddingLeft: '12px', width: '100%' }}
                        value={scheduleDate}
                        onChange={(e) => setScheduleDate(e.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <label htmlFor="scheduleTime" className="form-label">Time</label>
                      <input 
                        type="time" 
                        id="scheduleTime"
                        className="search-input"
                        style={{ paddingLeft: '12px', width: '100%' }}
                        value={scheduleTime}
                        onChange={(e) => setScheduleTime(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                )}
                
                {/* Room Name Input */}
                <div className="form-group" style={{ marginBottom: '20px' }}>
                  <label htmlFor="roomName" className="form-label">Room name</label>
                  <input 
                    type="text" 
                    id="roomName" 
                    placeholder="DSA grind - arrays" 
                    className="search-input" 
                    style={{ paddingLeft: '16px' }} 
                    value={newRoomName}
                    onChange={(e) => setNewRoomName(e.target.value)}
                    required
                    autoFocus
                  />
                </div>

                {/* Room Type Stacked Radios */}
                <div className="form-group" style={{ marginBottom: '20px' }}>
                  <label className="form-label">Room type</label>
                  <div className="radio-group">
                    
                    {/* Private Card */}
                    <div 
                      className={`radio-card ${newRoomType === 'private' ? 'active' : ''}`}
                      onClick={() => setNewRoomType('private')}
                    >
                      <div className="radio-indicator">
                        {newRoomType === 'private' && <div className="radio-dot" />}
                      </div>
                      <div className="radio-content">
                        <span className="radio-title">Private</span>
                        <span className="radio-desc">Only people with the link can join. Not listed anywhere.</span>
                      </div>
                    </div>

                    {/* Public - Ask to Join Card */}
                    <div 
                      className={`radio-card ${newRoomType === 'public-ask' ? 'active' : ''}`}
                      onClick={() => setNewRoomType('public-ask')}
                    >
                      <div className="radio-indicator">
                        {newRoomType === 'public-ask' && <div className="radio-dot" />}
                      </div>
                      <div className="radio-content">
                        <span className="radio-title">Public - ask to join</span>
                        <span className="radio-desc">Listed on the dashboard. Host approves each join request.</span>
                      </div>
                    </div>

                    {/* Public Card */}
                    <div 
                      className={`radio-card ${newRoomType === 'public' ? 'active' : ''}`}
                      onClick={() => setNewRoomType('public')}
                    >
                      <div className="radio-indicator">
                        {newRoomType === 'public' && <div className="radio-dot" />}
                      </div>
                      <div className="radio-content">
                        <span className="radio-title">Public</span>
                        <span className="radio-desc">Listed on the dashboard. Anyone can join instantly.</span>
                      </div>
                    </div>

                  </div>
                </div>

                {/* Max Participants Input */}
                <div className="form-group" style={{ marginBottom: '28px' }}>
                  <label htmlFor="maxParticipants" className="form-label">Max participants</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button 
                      type="button"
                      onClick={() => setNewMaxParticipants(Math.max(0, newMaxParticipants - 1))}
                      style={{ width: '44px', height: '44px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--panel-bg)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </button>
                    <input 
                      type="number" 
                      id="maxParticipants" 
                      min="0" 
                      max="18"
                      className="search-input"
                      style={{ textAlign: 'center', flex: 1, padding: '0' }}
                      value={newMaxParticipants}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setNewMaxParticipants(isNaN(val) ? 0 : Math.min(18, val));
                      }}
                      required
                    />
                    <button 
                      type="button"
                      onClick={() => setNewMaxParticipants(Math.min(18, newMaxParticipants + 1))}
                      style={{ width: '44px', height: '44px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--panel-bg)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </button>
                  </div>
                  {newMaxParticipants === 0 && (
                    <div style={{ color: '#ef4444', fontSize: '13px', marginTop: '8px', fontWeight: 500 }}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline', marginRight: '4px', verticalAlign: 'text-bottom' }}><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                      At least 1 participant is required.
                    </div>
                  )}
                </div>

                {/* Bottom Create Button */}
                <button type="submit" className="btn-signin" style={{ width: '100%', padding: '12px 16px', fontSize: '15px' }}>
                  {startOption === 'later' ? 'Schedule room' : 'Create room'}
                </button>

              </form>
            ) : (
              /* Success / Share Link Confirmation Page */
              <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '8px 0' }}>
                {/* Success Icon */}
                <div style={{ 
                  width: '56px', 
                  height: '56px', 
                  borderRadius: '50%', 
                  backgroundColor: 'rgba(34, 197, 94, 0.1)', 
                  color: '#22c55e', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  marginBottom: '16px'
                }}>
                  <svg 
                    xmlns="http://www.w3.org/2000/svg" 
                    width="28" 
                    height="28" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="3" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </div>

                <h3 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
                  {startOption === 'later' ? 'Room scheduled!' : 'Room created!'}
                </h3>

                <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px', maxWidth: '320px', lineHeight: 1.5 }}>
                  {startOption === 'later' 
                    ? `Room scheduled for ${formatFriendlyDate(scheduleDate)} at ${scheduleTime}. Copy the link to invite participants in advance.`
                    : 'Your study room is active. Share the link below to invite participants.'
                  }
                </p>

                {/* Link Copy Field Box */}
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  width: '100%', 
                  backgroundColor: 'var(--input-bg)', 
                  border: '1px solid var(--input-border)', 
                  borderRadius: 'var(--btn-radius)', 
                  padding: '4px',
                  marginBottom: '32px'
                }}>
                  <a 
                    href={`/room/${generatedRoomLink.split('/').pop()}`}
                    onClick={(e) => {
                      e.preventDefault();
                      closeModal();
                      window.open(`/room/${generatedRoomLink.split('/').pop()}`, '_blank');
                    }}
                    style={{ 
                      fontFamily: 'monospace', 
                      fontSize: '14px', 
                      color: 'var(--primary-color)', 
                      padding: '8px 12px',
                      textAlign: 'left',
                      flexGrow: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      textDecoration: 'underline',
                      cursor: 'pointer'
                    }}
                  >
                    {generatedRoomLink}
                  </a>
                  
                  <button 
                    type="button" 
                    onClick={handleCopyLink}
                    className="btn-signin"
                    style={{ 
                      padding: '8px 16px', 
                      fontSize: '13px', 
                      borderRadius: 'calc(var(--btn-radius) * 0.83)',
                      whiteSpace: 'nowrap',
                      backgroundColor: isCopied ? '#22c55e' : 'var(--primary-color)',
                      color: isCopied ? '#ffffff' : 'var(--primary-text)',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {isCopied ? 'Copied!' : 'Copy link'}
                  </button>
                </div>

                {/* Done close button */}
                <button 
                  onClick={closeModal} 
                  className="btn-create" 
                  style={{ width: '100%', padding: '12px 16px', fontSize: '15px', justifyContent: 'center' }}
                >
                  Done
                </button>
              </div>
            )}

          </div>
        </div>
      )}

      {/* 5. Custom Toast Alerts Popup */}
      {toastMessage && (
        <div className="toast-container animate-fade-in">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--primary-color)' }}>
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 6. Guest Profile Editor Modal */}
      {isProfileModalOpen && (
        <div className="modal-overlay" onClick={() => setIsProfileModalOpen(false)} style={{ zIndex: 1200 }}>
          <div className="modal-container animate-fade-in" style={{ maxWidth: '360px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Edit profile</h2>
              <button onClick={() => setIsProfileModalOpen(false)} className="modal-close-btn" aria-label="Close modal">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            <form onSubmit={handleSaveProfile}>
              <div className="form-group" style={{ marginBottom: '20px' }}>
                <label htmlFor="profileName" className="form-label">Nickname</label>
                <input 
                  type="text" 
                  id="profileName"
                  className="search-input"
                  style={{ paddingLeft: '16px' }}
                  value={profileEditName}
                  onChange={(e) => setProfileEditName(e.target.value)}
                  required
                  maxLength={25}
                />
              </div>

              <div className="form-group" style={{ marginBottom: '20px' }}>
                <label htmlFor="profilePhotoURL" className="form-label">Avatar Image URL (optional)</label>
                <input 
                  type="url" 
                  id="profilePhotoURL"
                  className="search-input"
                  style={{ paddingLeft: '16px' }}
                  value={profileEditPhotoURL}
                  onChange={(e) => setProfileEditPhotoURL(e.target.value)}
                  placeholder="https://example.com/avatar.png"
                />
              </div>

              <div className="form-group" style={{ marginBottom: '28px' }}>
                <label className="form-label">Avatar Color</label>
                <div className="color-swatch-picker">
                  {['#8b5cf6', '#3b82f6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444'].map(color => (
                    <div 
                      key={color}
                      className={`color-swatch-circle ${profileEditColor === color ? 'selected' : ''}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setProfileEditColor(color)}
                    >
                      {profileEditColor === color && (
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <button type="submit" className="btn-signin" style={{ width: '100%', padding: '12px 16px', fontSize: '15px' }}>
                Save changes
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
