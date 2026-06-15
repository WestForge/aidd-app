import Prism from 'prismjs/prism.js';

const globalScope = globalThis as typeof globalThis & { Prism?: typeof Prism };

globalScope.Prism = Prism;

if (typeof window !== 'undefined') {
  (window as Window & { Prism?: typeof Prism }).Prism = Prism;
}

export default Prism;
