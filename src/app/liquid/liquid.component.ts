import {
  AfterViewInit,
  Component,
  computed,
  ElementRef,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import {
  advection_fs,
  base_vs,
  boundary_fs,
  display_fs,
  div_fs,
  jacobi_fs,
  splat_fs,
  subtract_grad_fs,
} from './shaders';
import {
  FilesetResolver,
  HandLandmarker,
  HandLandmarkerResult,
} from '@mediapipe/tasks-vision';
import { HAND_CONNECTIONS } from '@mediapipe/hands';

interface DrawingOptions {
  color?: string;
  fillColor?: string;
  lineWidth?: number;
  radius?: number;
}

interface FBO_PAIR {
  read: FBO;
  write: FBO;
  swap: () => void;
}

interface FBO {
  tex: WebGLTexture | null;
  fb: WebGLFramebuffer | null;
  bind: () => void;
  bind_tex: (i: number) => number;
}

interface BoundaryProgram {
  program: WebGLProgram;
  uniforms: any;
}

interface Pointer {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  color: number[];
}

interface PointerEventSimple {
  pointerId: number;
  offsetX: number;
  offsetY: number;
}

const POSITION_LOCATION = 0;
const full_pos = new Float32Array([-1, -1, 1, 1, 1, -1, -1, -1, -1, 1, 1, 1]);
const pointers: Pointer[] = [];

@Component({
  selector: 'app-liquid',
  imports: [],
  templateUrl: './liquid.component.html',
  styleUrl: './liquid.component.scss',
})
export class LiquidComponent implements AfterViewInit {
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
      const vision = await FilesetResolver.forVisionTasks('wasm');
      const handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: `hand_landmarker.task`,
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

    // if (
    //   canvasElement.width !== video.videoWidth ||
    //   canvasElement.height !== video.videoHeight
    // ) {
    //   canvasElement.style.width = `${video.videoWidth}px`;
    //   canvasElement.style.height = `${video.videoHeight}px`;
    //   canvasElement.width = video.videoWidth;
    //   canvasElement.height = video.videoHeight;
    // }

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
            const pointer: PointerEventSimple = {
              pointerId: 0,
              offsetX: landmarks[8].x * canvasElement.width + 150,
              offsetY: landmarks[8].y * canvasElement.height + 150,
            };

            this.customDrawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, {
              color: 'lime',
            });
            this.customDrawLandmarks(canvasCtx, landmarks, {
              color: 'red',
              radius: 3,
            });

            if (this.isHandOpen(landmarks)) {
              // find if the pointer is present
              const pointer_idx = pointers.findIndex(
                (p) => p.id === pointer.pointerId
              );
              if (pointer_idx < 0) {
                pointers.push(this.create_pointer(pointer)!);
              } else {
                const new_pointer = this.create_pointer(pointer)!;
                pointers[pointer_idx] = this.update_pointer(
                  pointers[pointer_idx],
                  new_pointer
                );
              }
            } else {
              const pointer_idx = pointers.findIndex(
                (p) => p.id === pointer.pointerId
              );
              if (pointer_idx < 0) {
              } else {
                pointers.splice(pointer_idx, 1);
              }
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
      Math.pow(thumbTip.x - indexTip.x, 2) +
        Math.pow(thumbTip.y - indexTip.y, 2)
    );
    return distance > 0.15;
  }

  animateRoseBloom(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    if (!ctx || this.animationStartTime === null) return;
    const elapsedTime = performance.now() - this.animationStartTime;
    const progress = Math.min(1, elapsedTime / 5000); // 5 seconds duration

    const roseSize = 50 * progress;
    const petalColor = `rgb(${255 * (1 - progress)}, ${100 * progress}, ${
      100 * progress
    })`;

    // Draw rose petals
    ctx.fillStyle = petalColor;
    ctx.beginPath();
    ctx.moveTo(x, y - roseSize / 2);
    ctx.bezierCurveTo(
      x + roseSize / 4,
      y - roseSize,
      x + roseSize / 2,
      y - roseSize / 4,
      x,
      y
    );
    ctx.bezierCurveTo(
      x - roseSize / 2,
      y - roseSize / 4,
      x - roseSize / 4,
      y - roseSize,
      x,
      y - roseSize / 2
    );
    ctx.fill();

    // Draw inner petals
    ctx.beginPath();
    ctx.moveTo(x, y - roseSize / 4);
    ctx.bezierCurveTo(
      x + roseSize / 8,
      y - roseSize / 2,
      x + roseSize / 4,
      y - roseSize / 8,
      x,
      y
    );
    ctx.bezierCurveTo(
      x - roseSize / 4,
      y - roseSize / 8,
      x - roseSize / 8,
      y - roseSize / 2,
      x,
      y - roseSize / 4
    );
    ctx.fill();
  }

  myCanvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  myCanvas = computed(() => this.myCanvasRef().nativeElement);
  gl = computed(() => this.myCanvas().getContext('webgl2', { alpha: true }));
  full_vao = computed(() => this.gl()?.createVertexArray() ?? null);
  screen = computed(() => {
    const gl = this.gl()!;
    return {
      tex: null,
      fb: null,
      bind: () => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
      },
      bind_tex: (i: number) => i,
    } as FBO;
  });

  config = {
    NU: 1,
    PRESSURE: 0.5,
    DISPLAY: 'dye',
    RADIUS: 0.01,
    VELOCITY_DISSIPATION: 0.99,
    DYE_DISSIPATION: 0.97,
    SIM_RESOLUTION: 128,
    DYE_RESOLUTION: 1024,
    SPLAT_FORCE: 20,
  };

  aspect_ratio = computed(() => {
    const canvas = this.myCanvas();
    return canvas.clientWidth / canvas.clientHeight;
  });

  sim_width = signal(0);
  sim_height = signal(0);
  dye_width = signal(0);
  dye_height = signal(0);
  velocity = signal<FBO_PAIR | null>(null);
  pressure = signal<FBO_PAIR | null>(null);
  dye = signal<FBO_PAIR | null>(null);
  tmp_1f = signal<FBO | null>(null);
  tmp_2f = signal<FBO | null>(null);

  display_program = signal<BoundaryProgram | null>(null);
  boundary_program = signal<BoundaryProgram | null>(null);
  advection_program = signal<BoundaryProgram | null>(null);
  jacobi_program = signal<BoundaryProgram | null>(null);
  subtract_grad_program = signal<BoundaryProgram | null>(null);
  div_program = signal<BoundaryProgram | null>(null);
  splat_program = signal<BoundaryProgram | null>(null);

  last_time = signal(0);

  ngAfterViewInit() {
    requestAnimationFrame(() => {
      this.initWebGL();
    });
  }

  initWebGL() {
    const gl = this.gl();
    if (!gl) return;

    gl.getExtension('EXT_color_buffer_float');
    this.setup_geometry(this.full_vao(), full_pos, 2, gl.FLOAT, false, 0, 0);

    this.display_program.set(this.create_program(gl, base_vs, display_fs));
    this.boundary_program.set(this.create_program(gl, base_vs, boundary_fs));
    this.advection_program.set(this.create_program(gl, base_vs, advection_fs));
    this.jacobi_program.set(this.create_program(gl, base_vs, jacobi_fs));
    this.subtract_grad_program.set(
      this.create_program(gl, base_vs, subtract_grad_fs)
    );
    this.div_program.set(this.create_program(gl, base_vs, div_fs));
    this.splat_program.set(this.create_program(gl, base_vs, splat_fs));

    let velocity = this.create_fbo_pair(
      gl,
      this.sim_width(),
      this.sim_height(),
      gl.RG32F,
      gl.RG,
      gl.FLOAT,
      gl.NEAREST
    );
    this.velocity.set(velocity);

    let pressure = this.create_fbo_pair(
      gl,
      this.sim_width(),
      this.sim_height(),
      gl.R32F,
      gl.RED,
      gl.FLOAT,
      gl.NEAREST
    );
    this.pressure.set(pressure);

    let tmp_1f = this.create_fbo(
      gl,
      this.sim_width(),
      this.sim_height(),
      gl.R32F,
      gl.RED,
      gl.FLOAT,
      gl.NEAREST
    );
    this.tmp_1f.set(tmp_1f);

    let tmp_2f = this.create_fbo(
      gl,
      this.sim_width(),
      this.sim_height(),
      gl.RG32F,
      gl.RG,
      gl.FLOAT,
      gl.NEAREST
    );
    this.tmp_2f.set(tmp_2f);

    let dye = this.create_fbo_pair(
      gl,
      this.dye_width(),
      this.dye_height(),
      gl.RGBA32F,
      gl.RGBA,
      gl.FLOAT,
      gl.NEAREST
    );
    this.dye.set(dye);

    requestAnimationFrame((time) => this.loop(gl, time));

    this.myCanvas().addEventListener('pointerdown', (e) => {
      pointers.push(this.create_pointer(e)!);
    });

    this.myCanvas().addEventListener('pointerup', (e) => {
      const pointer_idx = pointers.findIndex((p) => p.id === e.pointerId);
      if (pointer_idx < 0) return;

      pointers.splice(pointer_idx, 1);
    });

    this.myCanvas().addEventListener('pointermove', (e) => {
      const pointer_idx = pointers.findIndex((p) => p.id === e.pointerId);
      if (pointer_idx < 0) return;

      const new_pointer = this.create_pointer(e)!;
      pointers[pointer_idx] = this.update_pointer(
        pointers[pointer_idx],
        new_pointer
      );
    });

    this.myCanvas().addEventListener('pointerout', (e) => {
      const pointer_idx = pointers.findIndex((p) => p.id === e.pointerId);
      if (pointer_idx < 0) return;

      pointers.splice(pointer_idx, 1);
    });
  }

  get_size(target_size: number): { width: number; height: number } {
    const aspect_ratio = this.aspect_ratio();
    if (aspect_ratio < 1)
      return {
        width: target_size,
        height: Math.round(target_size / aspect_ratio),
      };
    else
      return {
        width: Math.round(target_size * aspect_ratio),
        height: target_size,
      };
  }

  setup_sizes() {
    const canvas = this.myCanvas();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    if (canvas.width === w && canvas.height === h) return false;

    canvas.width = w;
    canvas.height = h;

    const sim_size = this.get_size(this.config.SIM_RESOLUTION);
    const dye_size = this.get_size(this.config.DYE_RESOLUTION);

    this.sim_width.set(sim_size.width);
    this.sim_height.set(sim_size.height);
    this.dye_width.set(dye_size.width);
    this.dye_height.set(dye_size.height);

    return true;
  }

  setup_geometry(
    vao: WebGLVertexArrayObject | null,
    position_data: any,
    size: GLint,
    type: GLenum,
    normalized: GLboolean,
    stride: GLsizei,
    offset: GLintptr
  ) {
    const gl = this.gl();
    if (!gl) return;

    gl.bindVertexArray(vao);

    const position_buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, position_buffer);
    gl.bufferData(gl.ARRAY_BUFFER, position_data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(POSITION_LOCATION);
    gl.vertexAttribPointer(
      POSITION_LOCATION,
      size,
      type,
      normalized,
      stride,
      offset
    );
  }

  compile_shader(gl: WebGL2RenderingContext, type: GLenum, source: string) {
    const shader = gl.createShader(type);
    if (!shader) return null;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  compile_program(
    gl: WebGL2RenderingContext,
    vs: WebGLShader,
    fs: WebGLShader
  ) {
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }
    return program;
  }

  compile_uniforms(gl: WebGL2RenderingContext, program: WebGLProgram) {
    const uniforms: any = {};
    const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; ++i) {
      const info = gl.getActiveUniform(program, i);
      if (!info) return;
      uniforms[info.name] = gl.getUniformLocation(program, info.name);
    }
    return uniforms;
  }

  create_program(
    gl: WebGL2RenderingContext,
    vs_source: string,
    fs_source: string
  ): { program: WebGLProgram; uniforms: any } | null {
    const vs = this.compile_shader(gl, gl.VERTEX_SHADER, vs_source);
    const fs = this.compile_shader(gl, gl.FRAGMENT_SHADER, fs_source);
    if (!vs || !fs) return null;
    const program = this.compile_program(gl, vs, fs);

    if (!program) return null;
    const uniforms = this.compile_uniforms(gl, program);

    gl.bindAttribLocation(program, POSITION_LOCATION, 'a_position');

    return { program, uniforms };
  }

  create_fbo(
    gl: WebGL2RenderingContext,
    w: GLsizei,
    h: GLsizei,
    internal_format: GLint,
    format: GLenum,
    type: GLenum,
    filter: GLint
  ): FBO | null {
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      internal_format,
      w,
      h,
      0,
      format,
      type,
      null
    );

    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0
    );

    return {
      tex: texture,
      fb: fb,
      bind: () => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.viewport(0, 0, w, h);
      },
      bind_tex: (i: number) => {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        return i;
      },
    };
  }

  create_fbo_pair(
    gl: WebGL2RenderingContext,
    w: GLsizei,
    h: GLsizei,
    internal_format: GLint,
    format: GLenum,
    type: GLenum,
    filter: GLint
  ): FBO_PAIR {
    return {
      read: this.create_fbo(gl, w, h, internal_format, format, type, filter)!,
      write: this.create_fbo(gl, w, h, internal_format, format, type, filter)!,
      swap: function () {
        const temp = this.read;
        this.read = this.write;
        this.write = temp;
      },
    };
  }

  resize_fbo(
    gl: WebGL2RenderingContext,
    src: any,
    w: GLsizei,
    h: GLsizei,
    internal_format: GLint,
    format: GLenum,
    type: GLenum,
    filter: GLint
  ) {
    const display_program = this.display_program();
    if (!display_program) return null;

    const new_fbo = this.create_fbo(
      gl,
      w,
      h,
      internal_format,
      format,
      type,
      filter
    );
    gl.useProgram(display_program.program);
    gl.uniform1i(display_program.uniforms.u_x, src.bind_tex(0));
    this.render(gl, new_fbo!, gl.TRIANGLES, 6);
    return new_fbo;
  }

  resize_fbo_pair(
    gl: WebGL2RenderingContext,
    src: any,
    w: GLsizei,
    h: GLsizei,
    internal_format: GLint,
    format: GLenum,
    type: GLenum,
    filter: GLint
  ) {
    const new_fbo = this.create_fbo_pair(
      gl,
      w,
      h,
      internal_format,
      format,
      type,
      filter
    );
    new_fbo.read = this.resize_fbo(
      gl,
      src.read,
      w,
      h,
      internal_format,
      format,
      type,
      filter
    )!;
    new_fbo.write = this.resize_fbo(
      gl,
      src.write,
      w,
      h,
      internal_format,
      format,
      type,
      filter
    )!;
    return new_fbo;
  }

  setup_fbos(gl: WebGL2RenderingContext) {
    const velocity = this.velocity();
    const newVelocity = this.resize_fbo_pair(
      gl,
      velocity,
      this.sim_width(),
      this.sim_height(),
      gl.RG32F,
      gl.RG,
      gl.FLOAT,
      gl.NEAREST
    );
    this.velocity.set(newVelocity);

    const pressure = this.pressure();
    const newPressure = this.resize_fbo_pair(
      gl,
      pressure,
      this.sim_width(),
      this.sim_height(),
      gl.R32F,
      gl.RED,
      gl.FLOAT,
      gl.NEAREST
    );
    this.pressure.set(newPressure);

    const dye = this.dye();
    let newDye = this.resize_fbo_pair(
      gl,
      dye,
      this.dye_width(),
      this.dye_height(),
      gl.RGBA32F,
      gl.RGBA,
      gl.FLOAT,
      gl.NEAREST
    );
    this.dye.set(newDye);

    let newTmp_1f = this.create_fbo(
      gl,
      this.sim_width(),
      this.sim_height(),
      gl.R32F,
      gl.RED,
      gl.FLOAT,
      gl.NEAREST
    );
    this.tmp_1f.set(newTmp_1f);

    let newTmp_2f = this.create_fbo(
      gl,
      this.sim_width(),
      this.sim_height(),
      gl.RG32F,
      gl.RG,
      gl.FLOAT,
      gl.NEAREST
    );
    this.tmp_2f.set(newTmp_2f);
  }

  /* SIMULATION / RENDERING */

  render(
    gl: WebGL2RenderingContext,
    fbo: FBO,
    geometry: GLenum,
    count: GLsizei,
    clear = false
  ) {
    gl.bindVertexArray(this.full_vao());
    fbo.bind();
    if (clear) {
      gl.clearColor(0.0, 0.0, 0.0, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.drawArrays(geometry, 0, count);
  }

  render_screen(gl: WebGL2RenderingContext, fbo: FBO) {
    const display_program = this.display_program()!;
    gl.useProgram(display_program.program);
    gl.uniform1i(display_program.uniforms.u_x, fbo.bind_tex(0));
    gl.uniform1f(display_program.uniforms.u_alpha, 1.0);
    this.render(gl, this.screen(), gl.TRIANGLES, 6);
  }

  set_boundary(gl: WebGL2RenderingContext, fbo_pair: FBO_PAIR, alpha: GLfloat) {
    const boundary_program = this.boundary_program()!;
    gl.useProgram(boundary_program.program);
    gl.uniform2f(
      boundary_program.uniforms.u_res,
      1 / this.sim_width(),
      1 / this.sim_height()
    );
    gl.uniform1i(boundary_program.uniforms.u_x, fbo_pair.read.bind_tex(0));
    gl.uniform1f(boundary_program.uniforms.u_alpha, alpha);
    this.render(gl, fbo_pair.write, gl.TRIANGLES, 6);
    fbo_pair.swap();
  }

  step_sim(gl: WebGL2RenderingContext, dt: GLfloat) {
    // Advect velocity
    const advection_program = this.advection_program()!;
    const velocity = this.velocity()!;
    this.set_boundary(gl, this.velocity()!, -1.0);
    gl.useProgram(advection_program.program);
    gl.uniform1i(advection_program.uniforms.u_v, 0);
    gl.uniform1i(advection_program.uniforms.u_x, velocity.read.bind_tex(0));
    gl.uniform1f(advection_program.uniforms.u_dt, dt);
    gl.uniform1f(
      advection_program.uniforms.u_dissipation,
      this.config.VELOCITY_DISSIPATION
    );

    this.render(gl, velocity.write, gl.TRIANGLES, 6);
    velocity.swap();

    // Advect dye
    const dye = this.dye()!;
    this.set_boundary(gl, dye, 0);
    gl.useProgram(advection_program.program);

    gl.uniform1i(advection_program.uniforms.u_v, velocity.read.bind_tex(0));
    gl.uniform1i(advection_program.uniforms.u_x, dye.read.bind_tex(1));
    gl.uniform1f(advection_program.uniforms.u_dt, dt);
    gl.uniform1f(
      advection_program.uniforms.u_dissipation,
      this.config.DYE_DISSIPATION
    );

    this.render(gl, dye.write, gl.TRIANGLES, 6);
    dye.swap();

    // Diffuse velocity
    const jacobi_program = this.jacobi_program()!;
    this.set_boundary(gl, velocity, -1.0);
    gl.useProgram(jacobi_program.program);

    const factor = 1 / (this.config.NU * dt);
    gl.uniform1f(jacobi_program.uniforms.u_alpha, factor);
    gl.uniform1f(jacobi_program.uniforms.u_beta, factor + 4.0);
    for (let i = 0; i < 20; i++) {
      gl.uniform1i(jacobi_program.uniforms.u_x, velocity.read.bind_tex(0));
      gl.uniform1i(jacobi_program.uniforms.u_b, velocity.read.bind_tex(0));
      this.render(gl, velocity.write, gl.TRIANGLES, 6);
      velocity.swap();
    }

    // Project velocity
    // Compute divergence
    const div_program = this.div_program()!;
    const tmp_1f = this.tmp_1f()!;
    this.set_boundary(gl, velocity, -1);
    gl.useProgram(div_program.program);
    gl.uniform1i(div_program.uniforms.u_x, velocity.read.bind_tex(0));
    this.render(gl, tmp_1f, gl.TRIANGLES, 6);

    // Clear pressure
    const display_program = this.display_program()!;
    const pressure = this.pressure()!;
    gl.useProgram(display_program.program);
    gl.uniform1i(display_program.uniforms.u_x, pressure.read.bind_tex(0));
    gl.uniform1f(display_program.uniforms.u_alpha, this.config.PRESSURE);
    this.render(gl, pressure.write, gl.TRIANGLES, 6);
    pressure.swap();

    // Solve for pressure
    for (let i = 0; i < 50; i++) {
      this.set_boundary(gl, pressure, 1);

      // Jacobi iteration
      gl.useProgram(jacobi_program.program);
      gl.uniform1i(jacobi_program.uniforms.u_b, tmp_1f.bind_tex(0));
      gl.uniform1i(jacobi_program.uniforms.u_x, pressure.read.bind_tex(1));
      gl.uniform1f(jacobi_program.uniforms.u_alpha, -1.0);
      gl.uniform1f(jacobi_program.uniforms.u_beta, 4.0);
      this.render(gl, pressure.write, gl.TRIANGLES, 6);
      pressure.swap();
    }

    // Compute pressure gradient and subtract from velocity
    const subtract_grad_program = this.subtract_grad_program()!;
    this.set_boundary(gl, velocity, -1);
    this.set_boundary(gl, pressure, 1);
    gl.useProgram(subtract_grad_program.program);
    gl.uniform1i(subtract_grad_program.uniforms.u_p, pressure.read.bind_tex(0));
    gl.uniform1i(subtract_grad_program.uniforms.u_v, velocity.read.bind_tex(1));
    this.render(gl, velocity.write, gl.TRIANGLES, 6);
    velocity.swap();
  }

  loop(gl: WebGL2RenderingContext, t: number) {
    let dt = (t - this.last_time()) / 1000;
    this.last_time.set(t);

    if (this.setup_sizes()) this.setup_fbos(gl);
    this.step_user(gl);
    this.step_sim(gl, dt);
    this.render_screen(
      gl,
      this.config.DISPLAY == 'velocity'
        ? this.velocity()!.read
        : this.config.DISPLAY == 'pressure'
        ? this.pressure()!.read
        : this.dye()!.read
    );

    requestAnimationFrame((time) => this.loop(gl, time));
  }

  create_pointer(pointer: PointerEventSimple): Pointer | null {
    const canvas = this.myCanvas();
    return {
      id: pointer.pointerId,
      x: pointer.offsetX / canvas.clientWidth,
      y: 1 - pointer.offsetY / canvas.clientHeight,
      dx: 0,
      dy: 0,
      color: [Math.random(), Math.random(), Math.random()],
    };
  }

  update_pointer(old_ptr: Pointer, new_ptr: Pointer): Pointer {
    new_ptr.color = old_ptr.color;
    new_ptr.dx = new_ptr.x - old_ptr.x;
    new_ptr.dy = new_ptr.y - old_ptr.y;
    return new_ptr;
  }

  step_user(gl: WebGL2RenderingContext) {
    const splat_program = this.splat_program()!;
    const velocity = this.velocity()!;
    const aspect_ratio = this.aspect_ratio();
    const dye = this.dye()!;
    pointers.forEach((p) => {
      gl.useProgram(splat_program.program);
      gl.uniform1i(splat_program.uniforms.u_x, velocity.read.bind_tex(0));
      gl.uniform2fv(splat_program.uniforms.u_point, [p.x, p.y]);
      gl.uniform3fv(
        splat_program.uniforms.u_value,
        [p.dx * aspect_ratio, p.dy, 0].map((c) => c * this.config.SPLAT_FORCE)
      );
      gl.uniform1f(splat_program.uniforms.u_radius, this.config.RADIUS);
      gl.uniform1f(splat_program.uniforms.u_ratio, aspect_ratio);
      this.render(gl, velocity.write, gl.TRIANGLES, 6);
      velocity.swap();

      gl.uniform1i(splat_program.uniforms.u_x, dye.read.bind_tex(0));
      gl.uniform3fv(
        splat_program.uniforms.u_value,
        p.color.map((c) => c * 0.2)
      );
      this.render(gl, dye.write, gl.TRIANGLES, 6);
      dye.swap();
    });
  }
}
