// fluidSimulation.ts
import type {
    IConfig, IColor, IPointer, IFBO, IDoubleFBO, IResolution, ITextureScale, ITextureWrapper, UniformMap
} from './types';
import {
    gl, ext, createDoubleFBO, resizeDoubleFBO, resizeOrCreateFBO, createFBO, createTextureAsync,
    blit, GlProgram, // Import GlProgram wrapper
    // Import compiled programs:
    copyProgram, clearProgram, colorProgram, checkerboardProgram,
    bloomPrefilterProgram, bloomBlurProgram, bloomFinalProgram,
    sunraysMaskProgram, sunraysProgram, blurProgram, splatProgram,
    advectionProgram, divergenceProgram, curlProgram, vorticityProgram,
    pressureProgram, gradientSubtractProgram
    // Note: Display program is handled manually below
} from './webglUtils';
// Import shader source only needed for the dynamically compiled display shader
import { baseVertexShaderSource, displayShaderSource } from './t';
// Need compileShader, createProgram, getUniforms for manual display program handling
import { compileShader, createProgram, getUniforms } from './webglUtils';


// --- Configuration ---
export const config: IConfig = {
    SIM_RESOLUTION: 128,
    DYE_RESOLUTION: 1024,
    CAPTURE_RESOLUTION: 512,
    DENSITY_DISSIPATION: 1.0, // Ensure float
    VELOCITY_DISSIPATION: 0.2,
    PRESSURE: 0.8,
    PRESSURE_ITERATIONS: 20,
    CURL: 30,
    SPLAT_RADIUS: 0.25,
    SPLAT_FORCE: 6000,
    SHADING: true,
    COLORFUL: true,
    COLOR_UPDATE_SPEED: 10,
    PAUSED: false,
    BACK_COLOR: { r: 0, g: 0, b: 0 },
    TRANSPARENT: false,
    BLOOM: true,
    BLOOM_ITERATIONS: 8,
    BLOOM_RESOLUTION: 256,
    BLOOM_INTENSITY: 0.8,
    BLOOM_THRESHOLD: 0.6,
    BLOOM_SOFT_KNEE: 0.7,
    SUNRAYS: true,
    SUNRAYS_RESOLUTION: 196,
    SUNRAYS_WEIGHT: 1.0,
};

// --- State ---
export const pointers: IPointer[] = [];
export const splatStack: number[] = [];
let colorUpdateTimer = 0.0;

// FBOs
let dye: IDoubleFBO | null = null;
let velocity: IDoubleFBO | null = null;
let divergence: IFBO | null = null;
let curl: IFBO | null = null;
let pressure: IDoubleFBO | null = null;
// Effect FBOs
let bloom: IFBO | null = null;
let bloomFramebuffers: IFBO[] = [];
let sunrays: IFBO | null = null;
let sunraysTemp: IFBO | null = null;
let ditheringTexture: ITextureWrapper | null = null;

// Display Shader Program (handle keywords manually)
let displayProgramInstance: WebGLProgram | null = null;
let displayUniforms: UniformMap = {};
let currentDisplayKeywords: string[] = [];
let baseVertexShaderInstance: WebGLShader | null = null; // Keep instance for recompiling display FS

// Canvas Reference (set by main.ts)
let canvas: HTMLCanvasElement;
export function setSimulationCanvas(canvasRef: HTMLCanvasElement) {
    if (!canvasRef) throw new Error("Canvas reference cannot be null.");
    canvas = canvasRef;
}

