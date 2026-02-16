"use client"

import { useEffect, useRef, useState, useCallback } from 'react';

type WebSocketMessage = {
  type: string;
  data?: any;
  timestamp?: string;
};

type MessageHandler = (msg: WebSocketMessage) => void;

class WebSocketManager {
  private static instance: WebSocketManager;
  private ws: WebSocket | null = null;
  private listeners: Set<MessageHandler> = new Set();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnecting = false;

  private constructor() {}

  static getInstance(): WebSocketManager {
    if (!WebSocketManager.instance) {
      WebSocketManager.instance = new WebSocketManager();
    }
    return WebSocketManager.instance;
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) return;
    
    this.isConnecting = true;
    console.log('Shared WebSocket connecting...');

    try {
      this.ws = new WebSocket('ws://localhost:3001/ws');

      this.ws.onopen = () => {
        console.log('Shared WebSocket connected');
        this.isConnecting = false;
        this.notifyListeners({ type: 'CONNECTION_STATUS', data: { connected: true } });
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.notifyListeners(msg);
        } catch (e) {
          console.error('WebSocket message parse error:', e);
        }
      };

      this.ws.onclose = () => {
        console.log('Shared WebSocket disconnected');
        this.isConnecting = false;
        this.notifyListeners({ type: 'CONNECTION_STATUS', data: { connected: false } });
        
        // Reconnect after 5 seconds
        this.reconnectTimer = setTimeout(() => this.connect(), 5000);
      };

      this.ws.onerror = (error) => {
        console.error('Shared WebSocket error:', error);
        this.ws?.close();
      };
    } catch (e) {
      this.isConnecting = false;
      console.error('Failed to create WebSocket:', e);
    }
  }

  subscribe(handler: MessageHandler): () => void {
    this.listeners.add(handler);
    this.connect(); // Auto-connect on first subscription
    
    return () => {
      this.listeners.delete(handler);
    };
  }

  private notifyListeners(msg: WebSocketMessage) {
    this.listeners.forEach(handler => {
      try {
        handler(msg);
      } catch (e) {
        console.error('WebSocket listener error:', e);
      }
    });
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export function useSharedWebSocket() {
  const [connected, setConnected] = useState(false);
  const managerRef = useRef(WebSocketManager.getInstance());

  useEffect(() => {
    const unsubscribe = managerRef.current.subscribe((msg) => {
      if (msg.type === 'CONNECTION_STATUS') {
        setConnected(msg.data?.connected || false);
      }
    });
    
    return unsubscribe;
  }, []);

  const subscribe = useCallback((handler: MessageHandler) => {
    return managerRef.current.subscribe(handler);
  }, []);

  return { connected, subscribe };
}