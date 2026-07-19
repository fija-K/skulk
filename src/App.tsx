import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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
  serverTimestamp,
  query,
  orderBy,
  limit,
  where,
  writeBatch,
  addDoc
} from 'firebase/firestore';
import { auth, googleProvider, signInWithPopup, signOut, db } from './firebase';
import tdData from '../td.json';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useLocalParticipant,
  useParticipants
} from '@livekit/components-react';
import '@livekit/components-styles';
import { VideoPresets } from 'livekit-client';


import { parseMediaUrl, isDrmBlockedUrl, loadYoutubeApi, loadVimeoApi, loadTwitchApi } from './utils/helpers';
import { UniversalVideoPlayer } from './components/video/UniversalVideoPlayer';
import { SpotifyPlayer } from './components/video/SpotifyPlayer';
import { ChatPanel } from './components/chat/ChatPanel';
import { StudyBuddiesPanel } from './components/chat/StudyBuddiesPanel';
import { WhiteboardView } from './components/whiteboard/WhiteboardView';
import { TruthOrDareUI, SpinWheelUI } from './components/games/GamesView';
import { ParticipantTile } from './components/call/ParticipantTile';
import { ParticipantVideo, ScreenShareVideo } from './components/call/ParticipantVideo';
import { LocalScreenShareLinker } from './components/call/LocalScreenShareLinker';
import { DeviceRecoveryManager } from './components/call/DeviceRecoveryManager';
import { usePresence } from './hooks/usePresence';
import { useRoomState } from './hooks/useRoomState';
import { useSessionLogger } from './hooks/useSessionLogger';
import { UserProfileCard } from './components/social/UserProfileCard';
import { DMPanel } from './components/chat/DMPanel';

export interface Room {
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
  creatorEmail?: string;
  createdAt?: string;
  currentHostId?: string;
  currentHostName?: string;
  isLocalOnly?: boolean;
  emptySince?: number;
  roomMode?: 'chill' | 'discuss' | 'non-discuss';
  allowFunTools?: boolean;

  // Voting system fields
  voteQuestion?: string | null;
  voteOptions?: string[] | null;
  voteCreatorId?: string | null;
  voteCreatorName?: string | null;
  voteStatus?: 'active' | 'closed' | null;
  voteResults?: Record<string, number> | null;
}

export interface Participant {
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
  sharing?: 'youtube' | 'whiteboard' | 'screen' | 'spotify' | null;
  sharingYoutubeId?: string | null;
  whiteboardData?: string;
  role?: 'admin' | 'host' | 'cohost' | 'member' | 'bot'; // admin, host, cohost, member, bot
  mutedBy?: string;
  camOffBy?: string;
  todJoined?: boolean;
  todPending?: boolean;
  todRequestedSpin?: number | null;
  todRequestedChoice?: 'Truth' | 'Dare' | null;
  todRequestedReset?: number | null;
  status?: 'none' | 'dnd' | 'zZ' | 'brb' | 'chillin' | null;
  ytPlaying?: boolean;
  ytTime?: number;
  ytUpdateTimestamp?: number;
  ytSpeed?: number;
  whiteboardEditAllowed?: boolean;
  micOn?: boolean;
  camOn?: boolean;
  micRestricted?: boolean;
  camRestricted?: boolean;
  uid?: string;
  joinedAt?: string | null;
  sessionId?: string | null;

  // Hand Raise & Voting states
  handRaised?: boolean;
  handRaisedAt?: number | null;
  castVote?: string | null;
  isBot?: boolean;
  celebratedAt?: number | null;
}

export type ViewingShare = {
  participantId: string;
  type: 'youtube' | 'whiteboard' | 'screen' | 'spotify';
  youtubeVideoId?: string;
};

export interface ChatMessage {
  id: string;
  sender: string;
  senderId?: string;
  senderRole?: 'admin' | 'host' | 'cohost' | 'member' | 'bot';
  text: string;
  createdAt?: string;
  mentionedId?: string;
  deleted?: boolean;
}

interface LocalSpeakerTrackerProps {
  onSpeakingChange: (speaking: boolean) => void;
}

function LocalSpeakerTracker({ onSpeakingChange }: LocalSpeakerTrackerProps) {
  const { localParticipant } = useLocalParticipant();
  useEffect(() => {
    if (!localParticipant) return;
    const handleSpeaking = (isSpeaking: boolean) => {
      onSpeakingChange(isSpeaking);
    };
    onSpeakingChange(localParticipant.isSpeaking);
    localParticipant.on('isSpeakingChanged', handleSpeaking);
    return () => {
      localParticipant.off('isSpeakingChanged', handleSpeaking);
    };
  }, [localParticipant, onSpeakingChange]);
  return null;
}

export default function App() {
  return <AppContent />;
}

const truthQuestions = tdData.game.td.truths;
const dareQuestions = tdData.game.td.dares;

const THEME_PRESETS = [
  { key: 'gotham-3d', name: 'Gotham City (3D)', imageUrl: '/themes/gotham_3d.jpg', accentColor: '#38bdf8', accentHoverColor: '#0ea5e9' },
  { key: 'gotham-comic', name: 'Gotham City (Comic)', imageUrl: '/themes/gotham_comic.jpg', accentColor: '#facc15', accentHoverColor: '#eab308' },
  { key: 'matrix-green', name: 'Matrix Code (Green)', imageUrl: '/themes/matrix_green.jpg', accentColor: '#22c55e', accentHoverColor: '#16a34a' },
  { key: 'matrix-pink', name: 'Matrix Code (Pink)', imageUrl: '/themes/matrix_pink.jpg', accentColor: '#ec4899', accentHoverColor: '#db2777' },
  { key: 'tech-workbench', name: 'Tech Workbench', imageUrl: '/themes/tech_workbench.jpg', accentColor: '#06b6d4', accentHoverColor: '#0891b2' },
  { key: 'steampunk-mary', name: 'Cyber Mary', imageUrl: '/themes/steampunk_mary.jpg', accentColor: '#f97316', accentHoverColor: '#ea580c' },
  { key: 'babushka-animals', name: 'Babushka Animals', imageUrl: '/themes/babushka_animals.jpg', accentColor: '#f59e0b', accentHoverColor: '#d97706' },
  { key: 'oriental-collage', name: 'Oriental Collage', imageUrl: '/themes/oriental_collage.jpg', accentColor: '#e11d48', accentHoverColor: '#be123c' },
  { key: 'pop-art', name: 'Pop-Art Collage', imageUrl: '/themes/pop_art.jpg', accentColor: '#a855f7', accentHoverColor: '#9333ea' }
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
  sendChatMessage: (text: string, mentionedId?: string) => Promise<void>;
  micBlockedUntil?: number | null;
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
  sendChatMessage,
  micBlockedUntil
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
                      {msg.deleted ? (
                        <span style={{ fontSize: '11px', color: '#475569', fontStyle: 'italic', marginTop: '1px' }}>🚫 This message was deleted</span>
                      ) : msg.text.startsWith('[IMAGE]:') || msg.text.startsWith('[GIF]:') || msg.text.startsWith('[STICKER]:') ? (
                        <img 
                          src={msg.text.slice(msg.text.indexOf(':') + 1)} 
                          alt="Shared media" 
                          style={{ 
                            maxWidth: '100%', 
                            maxHeight: '120px', 
                            borderRadius: '4px', 
                            marginTop: '2px', 
                            objectFit: 'contain', 
                            border: '1px solid rgba(255,255,255,0.1)' 
                          }} 
                        />
                      ) : (
                        <span style={{ fontSize: '11px', color: '#e2e8f0', wordBreak: 'break-word', marginTop: '1px' }}>
                          {msg.text}
                          {msg.edited && <span style={{ fontSize: '9px', color: '#475569', marginLeft: '3px', fontStyle: 'italic' }}>(edited)</span>}
                        </span>
                      )}
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
        {(() => {
          const myPresence = callParticipants.find(p => p.id === myId);
          const isMutedByHost = !!(myPresence && myPresence.mutedBy && myPresence.mutedBy !== myId);
          const isCamDisabledByHost = !!(myPresence && myPresence.camOffBy && myPresence.camOffBy !== myId);
          const isBlocked = !!(micBlockedUntil && Date.now() < micBlockedUntil);
          const remainingBlockedSecs = isBlocked ? Math.ceil((micBlockedUntil! - Date.now()) / 1000) : 0;
          
          return (
            <>
              <button 
                onClick={toggleMic}
                style={{
                  background: isMutedByHost ? '#ef4444' : isBlocked ? 'rgba(239, 68, 68, 0.15)' : isMicMuted ? '#ef4444' : '#2d3139',
                  border: isBlocked ? '1px solid rgba(239, 68, 68, 0.4)' : 'none',
                  borderRadius: '4px',
                  color: '#ffffff',
                  width: '28px',
                  height: '28px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  opacity: isMutedByHost ? 0.7 : 1
                }}
                title={isMutedByHost ? 'Muted by Host (Locked)' : isBlocked ? `Microphone blocked (${remainingBlockedSecs}s remaining)` : isMicMuted ? 'Unmute microphone' : 'Mute microphone'}
                disabled={isBlocked}
              >
                {isBlocked ? (
                  <span style={{ fontSize: '9px', fontWeight: 800, color: '#ef4444' }}>
                    {remainingBlockedSecs}s
                  </span>
                ) : isMutedByHost ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
                    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
                  </svg>
                ) : (
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
                )}
              </button>

              {/* Camera toggle control */}
              <button 
                onClick={toggleCamera}
                style={{
                  background: isCamDisabledByHost ? '#ef4444' : isCamOff ? '#ef4444' : '#2d3139',
                  border: 'none',
                  borderRadius: '4px',
                  color: '#ffffff',
                  width: '28px',
                  height: '28px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  opacity: isCamDisabledByHost ? 0.7 : 1
                }}
                title={isCamDisabledByHost ? 'Camera Disabled by Host (Locked)' : isCamOff ? 'Turn camera on' : 'Turn camera off'}
              >
                {isCamDisabledByHost ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                    <path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3 0h9a2 2 0 0 1 2 2v8c0 .28-.06.55-.18.8l-4-4"></path>
                  </svg>
                ) : (
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
                )}
              </button>
            </>
          );
        })()}

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

// Helper to extract room identifier (e.g. ielts9 from skulk.app/room/ielts9)
export const getRoomIdFromLink = (link?: string) => {
  if (!link) return '';
  const cleanLink = link.split('?')[0];
  const parts = cleanLink.split('/');
  return parts[parts.length - 1];
};

