declare module "@techstark/opencv-js" {
  import type { CV } from "@techstark/opencv-js/dist/src/types/opencv";
  const cvReady: Promise<CV>;
  export default cvReady;
}
