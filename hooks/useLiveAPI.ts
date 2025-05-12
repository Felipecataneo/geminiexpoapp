// hooks/useLiveAPI.ts
import { Audio, AVPlaybackStatus, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import * as FileSystem from 'expo-file-system'; // Import FileSystem
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MultimodalLiveAPIClientConnection,
  MultimodalLiveClient,
} from '../lib/multimodal-live-client';
import { LiveConfig, StreamingLog } from '../multimodal-live-types';

// Define a type for the playback queue item
type PlaybackQueueItem = {
    uri: string;
    id: string; // Unique ID for the chunk
};

export type UseLiveAPIResults = {
  client: MultimodalLiveClient;
  config: LiveConfig;
  connected: boolean;
  isConnecting: boolean;
  error: Error | null;
  volumeOut: number; // Keep volumeOut if needed for UI
  connect: () => Promise<void>;
  disconnect: () => void;
  setConfig: (config: LiveConfig) => void;
  sendText: (text: string, turnComplete?: boolean) => void;
};

// --- MODIFIED: Simplified initial config and model name ---
const defaultInitialConfig: LiveConfig = {
  model: 'models/gemini-2.0-flash-exp', // Match working web example
  // generationConfig: {                  // COMMENTED OUT FOR INITIAL TEST
  //   responseModalities: 'audio',
  //   speechConfig: {
  //      voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } }
  //   }
  // },
};

