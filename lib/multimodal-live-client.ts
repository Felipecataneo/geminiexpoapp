import { Content, GenerativeContentBlob, Part } from '@google/generative-ai';
import { EventEmitter } from 'eventemitter3';
import { difference } from 'lodash';
import {
    ClientContentMessage,
    isInterrupted,
    isModelTurn,
    isServerContentMessage,
    isSetupCompleteMessage,
    isToolCallCancellationMessage,
    isToolCallMessage,
    isTurnComplete,
    LiveIncomingMessage,
    ModelTurn,
    RealtimeInputMessage,
    ServerContent,
    SetupMessage,
    StreamingLog,
    ToolCall,
    ToolCallCancellation,
    ToolResponseMessage,
    type LiveConfig,
} from '../multimodal-live-types'; // Ajuste o caminho se necessário
import { base64ToArrayBuffer } from './utils'; // Ajuste o caminho se necessário

// Tipos de Eventos (ajustados ligeiramente para clareza)
interface MultimodalLiveClientEventTypes {
  connecting: () => void;
  open: () => void;
  log: (log: StreamingLog) => void;
  close: (event: CloseEvent | { code: number; reason: string }) => void;
  error: (error: Event | Error) => void;
  audio: (data: ArrayBuffer) => void;
  content: (data: ServerContent) => void;
  interrupted: () => void;
  setupcomplete: () => void;
  turncomplete: () => void;
  toolcall: (toolCall: ToolCall) => void;
  toolcallcancellation: (toolcallCancellation: ToolCallCancellation) => void;
}

export type MultimodalLiveAPIClientConnection = {
  apiKey: string;
  url?: string;
};

export class MultimodalLiveClient extends EventEmitter<MultimodalLiveClientEventTypes> {
  public ws: WebSocket | null = null;
  protected config: LiveConfig | null = null;
  public url: string = '';
  private connectionParams: MultimodalLiveAPIClientConnection;
  private connectionAttempt: Promise<boolean> | null = null;

  public getConfig() {
    return { ...this.config };
  }

