import { useEffect } from 'react';
import { useLocalParticipant } from '@livekit/components-react';
import { Track } from 'livekit-client';

export function LocalScreenShareLinker({ screenShareStream }: { screenShareStream: MediaStream | null }) {
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
