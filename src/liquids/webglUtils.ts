// webglUtils.ts
import type {
    IWebGLContext, IWebGLContextExtensions, ISupportedFormat, UniformMap,
    IFBO, IDoubleFBO, ITextureWrapper
} from './types';
// Import shader sources from the separate file
import * as shaders from './t';

// --- Exported Context Variables (Initialized by getWebGLContext) ---
export let gl: WebGLRenderingContext | WebGL2RenderingContext;
export let ext: IWebGLContextExtensions;

// --- Context Initialization ---
export function getWebGLContext(canvas: HTMLCanvasElement): IWebGLContext {
    const params = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false };
    let localGl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
    let isWebGL2 = false;

    try {
        localGl = canvas.getContext('webgl2', params) as WebGL2RenderingContext | null;
        if (localGl) {
            isWebGL2 = true;
        } else {
            localGl = (canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params)) as WebGLRenderingContext | null;
        }
    } catch (e) {
        console.error("Error creating WebGL context:", e);
    }

    if (!localGl) {
        alert('WebGL is not supported or failed to initialize. Please use a modern browser.');
        throw new Error('WebGL not supported');
    }
    gl = localGl; // Assign to exported global

    let halfFloat: OES_texture_half_float | null = null;
    let supportLinearFilteringExt: OES_texture_float_linear | null = null;

    if (isWebGL2) {
        const gl2 = gl as WebGL2RenderingContext;
        // Request extensions - check if they are actually returned
        gl2.getExtension('EXT_color_buffer_float'); // Required for rendering to float textures
        supportLinearFilteringExt = gl2.getExtension('OES_texture_float_linear'); // For linear filtering float textures
    } else {
        const gl1 = gl as WebGLRenderingContext;
        halfFloat = gl1.getExtension('OES_texture_half_float'); // Required for HALF_FLOAT type
        if (!halfFloat) console.warn("OES_texture_half_float extension not supported.");
        supportLinearFilteringExt = gl1.getExtension('OES_texture_half_float_linear'); // For linear filtering half_float
    }

    gl.clearColor(0.0, 0.0, 0.0, 1.0);

    // Determine HALF_FLOAT type safely
    const halfFloatTexType = isWebGL2
        ? (gl as WebGL2RenderingContext).HALF_FLOAT
        : (halfFloat ? halfFloat.HALF_FLOAT_OES : gl.UNSIGNED_BYTE); // Fallback, though simulation might fail

    if (halfFloatTexType === gl.UNSIGNED_BYTE && !isWebGL2) {
        console.warn("Half float texture type not supported, simulation quality will be reduced or might fail.");
    }

    // Check supported render texture formats
    let formatRGBA: ISupportedFormat | null = null;
    let formatRG: ISupportedFormat | null = null;
    let formatR: ISupportedFormat | null = null;

    if (isWebGL2) {
        const gl2 = gl as WebGL2RenderingContext;
        formatRGBA = getSupportedFormat(gl2, gl2.RGBA16F, gl2.RGBA, halfFloatTexType);
        formatRG = getSupportedFormat(gl2, gl2.RG16F, gl2.RG, halfFloatTexType);
        formatR = getSupportedFormat(gl2, gl2.R16F, gl2.RED, halfFloatTexType);
    } else {
        const gl1 = gl as WebGLRenderingContext;
        // WebGL1 requires OES_texture_half_float for createTexture with HALF_FLOAT_OES
        if (halfFloat) {
            formatRGBA = getSupportedFormat(gl1, gl1.RGBA, gl1.RGBA, halfFloatTexType);
        }
        // WebGL1 doesn't natively support RG/R formats for rendering
        formatRG = formatRGBA; // Use RGBA as fallback
        formatR = formatRGBA;  // Use RGBA as fallback
    }

    // Log support status
    if (!formatRGBA) console.error("Rendering to RGBA float/half-float textures is not supported!");
    if (!formatRG && isWebGL2) console.warn("Rendering to RG float/half-float textures is not supported (WebGL2).");
    if (!formatR && isWebGL2) console.warn("Rendering to R float/half-float textures is not supported (WebGL2).");

    const hasLinearFiltering = !!supportLinearFilteringExt;
    if (!hasLinearFiltering) {
        console.warn("Linear filtering of float/half-float textures is not supported.");
    }

    // Assign to exported global
    ext = {
        formatRGBA,
        formatRG: formatRG || formatRGBA, // Ensure fallback for RG/R if null
        formatR: formatR || formatRGBA,
        halfFloatTexType,
        supportLinearFiltering: hasLinearFiltering
    };

    // Check for critical failures
    if (!formatRGBA) {
         throw new Error("Float/Half-float RGBA textures not supported, cannot run simulation.");
    }

    return { gl, ext };
}

