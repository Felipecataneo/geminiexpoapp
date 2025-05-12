import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { PermissionStatus } from 'expo-modules-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveAPIContext } from '../contexts/LiveAPIContext'; // Assuming correct path

const RECORDING_CHUNK_DURATION_MS = 1000; // Record 1-second chunks

export interface UseAudioRecorderResult {
  isStreamingMic: boolean;
  volumeIn: number;
  startStreamingMicrophone: () => Promise<void>;
  stopStreamingMicrophone: () => Promise<void>; // Keep this promise if needed elsewhere, otherwise void
  permissionResponse?: Audio.PermissionResponse;
  hasPermission: boolean | null;
  error: Error | null;
}

// Manually define recording options ensuring PCM format
const recordingOptions: Audio.RecordingOptions = {
    android: {
      extension: '.wav',
      outputFormat: Audio.AndroidOutputFormat.DEFAULT,
      audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
      sampleRate: 16000,
      numberOfChannels: 1,
      bitRate: 16000 * 16 * 1,
    },
    ios: {
      extension: '.wav',
      outputFormat: Audio.IOSOutputFormat.LINEARPCM,
      audioQuality: Audio.IOSAudioQuality.MAX,
      sampleRate: 16000,
      numberOfChannels: 1,
      bitRate: 16000 * 16 * 1,
      linearPCMBitDepth: 16,
      linearPCMIsBigEndian: false,
      linearPCMIsFloat: false,
    },
    web: {
        mimeType: 'audio/wav',
        bitsPerSecond: 16000 * 16 * 1,
    },
    isMeteringEnabled: true,
};

