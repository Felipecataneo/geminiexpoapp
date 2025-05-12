import { Audio, AVPlaybackStatus, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av'; // Importar tipos de status
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MultimodalLiveAPIClientConnection,
  MultimodalLiveClient,
} from '../lib/multimodal-live-client';
import { arrayBufferToBase64 } from '../lib/utils';
// Remover imports não utilizados de Content e Part AQUI
import { LiveConfig, StreamingLog } from '../multimodal-live-types';

export type UseLiveAPIResults = {
  client: MultimodalLiveClient;
  config: LiveConfig;
  connected: boolean;
  isConnecting: boolean;
  error: Error | null;
  volumeOut: number;
  connect: () => Promise<void>;
  disconnect: () => void;
  setConfig: (config: LiveConfig) => void;
  sendText: (text: string, turnComplete?: boolean) => void;
};

const defaultInitialConfig: LiveConfig = {
  model: 'models/gemini-2.0-flash-live-001', // Use o modelo desejado aqui
  // model: 'models/gemini-2.0-flash-exp', // Se tiver certeza que é válido
  generationConfig: {
    responseModalities: 'audio',
    speechConfig: {
       voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } }
    }
  },
};

export function useLiveAPI(
  connectionParams: MultimodalLiveAPIClientConnection
): UseLiveAPIResults {
  const [config, setConfig] = useState<LiveConfig>(defaultInitialConfig);
  const [connected, setConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [volumeOut, setVolumeOut] = useState(0);

  const audioSoundRef = useRef<Audio.Sound | null>(null);
  const clientRef = useRef<MultimodalLiveClient | null>(null);

  if (!clientRef.current) {
      console.log("Initializing MultimodalLiveClient...");
      clientRef.current = new MultimodalLiveClient(connectionParams);
  }
  const client = clientRef.current;

  // --- Conexão --- (Mantém igual ao anterior)
  const connect = useCallback(async () => {
    if (connected || isConnecting) {
      console.log('Already connected or connecting.');
      return;
    }
    setError(null);
    setIsConnecting(true);
    console.log('Attempting connection with config:', JSON.stringify(config));
    try {
      await client.connect(config);
    } catch (err: any) {
      console.error('Connection failed:', err);
      setError(err);
      setConnected(false);
      setIsConnecting(false);
    }
  }, [client, config, connected, isConnecting]);

  const disconnect = useCallback(() => {
    // ... (igual ao anterior)
    console.log('Disconnect called');
    if (client) {
        client.disconnect();
    }
    if (audioSoundRef.current) {
        audioSoundRef.current.unloadAsync().catch(e => console.warn("Error unloading sound on disconnect:", e));
        audioSoundRef.current = null;
    }
    setVolumeOut(0);
    setConnected(false);
    setIsConnecting(false);
  }, [client]);

  // --- Envio de Texto --- (Mantém igual ao anterior)
  const sendText = useCallback((text: string, turnComplete: boolean = true) => {
      if (client && connected) {
          console.log(`SENDING TEXT: "${text}", turnComplete: ${turnComplete}`);
          client.send([{ text }], turnComplete);
      } else {
          console.warn("Cannot send text: Client not connected.");
      }
  }, [client, connected]);


  // --- Playback de Áudio ---
  const playAudioChunk = useCallback(async (audioData: ArrayBuffer) => {
    console.log(`PLAYBACK: Received ${audioData.byteLength} bytes of audio data. Attempting to play.`);
    try {
      const base64Data = arrayBufferToBase64(audioData);
      const uri = `data:audio/mpeg;base64,${base64Data}`;

      await Audio.setAudioModeAsync({
           allowsRecordingIOS: true,
           playsInSilentModeIOS: true,
           interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
           interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
           shouldDuckAndroid: true,
           playThroughEarpieceAndroid: false,
      });

      if (audioSoundRef.current) {
        console.log("PLAYBACK: Unloading previous sound...");
        await audioSoundRef.current.stopAsync().catch(e => console.warn("Minor error stopping previous sound:", e));
        await audioSoundRef.current.unloadAsync().catch(e => console.warn("Minor error unloading previous sound:", e));
        audioSoundRef.current = null;
      }

      console.log("PLAYBACK: Creating new sound object...");
      const { sound } = await Audio.Sound.createAsync( // Removido status não utilizado
        { uri },
        { shouldPlay: true, progressUpdateIntervalMillis: 100 },
      );

      console.log("PLAYBACK: Sound created successfully.");
      audioSoundRef.current = sound;

      sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => { // Tipo explícito
        // --- CORREÇÃO AQUI ---
        // Primeiro, verifica se o status indica que o áudio está carregado
        if (status.isLoaded) {
          // Dentro deste bloco, 'status' é do tipo AVPlaybackStatusLoaded
          // e podemos acessar 'isPlaying' com segurança
          if (status.isPlaying) {
             setVolumeOut(0.8); // Simula volume
          } else {
             setVolumeOut(0);
          }
          // Verifica se acabou de terminar
          if (status.didJustFinish) {
             console.log("PLAYBACK: Playback finished.");
             sound.unloadAsync().catch(e => console.warn("Minor error unloading finished sound:", e));
             if (audioSoundRef.current === sound) {
                 audioSoundRef.current = null;
                 setVolumeOut(0);
             }
          }
        } else {
          // Se não está carregado (isLoaded é false), pode ser um erro
          if (status.error) {
            console.error(`Audio playback error: ${status.error}`);
            setError(new Error(`Audio playback error: ${status.error}`));
          }
          // Garante que o volume e a ref sejam limpos se descarregar
          if (audioSoundRef.current === sound) {
             audioSoundRef.current = null;
             setVolumeOut(0);
          }
        }
      });

    } catch (e: any) {
      console.error('Failed to load or play audio:', e);
      setError(e);
      setVolumeOut(0);
      if (audioSoundRef.current) {
           await audioSoundRef.current.unloadAsync().catch(err => console.warn("Error unloading sound on failure:", err));
           audioSoundRef.current = null;
      }
    }
  }, []); // Dependências vazias são ok aqui

   // --- Efeitos para Lidar com Eventos do Cliente --- (Mantém igual ao anterior)
   useEffect(() => {
    if (!client) return;

    const handleOpen = () => { /* ... */ setConnected(true); setIsConnecting(false); setError(null); console.log('>>> useLiveAPI: Connected event received.'); };
    const handleClose = (event: CloseEvent | { code: number; reason: string }) => { /* ... */ if(connected) console.log('>>> useLiveAPI: Close event received. Was connected.'); setConnected(false); setIsConnecting(false); /* não limpa erro */ if (audioSoundRef.current) audioSoundRef.current.unloadAsync(); setVolumeOut(0); };
    const handleError = (err: Error | Event) => { /* ... */ const errorObj = err instanceof Error ? err : new Error(`WebSocket error: ${err.type || 'Unknown'}`); console.error('>>> useLiveAPI: Error event received:', errorObj); setError(errorObj); };
    const handleAudio = (data: ArrayBuffer) => { console.log(">>> useLiveAPI: Received 'audio' event, calling playAudioChunk."); playAudioChunk(data); };
    const handleInterrupted = () => { /* ... */ console.log(">>> useLiveAPI: Interrupted event received."); if (audioSoundRef.current) audioSoundRef.current.stopAsync(); setVolumeOut(0); };
    const handleLog = (log: StreamingLog) => { /* console.log("API Log:", log); */ };

    console.log(">>> useLiveAPI: Adding event listeners to client.");
    client.on('open', handleOpen);
    client.on('close', handleClose);
    client.on('error', handleError);
    client.on('audio', handleAudio);
    client.on('interrupted', handleInterrupted);
    client.on('log', handleLog);

    return () => { /* ... */ console.log(">>> useLiveAPI: Removing event listeners from client."); client.off('open', handleOpen); client.off('close', handleClose); client.off('error', handleError); client.off('audio', handleAudio); client.off('interrupted', handleInterrupted); client.off('log', handleLog); if (audioSoundRef.current) audioSoundRef.current.unloadAsync(); };
  }, [client, playAudioChunk, disconnect, connected]);

  // --- Configuração de áudio global do Expo --- (Mantém igual ao anterior)
  useEffect(() => {
    const setupAudioMode = async () => { /* ... */ console.log("Setting global audio mode..."); try { await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true, interruptionModeIOS: InterruptionModeIOS.MixWithOthers, interruptionModeAndroid: InterruptionModeAndroid.DuckOthers, shouldDuckAndroid: true, playThroughEarpieceAndroid: false, }); console.log("Audio mode set successfully."); } catch (e) { console.error("Failed to set audio mode", e); } };
    setupAudioMode();
  }, []);

  return {
    client, config, connected, isConnecting, error, volumeOut,
    connect, disconnect, setConfig, sendText,
  };
}