function getSupportedFormat(glContext: WebGLRenderingContext | WebGL2RenderingContext, internalFormat: number, format: number, type: number): ISupportedFormat | null {
     if (!supportRenderTextureFormat(glContext, internalFormat, format, type)) {
         // If failed, try fallbacks (WebGL2 only for specific formats)
         if (glContext instanceof WebGL2RenderingContext) {
             const gl2 = glContext;
              switch (internalFormat) {
                 case gl2.R16F:
                     console.warn("R16F format unsupported, trying RG16F...");
                     return getSupportedFormat(gl2, gl2.RG16F, gl2.RG, type);
                 case gl2.RG16F:
                     console.warn("RG16F format unsupported, trying RGBA16F...");
                     return getSupportedFormat(gl2, gl2.RGBA16F, gl2.RGBA, type);
                 default:
                     console.warn(`Format ${internalFormat.toString(16)} unsupported.`);
                     return null; // No fallback for RGBA16F or others
             }
         } else {
              // In WebGL1, RGBA is the primary target, if it fails initially, no fallback.
              console.warn(`Format ${internalFormat.toString(16)} unsupported (WebGL1).`);
              return null;
         }
     }
     // Supported!
     console.log(`Format ${internalFormat.toString(16)} / ${format.toString(16)} / ${type.toString(16)} is supported.`);
     return { internalFormat, format };
}

function supportRenderTextureFormat(glContext: WebGLRenderingContext | WebGL2RenderingContext, internalFormat: number, format: number, type: number): boolean {
    let texture: WebGLTexture | null = null;
    let fbo: WebGLFramebuffer | null = null;
    let status: number = 0;
    try {
        texture = glContext.createTexture(); if (!texture) return false;
        glContext.bindTexture(glContext.TEXTURE_2D, texture);
        glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_MIN_FILTER, glContext.NEAREST);
        glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_MAG_FILTER, glContext.NEAREST);
        glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_WRAP_S, glContext.CLAMP_TO_EDGE);
        glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_WRAP_T, glContext.CLAMP_TO_EDGE);
        // Test with a small texture
        glContext.texImage2D(glContext.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);

        fbo = glContext.createFramebuffer(); if (!fbo) return false;
        glContext.bindFramebuffer(glContext.FRAMEBUFFER, fbo);
        glContext.framebufferTexture2D(glContext.FRAMEBUFFER, glContext.COLOR_ATTACHMENT0, glContext.TEXTURE_2D, texture, 0);

        status = glContext.checkFramebufferStatus(glContext.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
             // Log detailed error only if it fails
             console.warn(`Framebuffer incomplete for format ${internalFormat.toString(16)}/${format.toString(16)}/${type.toString(16)}: Status ${status.toString(16)}`);
        }
    } catch(e) {
        // Catch errors during texImage2D (e.g., invalid format combination)
        console.error(`Error testing format ${internalFormat.toString(16)}/${format.toString(16)}/${type.toString(16)}:`, e);
        status = 0; // Ensure failure is reported
    } finally {
        // Ensure cleanup happens
        glContext.bindFramebuffer(glContext.FRAMEBUFFER, null);
        if (fbo) glContext.deleteFramebuffer(fbo);
        glContext.bindTexture(glContext.TEXTURE_2D, null);
        if (texture) glContext.deleteTexture(texture);
    }
    return status === glContext.FRAMEBUFFER_COMPLETE;
}


