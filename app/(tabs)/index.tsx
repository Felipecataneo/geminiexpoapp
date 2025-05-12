import { CameraView } from 'expo-camera';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, AppState, AppStateStatus, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import CameraPreview from '../../components/CameraPreview';
import ControlBar from '../../components/ControlBar';
import ConversationOverlay from '../../components/ConversationOverlay';
import SettingsModal from '../../components/SettingsModal';
import { LiveAPIProvider, useLiveAPIContext } from '../../contexts/LiveAPIContext';
import { useAudioRecorder } from '../../hooks/useAudioRecorder';
import { useCameraStreamer } from '../../hooks/useCameraStreamer';
// --- Import StreamingLog and ToolCall types ---
import { isModelTurn, LiveFunctionCall, ServerContent, StreamingLog, ToolCall } from '../../multimodal-live-types';


// --- Componente Interno para Acessar o Contexto ---
const AppContent = () => {
  const appState = useRef(AppState.currentState);

  const {
      connected,
      isConnecting,
      connect,
      disconnect,
      client,
      volumeOut,
      error: apiError,
      sendText,
  } = useLiveAPIContext();

  const {
      isStreamingMic,
      volumeIn,
      startStreamingMicrophone,
      stopStreamingMicrophone,
      hasPermission: hasMicPermission,
      error: recorderError,
  } = useAudioRecorder();

  const {
      isStreaming: isCameraStreaming,
      startStreaming,
      stopStreaming,
      hasPermission: hasCameraPermission,
      error: cameraError,
  } = useCameraStreamer();

  const cameraRef = useRef<CameraView>(null);
  // --- State type allows 'user', 'model', or 'system' ---
  const [messages, setMessages] = useState<Array<{ id: string; sender: 'user' | 'model' | 'system'; text: string }>>([]);
  const [isSettingsVisible, setIsSettingsVisible] = useState(false);

  // --- App State Handling ---
  useEffect(() => {
     const subscription = AppState.addEventListener('change', _handleAppStateChange);
     return () => {
       subscription.remove();
     };
   }, [connected, isStreamingMic, isCameraStreaming, stopStreamingMicrophone, stopStreaming]); // Add dependencies

  const _handleAppStateChange = (nextAppState: AppStateStatus) => {
     if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
       console.log('App has come to the foreground!');
     } else if (nextAppState.match(/inactive|background/)) {
         console.log('App has gone to the background.');
         if (isStreamingMic) {
             console.log("Stopping mic stream due to app backgrounding.");
             stopStreamingMicrophone(); // Use the function from the hook
         }
         if (isCameraStreaming) {
             console.log("Stopping camera stream due to app backgrounding.");
             stopStreaming(); // Use the function from the hook
         }
         // Disconnect logic remains optional
     }
     appState.current = nextAppState;
   };

  // --- Error Handling (Unchanged) ---
  useEffect(() => {
    const combinedError = apiError || recorderError || cameraError;
    if (combinedError) {
      const message = combinedError.message || "An unknown error occurred.";
      if (!message.includes('unmounted') && !message.includes('component could not be found') && !message.includes('WebSocket not open')) {
        console.error("Displaying Alert for Error:", message);
        Alert.alert("Error", message);
      } else {
        console.warn("Caught expected/transient error:", message);
      }
    }
  }, [apiError, recorderError, cameraError]);

  // --- Message and Tool Call Processing (Unchanged, handleLog now correctly typed) ---
  useEffect(() => {
    if (!client) return;

    const handleContent = (content: ServerContent) => {
      if (isModelTurn(content)) {
        const textParts = content.modelTurn.parts
          .map((part) => part.text)
          .filter((text): text is string => typeof text === 'string' && text.trim().length > 0)
          .join('\n');

        if (textParts) {
          console.log("MODEL TEXT:", textParts);
          setMessages((prev) => [
            ...prev,
            { id: `model_${Date.now()}`, sender: 'model', text: textParts },
          ]);
        }
      } else if ('turnComplete' in content) {
          console.log("Model turn complete.");
      } else if ('interrupted' in content) {
          console.log("Model turn interrupted.");
           setMessages((prev) => [
               ...prev,
               { id: `system_${Date.now()}`, sender: 'system', text: "(Model response interrupted)" },
           ]);
      }
    };

    const handleToolCall = (toolCall: ToolCall) => {
      console.log("Tool Call received in App:", toolCall);
      if (!toolCall.functionCalls || toolCall.functionCalls.length === 0) {
          console.warn("Received toolCall message with no functionCalls.");
          return;
      }

      toolCall.functionCalls.forEach((fc: LiveFunctionCall) => {
          setMessages((prev) => [...prev, {
              id: `model_fc_${fc.id}_${Date.now()}`,
              sender: 'model',
              text: `Wants to call function: ${fc.name}(${JSON.stringify(fc.args)})`
          }]);

           if (client && connected) {
               console.log(`Simulating execution for tool call ID: ${fc.id}, Name: ${fc.name}`);
               setTimeout(() => {
                   if (client && connected) {
                       const responsePayload = {
                           success: true,
                           message: `Simulated execution of ${fc.name} completed.`,
                       };
                       client.sendToolResponse({
                           functionResponses: [{
                               id: fc.id,
                               response: responsePayload,
                           }],
                       });
                       console.log(`Sent tool response for ID: ${fc.id}`);
                       setMessages((prev) => [...prev, {
                           id: `user_fc_resp_${fc.id}_${Date.now()}`,
                           sender: 'system', // Use 'system' for tool responses
                           text: `(Sent simulated response for ${fc.name})`
                       }]);
                   } else {
                        console.warn(`Cannot send tool response for ${fc.id}: Client disconnected.`);
                   }
               }, 500);
           }
      });
    };

    // --- Correctly typed handleLog ---
    const handleLog = (log: StreamingLog) => {
       // console.log("App Log:", log.type); // Simplified log
    };

    console.log("AppContent: Adding client listeners.");
    client.on('content', handleContent);
    client.on('toolcall', handleToolCall);
    client.on('log', handleLog); // Use the typed handler

    return () => {
      console.log("AppContent: Removing client listeners.");
      client.off('content', handleContent);
      client.off('toolcall', handleToolCall);
      client.off('log', handleLog);
    };
  }, [client, connected]);


  // --- Handler for Sending User Text Input (Unchanged) ---
  const handleSendUserText = (text: string) => {
      if (!text.trim()) return;
      if (connected && client) {
          sendText(text, true);
          setMessages((prev) => [
             ...prev,
             { id: `user_${Date.now()}`, sender: 'user', text: text },
          ]);
      } else {
           Alert.alert("Not Connected", "Please connect to the assistant first.");
      }
  };

  // --- Button Handlers (Unchanged) ---
  const handleConnectToggle = () => {
    if (connected) {
      disconnect();
    } else if (!isConnecting) {
      connect().catch(err => Alert.alert("Connection Failed", err.message || "Unknown connection error"));
    }
  };

  const handleMicToggle = () => {
    if (isStreamingMic) {
      stopStreamingMicrophone();
    } else {
        if(connected) {
            startStreamingMicrophone().catch(err => Alert.alert("Mic Start Failed", err.message || "Could not start microphone"));
        } else {
            Alert.alert("Not Connected", "Connect before starting the microphone.");
        }
    }
  };

  const handleCameraToggle = () => {
    if (isCameraStreaming) {
      stopStreaming();
    } else {
      if (connected) {
          if (cameraRef.current) {
              startStreaming(cameraRef.current);
          } else {
              console.warn("Attempted to start camera stream, but ref is not ready.");
              Alert.alert("Error", "Camera is not ready yet. Please wait.");
          }
      } else {
           Alert.alert("Not Connected", "Connect before starting the camera.");
      }
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <CameraPreview ref={cameraRef} hasPermission={hasCameraPermission} />
        {/* Pass the messages state which now matches the expected type */}
        <ConversationOverlay messages={messages} />
        <ControlBar
          connected={connected}
          isConnecting={isConnecting}
          isStreamingMic={isStreamingMic}
          isCameraStreaming={isCameraStreaming}
          volumeIn={volumeIn}
          volumeOut={volumeOut}
          onConnectToggle={handleConnectToggle}
          onMicToggle={handleMicToggle}
          onCameraToggle={handleCameraToggle}
          onSettingsPress={() => setIsSettingsVisible(true)}
        />
        <SettingsModal
          visible={isSettingsVisible}
          onClose={() => setIsSettingsVisible(false)}
        />
         {isConnecting && <Text style={styles.connectingIndicator}>Connecting...</Text>}
      </View>
    </SafeAreaView>
  );
};

// --- Componente Principal com Provider ---
export default function App() {
  return (
    <LiveAPIProvider>
      <AppContent />
    </LiveAPIProvider>
  );
}

// --- Styles (Unchanged) ---
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#000',
  },
  container: {
    flex: 1,
    position: 'relative',
  },
   connectingIndicator: {
       position: 'absolute',
       top: 60,
       alignSelf: 'center',
       backgroundColor: 'rgba(0,0,0,0.75)',
       color: 'white',
       paddingVertical: 6,
       paddingHorizontal: 12,
       borderRadius: 8,
       fontSize: 14,
       zIndex: 10,
   }
});