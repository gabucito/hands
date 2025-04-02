// shaderSources.ts

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
    uniform vec4 color; // Expect rgba

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
        v = v * 0.1 + 0.8; // Checkered pattern calculation
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
    uniform sampler2D uTexture;   // Dye texture
    uniform sampler2D uBloom;     // Bloom texture
    uniform sampler2D uSunrays;   // Sunrays texture
    uniform sampler2D uDithering; // Dithering texture for bloom
    uniform vec2 ditherScale;     // Scale for dithering texture
    uniform vec2 texelSize;       // Texel size of the final render target

    // Function to convert linear color space to approximate sRGB
    vec3 linearToGamma (vec3 color) {
        color = max(color, vec3(0.0));
        // Slightly more accurate gamma correction exponent
        return max(1.055 * pow(color, vec3(1.0/2.4)) - 0.055, vec3(0.0));
    }

    void main () {
        vec3 c = texture2D(uTexture, vUv).rgb; // Sample the dye texture

    #ifdef SHADING // Apply simple shading based on neighbors
        vec3 lc = texture2D(uTexture, vL).rgb;
        vec3 rc = texture2D(uTexture, vR).rgb;
        vec3 tc = texture2D(uTexture, vT).rgb;
        vec3 bc = texture2D(uTexture, vB).rgb;

        float dx = length(rc) - length(lc); // Horizontal gradient
        float dy = length(tc) - length(bc); // Vertical gradient

        // Estimate normal vector (simple method)
        vec3 n = normalize(vec3(dx, dy, max(length(texelSize) * 2.0, 0.0001))); // Adjust Z component scaling?
        vec3 l = normalize(vec3(0.0, 0.0, 1.0)); // Simple light direction (from view)

        // Basic diffuse lighting model
        float diffuse = clamp(dot(n, l) * 0.3 + 0.7, 0.7, 1.0); // Modulate diffuse term
        c *= diffuse;
    #endif

    #ifdef BLOOM // Add bloom effect if enabled
        vec3 bloom = texture2D(uBloom, vUv).rgb;
    #endif

    #ifdef SUNRAYS // Modulate by sunrays if enabled
        float sunrays = texture2D(uSunrays, vUv).r; // Assuming sunrays stored in red channel
        c *= sunrays;
        #ifdef BLOOM // Also modulate bloom by sunrays?
            bloom *= sunrays;
        #endif
    #endif

    #ifdef BLOOM // Apply dithering and add bloom
        // Sample dithering texture
        float noise = texture2D(uDithering, vUv * ditherScale).r;
        noise = noise * 2.0 - 1.0; // Remap from [0, 1] to [-1, 1]
        // Add scaled noise to bloom. Adjust noise strength (e.g., / 255.0)
        bloom += noise / 255.0;
        bloom = linearToGamma(bloom); // Apply gamma correction to bloom before adding
        c += bloom; // Add gamma-corrected bloom
    #endif

    // Calculate final alpha based on max color component for visibility
    float a = max(c.r, max(c.g, c.b));
    gl_FragColor = vec4(c, clamp(a, 0.0, 1.0)); // Ensure alpha is clamped [0, 1]
    }
`;

export const bloomPrefilterShaderSource = `
    precision mediump float;
    precision mediump sampler2D;
    varying vec2 vUv;
    uniform sampler2D uTexture; // Input texture (dye)
    uniform vec3 curve; // x = threshold - knee, y = knee * 2, z = 0.25 / knee
    uniform float threshold;

    void main () {
        vec3 c = texture2D(uTexture, vUv).rgb;
        float br = max(c.r, max(c.g, c.b)); // Calculate brightness

        // Apply soft knee curve to brightness
        float rq = clamp(br - curve.x, 0.0, curve.y);
        rq = curve.z * rq * rq;

        // Combine soft threshold with hard threshold: only affect pixels above threshold
        c *= max(rq, step(threshold, br)) / max(br, 0.0001); // Avoid division by zero

        gl_FragColor = vec4(c, 1.0); // Output prefiltered color, alpha = 1
    }
