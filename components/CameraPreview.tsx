// Import CameraView as the component and CameraType for type annotation
import { CameraView } from 'expo-camera';
import React, { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface CameraPreviewProps {
  hasPermission: boolean | null;
}

// Use forwardRef to pass the ref to the CameraView component
// Update the ref type to CameraView
const CameraPreview = forwardRef<CameraView, CameraPreviewProps>(
    ({ hasPermission }, ref) => {

  if (hasPermission === null) {
    return <View style={styles.container}><Text style={styles.text}>Requesting camera permission...</Text></View>;
  }
  if (hasPermission === false) {
    return <View style={styles.container}><Text style={styles.text}>No access to camera. Please grant permission in settings.</Text></View>;
  }

  return (
    <View style={styles.container}>
      {/* Use CameraView component and the 'facing' prop with a string literal */}
      <CameraView style={styles.camera} facing={'back'} ref={ref} />
    </View>
  );
});

// Add a display name for debugging purposes
CameraPreview.displayName = 'CameraPreview';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
    justifyContent: 'center',
    alignItems: 'center',
  },
  camera: {
    ...StyleSheet.absoluteFillObject, // CameraView should fill the container
  },
   text: {
    color: 'white',
    fontSize: 16,
  },
});

export default CameraPreview;