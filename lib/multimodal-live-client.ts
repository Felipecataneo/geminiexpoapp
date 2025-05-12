import { Content, GenerativeContentBlob, Part } from '@google/generative-ai';
import { EventEmitter } from 'eventemitter3';
import {
  ClientContentMessage,
  isInterrupted,
  isModelTurn,
  isServerContentMessage,
  isSetupCompleteMessage,
  isToolCallCancellationMessage,
  isToolCallMessage,
  isTurnComplete,
  LiveIncomingMessage, // Needed for ToolResponse type check
  ModelTurn,
  RealtimeInputMessage,
  ServerContent,
  SetupMessage,
  StreamingLog,
  ToolCall,
  ToolCallCancellation, // Needed for ToolResponse type check
  ToolResponseMessage,
  type LiveConfig
} from '../multimodal-live-types'; // Ajuste o caminho se necessário
import { base64ToArrayBuffer } from './utils'; // Ajuste o caminho se necessário

// Tipos de Eventos
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
  // Flag to prevent emitting close/error multiple times on disconnect
  private closingInitiated: boolean = false;


  public getConfig() {
    return { ...this.config };
  }

  constructor(params: MultimodalLiveAPIClientConnection) {
    super();
    this.connectionParams = params;
    const defaultUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent`;
    this.url = `${params.url || defaultUrl}?key=${params.apiKey}`;
    // Bind methods that might lose 'this' context if passed as callbacks directly
    this.handleMessage = this.handleMessage.bind(this);
    this.handleClose = this.handleClose.bind(this);
    this.handleError = this.handleError.bind(this);
    this.send = this.send.bind(this);
  }

  log(type: string, message: StreamingLog['message']) {
    const log: StreamingLog = { date: new Date(), type, message };
    this.emit('log', log);
    // console.log(`[${type}]`, message); // Descomente para debug fácil
  }

  connect(config: LiveConfig): Promise<boolean> {
    if (this.connectionAttempt) {
      console.log("Connection attempt already in progress.");
      return this.connectionAttempt;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        console.warn("Already connected. Disconnect first if changing config.");
        return Promise.resolve(true);
    }

    this.config = config;
    this.closingInitiated = false; // Reset closing flag on new attempt
    this.log('client.connect', `Attempting to connect to ${this.url.split('?')[0]}...`);
    this.emit('connecting');

    this.connectionAttempt = new Promise((resolve, reject) => {
      try {
        console.log("Creating new WebSocket instance...");
        const ws = new WebSocket(this.url);

        const onOpen = (event: Event) => {
          console.log("WebSocket 'open' event received.");
          if (!this.config) {
            console.error("Config became null during connection, rejecting.");
            cleanupAndReject(new Error("Invalid config during connection"));
            return;
          }
          this.log(`client.open`, `WebSocket connected.`);
          this.ws = ws; // Assign AFTER successful open

          // Remove temporary listeners
          ws.removeEventListener('error', onError);
          ws.removeEventListener('close', onCloseEarly);

          // Add persistent listeners using bound methods
          ws.addEventListener('message', this.handleMessage);
          ws.addEventListener('close', this.handleClose);
          ws.addEventListener('error', this.handleError);

          console.log("Sending setup message...");
          const setupMessage: SetupMessage = { setup: this.config };
          this._sendDirect(setupMessage); // Send setup
          this.log('client.send', 'setup message');

          this.emit('open'); // Emit open AFTER setup message is sent
          this.connectionAttempt = null; // Clear attempt lock
          resolve(true);
        };

        const onError = (event: Event | ErrorEvent) => {
           const errorMsg = (event instanceof ErrorEvent) ? event.message : `WebSocket connection error event type: ${event.type}`;
           console.error("WebSocket 'error' event during connection:", errorMsg, event);
           const error = new Error(`WebSocket connection error: ${errorMsg}`);
           this.emit('error', error);
           cleanupAndReject(error);
        };

        const onCloseEarly = (event: CloseEvent) => {
          console.warn("WebSocket 'close' event before opening:", event.code, event.reason);
          const error = new Error(`WebSocket closed unexpectedly during connection (Code: ${event.code}, Reason: ${event.reason || 'Unknown'})`);
           // Don't emit 'close' here, just the error indicating connection failure
          this.emit('error', error);
          cleanupAndReject(error);
        };

        const cleanupAndReject = (error: Error) => {
            ws.removeEventListener('open', onOpen);
            ws.removeEventListener('error', onError);
            ws.removeEventListener('close', onCloseEarly);
            this.ws = null; // Ensure ws is null on failure
            this.connectionAttempt = null;
            if (!this.closingInitiated) { // Avoid double rejection/close emit
                 reject(error);
            }
            this.closingInitiated = true; // Mark as closing initiated
        };

        console.log("Adding temporary WebSocket event listeners for connection...");
        ws.addEventListener('open', onOpen);
        ws.addEventListener('error', onError);
        ws.addEventListener('close', onCloseEarly);

      } catch (error) {
        console.error("Failed to create WebSocket:", error);
        this.log('client.error', `Failed to create WebSocket: ${error}`);
        this.emit('error', error as Error);
        this.connectionAttempt = null;
        reject(error);
      }
    });
    return this.connectionAttempt;
  }

  disconnect() {
    if (this.closingInitiated) {
        console.log("Disconnect called but closing already initiated.");
        return;
    }
    if (this.ws) {
      this.log('client.disconnect', 'Disconnecting WebSocket.');
      this.closingInitiated = true; // Set flag immediately

      // Remove persistent listeners BEFORE closing
      this.ws.removeEventListener('message', this.handleMessage);
      this.ws.removeEventListener('close', this.handleClose);
      this.ws.removeEventListener('error', this.handleError);

      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close(1000, 'Client requested disconnect'); // Normal closure
      }
      this.ws = null; // Null the reference

      // Emit close manually ONLY IF the handler hasn't already fired
      // Check readyState isn't already CLOSED or CLOSING
      console.log("Manually emitting 'close' after disconnect call.");
      this.emit('close', { code: 1000, reason: 'Client requested disconnect' });

    } else {
      this.log('client.disconnect', 'Already disconnected or no WebSocket instance.');
    }
    this.connectionAttempt = null; // Clear any pending connection attempt
  }

  private handleMessage(event: MessageEvent) {
    // console.log("RAW MESSAGE RECEIVED:", event.data); // Log raw (can be verbose)
    if (typeof event.data === 'string') {
      try {
        const response: LiveIncomingMessage = JSON.parse(event.data);
        console.log("PARSED MESSAGE:", JSON.stringify(response, null, 1)); // Pretty print slightly
        this.processIncomingMessage(response);
      } catch (e) {
        this.log('error.receive', `Failed to parse JSON: ${e} - Data: ${event.data}`);
        this.emit('error', e as Error);
      }
    } else {
      this.log('warn.receive', `Received non-string message type: ${typeof event.data}`);
    }
  }

  private handleClose(event: CloseEvent) {
    // Prevent emitting close if disconnect() was called and handled it
    if (this.closingInitiated && event.code === 1000 && event.reason === 'Client requested disconnect') {
        console.log("WebSocket 'close' event received after explicit disconnect, ignoring duplicate emit.");
        return;
    }
    if (this.closingInitiated) {
        console.log(`WebSocket 'close' event (code: ${event.code}, reason: ${event.reason}) received after closing initiated.`);
        // Don't emit again if closingInitiated is true
        return;
    }

    this.log('server.close', `WebSocket closed unexpectedly (Code: ${event.code}, Reason: ${event.reason || 'No reason'})`);
    this.ws = null;
    this.connectionAttempt = null;
    this.closingInitiated = true; // Mark as closed
    this.emit('close', event); // Emit the actual close event
  }

  private handleError(event: Event | ErrorEvent) {
     if (this.closingInitiated) {
         console.log("WebSocket 'error' event received after closing initiated, ignoring.");
         return;
     }
    const errorMsg = (event instanceof ErrorEvent) ? event.message : `WebSocket error event type: ${event.type}`;
    this.log('server.error', `WebSocket error: ${errorMsg}`);
    const error = (event instanceof ErrorEvent) ? event.error : new Error(`WebSocket error type: ${event.type}`);
    this.emit('error', error);
     // Consider if closing should be initiated on error
     // this.closingInitiated = true;
     // this.ws = null; // Might be necessary
  }


  protected processIncomingMessage(response: LiveIncomingMessage) {
    this.log('server.receive', response);

    if (isServerContentMessage(response)) {
      const { serverContent } = response;
      console.log("PROCESSING ServerContent:", JSON.stringify(serverContent, null, 1));

      // Emit the raw content message first - listeners might need the whole thing
       this.emit('content', serverContent);

       // Then process specific parts
      if (isInterrupted(serverContent)) {
        this.log("server.interrupted", response);
        this.emit('interrupted');
      }
      if (isTurnComplete(serverContent)) {
        this.log("server.turnComplete", response);
        this.emit('turncomplete');
      }
      if (isModelTurn(serverContent)) {
        this.processModelTurn(serverContent);
      }
    } else if (isToolCallMessage(response)) {
      this.log("server.toolCall", response);
      this.emit('toolcall', response.toolCall);
    } else if (isToolCallCancellationMessage(response)) {
       this.log("server.toolCallCancellation", response);
      this.emit('toolcallcancellation', response.toolCallCancellation);
    } else if (isSetupCompleteMessage(response)) {
      this.log("server.setupComplete", response);
      this.emit('setupcomplete');
    } else {
      console.warn("Received unhandled message type:", response);
      this.log('warn.receive', `Unhandled message type: ${Object.keys(response)[0]}`);
    }
  }

   private processModelTurn(modelTurnContent: ModelTurn) {
    console.log("PROCESSING ModelTurn:", JSON.stringify(modelTurnContent, null, 1));
    let parts: Part[] = modelTurnContent.modelTurn.parts;

    const audioParts = parts.filter(
      (p) => p.inlineData?.mimeType.startsWith('audio/')
    );
    const textParts = parts.filter(p => p.text); // Separate text parts

    console.log(`Found ${audioParts.length} audio parts and ${textParts.length} text parts in ModelTurn.`);

    // Emit audio parts
    audioParts.forEach((part) => {
      if (part.inlineData?.data) {
        try {
          const data = base64ToArrayBuffer(part.inlineData.data);
          console.log(`DECODED audio part, ${data.byteLength} bytes, mime: ${part.inlineData.mimeType}. Emitting 'audio' event.`);
          this.emit('audio', data);
          this.log(`server.audio`, `Decoded audio buffer (${data.byteLength} bytes, mime: ${part.inlineData.mimeType})`);
        } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            this.log('error.audio', `Failed to decode audio data: ${errorMsg}`);
            this.emit('error', e as Error);
        }
      }
    });

    // Note: The 'content' event containing the full serverContent (including text)
    // was already emitted in processIncomingMessage. Listeners can extract text from there.
  }

  sendRealtimeInput(chunks: GenerativeContentBlob[]) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
       this.log('warn.send', 'Attempted to send RealtimeInput while disconnected.');
       return;
    }
    let types = chunks.map(c => c.mimeType.split('/')[0]).join('+');
    const message: RealtimeInputMessage = { realtimeInput: { mediaChunks: chunks } };
    this._sendDirect(message);
    // Avoid logging the full base64 data here for brevity
    this.log(`client.send.realtimeInput`, `(${types}) chunk(s)`);
  }

  sendToolResponse(toolResponse: ToolResponseMessage['toolResponse']) {
     if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
       this.log('warn.send', 'Attempted to send ToolResponse while disconnected.');
       return;
    }
    const message: ToolResponseMessage = { toolResponse };
    this._sendDirect(message);
    this.log(`client.send.toolResponse`, message);
  }

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

  _sendDirect(request: object) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error("WebSocket is not connected or ready for sending.");
      this.log('error.send', `Attempted to send while WebSocket state was ${this.ws?.readyState}`);
      return;
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