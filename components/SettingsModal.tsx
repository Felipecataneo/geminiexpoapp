import Constants from 'expo-constants';
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
  // Poderia passar a chave atual e uma função para salvá-la,
  // mas por simplicidade, apenas mostramos a chave do config.
}

const SettingsModal: React.FC<SettingsModalProps> = ({ visible, onClose }) => {
  // Lemos a chave apenas para exibição (não editável aqui)
   const currentApiKey = Constants.expoConfig?.extra?.GEMINI_API_KEY || 'Not Set';
   const isApiKeySet = currentApiKey !== 'YOUR_API_KEY_HERE_OR_IN_ENV' && currentApiKey !== 'Not Set';

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.centeredView}>
        <View style={styles.modalView}>
          <Text style={styles.modalTitle}>Settings</Text>

          <View style={styles.settingItem}>
              <Text style={styles.settingLabel}>Gemini API Key:</Text>
              <Text style={styles.apiKeyText} numberOfLines={1} ellipsizeMode="middle">
                  {isApiKeySet ? `********${currentApiKey.slice(-4)}` : 'Not configured!'}
              </Text>
               <Text style={styles.infoText}>
                 {isApiKeySet
                   ? 'API Key is set via app.config.js'
                   : 'Configure your API Key in .env or EAS Secrets and rebuild.'}
               </Text>
          </View>

           {/* Adicionar outras configurações aqui (ex: Picker para voz) */}

          <Pressable
            style={[styles.button, styles.buttonClose]}
            onPress={onClose}
          >
            <Text style={styles.textStyle}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  centeredView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)', // Fundo escurecido
  },
  modalView: {
    margin: 20,
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 35,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    width: '85%',
  },
   modalTitle: {
    marginBottom: 20,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: 'bold',
  },
  settingItem: {
      marginBottom: 20,
      width: '100%',
  },
   settingLabel: {
       fontSize: 16,
       marginBottom: 5,
   },
   apiKeyText: {
       fontSize: 14,
       color: '#555',
       borderWidth: 1,
       borderColor: '#ccc',
       padding: 8,
       borderRadius: 5,
   },
   infoText: {
       fontSize: 12,
       color: '#777',
       marginTop: 5,
       textAlign: 'center',
   },
  button: {
    borderRadius: 10,
    padding: 12,
    elevation: 2,
    minWidth: 100,
     marginTop: 15,
  },
  buttonClose: {
    backgroundColor: '#2196F3',
  },
  textStyle: {
    color: 'white',
    fontWeight: 'bold',
    textAlign: 'center',
  },
});

export default SettingsModal;