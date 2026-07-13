import { memo } from 'react';
import { VideoTrack, useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';

export const ParticipantVideo = memo(function ParticipantVideo({ 
  participantId, 
  objectFit = 'contain' 
}: { 
  participantId: string; 
  objectFit?: 'contain' | 'cover';
}) {
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: false }]);
  const trackRef = tracks.find(t => t.participant.identity === participantId) as any;

  if (!trackRef) return null;

  return (
    <VideoTrack 
      trackRef={trackRef} 
      style={{ 
        width: '100%', 
        height: '100%', 
        objectFit: objectFit, 
        borderRadius: '8px',
        position: 'absolute',
        top: 0,
        left: 0,
        zIndex: 1,
        backgroundColor: '#0f1013'
      }} 
    />
  );
});

export const ScreenShareVideo = memo(function ScreenShareVideo({ participantId }: { participantId: string }) {
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
