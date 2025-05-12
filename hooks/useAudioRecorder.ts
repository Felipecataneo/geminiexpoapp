// hooks/useAudioRecorder.ts
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { PermissionStatus } from 'expo-modules-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useLiveAPIContext } from '../contexts/LiveAPIContext';
import { arrayBufferToBase64, base64ToArrayBuffer } from '../lib/utils'; // Ensure this path is correct

const RECORDING_CHUNK_DURATION_MS = 1000;

export interface UseAudioRecorderResult {
  isStreamingMic: boolean;
  volumeIn: number;
  startStreamingMicrophone: () => Promise<void>;
  stopStreamingMicrophone: () => Promise<void>; // Made async for await
  permissionResponse?: Audio.PermissionResponse;
  hasPermission: boolean | null;
  error: Error | null;
}

// --- Revert to Manual Options Targeting PCM 16kHz ---
const recordingOptions: Audio.RecordingOptions = {
    android: {
      extension: '.wav', // Use .wav, header stripping will be needed
      outputFormat: Audio.AndroidOutputFormat.DEFAULT, // Default often yields WAV container
      audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,   // Default often yields PCM in WAV
      sampleRate: 16000, // Explicitly 16kHz
      numberOfChannels: 1,
      bitRate: 16000 * 16 * 1, // 16kHz * 16 bits * 1 channel = 256000
    },
    ios: {
      extension: '.pcm', // iOS can usually handle raw PCM directly
      outputFormat: Audio.IOSOutputFormat.LINEARPCM, // Explicitly PCM
      audioQuality: Audio.IOSAudioQuality.MAX, // Use max quality PCM
      sampleRate: 16000, // Explicitly 16kHz
      numberOfChannels: 1,
      bitRate: 16000 * 16 * 1,
      linearPCMBitDepth: 16,
      linearPCMIsBigEndian: false,
      linearPCMIsFloat: false,
    },
    web: { // Not relevant for RN but keep for completeness
        mimeType: 'audio/wav',
        bitsPerSecond: 16000 * 16 * 1,
    },
    isMeteringEnabled: true, // Keep metering
};