// --- Utilities (Included in this file for reduced file count) ---
function hashCode(s: string): number {
    if (s.length === 0) return 0; let hash = 0;
    for (let i = 0; i < s.length; i++) { hash = ((hash << 5) - hash) + s.charCodeAt(i); hash |= 0; }
    return hash;
}
function HSVtoRGB(h: number, s: number, v: number): IColor {
    let r = 0, g = 0, b = 0; const i = Math.floor(h * 6); const f = h * 6 - i;
    const p = v * (1 - s); const q = v * (1 - f * s); const t = v * (1 - (1 - f) * s);
    switch (i % 6) {
        case 0: r = v; g = t; b = p; break; case 1: r = q; g = v; b = p; break;
        case 2: r = p; g = v; b = t; break; case 3: r = p; g = q; b = v; break;
        case 4: r = t; g = p; b = v; break; case 5: r = v; g = p; b = q; break;
    } return { r, g, b };
}
function generateColorHSV(): IColor {
    const c = HSVtoRGB(Math.random(), 1.0, 1.0);
    c.r *= 0.15; c.g *= 0.15; c.b *= 0.15; return c;
}
function normalizeColor(color: IColor): IColor {
    return { r: color.r / 255.0, g: color.g / 255.0, b: color.b / 255.0 };
}
function wrap(value: number, min: number, max: number): number {
    const range = max - min; if (range === 0) return min;
    return ((value - min) % range + range) % range + min;
}
function getResolution(resolution: number): IResolution {
    if (!canvas) { console.warn("getResolution called without canvas element reference."); return { width: resolution, height: resolution }; }
    const aspectRatio = canvas.width / canvas.height; let width = resolution, height = resolution;
    if (aspectRatio > 1) { width = Math.round(resolution * aspectRatio); height = Math.round(resolution); }
    else { width = Math.round(resolution); height = Math.round(resolution / aspectRatio); }
    width = Math.max(width, 1); height = Math.max(height, 1); return { width, height };
}
function correctRadius(radius: number): number {
    if (!canvas) return radius; const aspectRatio = canvas.width / canvas.height;
    if (aspectRatio > 1) radius *= aspectRatio; return radius;
}
function getTextureScale(texture: ITextureWrapper | IFBO, width: number, height: number): ITextureScale {
    if (!texture || texture.width === 0 || texture.height === 0) return { x: 1.0, y: 1.0 };
    return { x: width / texture.width, y: height / texture.height };
}


// --- Initialization ---
export function initSimulation() {
    if (!gl || !ext) throw new Error("WebGL context not initialized before simulation init.");
    if (!canvas) throw new Error("Canvas reference not set before simulation init.");

    console.log("Initializing simulation state...");
    // Compile base vertex shader once for display program recompilation
    baseVertexShaderInstance = compileShader(gl.VERTEX_SHADER, baseVertexShaderSource, null);
    if (!baseVertexShaderInstance) throw new Error("Failed to compile base vertex shader.");

    pointers.length = 0;
    pointers.push({ id: -1, texcoordX: 0, texcoordY: 0, prevTexcoordX: 0, prevTexcoordY: 0, deltaX: 0, deltaY: 0, down: false, moved: false, color: [0.1, 0.1, 0.1] });
    const initialColor = generateColorHSV();
    pointers[0].color = [initialColor.r, initialColor.g, initialColor.b];

    initFramebuffersAndEffects(); // Create FBOs
    updateDisplayProgram(); // Create initial display program instance

    // Load dithering texture (requires context)
    if (config.BLOOM && !ditheringTexture) {
        ditheringTexture = createTextureAsync('LDR_LLL1_0.png'); // Ensure path is correct
        if (!ditheringTexture) {
            console.warn("Failed to load dithering texture, disabling bloom.");
            config.BLOOM = false;
            updateDisplayProgram(); // Update display shader without bloom
        }
    }

    console.log("Simulation state initialized.");
}

function initFramebuffersAndEffects() {
    if (!gl || !ext.formatRGBA || !ext.formatRG || !ext.formatR) {
         throw new Error("Cannot init FBOs: Context/formats missing.");
    }
    const simRes = getResolution(config.SIM_RESOLUTION);
    const dyeRes = getResolution(config.DYE_RESOLUTION);
    const texType = ext.halfFloatTexType;
    const rgba = ext.formatRGBA; // Already checked non-null
    const rg = ext.formatRG!;     // Use non-null assertion as checks are done
    const r = ext.formatR!;
    const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

    console.log(`Initializing FBOs: Sim=${simRes.width}x${simRes.height}, Dye=${dyeRes.width}x${dyeRes.height}`);
    gl.disable(gl.BLEND); // Important during FBO setup

    // --- Core Simulation FBOs ---
    dye = dye ? resizeDoubleFBO(dye, dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering)
              : createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);

    velocity = velocity ? resizeDoubleFBO(velocity, simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering)
                       : createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);

    divergence = resizeOrCreateFBO(divergence, simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
    curl = resizeOrCreateFBO(curl, simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);

    pressure = pressure ? resizeDoubleFBO(pressure, simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST)
                       : createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);

    if (!dye || !velocity || !divergence || !curl || !pressure) {
        throw new Error("Failed to create/resize one or more essential simulation FBOs.");
    }

    // --- Effect FBOs ---
    // Cleanup potentially existing FBOs before deciding to create/resize
    if (!config.BLOOM && bloom) {
         cleanupBloomFBOs();
         bloom = null;
    }
     if (!config.SUNRAYS && sunrays) {
         cleanupSunraysFBOs();
         sunrays = null; sunraysTemp = null;
     }

    if (config.BLOOM) initBloomFramebuffers();
    if (config.SUNRAYS) initSunraysFramebuffers();
}

