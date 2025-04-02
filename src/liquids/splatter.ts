// splatter.ts
import type {
  IColor,
  IFBO,
  ITextureWrapper,
  IResolution,
  UniformMap,
  ISupportedFormat,
} from './types';
import * as shaders from './t';

// --- Cache for WebGL Resources per Canvas ---
interface CanvasGLResources {
  gl: WebGLRenderingContext | WebGL2RenderingContext;
  ext: {
    // Simplified extensions relevant here
    formatRGBA: ISupportedFormat | null;
    halfFloatTexType: number;
    supportLinearFiltering: boolean;
  };
  programs: {
    splat: WebGLProgram | null;
    copy: WebGLProgram | null;
    // Add others if needed by more complex effects
  };
  blitInitialized: boolean;
  quadVertexBuffer: WebGLBuffer | null;
  quadIndexBuffer: WebGLBuffer | null;
  // Cache base vertex shader if needed for recompilation (not needed if programs cached)
}

const glResourcesCache = new WeakMap<HTMLCanvasElement, CanvasGLResources>();

// --- Options for the Splat ---
export interface SplatOptions {
  color?: IColor; // Default: random bright color
  radius?: number; // Default: ~0.01 (in normalized coordinates)
  resolution?: number; // Resolution of the temporary FBO used for splatting
}

// --- Core Function ---

/**
 * Applies a single splat effect directly onto a canvas element.
 * Note: This does not simulate fluid dynamics, only draws the visual splat.
 * Splats do not accumulate or interact.
 *
 * @param canvas The HTMLCanvasElement to draw onto.
 * @param clickX The X coordinate of the click/touch in pixels relative to the canvas.
 * @param clickY The Y coordinate of the click/touch in pixels relative to the canvas.
 * @param options Optional parameters for the splat appearance.
 */
