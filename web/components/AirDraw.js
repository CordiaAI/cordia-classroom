import { useEffect, useRef } from 'react';
import { cssVar } from '../lib/cssVar';
import { AIR_CONFIG, createGestureTracker, strokeWidth } from '../lib/airDraw.mjs';

// MediaPipe files, pinned to the npm version in package.json (@mediapipe/tasks-vision).
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export function cameraErrorMessage(error) {
  const name = error?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera blocked. Allow it from the camera icon in the address bar, then turn on Hand again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'No camera found.';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'The camera is busy in another app. Close it and try again.';
  if (error?.message === 'unsupported') return 'This browser cannot use the camera here.';
  return "Hand tracking couldn't start. Check your connection and try again.";
}

async function createLandmarker() {
  const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  const options = delegate => ({ baseOptions: { modelAssetPath: MODEL_URL, delegate }, runningMode: 'VIDEO', numHands: 1, minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6, minTrackingConfidence: 0.6 });
  let landmarker;
  try {
    landmarker = await HandLandmarker.createFromOptions(fileset, options('GPU'));
  } catch {
    landmarker = await HandLandmarker.createFromOptions(fileset, options('CPU'));
  }
  return { landmarker, connections: HandLandmarker.HAND_CONNECTIONS };
}

// Hand drawing on the Practice board. Owns the camera, the hand model, the per-frame loop and
// the cursor overlay; nothing here goes through React state, so the loop never re-renders the page.
// pen: ref to { color, size } (read every frame). stroke: { start(tool, point), move(point), end(), clear() }.
export default function AirDraw({ boardRef, pen, stroke, showPreview, onError, onStarted }) {
  const overlayRef = useRef(null);
  const videoRef = useRef(null);
  const previewRef = useRef(null);
  const previewOn = useRef(showPreview);
  const strokeRef = useRef(stroke);
  strokeRef.current = stroke;
  previewOn.current = showPreview;

  useEffect(() => {
    let stopped = false;
    let frame = 0;
    let stream = null;
    let landmarker = null;
    let connections = [];
    let lastVideoTime = -1;
    let size = { width: 0, height: 0 };
    let fps = { count: 0, since: performance.now(), value: 0 };
    const tracker = createGestureTracker(AIR_CONFIG);
    const overlay = overlayRef.current;
    const board = boardRef.current;
    const video = videoRef.current;
    const colors = { olive: cssVar('--olive', 'olive'), ring: cssVar('--muted', 'gray'), mark: cssVar('--olive-ink', 'olive') };
    const penColors = new Map();
    const penColor = token => { if (!penColors.has(token)) penColors.set(token, cssVar(token, colors.mark)); return penColors.get(token); };

    // Overlay canvas matches the board and the screen's pixel ratio, so the cursor stays sharp.
    const fit = () => {
      const rect = board.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      size = { width: rect.width, height: rect.height };
      overlay.width = Math.max(1, Math.round(rect.width * ratio));
      overlay.height = Math.max(1, Math.round(rect.height * ratio));
      overlay.style.width = rect.width + 'px';
      overlay.style.height = rect.height + 'px';
      overlay.getContext('2d').setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(board);

    function drawCursor(state) {
      const context = overlay.getContext('2d');
      context.clearRect(0, 0, size.width, size.height);
      if (!state.visible) return;
      const { color, size: brush } = pen.current;
      const erasing = state.mode === 'erase';
      const radius = erasing ? strokeWidth({ tool: 'eraser', size: brush }) / 2 : Math.max(4, brush / 2 + 2);
      context.beginPath();
      context.arc(state.x, state.y, radius, 0, Math.PI * 2);
      if (erasing) {
        context.lineWidth = 2; context.strokeStyle = colors.ring; context.stroke();
      } else {
        context.fillStyle = penColor(color);
        context.globalAlpha = state.mode === 'draw' ? 1 : 0.55;
        context.fill();
        context.globalAlpha = 1;
        context.lineWidth = 2; context.strokeStyle = colors.olive; context.stroke();
      }
      if (state.palmProgress > 0) {
        // Countdown ring: fills clockwise over the palm hold, then the board clears.
        context.lineWidth = 4;
        context.strokeStyle = colors.ring;
        context.globalAlpha = 0.35;
        context.beginPath(); context.arc(state.x, state.y, 26, 0, Math.PI * 2); context.stroke();
        context.globalAlpha = 1;
        context.strokeStyle = colors.olive;
        context.beginPath(); context.arc(state.x, state.y, 26, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * state.palmProgress); context.stroke();
      }
    }

    function drawPreview(landmarks) {
      const canvas = previewRef.current;
      if (!canvas || !previewOn.current) return;
      const context = canvas.getContext('2d');
      const { width, height } = canvas;
      context.clearRect(0, 0, width, height);
      if (!landmarks) return;
      // Mirrored, like the video above it.
      const at = lm => [(1 - lm.x) * width, lm.y * height];
      context.lineWidth = 2;
      context.strokeStyle = colors.olive;
      for (const { start, end } of connections) {
        const [ax, ay] = at(landmarks[start]);
        const [bx, by] = at(landmarks[end]);
        context.beginPath(); context.moveTo(ax, ay); context.lineTo(bx, by); context.stroke();
      }
      context.fillStyle = colors.mark;
      landmarks.forEach((lm, index) => {
        const [x, y] = at(lm);
        context.beginPath(); context.arc(x, y, index === 8 ? 4 : 2.5, 0, Math.PI * 2); context.fill();
      });
      context.font = '600 11px Manrope, sans-serif';
      context.fillText(`${fps.value} fps`, 6, height - 6);
    }

    function loop() {
      if (stopped) return;
      frame = requestAnimationFrame(loop);
      // Detect at most once per video frame.
      if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;
      const now = performance.now();
      const result = landmarker.detectForVideo(video, now);
      const landmarks = result?.landmarks?.[0] || null;
      const world = result?.worldLandmarks?.[0] || null;
      const aspect = (video.videoWidth || 640) / (video.videoHeight || 480);
      const state = tracker.update(landmarks, now, { width: size.width, height: size.height, aspect, world });
      for (const event of state.events) {
        if (event.type === 'start') strokeRef.current.start(event.tool, event.point);
        else if (event.type === 'move') strokeRef.current.move(event.point);
        else if (event.type === 'end') strokeRef.current.end();
        else if (event.type === 'clear') strokeRef.current.clear();
      }
      drawCursor(state);
      drawPreview(landmarks);
      fps.count += 1;
      if (now - fps.since >= 1000) { fps = { count: 0, since: now, value: Math.round((fps.count * 1000) / (now - fps.since)) }; }
    }

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
        if (stopped) return;
        video.srcObject = stream;
        await video.play();
        ({ landmarker, connections } = await createLandmarker());
        if (stopped) return;
        onStarted?.();
        loop();
      } catch (error) {
        if (!stopped) onError?.(cameraErrorMessage(error));
      }
    })();

    // Turning Hand off or leaving the page stops the loop, the model and the camera.
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      if (tracker.mode !== 'hover') strokeRef.current.end();
      stream?.getTracks().forEach(track => track.stop());
      if (video) video.srcObject = null;
      try { landmarker?.close(); } catch { /* already closed */ }
    };
  }, []);

  return (
    <>
      <canvas ref={overlayRef} className="air-overlay" aria-hidden="true" />
      <div className={'air-preview' + (showPreview ? '' : ' is-hidden')} aria-hidden={!showPreview}>
        <video ref={videoRef} playsInline muted />
        <canvas ref={previewRef} width={160} height={120} />
      </div>
      <style jsx>{`
        .air-overlay { position: absolute; inset: 0; z-index: 4; pointer-events: none; }
        .air-preview { position: absolute; right: 12px; bottom: 12px; z-index: 5; width: 160px; height: 120px; border: 1px solid var(--hairline); border-radius: var(--r-input); overflow: hidden; background: var(--surface-raised); box-shadow: var(--shadow-float); pointer-events: none; }
        .air-preview video, .air-preview canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
        .air-preview video { object-fit: cover; transform: scaleX(-1); }
        .air-preview canvas { pointer-events: none; }
        .air-preview.is-hidden { width: 1px; height: 1px; opacity: 0; border: 0; box-shadow: none; }
      `}</style>
    </>
  );
}
