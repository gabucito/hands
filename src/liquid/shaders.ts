// shaders.ts

// Keep all GLSL source strings here, exported const ...Source = `...`;
export const baseVertexShaderSource = `
    precision highp float;
    attribute vec2 aPosition; // Use attribute instead of in (WebGL1 compatibility)
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform vec2 texelSize;

    void main () {
        vUv = aPosition * 0.5 + 0.5;
        vL = vUv - vec2(texelSize.x, 0.0);
        vR = vUv + vec2(texelSize.x, 0.0);
        vT = vUv + vec2(0.0, texelSize.y);
        vB = vUv - vec2(0.0, texelSize.y);
        gl_Position = vec4(aPosition, 0.0, 1.0);
    }
`;

export const blurVertexShaderSource = `
    precision highp float;
    attribute vec2 aPosition;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    uniform vec2 texelSize;

    void main () {
        vUv = aPosition * 0.5 + 0.5;
        float offset = 1.33333333;
        vL = vUv - texelSize * offset;
        vR = vUv + texelSize * offset;
        gl_Position = vec4(aPosition, 0.0, 1.0);
    }
`;

export const blurShaderSource = `
    precision mediump float;
    precision mediump sampler2D;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    uniform sampler2D uTexture;

    void main () {
        vec4 sum = texture2D(uTexture, vUv) * 0.29411764;
        sum += texture2D(uTexture, vL) * 0.35294117;
        sum += texture2D(uTexture, vR) * 0.35294117;
        gl_FragColor = sum;
    }
`;

export const copyShaderSource = `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    uniform sampler2D uTexture;

    void main () {
        gl_FragColor = texture2D(uTexture, vUv);
    }
`;

export const clearShaderSource = `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    uniform sampler2D uTexture;
    uniform float value;

    void main () {
        // Preserves alpha, only scales color channels
        vec4 color = texture2D(uTexture, vUv);
        gl_FragColor = vec4(color.rgb * value, color.a);
    }
`;

export const colorShaderSource = `
    precision mediump float;
    uniform vec4 color;

    void main () {
        gl_FragColor = color;
    }
`;

export const checkerboardShaderSource = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform float aspectRatio;

    #define SCALE 25.0

    void main () {
        vec2 uv = floor(vUv * SCALE * vec2(aspectRatio, 1.0));
        float v = mod(uv.x + uv.y, 2.0);
        v = v * 0.1 + 0.8; // Alter brightness range slightly
        gl_FragColor = vec4(vec3(v), 1.0);
    }
`;

export const displayShaderSource = `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;
    uniform sampler2D uBloom;
    uniform sampler2D uSunrays;
    uniform sampler2D uDithering;
    uniform vec2 ditherScale;
    uniform vec2 texelSize;

    vec3 linearToGamma (vec3 color) {
        color = max(color, vec3(0.0));
        return max(1.055 * pow(color, vec3(1.0/2.4)) - 0.055, vec3(0.0));
    }

    void main () {
        vec3 c = texture2D(uTexture, vUv).rgb;

    #ifdef SHADING
        vec3 lc = texture2D(uTexture, vL).rgb;
        vec3 rc = texture2D(uTexture, vR).rgb;
        vec3 tc = texture2D(uTexture, vT).rgb;
        vec3 bc = texture2D(uTexture, vB).rgb;
        float dx = length(rc) - length(lc);
        float dy = length(tc) - length(bc);
        vec3 n = normalize(vec3(dx, dy, max(length(texelSize), 0.0001)));
        vec3 l = normalize(vec3(0.0, 0.0, 1.0));
        float diffuse = clamp(dot(n, l) * 0.3 + 0.7, 0.7, 1.0);
        c *= diffuse;
    #endif

    #ifdef BLOOM
        vec3 bloom = texture2D(uBloom, vUv).rgb;
    #endif

    #ifdef SUNRAYS
        float sunrays = texture2D(uSunrays, vUv).r;
        c *= sunrays;
        #ifdef BLOOM
            bloom *= sunrays;
        #endif
    #endif

    #ifdef BLOOM
        float noise = texture2D(uDithering, vUv * ditherScale).r;
        noise = noise * 2.0 - 1.0;
        bloom += noise / 255.0;
        bloom = linearToGamma(bloom);
        c += bloom;
    #endif

        float a = max(c.r, max(c.g, c.b));
        gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
    }
`;

export const bloomPrefilterShaderSource = `
    precision mediump float;
    precision mediump sampler2D;
    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform vec3 curve; // x = threshold - knee, y = knee * 2, z = 0.25 / knee
    uniform float threshold;

    void main () {
        vec3 c = texture2D(uTexture, vUv).rgb;
        float br = max(c.r, max(c.g, c.b));
        float rq = clamp(br - curve.x, 0.0, curve.y);
        rq = curve.z * rq * rq;
        c *= max(rq, br - threshold) / max(br, 0.0001);
        gl_FragColor = vec4(c, 1.0);
    }
