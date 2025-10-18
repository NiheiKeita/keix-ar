# react-image-tracker ドキュメント

## 1. 目的

`react-image-tracker` はブラウザのカメラ映像を用いて、事前に登録した静止画像（ターゲット）をリアルタイムに検出し、検出位置を React コンポーネント上で扱えるようにするライブラリです。VR/AR 的なオーバーレイ表現や、特定ポスター・ロゴの識別に活用できます。

## 2. ユースケース

- 店舗ポスターや商品パッケージを検出してプロモーション表示を切り替える。
- アナログ資料にカメラを向けると関連情報を AR 表示する。
- 特定マーカーをトリガーに UI を切り替える。

## 3. 前提条件

- ブラウザ環境で WebRTC (`navigator.mediaDevices.getUserMedia`) が利用可能であること。
- HTTPS または `localhost` で実行すること（ブラウザのカメラアクセス制限）。
- 画像 `src` は CORS 設定済み、もしくは Data URL。
- 対象画像に十分な特徴点（角や模様）が存在すること。

## 4. API 仕様

### 4.1 `ImageTracker` コンポーネント

| プロパティ | 型 | 必須 | デフォルト | 説明 |
| --- | --- | --- | --- | --- |
| `targets` | `ImageTargetConfig[]` | ✔ | — | 検出対象画像の設定（`id`, `src`, `name?`）。 |
| `onDetections` | `(detections: ImageDetection[]) => void` |  | `undefined` | フレーム毎の検出結果を受け取る。 |
| `videoConstraints` | `MediaStreamConstraints` |  | `{ video: { facingMode: "environment" } }` | `getUserMedia` に渡す制約。 |
| `showOverlay` | `boolean` |  | `true` | 検出結果を赤い枠で描画するキャンバスを表示。 |
| `frameIntervalMs` | `number` |  | `1000 / 24` | フレーム処理の間隔（負荷調整）。 |
| `className` | `string` |  | `undefined` | ラッパー要素に適用するクラス名。 |

### 4.2 型定義

```ts
type ImageTargetConfig = {
  id: string;
  src: string;
  name?: string;
};

type ImageDetection = {
  id: string;
  name?: string;
  confidence: number;            // 0〜1 の信頼度
  corners: [number, number][];   // 射影後の四隅座標（左上→右上→右下→左下）
};
```

## 5. 処理フロー

1. **OpenCV.js ロード**  
   - `useOpenCv` フックが `@techstark/opencv-js` の Promise を待ち、`cv` インスタンスを React state へ格納。
2. **ターゲット前処理**  
   - `prepareTarget` が各ターゲット画像を `cv.imread` で読み込み、グレースケール変換。
   - ORB 特徴量抽出 (`ORB.detectAndCompute`) でキーポイントとディスクリプタを作成。
   - 画像の四隅座標を `cornerMat` として保持。
3. **カメラ起動**  
   - `useCameraStream` が `navigator.mediaDevices.getUserMedia` を呼び出し、`video` 要素へストリームを接続。
4. **フレーム取得**  
   - `createFrameReader` がオフスクリーンキャンバスに `video` の内容を描画し、`ImageData` を取得。
5. **シーン特徴量抽出**  
   - `computeSceneArtifacts` でカメラフレームをグレースケール化し、同じく ORB でキーポイントとディスクリプタを算出。
6. **特徴点マッチング**  
   - `matchTarget` が `BFMatcher(NORM_HAMMING)` を用いて KNN マッチング (`k=2`) を実行。
   - Lowe の比率テストで誤マッチを排除。
7. **ホモグラフィ推定**  
   - `findHomography` + `RANSAC` によりターゲット→シーン変換行列を算出。
   - インライヤ率から `confidence` を計算。
   - `perspectiveTransform` でターゲット四隅をシーン座標へ射影。
8. **結果通知と描画**  
   - `onDetections` コールバックに `ImageDetection[]` を渡す。
   - `showOverlay` が有効な場合、`<canvas>` に赤い多角形で描画。

## 6. 主要コンポーネント・モジュール

