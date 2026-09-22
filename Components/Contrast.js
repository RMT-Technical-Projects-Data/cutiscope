import React from 'react';
import { Surface } from 'gl-react-native';
import { Node, Shaders } from 'gl-react';

const shaders = Shaders.create({
  contrast: {
    frag: `
    precision highp float;
    varying vec2 uv;
    uniform sampler2D tex;
    uniform float contrast;

    void main() {
      vec4 color = texture2D(tex, uv);
      color.rgb /= color.a + 0.00001;
      color.rgb = ((color.rgb - 0.5) * max(contrast, 0.0)) + 0.5;
      color.rgb *= color.a;
      gl_FragColor = color;
    }`
  }
});

const Contrast = ({ contrast, children }) => (
  <Node
    shader={shaders.contrast}
    uniforms={{
      tex: children,
      contrast: contrast,
    }}
  />
);

export default Contrast;