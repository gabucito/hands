// main.ts
import { getWebGLContext, compilePrograms, ext as webglExtensions } from './webglUtils'; // Import GL setup and extensions info
import {
    config,             // Simulation config
    initSimulation,     // Initializes FBOs, pointers
    step,               // Runs one simulation step
    render,             // Renders the current state
    applyInputs,        // Applies pointer movements, splat stack
    updateColors,       // Updates pointer colors over time
    handleResize,       // Handles simulation FBO resizing
    setSimulationCanvas,// Function to pass canvas ref to simulation
    triggerSplat,       // *** The single exposed click function ***
    pointers,           // Need direct access for input handling state update
    splatStack          // Need direct access for spacebar functionality
} from './fluidSimulation';
import type { IPointer } from './types'; // Type needed for pointers array

// --- Global Canvas Reference ---
// Attempt to find the canvas element on the page
const canvas = document.getElementsByTagName('canvas')[0] as HTMLCanvasElement;
// Throw an error if the canvas isn't found, as it's critical
if (!canvas) {
    throw new Error("Fluid Simulation Error: Canvas element not found in the HTML!");
}

// --- Pointer Update Utilities (Local to main.ts for input handling) ---
// These functions modify the `pointers` array imported from fluidSimulation.ts
function scaleByPixelRatio(input: number): number {
    const pixelRatio = window.devicePixelRatio || 1;
    return Math.floor(input * pixelRatio);
}

function updatePointerDownData(pointer: IPointer, id: number | string, posX: number, posY: number): void {
     if (!canvas) return;
    pointer.id = id;
    pointer.down = true;
    pointer.moved = false;
    pointer.texcoordX = posX / canvas.width;
    pointer.texcoordY = 1.0 - posY / canvas.height; // Flip Y-axis
    pointer.prevTexcoordX = pointer.texcoordX;
    pointer.prevTexcoordY = pointer.texcoordY;
    pointer.deltaX = 0;
    pointer.deltaY = 0;
    // Color is managed by updateColors, but ensure initial state has *some* color
    if (!pointer.color || pointer.color.length !== 3) {
       pointer.color = [0.1, 0.1, 0.1]; // Default initial color
    }
}

function updatePointerMoveData(pointer: IPointer, posX: number, posY: number): void {
    if (!canvas) return;
    pointer.prevTexcoordX = pointer.texcoordX;
    pointer.prevTexcoordY = pointer.texcoordY;
    pointer.texcoordX = posX / canvas.width;
    pointer.texcoordY = 1.0 - posY / canvas.height; // Flip Y
    const deltaX = pointer.texcoordX - pointer.prevTexcoordX;
    const deltaY = pointer.texcoordY - pointer.prevTexcoordY;
    pointer.deltaX = correctDeltaX(deltaX); // Correct for aspect ratio
    pointer.deltaY = correctDeltaY(deltaY); // Correct for aspect ratio
    // Set moved flag if there was significant movement
    pointer.moved = Math.abs(pointer.deltaX) > 1e-5 || Math.abs(pointer.deltaY) > 1e-5;
}

function updatePointerUpData(pointer: IPointer): void {
    pointer.down = false;
    pointer.moved = false; // Reset moved state on up
}

function correctDeltaX(delta: number): number {
    if (!canvas) return delta;
    const aspectRatio = canvas.width / canvas.height;
    // If canvas is taller than wide (aspectRatio < 1), scale down horizontal delta
    if (aspectRatio < 1) { delta *= aspectRatio; }
    return delta;
}

function correctDeltaY(delta: number): number {
    if (!canvas) return delta;
    const aspectRatio = canvas.width / canvas.height;
    // If canvas is wider than tall (aspectRatio > 1), scale down vertical delta
    if (aspectRatio > 1) { delta /= aspectRatio; }
    return delta;
}

