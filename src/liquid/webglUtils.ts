// webglUtils.ts
import type {
  IWebGLContext,
  IWebGLContextExtensions,
  ISupportedFormat,
  UniformMap,
  IFBO,
  IDoubleFBO,
  ITextureWrapper,
} from './types';
import * as shaders from './shaders'; // Import all shader sources

// Export gl and ext context variables to be used globally by other modules
// Note: This is simpler but less ideal than passing context explicitly.
// Ensure these are assigned *before* use by functions in this module.
export let gl: WebGLRenderingContext | WebGL2RenderingContext;
export let ext: IWebGLContextExtensions;

export function getWebGLContext(canvas: HTMLCanvasElement): IWebGLContext {
  const params = {
    alpha: true,
    depth: false,
    stencil: false,
    antialias: false,
    preserveDrawingBuffer: false,
  };
  let localGl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  let isWebGL2 = false;

  try {
    localGl = canvas.getContext(
      'webgl2',
      params
    ) as WebGL2RenderingContext | null;
    if (localGl) {
      isWebGL2 = true;
    } else {
      localGl = (canvas.getContext('webgl', params) ||
        canvas.getContext(
          'experimental-webgl',
          params
        )) as WebGLRenderingContext | null;
    }
  } catch (e) {
    console.error('Error creating WebGL context:', e);
  }

  if (!localGl) {
    alert('WebGL is not supported or failed to initialize.');
    throw new Error('WebGL not supported');
  }
  gl = localGl; // Assign to exported variable

  let halfFloat: OES_texture_half_float | null = null;
  let supportLinearFilteringExt: OES_texture_float_linear | null = null;

  if (isWebGL2) {
    const gl2 = gl as WebGL2RenderingContext;
    gl2.getExtension('EXT_color_buffer_float');
    supportLinearFilteringExt = gl2.getExtension('OES_texture_float_linear');
  } else {
    const gl1 = gl as WebGLRenderingContext;
    halfFloat = gl1.getExtension('OES_texture_half_float');
    supportLinearFilteringExt = gl1.getExtension(
      'OES_texture_half_float_linear'
    );
  }

  gl.clearColor(0.0, 0.0, 0.0, 1.0);

  const halfFloatTexType = isWebGL2
    ? (gl as WebGL2RenderingContext).HALF_FLOAT
    : halfFloat
    ? halfFloat.HALF_FLOAT_OES
    : gl.UNSIGNED_BYTE; // Fallback needed if extension missing
  let formatRGBA: ISupportedFormat | null = null;
  let formatRG: ISupportedFormat | null = null;
  let formatR: ISupportedFormat | null = null;

  if (isWebGL2) {
    const gl2 = gl as WebGL2RenderingContext;
    formatRGBA = getSupportedFormat(
      gl2,
      gl2.RGBA16F,
      gl2.RGBA,
      halfFloatTexType
    );
    formatRG = getSupportedFormat(gl2, gl2.RG16F, gl2.RG, halfFloatTexType);
    formatR = getSupportedFormat(gl2, gl2.R16F, gl2.RED, halfFloatTexType);
  } else {
    const gl1 = gl as WebGLRenderingContext;
    // WebGL1 only supports RGBA for float/half-float textures
    formatRGBA = getSupportedFormat(gl1, gl1.RGBA, gl1.RGBA, halfFloatTexType);
    formatRG = formatRGBA; // Use RGBA format as RG is not directly supported for render targets
    formatR = formatRGBA; // Use RGBA format as R is not directly supported for render targets
  }

  // Ensure formats fallback gracefully if null
  if (!formatRGBA)
    console.warn('RGBA16F/RGBA format not supported for rendering.');
  if (!formatRG && isWebGL2)
    console.warn('RG16F/RG format not supported for rendering.');
  if (!formatR && isWebGL2)
    console.warn('R16F/RED format not supported for rendering.');

  const hasLinearFiltering = !!supportLinearFilteringExt;
  if (!hasLinearFiltering) {
    console.warn(
      'Linear filtering of float/half-float textures is not supported.'
    );
  }

  // Assign to exported variable
  ext = {
    formatRGBA,
    formatRG: formatRG || formatRGBA, // Fallback for WebGL1
    formatR: formatR || formatRGBA, // Fallback for WebGL1
    halfFloatTexType,
    supportLinearFiltering: hasLinearFiltering,
  };

  return { gl, ext };
}

