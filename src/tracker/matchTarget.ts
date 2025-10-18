import type { Mat } from "@techstark/opencv-js/dist/src/types/opencv";
import type {
  BFMatcherInstance,
  DMatchVectorVectorInstance,
  ImageDetection,
  MatchResult,
  OpenCV,
  PreparedTarget,
  SceneArtifacts,
} from "../types";

const MIN_MATCH_COUNT = 12;
const RATIO_TEST_THRESHOLD = 0.75;

const extractPointArrays = (
  cv: OpenCV,
  target: PreparedTarget,
  scene: SceneArtifacts,
  matches: DMatchVectorVectorInstance,
) => {
  const srcPoints: number[] = [];
  const dstPoints: number[] = [];

  for (let i = 0; i < matches.size(); i += 1) {
    const match = matches.get(i);
    if (match.size() < 2) continue;

    const best = match.get(0);
    const alt = match.get(1);

    if (best.distance >= RATIO_TEST_THRESHOLD * alt.distance) continue;

    const queryIdx = best.queryIdx;
    const trainIdx = best.trainIdx;

    const targetKeyPoint = target.keypoints.get(queryIdx);
    const sceneKeyPoint = scene.keypoints.get(trainIdx);

    srcPoints.push(targetKeyPoint.pt.x, targetKeyPoint.pt.y);
    dstPoints.push(sceneKeyPoint.pt.x, sceneKeyPoint.pt.y);
  }

  return { srcPoints, dstPoints };
};

const transformCorners = (
  cv: OpenCV,
  target: PreparedTarget,
  homography: Mat,
): ImageDetection["corners"] => {
  const projected = new cv.Mat();
  cv.perspectiveTransform(target.cornerMat, projected, homography);

  const corners: ImageDetection["corners"] = [];

  for (let i = 0; i < projected.rows; i += 1) {
    const x = projected.data32F[i * 2];
    const y = projected.data32F[i * 2 + 1];
    corners.push([x, y]);
  }

  projected.delete();

  return corners;
};

export const matchTarget = (
  cv: OpenCV,
  target: PreparedTarget,
  scene: SceneArtifacts,
  matcher: BFMatcherInstance,
): MatchResult | null => {
  if (target.descriptors.empty() || scene.descriptors.empty()) {
    return null;
  }

  const matches = new cv.DMatchVectorVector() as DMatchVectorVectorInstance;
  matcher.knnMatch(target.descriptors, scene.descriptors, matches, 2);

  const { srcPoints, dstPoints } = extractPointArrays(cv, target, scene, matches);

  matches.delete();

  if (srcPoints.length < MIN_MATCH_COUNT || dstPoints.length < MIN_MATCH_COUNT) {
    return null;
  }

  const srcMat = cv.matFromArray(srcPoints.length / 2, 1, cv.CV_32FC2, srcPoints);
  const dstMat = cv.matFromArray(dstPoints.length / 2, 1, cv.CV_32FC2, dstPoints);

  const mask = new cv.Mat();
  const homography = cv.findHomography(srcMat, dstMat, cv.RANSAC, 5.0, mask);

  srcMat.delete();
  dstMat.delete();

  if (homography.empty()) {
    mask.delete();
    homography.delete();
    return null;
  }

  // Confidence approximated by inlier ratio.
  let inliers = 0;
  for (let i = 0; i < mask.rows; i += 1) {
    if (mask.data[i] === 1) {
      inliers += 1;
    }
  }

  const confidence = inliers / Math.max(mask.rows, 1);

  mask.delete();

  const detection: ImageDetection = {
    id: target.id,
    name: target.name,
    corners: transformCorners(cv, target, homography),
    confidence,
  };

  return { detection, homography };
};