// --- Shader/Program Compilation ---
export function compileShader(type: number, source: string, keywords: string[] | null): WebGLShader | null {
    if (!gl) { console.error("compileShader called before WebGL context initialized."); return null; }
    source = addKeywords(source, keywords);
    const shader = gl.createShader(type);
    if (!shader) { console.error("Failed to create GL shader object, type:", type); return null; }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(`SHADER COMPILE ERROR (type ${type}): ${gl.getShaderInfoLog(shader)}`);
        console.error('Shader Source:\n', source); // Log source on failure
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function addKeywords(source: string, keywords: string[] | null): string {
    if (keywords == null || keywords.length === 0) return source;
    let keywordsString = '';
    keywords.forEach(keyword => { keywordsString += '#define ' + keyword + '\n'; });
    return keywordsString + source;
}

export function createProgram(vertexShader: WebGLShader, fragmentShader: WebGLShader): WebGLProgram | null {
     if (!gl) { console.error("createProgram called before WebGL context initialized."); return null; }
    const program = gl.createProgram();
    if (!program) { console.error("Failed to create GL program object."); return null; }
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    // Optional: Bind attribute locations before linking (good practice if locations matter)
    // gl.bindAttribLocation(program, 0, 'aPosition'); // Assuming location 0 for position
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('PROGRAM LINK ERROR: ' + gl.getProgramInfoLog(program));
        gl.detachShader(program, vertexShader); // Clean up detach
        gl.detachShader(program, fragmentShader);
        gl.deleteProgram(program);
        return null;
    }
    // Optional: Validate program (useful for debugging)
    // gl.validateProgram(program);
    // if (!gl.getProgramParameter(program, gl.VALIDATE_STATUS)) {
    //     console.error('PROGRAM VALIDATE ERROR: ' + gl.getProgramInfoLog(program));
    // }
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

// --- Simple Program Wrapper ---
export class GlProgram {
    program: WebGLProgram;
    uniforms: UniformMap;
    constructor(vertexSource: string, fragmentSource: string, keywords: string[] | null = null) {
        if (!gl) throw new Error("Cannot create GlProgram: WebGL context missing.");
        const vs = compileShader(gl.VERTEX_SHADER, vertexSource, null); // No keywords for VS usually
        const fs = compileShader(gl.FRAGMENT_SHADER, fragmentSource, keywords);
        if (!vs || !fs) throw new Error(`Shader compilation failed for program using FS keywords: ${keywords}`);
        const prog = createProgram(vs, fs);
        if (!prog) throw new Error(`Program linking failed for program using FS keywords: ${keywords}`);
        // Shaders can be deleted after linking as they are attached to the program
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        this.program = prog;
        this.uniforms = getUniforms(this.program);
    }
    bind() { if (gl) gl.useProgram(this.program); }
}

// --- Compile & Export Programs (Called once after GL context ready) ---
export let blurProgram: GlProgram;
export let copyProgram: GlProgram;
export let clearProgram: GlProgram;
export let colorProgram: GlProgram;
export let checkerboardProgram: GlProgram;
export let bloomPrefilterProgram: GlProgram;
export let bloomBlurProgram: GlProgram;
export let bloomFinalProgram: GlProgram;
export let sunraysMaskProgram: GlProgram;
export let sunraysProgram: GlProgram;
export let splatProgram: GlProgram;
export let advectionProgram: GlProgram;
export let divergenceProgram: GlProgram;
export let curlProgram: GlProgram;
export let vorticityProgram: GlProgram;
export let pressureProgram: GlProgram;
export let gradientSubtractProgram: GlProgram;
// Note: Display program is handled manually in fluidSimulation.ts

export function compilePrograms() {
    if (!gl || !ext) throw new Error("Cannot compile programs: Context missing.");
    console.log("Compiling programs...");
    try {
        blurProgram = new GlProgram(shaders.blurVertexShaderSource, shaders.blurShaderSource);
        copyProgram = new GlProgram(shaders.baseVertexShaderSource, shaders.copyShaderSource);
        clearProgram = new GlProgram(shaders.baseVertexShaderSource, shaders.clearShaderSource);
        colorProgram = new GlProgram(shaders.baseVertexShaderSource, shaders.colorShaderSource);
        checkerboardProgram = new GlProgram(shaders.baseVertexShaderSource, shaders.checkerboardShaderSource);
        bloomPrefilterProgram = new GlProgram(shaders.baseVertexShaderSource, shaders.bloomPrefilterShaderSource);
        bloomBlurProgram = new GlProgram(shaders.baseVertexShaderSource, shaders.bloomBlurShaderSource);
        bloomFinalProgram = new GlProgram(shaders.baseVertexShaderSource, shaders.bloomFinalShaderSource);
        sunraysMaskProgram = new GlProgram(shaders.baseVertexShaderSource, shaders.sunraysMaskShaderSource);
        sunraysProgram = new GlProgram(shaders.baseVertexShaderSource, shaders.sunraysShaderSource);
        splatProgram = new GlProgram(shaders.baseVertexShaderSource, shaders.splatShaderSource);
        advectionProgram = new GlProgram(shaders.baseVertexShaderSource, shaders.advectionShaderSource, ext.supportLinearFiltering ? null : ['MANUAL_FILTERING']);
        divergenceProgram = new GlProgram(shaders.baseVertexShaderSource, shaders.divergenceShaderSource);
        curlProgram = new GlProgram(shaders.baseVertexShaderSource, shaders.curlShaderSource);
        vorticityProgram = new GlProgram(shaders.baseVertexShaderSource, shaders.vorticityShaderSource);
        pressureProgram = new GlProgram(shaders.baseVertexShaderSource, shaders.pressureShaderSource);
        gradientSubtractProgram = new GlProgram(shaders.baseVertexShaderSource, shaders.gradientSubtractShaderSource);
        console.log("Programs compiled successfully.");
    } catch (error) {
         console.error("Error during program compilation:", error);
         throw error; // Re-throw to halt initialization
    }
}

// --- Blit Function ---
let quadVertexBuffer: WebGLBuffer | null = null;
let quadIndexBuffer: WebGLBuffer | null = null;
let blitInitialized = false;

function initBlit(): void {
    if (!gl) throw new Error("WebGL context lost before initializing blit");
    if (blitInitialized) return;

    quadVertexBuffer = gl.createBuffer();
    if (!quadVertexBuffer) throw new Error("Failed to create blit vertex buffer");
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);

    quadIndexBuffer = gl.createBuffer();
    if (!quadIndexBuffer) throw new Error("Failed to create blit index buffer");
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quadIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, null); // Unbind after setup
    blitInitialized = true;
    console.log("Blit function initialized.");
}