export function applySplatToCanvas(
  canvas: HTMLCanvasElement,
  clickX: number,
  clickY: number,
  options: SplatOptions = {}
): void {
    console.log(`applySplatToCanvas called for click at (${clickX}, ${clickY})`);
  const resources = getOrCreateGLResources(canvas);
  if (!resources) return; // Failed to get context or resources

  const { gl, ext, programs } = resources;
  if (!programs.splat || !programs.copy) {
    console.error('Splat or Copy program not compiled for this canvas.');
    return;
  }

  // --- Parameters ---
  const targetWidth = canvas.width; // Use buffer dimensions
  const targetHeight = canvas.height;
  if (targetWidth <= 0 || targetHeight <= 0) return; // Canvas not ready

  const resolution = options.resolution ?? 256; // Resolution for the temp FBO
  const radius = options.radius ?? 0.01; // Radius in normalized coords [0, 1]
  const color = options.color ?? generateRandomBrightColor();

  // Normalize click coordinates & flip Y
  const normX = clickX / targetWidth;
  const normY = 1.0 - clickY / targetHeight;

  // Calculate aspect ratio for splat correction
  const aspectRatio = targetWidth / targetHeight;

  // Determine temporary FBO resolution (match aspect ratio)
  const fboResolution = calculateResolution(
    resolution,
    targetWidth,
    targetHeight
  );

  // --- Create Temporary FBO ---
  // Use appropriate format based on context capabilities
  const texType = ext.halfFloatTexType;
  const rgbaFormat = ext.formatRGBA;
  if (!rgbaFormat) {
    console.error('Required RGBA float/half-float format not supported.');
    return;
  }
  let tempFBO: IFBO | null = null;
  try {
    // Use NEAREST filtering for temporary buffer, as it's just a drawing target
    tempFBO = {
      ...createFBO(
        gl,
        fboResolution.width,
        fboResolution.height,
        rgbaFormat.internalFormat,
        rgbaFormat.format,
        texType,
        gl.NEAREST
      ),
      width: fboResolution.width,
      height: fboResolution.height,
      texelSizeX: 1.0 / fboResolution.width,
      texelSizeY: 1.0 / fboResolution.height,
      attach: (id: number) => id, // Placeholder for attach method
    };
  } catch (e) {
    console.error('Failed to create temporary FBO for splat:', e);
    return;
  }

  // --- Draw Splat onto Temporary FBO ---
  gl.bindFramebuffer(gl.FRAMEBUFFER, tempFBO.fbo);
  gl.viewport(0, 0, tempFBO.width, tempFBO.height);
  gl.clearColor(0, 0, 0, 0); // Clear to transparent black
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(programs.splat);
  const uAspect = gl.getUniformLocation(programs.splat, 'aspectRatio');
  console.log(uAspect);
  // Set splat uniforms
  gl.uniform1f(
    gl.getUniformLocation(programs.splat, 'aspectRatio'),
    aspectRatio
  );
  gl.uniform2f(gl.getUniformLocation(programs.splat, 'point'), normX, normY);
  gl.uniform3f(
    gl.getUniformLocation(programs.splat, 'color'),
    color.r,
    color.g,
    color.b
  );
  gl.uniform1f(
    gl.getUniformLocation(programs.splat, 'radius'),
    correctSplatRadius(radius, aspectRatio)
  );
  // The splat shader reads uTarget, but we're splatting onto a clear background,
  // so we don't need to attach anything to uTarget (or attach a dummy texture).
  // For simplicity, let shader handle sampling potentially uninitialized texture (will be black).

  blit(gl, resources, null, false); // Blit the splat onto the clear FBO (target is already bound)

  // --- Draw Temporary FBO to Canvas ---
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); // Bind default framebuffer (the canvas)
  gl.viewport(0, 0, targetWidth, targetHeight); // Set viewport to canvas size

  // Enable blending to draw splat *over* existing canvas content
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); // Standard alpha blending

  gl.useProgram(programs.copy);
  gl.uniform1i(
    gl.getUniformLocation(programs.copy, 'uTexture'),
    tempFBO.attach(0)
  ); // Attach FBO texture

  blit(gl, resources, null, false); // Blit FBO texture onto canvas (don't clear)

  gl.disable(gl.BLEND); // Disable blending

  // --- Cleanup ---
  gl.bindTexture(gl.TEXTURE_2D, null); // Unbind texture
  gl.deleteTexture(tempFBO.texture);
  gl.deleteFramebuffer(tempFBO.fbo);

  // Optional: Flush GL commands if needed immediately
  // gl.flush();
}

// --- Helper Functions (Specific to this file) ---

