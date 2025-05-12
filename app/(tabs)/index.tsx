import React, { useEffect, useRef, useState } from 'react';
import { Alert, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import CameraPreview from '../../components/CameraPreview';
import ControlBar from '../../components/ControlBar';
import ConversationOverlay from '../../components/ConversationOverlay';
import SettingsModal from '../../components/SettingsModal';
import { LiveAPIProvider, useLiveAPIContext } from '../../contexts/LiveAPIContext'; // Importar o contexto
import { useAudioRecorder } from '../../hooks/useAudioRecorder';
import { useCameraStreamer } from '../../hooks/useCameraStreamer';
import { isModelTurn, ModelTurn, ServerContent } from '../../multimodal-live-types'; // Importar tipos

// --- Componente Interno para Acessar o Contexto ---
const AppContent = () => {
  const {
      connected,
      isConnecting,
      connect,
      disconnect,
      client, // Acessar o client diretamente para logs, tool calls, etc.
      volumeOut,
      error: apiError, // Renomeado para evitar conflito
      sendText, // Exemplo se adicionado ao contexto
  } = useLiveAPIContext();

  const {
      isRecording,
      volumeIn,
      startRecording,
      stopRecordingAndSend,
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

  const cameraRef = useRef<Camera>(null);
  const [messages, setMessages] = useState<Array<{ id: string; sender: 'user' | 'model'; text: string }>>([]);
  const [isSettingsVisible, setIsSettingsVisible] = useState(false);

  // --- Tratamento de Erros ---
  useEffect(() => {
      const combinedError = apiError || recorderError || cameraError;
      if (combinedError) {
          Alert.alert("Error", combinedError.message);
          // Poderia tentar resetar estados ou desconectar aqui
      }
  }, [apiError, recorderError, cameraError]);

  // --- Processamento de Mensagens Recebidas ---
  useEffect(() => {
    if (!client) return;

    const handleContent = (content: ServerContent) => {
        // console.log("AppContent received content:", content);
      if (isModelTurn(content)) {
        const modelTurn = content as ModelTurn;
        const textParts = modelTurn.modelTurn.parts
          .map((part) => part.text)
          .filter((text): text is string => typeof text === 'string' && text.trim().length > 0)
          .join('\n'); // Junta múltiplos textos

        if (textParts) {
          setMessages((prev) => [
            ...prev,
            { id: Math.random().toString(), sender: 'model', text: textParts },
          ]);
        }
      }
      // Poderia tratar turnComplete ou interrupted aqui se necessário
    };

    const handleLog = (log: any) => {
        // Se quiser adicionar logs de sistema à conversa:
        // if (typeof log.message === 'string' && log.type.startsWith('client.')) {
        //     setMessages(prev => [...prev, { id: Math.random().toString(), sender: 'user', text: `(Sent: ${log.message})` }]);
        // }
    };

     const handleToolCall = (toolCall: any) => {
        console.log("Tool Call received in App:", toolCall);
        // TODO: Implementar lógica de chamada de função aqui
        // Ex: Mostrar "Executando função..." e enviar resposta simulada
         setMessages((prev) => [...prev, { id: Math.random().toString(), sender: 'model', text: `Function Call: ${toolCall.functionCalls[0]?.name}` }]);

         // Enviar resposta de exemplo (DEVE ser baseada na execução real)
          if (client && connected && toolCall.functionCalls?.length > 0) {
              setTimeout(() => {
                  client.sendToolResponse({
                      functionResponses: toolCall.functionCalls.map((fc: any) => ({
                          id: fc.id,
                          response: { success: true, message: `Executed ${fc.name}` }, // Resposta de exemplo
                      })),
                  });
                  setMessages((prev) => [...prev, { id: Math.random().toString(), sender: 'user', text: `(Function response sent for ${toolCall.functionCalls[0]?.name})` }]);
              }, 1000); // Simula tempo de execução
          }

    };

    client.on('content', handleContent);
    client.on('log', handleLog);
    client.on('toolcall', handleToolCall);

    return () => {
      client.off('content', handleContent);
      client.off('log', handleLog);
      client.off('toolcall', handleToolCall);
    };
  }, [client, connected]); // Adiciona connected aqui

  // --- Handlers para Botões ---
  const handleConnectToggle = () => {
    if (connected) {
      disconnect();
    } else if (!isConnecting) {
        // Limpa mensagens antigas ao conectar? Opcional.
        // setMessages([]);
      connect().catch(err => Alert.alert("Connection Failed", err.message)); // Mostra erro se a conexão falhar
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
            startStreaming(cameraRef);
       } else {
           Alert.alert("Error", "Camera is not ready yet.");
       }
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
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
         {/* Indicador de Conexão (Opcional) */}
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

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#000', // Fundo da área segura
  },
  container: {
    flex: 1,
    position: 'relative', // Para posicionar overlays
  },
   connectingIndicator: {
       position: 'absolute',
       top: 50,
       alignSelf: 'center',
       backgroundColor: 'rgba(0,0,0,0.7)',
       color: 'white',
       paddingVertical: 5,
       paddingHorizontal: 10,
       borderRadius: 5,
       fontSize: 14,
   }
});