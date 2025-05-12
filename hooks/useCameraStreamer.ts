import {
  CameraCapturedPicture,
  Camera as CameraUtils, // Static Utils
  CameraView,
  PermissionResponse, // Correct Permission Type
  PermissionStatus
} from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react'; // Import React
import { useLiveAPIContext } from '../contexts/LiveAPIContext'; // Para enviar dados

export interface UseCameraStreamerResult {
  isStreaming: boolean;
  startStreaming: (cameraInstance: CameraView) => void; // Expects instance
  stopStreaming: () => void;
  permissionResponse?: PermissionResponse; // Correct type
  hasPermission: boolean | null;
  error: Error | null;
}

const FRAME_INTERVAL_MS = 1000; // Intervalo entre frames (1 segundo)
const IMAGE_QUALITY = 0.3;      // Qualidade da imagem (0 a 1)

export function useCameraStreamer(): UseCameraStreamerResult {
  const [isStreaming, setIsStreaming] = useState(false);
  const [permissionResponse, setPermissionResponse] = useState<PermissionResponse>(); // Correct type
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const cameraRefInternal = useRef<CameraView | null>(null); // Ref to instance

  const { client, connected } = useLiveAPIContext();

  // --- Permissões ---
  const requestPermissions = useCallback(async () => {
    console.log('Requesting camera permissions...');
    setError(null);
    try {
      const response = await CameraUtils.requestCameraPermissionsAsync(); // Use static utils
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

  // Pede permissão ao montar
  useEffect(() => {
    requestPermissions();
  }, [requestPermissions]);


  // --- Define stopStreaming FIRST ---
  const stopStreaming = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    // Only update state and log if it was actually streaming
    if (isStreaming) {
        console.log('Camera stream stopped.');
        setIsStreaming(false);
    }
    // Clear the internal ref when stopping
    cameraRefInternal.current = null;
  }, [isStreaming]); // Depends only on isStreaming


  // --- Define takePictureAndSend AFTER stopStreaming ---
  const takePictureAndSend = useCallback(async () => {
    const currentCamera = cameraRefInternal.current; // Capture ref value at start of call
    if (!connected || !client || !currentCamera || !isStreaming) {
      // Avoid logging spam if stream is just not active
      // if (!connected && isStreaming) {
      //    console.warn("Stopping camera stream due to disconnection.");
      //    stopStreaming(); // Consider stopping if disconnected
      // }
      return;
    }

    try {
      // No need for null check here due to check above
      const photo: CameraCapturedPicture | undefined = await currentCamera.takePictureAsync({
        quality: IMAGE_QUALITY,
        base64: true,
        skipProcessing: true, // Generally okay for base64
      });

      if (photo?.base64) {
        const b64Length = photo.base64.length;
        console.log(`VIDEO: Preparing to send frame (base64 length: ${b64Length}). MimeType: image/jpeg`); // Log antes
        if(client) { // Double-check client
            client.sendRealtimeInput([
              { mimeType: 'image/jpeg', data: photo.base64 },
            ]);
            // console.log('VIDEO: Sent frame via client.'); // Log após (can be verbose)
        } else {
             console.warn("VIDEO: Client became unavailable before sending frame.");
        }
      } else {
         console.warn("VIDEO: takePictureAsync did not return base64 data.");
      }
    } catch (err: any) {
      // Check if the error is common (unmounted component) or unexpected
       if (err.message?.includes('component could not be found') || err.message?.includes('unmounted')) {
          console.warn('Camera component likely unmounted during takePictureAsync.');
       } else {
          console.error('Failed to take or send picture:', err);
          setError(err); // Set error state only for unexpected errors
       }
      // Always attempt to stop streaming on ANY error during capture
      stopStreaming();
    }
    // stopStreaming is stable because its dependency (isStreaming) is managed by useState
  }, [connected, client, isStreaming, stopStreaming]); // Include stopStreaming


  // --- Controle do Stream ---
  const startStreaming = useCallback((cameraInstance: CameraView) => {
     if (!hasPermission) {
      console.warn('Cannot start streaming: camera permission not granted. Requesting again...');
       requestPermissions();
       // Check grant status from state AFTER requesting
       if (!permissionResponse?.granted) { // Use optional chaining
            setError(new Error('Cannot start streaming without camera permission.'));
            return; // Exit if still not granted
       }
    }
    if (isStreaming || intervalRef.current) {
      console.warn('Already streaming or interval exists.');
       // Optionally clear existing interval if starting again somehow
       if (intervalRef.current) clearInterval(intervalRef.current);
      // return; // Decide if restart should be blocked or allowed
    }

    console.log('Starting camera stream...');
    setError(null);
    cameraRefInternal.current = cameraInstance; // Assign the passed instance
    setIsStreaming(true);

    // Clear interval just before setting a new one (robustness)
    if (intervalRef.current) {
        clearInterval(intervalRef.current);
    }

    // Tira uma foto imediatamente e depois inicia o intervalo
    takePictureAndSend(); // Call the function (defined above)
    intervalRef.current = setInterval(takePictureAndSend, FRAME_INTERVAL_MS);

  }, [hasPermission, isStreaming, takePictureAndSend, requestPermissions, permissionResponse]);


  // --- Limpeza ---
  useEffect(() => {
    // Return the cleanup function from the effect
    return () => {
      console.log("Cleaning up camera streamer...");
      stopStreaming(); // Call the stable stop function
    };
  }, [stopStreaming]); // Ensure stopStreaming is stable

  return {
    isStreaming,
    startStreaming,
    stopStreaming,
    permissionResponse,
    hasPermission,
    error,
  };
}