`;

export const bloomBlurShaderSource = `
    precision mediump float;
    precision mediump sampler2D;
    varying vec2 vL; // Texcoord left
    varying vec2 vR; // Texcoord right
    varying vec2 vT; // Texcoord top
    varying vec2 vB; // Texcoord bottom
    uniform sampler2D uTexture; // Texture to blur

    void main () {
        // Simple 4-tap box blur
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
    varying vec2 vUv; // Use vUv for center sampling
    uniform sampler2D uTexture; // Final combined bloom texture (before intensity)
    uniform float intensity;

    void main () {
        vec4 bloomColor = texture2D(uTexture, vUv);
        gl_FragColor = bloomColor * intensity; // Apply final intensity
    }
`;

export const sunraysMaskShaderSource = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uTexture; // Original scene texture (dye)

    void main () {
        vec4 c = texture2D(uTexture, vUv);
        // Create mask based on brightness - brighter areas block less light
        float br = max(c.r, max(c.g, c.b));
        // Adjust masking parameters (multiplier 20.0, clamp max 0.8) as needed
        float maskValue = 1.0 - clamp(br * 20.0, 0.0, 0.8); // Inverted mask

        // Store mask in R channel (consistent with sunrays shader sampling R)
         gl_FragColor = vec4(maskValue, maskValue, maskValue, 1.0);
    }
`;

export const sunraysShaderSource = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uTexture; // Sunrays mask texture (mask value in R channel)
    uniform float weight;       // Overall weight/intensity of the sunrays effect

    #define ITERATIONS 16 // Number of samples along the ray

    void main () {
        // Volumetric scattering parameters (adjust as needed)
        float Density = 0.3;  // Controls how much light is scattered per step
        float Decay = 0.95; // How much light is lost per step (attenuation)
        float Exposure = 0.7; // Final intensity adjustment

        vec2 coord = vUv; // Current coordinate along the ray
        vec2 lightPos = vec2(0.5, 0.5); // Assume light source at the center for simplicity
        vec2 deltaTexCoord = coord - lightPos; // Vector from light to fragment

        // Calculate step size along the ray
        deltaTexCoord *= 1.0 / float(ITERATIONS) * Density;

        float illuminationDecay = 1.0; // Light strength starts at 1

        // Sample initial color (mask value) at the fragment's coordinate
        float color = texture2D(uTexture, vUv).r; // Read mask value from R channel

        // Ray marching loop toward the light source
        for (int i = 0; i < ITERATIONS; i++)
        {
            // Step toward the light source
            coord -= deltaTexCoord;

            // Sample the mask texture at the new coordinate
            float sample = texture2D(uTexture, coord).r; // Read mask value

            // Add contribution from this sample, modulated by illumination decay and weight
            color += sample * illuminationDecay * weight;

            // Decrease illumination for next step
            illuminationDecay *= Decay;
        }

        // Output final color multiplied by exposure
        // Store result primarily in red channel for consistency with display shader reading .r
        gl_FragColor = vec4(color * Exposure, 0.0, 0.0, 1.0);
    }
`;


export const splatShaderSource = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uTarget; // Texture to splat onto (velocity or dye)
    uniform float aspectRatio;
    uniform vec3 color;       // Color or velocity delta to splat
    uniform vec2 point;       // Splat center in texture coordinates [0, 1]
    uniform float radius;      // Splat radius (already corrected for aspect ratio)

    void main () {
        vec2 p = vUv - point.xy;
        // Aspect ratio correction is now handled *before* calling the shader via correctRadius
        // p.x *= aspectRatio; // No longer needed here if radius is pre-corrected

        // Gaussian splat formula (squared distance)
        float sqDist = dot(p, p);
        // Ensure radius is positive and non-zero before division
        float safeRadiusSq = max(radius * radius, 0.000001); // Compare squared radius
        float splatValue = exp(-sqDist / safeRadiusSq);

        vec3 splat = splatValue * color;

        // Read base value (handle vec2 for velocity, vec3 for color)
        // This requires knowing what uTarget represents. Assume vec3 for simplicity here.
        // A better approach might use different shaders or uniforms.
        vec3 base = texture2D(uTarget, vUv).rgb; // Read RGB (for dye)

        // Add splat to the base texture color
        gl_FragColor = vec4(base + splat, 1.0); // Output combined color, alpha = 1
    }
`;

export const advectionShaderSource = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uVelocity; // Velocity field
    uniform sampler2D uSource;   // Texture being advected (dye or velocity itself)
    uniform vec2 texelSize;      // Texel size of uVelocity texture = (1/width, 1/height)
    uniform vec2 dyeTexelSize;   // Texel size of dye texture (if different, used in MANUAL_FILTERING)
    uniform float dt;            // Timestep
    uniform float dissipation;   // How much the quantity dissipates over time

    // Bilinear interpolation function (only used if MANUAL_FILTERING is defined)
    vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
        vec2 st = uv / tsize - 0.5; // Sample coordinates relative to texel centers
        vec2 iuv = floor(st);       // Integer part (texel index)
        vec2 fuv = fract(st);       // Fractional part (interpolation weights)

        // Sample the four neighboring texels
        vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize); // Bottom-left
        vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize); // Bottom-right
        vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize); // Top-left
        vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize); // Top-right

        // Interpolate horizontally, then vertically
        return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
    }

    void main () {
        // 1. Sample velocity at the current fragment's position (vUv)
        vec2 vel = texture2D(uVelocity, vUv).xy;

        // 2. Calculate the departure point (where the particle came from)
        //    Go back in time by dt along the velocity vector.
        //    Velocity 'vel' is assumed to be in normalized texture space units per second?
        //    Or does it need scaling by texelSize? Let's assume normalized units/sec.
        //    coord = vUv - dt * vel * texelSize; // If vel is grid units/sec
        vec2 coord = vUv - dt * vel; // If vel is texture units/sec

        // 3. Sample the source texture at the departure point
        vec4 result;
        #ifdef MANUAL_FILTERING
            // Use custom bilinear interpolation
            vec2 sourceTexelSize = dyeTexelSize; // Assume manual filtering uses dye size
            result = bilerp(uSource, coord, sourceTexelSize);
        #else
            // Rely on hardware linear filtering (requires GL_LINEAR sampler setting)
            result = texture2D(uSource, coord);
        #endif

        // 4. Apply dissipation (decay)
        float decayFactor = 1.0 / (1.0 + dissipation * dt); // Ensure decay doesn't amplify
        // Alternative: float decayFactor = exp(-dissipation * dt);
        gl_FragColor = result * decayFactor;
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
        // Sample velocity components at neighbors
        float L = texture2D(uVelocity, vL).x; // vx left
        float R = texture2D(uVelocity, vR).x; // vx right
        float T = texture2D(uVelocity, vT).y; // vy top
        float B = texture2D(uVelocity, vB).y; // vy bottom

        // Simple boundary handling: reflect velocity component from inside
        vec2 C = texture2D(uVelocity, vUv).xy; // Center velocity
        // Use small epsilon to avoid issues exactly at 0.0 or 1.0
        float eps = 0.01;
        if (vL.x < eps) L = C.x; // If at left edge, use center x-velocity instead of sample outside
        if (vR.x > 1.0 - eps) R = C.x; // If at right edge, use center x-velocity
        if (vB.y < eps) B = C.y; // If at bottom edge, use center y-velocity
        if (vT.y > 1.0 - eps) T = C.y; // If at top edge, use center y-velocity

        // Central difference approximation of divergence: d(vx)/dx + d(vy)/dy
        // Assumes grid spacing dx=dy=1 (handled by varying coordinates)
        float div = 0.5 * (R - L + T - B);

        gl_FragColor = vec4(div, 0.0, 0.0, 1.0); // Output divergence (scalar)
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
        // Sample velocity components at neighbors
        float L = texture2D(uVelocity, vL).y; // vy left
        float R = texture2D(uVelocity, vR).y; // vy right
        float T = texture2D(uVelocity, vT).x; // vx top
        float B = texture2D(uVelocity, vB).x; // vx bottom

        // Central difference approximation of 2D curl (z-component): d(vy)/dx - d(vx)/dy
        // Assumes grid spacing dx=dy=1
        float vorticity = R - L - (T - B);

        gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0); // Output curl (scaled)
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
    uniform sampler2D uCurl;     // Curl (vorticity) field (scalar in R channel)
    uniform float curl;          // Vorticity confinement strength coefficient
    uniform float dt;            // Timestep

    void main () {
        // Sample curl (vorticity) at neighbors and center
        float L = texture2D(uCurl, vL).x;
        float R = texture2D(uCurl, vR).x;
        float T = texture2D(uCurl, vT).x;
        float B = texture2D(uCurl, vB).x;
        float C = texture2D(uCurl, vUv).x; // Vorticity (scalar) at center

        // Calculate gradient of vorticity magnitude (|w|)
        // Use absolute values for magnitude gradient
        vec2 gradient = 0.5 * vec2(abs(R) - abs(L), abs(T) - abs(B));

        // Normalize gradient: N = normalize(gradient(|w|))
        // Add a small epsilon to prevent division by zero and instability
        vec2 N = normalize(gradient + vec2(1e-5));

        // Vorticity confinement force: F = curl_strength * (N x w_vector)
        // In 2D, w_vector = (0, 0, C), N = (Nx, Ny, 0)
        // N x w_vector = (Ny*C, -Nx*C, 0)
        // Force in 2D plane: F_2D = curl_strength * vec2(N.y, -N.x) * C
        vec2 force = curl * vec2(N.y, -N.x) * C;

        // Get the current velocity
        vec2 velocity = texture2D(uVelocity, vUv).xy;

        // Add the vorticity confinement force (scaled by dt) to the velocity
        velocity += force * dt;

        // Optional: Clamp velocity to prevent instability (can be useful)
        // velocity = clamp(velocity, -1000.0, 1000.0);

        // Output the new velocity
        gl_FragColor = vec4(velocity, 0.0, 1.0); // Store velocity in rg, alpha 1
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
        // Sample pressure at neighbors (from previous iteration)
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;

        // Sample divergence at the current texel
        float divergence = texture2D(uDivergence, vUv).x;

        // Simple Neumann boundary for pressure (zero gradient: reflect internal pressure)
        // Improves stability at edges.
        float C = texture2D(uPressure, vUv).x; // Center pressure for boundary reflection
        float eps = 0.01;
        if (vL.x < eps) L = R; // If at left edge, use right pressure
        if (vR.x > 1.0 - eps) R = L; // If at right edge, use left pressure
        if (vB.y < eps) B = T; // If at bottom edge, use top pressure
        if (vT.y > 1.0 - eps) T = B; // If at top edge, use bottom pressure

        // Jacobi iteration for Poisson equation: laplacian(P) = divergence
        // P_new(i,j) = ( P_old(i-1,j) + P_old(i+1,j) + P_old(i,j-1) + P_old(i,j+1) - divergence(i,j) * dx^2 ) / 4
        // Assuming dx=dy=1 (unit grid spacing) and divergence term is already scaled appropriately.
        float pressure = (L + R + B + T - divergence) * 0.25;

        // Output the updated pressure value
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
    uniform sampler2D uPressure; // Final pressure field (after iterations)
    uniform sampler2D uVelocity; // Velocity field before pressure correction

    void main () {
        // Sample pressure at neighbors
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;

        // Calculate the pressure gradient using central differences: grad(P) = (dP/dx, dP/dy)
        // dP/dx approx (R - L) / (2 * dx), dP/dy approx (T - B) / (2 * dy)
        // Assuming dx=dy=1 (unit spacing)
        vec2 gradient = 0.5 * vec2(R - L, T - B);

        // Sample the intermediate velocity (before pressure correction)
        vec2 velocity = texture2D(uVelocity, vUv).xy;

        // Subtract the pressure gradient from the velocity field
        // v_new = v_intermediate - grad(P) * (dt / density)
        // This code assumes dt/density scaling factors are implicitly 1 or handled elsewhere.
        velocity -= gradient;

        // Output the divergence-free velocity
        gl_FragColor = vec4(velocity, 0.0, 1.0);
    }
`;