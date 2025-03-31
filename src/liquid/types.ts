// types.ts
export interface IColor {
    r: number;
    g: number;
    b: number;
}

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
    BACK_COLOR: IColor;
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

export interface IPointer {
    id: number | string;
    texcoordX: number;
    texcoordY: number;
    prevTexcoordX: number;
    prevTexcoordY: number;
    deltaX: number;
    deltaY: number;
    down: boolean;
    moved: boolean;
    color: number[]; // [r, g, b]
}

export interface IResolution {
    width: number;
    height: number;
}

export interface ITextureWrapper {
    texture: WebGLTexture;
    width: number;
    height: number;
    attach(id: number): number;
}

export interface IFBO {
    texture: WebGLTexture;
    fbo: WebGLFramebuffer | null;
    width: number;
    height: number;
    texelSizeX: number;
    texelSizeY: number;
    attach(id: number): number;
}

export interface IDoubleFBO {
    width: number;
    height: number;
    texelSizeX: number;
    texelSizeY: number;
    // Use internal fields to allow resizing
    _fbo1: IFBO;
    _fbo2: IFBO;
    readonly read: IFBO;
    readonly write: IFBO;
    swap(): void;
}

export interface ISupportedFormat {
    internalFormat: number;
    format: number;
}

export interface IWebGLContextExtensions {
    formatRGBA: ISupportedFormat | null;
    formatRG: ISupportedFormat | null;
    formatR: ISupportedFormat | null;
    halfFloatTexType: number; // GLenum
    supportLinearFiltering: boolean;
}

export interface IWebGLContext {
    gl: WebGLRenderingContext | WebGL2RenderingContext;
    ext: IWebGLContextExtensions;
}

export interface ITextureScale {
     x: number;
     y: number;
}

export type UniformMap = Record<string, WebGLUniformLocation | null>;