function cleanupBloomFBOs() {
     if (!gl) return;
     console.log("Cleaning up bloom FBOs...");
     bloomFramebuffers.forEach(fbo => { if (fbo.texture) gl.deleteTexture(fbo.texture); if (fbo.fbo) gl.deleteFramebuffer(fbo.fbo); });
     bloomFramebuffers = [];
     if (bloom) { if (bloom.texture) gl.deleteTexture(bloom.texture); if (bloom.fbo) gl.deleteFramebuffer(bloom.fbo); }
}
function cleanupSunraysFBOs() {
     if (!gl) return;
      console.log("Cleaning up sunrays FBOs...");
     if (sunrays) { if (sunrays.texture) gl.deleteTexture(sunrays.texture); if (sunrays.fbo) gl.deleteFramebuffer(sunrays.fbo); }
     if (sunraysTemp) { if (sunraysTemp.texture) gl.deleteTexture(sunraysTemp.texture); if (sunraysTemp.fbo) gl.deleteFramebuffer(sunraysTemp.fbo); }
}


function initBloomFramebuffers(): void {
    if (!gl || !ext.formatRGBA) { config.BLOOM = false; console.warn("Cannot init bloom: RGBA Format missing."); return; }
    const res = getResolution(config.BLOOM_RESOLUTION);
    const texType = ext.halfFloatTexType;
    const rgba = ext.formatRGBA;
    const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

    try {
        bloom = resizeOrCreateFBO(bloom, res.width, res.height, rgba.internalFormat, rgba.format, texType, filtering);
        if (!bloom) throw new Error("Failed to create main bloom FBO.");

        // Cleanup old iteration FBOs before creating/resizing new ones
        cleanupBloomFBOs(); // Clears array and deletes resources

        let lastWidth = res.width, lastHeight = res.height;
        for (let i = 0; i < config.BLOOM_ITERATIONS; i++) {
            const width = lastWidth >> 1, height = lastHeight >> 1;
            if (width < 2 || height < 2) break; // Stop if size gets too small
            const fbo = createFBO(width, height, rgba.internalFormat, rgba.format, texType, filtering);
            bloomFramebuffers.push(fbo); // Add newly created FBO
            lastWidth = width; lastHeight = height;
        }
        console.log(`Bloom FBOs created (${bloomFramebuffers.length} iterations).`);
    } catch (e) {
        console.error("Error initializing bloom FBOs:", e);
        config.BLOOM = false; // Disable bloom on error
        cleanupBloomFBOs(); // Ensure cleanup
        bloom = null;
        updateDisplayProgram(); // Update display shader
    }
}

function initSunraysFramebuffers(): void {
     if (!gl || !ext.formatR) { config.SUNRAYS = false; console.warn("Cannot init sunrays: R Format missing."); return; }
    const res = getResolution(config.SUNRAYS_RESOLUTION);
    const texType = ext.halfFloatTexType;
    const r = ext.formatR;
    const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

    try {
        sunrays = resizeOrCreateFBO(sunrays, res.width, res.height, r.internalFormat, r.format, texType, filtering);
        sunraysTemp = resizeOrCreateFBO(sunraysTemp, res.width, res.height, r.internalFormat, r.format, texType, filtering);
        if (!sunrays || !sunraysTemp) throw new Error("Failed to create sunrays FBOs.");
        console.log(`Sunrays FBOs created (${res.width}x${res.height}).`);
    } catch(e) {
         console.error("Error initializing sunrays FBOs:", e);
         config.SUNRAYS = false; // Disable sunrays on error
         cleanupSunraysFBOs(); // Ensure cleanup
         sunrays = null; sunraysTemp = null;
         updateDisplayProgram(); // Update display shader
    }
}