| ファイル | 役割 |
| --- | --- |
| `src/tracker/ImageTracker.tsx` | React コンポーネント。カメラ制御・検出ループ・描画全般を管理。 |
| `src/tracker/useOpenCv.ts` | OpenCV.js ローダーフック。読み込み状態とエラーを扱う。 |
| `src/tracker/prepareTarget.ts` | ターゲット前処理（ORB 特徴量生成、cornerMat 作成）を担当。 |
| `src/tracker/matchTarget.ts` | フレームとのマッチング、ホモグラフィ推定、信頼度算出。 |
| `src/types.ts` | 各モジュールで使用する型を定義。 |

## 7. エラー処理・クリーンアップ

- ターゲット準備失敗時は `console.error` にログし、既存 `Mat` は都度 `delete()`。
- カメラ停止時は `MediaStreamTrack.stop()` を呼び、`video.srcObject` を解除。
- React `useEffect` クリーンアップでキャンバスをクリアし、ループの `requestAnimationFrame` を停止。

## 8. 性能とチューニング

- `frameIntervalMs` を調整することで処理頻度を制御（値を大きくすると負荷低減）。
- ROI（Region of Interest）制限や画像解像度ダウンスケールを追加することで高速化が可能。
- ターゲット枚数が多い場合は、事前にマッチング順序や特徴点数を制限する検討が必要。

## 9. 発展的な拡張案

- Web Worker でフレーム処理を行いメインスレッド負荷を削減。
- AR ライブラリとの連携や 3D オブジェクト描画への拡張。
- 動画ターゲットやマーカー探索への対応。

---

## 10. 実装アーキテクチャ解説

### 10.1 フックとライフサイクル

1. `ImageTracker` マウント  
   - `useOpenCv` が実行され、`cvReadyPromise` の解決を待機。
   - 同時に `useCameraStream` がカメラストリームを要求し、成功時に `<video>` へセット。
2. ターゲット配列の変更  
   - `usePreparedTargets` が AbortController を用いて既存の準備処理を中断し、新しいターゲット群を順次 `prepareTarget` で前処理。
   - 既存の `Mat` リソースは `cleanupPreparedTargets` が `delete()` を呼び出して破棄。
3. カメラ準備完了 (`loadedmetadata`)  
   - `videoReady` が `true` となり、検出ループが開始可能状態になる。

### 10.2 検出ループ (`detectionLoop`)

| ステップ | 詳細 |
| --- | --- |
| `requestAnimationFrame` ループ | フレームの時間差を用いて `frameIntervalMs` 以上経過した時だけ処理。 |
| フレーム読み取り | `createFrameReader` がオフスクリーンキャンバスから `ImageData` を取得。 |
| ORB 特徴量計算 | `computeSceneArtifacts` で ORB キーポイントとディスクリプタを算出。 |
| マッチング | `BFMatcher.knnMatch` + 比率検定でベストマッチのみに絞る。 |
| ホモグラフィ | `findHomography(..., RANSAC)` で射影変換行列を推定。 |
| 信頼度 | RANSAC のマスクからインライヤ率を算出し `confidence` に格納。 |
| オーバーレイ描画 | `drawDetections` が `<canvas>` に赤枠を描画。 |
| コールバック | `onDetections` が最新の検出結果を受け取り、親コンポーネントへ通知。 |
| リソース解放 | `releaseSceneArtifacts` が `Mat`/`KeyPointVector` を破棄。 |

### 10.3 メモリ管理

- **OpenCV.js オブジェクトの破棄**  
  - 画像前処理、フレーム処理ともに `Mat.delete()`/`KeyPointVector.delete()` を呼び出し、WASM メモリリークを防止。
- **キャンセル処理**  
  - ターゲット準備中にコンポーネントがアンマウントされた場合、`AbortController` を通じて後続処理を中断。
  - 既に生成された `PreparedTarget` は破棄用関数で後始末。

### 10.4 依存関係

- React 18 + TypeScript。
- OpenCV.js (`@techstark/opencv-js`) の Promise ベース API。
- `tsup` によるビルドで CJS/ESM/型定義を生成。

---

上記仕様と実装アーキテクチャにより、`ImageTracker` を利用すると React アプリケーション内で手軽に画像トラッキングの体験を実現できます。
