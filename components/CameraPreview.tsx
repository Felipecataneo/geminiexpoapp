import { Camera } from 'expo-camera';
import React, { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface CameraPreviewProps {
  hasPermission: boolean | null;
  // Não precisa mais do onCameraReady, a ref é passada diretamente
}

// Usamos forwardRef para passar a ref para o componente Camera
const CameraPreview = forwardRef<Camera, CameraPreviewProps>(
    ({ hasPermission }, ref) => {

  if (hasPermission === null) {
    return <View style={styles.container}><Text style={styles.text}>Requesting camera permission...</Text></View>;
  }
  if (hasPermission === false) {
    return <View style={styles.container}><Text style={styles.text}>No access to camera. Please grant permission in settings.</Text></View>;
  }

  return (
    <View style={styles.container}>
      <Camera style={styles.camera} type={Camera.Constants.Type.back} ref={ref} />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
    justifyContent: 'center',
    alignItems: 'center',
  },
  camera: {
    ...StyleSheet.absoluteFillObject, // Faz a câmera preencher o container
  },
   text: {
    color: 'white',
    fontSize: 16,
  },
});

export default CameraPreview;