// Called when canvas resizes or quality settings change
export function handleResize() {
    initFramebuffersAndEffects();
    updateDisplayProgram(); // Recreate display program if needed
}

// --- Simulation Step ---
export function step(dt: number): void {
    if (!gl || !ext || !velocity || !curl || !divergence || !pressure || !dye) {
        console.warn("Skipping simulation step: Missing FBOs.");
        return; // Don't proceed if essential resources are missing
    }
    // Check programs used in step
    if (!curlProgram || !vorticityProgram || !divergenceProgram || !clearProgram ||
        !pressureProgram || !gradientSubtractProgram || !advectionProgram) {
        console.warn("Skipping simulation step: Missing programs.");
        return;
    }

    gl.disable(gl.BLEND);
    gl.viewport(0, 0, velocity.width, velocity.height);

    // 1. Curl
    curlProgram.bind();
    gl.uniform2f(curlProgram.uniforms['texelSize']!, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(curlProgram.uniforms['uVelocity']!, velocity.read.attach(0));
    blit(curl, true);

    // 2. Vorticity
    vorticityProgram.bind();
    gl.uniform2f(vorticityProgram.uniforms['texelSize']!, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(vorticityProgram.uniforms['uVelocity']!, velocity.read.attach(0));
    gl.uniform1i(vorticityProgram.uniforms['uCurl']!, curl.attach(1));
    gl.uniform1f(vorticityProgram.uniforms['curl']!, config.CURL);
    gl.uniform1f(vorticityProgram.uniforms['dt']!, dt);
    blit(velocity.write, true);
    velocity.swap();

    // 3. Divergence
    divergenceProgram.bind();
    gl.uniform2f(divergenceProgram.uniforms['texelSize']!, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(divergenceProgram.uniforms['uVelocity']!, velocity.read.attach(0));
    blit(divergence, true);

    // 4. Pressure Init/Clear
    clearProgram.bind();
    gl.uniform1i(clearProgram.uniforms['uTexture']!, pressure.read.attach(0));
    gl.uniform1f(clearProgram.uniforms['value']!, config.PRESSURE);
    blit(pressure.write, true);
    pressure.swap();

    // 5. Pressure Solve
    pressureProgram.bind();
    gl.uniform2f(pressureProgram.uniforms['texelSize']!, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(pressureProgram.uniforms['uDivergence']!, divergence.attach(0));
    for (let i = 0; i < config.PRESSURE_ITERATIONS; i++) {
        gl.uniform1i(pressureProgram.uniforms['uPressure']!, pressure.read.attach(1));
        blit(pressure.write, true);
        pressure.swap();
    }

    // 6. Gradient Subtract
    gradientSubtractProgram.bind();
    gl.uniform2f(gradientSubtractProgram.uniforms['texelSize']!, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(gradientSubtractProgram.uniforms['uPressure']!, pressure.read.attach(0));
    gl.uniform1i(gradientSubtractProgram.uniforms['uVelocity']!, velocity.read.attach(1));
    blit(velocity.write, true);
    velocity.swap();

    // 7. Advect Velocity
    advectionProgram.bind();
    gl.uniform2f(advectionProgram.uniforms['texelSize']!, velocity.texelSizeX, velocity.texelSizeY);
    if (!ext.supportLinearFiltering) {
        gl.uniform2f(advectionProgram.uniforms['dyeTexelSize']!, velocity.texelSizeX, velocity.texelSizeY);
    }
    const velocityId = velocity.read.attach(0);
    gl.uniform1i(advectionProgram.uniforms['uVelocity']!, velocityId);
    gl.uniform1i(advectionProgram.uniforms['uSource']!, velocityId);
    gl.uniform1f(advectionProgram.uniforms['dt']!, dt);
    gl.uniform1f(advectionProgram.uniforms['dissipation']!, config.VELOCITY_DISSIPATION);
    blit(velocity.write, true);
    velocity.swap();

    // 8. Advect Dye
    gl.viewport(0, 0, dye.width, dye.height);
    // advectionProgram still bound
    gl.uniform2f(advectionProgram.uniforms['texelSize']!, velocity.texelSizeX, velocity.texelSizeY);
    if (!ext.supportLinearFiltering) {
        gl.uniform2f(advectionProgram.uniforms['dyeTexelSize']!, dye.texelSizeX, dye.texelSizeY);
    }
    gl.uniform1i(advectionProgram.uniforms['uVelocity']!, velocity.read.attach(0));
    gl.uniform1i(advectionProgram.uniforms['uSource']!, dye.read.attach(1));
    gl.uniform1f(advectionProgram.uniforms['dissipation']!, config.DENSITY_DISSIPATION);
    blit(dye.write, true);
    dye.swap();
}

// --- Rendering ---
export function render(target: IFBO | null): void {
    if (!gl || !dye || !displayProgramInstance) { // Check display program too
        console.warn("Skipping render: Missing GL context, dye FBO, or display program.");
        return;
    }

    // Apply effects
    if (config.BLOOM && bloom && bloomFramebuffers.length > 0) {
        applyBloom(dye.read, bloom);
    }
    if (config.SUNRAYS && sunrays && sunraysTemp) {
        applySunrays(dye.read, sunraysTemp, sunrays);
        blur(sunrays, sunraysTemp, 1);
    }

    // Setup final draw
    const targetWidth = target ? target.width : gl.drawingBufferWidth;
    const targetHeight = target ? target.height : gl.drawingBufferHeight;
    gl.viewport(0, 0, targetWidth, targetHeight);

    if (target == null || !config.TRANSPARENT) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    } else {
        gl.disable(gl.BLEND);
    }

    // Draw background
    if (!config.TRANSPARENT) {
        drawColor(target, normalizeColor(config.BACK_COLOR));
    } else if (target == null && config.TRANSPARENT) {
        drawCheckerboard(target);
    }

    // Draw final display
    drawDisplay(target, targetWidth, targetHeight);

    gl.disable(gl.BLEND); // Reset blend state
}

function drawColor(target: IFBO | null, color: IColor): void {
     if (!gl || !colorProgram) return;
    colorProgram.bind();
    gl.uniform4f(colorProgram.uniforms['color']!, color.r, color.g, color.b, 1.0);
    blit(target, true);
}

function drawCheckerboard(target: IFBO | null): void {
    if (!gl || !checkerboardProgram || !canvas) return;
    checkerboardProgram.bind();
    gl.uniform1f(checkerboardProgram.uniforms['aspectRatio']!, canvas.width / canvas.height);
    blit(target, true);
}

function drawDisplay(target: IFBO | null, width: number, height: number): void {
     if (!gl || !dye || !displayProgramInstance || !displayUniforms) return;

    gl.useProgram(displayProgramInstance); // Use manually managed program

    let textureUnit = 0;
    gl.uniform1i(displayUniforms['uTexture']!, dye.read.attach(textureUnit++)); // Dye

    if (config.SHADING) {
        gl.uniform2f(displayUniforms['texelSize']!, 1.0 / width, 1.0 / height);
    }
    if (config.BLOOM && bloom && ditheringTexture) {
        gl.uniform1i(displayUniforms['uBloom']!, bloom.attach(textureUnit++));
        gl.uniform1i(displayUniforms['uDithering']!, ditheringTexture.attach(textureUnit++));
        const scale = getTextureScale(ditheringTexture, width, height);
        gl.uniform2f(displayUniforms['ditherScale']!, scale.x, scale.y);
    }
    if (config.SUNRAYS && sunrays) {
        gl.uniform1i(displayUniforms['uSunrays']!, sunrays.attach(textureUnit++));
    }

    blit(target, false); // Draw without clearing
}

function applyBloom(source: IFBO, destination: IFBO): void {
     if (!gl || bloomFramebuffers.length < 1 || !bloomPrefilterProgram || !bloomBlurProgram || !bloomFinalProgram) return;
    let last = destination; gl.disable(gl.BLEND);
    // 1. Prefilter
    bloomPrefilterProgram.bind();
    const knee = config.BLOOM_THRESHOLD * config.BLOOM_SOFT_KNEE + 1e-5; // Epsilon
    const curve0 = config.BLOOM_THRESHOLD - knee; const curve1 = knee * 2.0; const curve2 = 0.25 / knee;
    gl.uniform3f(bloomPrefilterProgram.uniforms['curve']!, curve0, curve1, curve2);
    gl.uniform1f(bloomPrefilterProgram.uniforms['threshold']!, config.BLOOM_THRESHOLD);
    gl.uniform1i(bloomPrefilterProgram.uniforms['uTexture']!, source.attach(0));
    blit(last, true);
    // 2. Downscale/Blur
    bloomBlurProgram.bind();
    for (let i = 0; i < bloomFramebuffers.length; i++) {
        const dest = bloomFramebuffers[i];
        gl.uniform2f(bloomBlurProgram.uniforms['texelSize']!, last.texelSizeX, last.texelSizeY);
        gl.uniform1i(bloomBlurProgram.uniforms['uTexture']!, last.attach(0));
        blit(dest, true); last = dest;
    }
    // 3. Upscale/Blur (Additive)
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = bloomFramebuffers.length - 2; i >= 0; i--) {
        const baseTex = bloomFramebuffers[i];
        gl.uniform2f(bloomBlurProgram.uniforms['texelSize']!, last.texelSizeX, last.texelSizeY);
        gl.uniform1i(bloomBlurProgram.uniforms['uTexture']!, last.attach(0));
        gl.viewport(0, 0, baseTex.width, baseTex.height);
        blit(baseTex, false); last = baseTex;
    }
    gl.disable(gl.BLEND);
    // 4. Final Intensity Pass
    gl.viewport(0, 0, destination.width, destination.height);
    bloomFinalProgram.bind();
    gl.uniform1i(bloomFinalProgram.uniforms['uTexture']!, last.attach(0));
    gl.uniform1f(bloomFinalProgram.uniforms['intensity']!, config.BLOOM_INTENSITY);
    blit(destination, true);
}

function applySunrays(source: IFBO, mask: IFBO, destination: IFBO): void {
     if (!gl || !sunraysMaskProgram || !sunraysProgram) return;
    gl.disable(gl.BLEND);
    // 1. Create Mask
    sunraysMaskProgram.bind();
    gl.uniform1i(sunraysMaskProgram.uniforms['uTexture']!, source.attach(0));
    gl.viewport(0, 0, mask.width, mask.height); blit(mask, true);
    // 2. Generate Sunrays
    sunraysProgram.bind();
    gl.uniform1f(sunraysProgram.uniforms['weight']!, config.SUNRAYS_WEIGHT);
    gl.uniform1i(sunraysProgram.uniforms['uTexture']!, mask.attach(0));
    gl.viewport(0, 0, destination.width, destination.height); blit(destination, true);
}

function blur(target: IFBO, temp: IFBO, iterations: number): void {
     if (!gl || !blurProgram || !target || !temp) return;
    blurProgram.bind(); gl.disable(gl.BLEND);
    gl.viewport(0, 0, target.width, target.height);
    for (let i = 0; i < iterations; i++) {
        gl.uniform2f(blurProgram.uniforms['texelSize']!, target.texelSizeX, 0.0);
        gl.uniform1i(blurProgram.uniforms['uTexture']!, target.attach(0)); blit(temp, true);
        gl.uniform2f(blurProgram.uniforms['texelSize']!, 0.0, target.texelSizeY);
        gl.uniform1i(blurProgram.uniforms['uTexture']!, temp.attach(0)); blit(target, true);
    }
}

// --- Update Display Program (Manual Keyword Handling) ---
export function updateDisplayProgram() {
    if (!gl || !baseVertexShaderInstance) {
        console.error("Cannot update display program: GL context or base VS missing.");
        return;
    }
    const keywords = [];
    if (config.SHADING) keywords.push("SHADING");
    if (config.BLOOM) keywords.push("BLOOM");
    if (config.SUNRAYS) keywords.push("SUNRAYS");

    if (keywords.toString() === currentDisplayKeywords.toString() && displayProgramInstance) {
        return; // No change needed
    }

    console.log("Updating display shader with keywords:", keywords);
    currentDisplayKeywords = keywords;
    // Delete old program if it exists
    if (displayProgramInstance) gl.deleteProgram(displayProgramInstance);

    // Compile new fragment shader with keywords
    const fs = compileShader(gl.FRAGMENT_SHADER, displayShaderSource, keywords);
    if (!fs) { console.error("Failed to compile display fragment shader"); displayProgramInstance=null; return; }

    // Link new program
    const prog = createProgram(baseVertexShaderInstance, fs);
    gl.deleteShader(fs); // Delete fragment shader after linking
    if (!prog) { console.error("Failed to link display program"); displayProgramInstance=null; return; }

    displayProgramInstance = prog;
    displayUniforms = getUniforms(prog); // Update uniforms map for the new program
}


// --- Splatting ---
function splat(x: number, y: number, dx: number, dy: number, color: IColor, radiusMultiplier = 1.0) {
    if (!gl || !canvas || !velocity || !dye || !splatProgram || !ext) return; // Check resources
    const aspectRatio = canvas.width / canvas.height;
    const baseRadius = config.SPLAT_RADIUS / 100.0; // Adjust base scale if needed
    const correctedRadius = correctRadius(baseRadius) * radiusMultiplier;

    splatProgram.bind(); // Bind once
    gl.uniform1f(splatProgram.uniforms['aspectRatio']!, aspectRatio);
    gl.uniform2f(splatProgram.uniforms['point']!, x, y);
    gl.uniform1f(splatProgram.uniforms['radius']!, correctedRadius);

    // Splat Velocity
    gl.viewport(0, 0, velocity.width, velocity.height);
    gl.uniform1i(splatProgram.uniforms['uTarget']!, velocity.read.attach(0));
    gl.uniform3f(splatProgram.uniforms['color']!, dx, dy, 0.0);
    blit(velocity.write, false); velocity.swap();

    // Splat Dye
    gl.viewport(0, 0, dye.width, dye.height);
    gl.uniform1i(splatProgram.uniforms['uTarget']!, dye.read.attach(0));
    gl.uniform3f(splatProgram.uniforms['color']!, color.r, color.g, color.b);
    blit(dye.write, false); dye.swap();
}

export function splatPointer(pointer: IPointer): void {
    if (!config) return;
    const dx = pointer.deltaX * config.SPLAT_FORCE;
    const dy = pointer.deltaY * config.SPLAT_FORCE;
    const color: IColor = { r: pointer.color[0], g: pointer.color[1], b: pointer.color[2] };
    splat(pointer.texcoordX, pointer.texcoordY, dx, dy, color);
}

export function multipleSplats(amount: number) {
    console.log(`Adding ${amount} random splats.`);
    for (let i = 0; i < amount; i++) {
        const colorHSV = generateColorHSV();
        const color: IColor = { r: colorHSV.r * 10.0, g: colorHSV.g * 10.0, b: colorHSV.b * 10.0 };
        const x = Math.random(); const y = Math.random();
        const dx = 1000 * (Math.random() - 0.5); const dy = 1000 * (Math.random() - 0.5);
        splat(x, y, dx, dy, color);
    }
}

// --- Public Click Effect Function ---
export function triggerSplat(normalizedX: number, normalizedY: number) {
    console.log(`Triggering splat at ${normalizedX.toFixed(2)}, ${normalizedY.toFixed(2)}`);
    if (!pointers[0]) { console.warn("Cannot trigger splat: Pointer[0] missing."); return; }
    // Use the mouse pointer's current color (ensure it's initialized)
    const color: IColor = { r: pointers[0].color[0] || 0.1, g: pointers[0].color[1] || 0.1, b: pointers[0].color[2] || 0.1 };
    const dx = 0; const dy = 0;
    const radiusMultiplier = 0.7; // Adjust size for click
    splat(normalizedX, normalizedY, dx, dy, color, radiusMultiplier);
}

// --- Update Colors ---
export function updateColors(dt: number): void {
    if (!config.COLORFUL) return;
    colorUpdateTimer += dt * config.COLOR_UPDATE_SPEED;
    if (colorUpdateTimer >= 1.0) {
        colorUpdateTimer = wrap(colorUpdateTimer, 0.0, 1.0);
        pointers.forEach(p => {
            const newColor = generateColorHSV();
            p.color = [newColor.r, newColor.g, newColor.b];
        });
    }
}

// --- Apply Inputs ---
export function applyInputs(): void {
    if (splatStack.length > 0) {
        multipleSplats(splatStack.pop()!);
    }
    pointers.forEach(p => {
        if (p.moved && p.down) { // Only splat on move if pointer is down
            splatPointer(p);
            p.moved = false; // Reset moved flag only after processing a down-move
        } else if (!p.down) {
             p.moved = false; // Reset moved flag if pointer is up
        }
    });
}