`;

export const bloomBlurShaderSource = `
    precision mediump float;
    precision mediump sampler2D;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;

    void main () {
        vec4 sum = vec4(0.0);
        sum += texture2D(uTexture, vL);
        sum += texture2D(uTexture, vR);
        sum += texture2D(uTexture, vT);
        sum += texture2D(uTexture, vB);
        sum *= 0.25;
        gl_FragColor = sum;
    }
`;

export const bloomFinalShaderSource = `
    precision mediump float;
    precision mediump sampler2D;
    varying vec2 vUv; // Use vUv
    uniform sampler2D uTexture;
    uniform float intensity;
    void main () {
        vec4 bloomColor = texture2D(uTexture, vUv);
        gl_FragColor = bloomColor * intensity;
    }
`;

export const sunraysMaskShaderSource = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uTexture; // Original scene texture

    void main () {
        vec4 c = texture2D(uTexture, vUv);
        float br = max(c.r, max(c.g, c.b));
        float maskValue = 1.0 - clamp(br * 20.0, 0.0, 0.8);
         gl_FragColor = vec4(vec3(maskValue), 1.0);
    }
`;

export const sunraysShaderSource = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uTexture; // Sunrays mask texture
    uniform float weight;

    #define ITERATIONS 16

    void main () {
        float Density = 0.3;
        float Decay = 0.95;
        float Exposure = 0.7;
        vec2 coord = vUv;
        vec2 lightPos = vec2(0.5, 0.5);
        vec2 deltaTexCoord = coord - lightPos;
        deltaTexCoord *= 1.0 / float(ITERATIONS) * Density;
        float illuminationDecay = 1.0;
        float color = texture2D(uTexture, vUv).r;

        for (int i = 0; i < ITERATIONS; i++)
        {
            coord -= deltaTexCoord;
            float sample = texture2D(uTexture, coord).r;
            color += sample * illuminationDecay * weight;
            illuminationDecay *= Decay;
        }
        gl_FragColor = vec4(color * Exposure, 0.0, 0.0, 1.0);
    }
`;


export const splatShaderSource = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uTarget; // Texture to splat onto
    uniform float aspectRatio;
    uniform vec3 color;       // Color or velocity delta
    uniform vec2 point;       // Splat center in texture coordinates [0, 1]
    uniform float radius;      // Splat radius in texture coordinates

    void main () {
        vec2 p = vUv - point.xy;
        p.x *= aspectRatio;
        float sqDist = dot(p, p);
        // Ensure radius is positive and non-zero before squaring and division
        float safeRadius = max(radius, 0.0001);
        float splatValue = exp(-sqDist / (safeRadius * safeRadius));

        vec3 splat = splatValue * color;
        vec3 base = texture2D(uTarget, vUv).rgb; // Assuming color target
        gl_FragColor = vec4(base + splat, 1.0);
    }
`;

export const advectionShaderSource = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uVelocity; // Velocity field
    uniform sampler2D uSource;   // Texture being advected (dye or velocity itself)
    uniform vec2 texelSize;      // Size of one texel in velocity texture = (1/width, 1/height)
    uniform vec2 dyeTexelSize;   // Size of one texel in dye texture (if different)
    uniform float dt;            // Timestep
    uniform float dissipation;   // How much the quantity dissipates over time

    vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
        vec2 st = uv / tsize - 0.5;
        vec2 iuv = floor(st);
        vec2 fuv = fract(st);
        vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
        vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
        vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
        vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
        return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
    }

    void main () {
        vec2 sourceTexelSize = texelSize;
        #ifdef MANUAL_FILTERING
             sourceTexelSize = dyeTexelSize; // Assume dyeTexelSize is for uSource when filtering manually
        #endif

        vec2 vel = texture2D(uVelocity, vUv).xy;
        // Optional RK2 step:
        // vec2 midPoint = vUv - 0.5 * dt * vel / texelSize; // Scale velocity appropriately if not in texels/sec
        // vel = texture2D(uVelocity, midPoint).xy;
        vec2 coord = vUv - dt * vel; // Basic backtrace, Ensure vel units are correct (texels/sec or normalized?)

        vec4 result;
        #ifdef MANUAL_FILTERING
            result = bilerp(uSource, coord, sourceTexelSize);
        #else
            result = texture2D(uSource, coord);
        #endif

        float decay = 1.0 + dissipation * dt;
        gl_FragColor = result / max(decay, 1.0); // Avoid division by zero or values < 1
        // Exponential decay alternative: gl_FragColor = result * exp(-dissipation * dt);
    }