// --- Input Handling Setup ---
function setupInputListeners() {
    // --- Mouse Events ---
    canvas.addEventListener('mousedown', (e: MouseEvent) => {
        if (!canvas) return;
        const posX = scaleByPixelRatio(e.offsetX);
        const posY = scaleByPixelRatio(e.offsetY);
        const normX = posX / canvas.width;
        const normY = 1.0 - posY / canvas.height; // Normalized Y flipped

        // *** Call the exposed splat function ***
        triggerSplat(normX, normY);

        // Update pointer state for potential dragging
        const pointer = pointers[0]; // Assume mouse is pointer 0
        if (pointer) updatePointerDownData(pointer, -1, posX, posY);
    });

    canvas.addEventListener('mousemove', (e: MouseEvent) => {
        const pointer = pointers[0]; // Mouse pointer
        if (!pointer || !pointer.down) return; // Only process if down
        const posX = scaleByPixelRatio(e.offsetX);
        const posY = scaleByPixelRatio(e.offsetY);
        updatePointerMoveData(pointer, posX, posY); // Updates state used by applyInputs
    });

    window.addEventListener('mouseup', (e: MouseEvent) => {
        const pointer = pointers[0]; // Mouse pointer
        if (pointer?.down) { // Use optional chaining
            updatePointerUpData(pointer);
        }
    });

    // --- Touch Events ---
    canvas.addEventListener('touchstart', (e: TouchEvent) => {
         if (!canvas) return;
         e.preventDefault(); // Prevent default touch actions like scrolling
         const touches = e.targetTouches;

         // Ensure pointers array has enough space (simple approach)
         while (touches.length + 1 > pointers.length) { // +1 for mouse pointer at index 0
              pointers.push({ id: -2 - pointers.length, texcoordX: 0, texcoordY: 0, prevTexcoordX: 0, prevTexcoordY: 0, deltaX: 0, deltaY: 0, down: false, moved: false, color: [0,0,0] });
         }

         for (let i = 0; i < touches.length; i++) {
             const touch = touches[i];
             // Calculate position relative to the canvas, considering scroll offset
             const rect = canvas.getBoundingClientRect();
             const posX = scaleByPixelRatio(touch.clientX - rect.left);
             const posY = scaleByPixelRatio(touch.clientY - rect.top);

             const normX = posX / canvas.width;
             const normY = 1.0 - posY / canvas.height; // Normalized Y flipped

              // *** Call the exposed splat function for touch ***
             triggerSplat(normX, normY);

             // Update pointer state for potential dragging
             const pointerIndex = i + 1; // Use indices 1+ for touches
             const pointer = pointers[pointerIndex];
             if(pointer) updatePointerDownData(pointer, touch.identifier, posX, posY);
         }
     }, { passive: false }); // Need passive: false because we call preventDefault

    canvas.addEventListener('touchmove', (e: TouchEvent) => {
         if (!canvas) return;
         e.preventDefault(); // Prevent scrolling during drag
         const touches = e.targetTouches;
         for (let i = 0; i < touches.length; i++) {
             const touch = touches[i];
             // Find the corresponding pointer
             const pointer = pointers.find(p => p.id === touch.identifier);
             if (!pointer || !pointer.down) continue;

             const rect = canvas.getBoundingClientRect();
             const posX = scaleByPixelRatio(touch.clientX - rect.left);
             const posY = scaleByPixelRatio(touch.clientY - rect.top);
             updatePointerMoveData(pointer, posX, posY); // Update state used by applyInputs
         }
     }, { passive: false });

     window.addEventListener('touchend', (e: TouchEvent) => {
         const touches = e.changedTouches;
         for (let i = 0; i < touches.length; i++) {
             const touch = touches[i];
             const pointer = pointers.find(p => p.id === touch.identifier);
             if (pointer) {
                 updatePointerUpData(pointer);
             }
         }
     });

     window.addEventListener('touchcancel', (e: TouchEvent) => {
         // Treat cancel the same as touchend for cleanup
         const touches = e.changedTouches;
         for (let i = 0; i < touches.length; i++) {
             const touch = touches[i];
             const pointer = pointers.find(p => p.id === touch.identifier);
             if (pointer) {
                 updatePointerUpData(pointer);
             }
         }
     });


    // --- Keyboard Events ---
    window.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.code === 'KeyP') { // Toggle Pause
            config.PAUSED = !config.PAUSED;
            console.log(`Simulation ${config.PAUSED ? 'Paused' : 'Resumed'}`);
        }
        if (e.key === ' ') { // Add random splats to stack
            splatStack.push(Math.floor(Math.random() * 20) + 5);
            console.log(`Added random splats to stack (current size: ${splatStack.length})`);
        }
        // Add other keybindings if desired (e.g., toggle settings)
    });

    console.log("Input listeners attached.");
}

