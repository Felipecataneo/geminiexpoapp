import {
    CameraCapturedPicture,
    Camera as CameraUtils,
    CameraView,
    PermissionResponse,
    PermissionStatus
} from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react'; // Import React
import { useLiveAPIContext } from '../contexts/LiveAPIContext';

export interface UseCameraStreamerResult {
  isStreaming: boolean;
  // --- Accept the CameraView instance directly ---
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
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  // Internal ref still holds the instance
  const cameraRefInternal = useRef<CameraView | null>(null);

  const { client, connected } = useLiveAPIContext();

  const requestPermissions = useCallback(async () => {
    // ... (permission logic remains the same)
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
    // ... (stopStreaming logic remains the same)
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (isStreaming) {
        console.log('Camera stream stopped.');
        setIsStreaming(false);
    }
    cameraRefInternal.current = null;
  }, [isStreaming]);

  const takePictureAndSend = useCallback(async () => {
    // ... (takePictureAndSend logic remains the same, uses cameraRefInternal)
     if (!connected || !client || !cameraRefInternal.current || !isStreaming) {
        if (!connected && isStreaming) {
           console.warn("Stopping camera stream due to disconnection.");
        }
      return;
    }
    try {
      if (!cameraRefInternal.current) {
          console.warn("takePictureAndSend called but internal ref is null");
          return;
      }
      const photo: CameraCapturedPicture | undefined = await cameraRefInternal.current.takePictureAsync({
        quality: IMAGE_QUALITY,
        base64: true,
        skipProcessing: true,
      });
      // ... (rest of takePictureAndSend)
       if (photo?.base64) {
        client.sendRealtimeInput([
          { mimeType: 'image/jpeg', data: photo.base64 },
        ]);
      } else {
         console.warn("takePictureAsync did not return base64 data.");
      }
    } catch (err: any) {
      if (err.message?.includes('component could not be found') || err.message?.includes('unmounted')) {
          console.warn('Camera component likely unmounted during takePictureAsync.');
      } else {
          console.error('Failed to take or send picture:', err);
          setError(err);
      }
      stopStreaming();
    }
  }, [connected, client, isStreaming, stopStreaming]);


  // --- Change parameter to accept CameraView instance ---
  const startStreaming = useCallback((cameraInstance: CameraView) => {
     // No need to check cameraInstance here, the caller ensures it's not null
     if (!hasPermission) {
      console.warn('Cannot start streaming: camera permission not granted.');
       requestPermissions();
       if (!permissionResponse?.granted) {
            setError(new Error('Cannot start streaming without camera permission.'));
            return;
       }
    }
    if (isStreaming || intervalRef.current) {
      console.warn('Already streaming.');
      return;
    }
     // No need for the null check on cameraInstance here

    console.log('Starting camera stream...');
    setError(null);
    // --- Assign the passed instance directly ---
    cameraRefInternal.current = cameraInstance;
    setIsStreaming(true);

    if (intervalRef.current) {
        clearInterval(intervalRef.current);
    }

    takePictureAndSend();
    intervalRef.current = setInterval(takePictureAndSend, FRAME_INTERVAL_MS);

  // Dependencies might change slightly if you remove reliance on external ref checks
  }, [hasPermission, isStreaming, takePictureAndSend, requestPermissions, permissionResponse]);


  useEffect(() => {
    return () => {
      stopStreaming();
    };
  }, [stopStreaming]);

  return {
    isStreaming,
    startStreaming, // Now expects CameraView instance
    stopStreaming,
    permissionResponse,
    hasPermission,
    error,
  };
}