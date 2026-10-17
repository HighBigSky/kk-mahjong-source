// @ts-check

const SPEAKING_THRESHOLD = 0.022;
const SPEAKING_HOLD_MS = 320;
const SPEAKING_INTERVAL_MS = 120;
const RETRY_DELAY_MS = 1500;
const AUDIO_CONSTRAINTS = Object.freeze({ echoCancellation:true, noiseSuppression:true, autoGainControl:true });

/** @typedef {{seat:number, occupied:boolean, bot:boolean, voice:boolean}} VoiceSeatView */
/** @typedef {{seat:number, seats:VoiceSeatView[]}} VoiceRoomView */
/** @typedef {{from:number, description?:{type:'offer'|'answer', sdp:string}, candidate?:RTCIceCandidateInit}} VoiceSignal */
/** @typedef {{active:boolean, muted:boolean, starting:boolean, error:string, peers:number, connectedPeers:number}} VoiceState */

/**
 * 四家好友房的 P2P 语音。
 * 服务器只转发 SDP/ICE；媒体通过 WebRTC 直连，严格 NAT 时由 TURN 中继。
 * @param {{
 *   getIceServers?: () => Promise<{iceServers?:RTCIceServer[]}|RTCIceServer[]>,
 *   sendSignal?: (payload:object) => Promise<unknown>,
 *   onState?: (state:VoiceState) => void,
 *   onSpeaking?: (seat:number, speaking:boolean) => void,
 * }} [options]
 */