export const blit = (target: IFBO | WebGLFramebuffer | null, clear: boolean = false): void => {
    if (!gl) return;
    if (!blitInitialized) initBlit(); // Ensure initialized

    // Set target framebuffer and viewport
    if (target == null) {
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else if ('fbo' in target) { // Check if it's our IFBO interface
        gl.viewport(0, 0, target.width, target.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    } else { // Assume it's a raw WebGLFramebuffer
         console.warn("Blitting to raw WebGLFramebuffer without width/height information for viewport.");
         gl.bindFramebuffer(gl.FRAMEBUFFER, target);
         // Cannot set viewport correctly without dimensions
    }

    // Clear if requested
    if (clear) {
        // TODO: Consider if alpha should be cleared to 0 or 1 depending on use case
        gl.clearColor(0.0, 0.0, 0.0, 0.0); // Clear to transparent black
        gl.clear(gl.COLOR_BUFFER_BIT);
    }

    // Bind geometry and setup attributes for drawing the quad
    // Assuming vertex attribute location 0 is 'aPosition'
    if (!quadVertexBuffer || !quadIndexBuffer) {
         console.error("Blit buffers not initialized!"); return;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVertexBuffer);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); // Location 0, 2 components, type FLOAT
    gl.enableVertexAttribArray(0); // Enable attribute location 0
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quadIndexBuffer);

    // Draw the quad
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0); // 6 indices, type UNSIGNED_SHORT

    // Clean up state (disable attribute array) - good practice
    gl.disableVertexAttribArray(0);
    gl.bindBuffer(gl.ARRAY_BUFFER, null); // Unbind buffers (optional)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
};