export function useAudioRecorder(): UseAudioRecorderResult {
  console.log("AUDIO_REC: Hook top level execution"); // Log mount/render

  const [isStreamingMic, setIsStreamingMic] = useState(false);
  const [volumeIn, setVolumeIn] = useState(0);
  const [permissionResponse, setPermissionResponse] = useState<Audio.PermissionResponse>();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const stopStreamingRef = useRef<boolean>(true);
  const isProcessingSegmentRef = useRef<boolean>(false);

  const { client, connected } = useLiveAPIContext();

  const requestPermissions = useCallback(async () => {
    // console.log('AUDIO_REC: requestPermissions called'); // Less verbose
    setError(null);
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const response = await Audio.requestPermissionsAsync();
      setPermissionResponse(response);
      setHasPermission(response.status === PermissionStatus.GRANTED);
      console.log(`AUDIO_REC: Permissions status: ${response.status}`);
    } catch (err: any) {
      console.error('AUDIO_REC: Error requesting permissions:', err);
      setError(err);
      setHasPermission(false);
    }
  }, []);

  useEffect(() => {
    console.log("AUDIO_REC: Permission effect running");
    requestPermissions();
  }, [requestPermissions]);

  // --- Stable Stop Function ---
  const stopStreamingMicrophone = useCallback(async () => {
    console.log(`AUDIO_REC: stopStreamingMicrophone called (stopRef: ${stopStreamingRef.current}, processingRef: ${isProcessingSegmentRef.current})`);

    if (stopStreamingRef.current) {
        console.log("AUDIO_REC: Stop: Already stopped or stop signal set.");
        // No need to update state here if already stopped.
        return;
    }

    stopStreamingRef.current = true;
    console.log('AUDIO_REC: Stop: Signaled to stop.');

    // Directly set state without reading previous values
    // We assume that if this function is called, the intention is to stop.
    setIsStreamingMic(false);
    setVolumeIn(0);

    const currentRecording = recordingRef.current;
    recordingRef.current = null;

    if (currentRecording) {
        console.log("AUDIO_REC: Stop: Attempting cleanup for active recording instance...");
        let recordingUri: string | null = null;
        try {
            recordingUri = currentRecording.getURI();
            await currentRecording.stopAndUnloadAsync();
            console.log("AUDIO_REC: Stop: Recording stopped and unloaded.");
        } catch (e: any) {
            console.warn("AUDIO_REC: Stop: Error during stopAndUnloadAsync:", e.message);
        } finally {
            if (recordingUri) {
                await FileSystem.deleteAsync(recordingUri, { idempotent: true })
                    .catch(delErr => console.warn("AUDIO_REC: Stop: Failed to delete file:", delErr));
            }
        }
    } else {
        console.log("AUDIO_REC: Stop: No active recording instance found.");
    }
    isProcessingSegmentRef.current = false;
    console.log("AUDIO_REC: stopStreamingMicrophone finished.");
  }, []); // <<< EMPTIED dependency array


  // --- Core Loop ---
  const recordAndSendSegment = useCallback(async () => {
    console.log(`AUDIO_REC: recordAndSendSegment entered (stopRef: ${stopStreamingRef.current}, processingRef: ${isProcessingSegmentRef.current})`); // Add log

    if (stopStreamingRef.current) {
        console.log("AUDIO_REC: Loop: Stop signal detected at start, exiting loop."); // Add log
        isProcessingSegmentRef.current = false;
        if (isStreamingMic) setIsStreamingMic(false);
        return;
    }

    if (isProcessingSegmentRef.current) {
         console.warn("AUDIO_REC: Loop: Already processing, rescheduling check."); // Add log
        requestAnimationFrame(recordAndSendSegment);
        return;
    }

    if (!connected || !client) {
         console.warn("AUDIO_REC: Loop: Not connected, stopping stream."); // Add log
        await stopStreamingMicrophone();
        return;
    }

    isProcessingSegmentRef.current = true;
    let segmentUri: string | null = null;
    let localRecordingInstance: Audio.Recording | null = null;

    try {
        console.log("AUDIO_REC: Loop: Setting audio mode..."); // Add log
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });

        if (recordingRef.current) { // Defensive cleanup
             console.warn("AUDIO_REC: Loop: Cleaning up unexpected previous recording instance.");
            await recordingRef.current.stopAndUnloadAsync().catch(e => {});
            recordingRef.current = null;
        }

        console.log("AUDIO_REC: Loop: Creating new recording instance..."); // Add log
        const { recording } = await Audio.Recording.createAsync(
            recordingOptions, // Use manual options
            (statusUpdate: Audio.RecordingStatus) => {
                 if (!isProcessingSegmentRef.current || stopStreamingRef.current) return;
                 if (statusUpdate.isRecording) {
                     const db = statusUpdate.metering ?? -160;
                     const linearVolume = Math.max(0, Math.min(1, 1 + db / 60));
                     // Check if state update is needed to avoid unnecessary renders
                     setVolumeIn(currentVol => currentVol !== linearVolume ? linearVolume : currentVol);
                 } else if (!statusUpdate.isDoneRecording) {
                     // Check if state update is needed
                     setVolumeIn(currentVol => currentVol !== 0 ? 0 : currentVol);
                 }
             }, 100
        );
        localRecordingInstance = recording;
        recordingRef.current = recording;
        console.log("AUDIO_REC: Loop: Recording instance created."); // Add log

        await new Promise(resolve => setTimeout(resolve, RECORDING_CHUNK_DURATION_MS));
        console.log("AUDIO_REC: Loop: Wait finished."); // Add log

        if (stopStreamingRef.current || recordingRef.current !== localRecordingInstance) {
            throw new Error("Streaming stopped or recording instance mismatch during wait.");
        }

        if (localRecordingInstance) {
             console.log("AUDIO_REC: Loop: Stopping and unloading segment recording..."); // Add log
             await localRecordingInstance.stopAndUnloadAsync();
             segmentUri = localRecordingInstance.getURI();
             if (recordingRef.current === localRecordingInstance) recordingRef.current = null;
             localRecordingInstance = null;
             console.log("AUDIO_REC: Loop: Segment stopped, URI:", segmentUri); // Add log
        } else { throw new Error('Recording instance lost before stop.'); }

        if (!segmentUri) { throw new Error('Failed to get segment URI.'); }

        if (stopStreamingRef.current) { throw new Error("Streaming stopped before segment send."); }

        if (connected && client) {
             console.log("AUDIO_REC: Loop: Reading segment file..."); // Add log
             const fileInfo = await FileSystem.getInfoAsync(segmentUri);
             if (!fileInfo.exists || !fileInfo.size) { throw new Error(`Segment file invalid: ${segmentUri}`);}

             let base64Data = await FileSystem.readAsStringAsync(segmentUri, { encoding: FileSystem.EncodingType.Base64 });
             let mimeType = 'audio/pcm;rate=16000';

             // Use manual options, apply header stripping only for Android .wav
             if (Platform.OS === 'android' && recordingOptions.android.extension === '.wav') {
                 try {
                    const buffer = base64ToArrayBuffer(base64Data);
                    if (buffer.byteLength > 44) {
                        const riff = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
                        const wave = String.fromCharCode(...new Uint8Array(buffer, 8, 4));
                        if (riff === 'RIFF' && wave === 'WAVE') {
                            console.log("AUDIO_REC: Loop: Stripping WAV header from Android data.");
                            base64Data = arrayBufferToBase64(buffer.slice(44));
                        }
                    }
                 } catch (stripError) {console.error("Strip error:", stripError)}
             }
             console.log(`AUDIO_REC: Loop: Sending data (MIME: ${mimeType}, Size: ${base64Data.length})`); // Add log
             client.sendRealtimeInput([{ mimeType: mimeType, data: base64Data }]);
             console.log("AUDIO_REC: Loop: Data sent."); // Add log
        } else { console.warn("AUDIO_REC: Loop: Client disconnected before send."); }

    } catch (err: any) {
        console.error('AUDIO_REC: Loop: Error caught:', err.message);
        if (err.message.includes("createAsync")) {
            setError(new Error(`Failed to create recording: ${err.message}`));
        }
        if (!stopStreamingRef.current) { await stopStreamingMicrophone(); }
    } finally {
         console.log("AUDIO_REC: Loop: Finally block executing."); // Add log
        if (segmentUri) {
             await FileSystem.deleteAsync(segmentUri, { idempotent: true }).catch(e => {});
        }
        if (localRecordingInstance) {
             try { await localRecordingInstance.stopAndUnloadAsync(); } catch(e){}
        }
        isProcessingSegmentRef.current = false;
        if (!stopStreamingRef.current) {
             console.log("AUDIO_REC: Loop: Scheduling next frame."); // Add log
             requestAnimationFrame(recordAndSendSegment);
        } else {
             console.log("AUDIO_REC: Loop: Stop signal is set, loop ending."); // Add log
             if (isStreamingMic) setIsStreamingMic(false);
        }
    }
  // Stabilized stopStreamingMicrophone. Need context, state, and setters.
  }, [client, connected, stopStreamingMicrophone, isStreamingMic, volumeIn, setVolumeIn]);


  // --- Start Function ---
  const startStreamingMicrophone = useCallback(async () => {
    console.log(`AUDIO_REC: startStreamingMicrophone called (isStreamingMic: ${isStreamingMic}, stopRef: ${stopStreamingRef.current})`);

    if (isStreamingMic || !stopStreamingRef.current) {
      console.warn(`AUDIO_REC: Start: Already streaming or not stopped.`);
      return;
    }
    isProcessingSegmentRef.current = false;

    if (!connected || !client) {
       setError(new Error('Cannot start streaming: Client not connected.'));
       return;
    }

    // Ensure permissions
    if (hasPermission !== true) {
        console.log("AUDIO_REC: Start: Requesting permissions...");
        await requestPermissions();
        // We need to check the result *after* the await completes.
        // The state update might not be immediate, so check permissionResponse.
        const currentPermStatus = permissionResponse?.status ?? (await Audio.getPermissionsAsync()).status;
        if (currentPermStatus !== PermissionStatus.GRANTED) {
             setError(new Error('Microphone permission required.'));
             console.error('AUDIO_REC: Start: Permission was denied.');
             return;
        }
         // If permission was granted, update state if it wasn't already
         if (!hasPermission) setHasPermission(true);
         if (!permissionResponse || permissionResponse.status !== currentPermStatus) {
             // Fetch again if state seems out of sync
             setPermissionResponse(await Audio.getPermissionsAsync());
         }
         console.log("AUDIO_REC: Start: Permissions OK.");
    }


    console.log('AUDIO_REC: Start: Initiating streaming...');
    setError(null);
    stopStreamingRef.current = false; // Signal start
    recordingRef.current = null;
    setIsStreamingMic(true); // Update UI state

    // Use setTimeout to schedule the first frame slightly after the current render cycle
    // This might help if the state update setIsStreamingMic is causing immediate issues
    // requestAnimationFrame(recordAndSendSegment); // Original
    setTimeout(recordAndSendSegment, 0); // Schedule with setTimeout

    console.log('AUDIO_REC: Start: First loop scheduled.');

  // Dependencies: isStreamingMic state is read here. Need context and permission state/funcs.
  }, [hasPermission, requestPermissions, recordAndSendSegment, connected, client, isStreamingMic, permissionResponse, setHasPermission, setPermissionResponse]);


  // --- Cleanup Effect ---
  useEffect(() => {
    console.log("AUDIO_REC: Cleanup effect setup.");
    const stableStopFn = stopStreamingMicrophone; // Capture stable reference
    return () => {
      console.log("AUDIO_REC: Cleanup effect running (Unmounting).");
      if (stopStreamingRef.current === false) {
          console.log("AUDIO_REC: Cleanup: stopStreamingRef was false, calling stop.");
          stableStopFn(); // Use stable reference
      } else {
          const rec = recordingRef.current;
          if (rec) {
              console.warn("AUDIO_REC: Cleanup: Found lingering recording ref.");
              recordingRef.current = null;
              rec.stopAndUnloadAsync().catch(e => {});
          }
      }
    };
  }, [stopStreamingMicrophone]); // Depend only on stable stop function

  console.log("AUDIO_REC: Hook rendering/re-rendering complete."); // Add log
  return {
    isStreamingMic,
    volumeIn,
    startStreamingMicrophone,
    stopStreamingMicrophone,
    permissionResponse,
    hasPermission,
    error,
  };
}