export function createVoiceChat({ getIceServers, sendSignal, onState = () => {}, onSpeaking = () => {} } = {}) {
  /** @type {VoiceRoomView|null} */
  let room = null;
  /** @type {number|null} */
  let localSeat = null;
  let active = false;
  let starting = false;
  let muted = false;
  let error = '';
  let generation = 0;
  /** @type {MediaStream|null} */
  let localStream = null;
  /** @type {AudioContext|null} */
  let audioContext = null;
  /** @type {RTCIceServer[]} */
  let iceServers = [];
  /**
   * @type {Map<number, {
   *   pc:RTCPeerConnection, remoteSeat:number, initiator:boolean, closed:boolean,
   *   audio:HTMLAudioElement|null, pending:RTCIceCandidateInit[]
   * }>}
   */
  const peers = new Map();
  /**
   * @type {Map<number, {source:MediaStreamAudioSourceNode, analyser:AnalyserNode, timer:ReturnType<typeof setInterval>}>}
   */
  const monitors = new Map();
  /** @type {Map<number, ReturnType<typeof setTimeout>>} */
  const retryTimers = new Map();

  /** @returns {VoiceState} */
  function state() {
    let connectedPeers = 0;
    for (const entry of peers.values()) if (entry.pc.connectionState === 'connected') connectedPeers++;
    return {active, muted, starting, error, peers:peers.size, connectedPeers};
  }
  function emit() { onState(state()); }

  /** @param {number} remoteSeat @returns {number} */
  function relativeTo(remoteSeat) {
    if (localSeat === null) return 0;
    return (remoteSeat - localSeat + 4) % 4;
  }

  /** @param {number} seat @returns {boolean} */
  function isDesired(seat) {
    if (!room || localSeat === null) return false;
    const relative = (seat - localSeat + 4) % 4;
    const view = room.seats[relative];
    return Boolean(view?.occupied && !view.bot && view.voice);
  }

  /** @param {unknown} cause @returns {string} */
  function friendlyError(cause) {
    const name = /** @type {{name?:string}} */ (cause)?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') return '麦克风权限被拒绝，请在浏览器设置中允许后重试。';
    if (name === 'NotFoundError') return '未找到可用的麦克风设备。';
    if (name === 'NotReadableError') return '麦克风被其他应用占用，请关闭后重试。';
    const message = cause instanceof Error ? cause.message : '';
    return message || '无法开启语音，请检查麦克风和网络后重试。';
  }

  function ensureAudioContext() {
    if (audioContext) return;
    const Context = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
    if (!Context) return;
    try { audioContext = new Context(); } catch { audioContext = null; }
  }

  /** @param {MediaStream} stream */
  function stopStream(stream) {
    for (const track of stream.getTracks()) track.stop();
  }

  /**
   * 监听麦克风或远端音频的 RMS，用短时保持避免说话高亮闪烁。
   * @param {number} seat
   * @param {MediaStream} stream
   */
  function monitor(seat, stream) {
    stopMonitor(seat);
    if (!audioContext) return;
    let source;
    try { source = audioContext.createMediaStreamSource(stream); } catch { return; }
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.55;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let speaking = false;
    let holdUntil = 0;
    const timer = setInterval(() => {
      if (!active) return;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const value of data) {
        const normalized = value / 128 - 1;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / data.length);
      const now = performance.now();
      if (seat === localSeat && muted) {
        // 静音时即使采集到环境声也不显示说话高亮。
      } else if (rms >= SPEAKING_THRESHOLD) {
        holdUntil = now + SPEAKING_HOLD_MS;
      }
      const next = now < holdUntil;
      if (next !== speaking) {
        speaking = next;
        onSpeaking(seat, next);
      }
    }, SPEAKING_INTERVAL_MS);
    monitors.set(seat, {source, analyser, timer});
  }

  /** @param {number} seat */
  function stopMonitor(seat) {
    const entry = monitors.get(seat);
    if (!entry) return;
    clearInterval(entry.timer);
    try { entry.source.disconnect(); } catch { /* Already disconnected. */ }
    monitors.delete(seat);
    onSpeaking(seat, false);
  }

  /**
   * @param {{audio:HTMLAudioElement|null}} entry
   * @param {MediaStream} stream
   */
  function attachAudio(entry, stream) {
    if (!entry.audio) {
      const audio = document.createElement('audio');
      audio.autoplay = true;
      audio.setAttribute('playsinline', '');
      audio.hidden = true;
      document.body.append(audio);
      entry.audio = audio;
    }
    if (entry.audio.srcObject !== stream) entry.audio.srcObject = stream;
    const playing = entry.audio.play?.();
    playing?.catch(() => { /* The start button gesture normally permits playback. */ });
  }

  /** @param {number} seat */
  function closePeer(seat) {
    const entry = peers.get(seat);
    if (!entry) return;
    entry.closed = true;
    peers.delete(seat);
    stopMonitor(seat);
    try { entry.pc.close(); } catch { /* Already closed. */ }
    if (entry.audio) {
      entry.audio.srcObject = null;
      entry.audio.remove();
    }
  }

  function closeAllPeers() {
    for (const seat of [...peers.keys()]) closePeer(seat);
    for (const timer of retryTimers.values()) clearTimeout(timer);
    retryTimers.clear();
  }

  /** @param {number} seat */
  function retry(seat) {
    if (!active || !isDesired(seat) || retryTimers.has(seat)) return;
    closePeer(seat);
    const timer = setTimeout(() => {
      retryTimers.delete(seat);
      if (!active || !isDesired(seat)) return;
      // 只有座位号较小的一方主动发 offer；另一方重新建连接后等待新的 offer。
      ensurePeer(seat);
    }, RETRY_DELAY_MS);
    retryTimers.set(seat, timer);
  }

  /** @param {number} remoteSeat */
  function ensurePeer(remoteSeat) {
    if (!active || !localStream || localSeat === null) return null;
    const existing = peers.get(remoteSeat);
    if (existing && !existing.closed) return existing;
    const pc = new RTCPeerConnection({iceServers});
    const entry = {pc, remoteSeat, initiator:false, closed:false, audio:null, pending:[]};
    peers.set(remoteSeat, entry);
    for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
    pc.onicecandidate = event => {
      if (!event.candidate || entry.closed || !active) return;
      Promise.resolve(sendSignal?.({to:relativeTo(remoteSeat), candidate:event.candidate.toJSON()})).catch(() => {});
    };
    pc.ontrack = event => {
      if (entry.closed) return;
      const stream = event.streams[0] || new MediaStream([event.track]);
      attachAudio(entry, stream);
      monitor(remoteSeat, stream);
    };
    pc.onconnectionstatechange = () => {
      if (!entry.closed && ['failed', 'closed'].includes(pc.connectionState)) retry(remoteSeat);
      else emit();
    };
    pc.oniceconnectionstatechange = () => {
      if (!entry.closed && pc.iceConnectionState === 'failed') retry(remoteSeat);
    };
    if (localSeat < remoteSeat) {
      entry.initiator = true;
      void createOffer(entry);
    }
    return entry;
  }

  /** @param {{pc:RTCPeerConnection, remoteSeat:number, closed:boolean}} entry */
  async function createOffer(entry) {
    if (entry.closed || entry.pc.signalingState !== 'stable') return;
    try {
      const offer = await entry.pc.createOffer();
      if (entry.closed) return;
      await entry.pc.setLocalDescription(offer);
      if (entry.closed) return;
      await sendSignal?.({to:relativeTo(entry.remoteSeat), description:entry.pc.localDescription});
    } catch { retry(entry.remoteSeat); }
  }

  /**
   * 把已收到的 ICE 候选补交给 PeerConnection；收到 answer/offer 前先缓存。
   * @param {{pc:RTCPeerConnection, pending:RTCIceCandidateInit[]}} entry
   */
  async function flushCandidates(entry) {
    const queued = entry.pending.splice(0);
    for (const candidate of queued) {
      try { await entry.pc.addIceCandidate(candidate); } catch { /* Stale candidate can be ignored. */ }
    }
  }

  /** @param {VoiceSignal} payload */
  function handleSignal(payload) {
    if (!active || !room || !payload || !Number.isInteger(payload.from) || payload.from < 1 || payload.from > 3) return 0;
    const remoteSeat = ((localSeat ?? room.seat) + payload.from) % 4;
    let entry = ensurePeer(remoteSeat);
    if (!entry) return 0;
    void (async () => {
      try {
        if (payload.description) {
          if (payload.description.type === 'offer') {
            // 对方重新开启语音时会发新 offer；旧连接直接重建，避免 SDP 版本冲突。
            if (entry.closed) return;
            if (entry.pc.signalingState !== 'stable') {
              closePeer(remoteSeat);
              entry = ensurePeer(remoteSeat);
              if (!entry) return;
            }
            await entry.pc.setRemoteDescription(payload.description);
            await flushCandidates(entry);
            const answer = await entry.pc.createAnswer();
            if (entry.closed) return;
            await entry.pc.setLocalDescription(answer);
            if (entry.closed) return;
            await sendSignal?.({to:payload.from, description:entry.pc.localDescription});
          } else if (payload.description.type === 'answer' && entry.pc.signalingState === 'have-local-offer') {
            await entry.pc.setRemoteDescription(payload.description);
            await flushCandidates(entry);
          }
        } else if (payload.candidate) {
          if (entry.pc.remoteDescription) await entry.pc.addIceCandidate(payload.candidate);
          else entry.pending.push(payload.candidate);
        }
      } catch {
        // 一次协商失败不终止整个语音，稍后由座位号较小的一方重新发起。
        retry(remoteSeat);
      }
    })();
    return 1;
  }

  /** @param {VoiceRoomView|null} next */
  function sync(next) {
    if (next !== undefined) {
      room = next;
      localSeat = next && Number.isInteger(next.seat) ? next.seat : null;
    }
    if (!active) return;
    if (!room || localSeat === null) {
      closeAllPeers();
      return;
    }
    const desired = new Set();
    for (let relative = 1; relative < 4; relative++) {
      const seat = room.seats[relative];
      if (seat?.occupied && !seat.bot && seat.voice) desired.add((localSeat + relative) % 4);
    }
    for (const seat of [...peers.keys()]) if (!desired.has(seat)) closePeer(seat);
    for (const seat of desired) ensurePeer(seat);
  }

  /** @param {VoiceRoomView|null} [roomSnapshot] */
  async function start(roomSnapshot) {
    if (active || starting) return;
    if (roomSnapshot) sync(roomSnapshot);
    error = '';
    starting = true;
    emit();
    const run = ++generation;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前页面无法使用麦克风，请通过 HTTPS 或 localhost 访问。');
      const stream = await navigator.mediaDevices.getUserMedia({audio:AUDIO_CONSTRAINTS});
      if (run !== generation) { stopStream(stream); return; }
      let servers = [];
      try {
        const config = await getIceServers?.();
        servers = Array.isArray(config) ? config : config?.iceServers || [];
      } catch { /* STUN/TURN 配置读取失败时仍尝试局域网直连。 */ }
      if (run !== generation) { stopStream(stream); return; }
      localStream = stream;
      iceServers = Array.isArray(servers) ? servers : [];
      active = true;
      starting = false;
      ensureAudioContext();
      try { await audioContext?.resume(); } catch { /* AudioContext may already be running. */ }
      if (run !== generation) { stop(); return; }
      if (localSeat !== null) monitor(localSeat, localStream);
      emit();
      sync(room);
    } catch (cause) {
      if (run === generation) {
        active = false;
        starting = false;
        muted = false;
        error = friendlyError(cause);
        if (localStream) { stopStream(localStream); localStream = null; }
        closeAllPeers();
        emit();
      }
      throw new Error(error || friendlyError(cause));
    }
  }

  function stop() {
    generation++;
    active = false;
    starting = false;
    muted = false;
    error = '';
    closeAllPeers();
    for (const seat of [...monitors.keys()]) stopMonitor(seat);
    if (localStream) { stopStream(localStream); localStream = null; }
    if (audioContext) {
      void audioContext.close().catch(() => {});
      audioContext = null;
    }
    emit();
  }

  /** @param {boolean} value */
  function setMuted(value) {
    muted = Boolean(value);
    if (localStream) for (const track of localStream.getAudioTracks()) track.enabled = !muted;
    if (muted && localSeat !== null) onSpeaking(localSeat, false);
    emit();
  }

  /** @param {RoomSnapshot|null|undefined} next */
  function resetRoom(next) {
    sync(next ?? null);
    if (!next && active) stop();
  }

  return {
    start,
    stop,
    sync,
    resetRoom,
    handleSignal,
    setMuted,
    toggleMuted: () => setMuted(!muted),
    isActive: () => active,
    isMuted: () => muted,
    getState: state,
  };
}
