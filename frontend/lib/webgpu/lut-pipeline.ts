import type { ParsedCube } from "../cube";
import { LUT_SHADER } from "./shader";

export type LutPipeline = {
  setLut(cube: ParsedCube): void;
  setIntensity(v: number): void;
  setSplit(enabled: boolean, position: number): void;
  draw(): void;
  destroy(): void;
};

/**
 * Build a WebGPU pipeline that samples an HTMLVideoElement and a 3D LUT,
 * then writes the graded frame to a <canvas>.
 *
 * Caller is responsible for driving draw() — typically from requestVideoFrameCallback
 * or requestAnimationFrame.
 */
export async function createLutPipeline(args: {
  canvas: HTMLCanvasElement;
  video: HTMLVideoElement;
}): Promise<LutPipeline> {
  if (!("gpu" in navigator)) {
    throw new Error("WebGPU is not available in this browser");
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("no WebGPU adapter");
  const device = await adapter.requestDevice();

  const context = args.canvas.getContext("webgpu");
  if (!context) throw new Error("could not get WebGPU canvas context");

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: "premultiplied",
  });

  const module = device.createShaderModule({ code: LUT_SHADER });

  const linearSampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  });
  const lutSampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    addressModeW: "clamp-to-edge",
  });

  const paramsBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const params = new Float32Array([1, 1, 0, 0]); // intensity, split, enable_split, pad

  // 3D LUT texture: start with a 2x2x2 identity until the first setLut() call.
  let lutTexture = device.createTexture({
    size: [2, 2, 2],
    dimension: "3d",
    format: "rgba32float",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  writeIdentityLut(device, lutTexture, 2);

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vs_main" },
    fragment: {
      module,
      entryPoint: "fs_main",
      targets: [{ format }],
    },
    primitive: { topology: "triangle-list" },
  });

  function buildBindGroup(externalTex: GPUExternalTexture) {
    return device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: externalTex },
        { binding: 1, resource: linearSampler },
        { binding: 2, resource: lutTexture.createView() },
        { binding: 3, resource: lutSampler },
        { binding: 4, resource: { buffer: paramsBuffer } },
      ],
    });
  }

  device.queue.writeBuffer(paramsBuffer, 0, params);

  function draw(): void {
    if (args.video.readyState < 2) return;

    const externalTex = device.importExternalTexture({ source: args.video });
    const bindGroup = buildBindGroup(externalTex);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context!.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3, 1, 0, 0);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  function setLut(cube: ParsedCube): void {
    // Recreate texture if the size changed.
    lutTexture.destroy();
    lutTexture = device.createTexture({
      size: [cube.size, cube.size, cube.size],
      dimension: "3d",
      format: "rgba32float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture: lutTexture },
      cube.data.buffer as ArrayBuffer,
      {
        bytesPerRow: cube.size * 4 * 4,
        rowsPerImage: cube.size,
      },
      { width: cube.size, height: cube.size, depthOrArrayLayers: cube.size },
    );
  }

  function setIntensity(v: number): void {
    params[0] = Math.max(0, Math.min(1, v));
    device.queue.writeBuffer(paramsBuffer, 0, params);
  }

  function setSplit(enabled: boolean, position: number): void {
    params[1] = Math.max(0, Math.min(1, position));
    params[2] = enabled ? 1 : 0;
    device.queue.writeBuffer(paramsBuffer, 0, params);
  }

  function destroy(): void {
    lutTexture.destroy();
    device.destroy();
  }

  return { setLut, setIntensity, setSplit, draw, destroy };
}

function writeIdentityLut(
  device: GPUDevice,
  tex: GPUTexture,
  n: number,
): void {
  const data = new Float32Array(n * n * n * 4);
  let j = 0;
  for (let b = 0; b < n; b++) {
    const bv = b / (n - 1 || 1);
    for (let g = 0; g < n; g++) {
      const gv = g / (n - 1 || 1);
      for (let r = 0; r < n; r++) {
        const rv = r / (n - 1 || 1);
        data[j++] = rv;
        data[j++] = gv;
        data[j++] = bv;
        data[j++] = 1.0;
      }
    }
  }
  device.queue.writeTexture(
    { texture: tex },
    data.buffer as ArrayBuffer,
    { bytesPerRow: n * 4 * 4, rowsPerImage: n },
    { width: n, height: n, depthOrArrayLayers: n },
  );
}