export function getSupportedFormat(
  glContext: WebGLRenderingContext | WebGL2RenderingContext,
  internalFormat: number,
  format: number,
  type: number
): ISupportedFormat | null {
  if (!supportRenderTextureFormat(glContext, internalFormat, format, type)) {
    if (glContext instanceof WebGL2RenderingContext) {
      const gl2 = glContext as WebGL2RenderingContext;
      switch (internalFormat) {
        case gl2.R16F:
          console.warn('R16F not supported, trying RG16F...');
          return getSupportedFormat(gl2, gl2.RG16F, gl2.RG, type);
        case gl2.RG16F:
          console.warn('RG16F not supported, trying RGBA16F...');
          return getSupportedFormat(gl2, gl2.RGBA16F, gl2.RGBA, type);
        default:
          console.warn(`Format ${internalFormat.toString(16)} not supported.`);
          return null;
      }
    } else {
      // In WebGL1, if the initial RGBA check fails for half float, it's likely not supported
      console.warn(
        `Format ${internalFormat.toString(16)} not supported in WebGL1.`
      );
      return null;
    }
  }
  return { internalFormat, format };
}

export function supportRenderTextureFormat(
  glContext: WebGLRenderingContext | WebGL2RenderingContext,
  internalFormat: number,
  format: number,
  type: number
): boolean {
  let texture: WebGLTexture | null = null;
  let fbo: WebGLFramebuffer | null = null;
  let status: number = 0;
  try {
    texture = glContext.createTexture();
    if (!texture) return false;
    glContext.bindTexture(glContext.TEXTURE_2D, texture);
    glContext.texParameteri(
      glContext.TEXTURE_2D,
      glContext.TEXTURE_MIN_FILTER,
      glContext.NEAREST
    );
    glContext.texParameteri(
      glContext.TEXTURE_2D,
      glContext.TEXTURE_MAG_FILTER,
      glContext.NEAREST
    );
    glContext.texParameteri(
      glContext.TEXTURE_2D,
      glContext.TEXTURE_WRAP_S,
      glContext.CLAMP_TO_EDGE
    );
    glContext.texParameteri(
      glContext.TEXTURE_2D,
      glContext.TEXTURE_WRAP_T,
      glContext.CLAMP_TO_EDGE
    );
    glContext.texImage2D(
      glContext.TEXTURE_2D,
      0,
      internalFormat,
      4,
      4,
      0,
      format,
      type,
      null
    );
    fbo = glContext.createFramebuffer();
    if (!fbo) return false;
    glContext.bindFramebuffer(glContext.FRAMEBUFFER, fbo);
    glContext.framebufferTexture2D(
      glContext.FRAMEBUFFER,
      glContext.COLOR_ATTACHMENT0,
      glContext.TEXTURE_2D,
      texture,
      0
    );
    status = glContext.checkFramebufferStatus(glContext.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.warn(
        `Framebuffer incomplete for format ${internalFormat.toString(
          16
        )}/${format.toString(16)}/${type.toString(
          16
        )}: Status ${status.toString(16)}`
      );
    }
  } catch (e) {
    console.error(
      `Error checking framebuffer support for format ${internalFormat.toString(
        16
      )}:`,
      e
    );
    status = 0;
  } finally {
    glContext.bindFramebuffer(glContext.FRAMEBUFFER, null); // Unbind FBO first
    if (fbo) glContext.deleteFramebuffer(fbo); // Delete FBO
    glContext.bindTexture(glContext.TEXTURE_2D, null); // Unbind texture
    if (texture) glContext.deleteTexture(texture); // Delete texture
  }
  return status === glContext.FRAMEBUFFER_COMPLETE;
}

// --- Shader / Program Compilation ---

