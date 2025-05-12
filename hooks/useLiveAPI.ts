import { Audio } from 'expo-av';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    MultimodalLiveAPIClientConnection,
    MultimodalLiveClient,
} from '../lib/multimodal-live-client'; // Ajuste o caminho
import { arrayBufferToBase64 } from '../lib/utils'; // Ajuste o caminho
import { LiveConfig, StreamingLog } from '../multimodal-live-types'; // Ajuste o caminho

export type UseLiveAPIResults = {
  client: MultimodalLiveClient;
  config: LiveConfig;
  connected: boolean;
  isConnecting: boolean;
  error: Error | null;
  volumeOut: number; // Volume de playback (0-1)
  connect: () => Promise<void>;
  disconnect: () => void;
  setConfig: (config: LiveConfig) => void;
  sendText: (text: string, turnComplete?: boolean) => void; // Helper para enviar texto
  // Expor outros métodos do client se necessário (sendRealtimeInput, sendToolResponse)
};

const defaultInitialConfig: LiveConfig = {
  // Use um modelo mais recente ou o específico que você precisa
  model: 'models/gemini-1.5-flash-latest', // ou gemini-1.5-pro-latest
  // Você pode definir um systemInstruction padrão aqui
  // systemInstruction: { parts: [{ text: "You are a helpful vision assistant." }] },
  generationConfig: {
    responseModalities: 'audio', // Padrão para resposta em áudio
    // Configuração de voz padrão (opcional)
    speechConfig: {
       voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } } // Escolha uma voz
    }
  },
  // tools: [] // Adicione ferramentas aqui se necessário
};

