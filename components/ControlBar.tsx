import { Ionicons } from '@expo/vector-icons'; // Importa ícones
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import AudioPulseIndicator from './AudioPulseIndicator';

interface ControlBarProps {
  connected: boolean;
  isConnecting: boolean;
  isRecording: boolean;
  isCameraStreaming: boolean;
  volumeIn: number;
  volumeOut: number;
  onConnectToggle: () => void;
  onMicToggle: () => void; // Deveria chamar start/stop recording
  onCameraToggle: () => void; // Deveria chamar start/stop streaming
  onSettingsPress: () => void;
}

const ControlBar: React.FC<ControlBarProps> = ({
  connected,
  isConnecting,
  isRecording,
  isCameraStreaming,
  volumeIn,
  volumeOut,
  onConnectToggle,
  onMicToggle,
  onCameraToggle,
  onSettingsPress
}) => {
  const getConnectIcon = () => {
    if (isConnecting) return "hourglass-outline";
    return connected ? "pause-circle" : "play-circle";
  };

  const getConnectColor = () => {
     if (isConnecting) return "#FFA500"; // Orange
     return connected ? "#4CAF50" : "#888"; // Green / Grey
  }

  const getMicColor = () => isRecording ? "#FF0000" : "#FFF"; // Red / White
  const getCameraColor = () => isCameraStreaming ? "#00FFFF" : "#FFF"; // Cyan / White

  return (
    <View style={styles.container}>
       {/* Botão de Configurações */}
       <Pressable onPress={onSettingsPress} style={styles.button}>
           <Ionicons name="settings-outline" size={30} color="#FFF" />
       </Pressable>

      {/* Indicador Volume Entrada (Mic) */}
      <AudioPulseIndicator volume={volumeIn} active={isRecording} color={getMicColor()} size={20} />

      {/* Botão Microfone */}
      <Pressable onPress={onMicToggle} style={styles.button}>
        <Ionicons name={isRecording ? "mic-off-outline" : "mic-outline"} size={35} color={getMicColor()} />
      </Pressable>

      {/* Botão Conectar/Desconectar */}
      <Pressable onPress={onConnectToggle} style={styles.connectButton} disabled={isConnecting}>
        <Ionicons name={getConnectIcon()} size={50} color={getConnectColor()} />
      </Pressable>

      {/* Botão Câmera Stream */}
       <Pressable onPress={onCameraToggle} style={styles.button}>
           <Ionicons name={isCameraStreaming ? "videocam-off-outline" : "videocam-outline"} size={35} color={getCameraColor()} />
       </Pressable>

      {/* Indicador Volume Saída (Playback) */}
       <AudioPulseIndicator volume={volumeOut} active={volumeOut > 0.1} color="#00FFFF" size={20} />

    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 80,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 10,
    paddingBottom: 15, // Padding para área segura inferior (ajustar com SafeAreaView se necessário)
  },
  button: {
    padding: 10,
  },
   connectButton: {
       padding: 5,
   },
});

export default ControlBar;