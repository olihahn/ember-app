import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as photoView from '../lib/photo-view.ts';

interface RenderProps {
  className?: string;
  ref?: { current: unknown };
  onOpenChange?: (open: boolean) => void;
  onLoad?: (event: {
    currentTarget: { naturalWidth: number; naturalHeight: number };
  }) => void;
  onClick?: () => void;
  style?: { width: number; height: number; transform: string };
}

void test('reopening a retained photo viewer keeps its loaded image and resets zoom', () => {
  // Execute the real component, replacing only hooks, JSX and UI primitives.
  // Base UI retains the loaded image during its exit animation: reopening then
  // must not depend on another image load event. No DOM or device is involved.
  const slots: unknown[] = [];
  const nodes = new Map<unknown, RenderProps>();
  let cursor = 0;
  let effects: (() => unknown)[] = [];
  let open = false;
  const hooks = {
    useState<T>(initial: T) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [
        slots[index] as T,
        (next: T | ((current: T) => T)) => {
          slots[index] =
            typeof next === 'function'
              ? (next as (current: T) => T)(slots[index] as T)
              : next;
        },
      ];
    },
    useRef<T>(initial: T) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(effect: () => unknown) {
      effects.push(effect);
    },
  };
  const jsx = (type: unknown, props: RenderProps) => {
    nodes.set(props.className ?? type, props);
    return { type, props };
  };
  const componentModule = {
    exports: {} as {
      PhotoViewer: (props: {
        src: string;
        alt: string;
        open: boolean;
        onOpenChange: (next: boolean) => void;
      }) => unknown;
    },
  };
  const source = readFileSync(
    new URL('../components/PhotoViewer.tsx', import.meta.url),
    'utf8',
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  runInNewContext(compiled.outputText, {
    module: componentModule,
    exports: componentModule.exports,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    require(name: string) {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === '@/lib/photo-view') return photoView;
      if (name === '@/components/ui/dialog' || name === 'lucide-react')
        return new Proxy({}, { get: (_target, key) => key });
      throw new Error(`Unexpected component dependency: ${name}`);
    },
  });

  function node(name: string): RenderProps {
    const found = nodes.get(name);
    assert.ok(found, `Expected rendered ${name}`);
    return found;
  }
  function render() {
    cursor = 0;
    effects = [];
    nodes.clear();
    componentModule.exports.PhotoViewer({
      src: 'data:image/png;base64,AAAA',
      alt: 'Dummy photo',
      open,
      onOpenChange: (next) => {
        open = next;
      },
    });
    node('photo-viewer-viewport').ref!.current = {
      clientWidth: 360,
      clientHeight: 500,
    };
    effects.forEach((effect) => effect());
  }

  render();
  node('Dialog').onOpenChange!(true);
  render();
  node('img').onLoad!({
    currentTarget: { naturalWidth: 4000, naturalHeight: 6000 },
  });
  render();
  render(); // Render the viewport measurement produced by the effect.
  const fitted = node('img').style!;
  assert.ok(fitted.width > 0 && fitted.height > 0);
  node('photo-viewer-viewport').onClick!();
  render();
  assert.match(node('img').style!.transform, /scale\(1\.5\)/);

  node('Dialog').onOpenChange!(false);
  render();
  node('Dialog').onOpenChange!(true);
  render();
  render(); // Same retained image; intentionally do not fire onLoad again.
  assert.equal(node('img').style!.width, fitted.width);
  assert.equal(node('img').style!.height, fitted.height);
  assert.match(node('img').style!.transform, /scale\(1\)/);
});
