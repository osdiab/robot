// rollup.config.js
import typescript from '@rollup/plugin-typescript';

export default {
  input: ['machine.ts', 'debug.ts'],
  output: {
    dir: 'dist',
    format: 'cjs'
  },
  plugins: [typescript()]
};