export function compileShader(
  type: number,
  source: string,
  keywords: string[] | null
): WebGLShader | null {
  if (!gl) {
    console.error('compileShader called before WebGL context initialized.');
    return null;
  }
  source = addKeywords(source, keywords);
  const shader = gl.createShader(type);
  if (!shader) {
    console.error('Failed to create GL shader, type:', type);
    return null;
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(
      `An error occurred compiling the shaders (type ${type}): ${gl.getShaderInfoLog(
        shader
      )}`
    );
    console.log('Shader source with keywords:\n', source); // Log source with keywords on failure
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function addKeywords(source: string, keywords: string[] | null): string {
  if (keywords == null || keywords.length === 0) return source;
  let keywordsString = '';
  keywords.forEach((keyword) => {
    keywordsString += '#define ' + keyword + '\n';
  });
  return keywordsString + source;
}

export function createProgram(
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader
): WebGLProgram | null {
  if (!gl) {
    console.error('createProgram called before WebGL context initialized.');
    return null;
  }
  const program = gl.createProgram();
  if (!program) {
    console.error('Failed to create GL program.');
    return null;
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(
      'Unable to initialize the shader program: ' +
        gl.getProgramInfoLog(program)
    );
    // Detach shaders before deleting program? (Optional but good practice)
    gl.detachShader(program, vertexShader);
    gl.detachShader(program, fragmentShader);
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

export function getUniforms(program: WebGLProgram): UniformMap {
  if (!gl) return {};
  const uniforms: UniformMap = {};
  const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < uniformCount; i++) {
    const uniformInfo = gl.getActiveUniform(program, i);
    if (uniformInfo) {
      // Handle uniform arrays (e.g., "colors[0]") -> get location of "colors" or "colors[0]"
      const name = uniformInfo.name.replace(/\[\d+\]$/, ''); // Remove array index if present
      uniforms[name] = gl.getUniformLocation(program, name);
    }
  }
  return uniforms;
}

// --- Program / Material Classes ---

export class Program {
  program: WebGLProgram;
  uniforms: UniformMap;

  constructor(
    vertexShader: WebGLShader | null,
    fragmentShader: WebGLShader | null
  ) {
    if (!gl)
      throw new Error('WebGL context not available for Program creation');
    if (!vertexShader || !fragmentShader)
      throw new Error('Cannot create Program: Invalid shader provided.');
    const program = createProgram(vertexShader, fragmentShader);
    if (!program) throw new Error(`Failed to create program.`);
    this.program = program;
    this.uniforms = getUniforms(this.program);
  }
  bind(): void {
    if (gl) {
      gl.useProgram(this.program);
    }
  }
}

export class Material {
  vertexShader: WebGLShader;
  fragmentShaderSource: string;
  programs: Record<number, WebGLProgram>; // Hash -> Program
  activeProgram: WebGLProgram | null;
  uniforms: UniformMap;

  constructor(vertexShader: WebGLShader | null, fragmentShaderSource: string) {
    if (!vertexShader)
      throw new Error(
        'Cannot create Material: Invalid vertex shader provided.'
      );
    this.vertexShader = vertexShader;
    this.fragmentShaderSource = fragmentShaderSource;
    this.programs = {};
    this.activeProgram = null;
    this.uniforms = {};
  }

  // Define hashCode locally if not using utils.ts
  hashCode(s: string): number {
    if (s.length === 0) return 0;
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      const char = s.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0; // Convert to 32bit integer
    }
    return hash;
  }

  setKeywords(keywords: string[] | null): void {
    if (!gl) return;
    let hash = 0;
    if (keywords) {
      for (let i = 0; i < keywords.length; i++) {
        hash += this.hashCode(keywords[i]);
      }
    } // Need hashCode utility

    let program = this.programs[hash];
    if (program == null) {
      const fragmentShader = compileShader(
        gl.FRAGMENT_SHADER,
        this.fragmentShaderSource,
        keywords
      );
      if (!fragmentShader) {
        console.error(
          'Material: Failed to compile fragment shader with keywords:',
          keywords
        );
        return;
      }
      const newProgram = createProgram(this.vertexShader, fragmentShader);
      if (!newProgram) {
        console.error(
          'Material: Failed to link program with keywords:',
          keywords
        );
        gl.deleteShader(fragmentShader);
        return;
      }
      program = newProgram;
      this.programs[hash] = program;
    }
    if (program === this.activeProgram) return;
    this.uniforms = getUniforms(program);
    this.activeProgram = program;
  }
  bind(): void {
    if (gl && this.activeProgram) {
      gl.useProgram(this.activeProgram);
    }
  }
}

// --- Compile Shaders (Function to be called after context is ready) ---
let baseVertexShader: WebGLShader | null;
let blurVertexShader: WebGLShader | null;
let blurShader: WebGLShader | null;
let copyShader: WebGLShader | null;
let clearShader: WebGLShader | null;
let colorShader: WebGLShader | null;
let checkerboardShader: WebGLShader | null;
let bloomPrefilterShader: WebGLShader | null;
let bloomBlurShader: WebGLShader | null;
let bloomFinalShader: WebGLShader | null;
let sunraysMaskShader: WebGLShader | null;
let sunraysShader: WebGLShader | null;
let splatShader: WebGLShader | null;
let advectionShader: WebGLShader | null;
let divergenceShader: WebGLShader | null;
let curlShader: WebGLShader | null;
let vorticityShader: WebGLShader | null;
let pressureShader: WebGLShader | null;
let gradientSubtractShader: WebGLShader | null;

export function compileAllShaders() {
  if (!gl || !ext) {
    throw new Error(
      'Cannot compile shaders: WebGL context or extensions not initialized.'
    );
  }
  console.log('Compiling shaders...');
  baseVertexShader = compileShader(
    gl.VERTEX_SHADER,
    shaders.baseVertexShaderSource,
    null
  );
  blurVertexShader = compileShader(
    gl.VERTEX_SHADER,
    shaders.blurVertexShaderSource,
    null
  );
  blurShader = compileShader(
    gl.FRAGMENT_SHADER,
    shaders.blurShaderSource,
    null
  );
  copyShader = compileShader(
    gl.FRAGMENT_SHADER,
    shaders.copyShaderSource,
    null
  );
  clearShader = compileShader(
    gl.FRAGMENT_SHADER,
    shaders.clearShaderSource,
    null
  );
  colorShader = compileShader(
    gl.FRAGMENT_SHADER,
    shaders.colorShaderSource,
    null
  );
  checkerboardShader = compileShader(
    gl.FRAGMENT_SHADER,
    shaders.checkerboardShaderSource,
    null
  );
  bloomPrefilterShader = compileShader(
    gl.FRAGMENT_SHADER,
    shaders.bloomPrefilterShaderSource,
    null
  );
  bloomBlurShader = compileShader(
    gl.FRAGMENT_SHADER,
    shaders.bloomBlurShaderSource,
    null
  );
  bloomFinalShader = compileShader(
    gl.FRAGMENT_SHADER,
    shaders.bloomFinalShaderSource,
    null
  );
  sunraysMaskShader = compileShader(
    gl.FRAGMENT_SHADER,
    shaders.sunraysMaskShaderSource,
    null
  );
  sunraysShader = compileShader(
    gl.FRAGMENT_SHADER,
    shaders.sunraysShaderSource,
    null
  );
  splatShader = compileShader(
    gl.FRAGMENT_SHADER,
    shaders.splatShaderSource,
    null
  );
  advectionShader = compileShader(
    gl.FRAGMENT_SHADER,
    shaders.advectionShaderSource,
    ext.supportLinearFiltering ? null : ['MANUAL_FILTERING']
  );
  divergenceShader = compileShader(
    gl.FRAGMENT_SHADER,
    shaders.divergenceShaderSource,
    null
  );
  curlShader = compileShader(
    gl.FRAGMENT_SHADER,
    shaders.curlShaderSource,
    null
  );
  vorticityShader = compileShader(
    gl.FRAGMENT_SHADER,
    shaders.vorticityShaderSource,
    null
  );
  pressureShader = compileShader(
    gl.FRAGMENT_SHADER,
    shaders.pressureShaderSource,
    null
  );
  gradientSubtractShader = compileShader(
    gl.FRAGMENT_SHADER,
    shaders.gradientSubtractShaderSource,
    null
  );

  // Shader compilation check
  if (
    !(
      baseVertexShader &&
      blurVertexShader &&
      blurShader &&
      copyShader &&
      clearShader &&
      colorShader &&
      checkerboardShader &&
      bloomPrefilterShader &&
      bloomBlurShader &&
      bloomFinalShader &&
      sunraysMaskShader &&
      sunraysShader &&
      splatShader &&
      advectionShader &&
      divergenceShader &&
      curlShader &&
      vorticityShader &&
      pressureShader &&
      gradientSubtractShader
    )
  ) {
    throw new Error(
      'One or more shaders failed to compile. Check console logs.'
    );
  }
  console.log('Shaders compiled successfully.');
}

// --- Create Programs & Materials (Function to be called after shaders are compiled) ---
export let blurProgram: Program;
export let copyProgram: Program;
export let clearProgram: Program;
export let colorProgram: Program;
export let checkerboardProgram: Program;
export let bloomPrefilterProgram: Program;
export let bloomBlurProgram: Program;
export let bloomFinalProgram: Program;
export let sunraysMaskProgram: Program;
export let sunraysProgram: Program;
export let splatProgram: Program;
export let advectionProgram: Program;
export let divergenceProgram: Program;
export let curlProgram: Program;
export let vorticityProgram: Program;
export let pressureProgram: Program;
export let gradientSubtractProgram: Program;
export let displayMaterial: Material;

export function createProgramsAndMaterials() {
  if (!gl)
    throw new Error('Cannot create programs: WebGL context not initialized.');
  console.log('Creating programs and materials...');
  blurProgram = new Program(blurVertexShader, blurShader);
  copyProgram = new Program(baseVertexShader, copyShader);
  clearProgram = new Program(baseVertexShader, clearShader);
  colorProgram = new Program(baseVertexShader, colorShader);
  checkerboardProgram = new Program(baseVertexShader, checkerboardShader);
  bloomPrefilterProgram = new Program(baseVertexShader, bloomPrefilterShader);
  bloomBlurProgram = new Program(baseVertexShader, bloomBlurShader); // Used for multiple passes
  bloomFinalProgram = new Program(baseVertexShader, bloomFinalShader);
  sunraysMaskProgram = new Program(baseVertexShader, sunraysMaskShader);
  sunraysProgram = new Program(baseVertexShader, sunraysShader);
  splatProgram = new Program(baseVertexShader, splatShader);
  advectionProgram = new Program(baseVertexShader, advectionShader);
  divergenceProgram = new Program(baseVertexShader, divergenceShader);
  curlProgram = new Program(baseVertexShader, curlShader);
  vorticityProgram = new Program(baseVertexShader, vorticityShader);
  pressureProgram = new Program(baseVertexShader, pressureShader);
  gradientSubtractProgram = new Program(
    baseVertexShader,
    gradientSubtractShader
  );
  displayMaterial = new Material(baseVertexShader, shaders.displayShaderSource);
  console.log('Programs and materials created.');
}

// --- Blit Function ---
let quadVertexBuffer: WebGLBuffer | null = null;
let quadIndexBuffer: WebGLBuffer | null = null;
let blitInitialized = false;

function initBlit(): void {
  if (!gl) throw new Error('WebGL context lost before initializing blit');
  if (blitInitialized) return;

  quadVertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVertexBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]),
    gl.STATIC_DRAW
  );

  quadIndexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quadIndexBuffer);
  gl.bufferData(
    gl.ELEMENT_ARRAY_BUFFER,
    new Uint16Array([0, 1, 2, 0, 2, 3]),
    gl.STATIC_DRAW
  );

  // Assuming vertex attribute location 0 is used for aPosition in shaders
  // This attribute setup should ideally be done once per program bind or using VAOs if available (WebGL2)
  // For simplicity here, we set it up once. Ensure it doesn't conflict.
  // gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); // Setup might need to move inside blit or be managed per program
  // gl.enableVertexAttribArray(0);

  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  // Keep ELEMENT_ARRAY_BUFFER bound? Usually fine.
  blitInitialized = true;
}

