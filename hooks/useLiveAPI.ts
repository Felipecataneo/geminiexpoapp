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

const defaultInitialConfig: LiveConfig = {
  model: 'models/gemini-2.0-flash-exp',
  generationConfig: {
    responseModalities: 'audio',
    // IMPORTANT: The API sends 16kHz or 24kHz audio (check API docs).
    // Let's assume 16kHz for now based on input config.
    // This is crucial for expo-av if it needs format hints.
    speechConfig: {
       voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } }
       // Consider adding sampleRateHertz if the API supports/requires it
       // sampleRateHertz: 16000
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
  const [volumeOut, setVolumeOut] = useState(0); // Keep for UI feedback maybe

  const clientRef = useRef<MultimodalLiveClient | null>(null);
  const audioSoundRef = useRef<Audio.Sound | null>(null);
  const playbackQueueRef = useRef<PlaybackQueueItem[]>([]); // Queue of URIs
  const isPlayingAudioRef = useRef<boolean>(false); // Track if currently playing
  const cleanupQueueRef = useRef<string[]>([]); // URIs pending deletion

  if (!clientRef.current) {
      console.log("LIVE_API: Initializing MultimodalLiveClient...");
      clientRef.current = new MultimodalLiveClient(connectionParams);
  }
  const client = clientRef.current;

  // --- Connection/Disconnection (mostly unchanged) ---
  const connect = useCallback(async () => {
    if (connected || isConnecting) return;
    setError(null);
    setIsConnecting(true);
    console.log('LIVE_API: Attempting connection with config:', JSON.stringify(config));
    try {
      await client.connect(config);
      // Connection success handled by 'open' event listener
    } catch (err: any) {
      console.error('LIVE_API: Connection failed:', err);
      setError(err);
      setConnected(false); // Ensure state is correct on failure
      setIsConnecting(false);
    }
  }, [client, config, connected, isConnecting]);

  // --- Disconnect and Cleanup ---
  const cleanupPlayback = useCallback(async () => {
      console.log("LIVE_API: Cleaning up audio playback resources...");
      isPlayingAudioRef.current = false;
      playbackQueueRef.current = []; // Clear queue

      // Stop and unload current sound
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
       setVolumeOut(0); // Reset UI indicator

      // Delete any remaining temporary files
      const filesToDelete = [...cleanupQueueRef.current];
      cleanupQueueRef.current = []; // Clear the cleanup list
      console.log(`LIVE_API: Deleting ${filesToDelete.length} temporary audio files...`);
      for (const uri of filesToDelete) {
           try {
                await FileSystem.deleteAsync(uri, { idempotent: true });
           } catch(e) {
                console.warn(`LIVE_API: Failed to delete temp file ${uri}:`, e);
           }
      }
      console.log("LIVE_API: Finished cleanup.");

  }, []); // No dependencies needed


  const disconnect = useCallback(() => {
    console.log('LIVE_API: Disconnect called');
    if (client) {
        client.disconnect(); // This will trigger the 'close' event eventually
    }
    cleanupPlayback(); // Clean up audio immediately
    // State changes (connected, isConnecting) handled by 'close' event
  }, [client, cleanupPlayback]);

  // --- Send Text (unchanged) ---
  const sendText = useCallback((text: string, turnComplete: boolean = true) => {
      if (client && connected) {
          console.log(`LIVE_API: SENDING TEXT: "${text}", turnComplete: ${turnComplete}`);
          client.send([{ text }], turnComplete);
      } else {
          console.warn("LIVE_API: Cannot send text: Client not connected.");
      }
  }, [client, connected]);

  // --- Process and Play Next Audio Chunk from Queue ---
  const playNextInQueue = useCallback(async () => {
    if (isPlayingAudioRef.current || playbackQueueRef.current.length === 0) {
      // console.log("LIVE_API: Playback busy or queue empty.");
      if (!isPlayingAudioRef.current && playbackQueueRef.current.length === 0) {
           // If nothing is playing and the queue is empty, ensure state is reset
           setVolumeOut(0);
      }
      return;
    }

    const nextItem = playbackQueueRef.current.shift();
    if (!nextItem) {
         // Should not happen if length > 0, but good guard
         isPlayingAudioRef.current = false;
         setVolumeOut(0);
         return;
    }

    console.log(`LIVE_API: Playing next chunk: ${nextItem.id} from ${nextItem.uri}`);
    isPlayingAudioRef.current = true;
    setError(null); // Clear previous playback errors

    try {
      await Audio.setAudioModeAsync({ // Ensure audio mode is set correctly before playback
          allowsRecordingIOS: true, // Keep allowsRecording true if mic might be used
          playsInSilentModeIOS: true,
          interruptionModeIOS: InterruptionModeIOS.MixWithOthers, // Or DuckOthers
          interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
      });

      // Unload previous sound if it exists (shouldn't normally, but defensively)
      if (audioSoundRef.current) {
         console.warn("LIVE_API: Unloading unexpected existing sound before playing next.");
         await audioSoundRef.current.unloadAsync().catch(e => console.warn("LIVE_API: Error unloading previous sound:", e));
         audioSoundRef.current = null;
      }

      // Load the new sound from the temporary file URI
      // We MIGHT need to provide format hints if expo-av struggles with raw PCM.
      // This part is speculative as expo-av docs on raw PCM loading are sparse.
      // Check for specific loading options if playback fails.
      const { sound, status } = await Audio.Sound.createAsync(
        { uri: nextItem.uri },
        { shouldPlay: true, progressUpdateIntervalMillis: 100 }, // Start playing immediately
        (playbackStatus: AVPlaybackStatus) => { // On Playback Status Update
          if (playbackStatus.isLoaded) {
            // Set volume indicator (e.g., based on isPlaying)
            setVolumeOut(playbackStatus.isPlaying ? 0.8 : 0);

            if (playbackStatus.didJustFinish) {
              console.log(`LIVE_API: Finished playing chunk: ${nextItem.id}`);
              sound.unloadAsync() // Unload the sound object
                  .then(() => {
                      // Mark file for deletion AFTER successful unload
                      cleanupQueueRef.current = cleanupQueueRef.current.filter(uri => uri !== nextItem.uri); // Remove if already marked
                      FileSystem.deleteAsync(nextItem.uri, { idempotent: true })
                           .then(() => console.log(`LIVE_API: Deleted temp file: ${nextItem.uri}`))
                           .catch(e => console.warn(`LIVE_API: Failed to delete temp file ${nextItem.uri}:`, e));
                  })
                  .catch(e => {
                      console.warn(`LIVE_API: Error unloading sound ${nextItem.id}:`, e);
                       // Still try to delete the file even if unload fails
                      FileSystem.deleteAsync(nextItem.uri, { idempotent: true }).catch(err => console.warn(`LIVE_API: Failed to delete temp file ${nextItem.uri} after unload error:`, err));
                  })
                  .finally(() => {
                      if (audioSoundRef.current === sound) {
                          audioSoundRef.current = null;
                      }
                      isPlayingAudioRef.current = false; // Ready for next chunk
                      playNextInQueue(); // Trigger the next playback
                  });
            }
          } else {
            // Handle unloaded state or errors
            if (playbackStatus.error) {
              console.error(`LIVE_API: Playback error for ${nextItem.id}: ${playbackStatus.error}`);
              setError(new Error(`Playback error: ${playbackStatus.error}`));
              // Attempt cleanup even on error
              sound.unloadAsync().catch(e => console.warn(`LIVE_API: Error unloading sound ${nextItem.id} after error:`, e));
              FileSystem.deleteAsync(nextItem.uri, { idempotent: true }).catch(e => console.warn(`LIVE_API: Failed to delete temp file ${nextItem.uri} after error:`, e));
              if (audioSoundRef.current === sound) {
                  audioSoundRef.current = null;
              }
              isPlayingAudioRef.current = false;
              playNextInQueue(); // Try to play the next one? Or stop? Decide policy.
            } else {
                 // Sound unloaded for other reasons (e.g., manually stopped)
                 if (audioSoundRef.current === sound) {
                     audioSoundRef.current = null;
                 }
                 isPlayingAudioRef.current = false;
                 setVolumeOut(0);
                 // Do not automatically play next if it wasn't 'didJustFinish' or an error
            }
          }
        }
      );
      // console.log(`LIVE_API: Sound loaded for chunk: ${nextItem.id}`);
      audioSoundRef.current = sound; // Store reference to the current sound

    } catch (e: any) {
      console.error(`LIVE_API: Failed to load/play chunk ${nextItem.id}:`, e);
      setError(e);
      isPlayingAudioRef.current = false;
      setVolumeOut(0);
       // Ensure file is deleted on load failure
      FileSystem.deleteAsync(nextItem.uri, { idempotent: true }).catch(err => console.warn(`LIVE_API: Failed to delete temp file ${nextItem.uri} after load failure:`, err));
      playNextInQueue(); // Attempt to play the next chunk
    }
  }, []); // No dependencies needed


  // --- Handle Incoming Audio Chunks ---
  const handleAudioChunk = useCallback(async (audioData: ArrayBuffer) => {
    console.log(`LIVE_API: Received ${audioData.byteLength} bytes of audio data.`);
    if (audioData.byteLength === 0) {
        console.warn("LIVE_API: Received empty audio chunk, skipping.");
        return;
    }
    const chunkId = `chunk_${Date.now()}_${Math.random().toString(16).substring(2, 8)}`;
    // NOTE: The server sends raw PCM. Saving as '.pcm' might be clearer,
    // but '.wav' without a header *might* be loadable by expo-av. Test this.
    // Let's try saving as .wav for now, assuming expo-av might handle headerless.
    // If not, try '.pcm' or investigate adding a WAV header.
    const tempUri = FileSystem.cacheDirectory + `${chunkId}.wav`; // Use .wav extension

    try {
        // Convert ArrayBuffer to base64 for writing (expo-file-system needs string)
        // NOTE: Consider if FileSystem can write ArrayBuffer directly in newer Expo SDKs
        const base64Data = Buffer.from(audioData).toString('base64'); // Use Node's Buffer

        console.log(`LIVE_API: Writing chunk ${chunkId} to temporary file: ${tempUri}`);
        await FileSystem.writeAsStringAsync(tempUri, base64Data, {
            encoding: FileSystem.EncodingType.Base64,
        });

        // Add to queue and mark for potential cleanup
        playbackQueueRef.current.push({ uri: tempUri, id: chunkId });
        cleanupQueueRef.current.push(tempUri); // Add to list of files to eventually delete

        // If not already playing, start the playback process
        if (!isPlayingAudioRef.current) {
            playNextInQueue();
        }
    } catch (e: any) {
        console.error(`LIVE_API: Failed to write or queue audio chunk ${chunkId}:`, e);
        setError(e);
        // Attempt to delete the file if writing failed partially
        await FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(err => {});
    }
  }, [playNextInQueue]); // Dependency on playNextInQueue

  // --- Effects for Client Events ---
  useEffect(() => {
    if (!client) return;

    const handleOpen = () => {
        console.log('LIVE_API: Connected event received.');
        setConnected(true);
        setIsConnecting(false);
        setError(null);
    };
    const handleClose = (event: CloseEvent | { code: number; reason: string }) => {
        const reason = event instanceof CloseEvent ? event.reason : event.reason;
        const code = event instanceof CloseEvent ? event.code : event.code;
        console.log(`LIVE_API: Close event received (Code: ${code}, Reason: ${reason || 'None'}). Was connected: ${connected}`);
        // Don't clear error on close, it might be relevant
        cleanupPlayback(); // Clean up audio resources
        setConnected(false);
        setIsConnecting(false);
    };
    const handleError = (err: Error | Event) => {
        const errorObj = err instanceof Error ? err : new Error(`WebSocket error: ${'type' in err ? err.type : 'Unknown'}`);
        console.error('LIVE_API: Error event received:', errorObj);
        setError(errorObj);
        // Consider if disconnect/cleanup is needed on error
        // cleanupPlayback();
        // setConnected(false);
        // setIsConnecting(false);
    };
    const handleAudio = (data: ArrayBuffer) => {
        // console.log("LIVE_API: Received 'audio' event, calling handleAudioChunk.");
        handleAudioChunk(data);
    };
    const handleInterrupted = () => {
        console.log("LIVE_API: Interrupted event received.");
        // Stop current playback and clear queue
        cleanupPlayback();
    };
    const handleLog = (log: StreamingLog) => {
        // Optional: Forward logs or process them
        // console.log("API Log:", log.type, log.message);
    };

    console.log("LIVE_API: Adding event listeners to client.");
    client.on('open', handleOpen);
    client.on('close', handleClose);
    client.on('error', handleError);
    client.on('audio', handleAudio);
    client.on('interrupted', handleInterrupted);
    client.on('log', handleLog);

    // Cleanup function
    return () => {
      console.log("LIVE_API: Removing event listeners from client.");
      client.off('open', handleOpen);
      client.off('close', handleClose);
      client.off('error', handleError);
      client.off('audio', handleAudio);
      client.off('interrupted', handleInterrupted);
      client.off('log', handleLog);
      // Ensure cleanup runs if component unmounts while connected
      cleanupPlayback();
    };
    // Add cleanupPlayback to dependencies ensure it's the latest version in the cleanup
  }, [client, handleAudioChunk, cleanupPlayback, connected]);


  // --- Global Audio Mode Setup (unchanged) ---
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
            // Consider setting an error state here?
        }
    };
    setupAudioMode();
  }, []);

  return {
    client, config, connected, isConnecting, error, volumeOut,
    connect, disconnect, setConfig, sendText,
  };
}

// Helper to ensure Buffer is available (install 'buffer' package if needed: npm install buffer)
import { Buffer } from 'buffer';
global.Buffer = Buffer; // Make Buffer globally available if it's not already