import type { CV, KeyPoint, Mat } from "@techstark/opencv-js/dist/src/types/opencv";

export type OpenCV = CV;
export type KeyPointVectorInstance = InstanceType<OpenCV["KeyPointVector"]>;
export type BFMatcherInstance = InstanceType<OpenCV["BFMatcher"]>;
export type DMatchVectorVectorInstance = InstanceType<OpenCV["DMatchVectorVector"]>;

export type ImageTargetConfig = {
  /**
   * Unique identifier for the target image.
   */
  id: string;
  /**
   * Display name for debugging or UI purposes.
   */
  name?: string;
  /**
   * Source URL or data URL that resolves to the target image.
   */
  src: string;
};

export type PreparedTarget = {
  id: string;
  name?: string;
  width: number;
  height: number;
  keypoints: KeyPointVectorInstance;
  descriptors: Mat;
  cornerMat: Mat;
};

export type DetectionCorner = readonly [x: number, y: number];

export type ImageDetection = {
  id: string;
  name?: string;
  corners: DetectionCorner[];
  confidence: number;
};

export type ImageTrackerProps = {
  /**
   * Images to track. When the component mounts it will pre-process these images.
   */
  targets: ImageTargetConfig[];
  /**
   * Callback fired every time detections are produced for a frame.
   */
  onDetections?: (detections: ImageDetection[]) => void;
  /**
   * Optional media constraints passed to getUserMedia. Defaults to using the environment camera.
   */
  videoConstraints?: MediaStreamConstraints;
  /**
   * CSS class applied to the wrapper element.
   */
  className?: string;
  /**
    * Whether to render the overlay canvas that draws detection bounding boxes.
    */
  showOverlay?: boolean;
  /**
   * Frame processing throttling in milliseconds. Defaults to ~1000/30.
   */
  frameIntervalMs?: number;
};

export type SceneArtifacts = {
  frame: Mat;
  gray: Mat;
  keypoints: KeyPointVectorInstance;
  descriptors: Mat;
};

export type MatchResult = {
  detection: ImageDetection;
  homography: Mat;
};

export type KeyPointCollection = {
  get(index: number): KeyPoint;
  size(): number;
};
