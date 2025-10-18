import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { useOpenCv } from "./useOpenCv";
import { prepareTarget } from "./prepareTarget";
import { matchTarget } from "./matchTarget";
import type {
  BFMatcherInstance,
  ImageDetection,
  ImageTargetConfig,
  ImageTrackerProps,
  OpenCV,
  PreparedTarget,
  SceneArtifacts,
} from "../types";

const DEFAULT_FRAME_INTERVAL = 1000 / 24;

const defaultConstraints: MediaStreamConstraints = { video: { facingMode: "environment" } };

const videoStyle: CSSProperties = {
  width: "100%",
  height: "auto",
  display: "block",
};

const canvasStyle: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
  pointerEvents: "none",
};

const containerStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  overflow: "hidden",
};

const cleanupPreparedTargets = (targets: PreparedTarget[]) => {
  targets.forEach((target) => {
    target.keypoints.delete();
    target.descriptors.delete();
    target.cornerMat.delete();
  });
};

const stopMediaStream = (stream: MediaStream | null) => {
  stream?.getTracks().forEach((track) => track.stop());
};

const drawDetections = (
  canvas: HTMLCanvasElement,
  detections: ImageDetection[],
) => {
  const context = canvas.getContext("2d");
  if (!context) return;

  context.clearRect(0, 0, canvas.width, canvas.height);

  context.strokeStyle = "rgba(255, 0, 0, 0.9)";
  context.lineWidth = 4;

  detections.forEach((detection) => {
    const corners = detection.corners;

    if (corners.length !== 4) return;

    context.beginPath();
    context.moveTo(corners[0][0], corners[0][1]);
    for (let i = 1; i < corners.length; i += 1) {
      context.lineTo(corners[i][0], corners[i][1]);
    }
    context.closePath();
    context.stroke();
  });
};

const computeSceneArtifacts = (
  cv: OpenCV,
  frame: ImageData,
): SceneArtifacts => {
  const mat = cv.matFromImageData(frame);
  const gray = new cv.Mat();

  cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);

  const keypoints = new cv.KeyPointVector();
  const descriptors = new cv.Mat();
  const mask = new cv.Mat();
  const orb = new cv.ORB();

  orb.detectAndCompute(gray, mask, keypoints, descriptors);

  orb.delete();
  mask.delete();

  return { frame: mat, gray, keypoints, descriptors };
};

const releaseSceneArtifacts = (artifacts: SceneArtifacts) => {
  artifacts.frame.delete();
  artifacts.gray.delete();
  artifacts.keypoints.delete();
  artifacts.descriptors.delete();
};

const processTargets = async (
  cv: OpenCV,
  targets: ImageTargetConfig[],
  signal: AbortSignal,
  setProgress?: (processed: number, total: number) => void,
): Promise<PreparedTarget[]> => {
  const prepared: PreparedTarget[] = [];
  for (let i = 0; i < targets.length; i += 1) {
    if (signal.aborted) break;
    // eslint-disable-next-line no-await-in-loop
    const target = await prepareTarget(cv, targets[i]);
    prepared.push(target);
    setProgress?.(prepared.length, targets.length);
  }
  return prepared;
};

const ensureCanvasSize = (
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
) => {
  const { videoWidth, videoHeight } = video;
  if (!videoWidth || !videoHeight) return;
  if (canvas.width !== videoWidth || canvas.height !== videoHeight) {
    canvas.width = videoWidth;
    canvas.height = videoHeight;
  }
};

const createFrameReader = (video: HTMLVideoElement) => {
  const offscreenCanvas = document.createElement("canvas");
  const context = offscreenCanvas.getContext("2d", { willReadFrequently: true });

  return () => {
    const width = video.videoWidth;
    const height = video.videoHeight;

    if (width === 0 || height === 0 || !context) {
      return null;
    }

    if (offscreenCanvas.width !== width || offscreenCanvas.height !== height) {
      offscreenCanvas.width = width;
      offscreenCanvas.height = height;
    }

    context.drawImage(video, 0, 0, width, height);
    return context.getImageData(0, 0, width, height);
  };
};

const usePreparedTargets = (
  cv: OpenCV | null,
  targets: ImageTargetConfig[],
) => {
  const [preparedTargets, setPreparedTargets] = useState<PreparedTarget[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!cv || targets.length === 0) {
      setPreparedTargets((prev) => {
        cleanupPreparedTargets(prev);
        return [];
      });
      return () => {};
    }

    const abortController = new AbortController();
    abortRef.current?.abort();
    abortRef.current = abortController;

    let cancelled = false;

    processTargets(cv, targets, abortController.signal)
      .then((result) => {
        if (!cancelled && !abortController.signal.aborted) {
          setPreparedTargets((prev) => {
            cleanupPreparedTargets(prev);
            return result;
          });
        } else {
          cleanupPreparedTargets(result);
        }
      })
      .catch((error) => {
        console.error("Failed to prepare targets", error);
      });

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [cv, targets]);

  useEffect(
    () => () => {
      setPreparedTargets((prev) => {
        cleanupPreparedTargets(prev);
        return [];
      });
    },
    [],
  );

  return preparedTargets;
};