`;

export const divergenceShaderSource = `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uVelocity;

    void main () {
        float L = texture2D(uVelocity, vL).x;
        float R = texture2D(uVelocity, vR).x;
        float T = texture2D(uVelocity, vT).y;
        float B = texture2D(uVelocity, vB).y;

        // Simple Neumann boundary handling (zero gradient)
        vec2 C = texture2D(uVelocity, vUv).xy; // Center velocity
        if (vL.x < 0.01) L = C.x; // Reflect internal velocity x if at left edge
        if (vR.x > 0.99) R = C.x; // Reflect internal velocity x if at right edge
        if (vB.y < 0.01) B = C.y; // Reflect internal velocity y if at bottom edge
        if (vT.y > 0.99) T = C.y; // Reflect internal velocity y if at top edge

        float div = 0.5 * (R - L + T - B);
        gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
    }
`;

export const curlShaderSource = `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uVelocity;

    void main () {
        float L = texture2D(uVelocity, vL).y;
        float R = texture2D(uVelocity, vR).y;
        float T = texture2D(uVelocity, vT).x;
        float B = texture2D(uVelocity, vB).x;
        float vorticity = R - L - (T - B); // Curl = dVy/dx - dVx/dy
        gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
    }
`;

export const vorticityShaderSource = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uVelocity; // Current velocity field
    uniform sampler2D uCurl;     // Curl (vorticity) field (scalar)
    uniform float curl;          // Vorticity confinement strength coefficient
    uniform float dt;            // Timestep

    void main () {
        float L = texture2D(uCurl, vL).x;
        float R = texture2D(uCurl, vR).x;
        float T = texture2D(uCurl, vT).x;
        float B = texture2D(uCurl, vB).x;
        float C = texture2D(uCurl, vUv).x; // Vorticity (scalar) at center

        // Calculate gradient of vorticity magnitude (|w|)
        vec2 gradient = 0.5 * vec2(abs(R) - abs(L), abs(T) - abs(B));
        // Normalize gradient: N = normalize(gradient(|w|))
        vec2 N = normalize(gradient + 1e-5); // Add epsilon for stability

        // Vorticity confinement force: F = curl_strength * (N x w_vector) * dt
        // In 2D, w_vector = (0, 0, C), N = (Nx, Ny, 0)
        // N x w_vector = (Ny*C - 0, 0 - Nx*C, 0 - 0) = (Ny*C, -Nx*C, 0)
        // Force in 2D plane: F_2D = curl_strength * vec2(N.y, -N.x) * C
        vec2 force = curl * vec2(N.y, -N.x) * C;

        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity += force * dt; // Add scaled force to velocity

        // Clamp velocity? Optional.
        // velocity = clamp(velocity, -1000.0, 1000.0);

        gl_FragColor = vec4(velocity, 0.0, 1.0);
    }
`;

export const pressureShaderSource = `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uPressure;   // Pressure field from previous iteration
    uniform sampler2D uDivergence; // Divergence field

    void main () {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        float divergence = texture2D(uDivergence, vUv).x;

        // Simple Neumann boundary for pressure (reflect internal)
        // Not strictly needed if velocity boundaries handle divergence correctly
        float C = texture2D(uPressure, vUv).x;
        if (vL.x < 0.01) L = R; // Reflect right pressure if at left edge
        if (vR.x > 0.99) R = L; // Reflect left pressure if at right edge
        if (vB.y < 0.01) B = T; // Reflect top pressure if at bottom edge
        if (vT.y > 0.99) T = B; // Reflect bottom pressure if at top edge

        // Jacobi iteration: P_new = (L + R + T + B - divergence * scale) * 0.25
        // Divergence scaling factor depends on discretization, density, dt. Assume it's pre-scaled.
        float pressure = (L + R + B + T - divergence) * 0.25;
        gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
    }
`;


export const gradientSubtractShaderSource = `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uPressure; // Final pressure field
    uniform sampler2D uVelocity; // Velocity field before pressure correction

    void main () {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;

        // Pressure gradient: grad(P) = (dP/dx, dP/dy) approx 0.5 * (R-L, T-B)
        // Assuming unit grid spacing
        vec2 gradient = 0.5 * vec2(R - L, T - B);

        vec2 velocity = texture2D(uVelocity, vUv).xy;

        // Subtract gradient: v_new = v_old - gradient * dt / density
        // Assume dt/density factor is 1 or handled elsewhere
        velocity -= gradient;
        gl_FragColor = vec4(velocity, 0.0, 1.0);
    }
`;