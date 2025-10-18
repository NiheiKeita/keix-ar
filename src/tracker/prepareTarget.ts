import type { Mat } from "@techstark/opencv-js/dist/src/types/opencv";
import type {
  ImageTargetConfig,
  OpenCV,
  PreparedTarget,
  KeyPointVectorInstance,
} from "../types";

const loadImageElement = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (event) => {
      reject(
        new Error(
          `Failed to load target image from "${src}". Event: ${
            (event as ErrorEvent).message ?? "unknown error"
          }`,
        ),
      );
    };
    img.src = src;
  });

const createCornerMat = (cv: OpenCV, width: number, height: number): Mat => {
  const corners = new Float32Array([
    0,
    0,
    width,
    0,
    width,
    height,
    0,
    height,
  ]);

  return cv.matFromArray(4, 1, cv.CV_32FC2, corners);
};

const computeDescriptors = (
  cv: OpenCV,
  gray: Mat,
): {
  keypoints: KeyPointVectorInstance;
  descriptors: Mat;
} => {
  const keypoints = new cv.KeyPointVector();
  const descriptors = new cv.Mat();
  const mask = new cv.Mat();
  const orb = new cv.ORB();

  orb.detectAndCompute(gray, mask, keypoints, descriptors);

  orb.delete();
  mask.delete();

  return { keypoints, descriptors };
};

export const prepareTarget = async (
  cv: OpenCV,
  target: ImageTargetConfig,
): Promise<PreparedTarget> => {
  const imageElement = await loadImageElement(target.src);
  const rgba = cv.imread(imageElement);
  const gray = new cv.Mat();

  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);

  const { keypoints, descriptors } = computeDescriptors(cv, gray);
  const cornerMat = createCornerMat(cv, rgba.cols, rgba.rows);

  rgba.delete();
  gray.delete();

  return {
    id: target.id,
    name: target.name,
    width: rgba.cols,
    height: rgba.rows,
    keypoints,
    descriptors,
    cornerMat,
  };
};