export const blit = (
  target: IFBO | WebGLFramebuffer | null,
  clear: boolean = false
): void => {
  if (!gl) return;
  if (!blitInitialized) initBlit(); // Initialize buffers on first call

  if (target == null) {
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  } else if ('fbo' in target) {
    // Check if it's our IFBO interface
    gl.viewport(0, 0, target.width, target.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
  } else {
    // Assume it's a raw WebGLFramebuffer
    console.warn(
      'Blitting to raw WebGLFramebuffer without width/height information for viewport.'
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    // Cannot set viewport correctly without dimensions
  }

  if (clear) {
    gl.clearColor(0.0, 0.0, 0.0, 1.0); // Or use config background?
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  // --- Setup vertex attributes for blit quad ---
  // This part is crucial and needs to happen before drawing.
  // Using vertex attribute location 0 for `aPosition`.
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVertexBuffer);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quadIndexBuffer);

  // Draw the quad
  gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

  // Clean up state (optional, good practice)
  gl.disableVertexAttribArray(0);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
};

// --- FBO Utilities ---

export function createFBO(
  w: number,
  h: number,
  internalFormat: number,
  format: number,
  type: number,
  param: number
): IFBO {
  if (!gl) throw new Error('WebGL context lost before creating FBO');

  gl.activeTexture(gl.TEXTURE0);
  const texture = gl.createTexture();
  if (!texture) throw new Error('Failed to create WebGL texture');

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  try {
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      internalFormat,
      w,
      h,
      0,
      format,
      type,
      null
    );
  } catch (e) {
    console.error(
      `texImage2D failed for FBO: ${w}x${h}, internalFormat=${internalFormat.toString(
        16
      )}, format=${format.toString(16)}, type=${type.toString(16)}`,
      e
    );
    gl.deleteTexture(texture);
    throw e; // Rethrow error
  }

  const fbo = gl.createFramebuffer();
  if (!fbo) {
    gl.deleteTexture(texture);
    throw new Error('Failed to create WebGL framebuffer');
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0
  );

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    console.error(
      `Framebuffer incomplete: Status ${status.toString(
        16
      )} for format ${internalFormat.toString(16)}`
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.deleteTexture(texture);
    throw new Error('Framebuffer incomplete: ' + status.toString(16));
  }

  // Don't clear here, let the caller decide if/when to clear
  // gl.viewport(0, 0, w, h);
  // gl.clearColor(0.0, 0.0, 0.0, 0.0);
  // gl.clear(gl.COLOR_BUFFER_BIT);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null); // Unbind FBO after setup
  gl.bindTexture(gl.TEXTURE_2D, null); // Unbind texture

  const texelSizeX = 1.0 / w;
  const texelSizeY = 1.0 / h;

  return {
    texture,
    fbo,
    width: w,
    height: h,
    texelSizeX,
    texelSizeY,
    attach(id: number): number {
      if (!gl) return 0;
      gl.activeTexture(gl.TEXTURE0 + id);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      return id;
    },
  };
}

