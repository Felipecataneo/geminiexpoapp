import React, {
  createContext,
  FC,
  ReactNode,
  useContext
} from 'react';
// Import React Native components for error display
import { StyleSheet, Text, View } from 'react-native';
import { useLiveAPI, UseLiveAPIResults } from '../hooks/useLiveAPI'; // Ajuste o caminho

// Define um valor padrão ou nulo para o contexto inicial
const defaultContextValue: UseLiveAPIResults = {
  client: null as any, // Será inicializado no hook
  config: { model: 'models/gemini-2.0-flash-live-001' }, // Modelo padrão inicial
  connected: false,
  isConnecting: false,
  error: null,
  volumeOut: 0,
  connect: () => Promise.reject(new Error("Context not yet initialized")),
  disconnect: () => {},
  setConfig: () => {},
  sendText: () => {},
};

const LiveAPIContext = createContext<UseLiveAPIResults>(defaultContextValue);

export type LiveAPIProviderProps = {
  children: ReactNode;
};

export const LiveAPIProvider: FC<LiveAPIProviderProps> = ({ children }) => {
  // --- Read API Key directly from process.env ---
  // Expo CLI automatically loads .env variables starting with EXPO_PUBLIC_
  // into process.env for client-side code.
  const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;

  // --- Improved Check ---
  if (!apiKey || apiKey === '' || apiKey.includes('YOUR_API_KEY')) { // Check if empty or placeholder
    const errorMsg = "FATAL: Gemini API Key not configured. Please set EXPO_PUBLIC_GEMINI_API_KEY in your .env file.";
    console.error(errorMsg);
    // --- Render React Native Error View ---
    return (
        <View style={styles.errorContainer}>
            <Text style={styles.errorTitle}>Configuration Error</Text>
            <Text style={styles.errorText}>
                Gemini API Key is missing or invalid.
            </Text>
            <Text style={styles.errorInstructions}>
                Please ensure `EXPO_PUBLIC_GEMINI_API_KEY` is correctly set in your `.env` file in the project root and restart the app.
            </Text>
        </View>
    );
  }

  // Pass the correctly retrieved apiKey to the hook
  const liveAPI = useLiveAPI({ apiKey });

  return (
    <LiveAPIContext.Provider value={liveAPI}>{children}</LiveAPIContext.Provider>
  );
};

export const useLiveAPIContext = () => {
  const context = useContext(LiveAPIContext);
  // Keep the checks, they are still useful
  if (context === defaultContextValue) {
    console.warn("LiveAPIContext accessed before provider initialization.");
  }
   if (!context) {
    throw new Error('useLiveAPIContext must be used within a LiveAPIProvider');
  }
  return context;
};

// --- Styles for Error View ---
const styles = StyleSheet.create({
    errorContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
        backgroundColor: '#ffcccc', // Light red background
    },
    errorTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#cc0000', // Dark red text
        marginBottom: 10,
    },
    errorText: {
        fontSize: 16,
        color: '#cc0000',
        textAlign: 'center',
        marginBottom: 15,
    },
    errorInstructions: {
        fontSize: 14,
        color: '#800000', // Darker red/brown
        textAlign: 'center',
    }
});