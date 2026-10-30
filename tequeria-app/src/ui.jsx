/* Diálogos y avisos accesibles: role="dialog", foco contenido, Escape,
   restitución del foco al cerrar y anuncios con aria-live. */
import React, { useState, useEffect, useRef, useId } from "react";
import { X } from "lucide-react";

const ENFOCABLES = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ titulo, icono, onClose, cerrable = true, className = "", children }) {
  const ref = useRef(null);
  const idTitulo = useId();
  const cerrar = useRef(onClose);
  cerrar.current = onClose;

  useEffect(() => {
    const nodo = ref.current;
    const previo = document.activeElement;
    const enfocables = () => [...nodo.querySelectorAll(ENFOCABLES)].filter((el) => el.getClientRects().length > 0);
    const inicial = nodo.querySelector("[data-autofocus]") || enfocables()[0] || nodo;
    inicial.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === "Escape" && cerrable && cerrar.current) {
        e.preventDefault(); e.stopPropagation(); cerrar.current();
        return;
      }
      if (e.key !== "Tab") return;
      const els = enfocables();
      if (els.length === 0) { e.preventDefault(); return; }
      const primero = els[0], ultimo = els[els.length - 1];
      if (e.shiftKey && (document.activeElement === primero || document.activeElement === nodo)) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
    };
    nodo.addEventListener("keydown", onKey);
    return () => {
      nodo.removeEventListener("keydown", onKey);
      if (previo && previo.isConnected && typeof previo.focus === "function") previo.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div className="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget && cerrable && cerrar.current) cerrar.current(); }}>
      <div ref={ref} className={"modal " + className} role="dialog" aria-modal="true" aria-labelledby={idTitulo} tabIndex={-1}>
        <div className="modal-head no-print">
          {icono}
          <h3 id={idTitulo}>{titulo}</h3>
          {cerrable && onClose && (
            <button type="button" className="icon-btn" aria-label={`Cerrar: ${titulo}`} onClick={onClose}><X size={20} aria-hidden="true" /></button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------- avisos ---------- */
let _toastSeq = 0;
const _toastListeners = new Set();
export function toast(mensaje, tipo = "info") {
  const t = { id: ++_toastSeq, mensaje, tipo };
  _toastListeners.forEach((fn) => fn(t));
}
export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const add = (t) => {
      setItems((xs) => [...xs.slice(-3), t]);
      // los errores permanecen más tiempo y siempre se pueden cerrar
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), t.tipo === "error" ? 9000 : 3500);
    };
    _toastListeners.add(add);
    return () => _toastListeners.delete(add);
  }, []);
  const quitar = (id) => setItems((xs) => xs.filter((x) => x.id !== id));
  const fila = (t) => (
    <div key={t.id} className={"toast " + t.tipo}>
      <span>{t.tipo === "ok" ? "✓ " : t.tipo === "error" ? "⚠ " : ""}{t.mensaje}</span>
      <button type="button" className="icon-btn" aria-label="Cerrar aviso" onClick={() => quitar(t.id)}><X size={16} aria-hidden="true" /></button>
    </div>
  );
  return (
    <div className="toaster">
      <div role="status" aria-live="polite">{items.filter((t) => t.tipo !== "error").map(fila)}</div>
      <div role="alert" aria-live="assertive">{items.filter((t) => t.tipo === "error").map(fila)}</div>
    </div>
  );
}

/* ---------- confirmación ---------- */
let _confirm = null;
export function confirmDialog(opts) {
  const o = typeof opts === "string" ? { mensaje: opts } : (opts || {});
  return new Promise((resolve) => {
    if (_confirm) _confirm({ ...o, resolve });
    else resolve(window.confirm(o.mensaje || "¿Confirmar?"));
  });
}
export function ConfirmHost() {
  const [state, setState] = useState(null);
  useEffect(() => { _confirm = setState; return () => { _confirm = null; }; }, []);
  if (!state) return null;
  const cerrar = (val) => { state.resolve(val); setState(null); };
  return (
    <Modal titulo={state.titulo || "Confirmar"} onClose={() => cerrar(false)} className="modal-confirm">
      <p className="confirm-msg">{state.mensaje}</p>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" data-autofocus onClick={() => cerrar(false)}>{state.cancelar || "Cancelar"}</button>
        <button type="button" className={"btn " + (state.peligro ? "btn-danger" : "btn-primary")} onClick={() => cerrar(true)}>{state.confirmar || "Confirmar"}</button>
      </div>
    </Modal>
  );
}

/* ---------- elección entre opciones ---------- */
let _choice = null;
export function choiceDialog(opts) {
  return new Promise((resolve) => { if (_choice) _choice({ ...opts, resolve }); else resolve(null); });
}
export function ChoiceHost() {
  const [state, setState] = useState(null);
  useEffect(() => { _choice = setState; return () => { _choice = null; }; }, []);
  if (!state) return null;
  const pick = (v) => { state.resolve(v); setState(null); };
  return (
    <Modal titulo={state.titulo || "Elige una opción"} onClose={() => pick(null)} className="modal-confirm">
      {state.mensaje && <p className="confirm-msg">{state.mensaje}</p>}
      <div className="modal-actions">
        {state.opciones.map((o) => (
          <button type="button" key={o.val} className={"btn " + (o.tipo || "btn-primary")} onClick={() => pick(o.val)}>{o.label}</button>
        ))}
      </div>
    </Modal>
  );
}

/* ---------- PIN (autorización) ---------- */
let _pin = null;
export function pedirPin(opts) {
  const o = typeof opts === "string" ? { mensaje: opts } : (opts || {});
  return new Promise((resolve) => {
    if (_pin) _pin({ ...o, resolve });
    else { const v = window.prompt(o.mensaje || "PIN de administrador:"); resolve(v ? v : null); }
  });
}
export function PinHost() {
  const [state, setState] = useState(null);
  const [pin, setPin] = useState("");
  const id = useId();
  useEffect(() => { _pin = (s) => { setPin(""); setState(s); }; return () => { _pin = null; }; }, []);
  if (!state) return null;
  const cerrar = (val) => { state.resolve(val); setState(null); };
  return (
    <Modal titulo={state.titulo || "Autorizar"} onClose={() => cerrar(null)} className="modal-confirm">
      <form onSubmit={(e) => { e.preventDefault(); if (pin) cerrar(pin); }}>
        {state.mensaje && <p className="confirm-msg" id={id + "-d"}>{state.mensaje}</p>}
        <div className="modal-pin">
          <label className="sr-only" htmlFor={id}>{state.etiqueta || "PIN"}</label>
          <input id={id} className="pin-input" type="password" inputMode="numeric" autoComplete="off" data-autofocus
            aria-describedby={state.mensaje ? id + "-d" : undefined}
            value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="PIN" />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={() => cerrar(null)}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={!pin}>{state.confirmar || "Autorizar"}</button>
        </div>
      </form>
    </Modal>
  );
}
