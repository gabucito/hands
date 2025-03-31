import {
  Component,
  computed,
  ElementRef,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';

import {
  HandLandmarker,
  FilesetResolver,
  HandLandmarkerResult,
} from '@mediapipe/tasks-vision';

import { HAND_CONNECTIONS } from '@mediapipe/hands';

interface DrawingOptions {
  color?: string;
  fillColor?: string;
  lineWidth?: number;
  radius?: number;
}

@Component({
  selector: 'app-root',
  imports: [],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
  handLandmarker = signal<HandLandmarker | null>(null);
  webcamRunning = signal<boolean>(false);
  videoRef = viewChild.required<ElementRef<HTMLVideoElement>>('webcam');
  canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('output');
  video = computed(() => this.videoRef().nativeElement);
  canvasElement = computed(() => this.canvasRef().nativeElement);
  canvasCtx = computed(() => this.canvasElement().getContext('2d'));
  lastVideoTime = signal(-1);
  results = signal<HandLandmarkerResult | null>(null);
  animationStartTime: number | null = null; // Track animation start time

  createHandLandmarker = async () => {
    try {
      const vision = await FilesetResolver.forVisionTasks('/wasm');
      const handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: `/hand_landmarker.task`,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
      });
      this.handLandmarker.set(handLandmarker);
    } catch (error) {
      console.error('❌ Failed to create HandLandmarker:', error);
    }
  };

  hasGetUserMedia = () => !!navigator.mediaDevices?.getUserMedia;

  async ngOnInit() {
    await this.createHandLandmarker();

    if (!this.hasGetUserMedia()) {
      console.warn('getUserMedia() is not supported by your browser');
    }

    if (!this.handLandmarker()) {
      console.warn('Wait! objectDetector not loaded yet.');
    }

    this.start();
  }

  predictWebcam = async () => {
    if (!this.canvasRef() || !this.videoRef()) {
      window.requestAnimationFrame(this.predictWebcam);
      return;
    }

    const video = this.video();
    const canvasElement = this.canvasElement();
    const canvasCtx = this.canvasCtx();
    const handLandmarker = this.handLandmarker();

    if (!canvasCtx) {
      console.error('Canvas context not available');
      window.requestAnimationFrame(this.predictWebcam);
      return;
    }

    if (
      canvasElement.width !== video.videoWidth ||
      canvasElement.height !== video.videoHeight
    ) {
      canvasElement.style.width = `${video.videoWidth}px`;
      canvasElement.style.height = `${video.videoHeight}px`;
      canvasElement.width = video.videoWidth;
      canvasElement.height = video.videoHeight;
    }

    if (handLandmarker && video.readyState >= video.HAVE_CURRENT_DATA) {
      let startTimeMs = performance.now();
      if (this.lastVideoTime() !== video.currentTime) {
        this.lastVideoTime.set(video.currentTime);

        const results = handLandmarker.detectForVideo(video, startTimeMs);

        this.results.set(results);

        canvasCtx.save();
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

        if (results.landmarks && results.landmarks.length > 0) {
          for (const landmarks of results.landmarks) {
            this.customDrawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, {
              color: 'lime',
            });
            this.customDrawLandmarks(canvasCtx, landmarks, {
              color: 'red',
              radius: 3,
            });

            if (this.isHandOpen(landmarks)) {
              if (this.animationStartTime === null) {
                this.animationStartTime = performance.now(); // Start animation timer
              }
              this.animateRoseBloom(canvasCtx, landmarks[9].x * canvasElement.width, landmarks[9].y * canvasElement.height);
            } else {
              this.animationStartTime = null; // Reset animation when hands are closed
            }
          }
        }
        canvasCtx.restore();
      }
    } else if (!handLandmarker) {
      console.warn('HandLandmarker not ready yet in loop.');
    } else if (video.readyState < video.HAVE_CURRENT_DATA) {
    }

    window.requestAnimationFrame(this.predictWebcam);
  };

  start() {
    const constraints = {
      video: true,
    };
    navigator.mediaDevices
      .getUserMedia(constraints)
      .then((stream) => {
        this.video().srcObject = stream;
        this.video().addEventListener('loadeddata', this.predictWebcam);
      })
      .catch((err) => {
        console.error('❌ Failed to get webcam stream:', err);
      });
  }

  customDrawConnectors(
    ctx: CanvasRenderingContext2D,
    landmarks: any[],
    connections: number[][],
    options: DrawingOptions
  ) {
    if (!ctx) return;

    ctx.strokeStyle = options.color || 'black';
    ctx.lineWidth = options.lineWidth || 1;

    for (const connection of connections) {
      const from = landmarks[connection[0]];
      const to = landmarks[connection[1]];

      if (from && to) {
        ctx.beginPath();
        ctx.moveTo(from.x * ctx.canvas.width, from.y * ctx.canvas.height);
        ctx.lineTo(to.x * ctx.canvas.width, to.y * ctx.canvas.height);
        ctx.stroke();
      }
    }
  }

  customDrawLandmarks(
    ctx: CanvasRenderingContext2D,
    landmarks: any[],
    options: DrawingOptions
  ) {
    if (!ctx) return;

    ctx.fillStyle = options.color || 'black';

    for (const landmark of landmarks) {
      ctx.beginPath();
      ctx.arc(
        landmark.x * ctx.canvas.width,
        landmark.y * ctx.canvas.height,
        options.radius || 2,
        0,
        2 * Math.PI
      );
      ctx.fill();
    }
  }

  isHandOpen(landmarks: any[]): boolean {
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    if (!thumbTip || !indexTip) return false;
    const distance = Math.sqrt(
      Math.pow(thumbTip.x - indexTip.x, 2) + Math.pow(thumbTip.y - indexTip.y, 2)
    );
    return distance > 0.15;
  }

  animateRoseBloom(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    if (!ctx || this.animationStartTime === null) return;
    const elapsedTime = performance.now() - this.animationStartTime;
    const progress = Math.min(1, elapsedTime / 5000); // 5 seconds duration

    const roseSize = 50 * progress;
    const petalColor = `rgb(${255 * (1 - progress)}, ${100 * progress}, ${100 * progress})`;

    // Draw rose petals
    ctx.fillStyle = petalColor;
    ctx.beginPath();
    ctx.moveTo(x, y - roseSize / 2);
    ctx.bezierCurveTo(x + roseSize / 4, y - roseSize, x + roseSize / 2, y - roseSize / 4, x, y);
    ctx.bezierCurveTo(x - roseSize / 2, y - roseSize / 4, x - roseSize / 4, y - roseSize, x, y - roseSize / 2);
    ctx.fill();

    // Draw inner petals
    ctx.beginPath();
    ctx.moveTo(x, y - roseSize / 4);
    ctx.bezierCurveTo(x + roseSize / 8, y - roseSize / 2, x + roseSize / 4, y - roseSize / 8, x, y);
    ctx.bezierCurveTo(x - roseSize / 4, y - roseSize / 8, x - roseSize / 8, y - roseSize / 2, x, y - roseSize / 4);
    ctx.fill();
  }
}