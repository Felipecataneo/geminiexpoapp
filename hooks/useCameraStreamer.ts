import { Camera, CameraCapturedPicture, PermissionStatus } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveAPIContext } from '../contexts/LiveAPIContext'; // Para enviar dados

export interface UseCameraStreamerResult {
  isStreaming: boolean;
  startStreaming: (cameraRef: React.RefObject<Camera>) => void;
  stopStreaming: () => void;
  permissionResponse?: Camera.PermissionResponse;
  hasPermission: boolean | null;
  error: Error | null;
}

const FRAME_INTERVAL_MS = 1000; // Intervalo entre frames (1 segundo) - ajuste conforme necessário
const IMAGE_QUALITY = 0.3; // Qualidade da imagem (0 a 1) - menor para performance

export function useCameraStreamer(): UseCameraStreamerResult {
  const [isStreaming, setIsStreaming] = useState(false);
  const [permissionResponse, setPermissionResponse] = useState<Camera.PermissionResponse>();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const cameraRefInternal = useRef<Camera | null>(null); // Ref interna para a câmera

  const { client, connected } = useLiveAPIContext();

  // --- Permissões ---
  const requestPermissions = useCallback(async () => {
    console.log('Requesting camera permissions...');
    setError(null);
    try {
      const response = await Camera.requestCameraPermissionsAsync();
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

  // --- Captura e Envio ---
  const takePictureAndSend = useCallback(async () => {
     if (!connected || !client || !cameraRefInternal.current || !isStreaming) {
      // console.log("Conditions not met for taking picture:", { connected, clientExists: !!client, cameraRefExists: !!cameraRefInternal.current, isStreaming });
      // Parar o stream se desconectado
      if (!connected && isStreaming) {
           console.warn("Stopping camera stream due to disconnection.");
           stopStreaming(); // Chama a função de parada
      }
      return;
    }

    // console.log("Taking picture...");
    try {
      const photo: CameraCapturedPicture | undefined = await cameraRefInternal.current.takePictureAsync({
        quality: IMAGE_QUALITY,
        base64: true,
        skipProcessing: true, // Mais rápido, mas pode afetar orientação/exif
      });

      if (photo?.base64) {
        // console.log(`Sending frame (base64 length: ${photo.base64.length})`);
        client.sendRealtimeInput([
          { mimeType: 'image/jpeg', data: photo.base64 },
        ]);
      } else {
         console.warn("takePictureAsync did not return base64 data.");
      }
    } catch (err: any) {
      console.error('Failed to take or send picture:', err);
      setError(err);
      stopStreaming(); // Para o stream em caso de erro na captura
    }
  }, [connected, client, isStreaming]); // Adiciona isStreaming como dependência

  // --- Controle do Stream ---
  const startStreaming = useCallback((cameraRef: React.RefObject<Camera>) => {
     if (!hasPermission) {
      console.warn('Cannot start streaming: camera permission not granted.');
       requestPermissions(); // Tenta pedir de novo
       if (!permissionResponse || permissionResponse.status !== PermissionStatus.GRANTED) {
            setError(new Error('Cannot start streaming without camera permission.'));
            return;
       }
    }
    if (isStreaming || intervalRef.current) {
      console.warn('Already streaming.');
      return;
    }
     if (!cameraRef.current) {
         console.error("Cannot start streaming: Camera ref is not set.");
         setError(new Error("Camera component reference is missing."));
         return;
     }

    console.log('Starting camera stream...');
    setError(null);
    cameraRefInternal.current = cameraRef.current; // Armazena a ref
    setIsStreaming(true);
    // Tira uma foto imediatamente e depois inicia o intervalo
    takePictureAndSend();
    intervalRef.current = setInterval(takePictureAndSend, FRAME_INTERVAL_MS);

  }, [hasPermission, isStreaming, takePictureAndSend, requestPermissions, permissionResponse]); // Adiciona takePictureAndSend

  const stopStreaming = useCallback(() => {
    if (intervalRef.current) {
      console.log('Stopping camera stream.');
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsStreaming(false);
    cameraRefInternal.current = null; // Limpa a ref interna
  }, []);

  // --- Limpeza ---
  useEffect(() => {
    // Garante que o intervalo pare se o componente for desmontado
    return () => {
      stopStreaming();
    };
  }, [stopStreaming]);

  return {
    isStreaming,
    startStreaming,
    stopStreaming,
    permissionResponse,
    hasPermission,
    error,
  };
}