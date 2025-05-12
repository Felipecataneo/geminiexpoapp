/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
  LiveIncomingMessage, // Needed for type checks
  ModelTurn,
  RealtimeInputMessage,
  ServerContent,
  SetupMessage,
  StreamingLog,
  ToolCall,
  ToolCallCancellation, // Needed for type checks
  ToolResponseMessage,
  type LiveConfig
} from '../multimodal-live-types'; // Adjust path if necessary
import { base64ToArrayBuffer } from './utils'; // Adjust path if necessary

// Event Types remain the same
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
  private closingInitiated: boolean = false;

  public getConfig() {
    return { ...this.config };
  }

  constructor(params: MultimodalLiveAPIClientConnection) {
    super();
    this.connectionParams = params;
    const defaultUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent`;
    this.url = `${params.url || defaultUrl}?key=${params.apiKey}`;
    // Bind methods
    this.handleMessage = this.handleMessage.bind(this);
    this.handleClose = this.handleClose.bind(this);
    this.handleError = this.handleError.bind(this);
    this.send = this.send.bind(this);
    this.sendRealtimeInput = this.sendRealtimeInput.bind(this);
    this.sendToolResponse = this.sendToolResponse.bind(this);
    this._sendDirect = this._sendDirect.bind(this);
  }

  log(type: string, message: StreamingLog['message']) {
    const log: StreamingLog = { date: new Date(), type, message };
    this.emit('log', log);
    // console.log(`[${type}]`, message); // Uncomment for easy debug
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
    this.closingInitiated = false;
    this.log('client.connect', `Attempting to connect to ${this.url.split('?')[0]}...`);
    this.emit('connecting');

    this.connectionAttempt = new Promise((resolve, reject) => {
      try {
        console.log("Creating new WebSocket instance...");
        const ws = new WebSocket(this.url);

        const onOpen = () => {
          console.log("WebSocket 'open' event received.");
          if (!this.config) {
            console.error("Config became null during connection, rejecting.");
            cleanupAndReject(new Error("Invalid config during connection"));
            return;
          }
          this.log(`client.open`, `WebSocket connected.`);
          this.ws = ws;

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
          this.connectionAttempt = null;
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
          this.emit('error', error);
          cleanupAndReject(error);
        };

        const cleanupAndReject = (error: Error) => {
            ws.removeEventListener('open', onOpen);
            ws.removeEventListener('error', onError);
            ws.removeEventListener('close', onCloseEarly);
            this.ws = null;
            this.connectionAttempt = null;
            if (!this.closingInitiated) {
                 reject(error);
            }
            this.closingInitiated = true;
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
      this.closingInitiated = true;

      // Safely remove listeners
      try {
        this.ws.removeEventListener('message', this.handleMessage);
        this.ws.removeEventListener('close', this.handleClose);
        this.ws.removeEventListener('error', this.handleError);
      } catch (e) {
        console.warn("Error removing WebSocket listeners during disconnect:", e);
      }


      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        try {
            this.ws.close(1000, 'Client requested disconnect');
        } catch (e) {
            console.warn("Error closing WebSocket during disconnect:", e);
        }
      }
      const wasConnected = this.ws?.readyState !== WebSocket.CLOSED;
      this.ws = null;

      // Manually emit close only if it wasn't already closing/closed naturally
      // Check readyState isn't already CLOSED or CLOSING
      if (wasConnected) {
          console.log("Manually emitting 'close' after disconnect call.");
          // Use setTimeout to ensure it happens after the current execution context
          setTimeout(() => {
              this.emit('close', { code: 1000, reason: 'Client requested disconnect' });
          }, 0);
      } else {
          console.log("WebSocket already closed or closing, not emitting manual close.");
      }


    } else {
      this.log('client.disconnect', 'Already disconnected or no WebSocket instance.');
    }
    this.connectionAttempt = null; // Clear any pending connection attempt
  }

  // --- UPDATED handleMessage ---
  private async handleMessage(event: MessageEvent) {
    let dataToParse: string | null = null;

    if (typeof event.data === 'string') {
      dataToParse = event.data;
    } else if (event.data instanceof Blob) {
      // Handle Blob data (common in web)
      try {
        this.log('server.receive.blob', `Received Blob, size: ${event.data.size}`);
        dataToParse = await event.data.text(); // Read Blob as text
      } catch (e) {
        this.log('error.receive', `Failed to read Blob data: ${e}`);
        this.emit('error', e as Error);
        return;
      }
    } else if (event.data instanceof ArrayBuffer) {
        // Handle ArrayBuffer (potentially from React Native WS)
        try {
            this.log('server.receive.arraybuffer', `Received ArrayBuffer, size: ${event.data.byteLength}`);
            // Assuming the server sends JSON as UTF-8 text in the buffer
            const decoder = new TextDecoder('utf-8');
            dataToParse = decoder.decode(event.data);
        } catch (e) {
            this.log('error.receive', `Failed to decode ArrayBuffer data: ${e}`);
            this.emit('error', e as Error);
            return;
        }
    } else {
      // Log unexpected types
      this.log('warn.receive', `Received unhandled message type: ${typeof event.data}`);
      console.warn("Received unexpected WebSocket data type:", event.data);
      return; // Don't proceed if the type is unknown
    }

    // --- Proceed with Parsing if dataToParse is valid ---
    if (dataToParse) {
        // console.log("RAW PARSABLE MESSAGE RECEIVED:", dataToParse); // Log raw (can be verbose)
        try {
            const response: LiveIncomingMessage = JSON.parse(dataToParse);
            // console.log("PARSED MESSAGE:", JSON.stringify(response, null, 1)); // Pretty print slightly
            this.processIncomingMessage(response);
        } catch (e) {
            this.log('error.receive', `Failed to parse JSON: ${e} - Data: ${dataToParse.substring(0, 100)}...`); // Log truncated data on error
            this.emit('error', e as Error);
        }
    }
  }
  // --- END UPDATED handleMessage ---

  private handleClose(event: CloseEvent) {
    if (this.closingInitiated && event.code === 1000 && event.reason === 'Client requested disconnect') {
      // console.log("WebSocket 'close' event received after explicit disconnect, ignoring duplicate emit.");
      return;
    }
    // Additional check: If closingInitiated is true, but code/reason differ, maybe log it but don't emit again.
    if (this.closingInitiated) {
         console.log(`WebSocket 'close' event (code: ${event.code}, reason: ${event.reason}) received while closing already initiated.`);
         return; // Avoid emitting again if closing was programmatically started
    }

    this.log('server.close', `WebSocket closed unexpectedly (Code: ${event.code}, Reason: ${event.reason || 'No reason'})`);
    this.ws = null;
    this.connectionAttempt = null;
    this.closingInitiated = true; // Mark as closed since the event occurred naturally
    this.emit('close', event);
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
    // this.closingInitiated = true; // Maybe set this?
    // this.ws = null; // Maybe nullify?
  }


  protected processIncomingMessage(response: LiveIncomingMessage) {
    this.log('server.receive', response); // Log the parsed object

    if (isServerContentMessage(response)) {
      const { serverContent } = response;
      // console.log("PROCESSING ServerContent:", JSON.stringify(serverContent, null, 1));

      // Emit the raw content message first
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
    // console.log("PROCESSING ModelTurn:", JSON.stringify(modelTurnContent, null, 1));
    let parts: Part[] = modelTurnContent.modelTurn.parts;

    const audioParts = parts.filter(
      (p) => p.inlineData?.mimeType.startsWith('audio/') // Check for any audio type
    );
    // Text parts handled by the 'content' event emitted earlier

    // console.log(`Found ${audioParts.length} audio parts in ModelTurn.`);

    // Emit audio parts
    audioParts.forEach((part) => {
      if (part.inlineData?.data) {
        try {
          const data = base64ToArrayBuffer(part.inlineData.data);
          // console.log(`DECODED audio part, ${data.byteLength} bytes, mime: ${part.inlineData.mimeType}. Emitting 'audio' event.`);
          this.emit('audio', data); // Emit the raw ArrayBuffer
          this.log(`server.audio`, `Decoded audio buffer (${data.byteLength} bytes, mime: ${part.inlineData.mimeType})`);
        } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            this.log('error.audio', `Failed to decode audio data: ${errorMsg}`);
            this.emit('error', e as Error);
        }
      }
    });
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
    // Filter out any potentially problematic parts (e.g., empty text) before sending
    const validParts = finalParts.filter(part => part.text || part.inlineData || part.functionCall || part.functionResponse || part.executableCode || part.codeExecutionResult);

    if (validParts.length === 0) {
        this.log('warn.send', 'Attempted to send Content with no valid parts.');
        return;
    }

    const content: Content = { role: 'user', parts: validParts };
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
      this.emit('error', new Error(`WebSocket not open (state: ${this.ws?.readyState}). Cannot send message.`)); // Emit specific error
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