export function createDoubleFBO(
  w: number,
  h: number,
  internalFormat: number,
  format: number,
  type: number,
  param: number
): IDoubleFBO {
  let fbo1 = createFBO(w, h, internalFormat, format, type, param);
  let fbo2 = createFBO(w, h, internalFormat, format, type, param);

  return {
    width: w,
    height: h,
    texelSizeX: fbo1.texelSizeX,
    texelSizeY: fbo1.texelSizeY,
    _fbo1: fbo1,
    _fbo2: fbo2, // Internal references
    get read(): IFBO {
      return this._fbo1;
    },
    get write(): IFBO {
      return this._fbo2;
    },
    swap(): void {
      const temp = this._fbo1;
      this._fbo1 = this._fbo2;
      this._fbo2 = temp;
    },
  };
}

// Resizes FBO by creating a new one and copying, updates the passed object's properties
export function resizeFBO(
  target: IFBO,
  w: number,
  h: number,
  internalFormat: number,
  format: number,
  type: number,
  param: number
): IFBO {
  if (!gl) throw new Error('WebGL context lost before resizing FBO');
  if (target.width === w && target.height === h) return target;

  const newFBO = createFBO(w, h, internalFormat, format, type, param);

  // Copy contents
  copyProgram.bind();
  gl.uniform1i(copyProgram.uniforms['uTexture']!, target.attach(0));
  blit(newFBO, true); // Blit to the new FBO, clearing it first

  // Clean up old resources
  if (target.texture) gl.deleteTexture(target.texture);
  if (target.fbo) gl.deleteFramebuffer(target.fbo);

  // Update target object IN PLACE
  target.texture = newFBO.texture;
  target.fbo = newFBO.fbo;
  target.width = newFBO.width;
  target.height = newFBO.height;
  target.texelSizeX = newFBO.texelSizeX;
  target.texelSizeY = newFBO.texelSizeY;

  return target;
}

