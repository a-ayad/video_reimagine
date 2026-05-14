export const LUT_SHADER = /* wgsl */ `
struct VsOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VsOut {
  // Full-screen triangle
  let pos = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0),
  );
  let uv = array<vec2f, 3>(
    vec2f(0.0, 1.0),
    vec2f(2.0, 1.0),
    vec2f(0.0, -1.0),
  );
  var out: VsOut;
  out.position = vec4f(pos[vi], 0.0, 1.0);
  out.uv = uv[vi];
  return out;
}

struct Params {
  intensity: f32,
  split: f32,        // 0..1; below this UV.x show original, above show graded; 1 = all graded
  enable_split: f32, // 0 or 1
  _pad: f32,
};

@group(0) @binding(0) var src_tex: texture_external;
@group(0) @binding(1) var src_samp: sampler;
@group(0) @binding(2) var lut_tex: texture_3d<f32>;
@group(0) @binding(3) var lut_samp: sampler;
@group(0) @binding(4) var<uniform> u: Params;

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  let src = textureSampleBaseClampToEdge(src_tex, src_samp, in.uv);
  let lut_uv = clamp(src.rgb, vec3f(0.0), vec3f(1.0));
  let graded = textureSample(lut_tex, lut_samp, lut_uv).rgb;
  let mixed = mix(src.rgb, graded, u.intensity);

  let use_graded = (u.enable_split < 0.5) || (in.uv.x > u.split);
  let out_rgb = select(src.rgb, mixed, use_graded);
  return vec4f(out_rgb, 1.0);
}
`;