function getOrCreateGLResources(
  canvas: HTMLCanvasElement
): CanvasGLResources | null {
  if (glResourcesCache.has(canvas)) {
    return glResourcesCache.get(canvas)!;
  }

  console.log('Initializing GL resources for canvas:', canvas);
  try {
    // 1. Get Context
    const params = {
      alpha: true,
      depth: false,
      stencil: false,
      antialias: false,
      preserveDrawingBuffer: false,
    };
    let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
    let isWebGL2 = false;
    gl = canvas.getContext('webgl2', params) as WebGL2RenderingContext | null;
    if (gl) {
      isWebGL2 = true;
    } else {
      gl = (canvas.getContext('webgl', params) ||
        canvas.getContext(
          'experimental-webgl',
          params
        )) as WebGLRenderingContext | null;
    }
    if (!gl) throw new Error('WebGL context creation failed.');

    // 2. Get Extensions / Format Info (Simplified)
    let halfFloatExt: OES_texture_half_float | null = null;
    let linearFilterExt: OES_texture_float_linear | null = null;
    if (isWebGL2) {
      (gl as WebGL2RenderingContext).getExtension('EXT_color_buffer_float');
      linearFilterExt = (gl as WebGL2RenderingContext).getExtension(
        'OES_texture_float_linear'
      );
    } else {
      halfFloatExt = gl.getExtension('OES_texture_half_float');
      linearFilterExt = gl.getExtension('OES_texture_half_float_linear');
    }
    const halfFloatType = isWebGL2
      ? (gl as WebGL2RenderingContext).HALF_FLOAT
      : halfFloatExt
      ? halfFloatExt.HALF_FLOAT_OES
      : gl.UNSIGNED_BYTE;
    const rgbaFormat = getSupportedFormatLocal(gl, isWebGL2, halfFloatType); // Check format support locally

    if (!rgbaFormat)
      throw new Error('Required RGBA float/half-float format not supported.');

    const extInfo = {
      formatRGBA: rgbaFormat,
      halfFloatTexType: halfFloatType,
      supportLinearFiltering: !!linearFilterExt,
    };

    // 3. Compile Programs
    const splatProg = compileAndLinkProgram(
      gl,
      shaders.baseVertexShaderSource,
      shaders.splatShaderSource
    );
    const copyProg = compileAndLinkProgram(
      gl,
      shaders.baseVertexShaderSource,
      shaders.copyShaderSource
    );
    if (!splatProg || !copyProg)
      throw new Error('Failed to compile/link required shaders.');

    // 4. Setup Blit Buffers
    const quadVB = gl.createBuffer();
    const quadIB = gl.createBuffer();
    if (!quadVB || !quadIB) throw new Error('Failed to create blit buffers.');
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVB);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]),
      gl.STATIC_DRAW
    );
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quadIB);
    gl.bufferData(
      gl.ELEMENT_ARRAY_BUFFER,
      new Uint16Array([0, 1, 2, 0, 2, 3]),
      gl.STATIC_DRAW
    );
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

    const resources: CanvasGLResources = {
      gl: gl,
      ext: extInfo,
      programs: {
        splat: splatProg,
        copy: copyProg,
      },
      blitInitialized: true,
      quadVertexBuffer: quadVB,
      quadIndexBuffer: quadIB,
    };

    glResourcesCache.set(canvas, resources);
    console.log('GL resources initialized and cached for canvas.');
    return resources;
  } catch (error) {
    console.error('Failed to initialize WebGL resources for canvas:', error);
    alert(
      `WebGL setup failed for this canvas: ${
        error instanceof Error ? error.message : error
      }`
    );
    return null;
  }
}

