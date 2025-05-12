import React from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

// --- UPDATED Message Interface ---
interface Message {
  id: string;
  sender: 'user' | 'model' | 'system'; // Allow 'system'
  text: string;
}

interface ConversationOverlayProps {
  messages: Message[]; // Use the updated interface
}

const ConversationOverlay: React.FC<ConversationOverlayProps> = ({ messages }) => {
  const renderItem = ({ item }: { item: Message }) => (
    <View style={[
        styles.messageBubble,
        item.sender === 'user' ? styles.userBubble :
        item.sender === 'model' ? styles.modelBubble :
        styles.systemBubble // Add style for system messages
    ]}>
      <Text style={[
          styles.messageText,
          item.sender === 'system' ? styles.systemText : null // Optional different text style
      ]}>
          {item.text}
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={messages}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        inverted // Show most recent messages at the bottom
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 40,
    left: 10,
    right: 10,
    bottom: 90, // Adjust according to ControlBar height
    padding: 5,
  },
  listContent: {
    paddingBottom: 10,
    justifyContent: 'flex-end', // Align content at the bottom when inverted
  },
  messageBubble: {
    maxWidth: '80%',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 15,
    marginBottom: 8,
  },
  userBubble: {
    backgroundColor: '#DCF8C6', // Light green
    alignSelf: 'flex-end',
    borderBottomRightRadius: 5, // Slight adjustment for visual consistency
  },
  modelBubble: {
    backgroundColor: '#E5E5EA', // Light gray
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 5, // Slight adjustment
  },
  // --- ADDED System Bubble Style ---
  systemBubble: {
    backgroundColor: '#f0f0f0', // Lighter gray or distinct color
    alignSelf: 'center', // Center system messages
    borderRadius: 8,
    maxWidth: '90%',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  messageText: {
    fontSize: 15,
    color: '#000',
  },
   // --- ADDED Optional System Text Style ---
   systemText: {
       fontSize: 12,
       color: '#555', // Darker gray text
       fontStyle: 'italic',
       textAlign: 'center',
   },
});

export default ConversationOverlay;