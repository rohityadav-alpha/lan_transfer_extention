/**
 * WebRTC Handler
 * Manages peer connections for both sender and receiver sides.
 * Features:
 *  - ICE candidate queueing (buffers until remote description is set)
 *  - Backpressure via bufferedAmountLowThreshold
 *  - Connection state monitoring with callbacks
 */

// DataChannel buffer thresholds for backpressure
const BUFFER_HIGH_WATERMARK = 1 * 1024 * 1024; // 1 MB — pause sending
const BUFFER_LOW_WATERMARK = 256 * 1024;        // 256 KB — resume sending

/**
 * Base class with shared WebRTC logic.
 */
class BasePeer {
  /**
   * @param {object} callbacks
   * @param {function} callbacks.onIceCandidate - Called with each ICE candidate to relay
   * @param {function} [callbacks.onConnected] - Called when connection is established
   * @param {function} [callbacks.onDisconnected] - Called on disconnect
   * @param {function} [callbacks.onError] - Called on error
   */
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.pc = new RTCPeerConnection({
      iceServers: [], // LAN only — no STUN/TURN needed
    });
    this.channel = null;
    this._remoteDescSet = false;
    this._iceCandidateQueue = [];

    // ICE candidate handling
    this.pc.onicecandidate = (e) => {
      if (e.candidate && this.callbacks.onIceCandidate) {
        this.callbacks.onIceCandidate(e.candidate);
      }
    };

    // Connection state monitoring
    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      if (state === 'connected' && this.callbacks.onConnected) {
        this.callbacks.onConnected();
      } else if (
        (state === 'disconnected' || state === 'closed') &&
        this.callbacks.onDisconnected
      ) {
        this.callbacks.onDisconnected(state);
      } else if (state === 'failed' && this.callbacks.onError) {
        this.callbacks.onError(new Error('WebRTC connection failed'));
      }
    };
  }

  /**
   * Add a remote ICE candidate. Queues if remote description isn't set yet.
   * @param {RTCIceCandidateInit} candidate
   */
  async addIceCandidate(candidate) {
    if (this._remoteDescSet) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn('Failed to add ICE candidate:', e);
      }
    } else {
      this._iceCandidateQueue.push(candidate);
    }
  }

  /**
   * Flush queued ICE candidates after remote description is set.
   */
  async _flushIceCandidates() {
    this._remoteDescSet = true;
    for (const candidate of this._iceCandidateQueue) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn('Failed to add queued ICE candidate:', e);
      }
    }
    this._iceCandidateQueue = [];
  }

  /**
   * Close the peer connection and data channel.
   */
  destroy() {
    if (this.channel) {
      try { this.channel.close(); } catch (_) {}
    }
    if (this.pc) {
      try { this.pc.close(); } catch (_) {}
    }
    this.channel = null;
  }
}

/**
 * Sender-side peer. Creates an offer and a DataChannel.
 */
export class SenderPeer extends BasePeer {
  /**
   * @param {object} callbacks - Same as BasePeer + onChannelOpen
   * @param {function} [callbacks.onChannelOpen] - Called when DataChannel is open and ready
   */
  constructor(callbacks = {}) {
    super(callbacks);
    this.channel = this.pc.createDataChannel('fileTransfer', {
      ordered: true,
    });
    this._setupChannel();
  }

  _setupChannel() {
    const ch = this.channel;
    ch.binaryType = 'arraybuffer';
    ch.bufferedAmountLowThreshold = BUFFER_LOW_WATERMARK;

    ch.onopen = () => {
      if (this.callbacks.onChannelOpen) this.callbacks.onChannelOpen(ch);
    };
    ch.onerror = (e) => {
      console.error('DataChannel error:', e);
      if (this.callbacks.onError) this.callbacks.onError(e);
    };
  }

  /**
   * Create an SDP offer.
   * @returns {Promise<RTCSessionDescriptionInit>}
   */
  async createOffer() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  /**
   * Set the remote SDP answer from the receiver.
   * @param {RTCSessionDescriptionInit} answer
   */
  async setAnswer(answer) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    await this._flushIceCandidates();
  }

  /**
   * Send an ArrayBuffer over the DataChannel with backpressure.
   * Waits if the buffer exceeds the high watermark.
   * @param {ArrayBuffer} data
   * @returns {Promise<void>}
   */
  sendWithBackpressure(data) {
    const ch = this.channel;
    if (ch.bufferedAmount >= BUFFER_HIGH_WATERMARK) {
      return new Promise((resolve) => {
        const onLow = () => {
          ch.removeEventListener('bufferedamountlow', onLow);
          ch.send(data);
          resolve();
        };
        ch.addEventListener('bufferedamountlow', onLow);
      });
    }
    ch.send(data);
    return Promise.resolve();
  }
}

/**
 * Receiver-side peer. Accepts an offer and creates an answer.
 */
export class ReceiverPeer extends BasePeer {
  /**
   * @param {object} callbacks - Same as BasePeer + onData, onChannelOpen
   * @param {function} [callbacks.onData] - Called with each received message (string or ArrayBuffer)
   * @param {function} [callbacks.onChannelOpen] - Called when DataChannel is open
   */
  constructor(callbacks = {}) {
    super(callbacks);

    this.pc.ondatachannel = (e) => {
      this.channel = e.channel;
      this.channel.binaryType = 'arraybuffer';

      this.channel.onopen = () => {
        if (this.callbacks.onChannelOpen) this.callbacks.onChannelOpen(this.channel);
      };

      this.channel.onmessage = (evt) => {
        if (this.callbacks.onData) this.callbacks.onData(evt.data);
      };

      this.channel.onerror = (err) => {
        console.error('DataChannel error:', err);
        if (this.callbacks.onError) this.callbacks.onError(err);
      };
    };
  }

  /**
   * Accept a remote SDP offer and create an answer.
   * @param {RTCSessionDescriptionInit} offer
   * @returns {Promise<RTCSessionDescriptionInit>}
   */
  async acceptOffer(offer) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    await this._flushIceCandidates();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer;
  }
}

export { BUFFER_HIGH_WATERMARK, BUFFER_LOW_WATERMARK };