// Local shader compilation helpers to avoid dependency on webglUtils structure
function compileAndLinkProgram(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  vsSource: string,
  fsSource: string
): WebGLProgram | null {
  const vs = compileShaderLocal(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShaderLocal(gl, gl.FRAGMENT_SHADER, fsSource);
  if (!vs || !fs) return null;

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  // Link checking
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program Link Error:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }

  // Detach and delete shaders after successful link
  gl.detachShader(program, vs);
  gl.detachShader(program, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  return program;
}

function compileShaderLocal(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(
      `Shader Compile Error (type ${type}):`,
      gl.getShaderInfoLog(shader)
    );
    console.error('Shader Source:\n', source);
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

// Local format checking helper
function getSupportedFormatLocal(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  isWebGL2: boolean,
  halfFloatType: number
): ISupportedFormat | null {
  let format: ISupportedFormat | null = null;
  if (isWebGL2) {
    const gl2 = gl as WebGL2RenderingContext;
    format = checkFormat(gl2, gl2.RGBA16F, gl2.RGBA, halfFloatType);
  } else {
    // Check if half float extension exists before trying
    if (halfFloatType !== gl.UNSIGNED_BYTE) {
      format = checkFormat(gl, gl.RGBA, gl.RGBA, halfFloatType);
    }
  }
  return format;
}

function checkFormat(
  glCtx: WebGLRenderingContext | WebGL2RenderingContext,
  internalFormat: number,
  format: number,
  type: number
): ISupportedFormat | null {
  // Very basic check using a temporary texture/FBO (can be slow if called often)
  let texture: WebGLTexture | null = null,
    fbo: WebGLFramebuffer | null = null,
    status: number = 0;
  try {
    texture = glCtx.createTexture();
    if (!texture) return null;
    glCtx.bindTexture(glCtx.TEXTURE_2D, texture);
    glCtx.texImage2D(
      glCtx.TEXTURE_2D,
      0,
      internalFormat,
      1,
      1,
      0,
      format,
      type,
      null
    ); // Test 1x1
    fbo = glCtx.createFramebuffer();
    if (!fbo) return null;
    glCtx.bindFramebuffer(glCtx.FRAMEBUFFER, fbo);
    glCtx.framebufferTexture2D(
      glCtx.FRAMEBUFFER,
      glCtx.COLOR_ATTACHMENT0,
      glCtx.TEXTURE_2D,
      texture,
      0
    );
    status = glCtx.checkFramebufferStatus(glCtx.FRAMEBUFFER);
  } catch (e) {
    status = 0; /* Format likely invalid */
  } finally {
    glCtx.bindFramebuffer(glCtx.FRAMEBUFFER, null);
    if (fbo) glCtx.deleteFramebuffer(fbo);
    glCtx.bindTexture(glCtx.TEXTURE_2D, null);
    if (texture) glCtx.deleteTexture(texture);
  }
  return status === glCtx.FRAMEBUFFER_COMPLETE
    ? { internalFormat, format }
    : null;
}

// Local Blit (requires resources object)
function blit(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  resources: CanvasGLResources,
  target: WebGLFramebuffer | null,
  clear: boolean
) {
  if (
    !resources.blitInitialized ||
    !resources.quadVertexBuffer ||
    !resources.quadIndexBuffer
  ) {
    console.error('Blit resources not initialized for this canvas.');
    return;
  }
  // Target already bound outside this call
  if (clear) {
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, resources.quadVertexBuffer);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, resources.quadIndexBuffer);
  gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  gl.disableVertexAttribArray(0); // Clean up state
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
}

// Local FBO Creation (simplified, doesn't return full IFBO interface)
function createFBO(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  w: number,
  h: number,
  internalFormat: number,
  format: number,
  type: number,
  param: number
): { texture: WebGLTexture; fbo: WebGLFramebuffer } {
  const texture = gl.createTexture();
  if (!texture) throw new Error('Failed to create texture');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

  const fbo = gl.createFramebuffer();
  if (!fbo) {
    gl.deleteTexture(texture);
    throw new Error('Failed to create FBO');
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
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.deleteTexture(texture);
    throw new Error(`FBO incomplete: ${status}`);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); // Unbind
  gl.bindTexture(gl.TEXTURE_2D, null);
  return { texture, fbo };
}

// Local Utilities (copied or simplified from original simulation)
function generateRandomBrightColor(): IColor {
  // Simple random bright color generation
  const h = Math.random();
  const s = Math.random() * 0.4 + 0.6; // Saturation between 0.6 and 1.0
  const v = Math.random() * 0.3 + 0.7; // Value between 0.7 and 1.0
  return HSVtoRGB(h, s, v); // Use HSV utility if available, else implement here
}
function calculateResolution(
  baseRes: number,
  targetWidth: number,
  targetHeight: number
): IResolution {
  if (targetWidth <= 0 || targetHeight <= 0)
    return { width: baseRes, height: baseRes };
  const aspectRatio = targetWidth / targetHeight;
  let width = baseRes,
    height = baseRes;
  if (aspectRatio > 1) {
    width = Math.round(baseRes * aspectRatio);
  } else {
    height = Math.round(baseRes / aspectRatio);
  }
  return { width: Math.max(width, 1), height: Math.max(height, 1) };
}
function correctSplatRadius(radiusNorm: number, aspectRatio: number): number {
  // Correct radius for aspect ratio - this matches the original shader logic better
  // If aspect > 1 (wider), we want the radius to appear larger horizontally
  // The shader scales p.x by aspect, so we need radius pre-scaled
  // NO - the shader handles it. Just return the normalized radius.
  // The shader scales the *distance check*, not the radius uniform itself.
  // Let's try pre-correcting based on original logic idea:
  if (aspectRatio > 1) {
    return radiusNorm * aspectRatio;
  }
  // if (aspectRatio < 1) { return radiusNorm / aspectRatio; } // Scale vertically? Needs testing.
  return radiusNorm; // Keep it simple for now
}

// --- Re-add HSVtoRGB if not importing ---
function HSVtoRGB(h: number, s: number, v: number): IColor {
  let r = 0,
    g = 0,
    b = 0;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    case 5:
      r = v;
      g = p;
      b = q;
      break;
  }
  return { r, g, b };
}
