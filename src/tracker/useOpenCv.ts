import { useEffect, useState } from "react";
import cvReadyPromise from "@techstark/opencv-js";
import type { OpenCV } from "../types";

/**
 * Lazy-loads the OpenCV.js runtime and returns the cv instance once ready.
 */
export const useOpenCv = () => {
  const [cv, setCv] = useState<OpenCV | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    cvReadyPromise
      .then((instance) => {
        if (!cancelled) {
          setCv(instance);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { cv, error };
};

export type UseOpenCvResult = ReturnType<typeof useOpenCv>;
