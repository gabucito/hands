// types.ts

/**
 * Represents an RGB color value, typically in the range [0, 1] after normalization,
 * but might represent other data (like velocity) in specific contexts.
 */
export interface IColor {
    r: number;
    g: number;
    b: number;
}

/**
 * Configuration settings for the fluid simulation and rendering effects.
 */
export interface IConfig {
    SIM_RESOLUTION: number;
    DYE_RESOLUTION: number;
    CAPTURE_RESOLUTION: number;
    DENSITY_DISSIPATION: number;
    VELOCITY_DISSIPATION: number;
    PRESSURE: number;
    PRESSURE_ITERATIONS: number;
    CURL: number;
    SPLAT_RADIUS: number;
    SPLAT_FORCE: number;
    SHADING: boolean;
    COLORFUL: boolean;
    COLOR_UPDATE_SPEED: number;
    PAUSED: boolean;
    BACK_COLOR: IColor; // Note: BACK_COLOR values are usually 0-255 before normalization
    TRANSPARENT: boolean;
    BLOOM: boolean;
    BLOOM_ITERATIONS: number;
    BLOOM_RESOLUTION: number;
    BLOOM_INTENSITY: number;
    BLOOM_THRESHOLD: number;
    BLOOM_SOFT_KNEE: number;
    SUNRAYS: boolean;
    SUNRAYS_RESOLUTION: number;
    SUNRAYS_WEIGHT: number;
}

/**
 * Represents an active input pointer (mouse or touch).
 */
export interface IPointer {
    id: number | string; // Unique ID (e.g., -1 for mouse, touch identifier)
    texcoordX: number;   // Current X position in texture coordinates [0, 1]
    texcoordY: number;   // Current Y position in texture coordinates [0, 1] (Y flipped)
    prevTexcoordX: number; // Previous X position [0, 1]
    prevTexcoordY: number; // Previous Y position [0, 1]
    deltaX: number;      // Change in X position (corrected for aspect ratio)
    deltaY: number;      // Change in Y position (corrected for aspect ratio)
    down: boolean;       // Is the pointer currently pressed down?
    moved: boolean;      // Did the pointer move since the last frame?
    color: number[];     // Current color associated with the pointer [r, g, b] (scaled)
}

/**
 * Represents a width and height resolution.
 */
export interface IResolution {
    width: number;
    height: number;
}

/**
 * Wrapper for a WebGL texture, including its dimensions.
 */
export interface ITextureWrapper {
    texture: WebGLTexture;
    width: number;
    height: number;
    /** Attaches the texture to the specified texture unit ID. */
    attach(id: number): number;
}

/**
 * Represents a Framebuffer Object (FBO) with its associated texture and properties.
 */
export interface IFBO {
    texture: WebGLTexture;
    fbo: WebGLFramebuffer | null; // The WebGL Framebuffer object
    width: number;
    height: number;
    texelSizeX: number; // 1.0 / width
    texelSizeY: number; // 1.0 / height
    /** Attaches the FBO's texture to the specified texture unit ID. */
    attach(id: number): number;
}

/**
 * Represents a pair of FBOs for ping-pong rendering techniques.
 * Allows reading from one while writing to the other, then swapping.
 */
export interface IDoubleFBO {
    width: number;
    height: number;
    texelSizeX: number;
    texelSizeY: number;
    /** Internal reference to the first FBO. */
    _fbo1: IFBO;
    /** Internal reference to the second FBO. */
    _fbo2: IFBO;
    /** Gets the FBO currently designated for reading. */
    readonly read: IFBO;
    /** Gets the FBO currently designated for writing. */
    readonly write: IFBO;
    /** Swaps the read and write FBO designations. */
    swap(): void;
}

/**
 * Describes a supported WebGL texture format pair (internal format and pixel format).
 */
export interface ISupportedFormat {
    internalFormat: number; // e.g., gl.RGBA16F
    format: number;         // e.g., gl.RGBA
}

/**
 * Holds information about the WebGL context's capabilities and extensions.
 */
export interface IWebGLContextExtensions {
    formatRGBA: ISupportedFormat | null; // Supported format for RGBA (float/half-float) textures
    formatRG: ISupportedFormat | null;   // Supported format for RG (float/half-float) textures
    formatR: ISupportedFormat | null;    // Supported format for R (float/half-float) textures
    halfFloatTexType: number;            // The GLenum for HALF_FLOAT texture type (or fallback)
    supportLinearFiltering: boolean;     // Does the context support linear filtering for float/half-float textures?
}

/**
 * Container for the WebGL rendering context and its extension information.
 */
export interface IWebGLContext {
    gl: WebGLRenderingContext | WebGL2RenderingContext; // The actual WebGL context
    ext: IWebGLContextExtensions;                       // Information about capabilities/extensions
}

/**
 * Represents the scale factor needed to map a texture's coordinates to a target display area.
 */
export interface ITextureScale {
     x: number; // widthScale = targetWidth / textureWidth
     y: number; // heightScale = targetHeight / textureHeight
}

/**
 * Type alias for a map of uniform names to their WebGL locations.
 */
export type UniformMap = Record<string, WebGLUniformLocation | null>;