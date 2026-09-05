"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CAPTURE_QUALITY,
  captureSize,
  describeCameraError,
  nextCameraId,
} from "../../lib/identification/camera.ts";

type Props = { onCapture: (file: File) => void; onCancel: () => void; label?: string };

/**
 * A live viewfinder with a shutter, for the device the visitor is holding.
 *
 * The file input this sits beside already opens the camera app on a phone, but
 * hands back whatever that app decides to return and does nothing at all on a
 * desktop. Here the frame is grabbed in the page, so the same shutter works on
 * a laptop webcam and a phone, and the photo goes straight into the review
 * flow without a round trip through the gallery.
 */
export default function CameraCapture({ onCapture, onCancel, label = "Use camera" }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // The track holds the camera light on until it is stopped, so every exit
  // path — cancel, capture, unmount, a failed restart — has to run this.
  useEffect(() => stop, [stop]);

  useEffect(() => {
    let cancelled = false;

    async function open() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        stop();
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setReady(true);
        setError("");
        // Labels are blank until permission is granted, so the device list is
        // only worth reading once a stream exists.
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setCameras(devices.filter((device) => device.kind === "videoinput"));
      } catch (failure) {
        if (!cancelled) { setError(describeCameraError(failure)); setReady(false); }
      }
    }

    void open();
    return () => { cancelled = true; };
  }, [deviceId, stop]);

  function shoot() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const { width, height } = captureSize(video.videoWidth, video.videoHeight);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(video, 0, 0, width, height);

    canvas.toBlob((blob) => {
      if (!blob) { setError("That frame could not be saved. Try again."); return; }
      stop();
      onCapture(new File([blob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" }));
    }, "image/jpeg", CAPTURE_QUALITY);
  }

  function flip() {
    const next = nextCameraId(cameras, deviceId || streamRef.current?.getVideoTracks()[0]?.getSettings().deviceId || "");
    if (next) setDeviceId(next);
  }

  return <div className="camera-capture">
    <div className="camera-stage">
      <video ref={videoRef} playsInline muted autoPlay aria-label={`${label} viewfinder`} />
      {!ready && !error && <p className="camera-status">Starting the camera…</p>}
      {error && <p className="camera-status" role="alert">{error}</p>}
    </div>
    <div className="camera-controls">
      <button type="button" className="camera-shutter" onClick={shoot} disabled={!ready}>Take photo</button>
      {cameras.length > 1 && <button type="button" onClick={flip} disabled={!ready}>Switch camera</button>}
      <button type="button" onClick={() => { stop(); onCancel(); }}>Cancel</button>
    </div>
  </div>;
}
