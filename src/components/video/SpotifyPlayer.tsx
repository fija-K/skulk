import { useRef } from 'react';

export function SpotifyPlayer({
  spotifyUri
}: {
  spotifyUri: string;
  isPresenter?: boolean;
  presenterId?: string;
  roomId?: string;
  myId?: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', position: 'relative' }}>
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
    </div>
  );
}
