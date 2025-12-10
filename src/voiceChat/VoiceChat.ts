import { Mesh, MeshBasicMaterial, CapsuleGeometry, Color, Scene, PerspectiveCamera } from "three";
import Peer from "simple-peer";
import {
  connectCellWS,
  joinWorld,
  VoiceCellConnection,
  VoicePeerManager,
  type Vector3,
} from "./client";

const voicePeerManager = new VoicePeerManager({
  connectRadius: 45, // align with server proximity radius to ensure peers connect
  disconnectRadiusMultiplier: 1.5,
});
const voiceDebug = (...args: unknown[]) => console.log("[voice]", ...args);
const AudioCtx =
  typeof AudioContext !== "undefined"
    ? AudioContext
    : (typeof window !== "undefined" &&
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext) ||
      undefined;
const audioCtx = typeof AudioCtx !== "undefined" ? new AudioCtx() : null;
const voiceBaseUrl =
  (import.meta as { env?: { VITE_VOICE_WORKER_URL?: string } }).env?.VITE_VOICE_WORKER_URL ||
  (typeof window !== "undefined" && window.location.port === "5173"
    ? window.location.origin.replace("5173", "8787")
    : "https://flareslop.dysinski-tomasz.workers.dev");

export default class VoiceChat {
  constructor(
    private scene: Scene,
    private camera: PerspectiveCamera
  ) {
    this.init();
  }
  peers = new Map<string, Peer.Instance>();
  peerAudioNodes = new Map<
    string,
    { source: MediaStreamAudioSourceNode; panner: PannerNode; gain: GainNode }
  >();
  peerCapsules = new Map<string, Mesh>();
  peerPositions = new Map<string, Vector3>();
  peerCapsuleGeometry = new CapsuleGeometry(0.25, 1, 4, 6);
  baseCapsuleMaterial = new MeshBasicMaterial({ color: new Color("#4af7ff") });
  localStream: MediaStream | null = null;
  iceServers: RTCIceServer[] = [];
  connection: VoiceCellConnection | null = null;
  micReady = false;
  selfId: string | null = null;
  voiceUi = document.createElement("div");
  totalPlayers: number | null = null;

  updatePannerPosition(peerId: string) {
    const nodes = this.peerAudioNodes.get(peerId);
    if (!nodes) return;

    const peerPos = voicePeerManager.getPeerPosition(peerId);
    if (!peerPos) {
      return;
    }
    const relPos = this.camera.position.clone().sub(peerPos);

    const distance = relPos.length();
    const clamped = Math.min(Math.max(distance, 1), 80);
    const angle = Math.atan2(relPos.z, relPos.x) - this.camera.rotation.y;
    const x = Math.cos(angle) * clamped;
    const z = Math.sin(angle) * clamped;
    const y = 0;

    nodes.panner.positionX.value = x;
    nodes.panner.positionY.value = y;
    nodes.panner.positionZ.value = z;
  }