// --- Initialization and Main Loop ---
let lastUpdateTime: number;

function init() {
    console.log("Starting initialization...");
    try {
        const { gl: localGl, ext: localExt } = getWebGLContext(canvas); 
        // Pass canvas ref to simulation module (needed for getResolution/correctRadius)
        setSimulationCanvas(canvas);

        // Init WebGL Context & Check Capabilities
        getWebGLContext(canvas); // Sets gl/ext in webglUtils
        console.log(`WebGL Context: ${localGl instanceof WebGL2RenderingContext ? 'WebGL2' : 'WebGL1'}`);
        console.log(`Linear Filtering Supported: ${webglExtensions.supportLinearFiltering}`);

        // Compile Shader Programs
        compilePrograms(); // Compiles programs in webglUtils

        // Init Simulation State (FBOs, pointers)
        initSimulation();

        // Setup Input Listeners
        setupInputListeners();

        // Add initial random splat for visual interest
        // multipleSplats(Math.floor(Math.random() * 20) + 5); // Functionality moved to fluidSimulation

        // Start the Update Loop
        lastUpdateTime = Date.now();
        requestAnimationFrame(updateLoop);

        console.log("Initialization complete. Starting simulation loop.");

    } catch (error) {
        console.error("Initialization failed:", error);
        // Display a user-friendly error message
        const errorDiv = document.createElement('div');
        errorDiv.style.position = 'fixed';
        errorDiv.style.top = '10px';
        errorDiv.style.left = '10px';
        errorDiv.style.padding = '10px';
        errorDiv.style.backgroundColor = 'rgba(255, 0, 0, 0.8)';
        errorDiv.style.color = 'white';
        errorDiv.style.fontFamily = 'sans-serif';
        errorDiv.style.zIndex = '1000';
        errorDiv.innerText = `Failed to initialize WebGL Fluid Simulation. Please ensure your browser supports WebGL${error instanceof Error ? `: ${error.message}` : ''}. Check the console for more details.`;
        document.body.appendChild(errorDiv);
    }
}

function updateLoop() {
    const dt = calcDeltaTime();

    // Check for canvas resize and notify simulation if needed
    if (resizeCanvas()) {
        handleResize();
    }

    updateColors(dt); // Update pointer colors
    applyInputs();    // Apply pointer movements and splat stack

    if (!config.PAUSED) {
        try {
            step(dt); // Run simulation step
        } catch(e) {
            console.error("Error during simulation step:", e);
            config.PAUSED = true; // Pause on error
        }
    }

    try {
        render(null); // Render to screen
    } catch(e) {
        console.error("Error during rendering:", e);
         config.PAUSED = true; // Pause on error
    }

    // Request the next frame
    requestAnimationFrame(updateLoop);
}

// --- Loop Helpers ---
function calcDeltaTime(): number {
    const now = Date.now();
    let dt = (now - lastUpdateTime) / 1000.0; // Delta time in seconds
    // Clamp delta time to prevent large jumps (e.g., if tab loses focus)
    // Max dt corresponds to minimum framerate (e.g., 0.05 -> 20fps)
    dt = Math.min(dt, 0.05);
    lastUpdateTime = now;
    return dt;
}

function resizeCanvas(): boolean {
     if (!canvas) return false;
    // Calculate desired buffer size based on display size and pixel ratio
    const displayWidth = scaleByPixelRatio(canvas.clientWidth);
    const displayHeight = scaleByPixelRatio(canvas.clientHeight);

    // Check if canvas buffer size needs resizing
    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
        canvas.width = displayWidth;   // Update canvas buffer width
        canvas.height = displayHeight; // Update canvas buffer height
        console.log(`Canvas resized to: ${displayWidth}x${displayHeight}`);
        return true; // Indicates resize happened
    }
    return false; // No resize needed
}


// --- Start Everything ---
// Wait for the DOM to be fully loaded before initializing
document.addEventListener('DOMContentLoaded', init);