const runMatching = (
  cv: OpenCV,
  preparedTargets: PreparedTarget[],
  scene: SceneArtifacts,
  matcher: BFMatcherInstance,
): ImageDetection[] => {
  const detections: ImageDetection[] = [];

  if (scene.descriptors.empty()) {
    return detections;
  }

  preparedTargets.forEach((target) => {
    const match = matchTarget(cv, target, scene, matcher);
    if (match) {
      detections.push(match.detection);
      match.homography.delete();
    }
  });

  return detections;
};

const detectionLoop = (
  cv: OpenCV,
  video: HTMLVideoElement,
  preparedTargets: PreparedTarget[],
  overlayCanvas: HTMLCanvasElement | null,
  frameReader: () => ImageData | null,
  frameInterval: number,
  onDetections?: (detections: ImageDetection[]) => void,
) => {
  const matcher: BFMatcherInstance = new cv.BFMatcher(cv.NORM_HAMMING, false);
  let animationHandle = 0;
  let lastRun = 0;

  const loop = (timestamp: number) => {
    animationHandle = window.requestAnimationFrame(loop);
    if (timestamp - lastRun < frameInterval) return;
    lastRun = timestamp;

    const frameData = frameReader();
    if (!frameData) return;

    const scene = computeSceneArtifacts(cv, frameData);
    try {
      const detections = runMatching(cv, preparedTargets, scene, matcher);
      if (overlayCanvas) {
        ensureCanvasSize(overlayCanvas, video);
        drawDetections(overlayCanvas, detections);
      }
      onDetections?.(detections);
    } catch (error) {
      console.error("Image tracking failed", error);
    } finally {
      releaseSceneArtifacts(scene);
    }
  };

  animationHandle = window.requestAnimationFrame(loop);

  return () => {
    window.cancelAnimationFrame(animationHandle);
    matcher.delete();
  };
};

const useCameraStream = (
  videoRef: RefObject<HTMLVideoElement>,
  constraints: MediaStreamConstraints | undefined,
) => {
  useEffect(() => {
    const video = videoRef.current;
    if (!video || typeof navigator === "undefined") return;

    let active = true;
    let currentStream: MediaStream | null = null;

    const startStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(
          constraints ?? defaultConstraints,
        );
        if (!active) {
          stopMediaStream(stream);
          return;
        }

        currentStream = stream;
        video.srcObject = stream;
        await video.play();
      } catch (error) {
        console.error("Failed to access camera", error);
      }
    };

    startStream();

    return () => {
      active = false;
      stopMediaStream(currentStream);
      if (video.srcObject) {
        video.pause();
        video.srcObject = null;
      }
    };
  }, [constraints, videoRef]);
};

export const ImageTracker = memo(
  ({
    targets,
    onDetections,
    videoConstraints,
    className,
    showOverlay = true,
    frameIntervalMs = DEFAULT_FRAME_INTERVAL,
  }: ImageTrackerProps) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const overlayRef = useRef<HTMLCanvasElement>(null);
    const [videoReady, setVideoReady] = useState(false);

    useCameraStream(videoRef, videoConstraints);

    const { cv } = useOpenCv();
    const preparedTargets = usePreparedTargets(cv, targets);

    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      const handleReady = () => {
        if (video.videoWidth > 0) {
          setVideoReady(true);
        }
      };

      video.addEventListener("loadedmetadata", handleReady);
      video.addEventListener("resize", handleReady);

      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        handleReady();
      }

      return () => {
        video.removeEventListener("loadedmetadata", handleReady);
        video.removeEventListener("resize", handleReady);
      };
    }, []);

    useEffect(() => {
      const cvInstance = cv;
      const video = videoRef.current;
      const overlayCanvas = overlayRef.current;
      const reader = video ? createFrameReader(video) : null;

      if (
        !cvInstance ||
        !video ||
        preparedTargets.length === 0 ||
        !videoReady ||
        !reader
      ) {
        if (overlayCanvas) {
          const ctx = overlayCanvas.getContext("2d");
          ctx?.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        }
        return () => {};
      }

      const cleanup = detectionLoop(
        cvInstance,
        video,
        preparedTargets,
        showOverlay ? overlayCanvas : null,
        reader,
        frameIntervalMs,
        onDetections,
      );

      return () => {
        cleanup();
      };
    }, [
      cv,
      frameIntervalMs,
      onDetections,
      preparedTargets,
      videoReady,
      showOverlay,
    ]);

    const containerClass = useMemo(() => {
      if (!className) return undefined;
      return className;
    }, [className]);

    return (
      <div style={containerStyle} className={containerClass}>
        <video ref={videoRef} style={videoStyle} playsInline muted />
        {showOverlay ? <canvas ref={overlayRef} style={canvasStyle} /> : null}
      </div>
    );
  },
);

ImageTracker.displayName = "ImageTracker";
