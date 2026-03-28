const resolve = require('@rollup/plugin-node-resolve');
const commonjs = require('@rollup/plugin-commonjs');
const terser = require('@rollup/plugin-terser');
const typescript = require('@rollup/plugin-typescript');

module.exports = [
  // ESM
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.esm.js',
      format: 'esm',
      sourcemap: true,
    },
    plugins: [resolve(), commonjs(), typescript()],
  },
  // CJS
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.js',
      format: 'cjs',
      sourcemap: true,
      exports: 'named',
    },
    plugins: [resolve(), commonjs(), typescript()],
  },
  // UMD
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/trustline.umd.min.js',
      format: 'umd',
      name: 'trustline',
      sourcemap: true,
      exports: 'named',
    },
    plugins: [resolve(), commonjs(), typescript(), terser()],
  },
];
