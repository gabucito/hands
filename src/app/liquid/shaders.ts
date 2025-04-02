export const utility_neightbors = `
struct Neighbors {
  vec4 l;
  vec4 r;
  vec4 t;
  vec4 b;
  vec4 c;
};

Neighbors tex_neighbors(sampler2D tex, ivec2 pos) {
  vec4 b = texelFetch(tex, pos - ivec2(0, 1), 0);
  vec4 t = texelFetch(tex, pos + ivec2(0, 1), 0);
  vec4 l = texelFetch(tex, pos - ivec2(1, 0), 0);
  vec4 r = texelFetch(tex, pos + ivec2(1, 0), 0);
  vec4 c = texelFetch(tex, pos, 0);
  return Neighbors(l, r, t, b, c);
}` 

export const base_vs = `#version 300 es
in vec2 a_position;
out vec2 v_position;

void main() {
  v_position = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0, 1);
}`;

export const advection_fs = `#version 300 es
precision highp float;

uniform sampler2D u_v;
uniform sampler2D u_x;
uniform float u_dt;
uniform float u_dissipation;
out vec4 res;

vec4 bilerp(sampler2D tex, vec2 x_norm, vec2 size) {
  vec2 x = x_norm * size - 0.5;
  vec2 fx = fract(x);
  ivec2 ix = ivec2(floor(x));

  vec4 x00 = texelFetch(tex, ix + ivec2(0,0), 0);
  vec4 x01 = texelFetch(tex, ix + ivec2(0,1), 0);
  vec4 x10 = texelFetch(tex, ix + ivec2(1,0), 0);
  vec4 x11 = texelFetch(tex, ix + ivec2(1,1), 0);

  return mix(mix(x00, x10, fx.x), mix(x01, x11, fx.x), fx.y);
}

void main() {
  vec2 size_v = vec2(textureSize(u_v, 0));
  vec2 size_x = vec2(textureSize(u_x, 0));
  vec2 aspect_ratio = vec2(size_x.x / size_x.y, 1.0);
  vec2 normalized_pos = gl_FragCoord.xy / size_x;
  vec2 prev = normalized_pos - u_dt * bilerp(u_v, normalized_pos, size_v).xy / aspect_ratio; 
  res = u_dissipation * bilerp(u_x, prev, size_x);
}`

export const jacobi_fs = `#version 300 es
precision highp float;

uniform sampler2D u_x;
uniform sampler2D u_b;
uniform float u_alpha;
uniform float u_beta;
out vec4 res;

${utility_neightbors}

void main() {
  ivec2 pos = ivec2(gl_FragCoord.xy); 
  Neighbors n = tex_neighbors(u_x, pos);
  vec4 b = texelFetch(u_b, pos, 0);
  res = (n.b + n.t + n.l + n.r + u_alpha * b) / u_beta;
}`

export const subtract_grad_fs = `#version 300 es
precision highp float;

uniform sampler2D u_v;
uniform sampler2D u_p;
out vec4 res;

${utility_neightbors}

void main() {
  ivec2 pos = ivec2(gl_FragCoord.xy); 
  Neighbors n = tex_neighbors(u_p, pos);

  vec4 grad = vec4(n.r.x - n.l.x, n.t.x - n.b.x, 0, 0) / 2.;
  vec4 init_v = texelFetch(u_v, pos, 0);
  res = init_v - grad;
}`

export const div_fs = `#version 300 es
precision highp float;

uniform sampler2D u_x;
out vec4 res;

${utility_neightbors}

void main() {
  ivec2 pos = ivec2(gl_FragCoord.xy); 
  Neighbors n = tex_neighbors(u_x, pos);

  float div = (n.r.x - n.l.x + n.t.y - n.b.y) / 2.;

  res = vec4(div, 0, 0, 1);
}`

export const boundary_fs = `#version 300 es
precision highp float;

in vec2 v_position;
uniform sampler2D u_x;
uniform vec2 u_res;
uniform float u_alpha;
out vec4 res;

void main() {
  vec2 dir = vec2(0, 0);
  dir += vec2(lessThan(v_position, u_res));
  dir -= vec2(greaterThan(v_position, vec2(1.0) - u_res));
  float coef = length(dir) > 0.0 ? u_alpha : 1.0;
  res = coef * texture(u_x, v_position + dir * u_res);
}`;

export const display_fs = `#version 300 es
precision highp float;

in vec2 v_position;
uniform sampler2D u_x;
uniform float u_alpha;
out vec4 res;

void main() {
  res = u_alpha * texture(u_x, v_position);
}`;

export const splat_fs = `#version 300 es
precision highp float;

in vec2 v_position;
uniform sampler2D u_x;
uniform vec2 u_point;
uniform vec3 u_value;
uniform float u_radius;
uniform float u_ratio;
out vec4 res;

void main() {
  vec4 init = texture(u_x, v_position);
  vec2 v = v_position - u_point;
  v.x *= u_ratio;
  vec3 force = exp(-dot(v,v)/u_radius) * u_value;

  res = vec4(init.xyz + force, 1.);
}`;