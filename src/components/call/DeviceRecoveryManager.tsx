import { useEffect } from 'react';
import { useLocalParticipant, useConnectionState } from '@livekit/components-react';
import { Track } from 'livekit-client';

export function DeviceRecoveryManager({ 
  isCamOff, 
  isMicMuted,
  onErrorChange 
}: { 
  isCamOff: boolean; 
  isMicMuted: boolean;
  onErrorChange: (camErr: boolean, micErr: boolean) => void;
}) {
  const { localParticipant } = useLocalParticipant();
  const connectionState = useConnectionState();

  useEffect(() => {
    if (!localParticipant || connectionState !== 'connected') return;

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

    const onRetryDevice = (e: any) => {
      const deviceType = e.detail;
      if (deviceType === 'camera') {
        handleCameraRecovery();
      } else if (deviceType === 'microphone') {
        handleMicRecovery();
      }
    };

    window.addEventListener('media-devices-error', onMediaError as any);
    window.addEventListener('retry-device', onRetryDevice);

    return () => {
      window.removeEventListener('media-devices-error', onMediaError as any);
      window.removeEventListener('retry-device', onRetryDevice);
    };
  }, [localParticipant, isCamOff, isMicMuted, onErrorChange, connectionState]);

  return null;
}
