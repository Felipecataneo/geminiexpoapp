// hooks/useCameraStreamer.ts
import {
  CameraCapturedPicture,
  Camera as CameraUtils,
  CameraView,
  PermissionResponse,
  PermissionStatus
} from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveAPIContext } from '../contexts/LiveAPIContext';

export interface UseCameraStreamerResult {
  isStreaming: boolean;
  startStreaming: (cameraInstance: CameraView) => void;
  stopStreaming: () => void;
  permissionResponse?: PermissionResponse;
  hasPermission: boolean | null;
  error: Error | null;
}

const FRAME_INTERVAL_MS = 1000;
const IMAGE_QUALITY = 0.3;

export function useCameraStreamer(): UseCameraStreamerResult {
  const [isStreaming, setIsStreaming] = useState(false);
  const [permissionResponse, setPermissionResponse] = useState<PermissionResponse>();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // Changed type to number for client-side setInterval return
  const intervalRef = useRef<number | null>(null);
  const cameraRefInternal = useRef<CameraView | null>(null);

  const { client, connected } = useLiveAPIContext();

  const requestPermissions = useCallback(async () => {
    console.log('Requesting camera permissions...');
    setError(null);
    try {
      const response = await CameraUtils.requestCameraPermissionsAsync();
      setPermissionResponse(response);
      setHasPermission(response.status === PermissionStatus.GRANTED);
      if (response.status !== PermissionStatus.GRANTED) {
        console.warn('Camera permission not granted.');
        setError(new Error('Camera permission not granted.'));
      } else {
         console.log('Camera permission granted.');
      }
    } catch (err: any) {
      console.error('Error requesting camera permissions:', err);
      setError(err);
      setHasPermission(false);
    }
  }, []);

  useEffect(() => {
    requestPermissions();
  }, [requestPermissions]);


  const stopStreaming = useCallback(() => {
    if (intervalRef.current !== null) { // Check against null
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (isStreaming) { // Only update state and log if it was actually streaming
        console.log('Camera stream stopped.');
        setIsStreaming(false);
    }
    cameraRefInternal.current = null; // Clear the internal ref
  }, [isStreaming]); // Depends only on isStreaming


  const takePictureAndSend = useCallback(async () => {
    const currentCamera = cameraRefInternal.current;
    if (!connected || !client || !currentCamera || !isStreaming) {
      return;
    }

    try {
      const photo: CameraCapturedPicture | undefined = await currentCamera.takePictureAsync({
        quality: IMAGE_QUALITY,
        base64: true,
        skipProcessing: true, // Generally okay for base64
      });

      if (photo?.base64) {
        let base64Data = photo.base64;
        const prefix = "data:image/jpeg;base64,";
        if (base64Data.startsWith(prefix)) {
          // console.log("VIDEO: Stripping JPEG data URI prefix.");
          base64Data = base64Data.substring(prefix.length);
        }
        // const b64Length = base64Data.length;
        // console.log(`VIDEO: Preparing to send frame (base64 length: ${b64Length}). MimeType: image/jpeg`);

        if(client) {
            client.sendRealtimeInput([
              { mimeType: 'image/jpeg', data: base64Data },
            ]);
        } else {
             console.warn("VIDEO: Client became unavailable before sending frame.");
        }
      } else {
         console.warn("VIDEO: takePictureAsync did not return base64 data.");
      }
    } catch (err: any) {
       if (err.message?.includes('component could not be found') || err.message?.includes('unmounted')) {
          console.warn('Camera component likely unmounted during takePictureAsync.');
       } else {
          console.error('Failed to take or send picture:', err);
          setError(err);
       }
      stopStreaming(); // Attempt to stop on any error during capture
    }
  }, [connected, client, isStreaming, stopStreaming]);


  const startStreaming = useCallback((cameraInstance: CameraView) => {
     if (!hasPermission) {
      console.warn('Cannot start streaming: camera permission not granted. Requesting again...');
       requestPermissions(); // Request permission
       // Important: The permission state (hasPermission) will update asynchronously.
       // For immediate check after request, you might need to await requestPermissions()
       // or check permissionResponse.granted directly if requestPermissions updates it synchronously.
       // However, the effect of requestPermissions updating hasPermission state will eventually
       // allow this to proceed on a subsequent call if permission is granted.
       // For now, we'll proceed, and if it fails due to no permission, it fails.
       // A more robust way would be to await requestPermissions() and then check its outcome.
       if (!permissionResponse?.granted && !hasPermission) { // Check both after trying
            setError(new Error('Cannot start streaming without camera permission.'));
            return;
       }
    }
    if (isStreaming || intervalRef.current !== null) {
      console.warn('Already streaming or interval exists. Stopping existing before restart.');
       if (intervalRef.current !== null) {
           clearInterval(intervalRef.current);
           intervalRef.current = null;
       }
       // Do not return; allow restart.
    }

    console.log('Starting camera stream...');
    setError(null);
    cameraRefInternal.current = cameraInstance;
    setIsStreaming(true);

    if (intervalRef.current !== null) { // Defensive clear
        clearInterval(intervalRef.current);
    }

    takePictureAndSend();
    // Use window.setInterval for DOM-like environments
    intervalRef.current = window.setInterval(takePictureAndSend, FRAME_INTERVAL_MS);

  }, [hasPermission, isStreaming, takePictureAndSend, requestPermissions, permissionResponse]);


  useEffect(() => {
    return () => {
      console.log("Cleaning up camera streamer...");
      stopStreaming();
    };
  }, [stopStreaming]); // stopStreaming is stable

  return {
    isStreaming,
    startStreaming,
    stopStreaming,
    permissionResponse,
    hasPermission,
    error,
  };
}