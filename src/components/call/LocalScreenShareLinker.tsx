import { useEffect, useRef } from 'react';
import { useLocalParticipant } from '@livekit/components-react';
import { Track, LocalVideoTrack } from 'livekit-client';

export function LocalScreenShareLinker({ screenShareStream }: { screenShareStream: MediaStream | null }) {
  const { localParticipant } = useLocalParticipant();
  const publishedTrackRef = useRef<LocalVideoTrack | null>(null);

  useEffect(() => {
    if (!localParticipant) return;

    if (screenShareStream) {
      const videoTrack = screenShareStream.getVideoTracks()[0];
      if (videoTrack) {
        console.log("Publishing local screen share track to LiveKit:", videoTrack);
        try {
          const localTrack = new LocalVideoTrack(videoTrack);
          publishedTrackRef.current = localTrack;
          localParticipant.publishTrack(localTrack, { source: Track.Source.ScreenShare })
            .then((publication) => {
              console.log("Successfully published screen share track:", publication);
            })
            .catch((err) => {
              console.error("Failed to publish screen share track:", err);
            });
        } catch (e) {
          console.error("Failed to construct LocalVideoTrack:", e);
        }
      }
    } else {
      if (publishedTrackRef.current) {
        console.log("Unpublishing tracked screen share track:", publishedTrackRef.current);
        try {
          localParticipant.unpublishTrack(publishedTrackRef.current);
        } catch (e) {
          console.warn("Failed to unpublish tracked screen share:", e);
        }
        publishedTrackRef.current = null;
      }

      // Cleanup any other screen share publications
      const publications = localParticipant.getTrackPublications();
      publications.forEach(pub => {
        if (pub.source === Track.Source.ScreenShare) {
          const track = pub.track || pub.videoTrack;
          if (track) {
            console.log("Cleaning up screen share track from publication:", track);
            try {
              localParticipant.unpublishTrack(track as any);
            } catch (e) {
              console.warn("Failed to unpublish publication track:", e);
            }
          }
        }
      });
    }
  }, [screenShareStream, localParticipant]);

  return null;
}