// Resizes Double FBO by resizing/replacing internal FBOs, returns the same object instance modified
export function resizeDoubleFBO(
  target: IDoubleFBO,
  w: number,
  h: number,
  internalFormat: number,
  format: number,
  type: number,
  param: number
): IDoubleFBO {
  if (target.width === w && target.height === h) return target;

  // Resize the current 'read' FBO (which preserves its contents)
  // This modifies target._fbo1 in place
  resizeFBO(target._fbo1, w, h, internalFormat, format, type, param);

  // Create a completely new 'write' FBO
  const newWrite = createFBO(w, h, internalFormat, format, type, param);

  // Clean up the old 'write' FBO's resources
  if (gl) {
    if (target._fbo2.texture) gl.deleteTexture(target._fbo2.texture);
    if (target._fbo2.fbo) gl.deleteFramebuffer(target._fbo2.fbo);
  }

  // Replace the old write FBO with the new one
  target._fbo2 = newWrite;

  // Update dimensions on the DoubleFBO object itself
  target.width = w;
  target.height = h;
  target.texelSizeX = 1.0 / w;
  target.texelSizeY = 1.0 / h;

  return target; // Return the modified target object
}

// Helper to resize or create single FBO, returns the potentially new FBO object
export function resizeOrCreateFBO(
  fbo: IFBO | null,
  w: number,
  h: number,
  internalFormat: number,
  format: number,
  type: number,
  param: number
): IFBO {
  if (fbo && fbo.width === w && fbo.height === h) {
    return fbo; // No change needed
  }
  // If exists but size differs, resize it IN PLACE
  if (fbo) {
    return resizeFBO(fbo, w, h, internalFormat, format, type, param);
  }
  // If it doesn't exist, create it
  return createFBO(w, h, internalFormat, format, type, param);
}