export function useLiveAPI(
  connectionParams: MultimodalLiveAPIClientConnection
): UseLiveAPIResults {
  const [config, setConfig] = useState<LiveConfig>(defaultInitialConfig);
  const [connected, setConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [volumeOut, setVolumeOut] = useState(0);

  const clientRef = useRef<MultimodalLiveClient | null>(null);
  const audioSoundRef = useRef<Audio.Sound | null>(null);
  const playbackQueueRef = useRef<PlaybackQueueItem[]>([]);
  const isPlayingAudioRef = useRef<boolean>(false);
  const cleanupQueueRef = useRef<string[]>([]);

  if (!clientRef.current) {
      console.log("LIVE_API: Initializing MultimodalLiveClient...");
      clientRef.current = new MultimodalLiveClient(connectionParams);
  }
  const client = clientRef.current;

  const connect = useCallback(async () => {
    if (connected || isConnecting) return;
    setError(null);
    setIsConnecting(true);
    console.log('LIVE_API: Attempting connection with config:', JSON.stringify(config));
    try {
      await client.connect(config);
    } catch (err: any) {
      console.error('LIVE_API: Connection failed:', err);
      setError(err);
      setConnected(false);
      setIsConnecting(false);
    }
  }, [client, config, connected, isConnecting]);

  const cleanupPlayback = useCallback(async () => {
      console.log("LIVE_API: Cleaning up audio playback resources...");
      isPlayingAudioRef.current = false;
      playbackQueueRef.current = [];

      if (audioSoundRef.current) {
          try {
              await audioSoundRef.current.stopAsync();
              await audioSoundRef.current.unloadAsync();
              console.log("LIVE_API: Unloaded current sound instance.");
          } catch (e) {
              console.warn("LIVE_API: Error unloading sound during cleanup:", e);
          }
          audioSoundRef.current = null;
      }
       setVolumeOut(0);

      const filesToDelete = [...cleanupQueueRef.current];
      cleanupQueueRef.current = [];
      console.log(`LIVE_API: Deleting ${filesToDelete.length} temporary audio files...`);
      for (const uri of filesToDelete) {
           try {
                await FileSystem.deleteAsync(uri, { idempotent: true });
           } catch(e) {
                console.warn(`LIVE_API: Failed to delete temp file ${uri}:`, e);
           }
      }
      console.log("LIVE_API: Finished cleanup.");

  }, []);


  const disconnect = useCallback(() => {
    console.log('LIVE_API: Disconnect called');
    if (client) {
        client.disconnect();
    }
    cleanupPlayback();
  }, [client, cleanupPlayback]);

  const sendText = useCallback((text: string, turnComplete: boolean = true) => {
      if (client && connected) {
          console.log(`LIVE_API: SENDING TEXT: "${text}", turnComplete: ${turnComplete}`);
          client.send([{ text }], turnComplete);
      } else {
          console.warn("LIVE_API: Cannot send text: Client not connected.");
      }
  }, [client, connected]);

  const playNextInQueue = useCallback(async () => {
    if (isPlayingAudioRef.current || playbackQueueRef.current.length === 0) {
      if (!isPlayingAudioRef.current && playbackQueueRef.current.length === 0) {
           setVolumeOut(0);
      }
      return;
    }

    const nextItem = playbackQueueRef.current.shift();
    if (!nextItem) {
         isPlayingAudioRef.current = false;
         setVolumeOut(0);
         return;
    }

    console.log(`LIVE_API: Playing next chunk: ${nextItem.id} from ${nextItem.uri}`);
    isPlayingAudioRef.current = true;
    setError(null);

    try {
      await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
          interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
      });

      if (audioSoundRef.current) {
         console.warn("LIVE_API: Unloading unexpected existing sound before playing next.");
         await audioSoundRef.current.unloadAsync().catch(e => console.warn("LIVE_API: Error unloading previous sound:", e));
         audioSoundRef.current = null;
      }

      const { sound, status } = await Audio.Sound.createAsync(
        { uri: nextItem.uri },
        { shouldPlay: true, progressUpdateIntervalMillis: 100 },
        (playbackStatus: AVPlaybackStatus) => {
          if (!playbackStatus.isLoaded) {
            if (playbackStatus.error) {
              console.error(`LIVE_API: Playback error for ${nextItem.id}: ${playbackStatus.error}`);
              setError(new Error(`Playback error: ${playbackStatus.error}`));
              sound.unloadAsync().catch(e => console.warn(`LIVE_API: Error unloading sound ${nextItem.id} after error:`, e));
              FileSystem.deleteAsync(nextItem.uri, { idempotent: true }).catch(e => console.warn(`LIVE_API: Failed to delete temp file ${nextItem.uri} after error:`, e));
              if (audioSoundRef.current === sound) {
                  audioSoundRef.current = null;
              }
              isPlayingAudioRef.current = false;
              playNextInQueue();
            } else {
                 if (audioSoundRef.current === sound) {
                     audioSoundRef.current = null;
                 }
                 isPlayingAudioRef.current = false;
                 setVolumeOut(0);
            }
            return;
          }

          setVolumeOut(playbackStatus.isPlaying ? 0.8 : 0);

          if (playbackStatus.didJustFinish) {
            console.log(`LIVE_API: Finished playing chunk: ${nextItem.id}`);
            sound.unloadAsync()
                .then(() => {
                    cleanupQueueRef.current = cleanupQueueRef.current.filter(uri => uri !== nextItem.uri);
                    FileSystem.deleteAsync(nextItem.uri, { idempotent: true })
                         .then(() => console.log(`LIVE_API: Deleted temp file: ${nextItem.uri}`))
                         .catch(e => console.warn(`LIVE_API: Failed to delete temp file ${nextItem.uri}:`, e));
                })
                .catch(e => {
                    console.warn(`LIVE_API: Error unloading sound ${nextItem.id}:`, e);
                    FileSystem.deleteAsync(nextItem.uri, { idempotent: true }).catch(err => console.warn(`LIVE_API: Failed to delete temp file ${nextItem.uri} after unload error:`, err));
                })
                .finally(() => {
                    if (audioSoundRef.current === sound) {
                        audioSoundRef.current = null;
                    }
                    isPlayingAudioRef.current = false;
                    playNextInQueue();
                });
          }
        }
      );
      audioSoundRef.current = sound;

    } catch (e: any) {
      console.error(`LIVE_API: Failed to load/play chunk ${nextItem.id}:`, e);
      setError(e);
      isPlayingAudioRef.current = false;
      setVolumeOut(0);
      FileSystem.deleteAsync(nextItem.uri, { idempotent: true }).catch(err => console.warn(`LIVE_API: Failed to delete temp file ${nextItem.uri} after load failure:`, err));
      playNextInQueue();
    }
  }, []);


  const handleAudioChunk = useCallback(async (audioData: ArrayBuffer) => {
    console.log(`LIVE_API: Received ${audioData.byteLength} bytes of audio data.`);
    if (audioData.byteLength === 0) {
        console.warn("LIVE_API: Received empty audio chunk, skipping.");
        return;
    }
    const chunkId = `chunk_${Date.now()}_${Math.random().toString(16).substring(2, 8)}`;
    const tempUri = FileSystem.cacheDirectory + `${chunkId}.wav`;

    try {
        const base64Data = Buffer.from(audioData).toString('base64');

        console.log(`LIVE_API: Writing chunk ${chunkId} to temporary file: ${tempUri}`);
        await FileSystem.writeAsStringAsync(tempUri, base64Data, {
            encoding: FileSystem.EncodingType.Base64,
        });

        playbackQueueRef.current.push({ uri: tempUri, id: chunkId });
        cleanupQueueRef.current.push(tempUri);

        if (!isPlayingAudioRef.current) {
            playNextInQueue();
        }
    } catch (e: any) {
        console.error(`LIVE_API: Failed to write or queue audio chunk ${chunkId}:`, e);
        setError(e);
        await FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(err => {});
    }
  }, [playNextInQueue]);

  useEffect(() => {
    if (!client) return;

    const handleOpen = () => {
      console.log('LIVE_API: Connected event received.');
      setConnected(true);
      setIsConnecting(false);
      setError(null);
    };

    const handleClose = (eventData: CloseEvent | { code: number; reason: string }) => {
      let code: number;
      let reason: string | undefined;

      if (typeof CloseEvent !== 'undefined' && eventData instanceof CloseEvent) {
        code = eventData.code;
        reason = eventData.reason;
      } else if (eventData && typeof (eventData as any).code === 'number') {
        const plainEvent = eventData as { code: number; reason?: string };
        code = plainEvent.code;
        reason = plainEvent.reason;
      }
      else {
        console.warn('LIVE_API: handleClose received an unexpected event structure:', eventData);
        code = 1001;
        reason = 'Unknown close event structure';
      }

      console.log(`LIVE_API: Close event received (Code: ${code}, Reason: ${reason || 'None'}). Was connected: ${connected}`);
      cleanupPlayback();
      setConnected(false);
      setIsConnecting(false);
    };

    const handleError = (err: Error | Event) => {
        const errorObj = err instanceof Error ? err : new Error(`WebSocket error: ${'type' in err ? err.type : 'Unknown'}`);
        console.error('LIVE_API: Error event received:', errorObj);
        setError(errorObj);
    };
    const handleAudio = (data: ArrayBuffer) => {
        handleAudioChunk(data);
    };
    const handleInterrupted = () => {
        console.log("LIVE_API: Interrupted event received.");
        cleanupPlayback();
    };
    const handleLog = (log: StreamingLog) => {
        // console.log("API Log:", log.type, log.message);
    };

    console.log("LIVE_API: Adding event listeners to client.");
    client.on('open', handleOpen);
    client.on('close', handleClose);
    client.on('error', handleError);
    client.on('audio', handleAudio);
    client.on('interrupted', handleInterrupted);
    client.on('log', handleLog);

    return () => {
      console.log("LIVE_API: Removing event listeners from client.");
      client.off('open', handleOpen);
      client.off('close', handleClose);
      client.off('error', handleError);
      client.off('audio', handleAudio);
      client.off('interrupted', handleInterrupted);
      client.off('log', handleLog);
      cleanupPlayback();
    };
  }, [client, handleAudioChunk, cleanupPlayback, connected]);


  useEffect(() => {
    const setupAudioMode = async () => {
        console.log("LIVE_API: Setting global audio mode...");
        try {
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
                interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
                interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
                shouldDuckAndroid: true,
                playThroughEarpieceAndroid: false,
            });
            console.log("LIVE_API: Audio mode set successfully.");
        } catch (e) {
            console.error("LIVE_API: Failed to set audio mode", e);
        }
    };
    setupAudioMode();
  }, []);

  return {
    client, config, connected, isConnecting, error, volumeOut,
    connect, disconnect, setConfig, sendText,
  };
}

import { Buffer } from 'buffer';
global.Buffer = Buffer;