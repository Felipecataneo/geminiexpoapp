import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';

interface AudioPulseIndicatorProps {
  volume: number; // Normalized volume (0 to 1)
  active: boolean; // Indicates if audio is active (recording/playing)
  color?: string;
  size?: number;
}

const AudioPulseIndicator: React.FC<AudioPulseIndicatorProps> = ({
    volume,
    active,
    color = '#FFF',
    size = 20
}) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const targetScale = active ? 1 + (volume * 0.5) : 1; // Scale up to 1.5 based on volume
    const targetOpacity = active ? 0.5 + (volume * 0.5) : 0.5; // Opacity up to 1

    Animated.spring(scaleAnim, {
      toValue: targetScale,
      friction: 5,
      tension: 80,
      useNativeDriver: true, // Use native driver for performance
    }).start();

     Animated.timing(opacityAnim, {
      toValue: targetOpacity,
      duration: 100, // Quick opacity change
      useNativeDriver: true,
    }).start();

  }, [volume, active, scaleAnim, opacityAnim]);

  const animatedStyle = {
    transform: [{ scale: scaleAnim }],
    opacity: opacityAnim,
  };

  return (
    <Animated.View style={[styles.pulse, { backgroundColor: color, width: size, height: size, borderRadius: size / 2 }, animatedStyle]} />
  );
};

const styles = StyleSheet.create({
  pulse: {
    // Base styles are set dynamically
  },
});

export default AudioPulseIndicator;