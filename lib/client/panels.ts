"use client";

// Shared behaviour for the floating panels (AI log, map):
// minimise to a small pill, and drag by the header to move.

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

const MARGIN = 8;

/** True while a panel is being dragged, so the camera view doesn't swing. */
export const panelDrag = { active: false };

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string | null) => {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the layout just isn't remembered.
  }
};

/**
 * Swap a panel for a pill button and back. Remembers the choice in this browser.
 * `startMinimisedWhen` is a media query: with no saved choice, start minimised if it matches.
 */
export function useMinimised(key: string, startMinimisedWhen?: string): [boolean, (min: boolean) => void] {
  const [minimised, setMinimised] = useState(false);

  // Read the saved choice after mount (localStorage isn't available during server rendering).
  useEffect(() => {
    const saved = read(key);
    const byScreen = startMinimisedWhen ? window.matchMedia(startMinimisedWhen).matches : false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from browser storage once on mount
    setMinimised(saved ? saved === "1" : byScreen);
  }, [key, startMinimisedWhen]);

  const set = useCallback(
    (min: boolean) => {
      setMinimised(min);
      write(key, min ? "1" : "0");
    },
    [key],
  );
  return [minimised, set];
}

/**
 * Drag the panel by its handle; the size comes from the CSS resize corner.
 * Position and size are remembered. Double-click the handle to reset.
 */
export function useDraggable<P extends HTMLElement, H extends HTMLElement>(
  key: string,
): { panel: RefObject<P | null>; handle: RefObject<H | null> } {
  const panel = useRef<P>(null);
  const handle = useRef<H>(null);
  const start = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const p = panel.current;
    const h = handle.current;
    if (!p || !h) return;

    const place = (x: number, y: number) => {
      const w = p.offsetWidth;
      const ht = p.offsetHeight;
      if (w) {
        x = Math.min(Math.max(MARGIN, x), window.innerWidth - w - MARGIN);
        y = Math.min(Math.max(MARGIN, y), window.innerHeight - ht - MARGIN);
      }
      p.style.left = `${Math.round(x)}px`;
      p.style.top = `${Math.round(y)}px`;
    };
    const save = () => {
      if (!p.style.left || !p.offsetWidth) return;
      write(key, JSON.stringify({ x: parseFloat(p.style.left), y: parseFloat(p.style.top), w: p.offsetWidth, h: p.offsetHeight }));
    };

    try {
      const saved = JSON.parse(read(key) || "null") as { x: number; y: number; w: number; h: number } | null;
      if (saved) {
        p.style.width = `${saved.w}px`;
        p.style.height = `${saved.h}px`;
        place(saved.x, saved.y);
      }
    } catch {
      // Ignore a corrupt saved layout.
    }

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
      const rect = p.getBoundingClientRect();
      start.current = { px: e.clientX, py: e.clientY, x: rect.left, y: rect.top };
      h.setPointerCapture(e.pointerId);
      p.classList.add("is-dragging");
      panelDrag.active = true;
    };
    const onMove = (e: PointerEvent) => {
      const s = start.current;
      if (s) place(s.x + e.clientX - s.px, s.y + e.clientY - s.py);
    };
    const onEnd = () => {
      if (!start.current) return;
      start.current = null;
      p.classList.remove("is-dragging");
      panelDrag.active = false;
      save();
    };
    const onDblClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      for (const prop of ["left", "top", "width", "height"] as const) p.style[prop] = "";
      write(key, null);
    };
    const onWindowResize = () => {
      if (p.style.left && p.offsetWidth) place(parseFloat(p.style.left), parseFloat(p.style.top));
    };

    // Remember a new size from the resize corner.
    let resizeTimer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(save, 300);
    });
    observer.observe(p);

    h.addEventListener("pointerdown", onDown);
    h.addEventListener("pointermove", onMove);
    h.addEventListener("pointerup", onEnd);
    h.addEventListener("pointercancel", onEnd);
    h.addEventListener("dblclick", onDblClick);
    window.addEventListener("resize", onWindowResize);
    return () => {
      observer.disconnect();
      clearTimeout(resizeTimer);
      h.removeEventListener("pointerdown", onDown);
      h.removeEventListener("pointermove", onMove);
      h.removeEventListener("pointerup", onEnd);
      h.removeEventListener("pointercancel", onEnd);
      h.removeEventListener("dblclick", onDblClick);
      window.removeEventListener("resize", onWindowResize);
    };
  }, [key]);

  return { panel, handle };
}
