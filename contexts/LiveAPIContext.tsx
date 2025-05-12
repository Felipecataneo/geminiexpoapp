import Constants from 'expo-constants';
import React, {
    createContext,
    FC,
    ReactNode,
    useContext
} from 'react';
import { useLiveAPI, UseLiveAPIResults } from '../hooks/useLiveAPI'; // Ajuste o caminho

// Define um valor padrão ou nulo para o contexto inicial
const defaultContextValue: UseLiveAPIResults = {
  client: null as any, // Será inicializado no hook
  config: { model: 'models/gemini-1.5-flash-latest' }, // Modelo padrão inicial
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
  // A API Key agora vem do app.config.js via Constants
};

export const LiveAPIProvider: FC<LiveAPIProviderProps> = ({ children }) => {
  const apiKey = Constants.expoConfig?.extra?.EXPO_PUBLIC_GEMINI_API_KEY;

  if (!apiKey || apiKey === 'EXPO_PUBLIC_GEMINI_API_KEY') {
     // Renderiza um estado de erro ou aviso se a chave não estiver configurada
     // Isso evita que useLiveAPI tente conectar sem chave.
    console.error("FATAL: Gemini API Key not configured in app.config.js extra field.");
    return (
        <div style={{ padding: 20, backgroundColor: 'red', color: 'white' }}>
            Error: Gemini API Key is missing. Please configure it in app.config.js
        </div>
    );
    // Em RN seria um componente <View><Text>...</Text></View>
  }

  const liveAPI = useLiveAPI({ apiKey });

  return (
    <LiveAPIContext.Provider value={liveAPI}>{children}</LiveAPIContext.Provider>
  );
};

export const useLiveAPIContext = () => {
  const context = useContext(LiveAPIContext);
  if (context === defaultContextValue) {
      // Isso pode acontecer brevemente antes da inicialização, mas não deve persistir
    console.warn("LiveAPIContext accessed before provider initialization.");
  }
   if (!context) {
    // Este erro é mais grave, indica falta do Provider
    throw new Error('useLiveAPIContext must be used within a LiveAPIProvider');
  }
  return context;
};