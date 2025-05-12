import React, { useEffect, useRef, useState } from 'react';
import { Alert, SafeAreaView, StyleSheet, Text, View } from 'react-native';
// --- Import CameraView for the ref type ---
import { CameraView } from 'expo-camera';
import CameraPreview from '../../components/CameraPreview';
import ControlBar from '../../components/ControlBar';
import ConversationOverlay from '../../components/ConversationOverlay';
import SettingsModal from '../../components/SettingsModal';
import { LiveAPIProvider, useLiveAPIContext } from '../../contexts/LiveAPIContext';
import { useAudioRecorder } from '../../hooks/useAudioRecorder';
import { useCameraStreamer } from '../../hooks/useCameraStreamer';
import { isModelTurn, ModelTurn, ServerContent } from '../../multimodal-live-types';


// --- Componente Interno para Acessar o Contexto ---
const AppContent = () => {
  
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
      isRecording,
      volumeIn,
      startRecording,
      stopRecordingAndSend,
      hasPermission: hasMicPermission,
      error: recorderError,
  } = useAudioRecorder();

  // useCameraStreamer hook should correctly return startStreaming
  // which expects a RefObject<CameraView> based on our last fix
  const {
      isStreaming: isCameraStreaming,
      startStreaming,
      stopStreaming,
      hasPermission: hasCameraPermission,
      error: cameraError,
  } = useCameraStreamer();

  // --- Update the Ref type to CameraView ---
  const cameraRef = useRef<CameraView>(null);
  const [messages, setMessages] = useState<Array<{ id: string; sender: 'user' | 'model'; text: string }>>([]);
  const [isSettingsVisible, setIsSettingsVisible] = useState(false);

  // --- Tratamento de Erros ---
  useEffect(() => {
      const combinedError = apiError || recorderError || cameraError;
      if (combinedError) {
          // Avoid showing alert for common "component unmounted" errors during async ops
          if (!combinedError.message?.includes('unmounted') && !combinedError.message?.includes('component could not be found')) {
              Alert.alert("Error", combinedError.message);
          } else {
              console.warn("Caught expected error:", combinedError.message); // Log less critical errors
          }
      }
  }, [apiError, recorderError, cameraError]);

  // --- Processamento de Mensagens Recebidas ---
  useEffect(() => {
    if (!client || !connected) return; // Ensure client and connection exist

    const handleContent = (content: ServerContent) => {
      if (isModelTurn(content)) {
        const modelTurn = content as ModelTurn;
        const textParts = modelTurn.modelTurn.parts
          .map((part) => part.text)
          .filter((text): text is string => typeof text === 'string' && text.trim().length > 0)
          .join('\n');

        if (textParts) {
          setMessages((prev) => [
            ...prev,
            { id: Math.random().toString(), sender: 'model', text: textParts },
          ]);
        }
      }
    };

    const handleLog = (log: any) => {
        // console.log("App Log:", log); // Optional logging
    };

     const handleToolCall = (toolCall: any) => {
        console.log("Tool Call received in App:", toolCall);
         setMessages((prev) => [...prev, { id: Math.random().toString(), sender: 'model', text: `Function Call: ${toolCall.functionCalls[0]?.name}` }]);

          if (client && connected && toolCall.functionCalls?.length > 0) {
              setTimeout(() => {
                  // Ensure client still exists before sending
                  if(client) {
                      client.sendToolResponse({
                          functionResponses: toolCall.functionCalls.map((fc: any) => ({
                              id: fc.id,
                              response: { success: true, message: `Executed ${fc.name}` },
                          })),
                      });
                      setMessages((prev) => [...prev, { id: Math.random().toString(), sender: 'user', text: `(Function response sent for ${toolCall.functionCalls[0]?.name})` }]);
                  }
              }, 1000);
          }
    };

    client.on('content', handleContent);
    client.on('log', handleLog);
    client.on('toolcall', handleToolCall);

    return () => {
      // Check if client exists before removing listeners
      if (client) {
          client.off('content', handleContent);
          client.off('log', handleLog);
          client.off('toolcall', handleToolCall);
      }
    };
  }, [client, connected]); // Re-run if client or connected status changes

  // --- Handlers para Botões ---
  const handleConnectToggle = () => {
    if (connected) {
      disconnect();
    } else if (!isConnecting) {
      connect().catch(err => Alert.alert("Connection Failed", err.message));
    }
  };

  const handleMicToggle = () => {
    if (isRecording) {
      stopRecordingAndSend();
    } else {
      startRecording();
    }
  };

  const handleCameraToggle = () => {
    if (isCameraStreaming) {
      stopStreaming();
    } else {
       if (cameraRef.current) {
            // Pass the RefObject<CameraView> to startStreaming
            startStreaming(cameraRef.current);
       } else {
           console.warn("Attempted to start camera stream, but ref is not ready.");
           Alert.alert("Error", "Camera is not ready yet. Please wait a moment.");
       }
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* CameraPreview internally renders CameraView and accepts the ref */}
        <CameraPreview ref={cameraRef} hasPermission={hasCameraPermission} />
        <ConversationOverlay messages={messages} />
        <ControlBar
          connected={connected}
          isConnecting={isConnecting}
          isRecording={isRecording}
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

// --- Styles ---
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
       top: 60, // Adjusted slightly
       alignSelf: 'center',
       backgroundColor: 'rgba(0,0,0,0.75)',
       color: 'white',
       paddingVertical: 6,
       paddingHorizontal: 12,
       borderRadius: 8,
       fontSize: 14,
       zIndex: 10, // Ensure it's above other elements
   }
});