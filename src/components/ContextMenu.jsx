import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon, Kbd } from './ui.jsx';

const Ctx = createContext(() => {});

/** Right-click menus anywhere: const openMenu = useMenu(); onContextMenu={(e) => openMenu(e, items)} */
export function useMenu() {
  return useContext(Ctx);
}

export function MenuProvider({ children }) {
  const [menu, setMenu] = useState(null);
  const open = useCallback((e, items) => {
    e.preventDefault();
    e.stopPropagation();
    const list = (items || []).filter(Boolean);
    if (!list.length) return;
    setMenu({ x: e.clientX, y: e.clientY, items: list, key: Date.now() });
  }, []);
  return (
    <Ctx.Provider value={open}>
      {children}
      {menu && <Menu {...menu} onClose={() => setMenu(null)} />}
    </Ctx.Provider>
  );
}

function Menu({ x, y, items, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y, ready: false });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - r.width - 8);
    const top = y + r.height > window.innerHeight - 8 ? Math.max(8, y - r.height) : y;
    setPos({ left, top, ready: true });
  }, [x, y]);
  useEffect(() => {
    const down = (e) => ref.current && !ref.current.contains(e.target) && onClose();
    const key = (e) => e.key === 'Escape' && onClose();
    const t = setTimeout(() => {
      window.addEventListener('pointerdown', down, true);
      window.addEventListener('contextmenu', down, true);
    }, 0);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('contextmenu', down, true);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="ctx-menu" style={{ left: pos.left, top: pos.top, opacity: pos.ready ? 1 : 0 }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) =>
        it === '-' || it.sep ? (
          <div key={i} className="ctx-sep" />
        ) : it.head ? (
          <div key={i} className="ctx-head">
            {it.head}
          </div>
        ) : (
          <button
            key={i}
            className={`ctx-item ${it.danger ? 'danger' : ''} ${it.primary ? 'primary' : ''}`}
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onClick && it.onClick();
            }}
          >
            {it.icon ? <Icon name={it.icon} size={14} /> : <span className="ctx-ico" />}
            <span className="ctx-label">{it.label}</span>
            {it.kbd && <Kbd>{it.kbd}</Kbd>}
          </button>
        )
      )}
    </div>
  );
}