export function useLiveAPI(
  connectionParams: MultimodalLiveAPIClientConnection
): UseLiveAPIResults {
  const [config, setConfig] = useState<LiveConfig>(defaultInitialConfig);
  const [connected, setConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [volumeOut, setVolumeOut] = useState(0); // Volume de playback

  const audioSoundRef = useRef<Audio.Sound | null>(null);
  const clientRef = useRef<MultimodalLiveClient | null>(null);


  // Inicializa o cliente apenas uma vez
  if (!clientRef.current) {
      clientRef.current = new MultimodalLiveClient(connectionParams);
  }
  const client = clientRef.current;


  // --- Conexão ---

  const connect = useCallback(async () => {
    if (connected || isConnecting) {
      console.log('Already connected or connecting.');
      return;
    }
    setError(null);
    setIsConnecting(true);
    console.log('Attempting connection with config:', config);

    try {
      await client.connect(config);
      // O estado 'connected' será definido pelo listener 'open' abaixo
    } catch (err: any) {
      console.error('Connection failed:', err);
      setError(err);
      setConnected(false); // Garante que está desconectado
    } finally {
        setIsConnecting(false);
    }
  }, [client, config, connected, isConnecting]);

  const disconnect = useCallback(() => {
    console.log('Disconnect called');
    client.disconnect(); // O listener 'close' cuidará de setConnected(false)
    // Limpa o som ao desconectar
    if (audioSoundRef.current) {
        audioSoundRef.current.unloadAsync().catch(e => console.warn("Error unloading sound on disconnect:", e));
        audioSoundRef.current = null;
    }
    setVolumeOut(0);
  }, [client]);

  // --- Envio de Texto (Helper) ---
  const sendText = useCallback((text: string, turnComplete: boolean = true) => {
      if (client && connected) {
          client.send([{ text }], turnComplete);
      } else {
          console.warn("Cannot send text: Client not connected.");
      }
  }, [client, connected]);


  // --- Playback de Áudio ---

  const playAudioChunk = useCallback(async (audioData: ArrayBuffer) => {
    try {
      const base64Data = arrayBufferToBase64(audioData);
      const uri = `data:audio/mp3;base64,${base64Data}`; // Ou audio/pcm se for PCM

      // Se já houver um som tocando, descarregue-o primeiro
      if (audioSoundRef.current) {
        await audioSoundRef.current.unloadAsync();
        audioSoundRef.current = null; // Limpa a referência
      }


      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: true, progressUpdateIntervalMillis: 100 } // Toca imediatamente
        // { volume: 1.0 } // Volume inicial
      );

      audioSoundRef.current = sound; // Armazena a nova referência

      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) {
          // Erro ou descarregado
          if (status.error) {
            console.error(`Audio playback error: ${status.error}`);
            setError(new Error(`Audio playback error: ${status.error}`));
          }
          // Se descarregou (ou terminou e foi descarregado), limpa a referência
          if (audioSoundRef.current === sound) {
             audioSoundRef.current = null;
             setVolumeOut(0);
          }

        } else {
          // Tocando ou pausado
          if (status.isPlaying) {
            // Calcular um 'volume' simulado baseado em isPlaying
            // Para um VU meter real, precisaríamos de análise de áudio
             setVolumeOut(0.8); // Simula volume alto enquanto toca
          } else {
             setVolumeOut(0); // Volume zero se pausado ou finalizado
          }

          // Se a reprodução acabou
          if (status.didJustFinish) {
             // console.log("Audio playback finished.");
             // Poderia descarregar aqui, mas vamos deixar descarregar antes de tocar o próximo
             // sound.unloadAsync();
             // if (audioSoundRef.current === sound) {
             //     audioSoundRef.current = null;
             //     setVolumeOut(0);
             // }
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
  }, []);

  // --- Efeitos para Lidar com Eventos do Cliente ---

  useEffect(() => {
    const handleOpen = () => {
      setConnected(true);
      setIsConnecting(false);
      setError(null); // Limpa erros anteriores na conexão bem-sucedida
      console.log('LiveAPI Hook: Connected event received.');
    };

    const handleClose = (event: CloseEvent | { code: number; reason: string }) => {
      setConnected(false);
      setIsConnecting(false);
      setError(null); // Limpa erro ao fechar normalmente
      console.log('LiveAPI Hook: Close event received.');
       // Limpeza de áudio ao fechar
      if (audioSoundRef.current) {
        audioSoundRef.current.unloadAsync().catch(e => console.warn("Error unloading sound on close:", e));
        audioSoundRef.current = null;
      }
      setVolumeOut(0);
    };

    const handleError = (err: Error | Event) => {
      const errorObj = err instanceof Error ? err : new Error(`WebSocket error: ${err.type}`);
      console.error('LiveAPI Hook: Error event received:', errorObj);
      setError(errorObj);
      // Pode ser necessário desconectar ou tentar reconectar dependendo do erro
      // disconnect(); // Desconectar em caso de erro?
    };

    const handleAudio = (data: ArrayBuffer) => {
      playAudioChunk(data);
    };

    const handleInterrupted = () => {
        console.log("LiveAPI Hook: Interrupted event received.");
        // Parar áudio de saída
        if (audioSoundRef.current) {
            audioSoundRef.current.stopAsync().catch(e => console.warn("Error stopping sound on interrupt:", e));
            // Não descarregar ainda, pode ser retomado
        }
        setVolumeOut(0);
        // A lógica da UI pode precisar parar a gravação de entrada aqui também
    };

     const handleLog = (log: StreamingLog) => {
       // console.log("API Log:", log); // Opcional: Logar tudo aqui
     };

     // --- Assinatura de eventos ---
     client.on('open', handleOpen);
     client.on('close', handleClose);
     client.on('error', handleError);
     client.on('audio', handleAudio);
     client.on('interrupted', handleInterrupted);
     client.on('log', handleLog);
     // Adicione listeners para 'content', 'toolcall', etc. se precisar reagir a eles aqui

     // --- Limpeza ---
     return () => {
        client.off('open', handleOpen);
        client.off('close', handleClose);
        client.off('error', handleError);
        client.off('audio', handleAudio);
        client.off('interrupted', handleInterrupted);
        client.off('log', handleLog);

        // Garante desconexão e limpeza ao desmontar o hook
        // console.log("Cleaning up useLiveAPI hook");
        // client.disconnect(); // Causa re-render se chamado diretamente aqui
        // setTimeout(() => client.disconnect(), 0); // Adia desconexão
        if (audioSoundRef.current) {
            audioSoundRef.current.unloadAsync().catch(e => console.warn("Error unloading sound on hook cleanup:", e));
            audioSoundRef.current = null;
        }
     };
  }, [client, playAudioChunk, disconnect]); // Inclui disconnect se ele for usado na limpeza

  // --- Configuração de áudio global do Expo ---
  useEffect(() => {
    const setupAudioMode = async () => {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true, // Necessário para gravação no iOS
          playsInSilentModeIOS: true, // Permite tocar áudio mesmo no modo silencioso
          // interruptionModeIOS: Audio.INTERRUPTION_MODE_IOS_DO_NOT_MIX,
          interruptionModeIOS: Audio.INTERRUPTION_MODE_IOS_MIX_WITH_OTHERS, // Ou outra opção
          // interruptionModeAndroid: Audio.INTERRUPTION_MODE_ANDROID_DO_NOT_MIX,
          interruptionModeAndroid: Audio.INTERRUPTION_MODE_ANDROID_DUCK_OTHERS, // Ou outra opção
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });
      } catch (e) {
        console.error("Failed to set audio mode", e);
        setError(e as Error);
      }
    };
    setupAudioMode();

     // Limpeza do modo de áudio? Geralmente não é necessário.
     // return () => { Audio.setAudioModeAsync({...defaults}); };
  }, []);

  return {
    client,
    config,
    connected,
    isConnecting,
    error,
    volumeOut,
    connect,
    disconnect,
    setConfig,
    sendText,
  };
}