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

import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';

import { HAND_CONNECTIONS } from '@mediapipe/hands';

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

  createHandLandmarker = async () => {
    try {
      // Add try...catch for better error reporting
      const vision = await FilesetResolver.forVisionTasks(
        '/wasm'
      );
      const handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task`,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
      });
      this.handLandmarker.set(handLandmarker);
      console.log(
        '✅ HandLandmarker created and set successfully:',
        this.handLandmarker()
      ); // <-- ADD LOG
    } catch (error) {
      console.error('❌ Failed to create HandLandmarker:', error); // <-- ADD ERROR LOGGING
    }
  };

  hasGetUserMedia = () => !!navigator.mediaDevices?.getUserMedia;

  async ngOnInit() {
    console.log('ini', this.canvasElement());
    await this.createHandLandmarker();

    // check if webcam is supported
    if (!this.hasGetUserMedia()) {
      console.warn('getUserMedia() is not supported by your browser');
    }

    if (!this.handLandmarker()) {
      console.warn('Wait! objectDetector not loaded yet.');
    }

    this.start();
  }
  predictWebcam = async () => {
    // Add this log right at the beginning
    console.log('🔄 predictWebcam loop running - Time:', performance.now());

    // --- Keep the existing checks for canvasRef/videoRef ---
    if (!this.canvasRef() || !this.videoRef()) {
      console.warn('Canvas or Video element not ready yet.');
      window.requestAnimationFrame(this.predictWebcam);
      return;
    }
    // --- End checks ---

    const video = this.video();
    const canvasElement = this.canvasElement();
    const canvasCtx = this.canvasCtx();
    const handLandmarker = this.handLandmarker();

    // --- Keep existing check for canvasCtx ---
    if (!canvasCtx) {
      console.error('Canvas context not available');
      window.requestAnimationFrame(this.predictWebcam);
      return;
    }
    // --- End check ---

    // --- Keep existing canvas resizing ---
    if (
      canvasElement.width !== video.videoWidth ||
      canvasElement.height !== video.videoHeight
    ) {
      canvasElement.style.width = `${video.videoWidth}px`;
      canvasElement.style.height = `${video.videoHeight}px`;
      canvasElement.width = video.videoWidth;
      canvasElement.height = video.videoHeight;
      // console.log('Canvas resized to:', video.videoWidth, video.videoHeight); // Optional log
    }
    // --- End resizing ---

    if (handLandmarker && video.readyState >= video.HAVE_CURRENT_DATA) {
      let startTimeMs = performance.now();
      if (this.lastVideoTime() !== video.currentTime) {
        this.lastVideoTime.set(video.currentTime);

        // Log BEFORE detection
        console.log('▶️ Calling detectForVideo...');

        const results = handLandmarker.detectForVideo(video, startTimeMs);

        // Log AFTER detection - THIS IS VERY IMPORTANT
        console.log('🖐️ Detection results:', JSON.stringify(results)); // Use JSON.stringify for cleaner log

        this.results.set(results);

        // --- Drawing logic ---
        canvasCtx.save();
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

        if (results.landmarks && results.landmarks.length > 0) {
          // Log if drawing should happen
          console.log(`🎨 Drawing ${results.landmarks.length} hands.`);
          for (const landmarks of results.landmarks) {
            drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, {
              color: 'lime',
            }); // Use named color, omit lineWidth
            drawLandmarks(canvasCtx, landmarks, { color: 'red', radius: 3 }); // Use radius instead of lineWidth
          }
        } else {
          // Log if NO landmarks are found
          console.log('🚫 No landmarks detected in this frame.'); // Optional, can be noisy
        }
        canvasCtx.restore();
        // --- End Drawing ---
      } else {
        // Optional log: See if the time check is preventing detection
        // console.log('Video time unchanged, skipping detection');
      }
    } else if (!handLandmarker) {
      console.warn('HandLandmarker not ready yet in loop.');
    } else if (video.readyState < video.HAVE_CURRENT_DATA) {
      // console.warn("Video data not ready yet."); // Optional log
    }

    window.requestAnimationFrame(this.predictWebcam);
  };

  // Also add a log to confirm getUserMedia success
  start() {
    const constraints = {
      video: true,
    };
    navigator.mediaDevices
      .getUserMedia(constraints)
      .then((stream) => {
        console.log('🚀 Webcam stream obtained!'); // <-- ADD THIS LOG
        this.video().srcObject = stream;
        this.video().addEventListener('loadeddata', this.predictWebcam);
      })
      .catch((err) => {
        // Add catch for getUserMedia errors
        console.error('❌ Failed to get webcam stream:', err);
      });
  }
}