// --- Texture Loading ---

export function createTextureAsync(url: string): ITextureWrapper | null {
  if (!gl) {
    console.error('WebGL context not available for texture creation');
    return null;
  }
  const texture = gl.createTexture();
  if (!texture) {
    console.error('Failed to create WebGL texture object.');
    return null;
  }

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGB,
    1,
    1,
    0,
    gl.RGB,
    gl.UNSIGNED_BYTE,
    new Uint8Array([200, 200, 200])
  ); // Grey placeholder
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

  const obj: ITextureWrapper = {
    texture,
    width: 1,
    height: 1,
    attach(id: number): number {
      if (!gl) return 0;
      gl.activeTexture(gl.TEXTURE0 + id);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      return id;
    },
  };

  const image = new Image();
  image.onload = () => {
    obj.width = image.width;
    obj.height = image.height;
    if (!gl) return; // Check context again
    gl.bindTexture(gl.TEXTURE_2D, texture);
    try {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // Often needed for web images
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); // Reset store parameter
      // Check if mipmaps are needed based on filter parameter
      const minFilter = gl.getTexParameter(
        gl.TEXTURE_2D,
        gl.TEXTURE_MIN_FILTER
      );
      if (
        minFilter === gl.LINEAR_MIPMAP_LINEAR ||
        minFilter === gl.LINEAR_MIPMAP_NEAREST ||
        minFilter === gl.NEAREST_MIPMAP_LINEAR ||
        minFilter === gl.NEAREST_MIPMAP_NEAREST
      ) {
        gl.generateMipmap(gl.TEXTURE_2D);
      }
    } catch (e) {
      console.error('Error uploading texture image:', url, e);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
  };
  image.onerror = (err) => {
    console.error('Failed to load texture image:', url, err);
    gl.bindTexture(gl.TEXTURE_2D, null);
  };
  image.src = url;

  return obj;
}

// hashCode utility - keep here or move to utils.ts
// function hashCode(s: string): number {
//     if (s.length === 0) return 0;
//     let hash = 0;
//     for (let i = 0; i < s.length; i++) {
//         const char = s.charCodeAt(i);
//         hash = ((hash << 5) - hash) + char;
//         hash |= 0; // Convert to 32bit integer
//     }
//     return hash;
// }