// --- FBO / Texture Utilities ---
export function createFBO(w: number, h: number, internalFormat: number, format: number, type: number, param: number): IFBO {
    if (!gl) throw new Error("WebGL context lost before creating FBO");

    gl.activeTexture(gl.TEXTURE0); // Work on texture unit 0 temporarily
    const texture = gl.createTexture();
    if (!texture) throw new Error("Failed to create WebGL texture");

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    try {
        // Ensure width/height are valid
        if (w <= 0 || h <= 0) throw new Error(`Invalid dimensions for FBO texture: ${w}x${h}`);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
    } catch (e) {
         console.error(`texImage2D failed for FBO: ${w}x${h}, internalFormat=${internalFormat.toString(16)}, format=${format.toString(16)}, type=${type.toString(16)}`, e);
         gl.deleteTexture(texture);
         throw e; // Rethrow error after logging
    }

    const fbo = gl.createFramebuffer();
    if (!fbo) { gl.deleteTexture(texture); throw new Error("Failed to create WebGL framebuffer"); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    // Check FBO status *before* continuing
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        const statusString = getFramebufferStatusString(status);
        console.error(`Framebuffer incomplete: Status ${status.toString(16)} (${statusString}) for format ${internalFormat.toString(16)}`);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fbo);
        gl.bindTexture(gl.TEXTURE_2D, null); gl.deleteTexture(texture);
        throw new Error(`Framebuffer incomplete: ${statusString} (${status.toString(16)})`);
    }

    // Unbind FBO and texture after setup (good practice)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);

    const texelSizeX = 1.0 / w;
    const texelSizeY = 1.0 / h;

    return {
        texture, fbo, width: w, height: h, texelSizeX, texelSizeY,
        attach(id: number): number {
            if (!gl) return 0; // Should not happen if FBO exists
            gl.activeTexture(gl.TEXTURE0 + id);
            gl.bindTexture(gl.TEXTURE_2D, this.texture); // Use 'this' to access texture
            return id; // Return the texture unit ID
        }
    };
}

// Helper to get human-readable FBO status string
function getFramebufferStatusString(status: number): string {
    if (!gl) return "Unknown (No GL context)";
    switch (status) {
        case gl.FRAMEBUFFER_COMPLETE: return "FRAMEBUFFER_COMPLETE";
        case gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT: return "FRAMEBUFFER_INCOMPLETE_ATTACHMENT";
        case gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT: return "FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT";
        case gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS: return "FRAMEBUFFER_INCOMPLETE_DIMENSIONS";
        case gl.FRAMEBUFFER_UNSUPPORTED: return "FRAMEBUFFER_UNSUPPORTED";
        default:
            if (gl instanceof WebGL2RenderingContext) {
                const gl2 = gl as WebGL2RenderingContext;
                if (status === gl2.FRAMEBUFFER_INCOMPLETE_MULTISAMPLE) return "FRAMEBUFFER_INCOMPLETE_MULTISAMPLE (WebGL2)";
            }
            return `Unknown status ${status.toString(16)}`;
    }
}


export function createDoubleFBO(w: number, h: number, internalFormat: number, format: number, type: number, param: number): IDoubleFBO {
    let fbo1 = createFBO(w, h, internalFormat, format, type, param);
    let fbo2 = createFBO(w, h, internalFormat, format, type, param);

    // Return object implementing the IDoubleFBO interface
    return {
        width: w, height: h,
        texelSizeX: fbo1.texelSizeX, texelSizeY: fbo1.texelSizeY,
        _fbo1: fbo1, _fbo2: fbo2, // Internal references for swapping/resizing
        get read(): IFBO { return this._fbo1; },
        get write(): IFBO { return this._fbo2; },
        swap(): void {
            const temp = this._fbo1;
            this._fbo1 = this._fbo2;
            this._fbo2 = temp;
        }
    };
}