  constructor(params: MultimodalLiveAPIClientConnection) {
    super();
    this.connectionParams = params;
    const defaultUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent`;
    this.url = `${params.url || defaultUrl}?key=${params.apiKey}`;
    this.send = this.send.bind(this); // Garante o 'this' correto
  }

  log(type: string, message: StreamingLog['message']) {
    const log: StreamingLog = { date: new Date(), type, message };
    this.emit('log', log);
    // console.log(`[${type}]`, message); // Descomente para debug fácil
  }

  connect(config: LiveConfig): Promise<boolean> {
    // Evita múltiplas tentativas de conexão simultâneas
    if (this.connectionAttempt) {
      return this.connectionAttempt;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        console.warn("Already connected. Disconnect first if changing config.");
        return Promise.resolve(true);
    }

    this.config = config;
    this.log('client.connect', `Attempting to connect to ${this.url.split('?')[0]}...`);
    this.emit('connecting');

    this.connectionAttempt = new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(this.url);

        const onOpen = (event: Event) => {
          if (!this.config) {
            cleanupAndReject(new Error("Invalid config during connection"));
            return;
          }
          this.log(`client.open`, `WebSocket connected.`);
          this.ws = ws; // Assign AFTER successful open

          // Remove error/close handlers specific to connection phase
          ws.removeEventListener('error', onError);
          ws.removeEventListener('close', onCloseEarly);

          // Add persistent handlers
          ws.addEventListener('message', this.handleMessage.bind(this));
          ws.addEventListener('close', this.handleClose.bind(this));
          ws.addEventListener('error', this.handleError.bind(this)); // Generic error handler

          const setupMessage: SetupMessage = { setup: this.config };
          this._sendDirect(setupMessage);
          this.log('client.send', 'setup message');

          this.emit('open'); // Emit open AFTER setup message is sent
          this.connectionAttempt = null; // Clear attempt lock
          resolve(true);
        };

        const onError = (event: Event) => {
          // console.error("WebSocket connection error:", event);
          const error = new Error(`WebSocket connection error to ${this.url.split('?')[0]}`);
          this.emit('error', error); // Emit specific connection error
          cleanupAndReject(error);
        };

        const onCloseEarly = (event: CloseEvent) => {
          // console.warn("WebSocket closed before opening:", event);
          const error = new Error(`WebSocket closed unexpectedly during connection (Code: ${event.code}, Reason: ${event.reason})`);
          this.emit('error', error); // Emit specific connection error
          cleanupAndReject(error);
        };

        const cleanupAndReject = (error: Error) => {
            ws.removeEventListener('open', onOpen);
            ws.removeEventListener('error', onError);
            ws.removeEventListener('close', onCloseEarly);
            this.ws = null; // Ensure ws is null on failure
            this.connectionAttempt = null;
            reject(error);
        };


        // Attach temporary listeners for connection phase
        ws.addEventListener('open', onOpen);
        ws.addEventListener('error', onError);
        ws.addEventListener('close', onCloseEarly);

      } catch (error) {
        this.log('client.error', `Failed to create WebSocket: ${error}`);
        this.emit('error', error as Error);
        this.connectionAttempt = null;
        reject(error);
      }
    });
    return this.connectionAttempt;
  }

  disconnect() {
    if (this.ws) {
      this.log('client.disconnect', 'Disconnecting WebSocket.');
      // Remove persistent listeners before closing
      this.ws.removeEventListener('message', this.handleMessage.bind(this));
      this.ws.removeEventListener('close', this.handleClose.bind(this));
      this.ws.removeEventListener('error', this.handleError.bind(this));
      this.ws.close(1000, 'Client requested disconnect'); // Normal closure
      this.ws = null;
      // Emit close manually here because the 'close' event might not fire immediately
      // or if the connection was already dead.
      this.emit('close', { code: 1000, reason: 'Client requested disconnect' });
    } else {
      this.log('client.disconnect', 'Already disconnected.');
    }
     // Clear any pending connection attempt
    this.connectionAttempt = null;
  }

  private handleMessage(event: MessageEvent) {
    // Em RN, event.data é geralmente string ou ArrayBuffer
    if (typeof event.data === 'string') {
      try {
        const response: LiveIncomingMessage = JSON.parse(event.data);
        this.processIncomingMessage(response);
      } catch (e) {
        this.log('error.receive', `Failed to parse JSON: ${e}`);
        this.emit('error', e as Error);
      }
    } else {
      // Se for ArrayBuffer ou outro tipo, tratar aqui (API Gemini parece usar JSON)
      this.log('warn.receive', `Received non-string message: ${typeof event.data}`);
    }
  }

  private handleClose(event: CloseEvent) {
    this.log('server.close', `WebSocket closed (Code: ${event.code}, Reason: ${event.reason || 'No reason'})`);
    this.ws = null; // Ensure ws is null
    this.connectionAttempt = null; // Clear connection lock
    this.emit('close', event);
  }

  private handleError(event: Event) {
    // Handle generic WebSocket errors after connection
    this.log('server.error', `WebSocket error: ${event.type}`);
     // Try to extract more info if it's an ErrorEvent
    const error = (event instanceof ErrorEvent) ? event.error : new Error(`WebSocket error type: ${event.type}`);
    this.emit('error', error);
  }


  protected processIncomingMessage(response: LiveIncomingMessage) {
    this.log('server.receive', response); // Log the parsed message

    if (isToolCallMessage(response)) {
      this.log("server.toolCall", response); // Log specific type
      this.emit('toolcall', response.toolCall);
      return;
    }
    if (isToolCallCancellationMessage(response)) {
       this.log("server.toolCallCancellation", response);
      this.emit('toolcallcancellation', response.toolCallCancellation);
      return;
    }
    if (isSetupCompleteMessage(response)) {
      this.log("server.setupComplete", response);
      this.emit('setupcomplete');
      return;
    }

    if (isServerContentMessage(response)) {
      const { serverContent } = response;
      if (isInterrupted(serverContent)) {
        this.log("server.interrupted", response);
        this.emit('interrupted');
        return; // Interrupted often stands alone
      }
      if (isTurnComplete(serverContent)) {
        this.log("server.turnComplete", response);
        this.emit('turncomplete');
        // Don't return, might contain modelTurn as well
      }
      if (isModelTurn(serverContent)) {
        this.processModelTurn(serverContent);
      }
      // Emit the raw content message as well if needed by listeners
      this.emit('content', serverContent);

    } else {
      console.warn("Received unhandled message type:", response);
      this.log('warn.receive', `Unhandled message type: ${Object.keys(response)[0]}`);
    }
  }

   private processModelTurn(modelTurnContent: ModelTurn) {
    let parts: Part[] = modelTurnContent.modelTurn.parts;

    const audioParts = parts.filter(
      (p) => p.inlineData?.mimeType.startsWith('audio/pcm') || p.inlineData?.mimeType.startsWith('audio/mpeg') // Handle MP3 too
    );
    const otherParts = difference(parts, audioParts);

    // Process audio parts first
    audioParts.forEach((part) => {
      if (part.inlineData?.data) {
        try {
          const data = base64ToArrayBuffer(part.inlineData.data);
          this.emit('audio', data);
          this.log(`server.audio`, `Decoded audio buffer (${data.byteLength} bytes, mime: ${part.inlineData.mimeType})`);
        } catch (e) {
            this.log('error.audio', `Failed to decode audio data: ${e}`);
            this.emit('error', e as Error);
        }
      }
    });

    // If there are only audio parts, we might not need to emit 'content' again,
    // but the API might send text alongside audio, so check otherParts.
    if (otherParts.length > 0) {
       this.log(`server.content`, `Processing non-audio parts`);
       // Note: The 'content' event with the full serverContent is already emitted
       // in processIncomingMessage. We don't need to emit a separate event here
       // unless we want to specifically signal *only* the non-audio parts.
       // For simplicity, listeners can filter the 'content' event.
    }
  }

  /**
   * send realtimeInput, this is base64 chunks of "audio/..." and/or "image/jpeg"
   */
  sendRealtimeInput(chunks: GenerativeContentBlob[]) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
       this.log('warn.send', 'Attempted to send RealtimeInput while disconnected.');
       return;
    }
    let types = chunks.map(c => c.mimeType.split('/')[0]).join('+'); // e.g., "audio", "image", "audio+image"
    const message: RealtimeInputMessage = { realtimeInput: { mediaChunks: chunks } };
    this._sendDirect(message);
    this.log(`client.send.realtimeInput`, `(${types})`);
  }

  /**
   * send a response to a function call
   */
  sendToolResponse(toolResponse: ToolResponseMessage['toolResponse']) {
     if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
       this.log('warn.send', 'Attempted to send ToolResponse while disconnected.');
       return;
    }
    const message: ToolResponseMessage = { toolResponse };
    this._sendDirect(message);
    this.log(`client.send.toolResponse`, message);
  }

  /**
   * send normal content parts such as { text }
   */
  send(parts: Part | Part[], turnComplete: boolean = true) {
     if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
       this.log('warn.send', 'Attempted to send Content while disconnected.');
       return;
    }
    const finalParts = Array.isArray(parts) ? parts : [parts];
    const content: Content = { role: 'user', parts: finalParts };
    const message: ClientContentMessage = {
      clientContent: { turns: [content], turnComplete },
    };
    this._sendDirect(message);
    this.log(`client.send.content`, message);
  }

  /**
   * used internally to send all messages
   */
  _sendDirect(request: object) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // This should ideally be caught by the public methods, but double-check
      console.error("WebSocket is not connected or ready for sending.");
      this.log('error.send', `Attempted to send while WebSocket state was ${this.ws?.readyState}`);
      return; // Don't throw, just log and return
    }
    try {
      const str = JSON.stringify(request);
      this.ws.send(str);
    } catch (error) {
        console.error("Failed to stringify or send WebSocket message:", error);
        this.log('error.send', `Failed to send message: ${error}`);
        this.emit('error', error as Error);
    }
  }
}