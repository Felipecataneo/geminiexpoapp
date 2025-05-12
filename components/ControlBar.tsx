import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import AudioPulseIndicator from './AudioPulseIndicator'; // Keep for volume display

interface ControlBarProps {
  connected: boolean;
  isConnecting: boolean;
  isStreamingMic: boolean; // Updated prop name
  isCameraStreaming: boolean;
  volumeIn: number;
  volumeOut: number; // Use this for output volume visualization
  onConnectToggle: () => void;
  onMicToggle: () => void; // Name is fine, connects to the handler using new hook state
  onCameraToggle: () => void;
  onSettingsPress: () => void;
}

const ControlBar: React.FC<ControlBarProps> = ({
  connected,
  isConnecting,
  isStreamingMic, // Use updated prop
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

  // Use isStreamingMic for mic button state
  const getMicColor = () => isStreamingMic ? "#FF0000" : "#FFF"; // Red / White
  const getCameraColor = () => isCameraStreaming ? "#00FFFF" : "#FFF"; // Cyan / White

  return (
    <View style={styles.container}>
       {/* Settings Button */}
       <Pressable onPress={onSettingsPress} style={styles.button}>
           <Ionicons name="settings-outline" size={30} color="#FFF" />
       </Pressable>

      {/* Input Volume Indicator (Mic) */}
      <AudioPulseIndicator volume={volumeIn} active={isStreamingMic} color={getMicColor()} size={20} />

      {/* Mic Toggle Button */}
      <Pressable
        onPress={onMicToggle}
        style={styles.button}
        disabled={!connected && !isStreamingMic} // Disable mic if not connected (unless already streaming)
      >
        <Ionicons name={isStreamingMic ? "mic-off-outline" : "mic-outline"} size={35} color={getMicColor()} />
      </Pressable>

      {/* Connect/Disconnect Button */}
      <Pressable onPress={onConnectToggle} style={styles.connectButton} disabled={isConnecting}>
        <Ionicons name={getConnectIcon()} size={50} color={getConnectColor()} />
      </Pressable>

      {/* Camera Toggle Button */}
       <Pressable
          onPress={onCameraToggle}
          style={styles.button}
          disabled={!connected && !isCameraStreaming} // Disable camera if not connected (unless already streaming)
       >
           <Ionicons name={isCameraStreaming ? "videocam-off-outline" : "videocam-outline"} size={35} color={getCameraColor()} />
       </Pressable>

      {/* Output Volume Indicator (Playback) */}
      {/* Use volumeOut and check if > 0 for 'active' state */}
       <AudioPulseIndicator volume={volumeOut} active={volumeOut > 0} color="#00FFFF" size={20} />

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
    paddingBottom: 15, // Adjust as needed for safe area
  },
  button: {
    padding: 10,
  },
   connectButton: {
       padding: 5,
   },
});

export default ControlBar;