export function resizeFBO(target: IFBO, w: number, h: number, internalFormat: number, format: number, type: number, param: number): IFBO {
    if (!gl) throw new Error("WebGL context lost before resizing FBO");
    if (target.width === w && target.height === h) return target; // No resize needed

    // Create a *new* FBO with the desired size
    const newFBO = createFBO(w, h, internalFormat, format, type, param);

    // Copy contents from the old FBO to the new one using the copy program
    copyProgram.bind(); // Ensure copy program is bound
    gl.uniform1i(copyProgram.uniforms['uTexture']!, target.attach(0)); // Attach old texture
    blit(newFBO, true); // Blit to the new FBO, clearing it first is safest

    // Clean up the old FBO's resources *after* copying
    if (target.texture) gl.deleteTexture(target.texture);
    if (target.fbo) gl.deleteFramebuffer(target.fbo);

    // Update the target object's properties IN PLACE
    target.texture = newFBO.texture;
    target.fbo = newFBO.fbo;
    target.width = newFBO.width;
    target.height = newFBO.height;
    target.texelSizeX = newFBO.texelSizeX;
    target.texelSizeY = newFBO.texelSizeY;

    return target; // Return the modified target object
}

export function resizeDoubleFBO(target: IDoubleFBO, w: number, h: number, internalFormat: number, format: number, type: number, param: number): IDoubleFBO {
    if (target.width === w && target.height === h) return target; // No resize needed

    // Resize the current 'read' FBO (modifies target._fbo1 in place)
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

// Helper to resize or create single FBO, returns the (potentially new) IFBO object
export function resizeOrCreateFBO(fbo: IFBO | null, w: number, h: number, internalFormat: number, format: number, type: number, param: number): IFBO {
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


export function createTextureAsync(url: string): ITextureWrapper | null {
     if (!gl) { console.error("WebGL context not available for texture creation"); return null; }
    const texture = gl.createTexture();
     if (!texture) { console.error("Failed to create WebGL texture object."); return null; }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    // Set placeholder texture (e.g., 1x1 grey pixel)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128]));
    // Set parameters needed before image loads (can be updated later)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); // Use linear filtering
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); // Repeat wrapping common for dithering
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.bindTexture(gl.TEXTURE_2D, null); // Unbind placeholder

    const obj: ITextureWrapper = {
        texture,
        width: 1,
        height: 1,
        attach(id: number): number {
            if (!gl) return 0;
            gl.activeTexture(gl.TEXTURE0 + id);
            gl.bindTexture(gl.TEXTURE_2D, this.texture);
            return id;
        }
    };

    const image = new Image();
    image.onload = () => {
        obj.width = image.width;
        obj.height = image.height;
        if (!gl) return; // Check context again in async callback
        gl.bindTexture(gl.TEXTURE_2D, obj.texture); // Bind the correct texture object
        try {
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // Flip Y for web images
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image); // Upload image
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); // Reset pixel store state

            // Check if mipmaps are needed based on filter parameter set earlier
            const minFilter = gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER);
            if (minFilter === gl.LINEAR_MIPMAP_LINEAR || minFilter === gl.LINEAR_MIPMAP_NEAREST ||
                minFilter === gl.NEAREST_MIPMAP_LINEAR || minFilter === gl.NEAREST_MIPMAP_NEAREST) {
                console.log("Generating mipmaps for texture:", url);
                gl.generateMipmap(gl.TEXTURE_2D);
            }
             console.log("Texture loaded successfully:", url);
        } catch (e) {
             console.error("Error uploading texture image data:", url, e);
             // Keep the placeholder texture if upload fails
        }
        gl.bindTexture(gl.TEXTURE_2D, null); // Unbind after loading/mipmapping
    };
    image.onerror = (err) => {
        console.error("Failed to load texture image file:", url, err);
        // Keep the placeholder texture
         gl.bindTexture(gl.TEXTURE_2D, null); // Unbind even on error
    };
    image.src = url; // Start loading the image

    return obj;
}