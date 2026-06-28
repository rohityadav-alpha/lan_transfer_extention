/**
 * WebSocket Signaling Client
 * Connects to the signaling server for SDP/ICE exchange.
 * Features:
 *  - Auto-reconnect with exponential backoff (3 retries)
 *  - Message routing by type
 *  - Promise-based API for request/response patterns
 *  - Connection state events
 */

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY = 1000; // 1 second

/**
 * @typedef {'connecting' | 'connected' | 'disconnected' | 'error'} ConnectionState
 */

export class SignalingClient {
  /**
   * @param {string} serverUrl - WebSocket URL, e.g. "ws://192.168.1.5:3000"
   */
  constructor(serverUrl) {
    this.serverUrl = serverUrl;
    /** @type {WebSocket|null} */
    this.ws = null;
    /** @type {ConnectionState} */
    this.state = 'disconnected';
    this._retryCount = 0;
    this._handlers = {};       // type -> [callback, ...]
    this._stateListeners = []; // (state) => void
    this._intentionallyClosed = false;
  }

  /**
   * Register a handler for a specific message type.
   * @param {string} type - Message type (e.g. 'offer', 'answer', 'ice', 'error')
   * @param {function} handler - Called with the full message object
   * @returns {function} Unsubscribe function
   */
  on(type, handler) {
    if (!this._handlers[type]) this._handlers[type] = [];
    this._handlers[type].push(handler);
    return () => {
      this._handlers[type] = this._handlers[type].filter((h) => h !== handler);
    };
  }

  /**
   * Register a listener for connection state changes.
   * @param {function} listener - Called with the new state
   * @returns {function} Unsubscribe function
   */
  onStateChange(listener) {
    this._stateListeners.push(listener);
    return () => {
      this._stateListeners = this._stateListeners.filter((l) => l !== listener);
    };
  }

  /**
   * Connect to the signaling server.
   * @returns {Promise<void>} Resolves when connected.
   */
  connect() {
    return new Promise((resolve, reject) => {
      this._intentionallyClosed = false;
      this._setState('connecting');

      try {
        this.ws = new WebSocket(this.serverUrl);
      } catch (e) {
        this._setState('error');
        reject(new Error(`Invalid WebSocket URL: ${this.serverUrl}`));
        return;
      }

      this.ws.onopen = () => {
        this._retryCount = 0;
        this._setState('connected');
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this._dispatch(msg);
        } catch (e) {
          console.warn('Signaling: invalid message', event.data);
        }
      };

      this.ws.onerror = (e) => {
        console.error('Signaling WebSocket error:', e);
      };

      this.ws.onclose = (e) => {
        this._setState('disconnected');
        if (!this._intentionallyClosed && this._retryCount < MAX_RETRIES) {
          const delay = BASE_RETRY_DELAY * Math.pow(2, this._retryCount);
          this._retryCount++;
          console.log(`Signaling: reconnecting in ${delay}ms (attempt ${this._retryCount}/${MAX_RETRIES})`);
          setTimeout(() => {
            this.connect().catch(() => {});
          }, delay);
        } else if (!this._intentionallyClosed) {
          this._setState('error');
          reject(new Error('Signaling server unreachable after retries'));
        }
      };
    });
  }

  /**
   * Send a message to the signaling server.
   * @param {object} message - Must have a `type` field
   */
  send(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Signaling: not connected');
    }
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Disconnect from the signaling server.
   */
  disconnect() {
    this._intentionallyClosed = true;
    if (this.ws) {
      this.ws.close(1000, 'Client disconnecting');
      this.ws = null;
    }
    this._setState('disconnected');
  }

  // ─── Internal ──────────────────────────────────────────

  _setState(newState) {
    if (this.state === newState) return;
    this.state = newState;
    for (const listener of this._stateListeners) {
      try { listener(newState); } catch (e) { console.error(e); }
    }
  }

  _dispatch(msg) {
    const type = msg.type;
    if (type && this._handlers[type]) {
      for (const handler of this._handlers[type]) {
        try { handler(msg); } catch (e) { console.error('Handler error:', e); }
      }
    }
    // Also dispatch to wildcard '*' handlers
    if (this._handlers['*']) {
      for (const handler of this._handlers['*']) {
        try { handler(msg); } catch (e) { console.error('Wildcard handler error:', e); }
      }
    }
  }
}
