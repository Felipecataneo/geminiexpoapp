import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { PermissionStatus } from 'expo-modules-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveAPIContext } from '../contexts/LiveAPIContext';

export interface UseAudioRecorderResult {
  isRecording: boolean;
  volumeIn: number;
  startRecording: () => Promise<void>;
  stopRecordingAndSend: () => Promise<void>;
  permissionResponse?: Audio.PermissionResponse;
  hasPermission: boolean | null;
  error: Error | null;
}

// --- Definição segura das opções de gravação ---
// (Mantém a definição segura anterior)
let recordingOptions: Audio.RecordingOptions | undefined = Audio.RecordingOptionsPresets.HIGH_QUALITY;
if (!recordingOptions) { /* ... fallback manual ... */
    console.warn("Audio.RecordingOptionsPresets.HIGH_QUALITY is undefined! Falling back to basic options.");
    recordingOptions = {
        android: {
            extension: '.mp4',
            outputFormat: Audio.AndroidOutputFormat.MPEG_4,
            audioEncoder: Audio.AndroidAudioEncoder.AAC,
            sampleRate: 44100,
            numberOfChannels: 2,
            bitRate: 128000,
        },
        ios: {
            extension: '.m4a',
            outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
            audioQuality: Audio.IOSAudioQuality.MAX,
            sampleRate: 44100,
            numberOfChannels: 2,
            bitRate: 128000,
            linearPCMBitDepth: 16,
            linearPCMIsBigEndian: false,
            linearPCMIsFloat: false,
        },
        web: {
            mimeType: 'audio/webm',
            bitsPerSecond: 128000,
        },
    };
} else { /* ... personalização segura ... */
    if (!recordingOptions.android) recordingOptions.android = {
        extension: '.mp4',
        outputFormat: Audio.AndroidOutputFormat.MPEG_4,
        audioEncoder: Audio.AndroidAudioEncoder.AAC,
        sampleRate: 44100,
        numberOfChannels: 2,
        bitRate: 128000,
    };
    else { /* ... customize android ... */ recordingOptions.android.extension = '.mp4'; recordingOptions.android.outputFormat = Audio.AndroidOutputFormat.MPEG_4; }
    if (!recordingOptions.ios) recordingOptions.ios = {
        extension: '.m4a',
        outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
        audioQuality: Audio.IOSAudioQuality.MAX,
        sampleRate: 44100,
        numberOfChannels: 2,
        bitRate: 128000,
        linearPCMBitDepth: 16,
        linearPCMIsBigEndian: false,
        linearPCMIsFloat: false,
    };
    else { /* ... customize ios ... */ recordingOptions.ios.extension = '.m4a'; recordingOptions.ios.outputFormat = Audio.IOSOutputFormat.MPEG4AAC; }
    if (!recordingOptions.web) recordingOptions.web = { /* ... defaults ... */ };
}
recordingOptions.isMeteringEnabled = true;
// --- Fim da definição segura ---


