import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { PermissionStatus } from 'expo-modules-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveAPIContext } from '../contexts/LiveAPIContext'; // Para enviar dados

export interface UseAudioRecorderResult {
  isRecording: boolean;
  volumeIn: number; // Volume de entrada (0-1)
  startRecording: () => Promise<void>;
  stopRecordingAndSend: () => Promise<void>; // Agora envia ao parar
  permissionResponse?: Audio.PermissionResponse;
  hasPermission: boolean | null;
  error: Error | null;
}

const recordingOptions: Audio.RecordingOptions = {
  ...Audio.RecordingOptionsPresets.HIGH_QUALITY, // Começa com preset
  android: {
    ...Audio.RecordingOptionsPresets.HIGH_QUALITY.android,
    extension: '.mp4', // Ou '.m4a'. O formato exato pode variar. Gemini aceita vários.
    // sampleRate: 16000, // Tentar forçar, mas pode não funcionar sempre
    // numberOfChannels: 1,
    // bitRate: 128000,
    outputFormat: Audio.AndroidOutputFormat.MPEG_4, // Tentar formato comum
  },
  ios: {
     ...Audio.RecordingOptionsPresets.HIGH_QUALITY.ios,
    extension: '.m4a', // Formato comum no iOS
    // sampleRate: 16000,
    // numberOfChannels: 1,
    // bitRate: 128000,
     outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
  },
  web: {}, // Não relevante aqui
};


export function useAudioRecorder(): UseAudioRecorderResult {
  const [isRecording, setIsRecording] = useState(false);
  const [volumeIn, setVolumeIn] = useState(0);
  const [permissionResponse, setPermissionResponse] = useState<Audio.PermissionResponse>();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const { client, connected } = useLiveAPIContext(); // Pega o cliente do contexto

  // --- Permissões ---
  const requestPermissions = useCallback(async () => {
    console.log('Requesting microphone permissions...');
    setError(null);
    try {
      const response = await Audio.requestPermissionsAsync();
      setPermissionResponse(response);
      setHasPermission(response.status === PermissionStatus.GRANTED);
      if (response.status !== PermissionStatus.GRANTED) {
        console.warn('Microphone permission not granted.');
         setError(new Error('Microphone permission not granted.'));
      } else {
         console.log('Microphone permission granted.');
      }
    } catch (err: any) {
      console.error('Error requesting microphone permissions:', err);
      setError(err);
      setHasPermission(false);
    }
  }, []);

  // Pede permissão ao montar o hook
  useEffect(() => {
    requestPermissions();
  }, [requestPermissions]);

  // --- Gravação ---
  const startRecording = useCallback(async () => {
    if (!hasPermission) {
      console.warn('Cannot start recording: permission not granted.');
      await requestPermissions(); // Tenta pedir de novo
      if (!permissionResponse || permissionResponse.status !== PermissionStatus.GRANTED) {
           setError(new Error('Cannot start recording without microphone permission.'));
           return;
      }
    }
     if (isRecording) {
         console.warn("Already recording.");
         return;
     }

    setError(null);
    try {
      console.log('Starting recording...');
      // Garante que o modo de áudio permite gravação (feito no useLiveAPI, mas reforça)
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true });

      const { recording } = await Audio.Recording.createAsync(
          recordingOptions,
          (status) => {
            // Atualiza o volume (metering só funciona durante a gravação)
            if (status.isRecording) {
                const db = status.metering ?? -160; // metering em dBFS
                // Converte dBFS para uma escala linear 0-1 (aproximado)
                // -160 dB é silêncio total, 0 dB é o máximo.
                // Esta fórmula é uma aproximação e pode precisar de ajuste.
                const linearVolume = Math.max(0, Math.min(1, 1 + db / 60)); // Ajuste 60dB range?
                setVolumeIn(linearVolume);
            } else {
                 setVolumeIn(0);
            }
            // console.log('Recording status:', status); // Debug
          },
          100 // Intervalo de atualização do status em ms
      );
      recordingRef.current = recording;
      setIsRecording(true);
      console.log('Recording started.');

    } catch (err: any) {
      console.error('Failed to start recording:', err);
      setError(err);
      setIsRecording(false);
      setVolumeIn(0);
      recordingRef.current = null; // Limpa a ref em caso de erro
    }
  }, [hasPermission, isRecording, requestPermissions, permissionResponse]);


  const stopRecordingAndSend = useCallback(async () => {
    if (!isRecording || !recordingRef.current) {
      console.log('Not recording or recordingRef is null.');
      return;
    }
     console.log('Stopping recording...');
    setError(null);
    setIsRecording(false); // Atualiza estado imediatamente
    setVolumeIn(0);

    try {
        await recordingRef.current.stopAndUnloadAsync(); // Para e descarrega
        const uri = recordingRef.current.getURI(); // Pega URI ANTES de limpar ref
        recordingRef.current = null; // Limpa ref após pegar URI

        if (!uri) {
            throw new Error('Failed to get recording URI.');
        }

        console.log('Recording stopped. URI:', uri);

        if (connected && client) {
            console.log('Reading recording file and sending...');
            // Lê o arquivo como base64
            const base64Data = await FileSystem.readAsStringAsync(uri, {
                encoding: FileSystem.EncodingType.Base64,
            });

            console.log(`Read ${base64Data.length} chars of base64 data.`);

            // TODO: Descobrir o MimeType real ou usar um genérico aceito
            // O MimeType depende das recordingOptions. '.m4a' é geralmente 'audio/m4a' ou 'audio/aac'
            // '.mp4' no Android pode ser 'audio/mp4'
            const mimeType = "audio/mp4"; // ASSUMIR um tipo - PRECISA VERIFICAR QUAL É O REAL

            client.sendRealtimeInput([
                { mimeType: mimeType, data: base64Data },
            ]);
            console.log('Sent audio data.');
        } else {
            console.warn("Client not connected, audio data not sent.");
        }

        // Opcional: Excluir o arquivo local após envio
         await FileSystem.deleteAsync(uri, { idempotent: true });
         // console.log("Deleted local recording file:", uri);

    } catch (err: any) {
      console.error('Failed to stop recording or send data:', err);
      setError(err);
       // Garante que o estado de gravação seja falso em caso de erro
       setIsRecording(false);
       setVolumeIn(0);
       recordingRef.current = null;
    }
  }, [isRecording, connected, client]);

  // --- Limpeza ---
  useEffect(() => {
    // Garante que a gravação pare se o componente for desmontado
    return () => {
      if (recordingRef.current) {
        console.log('Cleaning up audio recorder: stopping recording.');
        recordingRef.current.stopAndUnloadAsync().catch((e) => console.warn("Error stopping recording on cleanup:", e));
        recordingRef.current = null;
      }
    };
  }, []);


  return {
    isRecording,
    volumeIn,
    startRecording,
    stopRecordingAndSend,
    permissionResponse,
    hasPermission,
    error,
  };
}