// Canonical Firestore room ID — always matches the URL slug so all users sync to the same room
export const roomDocId = (room: Room | null | undefined) => {
  if (!room) return '';
  return getRoomIdFromLink(room.link) || room.id;
};

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
  const [activeTab, setActiveTab] = useState<'rooms' | 'community' | 'reflect' | 'dm'>('rooms');
  
  // Real-time rooms state list
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomsLoaded, setRoomsLoaded] = useState(false);
  // Map of participant lists for rooms: room.id -> Participant[]
  const [roomsParticipants, setRoomsParticipants] = useState<Record<string, any[]>>({});

  // Persistent Guest ID
  const [guestId, setGuestId] = useState<string>(() => {
    try {
      let gid = localStorage.getItem('skulk_guest_id');
      if (!gid || gid.includes(' ') || !gid.startsWith('guest_')) {
        gid = 'guest_' + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('skulk_guest_id', gid);
      }
      return gid;
    } catch {
      return '';
    }
  });

  useEffect(() => {
    try {
      let gid = localStorage.getItem('skulk_guest_id');
      if (!gid || gid.includes(' ') || !gid.startsWith('guest_')) {
        gid = 'guest_' + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('skulk_guest_id', gid);
      }
      setGuestId(gid);
    } catch (e) {
      console.warn("Failed to read/write guest ID to localStorage:", e);
    }
  }, []);
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
      setIsFirestoreBlocked(false); // connection is working — clear any previous block flag
      if (snapshot.empty) {
        setRooms(getLocalRooms());
      } else {
        const list: Room[] = [];
        snapshot.forEach(docSnap => {
          const data = docSnap.data();
          if (data.emptySince && Date.now() - data.emptySince > 5 * 60 * 1000) {
            deleteDoc(docSnap.ref).catch((err) => {
              console.warn("Failed to delete expired empty room:", docSnap.id, err);
            });
          } else {
            list.push({ id: docSnap.id, ...data } as Room);
          }
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
          if (r.isLocalOnly) {
            // Keep local-only fallback rooms
            if (!merged.some(m => m.id === r.id)) {
              merged.push(r);
            }
          } else if (!list.some(m => m.id === r.id)) {
            // Remove garbage-collected Firestore rooms from localStorage
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
      setRoomsLoaded(true);
    }, (error) => {
      console.warn("Firestore subscription failed, falling back to local mock data:", error);
      setIsFirestoreBlocked(true);
      setRooms(getLocalRooms());
      setRoomsLoaded(true);
    });
    return () => unsubscribe();
  }, []);

  // Listen to participants subcollection for each room listed on the dashboard
  const unsubscribesRef = useRef<Record<string, () => void>>({});

  useEffect(() => {
    return () => {
      // Clean up all active subscriptions on component unmount
      Object.values(unsubscribesRef.current).forEach(unsub => unsub());
      unsubscribesRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (rooms.length === 0) {
      Object.values(unsubscribesRef.current).forEach(unsub => unsub());
      unsubscribesRef.current = {};
      return;
    }

    const currentRoomIds = new Set(rooms.map(r => r.id));

    // 1. Clean up stale subscriptions for rooms no longer present
    Object.keys(unsubscribesRef.current).forEach(roomId => {
      if (!currentRoomIds.has(roomId)) {
        unsubscribesRef.current[roomId]();
        delete unsubscribesRef.current[roomId];
      }
    });

    // 2. Set up new subscriptions for newly added rooms
    rooms.forEach(room => {
      if (!unsubscribesRef.current[room.id]) {
        unsubscribesRef.current[room.id] = onSnapshot(
          collection(db, 'rooms', room.id, 'participants'),
          (snapshot) => {
            const participantsList = snapshot.docs.map(docSnap => {
              const data = docSnap.data();
              return {
                id: docSnap.id,
                uid: data.uid || docSnap.id,
                name: data.name || '',
                initials: data.initials || '',
                color: data.color || '',
                photoURL: data.photoURL || null,
                role: data.role || '',
                joinedAt: data.joinedAt || null
              };
            });

            setRoomsParticipants(prev => {
              const currentList = prev[room.id] || [];
              
              // Map current list to match layout structure for comparison
              const currentListCompared = currentList.map(p => ({
                id: p.id,
                uid: p.uid || p.id,
                name: p.name || '',
                initials: p.initials || '',
                color: p.color || '',
                photoURL: p.photoURL || null,
                role: p.role || '',
                joinedAt: p.joinedAt || null
              }));

              if (JSON.stringify(currentListCompared) === JSON.stringify(participantsList)) {
                return prev;
              }
              
              return {
                ...prev,
                [room.id]: participantsList
              };
            });
          },
          (error) => {
            console.warn(`Failed to listen to participants for room ${room.id}:`, error);
          }
        );
      }
    });
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

  // Active background theme image state
  const [activeTheme, setActiveTheme] = useState<string>(() => {
    try {
      return localStorage.getItem('skulk_guest_theme') || 'default';
    } catch {
      return 'default';
    }
  });
  const [isThemeModalOpen, setIsThemeModalOpen] = useState(false);

  const handleSelectTheme = async (themeKey: string) => {
    setActiveTheme(themeKey);
    if (user) {
      try {
        const userDocRef = doc(db, 'users', user.uid);
        await setDoc(userDocRef, { activeTheme: themeKey }, { merge: true });
      } catch (err) {
        console.error("Failed to update active theme in Firestore:", err);
      }
    } else {
      try {
        localStorage.setItem('skulk_guest_theme', themeKey);
      } catch {}
    }
  };

  // Active call view state
  const [pendingJoinRoom, setPendingJoinRoom] = useState<Room | null>(null);
  const [pendingSignInRoom, setPendingSignInRoom] = useState<Room | null>(null);
  
  // Guest Profile Identity State
  const [guestName, setGuestName] = useState('');
  const [guestColor, setGuestColor] = useState('');
  const [guestInitials, setGuestInitials] = useState('');
  const [guestPhotoURL, setGuestPhotoURL] = useState<string | null>(null);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [profileEditName, setProfileEditName] = useState('');
  const [profileEditColor, setProfileEditColor] = useState('');
  const [profileEditPhotoURL, setProfileEditPhotoURL] = useState('');

  // Call hardware controls state
  const [isMicMuted, setIsMicMuted] = useState(true);
  const [isCamOff, setIsCamOff] = useState(true);
  const [cameraError, setCameraError] = useState(false);
  const [micError, setMicError] = useState(false);
  const [isGalleryView, setIsGalleryView] = useState(true);
  const [myStatus, setMyStatus] = useState<'none' | 'dnd' | 'zZ' | 'brb' | 'chillin'>('none');
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [botTypingIds, setBotTypingIds] = useState<string[]>([]);
  const [liveKitToken, setLiveKitToken] = useState<string | null>(null);
  const [activeLkToken, setActiveLkToken] = useState<string | null>(null);
  const [lkConnectStatus, setLkConnectStatus] = useState<'idle' | 'connecting' | 'connected' | 'error' | 'disconnected'>('idle');
  const [lkRetryCount, setLkRetryCount] = useState(0);
  const stableServerUrl = useMemo(() => {
    let url = (import.meta.env.VITE_LIVEKIT_URL || '').trim();
    // If empty or invalid domain (no dots, indicating a mistaken API Key or ID value), fallback.
    if (!url || !url.includes('.')) {
      url = 'wss://skulk5-a4l548bb.livekit.cloud';
    }
    if (url && !url.startsWith('ws://') && !url.startsWith('wss://')) {
      return `wss://${url}`;
    }
    return url;
  }, []);
  
  const liveKitRoomOptions = useMemo(() => ({
    adaptiveStream: true,
    dynacast: true,
    publishDefaults: {
      simulcast: true,
      videoSimulcastLayers: [
        VideoPresets.h180,
        VideoPresets.h360,
        VideoPresets.h720
      ]
    }
  }), []);
  
  // Sidebar tabs in-call panel
  const [callTab, setCallTab] = useState<'chat' | 'people' | 'tools' | 'dm'>('chat');

  // Lexically declared refs and callbacks for hooks
  const localJoinTimeRef = useRef<number | null>(null);
  const hasSeenSelfInListRef = useRef(false);
  const currentSessionIdRef = useRef<string | null>(null);
  const isEvictedRef = useRef(false);
  const isEnteringRoomRef = useRef<string | null>(null);
  const prefetchedLkTokenRef = useRef<{ roomId: string; token: string } | null>(null);


  
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [isFirestoreBlocked, setIsFirestoreBlocked] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<any>(null);
  const [selectedProfile, setSelectedProfile] = useState<{
    id: string;
    name: string;
    initials: string;
    color: string;
    photoURL?: string | null;
  } | null>(null);

  const [initialProfileView, setInitialProfileView] = useState<'card' | 'followers' | 'following' | 'connections' | 'report'>('card');



  // Local game/truth or dare/spin states
  const [todLocalSpinning, setTodLocalSpinning] = useState(false);
  const [todActiveIds, setTodActiveIds] = useState<string[]>([]);
  const [todPendingIds, setTodPendingIds] = useState<string[]>([]);
  const [spinLocalSpinning, setSpinLocalSpinning] = useState(false);

  function showToast(msg: string) {
    setToastMessage(msg);
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 10000);
  }

  let leavePresenceFn: (roomIdToLeave: string, sessionIdToDelete?: string | null) => Promise<void> = async () => {};

  function handleLeaveCall() {
    isEvictedRef.current = true;
    hasSeenSelfInListRef.current = false;
    if (currentRoom) {
      const prevRoomId = roomDocId(currentRoom);
      console.log("[LEAVE EVENT] leavePresence triggered from handleLeaveCall, session:", currentSessionIdRef.current);
      finalizeSession();
      leavePresenceFn(prevRoomId);
      currentSessionIdRef.current = null;
      setCurrentRoom(null);
      setCallParticipants([]);
      setChatMessages([]);
      setSystemMessages([]);
      isInitialLoadRef.current = true;
      isChatInitialLoadRef.current = true;
      setUnreadChatCount(0);
      setViewingShare(null);
      setLiveKitToken(null);
      setActiveLkToken(null);
      setLkConnectStatus('idle');
      setLkRetryCount(0);
    }
    navigate('/');
  }

  // Hook-managed states
  const {
    currentRoom,
    setCurrentRoom,
    chatMessages,
    setChatMessages,
    systemMessages,
    setSystemMessages,
    viewingShare,
    setViewingShare,
    todSpinResult,
    setTodSpinResult,
    todSpinPool,
    setTodSpinPool,
    todState,
    setTodState,
    todChoice,
    setTodChoice,
    todText,
    setTodText,
    todSelectedId,
    setTodSelectedId,
    spinResult,
    spinCheckedIds,
    spinPool,
    pomodoroIsRunning,
    setPomodoroIsRunning,
    pomodoroMinutes,
    setPomodoroMinutes,
    pomodoroSeconds,
    setPomodoroSeconds,
    pomodoroPhase,
    setPomodoroPhase,
    activeBots
  } = useRoomState(roomId || null, user, guestId, localJoinTimeRef, showToast, handleLeaveCall);

  const { finalizeSession } = useSessionLogger(currentRoom, user, currentSessionIdRef, localJoinTimeRef);

  const chatMessagesRef = useRef(chatMessages);
  useEffect(() => {
    chatMessagesRef.current = chatMessages;
  }, [chatMessages]);

  const [micActiveSeconds, setMicActiveSeconds] = useState(0);
  const [micBlockedUntil, setMicBlockedUntil] = useState<number | null>(null);
  const [dummyTick, setDummyTick] = useState(0);
  const isLocalSpeakingRef = useRef(false);

  // Reference variables to satisfy strict unused locals check
  if (false as boolean) {
    console.log(micActiveSeconds, dummyTick);
  }

  const {
    callParticipants,
    setCallParticipants,
    activeMenuParticipantId,
    setActiveMenuParticipantId,
    spotlightParticipantId,
    setSpotlightParticipantId,
    updateMySharing,
    clearMySharing,
    updateMyStatus,
    leavePresence
  } = usePresence(
    currentRoom ? roomDocId(currentRoom) : null,
    user,
    guestId,
    guestName,
    guestPhotoURL,
    guestInitials,
    guestColor,
    currentSessionIdRef,
    localJoinTimeRef,
    hasSeenSelfInListRef,
    currentRoom ? (currentRoom.creatorId || null) : null,
    // onParticipantAdded callback
    (docId, name, joinedAt) => {
      const timestamp = new Date().toISOString();
      const cleanName = name ? name.replace(' (You)', '') : 'Someone';
      const getFormattedTime = () => {
        return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      };
      console.log(`[PRESENCE EVENT] Participant ADDED: ID=${docId}, Name=${name}`);
      const parsedJoinTime = joinedAt ? new Date(joinedAt).getTime() : 0;
      if (docId !== getMyId() && parsedJoinTime >= (localJoinTimeRef.current || 0)) {
        setSystemMessages(prev => [
          ...prev,
          {
            id: `system_join_${docId}_${Date.now()}`,
            text: `${cleanName} joined · ${getFormattedTime()}`,
            createdAt: timestamp
          }
        ]);
      }
    },
    // onParticipantRemoved callback
    (docId, name) => {
      const timestamp = new Date().toISOString();
      const cleanName = name ? name.replace(' (You)', '') : 'Someone';
      const getFormattedTime = () => {
        return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      };
      console.log(`[PRESENCE EVENT] Participant REMOVED: ID=${docId}, Name=${name}`);
      if (docId !== getMyId()) {
        setSystemMessages(prev => [
          ...prev,
          {
            id: `system_leave_${docId}_${Date.now()}`,
            text: `${cleanName} left · ${getFormattedTime()}`,
            createdAt: timestamp
          }
        ]);
      }
    },
    // onEvicted callback
    (reason) => {
      console.log("Kicking user out! Reason:", reason);
      if (reason === 'kicked') {
        const timeSinceJoin = Date.now() - (localJoinTimeRef.current || 0);
        if (timeSinceJoin < 5000) {
          console.warn("[PRESENCE] Presence doc deleted within 5s grace period. Self-healing/re-writing instead of evicting.");
          const myId = getMyId();
          const rid = currentRoom ? roomDocId(currentRoom) : null;
          if (myId && rid) {
            (async () => {
              let myRole = determineRole(currentRoom?.creatorId);
              if (myRole !== 'admin') {
                try {
                  const appDocSnap = await getDoc(doc(db, 'rooms', rid, 'approvedUsers', myId));
                  if (appDocSnap.exists()) {
                    const storedRole = appDocSnap.data()?.role;
                    if (storedRole && (storedRole === 'host' || storedRole === 'cohost' || storedRole === 'admin')) {
                      myRole = storedRole;
                    }
                  }
                } catch (e) {
                  console.warn("Failed to check persistent role in self-healing:", e);
                }
              }

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
                sessionId: currentSessionIdRef.current,
                micOn: !isMicMutedRef.current,
                camOn: !isCamOffRef.current,
                status: myStatus === 'none' ? null : myStatus
              }, { merge: true });

              if (myRole === 'host') {
                await updateDoc(doc(db, 'rooms', rid), {
                  currentHostId: myId,
                  currentHostName: user ? user.displayName || 'Google User' : guestName
                }).catch(() => {});
                
                try {
                  const snapshot = await getDocs(collection(db, 'rooms', rid, 'participants'));
                  snapshot.docs.forEach(async (docSnap) => {
                    if (docSnap.id !== myId && docSnap.data().role === 'host') {
                      await updateDoc(docSnap.ref, { role: 'cohost' }).catch(() => {});
                    }
                  });
                } catch (e) {}
              }
            })().catch(err => {
              console.error("[PRESENCE] Failed to self-heal/re-write presence document:", err);
            });
          }
          return;
        }
      }

      if (reason === 'new_room') {
        showToast("Joined another room in a different tab.");
      } else {
        showToast("❌ You have been removed from the room by a host.");
      }
      handleLeaveCall();
    }
  );

  // Load mic block time from LocalStorage
  useEffect(() => {
    if (!currentRoom) {
      setMicBlockedUntil(null);
      setMicActiveSeconds(0);
      return;
    }
    const mode = currentRoom.roomMode || 'chill';
    if (mode !== 'non-discuss') {
      setMicBlockedUntil(null);
      setMicActiveSeconds(0);
      window.dispatchEvent(new CustomEvent('skulk_clear_chat_quota'));
      return;
    }
    const stored = localStorage.getItem(`skulk_mic_blocked_until_${currentRoom.id}`);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (parsed > Date.now()) {
        setMicBlockedUntil(parsed);
      } else {
        localStorage.removeItem(`skulk_mic_blocked_until_${currentRoom.id}`);
      }
    }
  }, [currentRoom?.id, currentRoom?.roomMode]);

  // Track mic active time in non-discuss (Silent Focus) mode
  useEffect(() => {
    if (!currentRoom) return;
    const mode = currentRoom.roomMode || 'chill';
    if (mode !== 'non-discuss') return;

    const interval = setInterval(() => {
      const now = Date.now();
      
      // If currently blocked, countdown
      if (micBlockedUntil && now < micBlockedUntil) {
        // Enforce mute state and Firestore restriction if somehow unmuted or unrestricted
        const myPresence = callParticipants.find(p => p.id === getMyId());
        const isNotFullyRestricted = !myPresence || !myPresence.micRestricted || myPresence.mutedBy !== 'focus_limit';
        if (!isMicMuted || isNotFullyRestricted) {
          setIsMicMuted(true);
          updateMySharing({ 
            micRestricted: true, 
            isMuted: true, 
            micOn: false, 
            mutedBy: 'focus_limit' 
          }).catch(() => {});
        }
        setDummyTick(d => d + 1);
        return;
      }

      // If blocked state expired, clear block
      if (micBlockedUntil && now >= micBlockedUntil) {
        setMicBlockedUntil(null);
        setMicActiveSeconds(0);
        localStorage.removeItem(`skulk_mic_blocked_until_${currentRoom.id}`);
        // Remove restriction! Set micRestricted to false, and mutedBy to getMyId() so they can now unmute themselves!
        updateMySharing({ 
          micRestricted: false, 
          isMuted: true, 
          micOn: false, 
          mutedBy: getMyId() 
        }).catch(() => {});
        showToast("🎤 Focus limit countdown ended. You can now unmute yourself.");
      }

      // If mic is unmuted AND speaking, increment quota
      if (!isMicMuted && isLocalSpeakingRef.current) {
        setMicActiveSeconds(prev => {
          const next = prev + 1;
          if (next >= 15) {
            // Block mic for 1 minute (60 seconds)
            const blockedTime = Date.now() + 60000;
            setMicBlockedUntil(blockedTime);
            localStorage.setItem(`skulk_mic_blocked_until_${currentRoom.id}`, blockedTime.toString());
            
            // Force mute mic & restrict in Firestore!
            setIsMicMuted(true);
            updateMySharing({ 
              micRestricted: true, 
              isMuted: true, 
              micOn: false, 
              mutedBy: 'focus_limit' 
            }).catch(() => {});
            showToast("🔇 Focus limit reached. Mic blocked for 1 minute.");
            return 0;
          }
          return next;
        });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [currentRoom?.id, currentRoom?.roomMode, micBlockedUntil, isMicMuted, callParticipants]);

  // Synchronize micBlockedUntil with Firestore presence document (useful for page reloads/rejoins)
  useEffect(() => {
    if (currentRoom && micBlockedUntil && Date.now() < micBlockedUntil) {
      updateMySharing({ 
        micRestricted: true, 
        isMuted: true, 
        micOn: false, 
        mutedBy: 'focus_limit' 
      }).catch(() => {});
    }
  }, [currentRoom?.id, micBlockedUntil]);

  const lastRoomModeRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentRoom) {
      lastRoomModeRef.current = null;
      return;
    }
    const currentMode = currentRoom.roomMode || 'chill';
    if (lastRoomModeRef.current !== null && lastRoomModeRef.current !== currentMode) {
      updateMySharing({
        handRaised: false,
        handRaisedAt: null,
        castVote: null
      }).catch(() => {});
      showToast(`Hand raised and votes reset due to room mode change`);
    }
    lastRoomModeRef.current = currentMode;
  }, [currentRoom?.roomMode, currentRoom?.id]);

  useEffect(() => {
    if (!currentRoom || currentRoom.voteStatus !== 'active') {
      const myPresence = callParticipants.find(p => p.id === getMyId());
      if (myPresence?.castVote) {
        updateMySharing({ castVote: null }).catch(() => {});
      }
    }
  }, [currentRoom?.voteStatus, currentRoom?.id, callParticipants]);


  leavePresenceFn = leavePresence;
  const isInitialLoadRef = useRef(true);
  const isChatInitialLoadRef = useRef(true);
  const idTokenRef = useRef<string | null>(null);

  const isMicMutedRef = useRef(isMicMuted);
  const isCamOffRef = useRef(isCamOff);
  useEffect(() => {
    isMicMutedRef.current = isMicMuted;
  }, [isMicMuted]);
  useEffect(() => {
    isCamOffRef.current = isCamOff;
  }, [isCamOff]);

  // In-call participants state
  // Toast feedback state
  // const [isWhiteboardActive, setIsWhiteboardActive] = useState(false);
  const [screenShareStream, setScreenShareStream] = useState<MediaStream | null>(null);
  

  // Tools sub-panel toggle
  const [activeToolDetail, setActiveToolDetail] = useState<any>('none');

  // Fun Tools toggle & Truth or Dare synced spinner states
  // Local sync of Truth or Dare active/pending participant states from callParticipants list
  useEffect(() => {
    const active = callParticipants.filter(p => p.todJoined).map(p => p.id);
    const pending = callParticipants.filter(p => p.todPending).map(p => p.id);
    setTodActiveIds(active);
    setTodPendingIds(pending);
  }, [callParticipants]);

  // Host proxy listener for Truth or Dare player spin, choice, and reset requests
  useEffect(() => {
    if (!currentRoom) return;
    const myId = getMyId();
    const myPresence = callParticipants.find(p => p.id === myId);
    const isHost = myPresence?.role === 'host' || myPresence?.role === 'cohost' || myPresence?.role === 'admin' || currentRoom.creatorId === myId;
    if (!isHost) return;
    
    // 1. Check spin requests
    const spinRequester = callParticipants.find(p => p.todRequestedSpin && p.id !== myId);
    if (spinRequester && todState === 'idle' && !todLocalSpinning) {
      const pRef = doc(db, 'rooms', roomDocId(currentRoom), 'participants', spinRequester.id);
      updateDoc(pRef, { todRequestedSpin: null })
        .then(() => {
          handleSpinTruthOrDare();
        })
        .catch(e => console.warn("Failed to clear spin request:", e));
    }
    
    // 2. Check choice requests
    const choiceRequester = callParticipants.find(p => p.todRequestedChoice && p.id !== myId);
    if (choiceRequester && todState === 'choice') {
      const choice = choiceRequester.todRequestedChoice;
      if (choice) {
        const pRef = doc(db, 'rooms', roomDocId(currentRoom), 'participants', choiceRequester.id);
        updateDoc(pRef, { todRequestedChoice: null })
          .then(() => {
            handleSelectTodChoice(choice);
          })
          .catch(e => console.warn("Failed to clear choice request:", e));
      }
    }
    
    // 3. Check reset requests
    const resetRequester = callParticipants.find(p => p.todRequestedReset && p.id !== myId);
    if (resetRequester && (todState === 'reveal' || todState === 'choice')) {
      const pRef = doc(db, 'rooms', roomDocId(currentRoom), 'participants', resetRequester.id);
      updateDoc(pRef, { todRequestedReset: null })
        .then(() => {
          handleResetTod();
        })
        .catch(e => console.warn("Failed to clear reset request:", e));
    }
  }, [callParticipants, currentRoom, todState, todLocalSpinning, todSpinPool]);

  // Spin the Wheel synced state
  // Header popover states
  const [isRoomSettingsOpen, setIsRoomSettingsOpen] = useState(false);
  const [roomJoinKey, setRoomJoinKey] = useState<string | null>(null);
  const [maxPartInput, setMaxPartInput] = useState<number | ''>('');
  const roomSettingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!currentRoom || currentRoom.type === 'public') {
      setRoomJoinKey(null);
      return;
    }
    const myId = getMyId();
    const myPresence = callParticipants.find(p => p.id === myId);
    const isHostOrAdmin = myPresence?.role === 'host' || myPresence?.role === 'cohost' || myPresence?.role === 'admin';
    if (!isHostOrAdmin) {
      setRoomJoinKey(null);
      return;
    }

    let active = true;
    const fetchKey = async () => {
      try {
        const keysRef = collection(db, 'rooms', currentRoom.id, 'keys');
        const snap = await getDocs(keysRef);
        if (active && !snap.empty) {
          const joinKey = snap.docs[0].id;
          setRoomJoinKey(joinKey);

          // Update URL in the browser without reload
          const url = new URL(window.location.href);
          if (url.searchParams.get('key') !== joinKey) {
            url.searchParams.set('key', joinKey);
            window.history.replaceState(null, '', url.pathname + url.search);
          }
        }
      } catch (err) {
        console.warn("Failed to fetch room key for URL sync:", err);
      }
    };
    fetchKey();
    return () => {
      active = false;
    };
  }, [currentRoom, callParticipants]);



  // Whole-call Mini Mode (Zoom-like Call PiP) states
  const [pipWindowInstance, setPipWindowInstance] = useState<Window | null>(null);
  const [isMiniModeActive, setIsMiniModeActive] = useState(false);
  const [miniModeTab, setMiniModeTab] = useState<'call' | 'tool' | 'chat'>('call');
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [unreadDmCount, setUnreadDmCount] = useState(0);

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    return localStorage.getItem('skulk_sidebar_collapsed') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('skulk_sidebar_collapsed', isSidebarCollapsed.toString());
  }, [isSidebarCollapsed]);

  const isChatActiveRef = useRef(false);
  useEffect(() => {
    const isChatActive = isMiniModeActive 
      ? (miniModeTab === 'chat') 
      : (!isSidebarCollapsed && callTab === 'chat');
    isChatActiveRef.current = isChatActive;
  }, [callTab, miniModeTab, isMiniModeActive, isSidebarCollapsed]);

  // Clear unread count when chat is active either in sidebar or PiP
  useEffect(() => {
    const isChatActive = isMiniModeActive 
      ? (miniModeTab === 'chat') 
      : (!isSidebarCollapsed && callTab === 'chat');
    if (isChatActive) {
      setUnreadChatCount(0);
    }
  }, [callTab, miniModeTab, isMiniModeActive, isSidebarCollapsed]);

  // Clear unread DM count when DM tab is active in sidebar
  useEffect(() => {
    if (!isSidebarCollapsed && callTab === 'dm') {
      setUnreadDmCount(0);
    }
  }, [callTab, isSidebarCollapsed]);

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

  // Spotify States
  const [spotifyUri, setSpotifyUri] = useState<string | null>(null);
  const [spotifyInputUrl, setSpotifyInputUrl] = useState('');

  // Games Party States
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const [gameInviteInput, setGameInviteInput] = useState('');

  // Shared Pomodoro Timer States (Default 25 focus / 5 break)
  const [pomodoroFocusLength, setPomodoroFocusLength] = useState(25);
  const [pomodoroBreakLength, setPomodoroBreakLength] = useState(5);
  // Session Target States
  const [targetInputText, setTargetInputText] = useState('');
  const [targetsList, setTargetsList] = useState<any[]>([]);
  const [targetsHistory, setTargetsHistory] = useState<any[]>([]);
  const [userDataState, setUserDataState] = useState<any>(null);
  const [sessionLogs, setSessionLogs] = useState<any[]>([]);

  const [isEditingBio, setIsEditingBio] = useState(false);
  const [bioInput, setBioInput] = useState('');

  useEffect(() => {
    if (userDataState && !isEditingBio) {
      setBioInput(userDataState.bio || '');
    }
  }, [userDataState, isEditingBio]);

  // Sync activeTheme with user document profile data in Firestore or localStorage fallback
  useEffect(() => {
    if (user && userDataState) {
      if (userDataState.activeTheme !== undefined) {
        setActiveTheme(userDataState.activeTheme);
      }
    } else if (!user) {
      try {
        const localTheme = localStorage.getItem('skulk_guest_theme') || 'default';
        setActiveTheme(localTheme);
      } catch {}
    }
  }, [user, userDataState]);

  // Sync activeTheme class to body element and update accent color CSS variables dynamically
  useEffect(() => {
    const root = window.document.documentElement;
    if (activeTheme && activeTheme !== 'default') {
      document.body.classList.add('theme-active');
      const preset = THEME_PRESETS.find(p => p.key === activeTheme);
      if (preset && preset.accentColor) {
        root.style.setProperty('--primary-color', preset.accentColor);
        root.style.setProperty('--primary-hover', preset.accentHoverColor);
        root.style.setProperty('--card-hover-border', preset.accentColor);
        root.style.setProperty('--input-focus-border', preset.accentColor);
      }
    } else {
      document.body.classList.remove('theme-active');
      // Reset to default Nightwatch colors
      root.style.setProperty('--primary-color', '#f1c40f');
      root.style.setProperty('--primary-hover', '#d4ac0d');
      root.style.setProperty('--card-hover-border', '#f1c40f');
      root.style.setProperty('--input-focus-border', '#f1c40f');
    }
  }, [activeTheme]);

  const [followingUserIds, setFollowingUserIds] = useState<string[]>([]);
  const [followerUserIds, setFollowerUserIds] = useState<string[]>([]);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [connectionsCount, setConnectionsCount] = useState(0);
  const [communityUsers, setCommunityUsers] = useState<any[]>([]);

  const handleOpenProfile = (profile: any, view: 'card' | 'followers' | 'following' | 'connections' | 'report' = 'card') => {
    setInitialProfileView(view);
    setSelectedProfile(profile);
  };

  const isRollingOverRef = useRef(false);

  const getStartOfWeekMondayKey = () => {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    return monday.toLocaleDateString('en-CA'); // YYYY-MM-DD
  };

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
        const targets = data.targetsList || [];
        const history = data.targetsHistory || [];
        
        setTargetsList(targets);
        setTargetsHistory(history);
        setUserDataState(data);

        // Automatic rollover check
        const mondayKey = getStartOfWeekMondayKey();
        const dbWeekKey = data.currentWeekKey;

        if (dbWeekKey && dbWeekKey !== mondayKey && !isRollingOverRef.current) {
          isRollingOverRef.current = true;
          const incompleteTargets = targets.filter((t: any) => !t.completed);
          const completedCount = targets.filter((t: any) => t.completed).length;
          const totalCount = targets.length;

          // Parse and format the old Monday week start date label for history strip
          const oldMonday = new Date(dbWeekKey);
          const formattedDate = oldMonday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

          const nextHistory = [
            { date: formattedDate, completedCount, totalCount },
            ...history
          ];

          setDoc(userDocRef, {
            targetsList: incompleteTargets,
            targetsHistory: nextHistory,
            currentWeekKey: mondayKey
          }, { merge: true })
            .catch(err => console.error("Auto rollover failed:", err))
            .finally(() => {
              isRollingOverRef.current = false;
            });
        } else if (!dbWeekKey && !isRollingOverRef.current) {
          isRollingOverRef.current = true;
          setDoc(userDocRef, { currentWeekKey: mondayKey }, { merge: true })
            .catch(err => console.error("Failed to initialize currentWeekKey:", err))
            .finally(() => {
              isRollingOverRef.current = false;
            });
        }
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
        const mondayKey = getStartOfWeekMondayKey();
        
        isRollingOverRef.current = true;
        setDoc(userDocRef, {
          targetsList: initialList,
          targetsHistory: initialHistory,
          currentWeekKey: mondayKey
        }, { merge: true })
          .catch(err => {
            console.warn("Error initializing user targets in Firestore:", err);
          })
          .finally(() => {
            isRollingOverRef.current = false;
          });
      }
    }, (error) => {
      console.warn("Failed to listen to userDocRef:", error);
    });

    return () => unsubscribe();
  }, [user]);

  // Listen to session logs for authenticated user
  useEffect(() => {
    if (!user) {
      setSessionLogs([]);
      return;
    }
    const logsRef = collection(db, 'users', user.uid, 'sessionLogs');
    const q = query(logsRef, orderBy('joinedAt', 'desc'), limit(50));
    const unsubscribe = onSnapshot(q, (snap: any) => {
      const logs = snap.docs.map((doc: any) => ({
        id: doc.id,
        ...doc.data()
      }));
      setSessionLogs(logs);
    }, (err: any) => {
      console.warn("Failed to listen to session logs:", err);
    });
    return () => unsubscribe();
  }, [user]);

  // Listen to Follows system state, counts, and directory list for authenticated user
  useEffect(() => {
    if (!user) {
      setFollowingUserIds([]);
      setFollowerUserIds([]);
      setFollowersCount(0);
      setFollowingCount(0);
      setConnectionsCount(0);
      return;
    }

    // 1. Followed UIDs list
    const qFollows = query(collection(db, 'follows'), where('followerId', '==', user.uid));
    const unsubFollows = onSnapshot(qFollows, (snap) => {
      const ids = snap.docs.map(d => d.data().followingId);
      setFollowingUserIds(ids);
      setFollowingCount(snap.size);
    }, (err) => {
      console.warn("Failed to listen to follows list:", err);
    });

    // 2. Followers list
    const qFollowers = query(collection(db, 'follows'), where('followingId', '==', user.uid));
    const unsubFollowers = onSnapshot(qFollowers, (snap) => {
      const ids = snap.docs.map(d => d.data().followerId);
      setFollowerUserIds(ids);
      setFollowersCount(snap.size);
    }, (err) => {
      console.warn("Failed to listen to followers count:", err);
    });

    return () => {
      unsubFollows();
      unsubFollowers();
    };
  }, [user]);

  // Compute connectionsCount as mutual followers
  useEffect(() => {
    const mutual = followingUserIds.filter(id => followerUserIds.includes(id));
    setConnectionsCount(mutual.length);
  }, [followingUserIds, followerUserIds]);

  // Listen to DM Threads
  const [dmThreads, setDmThreads] = useState<any[]>([]);

  useEffect(() => {
    if (!user) {
      setDmThreads([]);
      setUnreadDmCount(0);
      return;
    }

    const qDms = query(collection(db, 'dm_threads'), where('participants', 'array-contains', user.uid));
    const unsubDms = onSnapshot(qDms, (snap) => {
      const threads = snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as any));
      setDmThreads(threads);
      
      // Calculate total unread count: count how many threads have current user's unread flag = true
      let unreadCount = 0;
      threads.forEach(t => {
        if (t.unread && t.unread[user.uid] === true) {
          unreadCount++;
        }
      });
      setUnreadDmCount(unreadCount);
    }, (err) => {
      console.warn("Failed to listen to DM threads:", err);
    });

    return () => unsubDms();
  }, [user]);

  // ─── Tier 1: Hourly Wellness Pings ────────────────────────────────────────
  // Runs only while the tab is open. Duplicate-tab prevention: before posting,
  // reads the mentor thread doc and checks lastWellnessPingTime — skips if
  // another tab already posted within the last 55 minutes.
  const CANNED_WELLNESS_MESSAGES: Record<string, Record<string, string[]>> = {
    sir: {
      water: [
        "Hydrate. No excuses. Go drink water now.",
        "Your brain is sluggish because you're dry. Go get water. Move.",
        "Stop staring at the screen and drink some water. Discomfort is part of the grind, dehydration is just stupidity."
      ],
      eyes: [
        "Rest your eyes. 20 seconds. Look away. Grind requires vision. Do it.",
        "Look at something 20 feet away. Close your eyes. Grind now, cry later.",
        "Focus on the wall or look outside for 20 seconds. Blink. Your screen is destroying your retina."
      ],
      stretch: [
        "Stand up. Stretch. Posture check. Move your body for 30 seconds. Now.",
        "Get up. Stretch. Sitting like a statue won't pass the class. Grind.",
        "Stand up and move. Do some squats or stretch your neck. Sitting down for hours isn't productivity, it's laziness."
      ]
    },
    leader: {
      water: [
        "Hey kid, I look like a guy who sells counterfeit watches, but please: go drink some water now. Do it.",
        "My doctors tell me water is good for the liver. I tell you it's good for the focus. Go get a glass.",
        "Listen to me. Go grab a cup of cold water. I'll wait here, looking menacingly."
      ],
      eyes: [
        "Close your eyes. Stare at something far away for 20 seconds. Trust me, it helps. Do it.",
        "My face causes eye strain. Go look out the window for 20 seconds to reset. Right now.",
        "Give your eyes a break. Close them for 20 seconds and picture your goals. Or a nice sandwich."
      ],
      stretch: [
        "Stand up. Stretch. I look stiff, but I still stretch my neck. Do it now.",
        "Grind is good, but standing up to stretch is better. Get up for 30 seconds.",
        "Posture check! Stand up and roll your shoulders back. You're starting to look like a gargoyle."
      ]
    },
    mr_x: {
      water: [
        "Dehydration is a pathetic excuse for slowing down. Go drink some water.",
        "Your brain is mostly water. Act like it and go get a glass. Now.",
        "Why are you still sitting there? Go fetch some water. You can't think straight without it."
      ],
      eyes: [
        "Staring at this screen won't make you study faster. Look 20 feet away for 20 seconds. Go.",
        "Give your eyes a break. Close them for 20 seconds. Do it before you fail.",
        "Eyes off the screen! Stare at the distance for 20 seconds. Your eyes aren't made of steel."
      ],
      stretch: [
        "Your posture is embarrassing. Stand up and stretch. Now.",
        "Stand up. Stretch your spine. You look like a shrimp. Fix it.",
        "Get up and stretch for 30 seconds. Your lower back is begging for mercy. Do it."
      ]
    },
    mam: {
      water: [
        "Ara ara~ Dehydrated already? Mama says go drink some water right now.",
        "Ara ara, a thirsty child is a distracted child. Go get some water, dear.",
        "Ara ara, mama's watching you. Go fill up your water glass this instant!"
      ],
      eyes: [
        "Ara ara, your eyes look tired. Close them for 20 seconds and look far away.",
        "Ara ara, look away from the screen. Protect your sight, dear. Do it now.",
        "Ara ara, let's close our eyes together for 20 seconds. Stare far away, let them rest."
      ],
      stretch: [
        "Ara ara~ stand up and stretch. Mama wants you to have good posture.",
        "Ara ara, stand up for 30 seconds. Stretch those shoulders, then return to work.",
        "Ara ara, stretch your back, dear. Mama doesn't want you getting all stiff."
      ]
    },
    little_miss: {
      water: [
        "Oh! Oopsie, don't forget to stay hydrated! Go get some water right now, okay? Drink up!",
        "A quick water sip break! Go go, get a glass of water now!",
        "Water time! Go get some hydration, don't let your brain dry out!"
      ],
      eyes: [
        "Look away from the screen! Stare at something far away for 20 seconds. Close those eyes!",
        "Protect your pretty eyes! Stare out the window for 20 seconds. Do it!",
        "Oopsie! Too much screen time. Close your eyes and count to 20!"
      ],
      stretch: [
        "Stand up and reach for the stars! Stretch that back for 30 seconds. Up you go!",
        "Let's stretch together! Stand up, move your shoulders, breathe in. Okay, back to work!",
        "Stand up and shake those legs! A quick 30-second stretch, you got this!"
      ]
    }
  };

  useEffect(() => {
    if (!user) return;
    const activePersona = userDataState?.activeMentorPersona || 'leader';
    const mentorThreadId = `mentor_${activePersona}_${user.uid}`;
    let pingIndex = 0;

    const runWellnessPing = async () => {
      try {
        const threadRef = doc(db, 'dm_threads', mentorThreadId);
        
        const result = await runTransaction(db, async (transaction) => {
          const threadSnap = await transaction.get(threadRef);
          
          // Check lastWellnessPingTime for duplicate prevention
          if (threadSnap.exists()) {
            const lastPingTs = threadSnap.data()?.lastWellnessPingTime;
            if (lastPingTs) {
              const lastMs = lastPingTs.toDate ? lastPingTs.toDate().getTime() : new Date(lastPingTs).getTime();
              if (Date.now() - lastMs < 55 * 60 * 1000) {
                return { success: false, reason: 'skipped_duplicate' };
              }
            }
          }

          // Determine next message category
          const types = ['water', 'eyes', 'stretch'];
          const type = types[pingIndex % types.length];
          const messagesArray = CANNED_WELLNESS_MESSAGES[activePersona]?.[type] || CANNED_WELLNESS_MESSAGES.leader[type];
          
          // Select message (rotate using pingIndex)
          const text = messagesArray[Math.floor(pingIndex / 3) % messagesArray.length];
          const now = serverTimestamp();
          const participants = [user.uid, `bot_mentor_${activePersona}`];

          // Set thread doc
          transaction.set(threadRef, {
            participants,
            lastMessageText: text,
            lastMessageTime: now,
            lastWellnessPingTime: now,
            unread: { [user.uid]: true },
            createdAt: threadSnap.exists() ? (threadSnap.data()?.createdAt || now) : now
          }, { merge: true });

          // Set subcollection message doc
          const messagesCol = collection(db, 'dm_threads', mentorThreadId, 'messages');
          const newMsgRef = doc(messagesCol);
          transaction.set(newMsgRef, {
            senderId: `bot_mentor_${activePersona}`,
            senderName: activePersona === 'sir' ? 'Sir' :
                        activePersona === 'leader' ? 'Leader' :
                        activePersona === 'mr_x' ? 'Mr. X' :
                        activePersona === 'mam' ? 'Mam' : 'Little Miss',
            text,
            createdAt: now,
            wellnessType: type
          });

          return { success: true, text };
        });

        if (result.success && result.text) {
          pingIndex++;
          showToast(`🧠 Mentor: ${result.text}`);
        }
      } catch (err) {
        console.warn('Wellness transaction failed:', err);
      }
    };

    // Fire first ping after 60 minutes, then every 60 minutes
    const intervalId = setInterval(runWellnessPing, 60 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [user, userDataState?.activeMentorPersona]);

  // ─── Tier 2: Custom Reminder Listener ─────────────────────────────────────
  // Listens to user's reminders subcollection and fires them at their scheduled time.
  useEffect(() => {
    if (!user) return;
    const remindersRef = collection(db, 'users', user.uid, 'reminders');
    const activeTimers = new Map<string, ReturnType<typeof setTimeout>>();

    const unsubReminders = onSnapshot(remindersRef, (snap) => {
      // Clear any stale timers for docs that no longer exist
      const currentIds = new Set(snap.docs.map(d => d.id));
      activeTimers.forEach((timer, id) => {
        if (!currentIds.has(id)) {
          clearTimeout(timer);
          activeTimers.delete(id);
        }
      });

      snap.docs.forEach((reminderDoc) => {
        const data = reminderDoc.data();
        if (data.fired) return; // Already delivered

        const fireAt: number = data.fireAt?.toDate
          ? data.fireAt.toDate().getTime()
          : new Date(data.fireAt).getTime();

        const delay = fireAt - Date.now();
        if (delay < 0) return; // Past — skip

        // Don't reset a timer that already exists for this reminder
        if (activeTimers.has(reminderDoc.id)) return;

        const timerId = setTimeout(async () => {
          try {
            const activePersona = userDataState?.activeMentorPersona || 'leader';
            const mentorThreadId = `mentor_${activePersona}_${user.uid}`;
            const threadRef = doc(db, 'dm_threads', mentorThreadId);
            const now = serverTimestamp();
            const text = `⏰ Reminder: ${data.text}`;

            await setDoc(threadRef, {
              participants: [user.uid, `bot_mentor_${activePersona}`],
              lastMessageText: text,
              lastMessageTime: now,
              unread: { [user.uid]: true },
              createdAt: now
            }, { merge: true });

            const mentorName = activePersona === 'sir' ? 'Sir' :
                               activePersona === 'leader' ? 'Leader' :
                               activePersona === 'mr_x' ? 'Mr. X' :
                               activePersona === 'mam' ? 'Mam' : 'Little Miss';

            await addDoc(collection(db, 'dm_threads', mentorThreadId, 'messages'), {
              senderId: `bot_mentor_${activePersona}`,
              senderName: mentorName,
              text,
              createdAt: now
            });

            // Mark reminder as fired so it doesn't re-trigger
            await setDoc(doc(db, 'users', user.uid, 'reminders', reminderDoc.id), { fired: true }, { merge: true });

            showToast(text);
          } catch (err) {
            console.warn('Reminder delivery failed:', err);
          }
          activeTimers.delete(reminderDoc.id);
        }, delay);

        activeTimers.set(reminderDoc.id, timerId);
      });
    });

    return () => {
      unsubReminders();
      activeTimers.forEach(clearTimeout);
      activeTimers.clear();
    };
  }, [user, userDataState?.activeMentorPersona]);

  // Background self-healing for denormalized follow counts
  useEffect(() => {
    if (!user || !userDataState) return;

    const dbFollowers = userDataState.followersCount ?? -1;
    const dbFollowing = userDataState.followingCount ?? -1;

    if (dbFollowers !== followersCount || dbFollowing !== followingCount) {
      const userRef = doc(db, 'users', user.uid);
      setDoc(userRef, {
        followersCount: followersCount,
        followingCount: followingCount
      }, { merge: true })
      .then(() => {
        console.log("Self-healed denormalized follow counts:", { followersCount, followingCount });
      })
      .catch(err => {
        console.warn("Failed to self-heal follow counts:", err);
      });
    }
  }, [user, userDataState, followersCount, followingCount]);

  // Real-time Community Directory Query
  useEffect(() => {
    if (!user || activeTab !== 'community') {
      setCommunityUsers([]);
      return;
    }

    const q = query(collection(db, 'users'), limit(50));
    const unsubscribe = onSnapshot(q, (snap) => {
      const list = snap.docs
        .map(d => ({
          id: d.id,
          ...d.data()
        }))
        .filter(u => u.id !== user.uid); // Exclude current user
      setCommunityUsers(list);
    }, (err) => {
      console.warn("Failed to listen to community directory users:", err);
    });

    return () => unsubscribe();
  }, [user, activeTab]);

  const handleToggleFollow = async (targetUserId: string) => {
    if (!user) {
      showToast("Please sign in to follow community members.");
      return;
    }
    const docId = `${user.uid}_${targetUserId}`;
    const followDocRef = doc(db, 'follows', docId);
    
    const isFollowing = followingUserIds.includes(targetUserId);
    try {
      if (isFollowing) {
        await deleteDoc(followDocRef);
        showToast("Unfollowed successfully.");
      } else {
        await setDoc(followDocRef, {
          followerId: user.uid,
          followingId: targetUserId,
          createdAt: new Date().toISOString()
        });
        showToast("Followed successfully!");
      }
    } catch (err: any) {
      console.error("Failed to toggle follow status:", err);
      showToast(`Action failed: ${err.message || 'Permission Denied'}`);
    }
  };

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

  // Voting Poll Creator local states
  const [voteQuestionInput, setVoteQuestionInput] = useState('');
  const [voteMode, setVoteMode] = useState<'yesno' | 'custom'>('yesno');
  const [voteOptionsInputs, setVoteOptionsInputs] = useState<string[]>(['Option A', 'Option B']);

  // Guest Profile Identity State
  // Spotlight view state
  const modalRef = useRef<HTMLDivElement>(null);

  const isUserAdmin = (u: any) => {
    const adminEmails = ['fijakhan7127@gmail.com', '000fijakhan123@gmail.com'];
    return !!(u && u.email && adminEmails.includes(u.email.toLowerCase()));
  };

  // Helper to determine role dynamically based on auth email and room creator
  const determineRole = (roomCreatorId?: string): 'admin' | 'host' | 'cohost' | 'member' => {
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

  // Pre-load media sharing APIs in the background for instant Watch Together loading
  useEffect(() => {
    loadYoutubeApi().catch(() => {});
    loadVimeoApi().catch(() => {});
    loadTwitchApi().catch(() => {});
  }, []);

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
      // Room settings click outside close
      if (roomSettingsRef.current && !roomSettingsRef.current.contains(e.target as Node)) {
        setIsRoomSettingsOpen(false);
      }
      // Hover participant action dropdown click outside close
      const target = e.target as HTMLElement | null;
      if (target && !target.closest('.tile-actions-trigger') && !target.closest('.tile-actions-menu')) {
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
    const tokenUnsubscribe = auth.onIdTokenChanged(async (u) => {
      if (u) {
        try {
          idTokenRef.current = await u.getIdToken();
        } catch (e) {
          console.warn("Failed to update ID token:", e);
        }
      } else {
        idTokenRef.current = null;
      }
    });

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
        
        // Sync profile fields to Firestore users doc for searchability in directory
        setDoc(doc(db, 'users', currentUser.uid), {
          displayName: name,
          photoURL: currentUser.photoURL || ''
        }, { merge: true }).catch(err => {
          console.warn("Failed to sync profile fields to users doc:", err);
        });

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
    return () => {
      unsubscribe();
      tokenUnsubscribe();
    };
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
    if (isModalOpen || pendingJoinRoom || pendingSignInRoom) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isModalOpen, pendingJoinRoom, pendingSignInRoom]);

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
    if (!user || user.isAnonymous) {
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


  const getMyId = useCallback(() => user ? user.uid : (guestId || localStorage.getItem('skulk_guest_id') || ''), [user, guestId]);

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
    const myId = getMyId();
    if (myId) {
      const alreadyJoinedRoomId = Object.keys(roomsParticipants).find(rid => {
        if (rid === room.id) return false;
        const participants = roomsParticipants[rid] || [];
        return participants.some(p => p.uid === myId);
      });
      if (alreadyJoinedRoomId) {
        try {
          await leavePresence(alreadyJoinedRoomId);
        } catch (e) {
          console.warn("Failed to auto-leave previous room:", e);
        }
      }
    }

    const id = getRoomIdFromLink(room.link);
    const allowed = await canJoin(room);
    if (!allowed) {
      showToast(`This room is full (${room.maxParticipants || 10}/${room.maxParticipants || 10})`);
      return;
    }

    const isCreator = room.creatorId === myId;

    if (room.type === 'public') {
      window.open(`/room/${id}`, '_blank');
    } else {
      let isAlreadyApproved = false;
      const myRole = determineRole(room.creatorId);
      try {
        const approvedSnap = await getDoc(doc(db, 'rooms', room.id, 'approvedUsers', myId));
        isAlreadyApproved = approvedSnap.exists();
      } catch (e) {
        console.warn("Failed to check approvedUsers in dashboard click:", e);
      }

      if (isCreator || myRole === 'admin' || myRole === 'cohost' || isAlreadyApproved) {
        window.open(`/room/${id}`, '_blank');
      } else {
        if (room.type === 'private') {
          showToast("This room is private. You must use a direct invite link with a secret key to join.");
        } else {
          if (!user || user.isAnonymous) {
            setPendingSignInRoom(room);
          } else {
            setPendingJoinRoom(room);
          }
        }
      }
    }
  };

  const prefetchRoomToken = async (roomId: string) => {
    try {
      const myId = getMyId();
      const myName = user ? user.displayName || 'Google User' : guestName;
      const cleanIdentity = myId.replace(/[^a-zA-Z0-9_\-]/g, '_');
      const res = await fetch(`/api/get-livekit-token?room=${roomId}&identity=${cleanIdentity}&name=${encodeURIComponent(myName)}`);
      const data = await res.json();
      if (data.token) {
        prefetchedLkTokenRef.current = { roomId, token: data.token };
        console.log(`[SPEED-OPT] Token pre-fetched successfully for room: ${roomId}`);
      }
    } catch (e) {
      console.warn("[SPEED-OPT] Failed to pre-fetch token:", e);
    }
  };

  // Setup conference shell room data
  const enterCallRoom = async (room: Room) => {
    isEvictedRef.current = false;
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

    // 1. Transition UI state immediately so stage opens instantly!
    setCurrentRoom(normalizedRoom);
    setIsMicMuted(true);
    setIsCamOff(true);
    setIsGalleryView(true);
    setCallTab('chat');
    setViewingShare(null);
    setChatMessages([]);
    setUnreadChatCount(0);
    isChatInitialLoadRef.current = true;

    // 2. Setup parallel promise chain
    // Promise A: Clean up any previous room leave operations in the background (DO NOT block LiveKit connection)
    if (globalPendingLeavePromise) {
      globalPendingLeavePromise.catch(() => {});
    }

    // Promise B: Firestore checks (role and presence document write) (DO NOT block LiveKit connection)
    const presencePromise = (async () => {
      if (!myId) return;
      let myRole = determineRole(normalizedRoom.creatorId);
      if (myRole !== 'admin') {
        try {
          const appDocSnap = await getDoc(doc(db, 'rooms', normalizedRoom.id, 'approvedUsers', myId));
          if (appDocSnap.exists()) {
            const storedRole = appDocSnap.data()?.role;
            if (storedRole && (storedRole === 'host' || storedRole === 'cohost' || storedRole === 'admin')) {
              myRole = storedRole;
            }
          }
        } catch (err) {
          console.warn("Failed to retrieve persistent role from approvedUsers:", err);
        }
      }

      try {
        await updateDoc(doc(db, 'rooms', normalizedRoom.id), { emptySince: null }).catch(() => {});
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
          sessionId: newSessionId,
          micOn: false,
          camOn: false,
          micRestricted: false,
          camRestricted: false,
          status: myStatus === 'none' ? null : myStatus
        });
        localStorage.setItem('skulk_active_session', JSON.stringify({
          roomId: roomDocId(normalizedRoom),
          sessionId: newSessionId,
          timestamp: Date.now()
        }));

        // If I am joining as host, reclaim host role in the room document and demote any other hosts to cohost
        if (myRole === 'host') {
          await updateDoc(doc(db, 'rooms', normalizedRoom.id), {
            currentHostId: myId,
            currentHostName: user ? user.displayName || 'Google User' : guestName
          }).catch(() => {});
          
          try {
            const snapshot = await getDocs(collection(db, 'rooms', normalizedRoom.id, 'participants'));
            snapshot.docs.forEach(async (docSnap) => {
              if (docSnap.id !== myId && docSnap.data().role === 'host') {
                await updateDoc(docSnap.ref, { role: 'cohost' }).catch(() => {});
              }
            });
          } catch (e) {}
        }
      } catch (err) {
        console.error('[DISCONNECT-DEBUG] enterCallRoom setDoc error:', err);
      }
    })();

    // Promise C: LiveKit token fetch (uses prefetched token if matching room, otherwise fetches)
    const tokenPromise = (async () => {
      if (prefetchedLkTokenRef.current && prefetchedLkTokenRef.current.roomId === normalizedRoom.id) {
        console.log(`[SPEED-OPT] Using pre-fetched LiveKit token for room: ${normalizedRoom.id}`);
        const token = prefetchedLkTokenRef.current.token;
        prefetchedLkTokenRef.current = null; // Consume it
        return token;
      }

      try {
        const myName = user ? user.displayName || 'Google User' : guestName;
        const cleanIdentity = myId.replace(/[^a-zA-Z0-9_\-]/g, '_');
        const res = await fetch(`/api/get-livekit-token?room=${normalizedRoom.id}&identity=${cleanIdentity}&name=${encodeURIComponent(myName)}`);
        const data = await res.json();
        return data.token || null;
      } catch (e) {
        console.warn("Failed to fetch token in enterCallRoom:", e);
        return null;
      }
    })();

    // Await ONLY the LiveKit token promise to initiate the connection immediately
    const lkToken = await tokenPromise;

    if (lkToken) {
      setLiveKitToken(lkToken);
      setActiveLkToken(lkToken);
      setLkConnectStatus('connecting');
      setLkRetryCount(0);
    } else {
      showToast("⚠️ Failed to connect to LiveKit server");
    }

    // Keep presencePromise running in background and catch any failures
    presencePromise.catch(err => {
      console.warn("Background presence update failed:", err);
    });
  };

  const toggleMic = async () => {
    const myId = getMyId();
    const myPresence = callParticipants.find(p => p.id === myId);
    const isMutedByHost = myPresence && myPresence.mutedBy && myPresence.mutedBy !== myId;
    
    if (micBlockedUntil && Date.now() < micBlockedUntil) {
      showToast("❌ Microphone is currently blocked due to Silent Focus quota.");
      return;
    }

    if (isMicMuted && isMutedByHost) {
      if (myPresence.mutedBy === 'focus_limit') {
        showToast("❌ Microphone is currently blocked due to Silent Focus quota.");
      } else {
        showToast("❌ You cannot unmute because the host has muted you.");
      }
      return;
    }

    const nextVal = !isMicMuted;
    setIsMicMuted(nextVal);
    await updateMySharing({ isMuted: nextVal, mutedBy: getMyId() });
  };

  const toggleCamera = async () => {
    const myId = getMyId();
    const myPresence = callParticipants.find(p => p.id === myId);
    const isCamDisabledByHost = myPresence && myPresence.camOffBy && myPresence.camOffBy !== myId;
    
    if (isCamOff && isCamDisabledByHost) {
      showToast("❌ You cannot turn on camera because the host has disabled it.");
      return;
    }

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
        prefetchRoomToken(roomId);

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
          if (roomObj && roomObj.emptySince && Date.now() - roomObj.emptySince > 5 * 60 * 1000) {
            try {
              await deleteDoc(doc(db, 'rooms', roomObj.id));
            } catch (e) {}
            showToast("⚠️ This room has expired (empty for more than 5 minutes).");
            isEnteringRoomRef.current = null;
            navigate('/');
            return;
          }
          if (!roomObj) {
            roomObj = {
              id: roomId,
              name: `Room - ${roomId}`,
              type: 'public',
              buttonText: 'Join',
              participants: [],
              maxParticipants: 10,
              link: `${window.location.origin}/room/${roomId}`
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

          // If rooms list is still loading, wait a short moment for it to sync
          if (!roomsLoaded) {
            for (let i = 0; i < 10; i++) {
              if (roomsLoaded) break;
              await new Promise(resolve => setTimeout(resolve, 200));
            }
          }
          if (myId) {
            const alreadyJoinedRoomId = Object.keys(roomsParticipants).find(rid => {
              if (rid === roomObj!.id) return false;
              const participants = roomsParticipants[rid] || [];
              return participants.some(p => p.uid === myId);
            });
            if (alreadyJoinedRoomId) {
              try {
                await leavePresence(alreadyJoinedRoomId);
              } catch (e) {
                console.warn("Failed to auto-leave previous room:", e);
              }
            }
          }

          if ((roomObj.type === 'public-ask' || roomObj.type === 'private') && !isCreator && myRole !== 'admin' && myRole !== 'cohost') {
            let isAlreadyApproved = false;
            try {
              const approvedSnap = await getDoc(doc(db, 'rooms', roomObj.id, 'approvedUsers', myId));
              isAlreadyApproved = approvedSnap.exists();
            } catch (e) {
              console.warn("Failed to check persistent approval in route sync:", e);
            }

            if (!isAlreadyApproved) {
              const urlParams = new URLSearchParams(window.location.search);
              const urlKey = urlParams.get('key');
              if (urlKey) {
                try {
                  const approvedDocRef = doc(db, 'rooms', roomObj.id, 'approvedUsers', myId);
                  await setDoc(approvedDocRef, {
                    approvedAt: new Date().toISOString(),
                    role: 'member',
                    joinKey: urlKey
                  });
                  isAlreadyApproved = true;
                } catch (err) {
                  console.warn("Failed to self-approve with joinKey:", err);
                }
              }
            }

            if (!isAlreadyApproved) {
              isEnteringRoomRef.current = null;
              if (roomObj.type === 'private') {
                showToast("❌ This room is private. You must use a valid direct invite link with a secret key to join.");
                navigate('/');
              } else {
                if (!user || user.isAnonymous) {
                  setPendingSignInRoom(roomObj);
                  navigate('/');
                } else {
                  setPendingJoinRoom(roomObj);
                }
              }
              return;
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
        finalizeSession();
        leavePresence(prevRoomId);
        currentSessionIdRef.current = null;
        setCurrentRoom(null);
        setCallParticipants([]);
        setChatMessages([]);
        setSystemMessages([]);
        isInitialLoadRef.current = true;
        isChatInitialLoadRef.current = true;
        setUnreadChatCount(0);
        setViewingShare(null);
        setLiveKitToken(null);
        setActiveLkToken(null);
        setLkConnectStatus('idle');
        setLkRetryCount(0);
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
        finalizeSession();
        leavePresence(prevRoomId, sessionIdToClean);
      }
    };
  }, [currentRoom ? roomDocId(currentRoom) : null]);



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
      
      let myRole = determineRole(currentRoom.creatorId);
      if (myRole !== 'admin') {
        try {
          const appDocSnap = await getDoc(doc(db, 'rooms', rid, 'approvedUsers', myId));
          if (appDocSnap.exists()) {
            const storedRole = appDocSnap.data()?.role;
            if (storedRole && (storedRole === 'host' || storedRole === 'cohost' || storedRole === 'admin')) {
              myRole = storedRole;
            }
          }
        } catch (err) {
          console.warn("Failed to retrieve persistent role from approvedUsers inside syncAuthPresence:", err);
        }
      }

      try {
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
          sessionId: currentSessionIdRef.current,
          micOn: !isMicMutedRef.current,
          camOn: !isCamOffRef.current,
          status: myStatus === 'none' ? null : myStatus
        }, { merge: true });
      } catch (err) {
        console.warn("Failed to synchronize presence in syncAuthPresence:", err);
      }
    };
    
    syncAuthPresence();
  }, [user, currentRoom ? roomDocId(currentRoom) : null, guestName, guestInitials, guestColor, guestPhotoURL, guestId, myStatus]);

  // Clean up presence immediately on tab/browser close using fetch keepalive
  useEffect(() => {
    const handleUnload = () => {
      if (currentRoom) {
        const myId = getMyId();
        const rid = roomDocId(currentRoom);
        if (myId && rid) {
          const url = `https://firestore.googleapis.com/v1/projects/skulk-45c23/databases/(default)/documents/rooms/${rid}/participants/${myId}`;
          const headers: HeadersInit = {};
          if (idTokenRef.current) {
            headers['Authorization'] = `Bearer ${idTokenRef.current}`;
          }
          fetch(url, { 
            method: 'DELETE', 
            headers,
            keepalive: true 
          }).catch(() => {});
        }
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('pagehide', handleUnload);
    };
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
              finalizeSession();
              leavePresence(currentRoomId, mySessionId);
              
              // Reset local state
              hasSeenSelfInListRef.current = false;
              clearMySharing();
              setCurrentRoom(null);
              setCallParticipants([]);
              setChatMessages([]);
              setViewingShare(null);
              setLiveKitToken(null);
              setActiveLkToken(null);
              setLkConnectStatus('idle');
              setLkRetryCount(0);
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

  // Synchronize remote mute actions with local microphone state
  
  useEffect(() => {
    if (!currentRoom) return;
    const myId = getMyId();
    const myPresence = callParticipants.find(p => p.id === myId);
    if (myPresence && myPresence.isMuted !== isMicMuted) {
      // ONLY apply remote changes if they were initiated by another user (moderator)
      if (myPresence.mutedBy && myPresence.mutedBy !== myId) {
        setIsMicMuted(myPresence.isMuted);
        if (myPresence.mutedBy === 'focus_limit') {
          showToast(myPresence.isMuted ? "🔇 Focus limit reached. Mic blocked for 1 minute." : "🎤 Focus limit countdown ended. You can now unmute yourself.");
        } else {
          showToast(myPresence.isMuted ? "🎤 You have been muted by a host." : "🎤 You have been unmuted by a host.");
        }
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
    }, (error) => {
      console.warn("Failed to listen to joinRequests:", error);
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
    }, (error) => {
      console.warn("Failed to listen to local user's own join request:", error);
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
      await setDoc(doc(db, 'rooms', rid, 'approvedUsers', req.id), {
        approvedAt: new Date().toISOString(),
        role: 'member'
      });
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

  // LiveKit connection retry state machine
  useEffect(() => {
    if (lkConnectStatus !== 'error' || !liveKitToken) return;
    if (lkRetryCount >= 10) return;

    const nextRetry = lkRetryCount + 1;
    const delay = Math.min(30000, 1000 * Math.pow(2, nextRetry - 1)); // 1s, 2s, 4s, 8s...
    
    console.warn(`LiveKit connection error. Scheduling retry ${nextRetry}/10 in ${delay}ms...`);

    const timer = setTimeout(() => {
      if (liveKitToken) {
        console.log(`Attempting LiveKit reconnect (${nextRetry}/10)...`);
        setLkConnectStatus('connecting');
        setLkRetryCount(nextRetry);
        setActiveLkToken(liveKitToken);
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [lkConnectStatus, lkRetryCount, liveKitToken]);


  

  // Screen share trigger
  const stopScreenShare = useCallback(async () => {
    setScreenShareStream(prevStream => {
      if (prevStream) {
        prevStream.getTracks().forEach(track => track.stop());
      }
      return null;
    });
    
    await clearMySharing();
    
    setViewingShare(prevShare => {
      if (prevShare?.type === 'screen') {
        return null;
      }
      return prevShare;
    });
    
    showToast('Screen sharing stopped');
  }, [clearMySharing, setViewingShare]);

  const startScreenShare = useCallback(async () => {
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
  }, [stopScreenShare, updateMySharing, setViewingShare, getMyId]);

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

  const pomodoroTimerRef = useRef({ minutes: 0, seconds: 0, phase: 'focus' as 'focus' | 'break' });
  useEffect(() => {
    pomodoroTimerRef.current = { 
      minutes: pomodoroMinutes, 
      seconds: pomodoroSeconds, 
      phase: pomodoroPhase 
    };
  }, [pomodoroMinutes, pomodoroSeconds, pomodoroPhase]);

  // Pomodoro countdown effect
  useEffect(() => {
    if (!pomodoroIsRunning) return;
    
    const interval = setInterval(() => {
      const { minutes, seconds, phase } = pomodoroTimerRef.current;
      if (seconds > 0) {
        setPomodoroSeconds(seconds - 1);
      } else if (minutes > 0) {
        setPomodoroMinutes(minutes - 1);
        setPomodoroSeconds(59);
      } else {
        // Transition phase
        if (phase === 'focus') {
          setPomodoroPhase('break');
          setPomodoroMinutes(pomodoroBreakLength);
          setPomodoroSeconds(0);
          showToast('Focus session complete! Time for a short break.');
          playBreakSound();
        } else {
          setPomodoroPhase('focus');
          setPomodoroMinutes(pomodoroFocusLength);
          setPomodoroSeconds(0);
          showToast('Break complete! Back to focus.');
          playStepSound();
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [pomodoroIsRunning, pomodoroFocusLength, pomodoroBreakLength]);

  // Web Audio API Sound Generation Helpers
  const playMessageSound = () => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.15);
      
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.2);
    } catch (e) {
      console.warn("Failed to play message sound:", e);
    }
  };

  const playJoinSound = () => {
    const audio = new Audio('/assets/audio/join.mp3');
    audio.volume = 0.5;
    audio.play()
      .catch((err) => {
        console.log("Audio asset /assets/audio/join.mp3 not found or blocked, falling back to Web Audio synthesis:", err);
        try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          if (!AudioContextClass) return;
          const ctx = new AudioContextClass();
          
          const playTone = (freq: number, startDelay: number, duration: number) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, ctx.currentTime + startDelay);
            gain.gain.setValueAtTime(0, ctx.currentTime + startDelay);
            gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + startDelay + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startDelay + duration);
            osc.start(ctx.currentTime + startDelay);
            osc.stop(ctx.currentTime + startDelay + duration);
          };
          playTone(523.25, 0, 0.25);   // C5
          playTone(659.25, 0.08, 0.3); // E5
        } catch (e) {
          console.warn("Failed to play synthesized join sound:", e);
        }
      });
  };

  const playLeaveSound = () => {
    const audio = new Audio('/assets/audio/leave.mp3');
    audio.volume = 0.5;
    audio.play()
      .catch((err) => {
        console.log("Audio asset /assets/audio/leave.mp3 not found or blocked, falling back to Web Audio synthesis:", err);
        try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          if (!AudioContextClass) return;
          const ctx = new AudioContextClass();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          
          osc.type = 'sine';
          osc.frequency.setValueAtTime(500, ctx.currentTime);
          osc.frequency.setValueAtTime(320, ctx.currentTime + 0.12);
          
          gain.gain.setValueAtTime(0.12, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
          
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.25);
        } catch (e) {
          console.warn("Failed to play leave sound:", e);
        }
      });
  };

  const playBreakSound = () => {
    const audio = new Audio('/assets/audio/break.mp3');
    audio.volume = 0.5;
    audio.play()
      .catch((err) => {
        console.log("Audio asset /assets/audio/break.mp3 not found or blocked, falling back to Web Audio synthesis:", err);
        try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          if (!AudioContextClass) return;
          const ctx = new AudioContextClass();
          const playNote = (freq: number, startTime: number, duration: number) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, ctx.currentTime + startTime);
            gain.gain.setValueAtTime(0.1, ctx.currentTime + startTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTime + duration);
            osc.start(ctx.currentTime + startTime);
            osc.stop(ctx.currentTime + startTime + duration);
          };
          playNote(659.25, 0, 0.3);
          playNote(523.25, 0.15, 0.3);
          playNote(392.00, 0.3, 0.4);
        } catch (e) {
          console.warn("Failed to play synthesized break sound:", e);
        }
      });
  };

  const playStepSound = () => {
    const audio = new Audio('/assets/audio/step.mp3');
    audio.volume = 0.5;
    audio.play()
      .catch((err) => {
        console.log("Audio asset /assets/audio/step.mp3 not found or blocked, falling back to Web Audio synthesis:", err);
        try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          if (!AudioContextClass) return;
          const ctx = new AudioContextClass();
          const playNote = (freq: number, startTime: number, duration: number) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, ctx.currentTime + startTime);
            gain.gain.setValueAtTime(0.08, ctx.currentTime + startTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTime + duration);
            osc.start(ctx.currentTime + startTime);
            osc.stop(ctx.currentTime + startTime + duration);
          };
          playNote(523.25, 0, 0.15);
          playNote(659.25, 0.08, 0.15);
          playNote(783.99, 0.16, 0.15);
          playNote(1046.50, 0.24, 0.3);
        } catch (e) {
          console.warn("Failed to play synthesized step sound:", e);
        }
      });
  };


  const prevMessagesCountRef = useRef(0);
  useEffect(() => {
    if (chatMessages.length > prevMessagesCountRef.current) {
      if (prevMessagesCountRef.current > 0) {
        const lastMsg = chatMessages[chatMessages.length - 1];
        if (lastMsg && lastMsg.senderId !== getMyId()) {
          playMessageSound();
          if (!isChatActiveRef.current) {
            setUnreadChatCount(prev => prev + 1);
          }
          // Notify on mention (@user or @all)
          const myId = getMyId();
          const cleanMyName = (user ? user.displayName || 'Google User' : guestName).replace(' (You)', '');
          const hasMentionInText = lastMsg.text.toLowerCase().includes(`@${cleanMyName.toLowerCase()}`) || 
                                   lastMsg.text.toLowerCase().includes('@all');
          const isMentioned = lastMsg.mentionedId === myId || 
                              lastMsg.mentionedId === 'bot_all' || 
                              hasMentionInText;

          if (isMentioned) {
            showToast(`🔔 Mentioned by ${lastMsg.sender}: "${lastMsg.text.substring(0, 40)}${lastMsg.text.length > 40 ? '...' : ''}"`);
          }
        }
      }
    }
    prevMessagesCountRef.current = chatMessages.length;
  }, [chatMessages]);

  const prevParticipantsRef = useRef<Participant[]>([]);
  useEffect(() => {
    if (prevParticipantsRef.current.length > 0) {
      if (callParticipants.length > prevParticipantsRef.current.length) {
        const prevIds = prevParticipantsRef.current.map(p => p.id);
        const joinedUser = callParticipants.find(p => !prevIds.includes(p.id));
        if (joinedUser && joinedUser.id !== getMyId()) {
          playJoinSound();
        }
      }
      else if (callParticipants.length < prevParticipantsRef.current.length) {
        const currentIds = callParticipants.map(p => p.id);
        const leftUser = prevParticipantsRef.current.find(p => !currentIds.includes(p.id));
        if (leftUser && leftUser.id !== getMyId()) {
          playLeaveSound();
        }
      }
    }
    prevParticipantsRef.current = callParticipants;
  }, [callParticipants]);

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
      setTodSpinPool([]);
      setTodState('idle');
      setTodChoice(null);
      setTodText('');
      setTodSelectedId('');
      setTodLocalSpinning(false);
      setSpinLocalSpinning(false);
      setTodActiveIds([]);
      setTodPendingIds([]);
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

  const toggleRaiseHand = async () => {
    const myId = getMyId();
    const myPresence = callParticipants.find(p => p.id === myId);
    const isRaised = !!myPresence?.handRaised;
    try {
      await updateMySharing({
        handRaised: !isRaised,
        handRaisedAt: isRaised ? null : Date.now()
      });
      showToast(isRaised ? "Hand lowered" : "Hand raised ✋");
    } catch (e) {
      console.warn("Failed to toggle hand raise:", e);
    }
  };


  const handleLowerHand = async (participantId: string) => {
    if (!currentRoom) return;
    try {
      const myId = getMyId();
      const myPresence = callParticipants.find(p => p.id === myId);
      const isSelf = participantId === myId;
      const isHostOrAdmin = myPresence?.role === 'host' || myPresence?.role === 'cohost' || myPresence?.role === 'admin';

      if (!isSelf && !isHostOrAdmin) {
        showToast("❌ Only hosts, co-hosts, and admins can lower other participants' hands.");
        return;
      }

      await updateDoc(doc(db, 'rooms', roomDocId(currentRoom), 'participants', participantId), {
        handRaised: false,
        handRaisedAt: null
      });
      showToast(isSelf ? "Hand lowered" : "Lowered participant's hand");
    } catch (e) {
      console.warn("Failed to lower hand:", e);
    }
  };

  const handleSelectRoomMode = async (mode: 'chill' | 'discuss' | 'non-discuss') => {
    if (!currentRoom) return;
    try {
      const updateData: any = { roomMode: mode };
      if (currentRoom.voteStatus === 'active') {
        updateData.voteStatus = 'closed';
        updateData.voteQuestion = null;
        updateData.voteOptions = null;
        updateData.voteCreatorId = null;
        updateData.voteCreatorName = null;
      }
      await updateDoc(doc(db, 'rooms', roomDocId(currentRoom)), updateData);
      showToast(`Room mode changed to ${mode === 'chill' ? 'Chill Mode' : mode === 'discuss' ? 'Focus Mode' : 'Ultra Pro Max Focus Mode'}`);
    } catch (e) {
      console.warn("Failed to select room mode:", e);
      showToast("❌ Failed to change room mode");
    }
  };


  const handleJoinTodGame = async () => {
    if (!currentRoom) return;
    const myId = getMyId();
    try {
      const isSpinning = todState !== 'idle';
      const pRef = doc(db, 'rooms', roomDocId(currentRoom), 'participants', myId);
      
      if (isSpinning) {
        await updateDoc(pRef, {
          todPending: true,
          todJoined: false
        });
      } else {
        await updateDoc(pRef, {
          todJoined: true,
          todPending: false
        });
      }
      showToast("Joined Truth or Dare game!");
    } catch (e) {
      console.warn("Failed to join Truth or Dare game:", e);
    }
  };

  const handleLeaveTodGame = async () => {
    if (!currentRoom) return;
    const myId = getMyId();
    try {
      const pRef = doc(db, 'rooms', roomDocId(currentRoom), 'participants', myId);
      await updateDoc(pRef, {
        todJoined: false,
        todPending: false
      });
      
      // Keep todSpinPool in sync if host
      const myPresence = callParticipants.find(p => p.id === myId);
      const isHost = myPresence?.role === 'host' || myPresence?.role === 'cohost' || myPresence?.role === 'admin' || currentRoom.creatorId === myId;
      if (isHost) {
        const roomRef = doc(db, 'rooms', roomDocId(currentRoom));
        await updateDoc(roomRef, {
          todSpinPool: todSpinPool.filter(id => id !== myId)
        });
      }
      showToast("Left Truth or Dare game.");
    } catch (e) {
      console.warn("Failed to leave Truth or Dare game:", e);
    }
  };

  const handleSpinTruthOrDare = async () => {
    if (!currentRoom || callParticipants.length === 0) return;
    const myId = getMyId();

    const myPresence = callParticipants.find(p => p.id === myId);
    const isHost = myPresence?.role === 'host' || myPresence?.role === 'cohost' || myPresence?.role === 'admin' || currentRoom.creatorId === myId;

    if (!isHost) {
      // Non-host: write spin request to my participant document
      try {
        const pRef = doc(db, 'rooms', roomDocId(currentRoom), 'participants', myId);
        await updateDoc(pRef, {
          todRequestedSpin: Date.now()
        });
        showToast("Spin requested...");
      } catch (e) {
        console.warn("Failed to request spin:", e);
      }
      return;
    }

    try {
      const roomRef = doc(db, 'rooms', roomDocId(currentRoom));
      await runTransaction(db, async (transaction) => {
        const roomSnap = await transaction.get(roomRef);
        if (!roomSnap.exists()) return;
        const data = roomSnap.data();
        
        const state = data.todState || 'idle';
        if (state !== 'idle' || data.todSpinInProgress) {
          throw new Error("Spin in progress");
        }
        
        // Filter active IDs against presence list to handle departed users
        const activeIds = callParticipants.filter(p => p.todJoined).map(p => p.id);
        if (activeIds.length === 0) {
          throw new Error("No active participants in game");
        }
        
        let candidates = (data.todSpinPool || [])
          .filter((id: string) => activeIds.includes(id));
        if (candidates.length === 0) {
          candidates = [...activeIds];
        }
        
        const selectedId = candidates[Math.floor(Math.random() * candidates.length)];
        const newPool = candidates.filter((id: string) => id !== selectedId);
        
        const idx = activeIds.indexOf(selectedId);
        const segmentAngle = 360 / activeIds.length;
        const targetAngle = 360 - (idx * segmentAngle + segmentAngle / 2);
        
        const prevSpin = data.todSpinResult;
        const prevAngle = prevSpin ? prevSpin.angle : 0;
        const prevFullSpins = Math.floor(prevAngle / 360);
        const newAngle = (prevFullSpins + 5) * 360 + targetAngle;
        
        const spunBy = user ? user.displayName || 'Google User' : guestName;
        
        transaction.update(roomRef, {
          todSpinResult: {
            selectedId,
            angle: newAngle,
            spunBy,
            spunById: myId,
            timestamp: Date.now()
          },
          todSpinPool: newPool,
          todState: 'spinning',
          todChoice: null,
          todText: '',
          todSelectedId: selectedId,
          todSpinInProgress: true
        });
      });
    } catch (e: any) {
      if (e.message === "Spin in progress") {
        showToast("⚠️ A spin is already in progress!");
      } else if (e.message === "No active participants in game") {
        showToast("⚠️ No joined participants are in the call!");
      } else {
        console.warn("Failed to spin Truth or Dare:", e);
      }
    }
  };

  const handleSelectTodChoice = async (choice: 'Truth' | 'Dare') => {
    if (!currentRoom) return;
    const questions = choice === 'Truth' ? truthQuestions : dareQuestions;
    const randomText = questions[Math.floor(Math.random() * questions.length)];
    
    const myId = getMyId();
    const myPresence = callParticipants.find(p => p.id === myId);
    const isHost = myPresence?.role === 'host' || myPresence?.role === 'cohost' || myPresence?.role === 'admin' || currentRoom.creatorId === myId;
    
    if (!isHost) {
      try {
        const pRef = doc(db, 'rooms', roomDocId(currentRoom), 'participants', myId);
        await updateDoc(pRef, {
          todRequestedChoice: choice
        });
        showToast(`Choice requested: ${choice}`);
      } catch (e) {
        console.warn("Failed to request choice:", e);
      }
      return;
    }

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
    
    const myId = getMyId();
    const myPresence = callParticipants.find(p => p.id === myId);
    const isHost = myPresence?.role === 'host' || myPresence?.role === 'cohost' || myPresence?.role === 'admin' || currentRoom.creatorId === myId;
    
    if (!isHost) {
      try {
        const pRef = doc(db, 'rooms', roomDocId(currentRoom), 'participants', myId);
        await updateDoc(pRef, {
          todRequestedReset: Date.now()
        });
        showToast("Reset requested...");
      } catch (e) {
        console.warn("Failed to request reset:", e);
      }
      return;
    }

    try {
      const roomRef = doc(db, 'rooms', roomDocId(currentRoom));
      await runTransaction(db, async (transaction) => {
        const roomSnap = await transaction.get(roomRef);
        if (!roomSnap.exists()) return;
        const data = roomSnap.data();
        
        // Find all pending participants from the presence list
        const pendingIds = callParticipants.filter(p => p.todPending).map(p => p.id);
        const currentPool = data.todSpinPool || [];
        const newPool = [...new Set([...currentPool, ...pendingIds])];
        
        transaction.update(roomRef, {
          todState: 'idle',
          todChoice: null,
          todText: '',
          todSelectedId: '',
          todSpinPool: newPool,
          todSpinInProgress: false
        });

        // Promote pending participants to joined
        for (const pId of pendingIds) {
          const pRef = doc(db, 'rooms', roomDocId(currentRoom), 'participants', pId);
          transaction.update(pRef, {
            todJoined: true,
            todPending: false
          });
        }
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
    const prevList = targetsList;
    const nextList = [...prevList, nextItem];
    
    // Optimistic Update
    setTargetsList(nextList);
    setTargetInputText('');
    
    if (user) {
      try {
        const userDocRef = doc(db, 'users', user.uid);
        await setDoc(userDocRef, { targetsList: nextList }, { merge: true });
        showToast('Weekly target added!');
      } catch (err: any) {
        console.error("Failed to add target to Firestore:", err);
        setTargetsList(prevList);
        showToast(`Failed to add target: ${err.message || 'Permission Denied'}`);
      }
    } else {
      localStorage.setItem('skulk_guest_targets_list', JSON.stringify(nextList));
      showToast('Weekly target added!');
    }
  };

  const handleToggleTarget = async (id: string) => {
    const prevList = targetsList;
    const nextList = prevList.map(t => t.id === id ? { ...t, completed: !t.completed } : t);
    
    // Optimistic Update
    setTargetsList(nextList);
    
    if (user) {
      try {
        const userDocRef = doc(db, 'users', user.uid);
        await setDoc(userDocRef, { targetsList: nextList }, { merge: true });
      } catch (err: any) {
        console.error("Failed to toggle target in Firestore:", err);
        setTargetsList(prevList);
        showToast(`Failed to update target: ${err.message || 'Permission Denied'}`);
      }
    } else {
      localStorage.setItem('skulk_guest_targets_list', JSON.stringify(nextList));
    }
  };

  const handleStartNewWeek = async () => {
    const prevList = targetsList;
    const prevHistory = targetsHistory;
    const totalCount = prevList.length;
    const completedCount = prevList.filter(t => t.completed).length;
    const startOfWeek = new Date();
    const formattedDate = startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    
    const nextHistory = [
      { date: formattedDate, completedCount, totalCount },
      ...prevHistory
    ];
    // Rollover incomplete targets
    const nextList = prevList.filter(t => !t.completed);
    const mondayKey = getStartOfWeekMondayKey();
    
    // Optimistic Update
    setTargetsList(nextList);
    setTargetsHistory(nextHistory);
    
    if (user) {
      try {
        const userDocRef = doc(db, 'users', user.uid);
        await setDoc(userDocRef, {
          targetsList: nextList,
          targetsHistory: nextHistory,
          currentWeekKey: mondayKey
        }, { merge: true });
        showToast('Started new week! Rolled over incomplete targets.');
      } catch (err: any) {
        console.error("Failed to archive week in Firestore:", err);
        setTargetsList(prevList);
        setTargetsHistory(prevHistory);
        showToast(`Failed to archive week: ${err.message || 'Permission Denied'}`);
      }
    } else {
      localStorage.setItem('skulk_guest_targets_list', JSON.stringify(nextList));
      localStorage.setItem('skulk_guest_targets_history', JSON.stringify(nextHistory));
      showToast('Started new week! Rolled over incomplete targets.');
    }
  };

  const deadlineTimerRef = useRef({ minutes: 0, seconds: 0 });
  useEffect(() => {
    deadlineTimerRef.current = { minutes: deadlineTimerMinutes, seconds: deadlineTimerSeconds };
  }, [deadlineTimerMinutes, deadlineTimerSeconds]);

  // Mini Deadline Clock Timer Effect
  useEffect(() => {
    if (!deadlineIsRunning) return;
    
    const interval = setInterval(() => {
      const { minutes, seconds } = deadlineTimerRef.current;
      if (seconds > 0) {
        setDeadlineTimerSeconds(seconds - 1);
      } else if (minutes > 0) {
        setDeadlineTimerMinutes(minutes - 1);
        setDeadlineTimerSeconds(59);
      } else {
        // Time is up!
        setDeadlineIsRunning(false);
        showToast(`Deadline reached for ${deadlineSteps[deadlineActiveIndex]?.name || 'current step'}!`);
        playStepSound();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [deadlineIsRunning, deadlineActiveIndex, deadlineSteps]);

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
      playStepSound();
    } else {
      showToast('All deadline steps completed!');
      playStepSound();
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

  // Synchronize Truth or Dare spinning animation and state transition
  useEffect(() => {
    if (todSpinResult && todState === 'spinning') {
      setTodLocalSpinning(true);
      const elapsed = Date.now() - todSpinResult.timestamp;
      const remainingTime = Math.max(0, 4000 - elapsed);

      const timer = setTimeout(() => {
        setTodLocalSpinning(false);
        const myId = getMyId();
        const wasSpunByMe = todSpinResult.spunById === myId;
        
        // If spun by me, OR if the spinner is not in the call anymore (fallback), transition to choice.
        const spinnerStillPresent = callParticipants.some(p => p.id === todSpinResult.spunById);
        const isFirstActiveParticipant = callParticipants
          .filter(p => todActiveIds.includes(p.id))
          .sort((a, b) => a.id.localeCompare(b.id))[0]?.id === myId;

        if (currentRoom && (wasSpunByMe || (!spinnerStillPresent && isFirstActiveParticipant))) {
          updateDoc(doc(db, 'rooms', roomDocId(currentRoom)), {
            todState: 'choice'
          }).catch((e) => console.warn("Failed to transition todState to choice:", e));
        }
      }, remainingTime);
      return () => clearTimeout(timer);
    }
  }, [todSpinResult?.timestamp, todState, callParticipants, todActiveIds]);

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

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();

    const myId = getMyId();
    const isAdmin = isUserAdmin(user);
    if (!isAdmin && myId) {
      const isLiveRoom = (r: Room) => {
        if (r.scheduledDate && r.scheduledTime) {
          try {
            const start = new Date(`${r.scheduledDate}T${r.scheduledTime}`).getTime();
            return start <= Date.now();
          } catch (err) {
            return true;
          }
        }
        return true;
      };

      const activeCreatedRoom = rooms.find(r => r.creatorId === myId && isLiveRoom(r));
      if (activeCreatedRoom) {
        showToast(`⚠️ You already have an active room: "${activeCreatedRoom.name}". Please end it before creating a new one.`);
        return;
      }
    }

    if (newMaxParticipants === 0) {
      showToast("At least 1 participant is required");
      return;
    }

    const randomId = Math.random().toString(36).substring(2, 8);
    const joinKey = newRoomType !== 'public' ? Math.random().toString(36).substring(2, 10) : '';
    const roomLink = newRoomType !== 'public' ? `${window.location.origin}/room/${randomId}?key=${joinKey}` : `${window.location.origin}/room/${randomId}`;

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
      creatorEmail: user?.email || undefined,
      createdAt: new Date().toISOString(),
      currentHostId: getMyId(),
      currentHostName: user ? user.displayName || 'Google User' : 'Unknown',
      roomMode: 'chill'
    };

    if (roomDetails.scheduledDate !== undefined) {
      newRoomObj.scheduledDate = roomDetails.scheduledDate;
    }
    if (roomDetails.scheduledTime !== undefined) {
      newRoomObj.scheduledTime = roomDetails.scheduledTime;
    }

    try {
      const myId = getMyId();
      let limitDocRef: any = null;
      if (myId) {
        limitDocRef = doc(db, 'users', myId);
        const limitSnap = await getDoc(limitDocRef);
        if (limitSnap.exists()) {
          const limitData = limitSnap.data() as any;
          const lastCreated = limitData?.lastRoomCreatedTime?.toDate?.()?.getTime() || 0;
          if (Date.now() - lastCreated < 5000) {
            showToast("Slow down! Please wait a few seconds before creating another room.");
            return;
          }
        }
      }

      // 1. Write the room document first
      try {
        await setDoc(doc(db, 'rooms', newRoomObj.id), newRoomObj);
      } catch (e: any) {
        console.error("Room document write failed:", e);
        throw new Error(`Room persistence failed: ${e.message || 'Permission Denied'}`);
      }

      // If key is generated, write key document and self-approve creator
      if (newRoomType !== 'public' && joinKey && myId) {
        try {
          await setDoc(doc(db, 'rooms', newRoomObj.id, 'keys', joinKey), {
            createdAt: new Date().toISOString()
          });
          await setDoc(doc(db, 'rooms', newRoomObj.id, 'approvedUsers', myId), {
            approvedAt: new Date().toISOString(),
            role: 'host'
          });
        } catch (e) {
          console.warn("Failed to create key or self-approval in Firestore:", e);
        }
      }

      // 2. Update rate-limit user document second
      if (limitDocRef) {
        try {
          await setDoc(limitDocRef, { lastRoomCreatedTime: serverTimestamp() }, { merge: true });
        } catch (e: any) {
          console.warn("Rate-limit update failed:", e);
        }
      }
      
      setGeneratedRoomLink(roomLink);
      setModalStep('confirmation');
      prefetchRoomToken(newRoomObj.id);
    } catch (err: any) {
      console.warn('Error saving room to Firestore, falling back to local creation:', err);
      setIsFirestoreBlocked(true);
      const localRoom = { ...newRoomObj, isLocalOnly: true };
      saveLocalRoom(localRoom);
      setRooms(prev => {
        if (prev.some(r => r.id === localRoom.id)) return prev;
        return [...prev, localRoom];
      });
      setGeneratedRoomLink(roomLink);
      setModalStep('confirmation');
      prefetchRoomToken(newRoomObj.id);
      showToast(`⚠️ Firestore Write Blocked. Room created locally (Offline Fallback).`);
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

  const sendChatMessage = async (text: string, mentionedId?: string) => {
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
    if (mentionedId) {
      newMsg.mentionedId = mentionedId;
    }

    try {
      await setDoc(doc(db, 'rooms', roomDocId(currentRoom), 'messages', msgId), newMsg);

      if (mentionedId) {
        if (mentionedId === 'bot_all') {
          // Trigger all active bots sequentially with a stagger delay
          activeBots.forEach((bot, index) => {
            const currentBotMentionId = `bot_${bot.id}`;
            const botName = bot.name;

            setTimeout(async () => {
              if (!currentRoom) return;

              // Read latest chat messages history from ref
              const history = chatMessagesRef.current.slice(-10).map(m => ({
                senderRole: m.senderRole,
                text: m.text
              }));

              // Show typing indicator for this specific bot
              setBotTypingIds(prev => [...prev, currentBotMentionId]);

              try {
                const response = await fetch('/api/study-buddy', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    botId: botName,
                    message: text.trim(),
                    chatHistory: history
                  })
                });

                const data = await response.json();
                if (!response.ok) {
                  const errorMsg = data.details ? `${data.error} Details: ${data.details}` : (data.error || 'Failed to call backend');
                  throw new Error(errorMsg);
                }

                const botMsgId = (Date.now() + index * 10 + 10).toString();
                const botMsg: ChatMessage = {
                  id: botMsgId,
                  sender: botName,
                  senderId: currentBotMentionId,
                  senderRole: 'bot' as any,
                  text: data.reply,
                  createdAt: new Date().toISOString()
                };
                await setDoc(doc(db, 'rooms', roomDocId(currentRoom), 'messages', botMsgId), botMsg);
              } catch (err: any) {
                console.error(`Study Buddy ${botName} response generation failed:`, err);
                const botMsgId = (Date.now() + index * 10 + 10).toString();
                const botMsg: ChatMessage = {
                  id: botMsgId,
                  sender: botName,
                  senderId: currentBotMentionId,
                  senderRole: 'bot' as any,
                  text: `⚠️ Error: ${err.message || 'Generation failed'}.`,
                  createdAt: new Date().toISOString()
                };
                await setDoc(doc(db, 'rooms', roomDocId(currentRoom), 'messages', botMsgId), botMsg);
              } finally {
                // Clear typing indicator for this specific bot
                setBotTypingIds(prev => prev.filter(id => id !== currentBotMentionId));
              }
            }, index * 1500); // 1.5 seconds stagger between each bot
          });
        } else if (mentionedId.startsWith('bot_')) {
          const botName = mentionedId.replace('bot_', '');
          const history = chatMessages.slice(-10).map(m => ({
            senderRole: m.senderRole,
            text: m.text
          }));

          // Show typing indicator
          setBotTypingIds(prev => [...prev, mentionedId]);

          fetch('/api/study-buddy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              botId: botName,
              message: text.trim(),
              chatHistory: history
            })
          })
          .then(async (response) => {
            const data = await response.json();
            if (!response.ok) {
              const errorMsg = data.details ? `${data.error} Details: ${data.details}` : (data.error || 'Failed to call backend');
              throw new Error(errorMsg);
            }
            
            const botMsgId = (Date.now() + 10).toString();
            const botMsg: ChatMessage = {
              id: botMsgId,
              sender: botName,
              senderId: mentionedId,
              senderRole: 'bot' as any,
              text: data.reply,
              createdAt: new Date().toISOString()
            };
            await setDoc(doc(db, 'rooms', roomDocId(currentRoom), 'messages', botMsgId), botMsg);
          })
          .catch(async (err) => {
            console.error("Study Buddy response generation failed:", err);
            const botMsgId = (Date.now() + 10).toString();
            const botMsg: ChatMessage = {
              id: botMsgId,
              sender: botName,
              senderId: mentionedId,
              senderRole: 'bot' as any,
              text: `⚠️ Error: ${err.message || 'Generation failed'}.`,
              createdAt: new Date().toISOString()
            };
            await setDoc(doc(db, 'rooms', roomDocId(currentRoom), 'messages', botMsgId), botMsg);
          })
          .finally(() => {
            // Clear typing indicator
            setBotTypingIds(prev => prev.filter(id => id !== mentionedId));
          });
        }
      }
    } catch (err) {
      console.warn("Failed to write chat to Firestore, fallback locally:", err);
      setChatMessages(prev => [...prev, newMsg]);
      showToast('Message saved locally — check your connection');
    }
  };

  const deleteChatMessage = async (msgId: string) => {
    if (!currentRoom) return;
    try {
      await updateDoc(doc(db, 'rooms', roomDocId(currentRoom), 'messages', msgId), {
        deleted: true,
        text: 'This message was deleted'
      });
      showToast('Message deleted.');
    } catch (e) {
      console.error("Failed to delete message:", e);
      showToast('❌ Failed to delete message.');
    }
  };

  const editChatMessage = async (msgId: string, newText: string) => {
    if (!currentRoom || !newText.trim()) return;
    try {
      await updateDoc(doc(db, 'rooms', roomDocId(currentRoom), 'messages', msgId), {
        text: newText.trim(),
        edited: true
      });
      showToast('Message edited.');
    } catch (e) {
      console.error("Failed to edit message:", e);
      showToast('❌ Failed to edit message.');
    }
  };

  const handleClearParticipantChat = async (participantId: string, participantName: string) => {
    if (!currentRoom) return;
    try {
      const messagesRef = collection(db, 'rooms', roomDocId(currentRoom), 'messages');
      const q = query(messagesRef, where('senderId', '==', participantId));
      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        showToast(`No messages found for ${participantName}.`);
        setActiveMenuParticipantId(null);
        return;
      }

      const batch = writeBatch(db);
      snapshot.docs.forEach(docSnap => {
        batch.delete(docSnap.ref);
      });
      await batch.commit();
      showToast(`Cleared messages for ${participantName}.`);
    } catch (e) {
      console.error("Failed to clear participant chat:", e);
      showToast('❌ Failed to clear messages.');
    }
    setActiveMenuParticipantId(null);
  };

  // Local chat submission
  // Co-host control triggers (Mute, Pin, Remove)
  const handleParticipantMuteToggle = async (id: string, name: string) => {
    if (!currentRoom) return;
    const rid = roomDocId(currentRoom);
    const target = callParticipants.find(p => p.id === id);
    if (!target) return;
    const nextRestricted = !target.micRestricted;
    const updateData: any = {
      micRestricted: nextRestricted,
      mutedBy: nextRestricted ? getMyId() : null
    };
    if (nextRestricted) {
      updateData.micOn = false;
    }
    try {
      await updateDoc(doc(db, 'rooms', rid, 'participants', id), updateData);
      showToast(nextRestricted ? `Restricted mic for ${name}` : `Allowed unmute for ${name}`);
    } catch (e) {
      console.warn("Failed to toggle remote mic restriction in Firestore:", e);
    }
    setActiveMenuParticipantId(null);
  };


  const handleParticipantRemove = async (id: string, name: string) => {
    if (!currentRoom) return;
    const rid = roomDocId(currentRoom);
    try {
      await deleteDoc(doc(db, 'rooms', rid, 'participants', id));
      try {
        await deleteDoc(doc(db, 'rooms', rid, 'approvedUsers', id));
      } catch (err) {
        console.warn("Failed to remove participant from approvedUsers list:", err);
      }

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
    
    // Guard: Prevent modifying an existing admin role through standard cohost/member paths
    const targetPart = callParticipants.find(p => p.id === id);
    if (newRole !== 'host' && targetPart && targetPart.role === 'admin') {
      showToast("❌ Admin role cannot be modified.");
      setActiveMenuParticipantId(null);
      return;
    }

    try {
      if (newRole === 'host') {
        // Atomic Host Transfer Transaction
        await runTransaction(db, async (transaction) => {
          const targetRef = doc(db, 'rooms', rid, 'participants', id);
          const targetSnap = await transaction.get(targetRef);
          if (!targetSnap.exists()) {
            throw new Error("Target participant not found");
          }
          const targetData = targetSnap.data();
          const targetName = targetData.name || 'Participant';
          const targetRole = targetData.role || 'member';

          // Find current host to demote
          const currentHost = callParticipants.find(p => p.role === 'host' && p.id !== id);

          // Promote new host - Guard admin role
          if (targetRole !== 'admin') {
            transaction.update(targetRef, { role: 'host' });
          }

          // Demote old host to 'cohost' if exists - Guard admin role
          if (currentHost && currentHost.role !== 'admin') {
            const oldHostRef = doc(db, 'rooms', rid, 'participants', currentHost.id);
            transaction.update(oldHostRef, { role: 'cohost' });
          }

          // Update persistent approved list roles in transaction - Guard admin role
          if (targetRole !== 'admin') {
            const targetAppRef = doc(db, 'rooms', rid, 'approvedUsers', id);
            transaction.set(targetAppRef, { approvedAt: new Date().toISOString(), role: 'host' }, { merge: true });
          }
          
          if (currentHost && currentHost.role !== 'admin') {
            const oldAppRef = doc(db, 'rooms', rid, 'approvedUsers', currentHost.id);
            transaction.set(oldAppRef, { approvedAt: new Date().toISOString(), role: 'cohost' }, { merge: true });
          }

          // Update room currentHostId and currentHostName
          const roomRef = doc(db, 'rooms', rid);
          transaction.update(roomRef, {
            currentHostId: id,
            currentHostName: targetName
          });
        });
        showToast("Host role successfully transferred.");
      } else {
        // Standard role change
        await updateDoc(doc(db, 'rooms', rid, 'participants', id), { role: newRole });
        try {
          await setDoc(doc(db, 'rooms', rid, 'approvedUsers', id), {
            approvedAt: new Date().toISOString(),
            role: newRole
          }, { merge: true });
        } catch (e) {
          console.warn("Failed to update persistent role inside approvedUsers:", e);
        }
        showToast(`Updated role to ${newRole}`);
      }
    } catch (e: any) {
      console.warn("Failed to update role in Firestore:", e);
      showToast(`Failed to update role: ${e.message || e}`);
    }
    setActiveMenuParticipantId(null);
  };

  const handleParticipantCameraToggle = async (id: string, name: string) => {
    if (!currentRoom) return;
    const rid = roomDocId(currentRoom);
    const target = callParticipants.find(p => p.id === id);
    if (!target) return;
    
    const nextRestricted = !target.camRestricted;
    const updateData: any = {
      camRestricted: nextRestricted,
      camOffBy: nextRestricted ? getMyId() : null
    };
    if (nextRestricted) {
      updateData.camOn = false;
    }
    try {
      await updateDoc(doc(db, 'rooms', rid, 'participants', id), updateData);
      showToast(nextRestricted ? `Restricted camera for ${name}` : `Allowed camera for ${name}`);
    } catch (e) {
      console.warn("Failed to toggle remote camera restriction in Firestore:", e);
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
      setRooms(prev => prev.filter(r => r.id !== rid));

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



  const formatFriendlyCreationTimeDate = (createdAtStr?: string) => {
    if (!createdAtStr) return '';
    try {
      const d = new Date(createdAtStr);
      if (isNaN(d.getTime())) return '';
      const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `${dateStr} · ${timeStr}`;
    } catch (e) {
      return '';
    }
  };




  const getGalleryGridTemplate = (count: number) => {
    if (count <= 1) return { columns: '1fr', rows: '1fr' };
    if (count === 2) return { columns: 'repeat(2, 1fr)', rows: '1fr' };
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    return {
      columns: `repeat(${cols}, 1fr)`,
      rows: `repeat(${rows}, 1fr)`
    };
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

  const renderVotingUI = () => {
    const myId = getMyId();
    const myPresence = callParticipants.find(p => p.id === myId);
    const isHostOrAdmin = myPresence?.role === 'host' || myPresence?.role === 'cohost' || myPresence?.role === 'admin';
    const isVoteActive = currentRoom?.voteStatus === 'active';

    if (!isVoteActive) {
      if (!isHostOrAdmin) {
        return (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>
            <span style={{ fontSize: '32px', display: 'block', marginBottom: '12px' }}>🗳️</span>
            <strong>No active polls</strong>
            <p style={{ marginTop: '8px', fontSize: '11px', lineHeight: 1.4 }}>Waiting for a host or co-host to start a poll.</p>
          </div>
        );
      }

      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px' }}>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>
              Poll Question / Title
            </label>
            <input 
              type="text"
              className="room-input"
              value={voteQuestionInput}
              onChange={(e) => setVoteQuestionInput(e.target.value)}
              placeholder="e.g., Should we take a 5-min break?"
              style={{ width: '100%', padding: '8px 12px', fontSize: '13px', height: '36px' }}
            />
          </div>

          <div>
            <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>
              Poll Format
            </label>
            <div style={{ display: 'flex', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '2px', gap: '2px' }}>
              <button
                type="button"
                onClick={() => setVoteMode('yesno')}
                style={{
                  flex: 1,
                  padding: '6px 4px',
                  fontSize: '11px',
                  fontWeight: 700,
                  borderRadius: '6px',
                  border: voteMode === 'yesno' ? '1px solid color-mix(in srgb, var(--primary-color) 30%, transparent)' : '1px solid transparent',
                  backgroundColor: voteMode === 'yesno' ? 'color-mix(in srgb, var(--primary-color) 15%, transparent)' : 'transparent',
                  color: voteMode === 'yesno' ? 'var(--primary-color)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
              >
                Yes / No
              </button>
              <button
                type="button"
                onClick={() => setVoteMode('custom')}
                style={{
                  flex: 1,
                  padding: '6px 4px',
                  fontSize: '11px',
                  fontWeight: 700,
                  borderRadius: '6px',
                  border: voteMode === 'custom' ? '1px solid color-mix(in srgb, var(--primary-color) 30%, transparent)' : '1px solid transparent',
                  backgroundColor: voteMode === 'custom' ? 'color-mix(in srgb, var(--primary-color) 15%, transparent)' : 'transparent',
                  color: voteMode === 'custom' ? 'var(--primary-color)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
              >
                Custom Options
              </button>
            </div>
          </div>

          {voteMode === 'custom' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', display: 'block' }}>
                Options
              </label>
              {voteOptionsInputs.map((opt, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="text"
                    className="room-input"
                    value={opt}
                    onChange={(e) => {
                      const newOpts = [...voteOptionsInputs];
                      newOpts[idx] = e.target.value;
                      setVoteOptionsInputs(newOpts);
                    }}
                    placeholder={`Option ${idx + 1}`}
                    style={{ flex: 1, padding: '6px 10px', fontSize: '12px', height: '32px' }}
                  />
                  {voteOptionsInputs.length > 2 && (
                    <button
                      type="button"
                      onClick={() => {
                        setVoteOptionsInputs(voteOptionsInputs.filter((_, i) => i !== idx));
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#ef4444',
                        fontSize: '16px',
                        cursor: 'pointer',
                        padding: '4px'
                      }}
                      title="Remove option"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {voteOptionsInputs.length < 4 && (
                <button
                  type="button"
                  onClick={() => setVoteOptionsInputs([...voteOptionsInputs, ''])}
                  style={{
                    alignSelf: 'flex-start',
                    background: 'none',
                    border: '1px dashed var(--border-color)',
                    borderRadius: '4px',
                    padding: '4px 8px',
                    fontSize: '10px',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    marginTop: '4px'
                  }}
                >
                  + Add Option
                </button>
              )}
            </div>
          )}

          <button
            type="button"
            className="btn-signin"
            onClick={async () => {
              if (!voteQuestionInput.trim()) {
                showToast("Please enter a question.");
                return;
              }
              const options = voteMode === 'yesno' ? ['Yes', 'No'] : voteOptionsInputs.map(o => o.trim()).filter(Boolean);
              if (options.length < 2) {
                showToast("Please define at least 2 options.");
                return;
              }
              try {
                await updateDoc(doc(db, 'rooms', roomDocId(currentRoom!)), {
                  voteQuestion: voteQuestionInput.trim(),
                  voteCreatorId: myId,
                  voteCreatorName: myPresence?.name.replace(' (You)', '') || 'Participant',
                  voteStatus: 'active',
                  voteOptions: options,
                  voteResults: null
                });
                showToast("Poll started!");
              } catch (e) {
                console.error("Failed to start poll:", e);
                showToast("❌ Failed to start poll.");
              }
            }}
            style={{ width: '100%', marginTop: '8px', height: '36px' }}
          >
            Start Poll
          </button>
        </div>
      );
    }

    const options = currentRoom.voteOptions || [];
    const myVote = myPresence?.castVote;

    const totalVotesCount = callParticipants.filter(p => p.castVote && options.includes(p.castVote)).length;
    const tally: Record<string, number> = {};
    options.forEach(opt => {
      tally[opt] = callParticipants.filter(p => p.castVote === opt).length;
    });

    const isCreator = currentRoom.voteCreatorId === myId;
    const creatorStillInRoom = callParticipants.some(p => p.id === currentRoom.voteCreatorId);
    const canEnd = isCreator || (!creatorStillInRoom && isHostOrAdmin);

    const handleCastVote = async (opt: string) => {
      try {
        await updateMySharing({ castVote: opt });
        showToast(`Vote cast for: ${opt}`);
      } catch (e) {
        console.error("Failed to cast vote:", e);
      }
    };

    const handleEndVote = async () => {
      try {
        let text = `🗳️ **Poll Finished: "${currentRoom.voteQuestion}"**\n`;
        options.forEach(opt => {
          const count = tally[opt] || 0;
          const pct = totalVotesCount > 0 ? Math.round((count / totalVotesCount) * 100) : 0;
          text += `• **${opt}**: ${count} vote(s) (${pct}%)\n`;
        });
        text += `Total votes: ${totalVotesCount}`;

        await sendChatMessage(text);

        await updateDoc(doc(db, 'rooms', roomDocId(currentRoom!)), {
          voteQuestion: null,
          voteCreatorId: null,
          voteCreatorName: null,
          voteStatus: 'closed',
          voteOptions: null,
          voteResults: tally
        });

        setVoteQuestionInput('');
        setVoteOptionsInputs(['Option A', 'Option B']);
        setVoteMode('yesno');

        showToast("Poll ended & results posted!");
      } catch (e) {
        console.error("Failed to end poll:", e);
        showToast("❌ Failed to end poll.");
      }
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px' }}>
        <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.02)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
          <span style={{ fontSize: '10px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
            Active Poll by {currentRoom.voteCreatorName || 'Host'}
          </span>
          <span style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--text-primary)', lineHeight: 1.4 }}>
            {currentRoom.voteQuestion}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {options.map((opt) => {
            const isMyChoice = myVote === opt;
            const count = tally[opt] || 0;
            const percentage = totalVotesCount > 0 ? Math.round((count / totalVotesCount) * 100) : 0;

            return (
              <div key={opt} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <button
                  type="button"
                  onClick={() => handleCastVote(opt)}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: isMyChoice ? '1px solid var(--primary-color)' : '1px solid var(--border-color)',
                    backgroundColor: isMyChoice ? 'color-mix(in srgb, var(--primary-color) 15%, transparent)' : 'rgba(255, 255, 255, 0.01)',
                    color: isMyChoice ? 'var(--text-primary)' : 'var(--text-primary)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontSize: '12px',
                    fontWeight: isMyChoice ? 'bold' : 'normal',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    position: 'relative',
                    overflow: 'hidden',
                    zIndex: 1,
                    transition: 'all 0.2s ease'
                  }}
                >
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    bottom: 0,
                    width: `${percentage}%`,
                    backgroundColor: isMyChoice ? 'color-mix(in srgb, var(--primary-color) 10%, transparent)' : 'rgba(255, 255, 255, 0.02)',
                    zIndex: -1,
                    transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)'
                  }} />
                  <span style={{ flex: 1 }}>{opt}</span>
                  <span style={{ fontSize: '11px', color: isMyChoice ? 'var(--primary-color)' : 'var(--text-secondary)', fontWeight: 'bold' }}>
                    {count} ({percentage}%)
                  </span>
                </button>
              </div>
            );
          })}
        </div>

        <span style={{ fontSize: '10px', color: 'var(--text-secondary)', textAlign: 'center', display: 'block' }}>
          Total votes cast: {totalVotesCount} / {callParticipants.length}
        </span>

        {canEnd && (
          <button
            type="button"
            className="btn-signin"
            onClick={handleEndVote}
            style={{
              width: '100%',
              marginTop: '8px',
              height: '36px',
              backgroundColor: '#ef4444',
              borderColor: '#ef4444',
              color: '#ffffff'
            }}
          >
            {!isCreator ? 'Force End Poll (Fallback) 🗳️' : 'End Poll & Post Results 🗳️'}
          </button>
        )}
      </div>
    );
  };

  const renderRoomSettingsUI = () => {
    const myId = getMyId();
    const myPresence = callParticipants.find(p => p.id === myId);
    const isHostOrAdmin = myPresence?.role === 'host' || myPresence?.role === 'cohost' || myPresence?.role === 'admin';

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', padding: '4px 0' }}>
        {/* Room Topic Name setting */}
        <div style={{ paddingBottom: '16px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
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
              style={{ flex: 1, padding: '8px 12px', fontSize: '13px', height: '36px' }}
              placeholder="e.g. Algorithms Study Group"
            />
          </div>
          <span style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '6px', display: 'block' }}>Anyone can update the room topic/name.</span>
        </div>

        {/* Room Privacy Type setting */}
        <div style={{ paddingBottom: '16px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
          <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>Room Privacy Type</label>
          <div style={{
            display: 'flex',
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '2px',
            gap: '2px',
            width: '100%'
          }}>
            {(['public', 'public-ask', 'private'] as const).map(t => {
              const isActive = currentRoom?.type === t;
              const label = t === 'public' ? 'Public' : t === 'public-ask' ? 'Ask to Join' : 'Private';
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => handleChangeRoomType(t)}
                  style={{
                    flex: 1,
                    padding: '8px 4px',
                    fontSize: '11px',
                    fontWeight: 700,
                    borderRadius: '6px',
                    border: isActive ? '1px solid color-mix(in srgb, var(--primary-color) 30%, transparent)' : '1px solid transparent',
                    backgroundColor: isActive ? 'color-mix(in srgb, var(--primary-color) 15%, transparent)' : 'transparent',
                    color: isActive ? 'var(--primary-color)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    textAlign: 'center',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <span style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '6px', display: 'block' }}>Anyone can change room privacy in this room.</span>
        </div>

        {/* Max Participants setting (Host/Cohost/Admin only) */}
        {isHostOrAdmin && (
          <div style={{ paddingBottom: '16px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
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
                className="stepper-btn"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              </button>
              <input 
                type="number" 
                min="2"
                max="18"
                className="room-input"
                style={{ textAlign: 'center', width: '60px', padding: '0', height: '36px', fontSize: '13px', fontWeight: 'bold' }}
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
                  const nextVal = Math.min(18, val + 1);
                  setMaxPartInput(nextVal);
                  handleChangeMaxParticipants(nextVal);
                }}
                className="stepper-btn"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              </button>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Capacity cap (18 max)</span>
            </div>
            <span style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '6px', display: 'block' }}>
              Current active participants: {callParticipants.length}
            </span>
          </div>
        )}

        {/* Room Mode Toggle Section */}
        {currentRoom && (
          <div style={{ paddingBottom: roomJoinKey ? '16px' : '0', borderBottom: roomJoinKey ? '1px solid rgba(255, 255, 255, 0.05)' : 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div>
              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', display: 'block' }}>Room Mode</span>
              <span style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '4px', display: 'block' }}>
                {isHostOrAdmin ? 'Set study focus mode guidelines for all participants in this room.' : 'Only hosts or co-hosts can change the room mode.'}
              </span>
            </div>
            <div style={{
              display: 'flex',
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '2px',
              gap: '2px',
              width: '100%',
              opacity: isHostOrAdmin ? 1 : 0.6,
              pointerEvents: isHostOrAdmin ? 'auto' : 'none'
            }}>
              {(['chill', 'discuss', 'non-discuss'] as const).map(m => {
                const isActive = (currentRoom.roomMode || 'chill') === m;
                const label = m === 'chill' ? 'Chill Mode' : m === 'discuss' ? 'Focus Mode' : 'Ultra Focus Mode';
                const activeColor = m === 'chill' ? 'rgba(46, 204, 113, 0.15)' : m === 'discuss' ? 'color-mix(in srgb, var(--primary-color) 15%, transparent)' : 'rgba(239, 68, 68, 0.15)';
                const activeTextColor = m === 'chill' ? '#2ecc71' : m === 'discuss' ? 'var(--primary-color)' : '#ef4444';
                const activeBorder = m === 'chill' ? 'rgba(46, 204, 113, 0.3)' : m === 'discuss' ? 'color-mix(in srgb, var(--primary-color) 30%, transparent)' : 'rgba(239, 68, 68, 0.3)';

                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => handleSelectRoomMode(m)}
                    style={{
                      flex: 1,
                      padding: '8px 4px',
                      fontSize: '11px',
                      fontWeight: 700,
                      borderRadius: '6px',
                      border: isActive ? `1px solid ${activeBorder}` : '1px solid transparent',
                      backgroundColor: isActive ? activeColor : 'transparent',
                      color: isActive ? activeTextColor : 'var(--text-secondary)',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      textAlign: 'center',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Shareable Join Key display for Host/Cohost/Admin */}
        {isHostOrAdmin && roomJoinKey && currentRoom && (
          <div>
            <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>Invite Link with Secret Key</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input 
                type="text" 
                readOnly 
                value={`${window.location.origin}/room/${currentRoom.id}?key=${roomJoinKey}`}
                className="room-input"
                style={{ flex: 1, padding: '8px 12px', fontSize: '12px', height: '36px' }}
                onClick={(e) => e.currentTarget.select()}
              />
              <button 
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}/room/${currentRoom.id}?key=${roomJoinKey}`);
                  showToast("Invite link copied to clipboard!");
                }}
                className="btn-signin"
                style={{ padding: '0 16px', height: '36px', fontSize: '12px', whiteSpace: 'nowrap', borderRadius: 'var(--btn-radius)' }}
              >
                Copy
              </button>
            </div>
            <span style={{ fontSize: '9px', color: 'var(--text-secondary)', marginTop: '6px', display: 'block' }}>Anyone with this link will bypass the join approval flow.</span>
          </div>
        )}
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
        micBlockedUntil={micBlockedUntil}
      />,
      pipWindowInstance.document.body
    );
  };

  // Reflect Calculations
  const getStartOfWeekMondayDate = () => {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    return monday;
  };

  const getDisplayStreak = (currentStreak: number, lastActiveDate: string) => {
    if (!lastActiveDate) return 0;
    const todayStr = new Date().toLocaleDateString('en-CA');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toLocaleDateString('en-CA');

    if (lastActiveDate === todayStr || lastActiveDate === yesterdayStr) {
      return currentStreak;
    }
    return 0; // Missed a day!
  };

  const currentWeekMonday = getStartOfWeekMondayDate();
  const thisWeekLogs = sessionLogs.filter(log => {
    if (!log.joinedAt) return false;
    const logDate = new Date(log.joinedAt);
    return logDate >= currentWeekMonday;
  });

  const totalTimeThisWeek = thisWeekLogs.reduce((acc, log) => acc + (log.durationMinutes || 0), 0);
  const sessionsCountThisWeek = thisWeekLogs.length;

  return (
    <div className="app-container">
      {/* Global Background Theme Overlay */}
      {activeTheme && activeTheme !== 'default' && (
        <>
          <div 
            style={{
              position: 'fixed',
              top: 0, left: 0,
              width: '100vw', height: '100vh',
              backgroundImage: `url(${THEME_PRESETS.find(p => p.key === activeTheme)?.imageUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
              backgroundAttachment: 'fixed',
              zIndex: -2,
              pointerEvents: 'none'
            }}
          />
          <div 
            style={{
              position: 'fixed',
              top: 0, left: 0,
              width: '100vw', height: '100vh',
              backgroundColor: 'rgba(10, 11, 14, 0.65)',
              backgroundImage: 'radial-gradient(circle at center, transparent 30%, rgba(10, 11, 14, 0.85) 100%)',
              zIndex: -1,
              pointerEvents: 'none'
            }}
          />
        </>
      )}
      
      <Routes>
        <Route path="/" element={
          <>
            {/* Header (top bar) */}
          <header className="header">
            <a href="/" className="logo-container">
              <img src="/logo.png" alt="Skulk Logo" style={{ width: '32px', height: '32px', objectFit: 'contain', borderRadius: '4px' }} />
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

              {/* Theme Trigger Button */}
              <button 
                onClick={() => setIsThemeModalOpen(true)} 
                className="theme-picker-btn" 
                aria-label="Theme settings"
                title="Select background theme"
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
                        onClick={() => {
                          setIsThemeModalOpen(true);
                          setIsUserDropdownOpen(false);
                        }} 
                        className="theme-item-btn"
                        style={{ width: '100%', textAlign: 'left', padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                      >
                        🎨 App Themes
                      </button>
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

          <div className="tabs-container">
            <button 
              onClick={() => setActiveTab('rooms')} 
              className={`tab-btn ${activeTab === 'rooms' ? 'active' : ''}`}
            >
              Rooms
            </button>
            {user && (
              <>
                <button 
                  onClick={() => setActiveTab('reflect')} 
                  className={`tab-btn ${activeTab === 'reflect' ? 'active' : ''}`}
                >
                  Reflect
                </button>
                <button 
                  onClick={() => setActiveTab('dm')} 
                  className={`tab-btn ${activeTab === 'dm' ? 'active' : ''}`}
                  style={{ position: 'relative' }}
                >
                  DM
                  {activeTab !== 'dm' && unreadDmCount > 0 && (
                    <span className="tab-unread-dot dm-dot" />
                  )}
                </button>
              </>
            )}
            <button 
              onClick={() => setActiveTab('community')} 
              className={`tab-btn ${activeTab === 'community' ? 'active' : ''}`}
            >
              Community
            </button>
          </div>

          {/* Rooms Tab Content */}
          {activeTab === 'rooms' ? (
            <div style={{ width: '100%' }}>
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
                  const rawParticipants = roomsParticipants[room.id] || [];
                  const currentRoomParticipants = [...rawParticipants].sort((a, b) => {
                    const aIsAdmin = a.role === 'admin';
                    const bIsAdmin = b.role === 'admin';
                    if (aIsAdmin && !bIsAdmin) return -1;
                    if (!aIsAdmin && bIsAdmin) return 1;

                    const aIsHost = a.role === 'host';
                    const bIsHost = b.role === 'host';
                    if (aIsHost && !bIsHost) return -1;
                    if (!aIsHost && bIsHost) return 1;

                    const aTime = a.joinedAt ? new Date(a.joinedAt).getTime() : Infinity;
                    const bTime = b.joinedAt ? new Date(b.joinedAt).getTime() : Infinity;
                    return aTime - bTime;
                  });
                  const myId = getMyId();
                  const isAdminUser = !!(user && user.email && ['fijakhan7127@gmail.com', '000fijakhan123@gmail.com'].includes(user.email.toLowerCase()));
                  const isAlreadyInRoom = currentRoomParticipants.some(p => p.uid === myId || p.id === myId);
                  const isRoomFull = currentRoomParticipants.length >= (room.maxParticipants || 10) && !isAdminUser && !isAlreadyInRoom;
                  const currentHostId = room.currentHostId || room.creatorId;
                  const isCreatorAdmin = (room.creatorId === '8OWnkdRLf5XuSmeZB6AQv1VvYyf2') || 
                                         (room.creatorEmail && ['fijakhan7127@gmail.com', '000fijakhan123@gmail.com'].includes(room.creatorEmail.toLowerCase())) ||
                                         (room.creatorId === getMyId() && isUserAdmin(user));
                  const isCurrentHostAdmin = (currentHostId === '8OWnkdRLf5XuSmeZB6AQv1VvYyf2') ||
                                             (currentHostId === room.creatorId && isCreatorAdmin) ||
                                             currentRoomParticipants.some(p => (p.uid === currentHostId || p.id === currentHostId) && p.role === 'admin');
                  const hostLabel = isCurrentHostAdmin ? 'Admin' : (room.currentHostName || room.creatorName || 'Unknown');
                  
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
                                    style={{ objectFit: 'cover', border: '1px solid var(--border-color)', cursor: 'pointer' }}
                                    referrerPolicy="no-referrer"
                                    onClick={() => {
                                      handleOpenProfile({
                                        id: participant.uid || participant.id,
                                        name: participant.name.replace(' (You)', ''),
                                        initials: participant.initials,
                                        color: participant.color || '#3b82f6',
                                        photoURL: participant.photoURL
                                      }, 'card');
                                    }}
                                  />
                                ) : (
                                  <div 
                                    key={index} 
                                    className="avatar-slot avatar-filled"
                                    style={{ backgroundColor: participant.color || '#8b5cf6', cursor: 'pointer' }}
                                    onClick={() => {
                                      handleOpenProfile({
                                        id: participant.uid || participant.id,
                                        name: participant.name.replace(' (You)', ''),
                                        initials: participant.initials,
                                        color: participant.color || '#8b5cf6',
                                        photoURL: null
                                      }, 'card');
                                    }}
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
                                      style={{ objectFit: 'cover', border: '1px solid var(--border-color)', cursor: 'pointer' }}
                                      referrerPolicy="no-referrer"
                                      onClick={() => {
                                        handleOpenProfile({
                                          id: participant.uid || participant.id,
                                          name: participant.name.replace(' (You)', ''),
                                          initials: participant.initials,
                                          color: participant.color || '#3b82f6',
                                          photoURL: participant.photoURL
                                        }, 'card');
                                      }}
                                    />
                                  ) : (
                                    <div 
                                      key={index} 
                                      className="avatar-slot avatar-filled"
                                      style={{ backgroundColor: participant.color || '#8b5cf6', cursor: 'pointer' }}
                                      onClick={() => {
                                        handleOpenProfile({
                                          id: participant.uid || participant.id,
                                          name: participant.name.replace(' (You)', ''),
                                          initials: participant.initials,
                                          color: participant.color || '#8b5cf6',
                                          photoURL: null
                                        }, 'card');
                                      }}
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
                      <div className="room-footer" style={{ justifyContent: 'space-between' }}>
                        {room.createdAt ? (
                          <span style={{ fontSize: '11px', color: 'var(--text-secondary, #94a3b8)', opacity: 0.8 }}>
                            {formatFriendlyCreationTimeDate(room.createdAt)}
                          </span>
                        ) : (
                          <div></div>
                        )}
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
          ) : activeTab === 'reflect' ? (
            user ? (
              <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '32px', maxWidth: '800px', margin: '0 auto', paddingBottom: '48px', width: '100%' }}>
                
                {/* Profile Header Card */}
                <div className="profile-header-card" style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '24px',
                  backgroundColor: 'var(--panel-bg)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--border-radius)',
                  gap: '20px',
                  flexWrap: 'wrap'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                    {user.photoURL ? (
                      <img 
                        src={user.photoURL} 
                        alt={user.displayName || 'User'} 
                        style={{ width: '64px', height: '64px', borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--primary-color)' }}
                      />
                    ) : (
                      <div style={{
                        width: '64px',
                        height: '64px',
                        borderRadius: '50%',
                        backgroundColor: guestColor || '#8b5cf6',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '24px',
                        fontWeight: 700,
                        color: '#ffffff',
                        border: '2px solid var(--primary-color)'
                      }}>
                        {guestInitials || (user.displayName ? user.displayName.substring(0, 2).toUpperCase() : 'G')}
                      </div>
                    )}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <h2 style={{ fontSize: '20px', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                          {user.displayName || 'Google User'}
                        </h2>
                      </div>
                      <span style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>Weekly Self-Reflection</span>
                      
                      <div style={{ display: 'flex', gap: '16px', marginTop: '6px' }}>
                        <div 
                          onClick={() => handleOpenProfile({
                            id: user.uid,
                            name: user.displayName || 'Google User',
                            initials: guestInitials || (user.displayName ? user.displayName.substring(0, 2).toUpperCase() : 'G'),
                            color: guestColor || '#8b5cf6',
                            photoURL: user.photoURL || null
                          }, 'connections')}
                          style={{ display: 'flex', flexDirection: 'column', cursor: 'pointer' }}
                        >
                          <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)', lineHeight: '1.2' }}>{connectionsCount}</span>
                          <span style={{ fontSize: '9px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Connections</span>
                        </div>
                        <div 
                          onClick={() => handleOpenProfile({
                            id: user.uid,
                            name: user.displayName || 'Google User',
                            initials: guestInitials || (user.displayName ? user.displayName.substring(0, 2).toUpperCase() : 'G'),
                            color: guestColor || '#8b5cf6',
                            photoURL: user.photoURL || null
                          }, 'followers')}
                          style={{ display: 'flex', flexDirection: 'column', cursor: 'pointer' }}
                        >
                          <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)', lineHeight: '1.2' }}>{followersCount}</span>
                          <span style={{ fontSize: '9px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Followers</span>
                        </div>
                        <div 
                          onClick={() => handleOpenProfile({
                            id: user.uid,
                            name: user.displayName || 'Google User',
                            initials: guestInitials || (user.displayName ? user.displayName.substring(0, 2).toUpperCase() : 'G'),
                            color: guestColor || '#8b5cf6',
                            photoURL: user.photoURL || null
                          }, 'following')}
                          style={{ display: 'flex', flexDirection: 'column', cursor: 'pointer' }}
                        >
                          <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)', lineHeight: '1.2' }}>{followingCount}</span>
                          <span style={{ fontSize: '9px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Following</span>
                        </div>
                      </div>

                      {/* Bio Edit Section */}
                      <div style={{ marginTop: '16px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '12px', minWidth: '240px' }}>
                        {isEditingBio ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <textarea
                              value={bioInput}
                              onChange={(e) => setBioInput(e.target.value)}
                              maxLength={160}
                              placeholder="Tell others about yourself..."
                              className="search-input"
                              style={{
                                width: '100%',
                                minHeight: '60px',
                                fontSize: '13px',
                                padding: '8px 12px',
                                backgroundColor: 'var(--input-bg, #1a1c23)',
                                border: '1px solid var(--border-color)',
                                borderRadius: '6px',
                                color: 'var(--text-primary)',
                                outline: 'none',
                                resize: 'none'
                              }}
                            />
                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                              <button
                                onClick={() => {
                                  setIsEditingBio(false);
                                  setBioInput(userDataState?.bio || '');
                                }}
                                className="btn-signin"
                                style={{ padding: '4px 10px', fontSize: '12px', borderRadius: '4px' }}
                              >
                                Cancel
                              </button>
                              <button
                                onClick={async () => {
                                  if (user) {
                                    try {
                                      const userRef = doc(db, 'users', user.uid);
                                      await setDoc(userRef, { bio: bioInput }, { merge: true });
                                      setIsEditingBio(false);
                                      showToast("Bio updated successfully!");
                                    } catch (e) {
                                      console.error("Failed to update bio:", e);
                                      showToast("Failed to update bio.");
                                    }
                                  }
                                }}
                                className="btn-create"
                                style={{ padding: '4px 10px', fontSize: '12px', borderRadius: '4px' }}
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
                            <p style={{
                              fontSize: '13px',
                              color: userDataState?.bio ? 'var(--text-primary)' : 'var(--text-secondary)',
                              fontStyle: userDataState?.bio ? 'normal' : 'italic',
                              margin: 0,
                              flexGrow: 1,
                              wordBreak: 'break-word',
                              lineHeight: '1.4'
                            }}>
                              {userDataState?.bio || "No bio added yet."}
                            </p>
                            <button
                              onClick={() => {
                                setBioInput(userDataState?.bio || '');
                                setIsEditingBio(true);
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--primary-color)',
                                fontSize: '12px',
                                cursor: 'pointer',
                                padding: '4px',
                                fontWeight: 'bold',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              ✏️ Edit Bio
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Streak Badge */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    backgroundColor: 'rgba(245, 158, 11, 0.08)',
                    border: '1px solid rgba(245, 158, 11, 0.2)',
                    borderRadius: '12px',
                    padding: '12px 20px'
                  }}>
                    <div style={{ fontSize: '28px' }}>🔥</div>
                    <div>
                      <div style={{ fontSize: '18px', fontWeight: 800, color: '#f59e0b', margin: 0 }}>
                        {getDisplayStreak(userDataState?.currentStreak || 0, userDataState?.lastActiveDate || '')} Day Streak
                      </div>
                      <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                        {userDataState?.lastActiveDate ? `Last active: ${userDataState.lastActiveDate}` : 'No activity logged yet'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Weekly Stats Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
                  
                  {/* Time Spent Card */}
                  <div style={{
                    backgroundColor: 'var(--panel-bg)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--border-radius)',
                    padding: '24px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                  }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Time Spent</span>
                    <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--primary-color)' }}>
                      {totalTimeThisWeek} <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-secondary)' }}>mins</span>
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Across all rooms this week</span>
                  </div>

                  {/* Targets Completed Card */}
                  <div style={{
                    backgroundColor: 'var(--panel-bg)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--border-radius)',
                    padding: '24px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                  }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Targets Completed</span>
                    <div style={{ fontSize: '32px', fontWeight: 800, color: '#10b981' }}>
                      {targetsList.filter(t => t.completed).length} / {targetsList.length}
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Weekly session targets completed</span>
                  </div>

                  {/* Sessions Attended Card */}
                  <div style={{
                    backgroundColor: 'var(--panel-bg)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--border-radius)',
                    padding: '24px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                  }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sessions Attended</span>
                    <div style={{ fontSize: '32px', fontWeight: 800, color: '#3b82f6' }}>
                      {sessionsCountThisWeek}
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Distinct calls joined this week</span>
                  </div>

                </div>

                {/* Target Sessions Checklist Widget */}
                <div className="targets-widget-container animate-fade-in" style={{
                  backgroundColor: 'var(--panel-bg)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--border-radius)',
                  padding: '24px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px'
                }}>
                  <div style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '12px' }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 800, margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--primary-color)' }}>
                        <polyline points="9 11 12 14 22 4"></polyline>
                        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
                      </svg>
                      Target Sessions
                    </h3>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Weekly checklist and progress tracker</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>This week's targets</span>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--primary-color)' }}>
                      {targetsList.filter(t => t.completed).length} / {targetsList.length} done
                    </span>
                  </div>

                  {/* List of items */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '240px', overflowY: 'auto', paddingRight: '4px' }}>
                    {targetsList.map(item => (
                      <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px', color: item.completed ? 'var(--text-secondary)' : 'var(--text-primary)', padding: '6px 8px', borderRadius: '6px', backgroundColor: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.02)' }}>
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
                        <span style={{ textDecoration: item.completed ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.text}
                        </span>
                      </label>
                    ))}
                    {targetsList.length === 0 && (
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontStyle: 'italic', textAlign: 'center', display: 'block', padding: '20px 0' }}>
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
                      style={{ paddingLeft: '12px', fontSize: '13px', height: '36px', flex: 1 }}
                      value={targetInputText}
                      onChange={(e) => setTargetInputText(e.target.value)}
                      required
                    />
                    <button type="submit" className="btn-signin" style={{ width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0 }}>
                      +
                    </button>
                  </form>

                  {/* Progress History strip */}
                  <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '16px', marginTop: '4px' }}>
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
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '10px' }}>
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
                      {targetsHistory.length === 0 && (
                        <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontStyle: 'italic', gridColumn: '1 / -1' }}>No progress history yet.</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Sessions Details List */}
                <div style={{
                  backgroundColor: 'var(--panel-bg)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--border-radius)',
                  padding: '24px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px'
                }}>
                  <div>
                    <h3 style={{ fontSize: '16px', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>Session History (This Week)</h3>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Detail log of calls joined or hosted since Monday</span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {thisWeekLogs.map((log) => {
                      const localDate = new Date(log.joinedAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                      return (
                        <div key={log.id} style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '12px 16px',
                          backgroundColor: 'rgba(255,255,255,0.01)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '8px'
                        }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>{log.roomName}</span>
                            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{localDate} • Role: {log.role}</span>
                          </div>
                          <div style={{
                            fontSize: '13px',
                            fontWeight: 700,
                            color: 'var(--text-secondary)',
                            backgroundColor: 'rgba(255,255,255,0.02)',
                            padding: '4px 10px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)'
                          }}>
                            {log.durationMinutes} min{log.durationMinutes !== 1 ? 's' : ''}
                          </div>
                        </div>
                      );
                    })}
                    {thisWeekLogs.length === 0 && (
                      <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-secondary)', fontSize: '13px', fontStyle: 'italic' }}>
                        No sessions recorded for this week yet.
                      </div>
                    )}
                  </div>
                </div>

              </div>
            ) : (
              <div className="placeholder-container">
                <p>Please sign in to view your Reflect stats.</p>
              </div>
            )
          ) : activeTab === 'dm' ? (
            user ? (
              <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '32px', maxWidth: '800px', margin: '0 auto', paddingBottom: '48px', width: '100%', height: 'calc(100vh - 240px)' }}>
                <DMPanel
                  user={user}
                  dmThreads={dmThreads}
                  communityUsers={communityUsers}
                  followingUserIds={followingUserIds}
                  followerUserIds={followerUserIds}
                  showToast={showToast}
                  targetsList={targetsList}
                  userDataState={userDataState}
                />
              </div>
            ) : (
              <div className="placeholder-container">
                <p>Please sign in to view your direct messages.</p>
              </div>
            )
          ) : (
            /* Community Tab Content */
            <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '800px', margin: '0 auto', paddingBottom: '48px', width: '100%' }}>
              <div>
                <h2 style={{ fontSize: '24px', fontWeight: 800, margin: '0 0 8px', color: 'var(--text-primary)' }}>Community Directory</h2>
                <p style={{ fontSize: '14px', color: 'var(--text-secondary)', margin: 0 }}>Discover other learners and follow their weekly progress.</p>
              </div>

              {user ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                  {communityUsers.map((u) => {
                    const isFollowing = followingUserIds.includes(u.id);
                    const userInitials = u.displayName ? u.displayName.substring(0, 2).toUpperCase() : 'U';
                    return (
                      <div key={u.id} style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '16px',
                        backgroundColor: 'var(--panel-bg)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 'var(--border-radius)',
                        gap: '12px'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          {u.photoURL ? (
                            <img 
                              src={u.photoURL} 
                              alt={u.displayName || 'User'} 
                              style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--border-color)' }}
                            />
                          ) : (
                            <div style={{
                              width: '40px',
                              height: '40px',
                              borderRadius: '50%',
                              backgroundColor: '#8b5cf6',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '14px',
                              fontWeight: 700,
                              color: '#ffffff'
                            }}>
                              {userInitials}
                            </div>
                          )}
                          <div>
                            <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>{u.displayName || 'Google User'}</div>
                            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Member</span>
                          </div>
                        </div>

                        <button
                          onClick={() => handleToggleFollow(u.id)}
                          className="btn-signin"
                          style={{
                            padding: '6px 12px',
                            fontSize: '12px',
                            height: 'auto',
                            width: 'auto',
                            backgroundColor: isFollowing ? 'transparent' : 'var(--primary-color)',
                            color: isFollowing ? 'var(--text-secondary)' : 'var(--primary-text)',
                            border: isFollowing ? '1px solid var(--border-color)' : 'none',
                            cursor: 'pointer',
                            borderRadius: '6px',
                            fontWeight: 700
                          }}
                        >
                          {isFollowing ? 'Following' : 'Follow'}
                        </button>
                      </div>
                    );
                  })}
                  {communityUsers.length === 0 && (
                    <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '48px', color: 'var(--text-secondary)', fontSize: '14px', fontStyle: 'italic' }}>
                      No other users found in the directory yet.
                    </div>
                  )}
                </div>
              ) : (
                <div className="placeholder-container" style={{ padding: '48px' }}>
                  <p style={{ color: 'var(--text-secondary)' }}>Please sign in to view and follow community members.</p>
                </div>
              )}
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
              token={activeLkToken || undefined}
              serverUrl={stableServerUrl}
              audio={false}
              video={false}
              options={liveKitRoomOptions}
              onConnected={() => {
                setLkConnectStatus('connected');
                setLkRetryCount(0);
              }}
              onDisconnected={() => {
                setLkConnectStatus('disconnected');
                // Skip if user intentionally clicked "Leave Room" or if room/token is already cleared
                if (!liveKitToken || !currentRoom) return;

                console.warn("Unexpected terminal disconnection from LiveKit. Scheduling retry...");
                setActiveLkToken(null); // Unmount current connection to allow retry/remount
                setLkConnectStatus('error'); // Trigger the custom retry backoff useEffect
              }}
              onError={(err) => {
                console.error("LiveKit connection error event:", err);
                setLkConnectStatus('error');
                // Do NOT set activeLkToken to null here. Allow SDK internal reconnects/failovers.
              }}
              style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', width: '100%', overflow: 'hidden' }}
            >
            {lkConnectStatus === 'error' && lkRetryCount >= 10 ? (
              <div className="call-layout animate-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, backgroundColor: 'var(--bg-color)', color: 'var(--text-primary)', gap: '20px', padding: '24px', textAlign: 'center' }}>
                <div style={{ maxWidth: '400px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                  <div style={{ fontSize: '48px' }}>⚠️</div>
                  <h3 style={{ fontSize: '20px', fontWeight: 'bold', margin: 0 }}>Connection Failed</h3>
                  <p style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
                    Could not establish a connection to the audio/video server. Please check your network connection and try again.
                  </p>
                  <button
                    onClick={() => {
                      setLkRetryCount(0);
                      setLkConnectStatus('connecting');
                      setActiveLkToken(liveKitToken);
                    }}
                    className="btn-create"
                    style={{ padding: '10px 24px', fontSize: '14px', marginTop: '8px' }}
                  >
                    Retry Connection
                  </button>
                  <button
                    onClick={handleLeaveCall}
                    className="btn-signin"
                    style={{ padding: '8px 20px', fontSize: '13px', marginTop: '4px' }}
                  >
                    Exit Room
                  </button>
                </div>
              </div>
            ) : (
              <>
                <DeviceRecoveryManager 
                  isCamOff={isCamOff} 
                  isMicMuted={isMicMuted} 
                  onErrorChange={(cam, mic) => {
                    if (cameraError !== cam) setCameraError(cam);
                    if (micError !== mic) setMicError(mic);
                  }} 
                />
                {activeLkToken && <RoomAudioRenderer />}
                {activeLkToken && <LocalSpeakerTracker onSpeakingChange={(speaking) => { isLocalSpeakingRef.current = speaking; }} />}
                {activeLkToken && <LocalScreenShareLinker screenShareStream={screenShareStream} />}
            
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
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden', position: 'relative' }}>
                {/* Call Content Area */}

          {/* Dynamic Connection Status Alert Banner */}
          {lkConnectStatus !== 'connected' && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: lkConnectStatus === 'error' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(241, 196, 15, 0.15)',
              borderBottom: `1px solid ${lkConnectStatus === 'error' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(241, 196, 15, 0.2)'}`,
              padding: '8px 16px',
              fontSize: '13px',
              color: lkConnectStatus === 'error' ? '#f87171' : 'var(--primary-color)',
              gap: '12px',
              zIndex: 90
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {lkConnectStatus === 'error' ? (
                  <span>⚠️ <strong>Audio/Video Connection Failed</strong> (Attempt {lkRetryCount}/10)</span>
                ) : (
                  <>
                    <div style={{
                      width: '12px',
                      height: '12px',
                      borderRadius: '50%',
                      border: '2px solid currentColor',
                      borderTopColor: 'transparent',
                      animation: 'spin 1s linear infinite',
                      display: 'inline-block',
                      flexShrink: 0
                    }} />
                    <span>Connecting to audio/video streaming... (You can still chat and use tools)</span>
                  </>
                )}
              </div>
              {lkConnectStatus === 'error' && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button 
                    onClick={() => {
                      setLkRetryCount(0);
                      setLkConnectStatus('connecting');
                      setActiveLkToken(liveKitToken);
                    }}
                    style={{
                      background: 'rgba(239, 68, 68, 0.2)',
                      color: '#ffffff',
                      border: 'none',
                      padding: '4px 10px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    Retry
                  </button>
                  <button 
                    onClick={handleLeaveCall}
                    style={{
                      background: 'rgba(255,255,255,0.08)',
                      color: '#ffffff',
                      border: 'none',
                      padding: '4px 10px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      cursor: 'pointer'
                    }}
                  >
                    Leave
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Call Body */}
          <div className="call-main-content">
            
            {/* Call Main Stage (Left) */}
            <div className="call-stage" style={expandedTool !== 'none' || viewingShare ? { padding: 0, alignItems: 'stretch', justifyContent: 'stretch' } : undefined}>
              {pendingRequests.length > 0 && (
                <div 
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    border: '1px solid rgba(59, 130, 246, 0.25)',
                    borderRadius: '8px',
                    width: 'calc(100% - 32px)',
                    margin: '16px auto 0 auto',
                    padding: '12px 16px',
                    zIndex: 60,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    flexShrink: 0,
                    boxSizing: 'border-box'
                  }}
                  className="animate-fade-in"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '16px' }}>🔔</span>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                      Pending Join Requests ({pendingRequests.length})
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {pendingRequests.map((req) => (
                      <div key={req.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--card-bg, #1a1c23)', padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{ backgroundColor: req.color || '#3b82f6', width: '24px', height: '24px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 'bold', color: '#fff' }}>
                            {req.initials || 'P'}
                          </div>
                          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>{req.name}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button onClick={() => handleApproveRequest(req)} className="btn-create" style={{ padding: '3px 8px', fontSize: '11px', borderRadius: '4px' }}>
                            Accept
                          </button>
                          <button onClick={() => handleDenyRequest(req)} className="btn-signin" style={{ padding: '3px 8px', fontSize: '11px', borderRadius: '4px', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.2)', color: '#ef4444' }}>
                            Deny
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {expandedTool !== 'none' ? (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', flex: 1 }}>
                  <div className="expanded-tool-stage-wrapper animate-fade-in" style={{
                    display: 'flex',
                    flexDirection: 'column',
                    flex: 1,
                    backgroundColor: 'var(--card-bg)',
                    borderRadius: 0,
                    border: 'none',
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
                    <div style={{ flex: 1, padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
                      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
                        {expandedTool === 'pomodoro' && renderPomodoroUI(true)}
                        {expandedTool === 'deadline' && renderDeadlineUI(true)}
                        {expandedTool === 'loose' && renderLooseTimerUI(true)}
                        {expandedTool === 'truthordare' && (
                          <TruthOrDareUI
                            isExpanded={true}
                            myId={getMyId()}
                            callParticipants={callParticipants}
                            todActiveIds={todActiveIds}
                            todPendingIds={todPendingIds}
                            todSelectedId={todSelectedId}
                            todChoice={todChoice}
                            todText={todText}
                            todState={todState}
                            todSpinResult={todSpinResult}
                            todLocalSpinning={todLocalSpinning}
                            todSpinPool={todSpinPool}
                            handleSpinTruthOrDare={handleSpinTruthOrDare}
                            handleSelectTodChoice={handleSelectTodChoice}
                            handleResetTod={handleResetTod}
                            handleJoinTodGame={handleJoinTodGame}
                            handleLeaveTodGame={handleLeaveTodGame}
                          />
                        )}
                        {expandedTool === 'spin' && (
                          <SpinWheelUI
                            isExpanded={true}
                            myId={getMyId()}
                            callParticipants={callParticipants}
                            spinCheckedIds={spinCheckedIds}
                            spinPool={spinPool}
                            spinResult={spinResult}
                            spinLocalSpinning={spinLocalSpinning}
                            handleSpinWheel={handleSpinWheel}
                            handleToggleSpinCheckedParticipant={handleToggleSpinCheckedParticipant}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {/* Bottom Participant Strip */}
                  <div className="bottom-reflow-strip" style={{
                    display: 'flex',
                    flexDirection: 'row',
                    gap: '12px',
                    overflowX: 'auto',
                    overflowY: 'hidden',
                    padding: '8px 12px',
                    height: '84px',
                    minHeight: '84px',
                    width: '100%',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'transparent',
                    border: 'none',
                    scrollbarWidth: 'none',
                    boxSizing: 'border-box'
                  }}>
                    {callParticipants.map((p) => (
                      <ParticipantTile
                        key={p.id}
                        p={p}
                        isThumbnail={true}
                        myId={getMyId()}
                        isMicMuted={isMicMuted}
                        isCamOff={isCamOff}
                        cameraError={cameraError}
                        spotlightParticipantId={spotlightParticipantId}
                        setSpotlightParticipantId={setSpotlightParticipantId}
                        handleViewParticipantShare={handleViewParticipantShare}
                        isGalleryView={isGalleryView}
                        activeMenuParticipantId={activeMenuParticipantId}
                        setActiveMenuParticipantId={setActiveMenuParticipantId}
                        callParticipants={callParticipants}
                        checkCanMute={checkCanMute}
                        handleParticipantMuteToggle={handleParticipantMuteToggle}
                        handleParticipantCameraToggle={handleParticipantCameraToggle}
                        handleParticipantRoleChange={handleParticipantRoleChange}
                        checkCanKick={checkCanKick}
                        handleParticipantRemove={handleParticipantRemove}
                        handleOpenProfile={handleOpenProfile}
                        handleClearParticipantChat={handleClearParticipantChat}
                      />
                    ))}
                  </div>
                </div>
              ) : viewingShare ? (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', flex: 1 }}>
                  <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                    {viewingShare.type === 'whiteboard' ? (
                      <WhiteboardView
                        roomId={roomDocId(currentRoom!)}
                        viewingShare={viewingShare}
                        setViewingShare={setViewingShare}
                        myId={getMyId()}
                        callParticipants={callParticipants}
                        updateMySharing={updateMySharing}
                        clearMySharing={clearMySharing}
                        showToast={showToast}
                      />
                    ) : (
                      <div className="screenshare-stage-layout animate-fade-in" style={{ height: '100%', gap: 0 }}>
                        <div className="screenshare-video-wrapper" style={{ border: 'none', borderRadius: 0 }}>
                          {viewingShare.type === 'screen' ? (
                            <ScreenShareVideo participantId={viewingShare.participantId} />
                          ) : viewingShare.type === 'youtube' && viewingShare.youtubeVideoId ? (
                              <UniversalVideoPlayer
                                videoId={parseMediaUrl(viewingShare.youtubeVideoId)?.videoId || ""}
                                platform={parseMediaUrl(viewingShare.youtubeVideoId)?.platform || "youtube"}
                                isLive={parseMediaUrl(viewingShare.youtubeVideoId)?.isLive ?? false}
                                isPresenter={viewingShare.participantId === getMyId()}
                                presenterId={viewingShare.participantId}
                                roomId={roomDocId(currentRoom!)}
                                myId={getMyId()}
                                participants={callParticipants}
                              />
                            ) : viewingShare.type === 'spotify' && viewingShare.youtubeVideoId ? (
                              <SpotifyPlayer
                                spotifyUri={(() => {
                                  let clean = (viewingShare.youtubeVideoId || '').trim();
                                  if (clean.includes('open.spotify.com')) {
                                    if (!clean.includes('/embed/')) {
                                      clean = clean.replace('open.spotify.com/', 'open.spotify.com/embed/');
                                    }
                                  }
                                  return clean;
                                })()}
                                isPresenter={viewingShare.participantId === getMyId()}
                                presenterId={viewingShare.participantId}
                                roomId={roomDocId(currentRoom!)}
                                myId={getMyId()}
                              />
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
                                } else if (viewingShare.type === 'spotify') {
                                  setSpotifyUri(null);
                                  await clearMySharing();
                                  setViewingShare(null);
                                  showToast('Spotify sharing stopped');
                                }
                              } else {
                                setViewingShare(null);
                              }
                            }} 
                            className="btn-create" 
                            style={{ position: 'absolute', top: '12px', left: '50%', transform: 'translateX(-50%)', padding: '6px 12px', fontSize: '12px', backgroundColor: '#ef4444', borderColor: '#ef4444', color: '#ffffff', zIndex: 100, transition: 'all 0.2s ease' }}
                          >
                            {viewingShare.participantId === getMyId() ? 'Stop sharing' : 'Close view'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* Bottom Participant Strip */}
                  <div className="bottom-reflow-strip" style={{
                    display: 'flex',
                    flexDirection: 'row',
                    gap: '12px',
                    overflowX: 'auto',
                    overflowY: 'hidden',
                    padding: '8px 12px',
                    height: '84px',
                    minHeight: '84px',
                    width: '100%',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'transparent',
                    border: 'none',
                    scrollbarWidth: 'none',
                    boxSizing: 'border-box'
                  }}>
                    {callParticipants.map((p) => (
                      <ParticipantTile
                        key={p.id}
                        p={p}
                        isThumbnail={true}
                        myId={getMyId()}
                        isMicMuted={isMicMuted}
                        isCamOff={isCamOff}
                        cameraError={cameraError}
                        spotlightParticipantId={spotlightParticipantId}
                        setSpotlightParticipantId={setSpotlightParticipantId}
                        handleViewParticipantShare={handleViewParticipantShare}
                        isGalleryView={isGalleryView}
                        activeMenuParticipantId={activeMenuParticipantId}
                        setActiveMenuParticipantId={setActiveMenuParticipantId}
                        callParticipants={callParticipants}
                        checkCanMute={checkCanMute}
                        handleParticipantMuteToggle={handleParticipantMuteToggle}
                        handleParticipantCameraToggle={handleParticipantCameraToggle}
                        handleParticipantRoleChange={handleParticipantRoleChange}
                        checkCanKick={checkCanKick}
                        handleParticipantRemove={handleParticipantRemove}
                        handleOpenProfile={handleOpenProfile}
                        handleClearParticipantChat={handleClearParticipantChat}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                /* Standard conference participants grid layout display */
                <>

                  {spotlightParticipantId ? (
                    <div className="spotlight-stage-layout animate-fade-in">
                      <div className="spotlight-strip">
                        {callParticipants.map((p) => (
                      <ParticipantTile
                        key={p.id}
                        p={p}
                        isThumbnail={true}
                        myId={getMyId()}
                        isMicMuted={isMicMuted}
                        isCamOff={isCamOff}
                        cameraError={cameraError}
                        spotlightParticipantId={spotlightParticipantId}
                        setSpotlightParticipantId={setSpotlightParticipantId}
                        handleViewParticipantShare={handleViewParticipantShare}
                        isGalleryView={isGalleryView}
                        activeMenuParticipantId={activeMenuParticipantId}
                        setActiveMenuParticipantId={setActiveMenuParticipantId}
                        callParticipants={callParticipants}
                        checkCanMute={checkCanMute}
                        handleParticipantMuteToggle={handleParticipantMuteToggle}
                        handleParticipantCameraToggle={handleParticipantCameraToggle}
                        handleParticipantRoleChange={handleParticipantRoleChange}
                        checkCanKick={checkCanKick}
                        handleParticipantRemove={handleParticipantRemove}
                        handleOpenProfile={handleOpenProfile}
                        handleClearParticipantChat={handleClearParticipantChat}
                      />
                    ))}
                      </div>
                      <div className="spotlight-main">
                        {(() => {
                          const spotlightedPart = callParticipants.find(p => p.id === spotlightParticipantId);
                          return spotlightedPart ? (
                            <>
                              {spotlightedPart && (
                                <ParticipantTile
                                  p={spotlightedPart}
                                  isThumbnail={false}
                                  myId={getMyId()}
                                  isMicMuted={isMicMuted}
                                  isCamOff={isCamOff}
                                  cameraError={cameraError}
                                  spotlightParticipantId={spotlightParticipantId}
                                  setSpotlightParticipantId={setSpotlightParticipantId}
                                  handleViewParticipantShare={handleViewParticipantShare}
                                  isGalleryView={isGalleryView}
                                  activeMenuParticipantId={activeMenuParticipantId}
                                  setActiveMenuParticipantId={setActiveMenuParticipantId}
                                  callParticipants={callParticipants}
                                  checkCanMute={checkCanMute}
                                  handleParticipantMuteToggle={handleParticipantMuteToggle}
                                  handleParticipantCameraToggle={handleParticipantCameraToggle}
                                  handleParticipantRoleChange={handleParticipantRoleChange}
                                  checkCanKick={checkCanKick}
                                  handleParticipantRemove={handleParticipantRemove}
                                  handleOpenProfile={handleOpenProfile}
                                  handleClearParticipantChat={handleClearParticipantChat}
                                />
                              )}
                              <button 
                                className="btn-exit-spotlight" 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSpotlightParticipantId(null);
                                  setIsGalleryView(true);
                                }}
                              >
                                Exit Spotlight
                              </button>
                            </>
                          ) : null;
                        })()}
                      </div>
                    </div>
                  ) : (() => {
                    const myId = getMyId();
                    const sortedParticipants = [...callParticipants].sort((a, b) => {
                      const aIsMe = a.id === myId;
                      const bIsMe = b.id === myId;
                      if (aIsMe && !bIsMe) return -1;
                      if (bIsMe && !aIsMe) return 1;

                      const aSpeaking = a.isSpeaking ? 1 : 0;
                      const bSpeaking = b.isSpeaking ? 1 : 0;
                      if (aSpeaking !== bSpeaking) return bSpeaking - aSpeaking;

                      const aSharing = a.sharing ? 1 : 0;
                      const bSharing = b.sharing ? 1 : 0;
                      if (aSharing !== bSharing) return bSharing - aSharing;

                      const aCam = !a.isCamOff ? 1 : 0;
                      const bCam = !b.isCamOff ? 1 : 0;
                      if (aCam !== bCam) return bCam - aCam;

                      return 0;
                    });
                    const displayedParticipants = sortedParticipants.slice(0, 16);

                    const count = displayedParticipants.length;
                    const gridConfig = getGalleryGridTemplate(count);

                    return (
                      <div 
                        className={`participants-container ${isGalleryView ? 'gallery-layout' : 'grid-layout'}`}
                        style={{
                          gridTemplateColumns: gridConfig.columns,
                          gridTemplateRows: gridConfig.rows,
                          width: '100%',
                          height: '100%',
                          maxHeight: '100%',
                          justifyItems: 'center',
                          alignItems: 'center',
                          ...(!isGalleryView ? { maxWidth: '800px', margin: '0 auto' } : {})
                        }}
                      >
                        {displayedParticipants.map((p) => (
                          <ParticipantTile
                            key={p.id}
                            p={p}
                            isThumbnail={false}
                            myId={getMyId()}
                            isMicMuted={isMicMuted}
                            isCamOff={isCamOff}
                            cameraError={cameraError}
                            spotlightParticipantId={spotlightParticipantId}
                            setSpotlightParticipantId={setSpotlightParticipantId}
                            handleViewParticipantShare={handleViewParticipantShare}
                            isGalleryView={isGalleryView}
                            activeMenuParticipantId={activeMenuParticipantId}
                            setActiveMenuParticipantId={setActiveMenuParticipantId}
                            callParticipants={callParticipants}
                            checkCanMute={checkCanMute}
                            handleParticipantMuteToggle={handleParticipantMuteToggle}
                            handleParticipantCameraToggle={handleParticipantCameraToggle}
                            handleParticipantRoleChange={handleParticipantRoleChange}
                            checkCanKick={checkCanKick}
                            handleParticipantRemove={handleParticipantRemove}
                            handleOpenProfile={handleOpenProfile}
                            handleClearParticipantChat={handleClearParticipantChat}
                      />
                    ))}
                      </div>
                    );
                  })()}

                  {/* Removed stage-caption */}
                </>
              )}
            </div>

            {/* Call Sidebar (Right Panel) */}
            {!spotlightParticipantId && (
              <>
                {/* Floating collapse/expand toggle button */}
                <button 
                  onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                  className={`sidebar-toggle-btn ${isSidebarCollapsed ? 'collapsed' : ''}`}
                  title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  style={{
                    right: isSidebarCollapsed ? '0px' : '320px'
                  }}
                >
                  {isSidebarCollapsed ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 18 9 12 15 6"></polyline>
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                  )}
                  {isSidebarCollapsed && (
                    <div style={{ position: 'absolute', top: '4px', right: '4px', display: 'flex', gap: '3px' }}>
                      {unreadDmCount > 0 && (
                        <span 
                          style={{ 
                            width: '6px', 
                            height: '6px', 
                            borderRadius: '50%', 
                            backgroundColor: '#3b82f6', 
                            border: '1px solid var(--panel-bg, #1e222b)',
                            boxShadow: '0 0 4px #3b82f6' 
                          }} 
                        />
                      )}
                      {unreadChatCount > 0 && (
                        <span 
                          style={{ 
                            width: '6px', 
                            height: '6px', 
                            borderRadius: '50%', 
                            backgroundColor: '#ef4444', 
                            border: '1px solid var(--panel-bg, #1e222b)',
                            boxShadow: '0 0 4px #ef4444' 
                          }} 
                        />
                      )}
                    </div>
                  )}
                </button>

                <div 
                  className={`call-sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}
                  style={{
                    width: isSidebarCollapsed ? '0px' : '320px',
                    minWidth: isSidebarCollapsed ? '0px' : '320px',
                    borderLeft: isSidebarCollapsed ? 'none' : undefined,
                    overflow: 'hidden',
                    transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.3s cubic-bezier(0.4, 0, 0.2, 1), border-left 0.3s ease'
                  }}
                >
                  {/* Sidebar Header Tabs */}
                  <div className="call-sidebar-header">
                    <button 
                      onClick={() => setCallTab('chat')} 
                      className={`sidebar-tab-btn ${callTab === 'chat' ? 'active' : ''}`}
                      style={{ position: 'relative' }}
                    >
                      Chat
                      {callTab !== 'chat' && unreadChatCount > 0 && (
                        <span className="tab-unread-dot" />
                      )}
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
                    <button 
                      onClick={() => setCallTab('dm')} 
                      className={`sidebar-tab-btn ${callTab === 'dm' ? 'active' : ''}`}
                      style={{ position: 'relative' }}
                    >
                      DM
                      {callTab !== 'dm' && unreadDmCount > 0 && (
                        <span className="tab-unread-dot dm-dot" />
                      )}
                    </button>
                  </div>

              {/* Sidebar Body Content Panels */}
              <div className="sidebar-content">
                
                {/* 2A. Chat Tab Panel */}
                {callTab === 'chat' && (
                  <ChatPanel
                    chatMessages={chatMessages}
                    systemMessages={systemMessages}
                    callParticipants={callParticipants}
                    sendChatMessage={sendChatMessage}
                    callTab={callTab}
                    handleOpenProfile={handleOpenProfile}
                    activeBots={activeBots}
                    botTypingIds={botTypingIds}
                    myId={getMyId()}
                    deleteChatMessage={deleteChatMessage}
                    editChatMessage={editChatMessage}
                  />
                )}

                {/* 2B. People Tab Panel */}
                {callTab === 'people' && (
                  <div className="people-list animate-fade-in">
                    {(() => {
                      const list = [...callParticipants];
                      activeBots.forEach((bot) => {
                        if (!list.some(p => p.id === `bot_${bot.id}`)) {
                          const botPhotoURL = {
                            Kei: '/buddies/kei.jpg',
                            Sol: '/buddies/sol.png',
                            Rei: '/buddies/rei.jpg',
                            Mika: '/buddies/mika.jpg',
                            Kai: '/buddies/kai.jpg',
                            Nyx: '/buddies/nyx.jpg',
                            Yuna: '/buddies/yuna.jpg',
                            Wren: '/buddies/wren.jpg'
                          }[bot.id] || null;

                          list.push({
                            id: `bot_${bot.id}`,
                            uid: `bot_${bot.id}`,
                            name: bot.name,
                            initials: '🤖',
                            color: '#1db954',
                            photoURL: botPhotoURL,
                            isMuted: true,
                            isCamOff: true,
                            role: 'bot',
                            isBot: true
                          } as any);
                        }
                      });

                      const myId = getMyId();
                      const myPresence = callParticipants.find(part => part.id === myId);
                      
                      const raisedHandList = list.filter(p => p.handRaised);
                      const normalList = list.filter(p => !p.handRaised);

                      raisedHandList.sort((a, b) => {
                        const aTime = a.handRaisedAt || 0;
                        const bTime = b.handRaisedAt || 0;
                        return aTime - bTime;
                      });

                      normalList.sort((a, b) => {
                        const aBot = (a.role === 'bot' || a.isBot) ? 1 : 0;
                        const bBot = (b.role === 'bot' || b.isBot) ? 1 : 0;
                        if (aBot !== bBot) return aBot - bBot;
                        return 0;
                      });

                      const renderPersonRow = (p: any) => {
                        const isBot = p.role === 'bot' || p.isBot;
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
                                  cursor: 'pointer',
                                  border: p.sharing ? '1px solid var(--primary-color)' : 'none'
                                }}
                                onClick={() => {
                                  if (isBot) {
                                    handleOpenProfile({
                                      id: p.id,
                                      name: p.name,
                                      initials: p.initials,
                                      color: p.color,
                                      photoURL: null
                                    }, 'card');
                                  } else if (p.sharing) {
                                    handleViewParticipantShare(p);
                                  } else {
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
                                  <img src={p.photoURL} alt={p.name} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} referrerPolicy="no-referrer" />
                                ) : p.initials}
                                {p.sharing && !isBot && (
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
                              <div 
                                className="person-name-wrapper" 
                                style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}
                                onClick={() => {
                                  handleOpenProfile({
                                    id: p.uid || p.id,
                                    name: p.name.replace(' (You)', ''),
                                    initials: p.initials,
                                    color: p.color || '#3b82f6',
                                    photoURL: p.photoURL || null
                                  }, 'card');
                                }}
                              >
                                <span className="person-name">
                                  {p.name}
                                </span>
                                {p.handRaised && (
                                  <span style={{ fontSize: '14px', marginLeft: '6px', color: 'var(--primary-color, #f1c40f)', display: 'inline-flex', alignItems: 'center' }} title="Hand raised">
                                    ✋
                                  </span>
                                )}
                                {p.role && p.role !== 'member' && (
                                  <span className={p.role === 'bot' ? 'role-badge-bot' : `role-badge-${p.role}`} style={{
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
                            </div>
                            <div className="person-status-icons" style={{ display: 'flex', alignItems: 'center' }}>
                              {p.handRaised && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleLowerHand(p.id);
                                  }}
                                  style={{
                                    background: 'rgba(239, 68, 68, 0.1)',
                                    border: '1px solid rgba(239, 68, 68, 0.2)',
                                    borderRadius: '4px',
                                    padding: '2px 6px',
                                    fontSize: '9px',
                                    fontWeight: 'bold',
                                    color: '#ef4444',
                                    cursor: 'pointer',
                                    marginRight: '8px',
                                    lineHeight: '1.2',
                                    display: (getMyId() === p.id || myPresence?.role === 'host' || myPresence?.role === 'cohost' || myPresence?.role === 'admin') ? 'inline-flex' : 'none',
                                    alignItems: 'center'
                                  }}
                                  title={getMyId() === p.id ? "Lower your hand" : "Lower participant's hand"}
                                >
                                  Lower
                                </button>
                              )}
                              {!isBot && user && !isUser && (
                                <button
                                  onClick={() => handleToggleFollow(p.id)}
                                  style={{
                                    background: 'none',
                                    border: followingUserIds.includes(p.id) ? '1px solid var(--border-color)' : '1px solid var(--primary-color)',
                                    borderRadius: '4px',
                                    padding: '2px 8px',
                                    fontSize: '10px',
                                    fontWeight: 'bold',
                                    color: followingUserIds.includes(p.id) ? 'var(--text-secondary)' : 'var(--primary-color)',
                                    cursor: 'pointer',
                                    marginRight: '8px',
                                    lineHeight: '1.2',
                                    display: 'inline-flex',
                                    alignItems: 'center'
                                  }}
                                >
                                  {followingUserIds.includes(p.id) ? 'Following' : 'Follow'}
                                </button>
                              )}
                              {isBot ? (
                                <span style={{ fontSize: '10px', opacity: 0.6, marginRight: '4px' }}>Active</span>
                              ) : (
                                <>
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
                                    {isUser ? isCamOff : p.isCamOff ? (
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
                                </>
                              )}
                            </div>
                          </div>
                        );
                      };

                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                          {raisedHandList.length > 0 && (
                            <div className="people-list-section" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              <div className="people-list-section-header" style={{
                                fontSize: '11px',
                                fontWeight: 'bold',
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em',
                                color: 'var(--primary-color, #f1c40f)',
                                padding: '8px 12px 4px',
                                borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px'
                              }}>
                                ✋ Raised hands ({raisedHandList.length})
                              </div>
                              {raisedHandList.map((p) => renderPersonRow(p))}
                            </div>
                          )}
                          
                          <div className="people-list-section" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {raisedHandList.length > 0 && (
                              <div className="people-list-section-header" style={{
                                fontSize: '11px',
                                fontWeight: 'bold',
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em',
                                color: 'var(--text-secondary, #94a3b8)',
                                padding: '8px 12px 4px',
                                borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                                marginBottom: '4px'
                              }}>
                                Everyone Else ({normalList.length})
                              </div>
                            )}
                            {normalList.map((p) => renderPersonRow(p))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )
              }

                  {callTab === 'tools' && (() => {
                    return (
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
                                  await updateMySharing({ sharing: 'whiteboard', whiteboardData: '', whiteboardEditAllowed: false });
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

                            {/* YouTube Card */}
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
                                <span className="tool-card-title">YouTube</span>
                                <span className="tool-card-desc">Play and stream YouTube links in call.</span>
                              </div>
                            </div>

                            {/* Spotify Card */}
                            <div 
                              className={`tool-card ${spotifyUri ? 'active' : ''}`}
                              onClick={() => {
                                setActiveToolDetail('spotify');
                                setActiveGameId(null);
                              }}
                              title="Play Spotify music together"
                            >
                              <div className="tool-card-icon-wrapper" style={{ color: '#1db954' }}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M9 18V5l12-2v13"></path>
                                  <circle cx="6" cy="18" r="3"></circle>
                                  <circle cx="18" cy="16" r="3"></circle>
                                </svg>
                              </div>
                              <div className="tool-card-info">
                                <span className="tool-card-title">Spotify Music</span>
                                <span className="tool-card-desc">Stream Spotify tracks and playlists.</span>
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

                            {/* Deadline Clock Card */}
                            <div 
                              className={`tool-card ${deadlineIsRunning ? 'active' : ''}`}
                              onClick={() => {
                                setActiveToolDetail('deadline');
                                setActiveGameId(null);
                              }}
                              title="Step-by-step deadline session timer"
                            >
                              <div className="tool-card-icon-wrapper" style={{ color: deadlineIsRunning ? 'var(--primary-color)' : 'inherit' }}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <circle cx="12" cy="12" r="10"></circle>
                                  <polyline points="12 6 12 12 15 15"></polyline>
                                </svg>
                              </div>
                              <div className="tool-card-info">
                                <span className="tool-card-title">Deadline Clock</span>
                                <span className="tool-card-desc">
                                  {deadlineIsRunning ? 'Running steps deadline timer...' : 'Add steps and start countdown.'}
                                </span>
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

                             {/* Target Sessions Card */}
                             <div 
                               className="tool-card"
                               onClick={() => {
                                 setActiveToolDetail('targets');
                                 setActiveGameId(null);
                               }}
                               title="Set and check off study session targets"
                             >
                               <div className="tool-card-icon-wrapper">
                                 <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                   <polyline points="9 11 12 14 22 4"></polyline>
                                   <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
                                 </svg>
                               </div>
                               <div className="tool-card-info">
                                 <span className="tool-card-title">Target Sessions</span>
                                 <span className="tool-card-desc">Set goals and check them off this week.</span>
                               </div>
                             </div>

                             {/* Study Buddies Card */}
                             <div 
                               className={`tool-card ${activeToolDetail === 'buddies' ? 'active' : ''}`}
                               onClick={() => {
                                 setActiveToolDetail('buddies');
                                 setActiveGameId(null);
                               }}
                               title="Invite virtual study buddies to this room"
                             >
                               <div className="tool-card-icon-wrapper" style={{ color: 'var(--primary-color, #f1c40f)' }}>
                                 🤖
                               </div>
                               <div className="tool-card-info">
                                 <span className="tool-card-title">Study Buddies</span>
                                 <span className="tool-card-desc">Add virtual study companions to chat.</span>
                               </div>
                             </div>

                             {/* Voting Polls Card */}
                             <div 
                               className={`tool-card ${currentRoom?.voteStatus === 'active' ? 'active' : ''}`}
                               onClick={() => {
                                 setActiveToolDetail('voting');
                                 setActiveGameId(null);
                               }}
                               title="Start or participate in a poll"
                             >
                               <div className="tool-card-icon-wrapper" style={{ color: currentRoom?.voteStatus === 'active' ? 'var(--primary-color)' : 'inherit' }}>
                                 🗳️
                               </div>
                               <div className="tool-card-info">
                                 <span className="tool-card-title">Voting & Polls</span>
                                 <span className="tool-card-desc">
                                   {currentRoom?.voteStatus === 'active' ? 'Poll is active — vote now!' : 'Create a yes/no or multiple-choice poll.'}
                                 </span>
                               </div>
                             </div>

                           </div>
                        </div>

                        {/* Section 2: Fun Section (Disabled for everyone if Room Mode is Focus/Ultra Pro Max) */}
                        {(() => {
                          const isFunLocked = (currentRoom?.roomMode === 'discuss' || currentRoom?.roomMode === 'non-discuss');

                          return (
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                <h4 style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
                                  Fun Section
                                </h4>
                                {isFunLocked && (
                                  <span style={{ fontSize: '9px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>
                                    🔒 Locked in Focus Mode
                                  </span>
                                )}
                              </div>
                              
                              <div className="tools-cards-grid">
                                {/* Games Party Card */}
                                <div 
                                  className={`tool-card ${isFunLocked ? 'locked-disabled' : ''}`}
                                  onClick={() => {
                                    if (isFunLocked) {
                                      showToast("🔒 Fun tools are disabled in Focus Mode. Switch back to Chill Mode to play.");
                                      return;
                                    }
                                    setActiveToolDetail('games');
                                    setActiveGameId(null);
                                  }}
                                  title={isFunLocked ? "🔒 Locked in Focus Mode" : "Play games together"}
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
                                      showToast("🔒 Fun tools are disabled in Focus Mode. Switch back to Chill Mode to play.");
                                      return;
                                    }
                                    setActiveToolDetail('truthordare');
                                    setActiveGameId(null);
                                  }}
                                  title={isFunLocked ? "🔒 Locked in Focus Mode" : "Play Truth or Dare spinner wheel"}
                                >
                                  <div className="tool-card-icon-wrapper">
                                    🎲
                                  </div>
                                  <div className="tool-card-info">
                                    <span className="tool-card-title">T/D Wheel</span>
                                    <span className="tool-card-desc">Spin the wheel to play Truth or Dare.</span>
                                  </div>
                                </div>

                                {/* Streaming Party Card */}
                                <div 
                                  className={`tool-card ${isFunLocked ? 'locked-disabled' : ''}`}
                                  onClick={() => {
                                    if (isFunLocked) {
                                      showToast("🔒 Fun tools are disabled in Focus Mode. Switch back to Chill Mode to play.");
                                      return;
                                    }
                                    setActiveToolDetail('streaming');
                                    setActiveGameId(null);
                                  }}
                                  title={isFunLocked ? "🔒 Locked in Focus Mode" : "Stream Vimeo, Dailymotion, or Twitch together"}
                                >
                                  <div className="tool-card-icon-wrapper" style={{ color: '#a855f7' }}>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      <polygon points="23 7 16 12 23 17 23 7"></polygon>
                                      <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                                    </svg>
                                  </div>
                                  <div className="tool-card-info">
                                    <span className="tool-card-title">Streaming</span>
                                    <span className="tool-card-desc">Stream Twitch, Vimeo, or Dailymotion.</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })()}



                      </div>
                    )}

                    {/* Sub-panel View: Target Sessions */}
                    {activeToolDetail === 'targets' && (
                      <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%' }}>
                        <div className="tools-sub-panel-header" style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '12px', marginBottom: '4px' }}>
                          <button onClick={() => setActiveToolDetail('none')} className="tools-back-btn" title="Back to tools list" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px' }}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="19" y1="12" x2="5" y2="12"></line>
                              <polyline points="12 19 5 12 12 5"></polyline>
                            </svg>
                          </button>
                          <span className="tools-sub-panel-title" style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)' }}>Target Sessions</span>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
                          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>This week's targets</span>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--primary-color)' }}>
                            {targetsList.filter(t => t.completed).length} / {targetsList.length} done
                          </span>
                        </div>

                        {/* List of items */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', flex: 1, maxHeight: '320px', overflowY: 'auto', padding: '0 4px' }}>
                          {targetsList.map(item => (
                            <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px', color: item.completed ? 'var(--text-secondary)' : 'var(--text-primary)', padding: '8px 10px', borderRadius: '6px', backgroundColor: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.02)' }}>
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
                              <span style={{ textDecoration: item.completed ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {item.text}
                              </span>
                            </label>
                          ))}
                          {targetsList.length === 0 && (
                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontStyle: 'italic', textAlign: 'center', display: 'block', padding: '32px 0' }}>
                              No targets set for this week yet.
                            </span>
                          )}
                        </div>

                        {/* Add target form */}
                        <form onSubmit={handleAddTarget} style={{ display: 'flex', gap: '8px', padding: '0 4px' }}>
                          <input 
                            type="text"
                            placeholder="Add a study target..."
                            className="search-input"
                            style={{ paddingLeft: '12px', fontSize: '13px', height: '36px', flex: 1 }}
                            value={targetInputText}
                            onChange={(e) => setTargetInputText(e.target.value)}
                            required
                          />
                          <button type="submit" className="btn-signin" style={{ width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0 }}>
                            +
                          </button>
                        </form>
                      </div>
                    )}

                    {/* Sub-panel View: Study Buddies */}
                    {activeToolDetail === 'buddies' && currentRoom && (
                      <StudyBuddiesPanel
                        roomId={roomDocId(currentRoom)}
                        activeBots={activeBots}
                        myId={getMyId()}
                        myName={user ? user.displayName || 'Google User' : guestName}
                        myRole={callParticipants.find(p => p.id === getMyId())?.role || determineRole(currentRoom.creatorId)}
                        showToast={showToast}
                        onClose={() => setActiveToolDetail('none')}
                      />
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
                          <span className="tools-sub-panel-title">YouTube</span>
                        </div>

                        <form onSubmit={(e) => {
                          setWatchTogetherPlatform('youtube');
                          handleWatchTogetherSubmit(e);
                        }} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          <div className="form-group">
                            <label htmlFor="ytUrl" className="form-label" style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                              YouTube URL or Video ID
                            </label>
                            <input 
                              type="text"
                              id="ytUrl"
                              placeholder="e.g. https://www.youtube.com/watch?v=dQw4w9WgXcQ"
                              className="search-input"
                              style={{ paddingLeft: '12px', fontSize: '13px' }}
                              value={ytInputUrl}
                              onChange={(e) => {
                                setWatchTogetherPlatform('youtube');
                                setYtInputUrl(e.target.value);
                              }}
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

                    {/* Sub-panel View: Spotify details */}
                    {activeToolDetail === 'spotify' && (
                      <div className="animate-fade-in">
                        <div className="tools-sub-panel-header">
                          <button onClick={() => setActiveToolDetail('none')} className="tools-back-btn" title="Back to tools list">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="19" y1="12" x2="5" y2="12"></line>
                              <polyline points="12 19 5 12 12 5"></polyline>
                            </svg>
                          </button>
                          <span className="tools-sub-panel-title">Spotify Music</span>
                        </div>

                        <form onSubmit={async (e) => {
                          e.preventDefault();
                          const input = spotifyInputUrl.trim();
                          if (!input) return;
                          
                          const myId = getMyId();
                          await updateMySharing({ sharing: 'spotify', sharingYoutubeId: input, whiteboardData: '' });
                          setSpotifyUri(input);
                          setViewingShare({ participantId: myId, type: 'spotify', youtubeVideoId: input });
                          showToast('Spotify playlist shared — click your avatar to view');
                        }} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          <div className="form-group">
                            <label htmlFor="spotifyUrl" className="form-label" style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                              Spotify Track/Playlist URL
                            </label>
                            <input 
                              type="text"
                              id="spotifyUrl"
                              placeholder="e.g. https://open.spotify.com/playlist/..."
                              className="search-input"
                              style={{ paddingLeft: '12px', fontSize: '13px' }}
                              value={spotifyInputUrl}
                              onChange={(e) => setSpotifyInputUrl(e.target.value)}
                              required
                            />
                          </div>
                          <button type="submit" className="btn-signin" style={{ width: '100%', padding: '10px' }}>
                            Load Spotify
                          </button>
                        </form>
                        
                        {spotifyUri && (
                          <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>Currently Playing: <strong>{spotifyUri}</strong></span>
                            <button 
                              onClick={async () => {
                                setSpotifyUri(null);
                                await clearMySharing();
                                setViewingShare(null);
                                showToast('Spotify music stopped');
                              }} 
                              className="btn-signin" 
                              style={{ width: '100%', backgroundColor: '#ef4444', borderColor: '#ef4444', color: '#ffffff' }}
                            >
                              Stop Spotify
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Sub-panel View: Streaming details (Vimeo, Dailymotion, Twitch) */}
                    {activeToolDetail === 'streaming' && (
                      <div className="animate-fade-in">
                        <div className="tools-sub-panel-header">
                          <button onClick={() => setActiveToolDetail('none')} className="tools-back-btn" title="Back to tools list">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="19" y1="12" x2="5" y2="12"></line>
                              <polyline points="12 19 5 12 12 5"></polyline>
                            </svg>
                          </button>
                          <span className="tools-sub-panel-title">Streaming Party</span>
                        </div>

                        {/* Platform Tabs Selection */}
                        <div style={{ display: 'flex', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
                          {(['vimeo', 'dailymotion', 'twitch'] as const).map((plat) => (
                            <button
                              key={plat}
                              type="button"
                              onClick={() => setWatchTogetherPlatform(plat)}
                              style={{
                                flex: 1,
                                minWidth: '75px',
                                padding: '8px 4px',
                                fontSize: '11px',
                                borderRadius: '6px',
                                border: '1px solid',
                                borderColor: watchTogetherPlatform === plat ? 'var(--primary-color)' : 'rgba(255,255,255,0.08)',
                                backgroundColor: watchTogetherPlatform === plat ? 'rgba(168, 85, 247, 0.1)' : 'var(--panel-bg)',
                                color: watchTogetherPlatform === plat ? 'var(--primary-color)' : 'var(--text-secondary)',
                                cursor: 'pointer',
                                fontWeight: watchTogetherPlatform === plat ? '700' : '500',
                                textTransform: 'capitalize',
                                transition: 'all 0.2s ease',
                                textAlign: 'center'
                              }}
                            >
                              {plat === 'vimeo' ? 'Vimeo' : plat === 'dailymotion' ? 'Dailymotion' : 'Twitch'}
                            </button>
                          ))}
                        </div>

                        <form onSubmit={(e) => {
                          if (watchTogetherPlatform === 'youtube') {
                            setWatchTogetherPlatform('vimeo');
                          }
                          handleWatchTogetherSubmit(e);
                        }} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          <div className="form-group">
                            <label htmlFor="streamUrl" className="form-label" style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                              {watchTogetherPlatform === 'vimeo' ? 'Vimeo URL or Video ID' : 
                               watchTogetherPlatform === 'dailymotion' ? 'Dailymotion URL or Video ID' : 
                               'Twitch Channel or VOD URL'}
                            </label>
                            <input 
                              type="text"
                              id="streamUrl"
                              placeholder={
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
                            Load Stream
                          </button>
                        </form>
                        
                        {youtubeVideoId && watchTogetherPlatform !== 'youtube' && (
                          <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Currently Playing Stream ID: <strong>{youtubeVideoId}</strong></span>
                            <button 
                              onClick={async () => {
                                setYoutubeVideoId(null);
                                await clearMySharing();
                                setViewingShare(null);
                                showToast('Stream presentation stopped');
                              }} 
                              className="btn-signin" 
                              style={{ width: '100%', backgroundColor: '#ef4444', borderColor: '#ef4444', color: '#ffffff' }}
                            >
                              Stop Streaming
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
                        {expandedTool === 'pomodoro' ? (
                          <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                            <span style={{ fontSize: '28px' }}>⏱️</span>
                            <span style={{ fontWeight: 700, color: 'var(--primary-color)' }}>Pomodoro Timer is Expanded</span>
                            <span style={{ fontSize: '11px', lineHeight: 1.4 }}>This tool is currently active in the main stage view.</span>
                          </div>
                        ) : (
                          renderPomodoroUI(false)
                        )}
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
                        {expandedTool === 'deadline' ? (
                          <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                            <span style={{ fontSize: '28px' }}>⏳</span>
                            <span style={{ fontWeight: 700, color: 'var(--primary-color)' }}>Deadline Clock is Expanded</span>
                            <span style={{ fontSize: '11px', lineHeight: 1.4 }}>This tool is currently active in the main stage view.</span>
                          </div>
                        ) : (
                          renderDeadlineUI(false)
                        )}
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
                        {expandedTool === 'loose' ? (
                          <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                            <span style={{ fontSize: '28px' }}>🔄</span>
                            <span style={{ fontWeight: 700, color: 'var(--primary-color)' }}>Loose Timer is Expanded</span>
                            <span style={{ fontSize: '11px', lineHeight: 1.4 }}>This tool is currently active in the main stage view.</span>
                          </div>
                        ) : (
                          renderLooseTimerUI(false)
                        )}
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
                        {expandedTool === 'truthordare' ? (
                          <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                            <span style={{ fontSize: '28px' }}>🎲</span>
                            <span style={{ fontWeight: 700, color: 'var(--primary-color)' }}>Truth or Dare is Expanded</span>
                            <span style={{ fontSize: '11px', lineHeight: 1.4 }}>This tool is currently active in the main stage view.</span>
                          </div>
                        ) : (
                          <TruthOrDareUI
                            isExpanded={false}
                            myId={getMyId()}
                            callParticipants={callParticipants}
                            todActiveIds={todActiveIds}
                            todPendingIds={todPendingIds}
                            todSelectedId={todSelectedId}
                            todChoice={todChoice}
                            todText={todText}
                            todState={todState}
                            todSpinResult={todSpinResult}
                            todLocalSpinning={todLocalSpinning}
                            todSpinPool={todSpinPool}
                            handleSpinTruthOrDare={handleSpinTruthOrDare}
                            handleSelectTodChoice={handleSelectTodChoice}
                            handleResetTod={handleResetTod}
                            handleJoinTodGame={handleJoinTodGame}
                            handleLeaveTodGame={handleLeaveTodGame}
                          />
                        )}
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
                        {expandedTool === 'spin' ? (
                          <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                            <span style={{ fontSize: '28px' }}>🎡</span>
                            <span style={{ fontWeight: 700, color: 'var(--primary-color)' }}>Spin the Wheel is Expanded</span>
                            <span style={{ fontSize: '11px', lineHeight: 1.4 }}>This tool is currently active in the main stage view.</span>
                          </div>
                        ) : (
                          <SpinWheelUI
                            isExpanded={false}
                            myId={getMyId()}
                            callParticipants={callParticipants}
                            spinCheckedIds={spinCheckedIds}
                            spinPool={spinPool}
                            spinResult={spinResult}
                            spinLocalSpinning={spinLocalSpinning}
                            handleSpinWheel={handleSpinWheel}
                            handleToggleSpinCheckedParticipant={handleToggleSpinCheckedParticipant}
                          />
                        )}
                      </div>
                    )}

                    {/* Sub-panel View 9: Voting & Polls */}
                    {activeToolDetail === 'voting' && (
                      <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column' }}>
                        <div className="tools-sub-panel-header">
                          <button onClick={() => setActiveToolDetail('none')} className="tools-back-btn" title="Back">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="19" y1="12" x2="5" y2="12"></line>
                              <polyline points="12 19 5 12 12 5"></polyline>
                            </svg>
                          </button>
                          <span className="tools-sub-panel-title">Voting & Polls</span>
                        </div>
                        {renderVotingUI()}
                      </div>
                    )}



                  </div>
                ); })()}

                {callTab === 'dm' && (
                  <DMPanel
                    user={user}
                    dmThreads={dmThreads}
                    communityUsers={communityUsers}
                    followingUserIds={followingUserIds}
                    followerUserIds={followerUserIds}
                    showToast={showToast}
                    targetsList={targetsList}
                    userDataState={userDataState}
                  />
                )}

              </div>
            </div>
          </>
          )}

          </div>

          {/* Call Control Dock (Bottom Toolbar) */}
          <div className="call-bottom-dock">
            
            {/* Left Group: Room Info & Mode */}
            <div className="dock-left-group">
              <a 
                href="/" 
                onClick={(e) => { 
                  e.preventDefault(); 
                  if (window.confirm("Do you want to return to the homepage? You will leave the current room.")) { 
                    handleLeaveCall(); 
                  } 
                }} 
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <img src="/logo.png" alt="Skulk Logo" style={{ width: '28px', height: '28px', objectFit: 'contain', borderRadius: '4px' }} />
              </a>
              <h1 className="room-title" style={{ fontSize: '14px', fontWeight: 800, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-primary)' }}>{currentRoom.name}</h1>
              {(() => {
                const mode = currentRoom.roomMode || 'chill';
                const dotColor = mode === 'non-discuss' ? '#ef4444' : mode === 'discuss' ? '#3b82f6' : '#2ecc71';
                const badgeBg = mode === 'non-discuss' ? 'rgba(239, 68, 68, 0.1)' : mode === 'discuss' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(46, 204, 113, 0.1)';
                const badgeBorder = mode === 'non-discuss' ? '1px solid rgba(239, 68, 68, 0.2)' : mode === 'discuss' ? '1px solid rgba(59, 130, 246, 0.2)' : '1px solid rgba(46, 204, 113, 0.2)';
                const modeText = mode === 'non-discuss' ? 'Ultra Focus' : mode === 'discuss' ? 'Focus Mode' : 'Chill Mode';
                
                return (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    backgroundColor: badgeBg,
                    border: badgeBorder,
                    padding: '3px 8px',
                    borderRadius: '9999px',
                    fontSize: '10px',
                    fontWeight: 700,
                    color: dotColor
                  }}>
                    <div style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      backgroundColor: dotColor,
                      animation: 'pulse 1.5s infinite'
                    }} />
                    <span>{modeText}</span>
                  </div>
                );
              })()}
            </div>

            {/* Center Group: Call Interactivity Actions */}
            <div className="dock-center-group">
              {/* Status Button */}
              {(() => {
                const STATUS_OPTIONS: { key: typeof myStatus; label: string; emoji: string; color: string }[] = [
                  { key: 'none',    label: 'Clear',    emoji: '😐', color: '#64748b' },
                  { key: 'dnd',     label: 'Do Not Disturb', emoji: '⛔', color: '#ef4444' },
                  { key: 'zZ',      label: 'Sleeping', emoji: '💤', color: '#8b5cf6' },
                  { key: 'brb',     label: 'Be Right Back', emoji: '🚶', color: '#f59e0b' },
                  { key: 'chillin', label: 'Chillin',  emoji: '😎', color: '#10b981' },
                ];
                const current = STATUS_OPTIONS.find(s => s.key === myStatus) || STATUS_OPTIONS[0];
                return (
                  <div style={{ position: 'relative' }}>
                    {showStatusMenu && (
                      <div className="status-popup-menu" style={{ position: 'absolute', bottom: '100%', top: 'auto', left: '50%', transform: 'translateX(-50%)', marginBottom: '8px', zIndex: 300 }}>
                        {STATUS_OPTIONS.map(opt => (
                          <button
                            key={opt.key}
                            className={`status-popup-item ${myStatus === opt.key ? 'active' : ''}`}
                            style={{ '--status-color': opt.color } as any}
                            onClick={() => {
                              const next = opt.key;
                              setMyStatus(next);
                              setShowStatusMenu(false);
                              if (currentRoom) {
                                updateMyStatus(next === 'none' ? null : next);
                              }
                            }}
                          >
                            <span>{opt.emoji}</span>
                            <span>{opt.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      id="status-toggle-btn"
                      className="status-dock-btn"
                      title="Set your status"
                      onClick={() => setShowStatusMenu(v => !v)}
                      style={{ '--status-color': current.color } as any}
                    >
                      <span className="status-dock-emoji">{current.emoji}</span>
                      {myStatus !== 'none' && (
                        <span className="status-dock-label">{current.key.toUpperCase()}</span>
                      )}
                    </button>
                  </div>
                );
              })()}

              {/* Mic Toggle Button */}
              {(() => {
                const myId = getMyId();
                const myPresence = callParticipants.find(p => p.id === myId);
                const isMutedByHost = !!(myPresence && myPresence.mutedBy && myPresence.mutedBy !== myId);
                const isCamDisabledByHost = !!(myPresence && myPresence.camOffBy && myPresence.camOffBy !== myId);
                
                const isBlocked = !!(micBlockedUntil && Date.now() < micBlockedUntil);
                const remainingBlockedSecs = isBlocked ? Math.ceil((micBlockedUntil! - Date.now()) / 1000) : 0;

                return (
                  <>
                    <button 
                      onClick={toggleMic} 
                      className={`dock-btn ${isMicMuted ? 'active-off' : ''} ${isMutedByHost ? 'host-locked' : ''}`}
                      title={isMutedByHost ? 'Muted by Host (Locked)' : isBlocked ? `Microphone blocked (${remainingBlockedSecs}s remaining)` : isMicMuted ? 'Unmute microphone' : 'Mute microphone'}
                      style={isBlocked ? { position: 'relative', border: '1px solid rgba(239, 68, 68, 0.4)', background: 'rgba(239, 68, 68, 0.1)' } : undefined}
                      disabled={isBlocked}
                    >
                      {isBlocked ? (
                        <span style={{ fontSize: '11px', fontWeight: 800, color: '#ef4444' }}>
                          {remainingBlockedSecs}s
                        </span>
                      ) : isMutedByHost ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="1" y1="1" x2="23" y2="23"></line>
                          <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
                          <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
                        </svg>
                      ) : (
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
                      )}
                    </button>
                    
                    {/* Camera Toggle Button */}
                    <button 
                      onClick={toggleCamera} 
                      className={`dock-btn ${isCamOff ? 'active-off' : ''} ${isCamDisabledByHost ? 'host-locked' : ''}`}
                      title={isCamDisabledByHost ? 'Camera Disabled by Host (Locked)' : isCamOff ? 'Turn camera on' : 'Turn camera off'}
                    >
                      {isCamDisabledByHost ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="1" y1="1" x2="23" y2="23"></line>
                          <path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3 0h9a2 2 0 0 1 2 2v8c0 .28-.06.55-.18.8l-4-4"></path>
                        </svg>
                      ) : (
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
                      )}
                    </button>
                  </>
                );
              })()}

              {/* Raise Hand Button */}
              {(() => {
                const myId = getMyId();
                const myPresence = callParticipants.find(p => p.id === myId);
                const handRaised = !!myPresence?.handRaised;
                return (
                  <button
                    onClick={toggleRaiseHand}
                    className={`dock-btn ${handRaised ? 'active' : ''}`}
                    style={{ fontSize: '20px' }}
                    title={handRaised ? 'Lower your hand' : 'Raise your hand'}
                  >
                    ✋
                  </button>
                );
              })()}


              {/* Layout Toggle Button */}
              <button 
                onClick={() => {
                  if (spotlightParticipantId) {
                    setSpotlightParticipantId(null);
                    setIsGalleryView(true);
                  } else {
                    setIsGalleryView(!isGalleryView);
                  }
                }} 
                className="dock-btn"
                title={spotlightParticipantId ? 'Switch to Gallery View' : (isGalleryView ? 'Switch to Grid View' : 'Switch to Gallery View')}
              >
                {spotlightParticipantId || isGalleryView ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7"></rect>
                    <rect x="14" y="3" width="7" height="7"></rect>
                    <rect x="14" y="14" width="7" height="7"></rect>
                    <rect x="3" y="14" width="7" height="7"></rect>
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="9"></rect>
                    <rect x="14" y="3" width="7" height="5"></rect>
                    <rect x="14" y="12" width="7" height="9"></rect>
                    <rect x="3" y="16" width="7" height="5"></rect>
                  </svg>
                )}
              </button>

              {/* Leave Room Button */}
              <button 
                onClick={handleLeaveCall} 
                className="dock-btn dock-btn-leave"
                title="Leave room call"
              >
                Leave
              </button>

              {/* End Room Button (Host/Admin Only) */}
              {(callParticipants.find(part => part.id === getMyId())?.role === 'admin' || 
                callParticipants.find(part => part.id === getMyId())?.role === 'host') && (
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

            {/* Right Group: Utilities & Identity */}
            <div className="dock-right-group">
              {/* Theme Picker */}
              <button 
                onClick={() => setIsThemeModalOpen(true)} 
                className="theme-picker-btn dock-theme-btn"
                aria-label="Theme settings"
                title="Select background theme"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 14.7255 3.09032 17.1962 4.85857 19C5.32832 19.4797 5.5632 19.7196 5.86178 19.8598C6.16035 20 6.56847 20 7.38471 20H8C9.10457 20 10 19.1046 10 18C10 16.8954 10.8954 16 12 16C13.1046 16 14 16.8954 14 18C14 20.2091 15.7909 22 18 22H12Z"></path>
                  <circle cx="7.5" cy="10.5" r="1.5" fill="currentColor"></circle>
                  <circle cx="11.5" cy="7.5" r="1.5" fill="currentColor"></circle>
                  <circle cx="16.5" cy="9.5" r="1.5" fill="currentColor"></circle>
                  <circle cx="15.5" cy="14.5" r="1.5" fill="currentColor"></circle>
                </svg>
              </button>

              {/* Mini Mode Button */}
              {(isDocumentPipSupported || isVideoPipSupported) && (
                <button 
                  onClick={toggleMiniMode} 
                  className="theme-picker-btn dock-minimode-btn"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  title="Enter Mini Mode"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <rect x="12" y="12" width="9" height="9" rx="1" ry="1"></rect>
                  </svg>
                </button>
              )}

              {/* Room Settings popover */}
              <div className="theme-picker-container" ref={roomSettingsRef} style={{ position: 'relative' }}>
                <button 
                  onClick={() => setIsRoomSettingsOpen(!isRoomSettingsOpen)} 
                  className="theme-picker-btn dock-settings-btn"
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
                  <div className="theme-picker-dropdown animate-fade-in" style={{ bottom: '100%', top: 'auto', marginTop: 'auto', right: '0', width: '320px', padding: '16px', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '8px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>Room Settings</span>
                      <button onClick={() => setIsRoomSettingsOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '16px', padding: 0 }}>×</button>
                    </div>
                    {renderRoomSettingsUI()}
                  </div>
                )}
              </div>

              {/* Guest Profile Badging */}
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

              {/* User Profile Badging */}
              {user && (
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
                    <span>
                      {user.displayName || 'Google User'}
                    </span>
                  </button>
                  
                  {isUserDropdownOpen && (
                    <div className="theme-picker-dropdown animate-fade-in" style={{ bottom: '100%', top: 'auto', marginTop: 'auto', right: 0, marginBottom: '8px', minWidth: '150px', zIndex: 1000 }}>
                      <button 
                        onClick={() => {
                          setIsThemeModalOpen(true);
                          setIsUserDropdownOpen(false);
                        }} 
                        className="theme-item-btn"
                        style={{ width: '100%', textAlign: 'left', padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                      >
                        🎨 App Themes
                      </button>
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
          </div>
          )}

          {renderPipWindow()}

              </>
            )}
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
            <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>joining...</span>
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
      {showSignInPrompt && (!user || user.isAnonymous) && (
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
                  // After successful sign in, verify Google auth propagation before opening the modal
                  setTimeout(() => {
                    const currentUser = auth.currentUser;
                    if (currentUser && !currentUser.isAnonymous) {
                      setIsModalOpen(true);
                    }
                  }, 600);
                });
              }} style={{ padding: '8px 16px' }}>Sign in</button>
            </div>
          </div>
        </div>
      )}

      {/* Guest Ask to Join Sign In Modal */}
      {pendingSignInRoom && (
        <div className="modal-overlay" style={{ zIndex: 1200 }}>
          <div className="modal-container animate-fade-in" style={{ maxWidth: '400px', textAlign: 'center', padding: '32px' }}>
            <h3 style={{ fontSize: '18px', marginBottom: '12px', fontWeight: '600', color: 'var(--text-primary)' }}>
              Sign in required
            </h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '14px', lineHeight: '1.5' }}>
              To ask to join, please sign in. Guests can only join public or private rooms.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button 
                type="button" 
                className="btn-secondary" 
                onClick={() => setPendingSignInRoom(null)} 
                style={{ padding: '8px 16px' }}
              >
                Cancel
              </button>
              <button 
                type="button" 
                className="btn-signin" 
                onClick={async () => {
                  const targetRoom = pendingSignInRoom;
                  setPendingSignInRoom(null);
                  try {
                    await handleSignIn();
                    setTimeout(() => {
                      handleJoinRoomClick(targetRoom);
                    }, 800);
                  } catch (e) {
                    console.error("Sign-in failed:", e);
                  }
                }} 
                style={{ padding: '8px 16px' }}
              >
                Sign in
              </button>
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

                {startOption === 'later' && (
                  <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px', maxWidth: '320px', lineHeight: 1.5 }}>
                    Room scheduled for {formatFriendlyDate(scheduleDate)} at {scheduleTime}. Copy the link to invite participants in advance.
                  </p>
                )}

                {startOption !== 'later' && (
                  <button 
                    onClick={() => {
                      closeModal();
                      window.open(`/room/${generatedRoomLink.split('/').pop()}`, '_blank');
                    }}
                    className="btn-create" 
                    style={{ 
                      width: '100%', 
                      padding: '12px 16px', 
                      fontSize: '15px', 
                      justifyContent: 'center',
                      marginBottom: '16px',
                      backgroundColor: 'var(--primary-color)',
                      color: 'var(--primary-text)',
                      fontWeight: 700
                    }}
                  >
                    Join Room
                  </button>
                )}

                {/* Link Copy Field Box */}
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  width: '100%', 
                  backgroundColor: 'var(--input-bg)', 
                  border: '1px solid var(--input-border)', 
                  borderRadius: 'var(--btn-radius)', 
                  padding: '4px',
                  marginBottom: '8px'
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

      {selectedProfile && (
        <UserProfileCard
          currentUserId={getMyId()}
          targetUser={selectedProfile}
          callParticipants={callParticipants}
          onClose={() => setSelectedProfile(null)}
          onSelectUser={(profile) => setSelectedProfile(profile)}
          showToast={showToast}
          initialView={initialProfileView}
        />
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

      {/* Choose App Theme Modal */}
      {isThemeModalOpen && (
        <div className="modal-overlay" onClick={() => setIsThemeModalOpen(false)} style={{ zIndex: 1200 }}>
          <div className="modal-container animate-fade-in" style={{ maxWidth: '580px', width: '90%', padding: '24px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ marginBottom: '16px' }}>
              <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0, fontSize: '20px', fontWeight: 800 }}>🎨 Choose App Theme</h2>
              <button onClick={() => setIsThemeModalOpen(false)} className="modal-close-btn" aria-label="Close modal">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px', marginTop: 0 }}>
              Select a custom background theme that will automatically apply a matching UI color accent.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div>
                <h3 style={{ fontSize: '14px', margin: '0 0 10px 0', color: 'var(--text-primary)', fontWeight: 700 }}>🖼️ Background Image</h3>
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', 
                  gap: '12px',
                  maxHeight: '380px',
                  overflowY: 'auto',
                  paddingRight: '6px'
                }}>
                  {/* Default/None option */}
                  <div 
                    onClick={() => handleSelectTheme('default')}
                    className="theme-grid-card"
                    style={{
                      border: activeTheme === 'default' ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
                      borderRadius: '10px',
                      padding: '12px',
                      cursor: 'pointer',
                      backgroundColor: 'rgba(255,255,255,0.02)',
                      position: 'relative',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '110px'
                    }}
                  >
                    <div style={{ fontSize: '28px', marginBottom: '8px' }}>🚫</div>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>Default / None</span>
                    {activeTheme === 'default' && (
                      <div style={{ position: 'absolute', top: '8px', right: '8px', backgroundColor: 'var(--primary-color)', color: '#000', borderRadius: '50%', width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 'bold' }}>✓</div>
                    )}
                  </div>

                  {/* Presets mapping */}
                  {THEME_PRESETS.map((preset) => (
                    <div 
                      key={preset.key}
                      onClick={() => handleSelectTheme(preset.key)}
                      className="theme-grid-card"
                      style={{
                        border: activeTheme === preset.key ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
                        borderRadius: '10px',
                        padding: '4px',
                        cursor: 'pointer',
                        backgroundColor: 'rgba(255,255,255,0.02)',
                        position: 'relative',
                        overflow: 'hidden',
                        height: '110px',
                        display: 'flex',
                        flexDirection: 'column'
                      }}
                    >
                      <img 
                        src={preset.imageUrl} 
                        alt={preset.name} 
                        style={{ width: '100%', height: '76px', objectFit: 'cover', borderRadius: '6px', opacity: 0.85 }} 
                      />
                      <span style={{ 
                        fontSize: '11px', 
                        fontWeight: 700, 
                        color: 'var(--text-primary)', 
                        textAlign: 'center', 
                        marginTop: '6px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        padding: '0 4px'
                      }}>
                        {preset.name}
                      </span>
                      {activeTheme === preset.key && (
                        <div style={{ position: 'absolute', top: '8px', right: '8px', backgroundColor: 'var(--primary-color)', color: '#000', borderRadius: '50%', width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 'bold' }}>✓</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