  async init() {
    const renderUi = () => {
      const status = this.micReady ? "Voice: mic ready" : "Voice: tap to enable mic";
      const count =
        typeof this.totalPlayers === "number"
          ? ` • players: ${Math.max(this.totalPlayers, 1)}`
          : "";
      this.voiceUi.textContent = `${status}${count}`;
    };

    const setupUi = (requestMic: () => void) => {
      this.voiceUi.style.position = "fixed";
      this.voiceUi.style.left = "12px";
      this.voiceUi.style.bottom = "12px";
      this.voiceUi.style.padding = "8px 10px";
      this.voiceUi.style.background = "rgba(0,0,0,0.5)";
      this.voiceUi.style.color = "#fff";
      this.voiceUi.style.fontSize = "12px";
      this.voiceUi.style.borderRadius = "6px";
      this.voiceUi.style.cursor = "pointer";
      this.voiceUi.addEventListener("click", requestMic);
      document.body.appendChild(this.voiceUi);
    };

    const ensureLocalStream = async (): Promise<MediaStream | null> => {
      if (this.localStream) return this.localStream;
      if (!navigator.mediaDevices?.getUserMedia) {
        console.warn("Voice chat: getUserMedia not available");
        return null;
      }

      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            noiseSuppression: false,
            echoCancellation: false,
            autoGainControl: true,
          },
          video: false,
        });
        voiceDebug("mic stream acquired", this.localStream.id);
        return this.localStream;
      } catch (error) {
        console.warn("Voice chat: mic capture failed", error);
        return null;
      }
    };

    const stableAngleForPeer = (peerId: string): number => {
      let hash = 0;
      for (let i = 0; i < peerId.length; i += 1) {
        hash = (hash * 31 + peerId.charCodeAt(i)) >>> 0;
      }
      return (hash / 0xffffffff) * Math.PI * 2;
    };

    const ensurePeerCapsule = (peerId: string): Mesh => {
      let mesh = this.peerCapsules.get(peerId);
      if (mesh) {
        return mesh;
      }
      const angle = stableAngleForPeer(peerId);
      const color = new Color().setHSL((angle / (Math.PI * 2)) * 0.9, 0.6, 0.55);
      const material = this.baseCapsuleMaterial.clone();
      material.color = color;

      mesh = new Mesh(this.peerCapsuleGeometry, material);
      mesh.name = `peer-${peerId}`;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.peerCapsules.set(peerId, mesh);
      return mesh;
    };

    const removePeerCapsule = (peerId: string) => {
      const mesh = this.peerCapsules.get(peerId);
      if (!mesh) return;
      this.scene.remove(mesh);
      if (mesh.material) {
        const material = mesh.material as MeshBasicMaterial;
        material.dispose();
      }
      this.peerCapsules.delete(peerId);
      this.peerPositions.delete(peerId);
    };

    const updatePeerCapsulePosition = (peerId: string, position: Vector3) => {
      const mesh = ensurePeerCapsule(peerId);
      mesh.position.set(position.x, position.y, position.z);
      mesh.updateMatrixWorld();
      this.peerPositions.set(peerId, position);
    };

    const isVector3 = (value: unknown): value is Vector3 => {
      return (
        value != null &&
        typeof value === "object" &&
        typeof (value as Vector3).x === "number" &&
        typeof (value as Vector3).y === "number" &&
        typeof (value as Vector3).z === "number"
      );
    };

    const handleIncomingPeerPosition = (peerId: string, payload: unknown) => {
      if (
        !payload ||
        typeof payload !== "object" ||
        (payload as { type?: unknown }).type !== "position" ||
        !isVector3((payload as { position?: unknown }).position)
      ) {
        return;
      }

      const position = (payload as { position: Vector3 }).position;
      voicePeerManager.updatePeerPosition(peerId, position);
      updatePeerCapsulePosition(peerId, position);

      if (this.peerAudioNodes.has(peerId)) {
        this.updatePannerPosition(peerId);
      }
    };

    const broadcastPositionToPeers = (position: Vector3) => {
      const payload = JSON.stringify({ type: "position", position });
      for (const [peerId, peer] of this.peers.entries()) {
        if ((peer as unknown as { connected?: boolean }).connected) {
          try {
            peer.send(payload);
          } catch (error) {
            voiceDebug("data send failed", peerId, error);
          }
        }
      }
    };

    const attachRemoteAudio = (peerId: string, stream: MediaStream) => {
      if (!audioCtx) {
        return;
      }

      const existing = this.peerAudioNodes.get(peerId);
      if (existing) {
        existing.source.disconnect();
      }

      const source = audioCtx.createMediaStreamSource(stream);
      const gain = audioCtx.createGain();
      const panner = audioCtx.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "exponential";
      panner.refDistance = 1;
      panner.maxDistance = 80;
      panner.rolloffFactor = 1;
      source.connect(gain).connect(panner).connect(audioCtx.destination);
      this.peerAudioNodes.set(peerId, { source, gain, panner });
      this.updatePannerPosition(peerId);
      voiceDebug("remote track attached", peerId);
    };

    const cleanupPeer = (peerId: string) => {
      const peer = this.peers.get(peerId);
      if (peer) {
        try {
          peer.removeAllListeners();
          peer.destroy();
        } catch {
          // ignore
        }
      }
      this.peers.delete(peerId);

      const nodes = this.peerAudioNodes.get(peerId);
      if (nodes) {
        nodes.source.disconnect();
        nodes.gain.disconnect();
        nodes.panner.disconnect();
        this.peerAudioNodes.delete(peerId);
      }
      removePeerCapsule(peerId);
    };

    const createPeer = async (peerId: string, initiator: boolean): Promise<Peer.Instance> => {
      if (this.peers.has(peerId)) {
        return this.peers.get(peerId)!;
      }

      const stream = await ensureLocalStream();
      const peer = new Peer({
        initiator,
        trickle: true,
        config: {
          iceServers: this.iceServers,
          bundlePolicy: "max-bundle",
          iceTransportPolicy: "all",
        },
      });

      this.peers.set(peerId, peer);
      voiceDebug(
        "simple-peer created",
        peerId,
        "initiator",
        initiator,
        "iceServers",
        (this.iceServers || []).map((s) => s.urls)
      );

      peer.on("signal", (data: Peer.SignalData) => {
        this.connection?.sendSignal(peerId, data);
      });

      peer.on("connect", () => {
        voiceDebug("peer connect", peerId);
      });

      peer.on("data", (data) => {
        const text = typeof data === "string" ? data : new TextDecoder().decode(data);
        if (!text) return;
        try {
          const parsed = JSON.parse(text) as unknown;
          handleIncomingPeerPosition(peerId, parsed);
        } catch {
          // ignore malformed payloads
        }
      });

      peer.on("track", (_track, stream) => {
        attachRemoteAudio(peerId, stream);
      });

      peer.on("close", () => {
        cleanupPeer(peerId);
      });

      peer.on("error", (err) => {
        console.warn("Voice chat: peer error", peerId, err);
      });

      if (stream) {
        for (const track of stream.getAudioTracks()) {
          peer.addTrack(track, stream);
          voiceDebug("addTrack to peer", peerId, track.id);
        }
      }

      return peer;
    };

    const attachLocalToExistingPeers = async () => {
      const stream = await ensureLocalStream();
      if (!stream) return;

      const tracks = stream.getAudioTracks();
      for (const [peerId, peer] of this.peers.entries()) {
        for (const track of tracks) {
          try {
            peer.addTrack(track, stream);
            voiceDebug("backfill track to existing peer", peerId, track.id);
          } catch (error) {
            console.warn("Voice chat: failed to add track to existing peer", error);
          }
        }
      }
    };

    const isInitiatorFor = (selfId: string, peerId: string) => selfId < peerId;

    const getPosition = () => {
      const { x, y, z } = this.camera.position;
      return { x, y, z };
    };

    const getPlayerId = () => {
      try {
        const sessionKey = "voicePlayerIdSession";
        const baseKey = "voicePlayerIdBase";

        const sessionCached = sessionStorage.getItem(sessionKey);
        if (sessionCached) return sessionCached;

        let base = localStorage.getItem(baseKey);
        if (!base) {
          base = `player-${crypto.randomUUID().slice(0, 6)}`;
          localStorage.setItem(baseKey, base);
        }

        const sessionId = `${base}-${crypto.randomUUID().slice(0, 4)}`;
        sessionStorage.setItem(sessionKey, sessionId);
        return sessionId;
      } catch {
        return `player-${Math.random().toString(16).slice(2, 10)}`;
      }
    };

    try {
      setupUi(async () => {
        const stream = await ensureLocalStream();
        this.micReady = !!stream;
        renderUi();
        await audioCtx?.resume().catch(() => {});
        await attachLocalToExistingPeers();
        // Resume audio graph if needed
        for (const peerId of this.peerAudioNodes.keys()) {
          this.updatePannerPosition(peerId);
        }
      });
      renderUi();

      const playerId = getPlayerId();
      this.selfId = playerId;
      const startPosition = getPosition();

      const joinResult = await joinWorld({
        baseUrl: voiceBaseUrl,
        playerId,
        position: startPosition,
      });
      voiceDebug(
        "joined cell",
        joinResult.cellId,
        "transport",
        joinResult.transportMode,
        "ws",
        joinResult.cellWebSocketUrl
      );
      this.iceServers = joinResult.iceServers;

      this.connection = await connectCellWS({
        url: joinResult.cellWebSocketUrl,
        playerId,
        sessionToken: joinResult.sessionToken,
      });
      voiceDebug("ws connected", joinResult.cellWebSocketUrl);

      this.connection.attachPeerManager(voicePeerManager);
      this.connection.startHeartbeat();
      this.connection.startPositionUpdates(getPosition, {
        intervalMs: 50,
        peerManager: voicePeerManager,
        onSend: broadcastPositionToPeers,
      });
      this.connection.onPeersChange((message) => {
        voiceDebug(
          "peers message",
          "peers",
          message.peers,
          "added",
          message.added,
          "removed",
          message.removed,
          "distances",
          message.distances,
          "positions",
          message.positions
        );
        if (message.distances) {
          for (const [peerId] of Object.entries(message.distances)) {
            this.updatePannerPosition(peerId);
          }
        }
        if (message.positions) {
          for (const [peerId, pos] of Object.entries(message.positions)) {
            voicePeerManager.updatePeerPosition(peerId, pos);
            updatePeerCapsulePosition(peerId, pos);
          }
        }
        if (message.removed) {
          for (const peerId of message.removed) {
            voicePeerManager.updatePeerPosition(peerId, null);
            removePeerCapsule(peerId);
          }
        }
        if (typeof message.totalPlayers === "number") {
          this.totalPlayers = message.totalPlayers;
          renderUi();
        }
      });
      this.connection.onSignal(async (message) => {
        const { from, payload } = message;
        voiceDebug("signal recv", from);
        if (!payload) return;
        const peer = await createPeer(from, false);
        try {
          peer.signal(payload as Peer.SignalData);
        } catch (error) {
          console.warn("Voice chat: failed to handle signal", error);
        }
      });
      this.connection.onSignalDeliveryFailed((targetId) => {
        voiceDebug("signal delivery failed", targetId);
      });
      this.connection.onError((msg) => {
        voiceDebug("cell error", msg);
      });

      voicePeerManager.onConnect(async (peerId) => {
        voiceDebug(
          "voicePeerManager onConnect",
          peerId,
          "distance",
          voicePeerManager.getPeerDistance(peerId)
        );
        const existingPos = this.peerPositions.get(peerId);
        if (existingPos) {
          updatePeerCapsulePosition(peerId, existingPos);
        } else {
          ensurePeerCapsule(peerId);
        }
        const initiator = isInitiatorFor(playerId, peerId);
        await createPeer(peerId, initiator);
      });

      voicePeerManager.onDisconnect((peerId) => {
        cleanupPeer(peerId);
        voiceDebug("peer disconnect event", peerId);
      });

      // Trigger mic permission upfront so peers can connect without delay
      const stream = await ensureLocalStream();
      this.micReady = !!stream;
      renderUi();
      await attachLocalToExistingPeers();
      await audioCtx?.resume().catch(() => {});
      for (const peerId of this.peerAudioNodes.keys()) {
        this.updatePannerPosition(peerId);
      }
    } catch (error) {
      console.warn("Voice chat initialization failed", error);
      this.voiceUi.textContent = "Voice: failed to init";
    }
  }

  update() {
    for (const peerId of this.peerAudioNodes.keys()) {
      this.updatePannerPosition(peerId);
    }
  }
}