export function useAudioRecorder(): UseAudioRecorderResult {
  const [isStreamingMic, setIsStreamingMic] = useState(false);
  const [volumeIn, setVolumeIn] = useState(0);
  const [permissionResponse, setPermissionResponse] = useState<Audio.PermissionResponse>();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const stopStreamingRef = useRef<boolean>(false);
  const isProcessingSegmentRef = useRef<boolean>(false);
  const { client, connected } = useLiveAPIContext();

  // --- Permission Request ---
   const requestPermissions = useCallback(async () => {
     // console.log('AUDIO_REC: Requesting microphone permissions...'); // Keep essential logs for now
     setError(null);
     try {
       await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
       const response = await Audio.requestPermissionsAsync();
       setPermissionResponse(response);
       setHasPermission(response.status === PermissionStatus.GRANTED);
       if (response.status !== PermissionStatus.GRANTED) {
         console.warn('AUDIO_REC: Microphone permission not granted.');
       } else {
         console.log('AUDIO_REC: Microphone permission granted.');
       }
     } catch (err: any) {
       console.error('AUDIO_REC: Error requesting mic permissions/setting mode:', err);
       setError(err);
       setHasPermission(false);
     }
   }, []); // No dependencies needed

   useEffect(() => {
     // Request permissions when the hook mounts
     requestPermissions();
   }, [requestPermissions]); // Correct dependency

  // --- Stop Function ---
  // *** CHANGE 1: Stabilize stopStreamingMicrophone ***
  // Removed isStreamingMic from dependency array. It primarily uses refs and sets state without needing the previous value.
   const stopStreamingMicrophone = useCallback(async () => {
     // Use refs for the most up-to-date status check
     if (stopStreamingRef.current) {
        console.log("AUDIO_REC: Stop called but already stopping/stopped.");
        return;
     }
     // Optional: Check state if needed for UI logic before setting ref, but ref is key for loop control
    //  if (!isStreamingMic && !isProcessingSegmentRef.current) {
    //     console.log("AUDIO_REC: Stop called but not streaming or processing (state check).");
    //     // If we bail here, make sure stopStreamingRef is still false if it wasn't set
    //     return;
    //  }

     console.log('AUDIO_REC: Stopping microphone streaming...');
     stopStreamingRef.current = true; // Signal the loop and other operations to stop *first*

     // Update state AFTER signaling stop to ensure loop sees the ref change
     setIsStreamingMic(false);
     setVolumeIn(0);

      // Clean up any active recording instance *using refs*
      const currentRecording = recordingRef.current; // Capture ref value
      recordingRef.current = null; // Clear ref immediately

      if (currentRecording) {
          console.log("AUDIO_REC: Stop: Attempting to stop active recording instance...");
          try {
              await currentRecording.stopAndUnloadAsync();
              console.log("AUDIO_REC: Stop: Recording stopped and unloaded.");
              const uri = currentRecording.getURI();
              if (uri) {
                  // console.log("AUDIO_REC: Stop: Deleting partial segment file:", uri); // Optional log
                  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(e => console.warn("AUDIO_REC: Stop: Failed to delete partial segment file:", e));
              }
          } catch (e) {
              console.warn("AUDIO_REC: Stop: Error stopping active recording:", e);
              // Attempt deletion even if stop failed, URI might still be valid
              const uri = currentRecording.getURI();
              if (uri) {
                  // console.log("AUDIO_REC: Stop: Attempting delete after error for URI:", uri); // Optional log
                   await FileSystem.deleteAsync(uri, { idempotent: true }).catch(err => console.warn("AUDIO_REC: Stop: Failed to delete partial segment file after stop error:", err));
              }
          }
      } else {
          console.log("AUDIO_REC: Stop: No active recording instance found to stop.");
      }

      // Reset processing flag defensively
      isProcessingSegmentRef.current = false;

   }, []); // *** KEY CHANGE: Empty dependency array stabilizes this function ***


  // --- Core Streaming Loop ---
  const recordAndSendSegment = useCallback(async () => {
    // *** CHANGE 3: Added More Checks ***
    // Check stop signal immediately
    if (stopStreamingRef.current) {
        console.log("AUDIO_REC: Loop start check: Stop signal received.");
        isProcessingSegmentRef.current = false; // Ensure flag is reset if we exit early
        return;
    }

    // Prevent overlapping executions
    if (isProcessingSegmentRef.current) {
        console.warn("AUDIO_REC: Loop start check: Already processing a segment.");
        return;
    }

    // Use direct check on 'connected' state from context
    if (!connected || !client) {
        console.warn("AUDIO_REC: Not connected or client missing, stopping stream.");
        await stopStreamingMicrophone(); // Call the stable stop function
        return;
    }

    isProcessingSegmentRef.current = true;
    let segmentUri: string | null = null;
    let recordingInstance: Audio.Recording | null = null; // Keep track of the specific instance for this segment

    try {
        // *** CHANGE 3: Added More Checks ***
        if (stopStreamingRef.current) {
            console.log("AUDIO_REC: Pre-recording check: Stop signal received.");
            throw new Error("Streaming stopped before new segment recording could start."); // Throw to enter finally block for cleanup
        }

        // 1. Start short recording
        // console.log("AUDIO_REC: Creating new recording..."); // Optional log
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true }); // Ensure mode is set

        // Defensive cleanup of previous instance if somehow left hanging (shouldn't happen often with ref clearing)
        if (recordingRef.current) {
            console.warn("AUDIO_REC: Cleaning up unexpected previous recording instance before new one.");
            await recordingRef.current.stopAndUnloadAsync().catch(e => console.warn("AUDIO_REC: Minor error unloading previous recording:", e));
            recordingRef.current = null;
        }

        const { recording, status } = await Audio.Recording.createAsync(
            recordingOptions,
            (status: Audio.RecordingStatus) => {
                if (status.isRecording) {
                    const db = status.metering ?? -160; // Use -160 as minimum dB for volume calculation
                    const linearVolume = Math.max(0, Math.min(1, 1 + db / 60)); // Adjust scaling if needed
                    setVolumeIn(linearVolume);
                } else if (!status.isDoneRecording) { // Only reset volume if NOT done (i.e., unexpectedly stopped)
                    setVolumeIn(0);
                }
            },
            100 // Interval for metering updates
        );
        recordingInstance = recording;
        recordingRef.current = recording; // Store the current recording instance
        // console.log("AUDIO_REC: Recording started..."); // Optional log

        // Wait for the chunk duration
        await new Promise(resolve => setTimeout(resolve, RECORDING_CHUNK_DURATION_MS));

        // *** CHANGE 3: Added More Checks ***
        // Check stop signal *again* after waiting, and also ensure the recording instance is still the one we started
        if (stopStreamingRef.current || recordingRef.current !== recordingInstance) {
            console.log("AUDIO_REC: Stop signal received or recording instance changed during wait/record.");
            // No need to stop/unload here, finally block will handle the current 'recordingInstance' if it exists
            throw new Error("Streaming stopped or recording instance mismatch during segment processing."); // Throw to enter finally block
        }

        // 2. Stop recording *gracefully*
        // console.log("AUDIO_REC: Stopping segment recording..."); // Optional log
        await recordingInstance.stopAndUnloadAsync();
        // console.log("AUDIO_REC: Segment recording stopped and unloaded."); // Optional log
        segmentUri = recordingInstance.getURI();
        recordingRef.current = null; // Clear the ref *after* successful stop and URI retrieval
        // recordingInstance = null; // Redundant now as it's scoped, but for clarity

        if (!segmentUri) {
            throw new Error('AUDIO_REC: Failed to get segment URI after stopping recording.');
        }
        // console.log("AUDIO_REC: Segment URI obtained:", segmentUri); // Optional log

        // 3. Read and Send segment
        // *** CHANGE 3: Added More Checks ***
        if (stopStreamingRef.current) {
             throw new Error("Streaming stopped before segment could be sent.");
        }

        if (connected && client) {
            const fileInfo = await FileSystem.getInfoAsync(segmentUri);
            if (!fileInfo.exists) {
                throw new Error(`AUDIO_REC: Segment file does not exist at URI: ${segmentUri}`);
            }
            // console.log(`AUDIO_REC: Reading segment file (size: ${fileInfo.size})...`); // Optional log

            const base64Data = await FileSystem.readAsStringAsync(segmentUri, {
                encoding: FileSystem.EncodingType.Base64,
            });

            // Ensure correct MIME type for L16
            const mimeType = 'audio/l16; rate=16000; channels=1';
            // console.log("AUDIO_REC: Sending segment data..."); // Optional log

            client.sendRealtimeInput([
                { mimeType: mimeType, data: base64Data },
            ]);
            // console.log("AUDIO_REC: Segment sent."); // Optional log

        } else {
             console.warn("AUDIO_REC: Client disconnected before segment could be sent.");
             // No need to call stopStreamingMicrophone here, the loop will naturally stop on next iteration check or cleanup will handle it
        }

    } catch (err: any) {
        console.error('AUDIO_REC: Error during segment processing:', err.message); // Log only message for brevity
        // Don't set generic error state here unless it's fatal, let stop handle things
        await stopStreamingMicrophone(); // Ensure stop is called on error
    } finally {
        // console.log("AUDIO_REC: Entering finally block for segment processing..."); // Optional log
        // 4. Clean up segment file
        if (segmentUri) {
            // console.log("AUDIO_REC: Finally: Deleting segment file:", segmentUri); // Optional log
            await FileSystem.deleteAsync(segmentUri, { idempotent: true })
                .catch(e => console.warn("AUDIO_REC: Finally: Failed to delete segment file:", e));
        }

        // Defensive cleanup for the recording instance created in *this* iteration, in case of errors before stopAndUnloadAsync
        if (recordingInstance && recordingRef.current === recordingInstance) {
             console.warn("AUDIO_REC: Finally: Recording ref still pointing to this segment's instance. Cleaning up.");
             try {
                 await recordingInstance.stopAndUnloadAsync();
             } catch(e) {
                 console.warn("AUDIO_REC: Finally: Error during defensive stop/unload:", e);
             }
             recordingRef.current = null;
        }
        // If recordingRef was already nullified after successful stop, this check prevents double-stopping

        isProcessingSegmentRef.current = false; // Release the lock

        // 5. Schedule next segment only if stop signal is NOT set
        if (!stopStreamingRef.current) {
            // console.log("AUDIO_REC: Scheduling next segment..."); // Optional log
             requestAnimationFrame(recordAndSendSegment); // Schedule the *next* call
        } else {
             console.log("AUDIO_REC: Streaming loop finished (stop signal was set).");
             // Ensure state reflects stopped status if loop finishes due to stop signal
             // setIsStreamingMic(false); // Already done in stopStreamingMicrophone
        }
    }
  // Dependencies: Include functions/values from external scope that the callback's logic depends on.
  // client/connected: Used for sending data and checking connection.
  // stopStreamingMicrophone: Called on error/disconnect. It's stable now.
}, [client, connected, stopStreamingMicrophone]); // Removed isStreamingMic


  // --- Control Functions ---
  const startStreamingMicrophone = useCallback(async () => {
    // Use refs for immediate state checks to avoid race conditions
    if (isStreamingMic || isProcessingSegmentRef.current || !stopStreamingRef.current === false /* redundant check, means it's starting/running */) {
      console.warn(`AUDIO_REC: Start called but already streaming (isStreamingMic=${isStreamingMic}), processing (isProcessingSegmentRef=${isProcessingSegmentRef.current}), or stop signal not reset? (stopStreamingRef=${stopStreamingRef.current}).`);
      return;
    }

    if (!connected || !client) {
       console.warn('AUDIO_REC: Cannot start streaming, client not connected.');
       setError(new Error('Cannot start streaming: Client not connected.'));
       return;
    }

    // Check permission state directly
    let currentPermission = hasPermission;
    if (currentPermission !== true) {
      console.warn('AUDIO_REC: Permission not granted or unknown. Requesting...');
      await requestPermissions(); // Request and wait
      // Re-check permission status *after* requesting
      const permissionCheck = await Audio.getPermissionsAsync();
      currentPermission = permissionCheck.status === PermissionStatus.GRANTED;
      setHasPermission(currentPermission); // Update state
      setPermissionResponse(permissionCheck); // Update response state
    }

    if (currentPermission !== true) {
           setError(new Error('Cannot start streaming without microphone permission.'));
           console.error('AUDIO_REC: Start failed: Microphone permission refused.');
           return; // Exit if permission was not granted
    }

    console.log('AUDIO_REC: Starting microphone streaming...');
    setError(null); // Clear previous errors
    stopStreamingRef.current = false; // Explicitly reset stop signal *before* starting
    isProcessingSegmentRef.current = false; // Reset processing flag just in case
    recordingRef.current = null; // Ensure no stale recording ref
    setIsStreamingMic(true); // Set state to indicate streaming

    // Start the loop using requestAnimationFrame for smoother scheduling
    requestAnimationFrame(recordAndSendSegment);

  // Dependencies: Include everything from the outer scope that this function reads or calls.
  // hasPermission, isStreamingMic: State values read directly.
  // requestPermissions: Function called.
  // recordAndSendSegment: Function called.
  // connected, client: Context values read directly.
}, [hasPermission, isStreamingMic, requestPermissions, recordAndSendSegment, connected, client]);


   // --- Cleanup Effect ---
   // *** CHANGE 2: Use stable stop function in dependency array ***
   useEffect(() => {
    // This function runs ONLY when the component using the hook unmounts.
    return () => {
      console.log("AUDIO_REC: Cleaning up hook on unmount...");
      // Ensure stop is signaled and resources are cleaned up.
      // Call the stabilized useCallback version of stopStreamingMicrophone.
      if (!stopStreamingRef.current) { // Avoid logging/calling stop again if it was already called explicitly
          stopStreamingMicrophone();
      } else {
          console.log("AUDIO_REC: Unmount: Stop signal already set.");
          // Optionally, add extra checks here to ensure cleanup happened if paranoid
          const rec = recordingRef.current;
          if(rec) {
              console.warn("AUDIO_REC: Unmount: Recording ref was not null despite stop signal. Attempting cleanup again.");
              recordingRef.current = null;
              rec.stopAndUnloadAsync().catch(e => console.warn("AUDIO_REC: Unmount: Error during redundant cleanup:", e));
              // File deletion might be missed here if stopStreamingMicrophone didn't run fully
          }
      }
    };
   // Depend on the stable stop function reference. React Hook Lint rules prefer this.
   // Because stopStreamingMicrophone now has `[]` deps, its reference is stable,
   // so this effect's cleanup will only run on unmount, as intended.
   }, [stopStreamingMicrophone]);

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