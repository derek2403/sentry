// Shared behaviour for the floating panels (AI log, map):
// minimise to a small pill, and drag by the header to move.
window.SentryUI = (() => {
  "use strict";

  const MARGIN = 8;
  const ui = { dragging: false };

  const read = (key) => {
    try { return localStorage.getItem(key); } catch { return null; }
  };
  const write = (key, value) => {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {}
  };

  // Swap a panel for a pill button and back. Remembers the choice.
  ui.minimisable = ({ panel, pill, minButton, key, startMinimised = false }) => {
    const set = (min, moveFocus) => {
      // A panel that was dragged leaves its pill where the panel was.
      if (min && panel.style.left) {
        pill.style.left = panel.style.left;
        pill.style.top = panel.style.top;
      }
      panel.hidden = min;
      pill.hidden = !min;
      write(key, min ? "1" : "0");
      if (moveFocus) (min ? pill : minButton).focus();
    };
    minButton.addEventListener("click", () => set(true, true));
    pill.addEventListener("click", () => set(false, true));
    const saved = read(key);
    set(saved ? saved === "1" : startMinimised, false);
  };

  // Drag the panel by its handle; the size comes from the CSS resize corner.
  // Position and size are remembered. Double-click the handle to reset.
  ui.draggable = ({ panel, handle, key }) => {
    const place = (x, y) => {
      const w = panel.offsetWidth;
      const h = panel.offsetHeight;
      if (w) {
        x = Math.min(Math.max(MARGIN, x), window.innerWidth - w - MARGIN);
        y = Math.min(Math.max(MARGIN, y), window.innerHeight - h - MARGIN);
      }
      panel.style.left = `${Math.round(x)}px`;
      panel.style.top = `${Math.round(y)}px`;
    };

    const save = () => {
      if (!panel.style.left || !panel.offsetWidth) return;
      write(key, JSON.stringify({
        x: parseFloat(panel.style.left),
        y: parseFloat(panel.style.top),
        w: panel.offsetWidth,
        h: panel.offsetHeight,
      }));
    };

    try {
      const saved = JSON.parse(read(key) || "null");
      if (saved) {
        panel.style.width = `${saved.w}px`;
        panel.style.height = `${saved.h}px`;
        place(saved.x, saved.y);
      }
    } catch {}

    let start = null;
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("button")) return;
      const rect = panel.getBoundingClientRect();
      start = { px: e.clientX, py: e.clientY, x: rect.left, y: rect.top };
      handle.setPointerCapture(e.pointerId);
      panel.classList.add("is-dragging");
      ui.dragging = true;
    });
    handle.addEventListener("pointermove", (e) => {
      if (!start) return;
      place(start.x + e.clientX - start.px, start.y + e.clientY - start.py);
    });
    const end = () => {
      if (!start) return;
      start = null;
      panel.classList.remove("is-dragging");
      ui.dragging = false;
      save();
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);

    handle.addEventListener("dblclick", (e) => {
      if (e.target.closest("button")) return;
      for (const prop of ["left", "top", "width", "height"]) panel.style[prop] = "";
      write(key, null);
    });

    // Remember a new size from the resize corner, and keep the panel on screen.
    let resizeTimer;
    new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(save, 300);
    }).observe(panel);
    window.addEventListener("resize", () => {
      if (panel.style.left && panel.offsetWidth) place(parseFloat(panel.style.left), parseFloat(panel.style.top));
    });
  };

  return ui;
})();
