import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, QrCode, X } from 'lucide-react';
import { Button } from '../ui/index.ts';

interface RecruiterCameraScannerProps {
  busy: boolean;
  onDecodedToken: (token: string) => void;
  onCaptureFile: (file: File) => void;
  onClose: () => void;
}

interface BarcodeDetectorLike {
  detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>;
}

export function RecruiterCameraScanner({
  busy,
  onDecodedToken,
  onCaptureFile,
  onClose,
}: RecruiterCameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onDecodedRef = useRef(onDecodedToken);
  useEffect(() => {
    onDecodedRef.current = onDecodedToken;
  }, [onDecodedToken]);

  const [camErr, setCamErr] = useState('');
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [restartNonce, setRestartNonce] = useState(0);

  const stopTracks = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    if (paused) return;
    let active = true;
    let rafTimer: number | null = null;

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamErr('Camera capture is not available in this browser context. Use Upload QR PNG instead.');
        return;
      }
      setCamErr('');
      setReady(false);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (!active) {
          for (const t of stream.getTracks()) t.stop();
          return;
        }
        streamRef.current = stream;
        const vid = videoRef.current;
        if (vid) {
          vid.srcObject = stream;
          await vid.play();
          if (active) setReady(true);
        }

        // Optional native BarcodeDetector fast-path when supported by the browser
        const DetectorCtor = (
          window as unknown as {
            BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike;
          }
        ).BarcodeDetector;
        if (DetectorCtor && vid) {
          const detector = new DetectorCtor({ formats: ['qr_code'] });
          const scanTick = async () => {
            if (!active) return;
            if (!vid || vid.readyState < 2) {
              rafTimer = window.setTimeout(() => void scanTick(), 300);
              return;
            }
            try {
              const found = await detector.detect(vid);
              if (!active) return;
              const hit = found.find((b) => b.rawValue?.trim());
              if (hit?.rawValue) {
                stopTracks();
                onDecodedRef.current(hit.rawValue.trim());
                return;
              }
            } catch {
              // Fall back to manual Capture & Scan button
            }
            if (active) {
              rafTimer = window.setTimeout(() => void scanTick(), 450);
            }
          };
          rafTimer = window.setTimeout(() => void scanTick(), 450);
        }
      } catch (e: unknown) {
        if (active) {
          setCamErr(
            e instanceof Error
              ? `Camera unavailable: ${e.message}. Use Upload QR PNG or paste the share code.`
              : 'Camera permission denied. Use Upload QR PNG or paste the share code.',
          );
        }
      }
    };

    const handleVisibility = () => {
      if (document.hidden) {
        active = false;
        if (rafTimer !== null) window.clearTimeout(rafTimer);
        stopTracks();
        setReady(false);
        setPaused(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    void start();
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', handleVisibility);
      if (rafTimer !== null) window.clearTimeout(rafTimer);
      stopTracks();
    };
  }, [paused, restartNonce, stopTracks]);

  const handleCaptureFrame = () => {
    const vid = videoRef.current;
    if (!vid || vid.videoWidth === 0 || vid.videoHeight === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = vid.videoWidth;
    canvas.height = vid.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], 'camera-qr-capture.png', { type: 'image/png' });
      stopTracks();
      onCaptureFile(file);
    }, 'image/png');
  };

  return (
    <div className="space-y-3 border border-rule bg-subtle/60 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-ink">
          <Camera className="h-3.5 w-3.5 text-action" aria-hidden="true" />
          <span>Live Camera QR Scanner</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            stopTracks();
            onClose();
          }}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          Close
        </Button>
      </div>

      {camErr ? (
        <div className="space-y-2">
          <p role="alert" className="text-xs font-medium text-blocker wrap-anywhere">
            {camErr}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setPaused(false);
              setRestartNonce((n) => n + 1);
            }}
          >
            Retry Camera
          </Button>
        </div>
      ) : paused ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-secondary">
          <span>Camera paused while this tab was hidden.</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setPaused(false);
              setRestartNonce((n) => n + 1);
            }}
          >
            Resume Camera
          </Button>
        </div>
      ) : (
        <>
          <div className="relative overflow-hidden rounded border border-rule bg-rail aspect-square sm:aspect-video max-h-72 w-full">
            <video
              ref={videoRef}
              muted
              playsInline
              className="h-full w-full object-cover"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-ink-secondary">
              Hold a student’s QR pass steady in frame, then capture.
            </span>
            <Button
              variant="primary"
              size="sm"
              disabled={!ready || busy}
              onClick={handleCaptureFrame}
            >
              <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
              {busy ? 'Decoding…' : 'Capture & Scan'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
