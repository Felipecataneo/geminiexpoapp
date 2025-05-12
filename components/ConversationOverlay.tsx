import React from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

// Defina uma interface para suas mensagens
interface Message {
  id: string;
  sender: 'user' | 'model';
  text: string;
}

interface ConversationOverlayProps {
  messages: Message[];
}

const ConversationOverlay: React.FC<ConversationOverlayProps> = ({ messages }) => {
  const renderItem = ({ item }: { item: Message }) => (
    <View style={[styles.messageBubble, item.sender === 'user' ? styles.userBubble : styles.modelBubble]}>
      <Text style={styles.messageText}>{item.text}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={messages}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        inverted // Mostra mensagens mais recentes na parte inferior
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 40, // Ajuste conforme necessário (abaixo da barra de status)
    left: 10,
    right: 10,
    bottom: 90, // Ajuste conforme necessário (acima da ControlBar)
    // backgroundColor: 'rgba(0, 0, 0, 0.1)', // Fundo sutil opcional
    padding: 5,
  },
  listContent: {
    paddingBottom: 10, // Espaço na parte inferior da lista
     justifyContent: 'flex-end', // Alinha o conteúdo na parte inferior quando invertido
  },
  messageBubble: {
    maxWidth: '80%',
    padding: 10,
    borderRadius: 15,
    marginBottom: 8,
  },
  userBubble: {
    backgroundColor: '#DCF8C6', // Verde claro (tipo WhatsApp)
    alignSelf: 'flex-end',
    borderBottomRightRadius: 0,
  },
  modelBubble: {
    backgroundColor: '#E5E5EA', // Cinza claro
    alignSelf: 'flex-start',
     borderBottomLeftRadius: 0,
  },
  messageText: {
    fontSize: 15,
     color: '#000',
  },
});

export default ConversationOverlay;