export function useAudioRecorder(): UseAudioRecorderResult {
  const [isRecording, setIsRecording] = useState(false);
  const [volumeIn, setVolumeIn] = useState(0);
  const [permissionResponse, setPermissionResponse] = useState<Audio.PermissionResponse>();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const { client, connected } = useLiveAPIContext();

  // --- Permissões ---
  const requestPermissions = useCallback(async () => {
    console.log('Requesting microphone permissions...');
    setError(null);
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
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
      console.error('Error requesting microphone permissions or setting audio mode:', err);
      setError(err);
      setHasPermission(false);
    }
  }, []);

  useEffect(() => {
    requestPermissions();
  }, [requestPermissions]);


  // --- MOVER stopRecordingAndSend PARA ANTES de startRecording ---
  const stopRecordingAndSend = useCallback(async () => {
    if (!isRecording || !recordingRef.current) {
        if (isRecording) console.log('Stop called but isRecording is false or recordingRef is null.');
        return;
    }

    const recordingInstance = recordingRef.current;
    console.log('Stopping recording (instance grabbed)...');
    recordingRef.current = null;
    setIsRecording(false);
    setVolumeIn(0);
    setError(null);

    try {
        console.log('Calling stopAndUnloadAsync...');
        const status = await recordingInstance.stopAndUnloadAsync();
        console.log('stopAndUnloadAsync completed, status:', status);

        const uri = recordingInstance.getURI();
        if (!uri) {
            throw new Error('Failed to get recording URI after stopping.');
        }
        console.log('Recording stopped. URI:', uri);

        if (connected && client) {
            console.log('Reading recording file for sending...');
            const base64Data = await FileSystem.readAsStringAsync(uri, {
                encoding: FileSystem.EncodingType.Base64,
            });

            let mimeType = 'audio/mp4'; // Default
            const extension = uri.split('.').pop()?.toLowerCase();
            if (extension === 'm4a') {
                mimeType = 'audio/m4a';
            } else if (extension === 'mp4') {
                mimeType = 'audio/mp4';
            }
            console.log(`AUDIO: Preparing to send ${base64Data.length} base64 chars. MimeType: ${mimeType}`);

            if (client) {
                client.sendRealtimeInput([
                    { mimeType: mimeType, data: base64Data },
                ]);
                console.log('AUDIO: Sent audio data via client.');
            } else {
                 console.warn("AUDIO: Client became unavailable just before sending.");
            }

            console.log("Attempting to delete local recording file:", uri);
            await FileSystem.deleteAsync(uri, { idempotent: true }).catch(e => console.warn("Failed to delete sent file:", e));
            console.log("Deleted local recording file.");

        } else {
            console.warn("Client not connected when stop completed, audio data not sent.");
            console.log("Attempting to delete unsent local recording file:", uri);
            await FileSystem.deleteAsync(uri, { idempotent: true }).catch(e => console.warn("Failed to delete unsent file:", e));
        }

    } catch (err: any) {
      console.error('Failed during stop, unload, read or send:', err);
      setError(err);
    }
  }, [isRecording, connected, client]); // Dependencies para stopRecordingAndSend


  // --- Gravação ---
  const startRecording = useCallback(async () => {
    if (!hasPermission) {
      console.warn('Cannot start recording: permission not granted. Requesting again...');
      await requestPermissions();
      const currentPermissions = await Audio.getPermissionsAsync();
      if (currentPermissions.status !== PermissionStatus.GRANTED) {
           setError(new Error('Cannot start recording without microphone permission.'));
           setHasPermission(false);
           return;
      }
      setHasPermission(true);
    }
     if (isRecording) {
         console.warn("Already recording.");
         return;
     }

    setError(null);
    try {
      console.log('Starting recording with options:', recordingOptions);
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });

      if (recordingRef.current) {
          console.warn("Cleaning up previous recording instance before starting new one.");
          // Chame stopRecordingAndSend para garantir a limpeza correta, se aplicável
          // await stopRecordingAndSend(); // CUIDADO: pode causar loop se chamado incorretamente
          // Ou apenas descarregue:
           await recordingRef.current.stopAndUnloadAsync().catch(e => console.warn("Minor error unloading previous recording before start:", e));
          recordingRef.current = null;
      }

      const { recording, status } = await Audio.Recording.createAsync(
          recordingOptions,
          (status: Audio.RecordingStatus) => { // Tipo explícito aqui
            // --- CORREÇÃO DO STATUS CALLBACK ---
            // Apenas verifica isRecording e metering
            if (status.isRecording) {
                const db = status.metering ?? -160;
                const linearVolume = Math.max(0, Math.min(1, 1 + db / 60));
                setVolumeIn(linearVolume);
            } else {
                 setVolumeIn(0);
                 // Opcional: Log se parar inesperadamente (isDoneRecording)
                 if (status.isDoneRecording && isRecording) {
                     console.warn("Recording status indicates done, but component state is still 'recording'. Potential issue or pending stop.");
                     // NÃO chame stopRecordingAndSend daqui para evitar loops infinitos.
                 }
            }
            // Remover verificações de status.isLoaded e status.error
          },
          100
      );
      console.log("Recording instance created, initial status:", status);
      recordingRef.current = recording;
      setIsRecording(true);
      console.log('Recording started.');

    } catch (err: any) {
      console.error('Failed to start recording:', err);
      setError(err);
      setIsRecording(false);
      setVolumeIn(0);
      recordingRef.current = null;
    }
  // Removido stopRecordingAndSend das dependências de startRecording para evitar complexidade,
  // a limpeza antes de iniciar é feita explicitamente acima.
  }, [hasPermission, isRecording, requestPermissions]);


   // --- Limpeza ---
   useEffect(() => {
    return () => {
      if (recordingRef.current) {
        console.log('Cleaning up audio recorder: stopping recording on unmount.');
        const recToClean = recordingRef.current;
        recordingRef.current = null;
        recToClean.stopAndUnloadAsync()
          .then(() => console.log("Recording stopped cleanly on unmount."))
          .catch((e) => console.warn("Error stopping recording on cleanup:", e));
        // Reset state on unmount regardless of previous state to prevent memory leaks
        // Although state won't update after unmount, good practice.
        // setIsRecording(false);
        // setVolumeIn(0);
      }
    };
   }, []); // Empty deps for unmount cleanup


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