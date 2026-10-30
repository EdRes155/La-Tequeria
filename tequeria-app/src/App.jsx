import React, { useState, useEffect, useMemo, useRef, useCallback, useId } from "react";
import {
  Plus, Minus, Trash2, Printer, Send, LogOut, ArrowLeft, Bike, Package, Wallet, Utensils, ShoppingBag,
  ChefHat, Check, Pencil, Settings, KeyRound, Save, Undo2, Loader2, RefreshCw, X,
} from "lucide-react";
import { api, remoto, ErrorApi, mensajePin, TODAS } from "./store.js";
import {
  ROLES, puede, puedeEditar, money, ticketTotal, contarTacos, contarProductos, CATS, PREPS, PREP_LABEL,
  empaqueItems, catalogoBase, buildMenu, uid, clone, nuevaOrden, nuevoPedido, domVacio, telefonoValido,
  pedidoParaEnviar, textoCorteWhatsApp, nombreTicket, slug, leerImporte, PIN_RE, pinDebil, hora, fecha,
} from "./dominio.js";
import { Modal, Toaster, toast, ConfirmHost, confirmDialog, ChoiceHost, choiceDialog, PinHost, pedirPin } from "./ui.jsx";
import { CSS } from "./estilos.js";

/* ============================================================
   LA TEQUERÍA — Sistema de comandas
   Una sola página web. iPad / tablet / celular (Safari · Chrome).
   En pantallas grandes: menú + órdenes lado a lado.
   En celular: pestañas Menú / Órdenes.
   ============================================================ */

const MQ_CELULAR = "(max-width: 759.98px)"; // mismo corte que el CSS
function useIsPhone() {
  const mq = typeof window !== "undefined" && window.matchMedia ? window.matchMedia(MQ_CELULAR) : null;
  const [phone, setPhone] = useState(mq ? mq.matches : false);
  useEffect(() => {
    if (!mq) return;
    const f = () => setPhone(mq.matches);
    mq.addEventListener ? mq.addEventListener("change", f) : mq.addListener(f);
    return () => (mq.removeEventListener ? mq.removeEventListener("change", f) : mq.removeListener(f));
  }, []);
  return phone;
}

/* tipos de comanda */
const TIPOS = {
  aqui:      { label: "Para comer aquí", corto: "Aquí",      color: "var(--agave)", icon: Utensils },
  llevar:    { label: "Para llevar",     corto: "Llevar",    color: "var(--maiz)",  icon: ShoppingBag },
  domicilio: { label: "Domicilio",       corto: "Domicilio", color: "var(--barro)", icon: Bike },
};

/* borradores de comanda: viven en App para no perderse al cambiar de pantalla */
const normalizarPedido = (p) => ({
  ordenes: (p?.ordenes?.length ? p.ordenes : [nuevaOrden(1)]).map((o) => ({ prep: "con-todo", ...o, items: o.items || [] })),
  extras: p?.extras || [],
});
function borradorInicial(ctx, mesa) {
  const desdeMesa = ctx.tipo === "aqui" && mesa?.estado === "borrador" && mesa.pedido;
  return {
    pedido: desdeMesa ? normalizarPedido(clone(mesa.pedido)) : nuevoPedido(),
    version: mesa ? (mesa.version ?? 0) : null,
    activa: 0, tipo: ctx.tipo, dom: domVacio(), domOk: false, refLlevar: "", esExtra: false,
    envio: null, envioId: null, sucio: false,
  };
}
const tieneProductos = (b) => !!b && (contarProductos(b.pedido) > 0 || (b.pedido.extras || []).length > 0);
const tieneCambios = (b) => !!b && b.sucio && tieneProductos(b);
const claveBorrador = (ctx) => (ctx.tipo === "aqui" ? `mesa-${ctx.mesaId}` : ctx.tipo);

/* ============================================================ */
export default function App() {
  const [sesion, setSesion] = useState(() => api.sesionGuardada());
  const [pantalla, setPantalla] = useState(null);
  const [errorPantalla, setErrorPantalla] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [data, setData] = useState(null);
  const [errorCarga, setErrorCarga] = useState(null);
  const [conn, setConn] = useState(remoto ? "reconnecting" : "local");
  const [sinRed, setSinRed] = useState(false);
  const [view, setView] = useState("mesas");
  const [ctx, setCtx] = useState(null);
  const [borradores, setBorradores] = useState({});
  const [printTicket, setPrintTicket] = useState(null);
  const [printAuto, setPrintAuto] = useState(false);
  const [cocinaIncierta, setCocinaIncierta] = useState(false);
  const [cambiandoPin, setCambiandoPin] = useState(false);
  const borradoresRef = useRef(borradores);
  borradoresRef.current = borradores;

  const usuario = sesion?.usuario || null;
  const debeCambiar = !!sesion?.debeCambiarPin;

  const cargarPantalla = useCallback(async () => {
    setErrorPantalla(null);
    try { setPantalla(await api.pantallaLogin()); setSinRed(false); }
    catch (e) { setErrorPantalla(e); if (e.codigo === "RED") setSinRed(true); }
  }, []);
  useEffect(() => { if (!usuario) cargarPantalla(); }, [usuario, cargarPantalla]);

  const cerrarSesion = useCallback((mensaje = null) => {
    api.salir();
    setSesion(null); setData(null); setBorradores({}); setView("mesas"); setCtx(null);
    setAviso(mensaje); setCocinaIncierta(false); setErrorCarga(null); setCambiandoPin(false);
  }, []);

  const manejarError = useCallback((e) => {
    if (!(e instanceof ErrorApi)) { console.error(e); toast("Ocurrió un error inesperado.", "error"); return; }
    if (e.codigo === "SESION") { cerrarSesion(e.message); return; }
    if (e.codigo === "CAMBIAR_PIN") { setSesion((s) => s && { ...s, debeCambiarPin: true }); return; }
    if (e.codigo === "RED") setSinRed(true);
    toast(e.message, "error");
  }, [cerrarSesion]);

  // Cada parte del estado solo se reemplaza con la respuesta más reciente que se pidió para ella
  const pedidas = useRef({});
  const contador = useRef(0);
  const refrescar = useCallback(async (partes = null) => {
    const n = ++contador.current;
    (partes || TODAS).forEach((p) => { pedidas.current[p] = n; });
    try {
      const r = await api.cargar(partes);
      const vigente = (p) => pedidas.current[p] === n;
      const parche = { yo: r.yo };
      if ("nombreNegocio" in r && vigente("config")) Object.assign(parche, { nombreNegocio: r.nombreNegocio, precios: r.precios, extras: r.extras, ocultos: r.ocultos });
      ["carnes", "bebidas", "usuarios", "mesas", "cocina", "historial", "cortes", "gastos"].forEach((p) => { if (p in r && vigente(p)) parche[p] = r[p]; });
      if ("periodo" in r && vigente("historial")) parche.periodo = r.periodo;
      setData((d) => ({ ...(d || {}), ...parche }));
      setErrorCarga(null); setSinRed(false);
      if (r.yo?.cambiarPin) setSesion((s) => (s && !s.debeCambiarPin ? { ...s, debeCambiarPin: true } : s));
    } catch (e) {
      if (e.codigo === "SESION") { cerrarSesion(e.message); return; }
      if (e.codigo === "RED") setSinRed(true);
      setErrorCarga(e);
    }
  }, [cerrarSesion]);

  // Cargar estado y escuchar cambios mientras haya sesión
  useEffect(() => {
    if (!usuario || debeCambiar) return;
    let vivo = true;
    refrescar(null);
    const unsub = api.suscribir((partes) => { if (vivo) refrescar(partes); }, (st) => { if (vivo) setConn(st); });
    return () => { vivo = false; unsub(); };
  }, [usuario?.id, debeCambiar, refrescar]);

  // Sesión única de cocina: latido mientras el cocinero esté dentro
  useEffect(() => {
    if (!usuario || usuario.rol !== "cocinero" || debeCambiar) return;
    let vivo = true;
    const beat = async () => {
      try {
        const ok = await api.latido();
        if (!vivo) return;
        setCocinaIncierta(false);
        if (ok === false) cerrarSesion("Otra cocina tomó la sesión en otro dispositivo.");
      } catch (e) {
        if (!vivo) return;
        if (e.codigo === "SESION") cerrarSesion(e.message); else setCocinaIncierta(true);
      }
    };
    beat();
    const iv = setInterval(beat, 15000);
    return () => { vivo = false; clearInterval(iv); };
  }, [usuario?.id, usuario?.rol, debeCambiar, cerrarSesion]);

  // Avisar antes de cerrar la pestaña con comandas sin enviar ni guardar
  useEffect(() => {
    const f = (e) => { if (Object.values(borradoresRef.current).some(tieneCambios)) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, []);

  // Acciones: cada una confirma con el servidor; si falla se avisa y se recarga lo afectado
  const db = useMemo(() => {
    const a = api.acciones;
    const ejecutar = async (llamada, { partes = null, optimista, ok, silenciar = [] } = {}) => {
      if (optimista) setData((d) => { const nd = clone(d); optimista(nd); return nd; });
      try {
        const r = await llamada();
        setSinRed(false);
        if (ok) toast(ok, "ok");
        refrescar(partes);
        return { ok: true, r };
      } catch (e) {
        if (!silenciar.includes(e.codigo)) manejarError(e);
        refrescar(partes);
        return { ok: false, error: e };
      }
    };
    const enCocina = (nd, id, fn) => [nd.cocina, nd.historial].forEach((arr) => { const x = (arr || []).find((t) => t.id === id); if (x) fn(x); });
    return {
      async enviar(t) {
        try {
          const r = await a.enviar(t);
          setSinRed(false);
          refrescar(["mesas", "bebidas", "cocina", "historial"]);
          return r;
        } catch (e) {
          if (e.codigo === "SESION" || e.codigo === "CAMBIAR_PIN") manejarError(e);
          if (e.codigo === "RED") setSinRed(true);
          if (e.codigo === "MESA_OCUPADA" || e.codigo === "SIN_EXISTENCIA" || e.codigo === "PRODUCTO") refrescar(["mesas", "bebidas", "config", "carnes"]);
          throw e;
        }
      },
      guardarBorrador: (mesaId, pedido, version) => ejecutar(() => a.guardarBorrador(mesaId, pedido, version), { partes: ["mesas"], silenciar: ["CONFLICTO"] }),
      liberarMesa: (mesaId) => ejecutar(() => a.liberarMesa(mesaId), { partes: ["mesas"] }),
      reenviar: (mesaId) => ejecutar(() => a.reenviar(uid(), mesaId), { partes: ["cocina"], ok: "Reenviado a cocina" }),
      setTicketEstado: (id, estado) => ejecutar(() => a.estadoTicket(id, estado), { partes: ["cocina", "historial"], optimista: (nd) => enCocina(nd, id, (x) => { x.estado = estado; }) }),
      archivarTicket: (id) => ejecutar(() => a.archivar(id), { partes: ["cocina"], optimista: (nd) => { nd.cocina = nd.cocina.filter((t) => t.id !== id); } }),
      corte: (adminPin) => ejecutar(() => a.corte(adminPin), { partes: ["cocina", "historial", "cortes", "gastos"] }),
      ajustarBebida: (id, delta) => ejecutar(() => a.ajustarBebida(id, delta), { partes: ["bebidas"], optimista: (nd) => { const b = nd.bebidas.find((x) => x.id === id); if (b) b.cantidad = Math.max(0, b.cantidad + delta); } }),
      updateBebida: (id, cambios) => ejecutar(() => a.actualizarBebida(id, cambios), { partes: ["bebidas"], optimista: (nd) => { const b = nd.bebidas.find((x) => x.id === id); if (b) Object.assign(b, cambios); } }),
      addBebida: (nombre, precio, cantidad) => ejecutar(() => a.agregarBebida(nombre, precio, cantidad), { partes: ["bebidas"], ok: `Bebida "${nombre}" agregada` }),
      removeBebida: (id) => ejecutar(() => a.eliminarBebida(id), { partes: ["bebidas"], optimista: (nd) => { nd.bebidas = nd.bebidas.filter((x) => x.id !== id); } }),
      updateCarne: (id, activo) => ejecutar(() => a.actualizarCarne(id, activo), { partes: ["carnes"], optimista: (nd) => { const c = nd.carnes.find((x) => x.id === id); if (c) c.activo = activo; } }),
      addCarne: (nombre) => ejecutar(() => a.agregarCarne(nombre), { partes: ["carnes", "config"], ok: `Carne "${nombre}" agregada` }),
      removeCarne: (id) => ejecutar(() => a.eliminarCarne(id), { partes: ["carnes"], optimista: (nd) => { nd.carnes = nd.carnes.filter((x) => x.id !== id); } }),
      setPrecio: (clave, precio) => ejecutar(() => a.fijarPrecio(clave, precio), { partes: ["config"], optimista: (nd) => { nd.precios = { ...nd.precios, [clave]: precio }; } }),
      setExtraPrecio: (id, precio) => ejecutar(() => a.fijarPrecioExtra(id, precio), { partes: ["config"], optimista: (nd) => { nd.extras = nd.extras.map((e) => (e.id === id ? { ...e, precio } : e)); } }),
      addExtra: (cat, nombre, precio) => ejecutar(() => a.agregarExtra(cat, nombre, precio), { partes: ["config"], ok: `"${nombre}" agregado` }),
      removeExtra: (id) => ejecutar(() => a.eliminarExtra(id), { partes: ["config"], optimista: (nd) => { nd.extras = nd.extras.filter((e) => e.id !== id); } }),
      toggleOculto: (clave) => ejecutar(() => a.alternarOculto(clave), { partes: ["config"], optimista: (nd) => { const s = new Set(nd.ocultos); s.has(clave) ? s.delete(clave) : s.add(clave); nd.ocultos = [...s]; } }),
      addGasto: (concepto, monto) => ejecutar(() => a.agregarGasto(uid(), concepto, monto), { partes: ["gastos", "historial"], ok: "Gasto registrado" }),
      removeGasto: (id) => ejecutar(() => a.eliminarGasto(id), { partes: ["gastos", "historial"], optimista: (nd) => { nd.gastos = nd.gastos.filter((g) => g.id !== id); } }),
      crearUsuario: (adminPin, nombre, pin, rol) => ejecutar(() => a.crearUsuario(adminPin, nombre, pin, rol), { partes: ["usuarios"] }),
      eliminarUsuario: (adminPin, id) => ejecutar(() => a.eliminarUsuario(adminPin, id), { partes: ["usuarios"] }),
      restablecerPin: (adminPin, id, pin) => ejecutar(() => a.restablecerPin(adminPin, id, pin), { partes: ["usuarios"] }),
    };
  }, [manejarError, refrescar]);

  const go = useCallback((v, c = null) => { setView(v); setCtx(c); }, []);
  const salir = async () => {
    const n = Object.values(borradores).filter(tieneCambios).length;
    if (n > 0 && !(await confirmDialog({ titulo: "Cerrar sesión", mensaje: `Hay ${n} comanda(s) sin enviar ni guardar en este dispositivo. Si sales se perderán.`, confirmar: "Salir y descartar", peligro: true }))) return;
    cerrarSesion(null);
  };

  const hosts = (<><Toaster /><ConfirmHost /><ChoiceHost /><PinHost /></>);

  if (!usuario) {
    return (<>
      <Login pantalla={pantalla} error={errorPantalla} reintentar={cargarPantalla} aviso={aviso} sinRed={sinRed}
        onEntrar={(r) => { setAviso(null); setSesion({ usuario: r.usuario, debeCambiarPin: r.debeCambiarPin }); }} />
      {hosts}
    </>);
  }
  if (debeCambiar) {
    return (<>
      <CambiarPin forzado usuario={usuario} onSalir={cerrarSesion}
        onListo={() => { toast("PIN actualizado", "ok"); setSesion((s) => ({ ...s, debeCambiarPin: false })); }} />
      {hosts}
    </>);
  }
  if (!data || !data.mesas) {
    return (<>
      <style>{CSS}</style>
      <div className="loading" role="status">
        {errorCarga ? (<>
          <p>No se pudieron cargar los datos: {errorCarga.message}</p>
          <button className="btn btn-primary" onClick={() => refrescar(null)}><RefreshCw size={16} aria-hidden="true" /> Reintentar</button>
          <button className="btn btn-ghost" onClick={() => cerrarSesion(null)}>Cerrar sesión</button>
        </>) : "Cargando…"}
      </div>
      {hosts}
    </>);
  }

  const userActual = data.yo || usuario;
  const props = { data, db, user: userActual, go, ctx };
  const abrirImpresion = (t, auto = false) => { setPrintAuto(!!auto); setPrintTicket(t); };
  const claveCtx = ctx && view === "comanda" ? claveBorrador(ctx) : null;

  return (
    <div className="app">
      <style>{CSS}</style>
      <TopBar data={data} user={userActual} view={view} go={go} conn={sinRed ? "sinred" : conn}
        onLogout={salir} onCambiarPin={() => setCambiandoPin(true)} />
      {(errorCarga || sinRed) && (
        <div className={"aviso-barra" + (sinRed ? " error" : "")} role="alert">
          <span>{sinRed ? "Sin conexión con el servidor. Lo que ves puede no estar actualizado; los envíos no se confirmarán hasta reconectar."
            : `No se pudieron actualizar los datos (${errorCarga.message}). Se muestra la última información válida.`}</span>
          <button className="btn btn-sm btn-line" onClick={() => refrescar(null)}><RefreshCw size={14} aria-hidden="true" /> Reintentar</button>
        </div>
      )}
      {cocinaIncierta && (
        <div className="aviso-barra" role="status">
          <span>No se pudo confirmar que este dispositivo siga siendo la cocina activa. Revisa la conexión.</span>
        </div>
      )}
      {userActual.rol === "cocinero" && <CocinaAlertas data={data} onAbrir={abrirImpresion} />}
      <main className="main">
        {view === "mesas"      && (puede(userActual, "mesas") ? <Mesas {...props} borradores={borradores} /> : <SinAcceso />)}
        {view === "comanda"    && (puede(userActual, "comanda") && ctx
          ? <Comanda key={claveCtx} {...props} borrador={borradores[claveCtx]}
              setBorrador={(fn) => setBorradores((bs) => ({ ...bs, [claveCtx]: fn(bs[claveCtx]) }))}
              quitarBorrador={(soloSiLimpio) => setBorradores((bs) => {
                const b = bs[claveCtx];
                if (!b || (soloSiLimpio && (b.sucio || b.envio))) return bs;
                const n = { ...bs }; delete n[claveCtx]; return n;
              })} />
          : <SinAcceso />)}
        {view === "cocina"     && (puede(userActual, "cocina") ? <Cocina {...props} errorCarga={errorCarga || (sinRed ? { message: "sin conexión" } : null)} /> : <SinAcceso />)}
        {view === "inventario" && (puede(userActual, "inventario") ? <Inventario {...props} /> : <SinAcceso />)}
        {view === "gastos"     && (puede(userActual, "gastos") ? <Gastos {...props} /> : <SinAcceso />)}
        {view === "admin"      && (puede(userActual, "admin") ? <Admin {...props} /> : <SinAcceso />)}
      </main>
      {printTicket && <TicketModal t={printTicket} negocio={data.nombreNegocio} autoPrint={printAuto}
        onClose={() => { setPrintTicket(null); setPrintAuto(false); }} />}
      {cambiandoPin && (
        <CambiarPin usuario={userActual} onSalir={cerrarSesion} onCancelar={() => setCambiandoPin(false)}
          onListo={() => { setCambiandoPin(false); toast("PIN actualizado", "ok"); }} />
      )}
      {hosts}
    </div>
  );
}

function SinAcceso() {
  return (
    <div className="screen">
      <div className="empty">No tienes acceso a esta sección.</div>
    </div>
  );
}

/* ============================== LOGIN ============================== */
function Login({ pantalla, error, reintentar, aviso, sinRed, onEntrar }) {
  const [sel, setSel] = useState(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const idPin = useId();

  const entrar = async (e) => {
    e?.preventDefault();
    if (busy || !sel || !pin) return;
    setBusy(true); setErr("");
    try {
      const r = await api.entrar(sel, pin);
      if (!r.ok) { setErr(mensajePin(r)); setPin(""); return; }
      onEntrar(r);
    } catch (ex) {
      setErr(ex instanceof ErrorApi ? ex.message : "No se pudo entrar. Inténtalo de nuevo.");
    } finally { setBusy(false); }
  };

  const connTxt = !remoto ? "● Modo local: los datos se guardan solo en este navegador"
    : sinRed || error ? "● Sin conexión con el servidor" : "● Conectado al servidor";
  const connCol = !remoto ? "var(--alerta)" : sinRed || error ? "var(--alerta)" : "var(--ok)";

  let cuerpo;
  if (error) {
    cuerpo = (<div role="alert">
      <div className="login-err">{error.message}</div>
      <button className="btn btn-primary btn-block" onClick={reintentar}><RefreshCw size={16} aria-hidden="true" /> Reintentar</button>
    </div>);
  } else if (!pantalla) {
    cuerpo = <p role="status">Cargando…</p>;
  } else if (!pantalla.hayAdmin) {
    cuerpo = remoto ? (
      <div className="login-setup">
        <b>Falta el primer administrador.</b> Ejecuta en Supabase → SQL Editor:
        <code>select public.crear_admin_inicial('Tu nombre', 'tu PIN');</code>
        Después recarga esta página.
      </div>
    ) : <CrearAdminLocal onListo={reintentar} />;
  } else {
    cuerpo = (<>
      <div className="login-users" role="group" aria-label="¿Quién eres?">
        {pantalla.usuarios.map((u) => (
          <button key={u.id} type="button" className={"user-chip" + (sel === u.id ? " on" : "")} aria-pressed={sel === u.id}
            onClick={() => { setSel(u.id); setErr(""); setPin(""); }}>{u.nombre}</button>
        ))}
      </div>
      {sel && (
        <form onSubmit={entrar}>
          <label className="sr-only" htmlFor={idPin}>PIN</label>
          <input id={idPin} className="pin-input" type="password" inputMode="numeric" autoComplete="off" placeholder="PIN" autoFocus
            aria-invalid={!!err} aria-describedby={err ? idPin + "-e" : undefined}
            value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} />
          {err && <div className="login-err" id={idPin + "-e"} role="alert">{err}</div>}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || !pin}>{busy ? "Entrando…" : "Entrar"}</button>
        </form>
      )}
    </>);
  }

  return (
    <div className="login">
      <style>{CSS}</style>
      <div className="login-card">
        <div className="brand-mark" aria-hidden="true">🌵</div>
        <h1 className="brand-title">{pantalla?.negocio || "La Tequería"}</h1>
        <p className="brand-sub">Sistema de comandas</p>
        {aviso && <div className="login-err" role="alert">{aviso}</div>}
        {cuerpo}
        <p className="login-hint" style={{ color: connCol }}>{connTxt}</p>
      </div>
    </div>
  );
}

function CrearAdminLocal({ onListo }) {
  const [nombre, setNombre] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const id = useId();
  const crear = async (e) => {
    e.preventDefault(); setErr("");
    try { await api.crearAdminInicial(nombre, pin); onListo(); }
    catch (ex) { setErr(ex.message); }
  };
  return (
    <form onSubmit={crear}>
      <p className="login-setup">Primera vez en este navegador: crea el administrador.</p>
      <div className="campo"><label htmlFor={id + "n"}>Nombre</label>
        <input id={id + "n"} className="inp" value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="off" /></div>
      <div className="campo"><label htmlFor={id + "p"}>PIN (4 a 8 dígitos, no trivial)</label>
        <input id={id + "p"} className="inp" type="password" inputMode="numeric" autoComplete="off" value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} /></div>
      {err && <div className="login-err" role="alert">{err}</div>}
      <button type="submit" className="btn btn-primary btn-block">Crear administrador</button>
    </form>
  );
}

/* ============================== CAMBIO DE PIN ============================== */
function CambiarPin({ forzado, usuario, onListo, onCancelar, onSalir }) {
  const [actual, setActual] = useState("");
  const [nuevo, setNuevo] = useState("");
  const [conf, setConf] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();
  const soloDigitos = (fn) => (e) => fn(e.target.value.replace(/\D/g, "").slice(0, 8));

  const guardar = async (e) => {
    e.preventDefault(); setErr("");
    if (!PIN_RE.test(nuevo)) { setErr("El PIN nuevo debe tener de 4 a 8 dígitos."); return; }
    if (pinDebil(nuevo)) { setErr(mensajePin({ error: "debil" })); return; }
    if (nuevo !== conf) { setErr("La confirmación no coincide con el PIN nuevo."); return; }
    setBusy(true);
    try {
      const r = await api.cambiarPin(actual, nuevo);
      if (r.ok) onListo(); else setErr(mensajePin(r));
    } catch (ex) {
      if (ex.codigo === "SESION") onSalir(ex.message); else setErr(ex.message);
    } finally { setBusy(false); }
  };

  const form = (
    <form onSubmit={guardar} className="modal-body">
      {forzado && <p style={{ margin: "0 0 8px" }}>Hola, <b>{usuario.nombre}</b>. Tu PIN es de demostración o muy fácil de adivinar: elige uno nuevo para continuar.</p>}
      <label htmlFor={id + "a"}>PIN actual</label>
      <input id={id + "a"} className="inp" type="password" inputMode="numeric" autoComplete="off" data-autofocus value={actual} onChange={soloDigitos(setActual)} />
      <label htmlFor={id + "n"}>PIN nuevo (4 a 8 dígitos)</label>
      <input id={id + "n"} className="inp" type="password" inputMode="numeric" autoComplete="off" value={nuevo} onChange={soloDigitos(setNuevo)} />
      <label htmlFor={id + "c"}>Confirma el PIN nuevo</label>
      <input id={id + "c"} className="inp" type="password" inputMode="numeric" autoComplete="off" value={conf} onChange={soloDigitos(setConf)} />
      {err && <div className="login-err" role="alert" style={{ marginTop: 8 }}>{err}</div>}
      <div className="modal-actions" style={{ padding: "12px 0 0", border: 0 }}>
        {forzado
          ? <button type="button" className="btn btn-ghost" onClick={() => onSalir(null)}>Salir</button>
          : <button type="button" className="btn btn-ghost" onClick={onCancelar}>Cancelar</button>}
        <button type="submit" className="btn btn-primary" disabled={busy || !actual || !nuevo || !conf}>{busy ? "Guardando…" : "Cambiar PIN"}</button>
      </div>
    </form>
  );

  if (!forzado) return <Modal titulo="Cambiar mi PIN" icono={<KeyRound size={20} aria-hidden="true" />} onClose={onCancelar}>{form}</Modal>;
  return (
    <div className="login">
      <style>{CSS}</style>
      <div className="login-card" style={{ textAlign: "left" }}>
        <h1 className="brand-title" style={{ fontSize: 24 }}>Cambia tu PIN</h1>
        {form}
      </div>
    </div>
  );
}

/* ============================== TOPBAR ============================== */
function TopBar({ data, user, view, go, conn, onLogout, onCambiarPin }) {
  const items = [
    { id: "mesas", label: "Mesas", corto: "Mesas", icon: Utensils },
    { id: "cocina", label: "Cocina", corto: "Cocina", icon: ChefHat },
    { id: "inventario", label: "Inventario", corto: "Invent.", icon: Package },
    { id: "gastos", label: "Gastos", corto: "Gastos", icon: Wallet },
    { id: "admin", label: "Administración", corto: "Admin", icon: Settings },
  ].filter((it) => puede(user, it.id));
  const pendientes = (data.cocina || []).filter((t) => t.estado !== "listo").length;
  const connCol = conn === "online" ? "var(--ok)" : conn === "reconnecting" ? "var(--maiz)" : "var(--alerta)";
  const connTitle = conn === "online" ? "En línea, sincronizado" : conn === "reconnecting" ? "Conectando al tiempo real…"
    : conn === "sinred" ? "Sin conexión con el servidor" : "Modo local (solo este navegador)";
  return (
    <header className="topbar">
      <div className="topbar-brand"><span className="topbar-cactus" aria-hidden="true">🌵</span>
        <span className="topbar-name">{data.nombreNegocio}</span>
        <span className="conn-dot" role="img" aria-label={connTitle} title={connTitle} style={{ background: connCol }} /></div>
      <nav className="topbar-nav" aria-label="Secciones" style={{ "--n": items.length }}>
        {items.map((it) => {
          const I = it.icon;
          const active = view === it.id || (view === "comanda" && it.id === "mesas");
          return (
            <button key={it.id} type="button" className={"nav-btn" + (active ? " on" : "")} aria-current={active ? "page" : undefined} onClick={() => go(it.id)}>
              <I size={18} aria-hidden="true" /><span className="nav-largo">{it.label}</span><span className="nav-corto">{it.corto}</span>
              {it.id === "cocina" && pendientes > 0 && <em className="badge" aria-label={`${pendientes} pendientes`}>{pendientes}</em>}
            </button>
          );
        })}
      </nav>
      <div className="topbar-user">
        <span className="user-name">{user.nombre}</span>
        <span className={"rol-tag " + user.rol}>{ROLES[user.rol] || user.rol}</span>
        <button type="button" className="nav-btn ghost" onClick={onCambiarPin} aria-label="Cambiar mi PIN" title="Cambiar mi PIN"><KeyRound size={18} aria-hidden="true" /></button>
        <button type="button" className="nav-btn ghost" onClick={onLogout} aria-label={`Cerrar sesión de ${user.nombre}`} title="Cerrar sesión"><LogOut size={18} aria-hidden="true" /></button>
      </div>
    </header>
  );
}

/* ============================== MESAS ============================== */
function Mesas({ data, go, user, borradores }) {
  const puedeComanda = puede(user, "comanda");
  const domsActivos = (data.cocina || []).filter((t) => t.tipo === "domicilio" && t.estado !== "listo").length;
  const capturando = (k) => tieneCambios(borradores[k]);
  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h2>Mesas</h2>
          <p className="muted">{puedeComanda
            ? "Toca una mesa para tomar su orden. Para llevar y Domicilio están al final."
            : "Vista de mesas (solo lectura)."}</p>
        </div>
      </div>
      <div className="mesas-grid">
        {data.mesas.map((m) => {
          const estado = m.estado === "ocupada" ? "ocupada" : m.estado === "borrador" ? "borrador" : "libre";
          const ordenes = m.pedido?.ordenes?.length || 0;
          const items = contarProductos(m.pedido);
          const etiqueta = { ocupada: "Ocupada", borrador: "Borrador", libre: "Libre" }[estado];
          const local = capturando(`mesa-${m.id}`);
          return (
            <button key={m.id} type="button" className={"mesa-card " + estado + (puedeComanda ? "" : " solo-ver")}
              aria-disabled={!puedeComanda}
              aria-label={`Mesa ${m.id}, ${etiqueta}${estado === "borrador" ? " (guardado, no enviado a cocina)" : ""}${local ? ", con cambios sin guardar en este dispositivo" : ""}`}
              onClick={() => puedeComanda && go("comanda", { tipo: "aqui", mesaId: m.id })}>
              {local && <span className="sin-guardar" aria-hidden="true">Sin guardar</span>}
              <div className="mesa-num" aria-hidden="true">{m.id}</div>
              <div className="mesa-estado" aria-hidden="true">{etiqueta}</div>
              {estado !== "libre" && (
                <div className="mesa-info" aria-hidden="true">
                  {m.mesero && <span className="mesa-mesero">{m.mesero}</span>}
                  <span>{items} prod. · {ordenes} órd.{m.hora ? ` · ${m.hora}` : ""}</span>
                  {estado === "borrador" && <span>No enviado a cocina</span>}
                </div>
              )}
            </button>
          );
        })}

        {puedeComanda && (
          <button type="button" className="mesa-card especial-card llevar" onClick={() => go("comanda", { tipo: "llevar" })}>
            {capturando("llevar") && <span className="sin-guardar">Sin enviar</span>}
            <ShoppingBag size={34} aria-hidden="true" />
            <div className="especial-card-label">Para llevar</div>
          </button>
        )}
        {puedeComanda && (
          <button type="button" className="mesa-card especial-card domicilio" onClick={() => go("comanda", { tipo: "domicilio" })}>
            {capturando("domicilio") && <span className="sin-guardar">Sin enviar</span>}
            <Bike size={34} aria-hidden="true" />
            <div className="especial-card-label">Domicilio</div>
            {domsActivos > 0 && <span className="especial-badge">{domsActivos} en curso</span>}
          </button>
        )}
      </div>
    </div>
  );
}

/* ============================== COMANDA ============================== */
function Comanda({ data, db, user, go, ctx, borrador, setBorrador, quitarBorrador }) {
  const isPhone = useIsPhone();
  const menu = useMemo(() => buildMenu(data.carnes, data.bebidas, data.extras, data.precios, data.ocultos),
    [data.carnes, data.bebidas, data.extras, data.precios, data.ocultos]);
  const entrada = ctx.tipo;               // cómo se abrió: mesa, llevar o domicilio
  const mesaId = ctx.mesaId || null;
  const mesaInfo = mesaId ? data.mesas.find((m) => m.id === mesaId) : null;

  const b = borrador || borradorInicial(ctx, mesaInfo);
  const cambiar = (fn, sucio = true) => setBorrador((prev) => {
    const nb = fn(prev || borradorInicial(ctx, mesaInfo));
    return sucio ? { ...nb, sucio: true } : nb;
  });
  const { pedido, tipo, dom, domOk, refLlevar, esExtra, envio } = b;
  const activa = Math.min(b.activa, pedido.ordenes.length - 1);
  const setPedido = (fn) => cambiar((d) => ({ ...d, pedido: fn(clone(d.pedido)) }));
  const setActiva = (i) => cambiar((d) => ({ ...d, activa: i }), false);

  const [modalDom, setModalDom] = useState(entrada === "domicilio" && !domOk);
  const [ticket, setTicket] = useState(null);
  const [pane, setPane] = useState("menu"); // celular: menu | orden
  const [q, setQ] = useState("");
  const montado = useRef(true);
  useEffect(() => {
    // ids estables desde el primer render; al salir sin cambios no se conserva (manda lo del servidor)
    if (!borrador) setBorrador((prev) => prev || borradorInicial(ctx, mesaInfo));
    return () => { montado.current = false; quitarBorrador(true); };
  }, []);

  const extras = pedido.extras || [];
  const totalProd = contarProductos(pedido);
  const totalDinero = ticketTotal(pedido);
  const vacio = totalProd === 0 && extras.length === 0;
  const enviando = envio?.estado === "enviando";
  const mostrarExtras = tipo === "llevar" || tipo === "domicilio";
  const empaqueCat = useMemo(() => empaqueItems(data.precios), [data.precios]);
  const mesaOcupada = entrada === "aqui" && mesaInfo?.estado === "ocupada";
  const mesaBorrador = entrada === "aqui" && mesaInfo?.estado === "borrador";

  const addExtraPedido = (item) => setPedido((p) => {
    const ex = p.extras.find((e) => e.key === item.key);
    if (ex) ex.cantidad += 1; else p.extras.push({ ...item, cantidad: 1 });
    return p;
  });
  const setCantExtra = (key, delta) => setPedido((p) => {
    const e = p.extras.find((x) => x.key === key); if (!e) return p;
    e.cantidad += delta; if (e.cantidad <= 0) p.extras = p.extras.filter((x) => x.key !== key);
    return p;
  });
  const addItem = (item) => setPedido((p) => {
    const o = p.ordenes[Math.min(activa, p.ordenes.length - 1)];
    const ex = o.items.find((i) => i.key === item.key);
    if (ex) ex.cantidad += 1; else o.items.push({ key: item.key, nombre: item.nombre, cat: item.cat, precio: item.precio, cantidad: 1, ...(item.invId ? { invId: item.invId } : {}) });
    return p;
  });
  const setPrep = (idx, k) => setPedido((p) => { p.ordenes[idx].prep = k; return p; });
  const setCant = (idx, key, delta) => setPedido((p) => {
    const o = p.ordenes[idx];
    const it = o.items.find((i) => i.key === key); if (!it) return p;
    it.cantidad += delta; if (it.cantidad <= 0) o.items = o.items.filter((i) => i.key !== key);
    return p;
  });
  const addOrden = () => cambiar((d) => {
    const p = clone(d.pedido); p.ordenes.push(nuevaOrden(p.ordenes.length + 1));
    return { ...d, pedido: p, activa: p.ordenes.length - 1 };
  });
  const borrarOrden = async (idx) => {
    const o = pedido.ordenes[idx];
    const n = o.items.reduce((a, i) => a + i.cantidad, 0);
    if (n > 0 && !(await confirmDialog({ titulo: "Eliminar orden", mensaje: `¿Eliminar «${o.nombre}» con ${n} producto(s)?`, confirmar: "Eliminar", peligro: true }))) return;
    cambiar((d) => {
      const p = clone(d.pedido); if (p.ordenes.length === 1) return d;
      p.ordenes.splice(idx, 1);
      const a = d.activa === idx ? 0 : d.activa > idx ? d.activa - 1 : d.activa;
      return { ...d, pedido: p, activa: a };
    });
  };
  const renombrar = (idx, nombre) => setPedido((p) => { p.ordenes[idx].nombre = nombre.slice(0, 40); return p; });

  const guardarBorrador = async (versionForzada) => {
    const r = await db.guardarBorrador(mesaId, clone(pedido), versionForzada ?? b.version);
    if (r.ok) {
      quitarBorrador();
      toast(totalProd > 0 ? `Mesa ${mesaId}: borrador guardado (no se envió a cocina)` : `Mesa ${mesaId} liberada`, "ok");
      go("mesas");
    } else if (r.error?.codigo === "CONFLICTO") {
      const op = await choiceDialog({
        titulo: "La mesa cambió", mensaje: `Otro dispositivo modificó la Mesa ${mesaId} mientras editabas.`,
        opciones: [
          { label: "Guardar mi versión", val: "mia", tipo: "btn-primary" },
          { label: "Ver la versión guardada", val: "suya", tipo: "btn-line" },
          { label: "Seguir editando", val: null, tipo: "btn-ghost" },
        ],
      });
      if (op === "mia") guardarBorrador(mesaInfo?.version ?? 0);
      if (op === "suya") quitarBorrador();
    }
  };
  const descartar = async () => {
    if (!(await confirmDialog({ titulo: "Descartar comanda", mensaje: "Se borrarán los productos capturados en este dispositivo.", confirmar: "Descartar", peligro: true }))) return;
    quitarBorrador();
    go("mesas");
  };

  const finalizar = async () => {
    if (enviando) return;
    if (vacio) { toast("Agrega al menos un producto.", "error"); return; }
    if (!esExtra && entrada === "domicilio" && (!dom.direccion.trim() || !telefonoValido(dom.telefono))) {
      setModalDom(true); toast("Captura dirección y un teléfono válido del domicilio.", "error"); return;
    }
    // ¿Cuenta junta o separada? Solo tiene sentido preguntar con más de una orden con productos.
    let cuenta = "junta";
    if (!esExtra && pedido.ordenes.filter((o) => o.items.length > 0).length > 1) {
      const sel = await choiceDialog({
        titulo: "¿Cómo va la cuenta?", mensaje: "Así saldrá impreso el ticket.",
        opciones: [
          { label: "Junta (un solo total)", val: "junta", tipo: "btn-primary" },
          { label: "Separada (total por orden)", val: "separada", tipo: "btn-line" },
        ],
      });
      if (!sel) return;
      cuenta = sel;
    }
    // El id se conserva entre reintentos: si el primer intento sí llegó, el servidor no lo duplica
    const id = b.envioId || uid();
    cambiar((d) => ({ ...d, envioId: id, envio: { estado: "enviando" } }), false);
    let ticketTipo = "aqui", paraLlevar = false, referencia = null, domicilio = null;
    if (!esExtra && entrada === "aqui") paraLlevar = tipo === "llevar";
    else if (!esExtra && entrada === "llevar") { ticketTipo = "llevar"; referencia = refLlevar.trim() || null; }
    else if (!esExtra) { ticketTipo = "domicilio"; domicilio = { ...dom }; }
    const t = {
      id, tipo: ticketTipo, esExtra, mesaId: (esExtra || entrada === "aqui") ? mesaId : null,
      paraLlevar, referencia, cuenta, domicilio, ...pedidoParaEnviar(pedido),
    };
    try {
      const r = await db.enviar(t);
      quitarBorrador();
      toast(r.duplicado ? "Esta comanda ya estaba registrada en cocina." : esExtra ? "Orden extra recibida en cocina" : "Comanda recibida en cocina", "ok");
      if (montado.current) go("mesas");
    } catch (e) {
      cambiar((d) => ({ ...d, envio: { estado: "error", mensaje: e.message, incierto: !!e.incierto, codigo: e.codigo } }), false);
      if (!montado.current) toast("No se pudo enviar una comanda: " + e.message, "error");
    }
  };

  const liberarMesa = async () => {
    const r = await db.liberarMesa(mesaId);
    if (r.ok) { quitarBorrador(); toast(`Mesa ${mesaId} liberada`, "ok"); go("mesas"); }
  };
  const confirmLiberar = async () => {
    const msg = mesaBorrador ? `¿Eliminar el borrador de la Mesa ${mesaId}? No se envió a cocina.` : `¿Marcar la Mesa ${mesaId} como libre? Se borrará su orden guardada.`;
    if (await confirmDialog({ titulo: mesaBorrador ? "Eliminar borrador" : "Liberar mesa", mensaje: msg, confirmar: mesaBorrador ? "Eliminar" : "Liberar", peligro: true })) liberarMesa();
  };

  /* ---- bloques reutilizables ---- */
  const typeBar = (
    <div className="type-bar">
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => go("mesas")}><ArrowLeft size={16} aria-hidden="true" /> Mesas</button>
      {entrada === "aqui" ? (
        esExtra ? (
          <div className="type-btns">
            <span className="type-fixed" style={{ "--tc": "var(--especial)" }}>Orden extra</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => cambiar((d) => ({ ...d, esExtra: false, pedido: nuevoPedido(), activa: 0, envio: null, envioId: null, sucio: false }), false)}>Cancelar orden extra</button>
          </div>
        ) : (
          <div className="type-btns" role="group" aria-label="Tipo de comanda">
            <button type="button" className={"type-btn" + (tipo === "aqui" ? " on" : "")} aria-pressed={tipo === "aqui"} style={{ "--tc": TIPOS.aqui.color }} onClick={() => cambiar((d) => ({ ...d, tipo: "aqui" }), false)}>
              <Utensils size={16} aria-hidden="true" /> <span className="nav-largo">Para esta mesa</span><span className="nav-corto">Aquí</span>
            </button>
            <button type="button" className={"type-btn" + (tipo === "llevar" ? " on" : "")} aria-pressed={tipo === "llevar"} style={{ "--tc": TIPOS.llevar.color }} onClick={() => cambiar((d) => ({ ...d, tipo: "llevar" }), false)}>
              <ShoppingBag size={16} aria-hidden="true" /> <span className="nav-largo">Para llevar</span><span className="nav-corto">Llevar</span>
            </button>
          </div>
        )
      ) : entrada === "domicilio" ? (
        <div className="type-btns">
          <span className="type-fixed" style={{ "--tc": TIPOS.domicilio.color }}><Bike size={16} aria-hidden="true" /> Domicilio {domOk && <Check size={15} aria-label="datos capturados" />}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModalDom(true)}><Pencil size={14} aria-hidden="true" /> Datos del domicilio</button>
        </div>
      ) : (
        <div className="type-btns">
          <span className="type-fixed tf-ocultable" style={{ "--tc": TIPOS.llevar.color }}><ShoppingBag size={16} aria-hidden="true" /> Para llevar</span>
          <input className="ref-input" aria-label="Nombre de referencia del cliente" placeholder="Nombre de referencia" value={refLlevar} maxLength={60}
            onChange={(e) => cambiar((d) => ({ ...d, refLlevar: e.target.value }))} />
        </div>
      )}
      {entrada === "aqui" && <span className="mesa-chip">Mesa {mesaId}</span>}
    </div>
  );

  const banner = (
    <div className="type-banner" style={{
      background: esExtra ? "var(--especial)" : entrada === "aqui" ? (tipo === "llevar" ? TIPOS.llevar.color : TIPOS.aqui.color) : TIPOS[entrada].color,
    }}>
      {esExtra
        ? `Mesa ${mesaId} · ORDEN EXTRA`
        : entrada === "aqui"
          ? `Mesa ${mesaId}${tipo === "llevar" ? " · EXCLUSIVO PARA LLEVAR" : ""}`
          : entrada === "llevar"
            ? `Para llevar${refLlevar.trim() ? ` · ${refLlevar.trim()}` : ""}`
            : `Domicilio${domOk && dom.nombre ? ` · ${dom.nombre}` : ""}`}
    </div>
  );

  const estadoBar = mesaOcupada ? (
    <div className="ocupada-bar">
      <span>Enviada a cocina por <b>{mesaInfo.mesero || "—"}</b>{mesaInfo.hora ? ` · ${mesaInfo.hora}` : ""}</span>
      <button type="button" className="btn btn-danger-ghost btn-sm" onClick={confirmLiberar}>Marcar libre</button>
    </div>
  ) : mesaBorrador && !esExtra ? (
    <div className="ocupada-bar borrador">
      <span>Borrador guardado por <b>{mesaInfo.mesero || "—"}</b>{mesaInfo.hora ? ` · ${mesaInfo.hora}` : ""} · aún no se envía a cocina</span>
      <button type="button" className="btn btn-danger-ghost btn-sm" onClick={confirmLiberar}>Eliminar borrador</button>
    </div>
  ) : null;

  const scrollA = (id) => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
  const resultados = q.trim()
    ? [...menu.tacos, ...menu.quesa, ...menu.volcan, ...menu.costra, ...menu.bebs]
        .filter((it) => it.nombre.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
          .includes(q.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")))
    : null;

  const personaBar = (
    <div className="persona-bar" role="group" aria-label="Persona a la que se agregan los productos">
      <span className="persona-label" aria-hidden="true">Añadiendo a:</span>
      {pedido.ordenes.map((o, i) => (
        <button key={o.id} type="button" className="persona-chip" aria-pressed={activa === i} onClick={() => setActiva(i)}>
          {o.nombre} <span className="persona-n" aria-label={`${o.items.reduce((a, x) => a + x.cantidad, 0)} productos`}>· {o.items.reduce((a, x) => a + x.cantidad, 0)}</span>
        </button>
      ))}
      <button type="button" className="persona-add" onClick={addOrden} aria-label="Agregar orden para otra persona"><Plus size={16} aria-hidden="true" /> Persona</button>
    </div>
  );

  const menuPane = (
    <div className="menu-inner">
      {personaBar}
      <div className="menu-tools">
        <label className="sr-only" htmlFor={`buscar-${entrada}`}>Buscar producto</label>
        <input id={`buscar-${entrada}`} type="search" className="inp buscar" placeholder="Buscar producto…" value={q} onChange={(e) => setQ(e.target.value)} />
        {!resultados && (
          <nav className="cat-jumps" aria-label="Ir a categoría">
            <button type="button" onClick={() => scrollA("cat-tacos")}>Tacos</button>
            <button type="button" onClick={() => scrollA("cat-quesa")}>Quesadillas</button>
            <button type="button" onClick={() => scrollA("cat-volcan")}>Volcanes</button>
            <button type="button" onClick={() => scrollA("cat-costra")}>Costra</button>
            <button type="button" onClick={() => scrollA("cat-bebidas")}>Bebidas</button>
          </nav>
        )}
      </div>
      {resultados ? (
        <section className="resultados" aria-label="Resultados de búsqueda">
          <div className="resultados-items">
            {resultados.length === 0 && <p className="muted" style={{ margin: 6 }}>Sin resultados para «{q}».</p>}
            {resultados.map((it) => <ItemBtn key={it.key} item={it} onAdd={addItem} />)}
          </div>
        </section>
      ) : (<>
        <div className="cols-3">
          <MenuCol id="cat-tacos" title="Tacos" cat="taco" items={menu.tacos} onAdd={addItem} />
          <MenuCol id="cat-quesa" title="Quesadillas / Gringas" cat="quesa" items={menu.quesa} onAdd={addItem} />
          <MenuCol id="cat-volcan" title="Volcanes" cat="volcan" items={menu.volcan} onAdd={addItem} />
        </div>
        <section className="especial" id="cat-costra" aria-labelledby="h-costra">
          <h3 className="especial-head" id="h-costra">Especialidad — Costra</h3>
          <div className="especial-items">
            {menu.costra.map((it) => <ItemBtn key={it.key} item={it} onAdd={addItem} />)}
          </div>
        </section>
        <section className="bebidas-box" id="cat-bebidas" aria-labelledby="h-bebidas">
          <h3 className="bebidas-head" id="h-bebidas">Refrescos y aguas {menu.bebs.length === 0 && <span>— sin existencias</span>}</h3>
          <div className="bebidas-items">
            {menu.bebs.map((it) => <ItemBtn key={it.key} item={it} onAdd={addItem} />)}
          </div>
        </section>
      </>)}
    </div>
  );

  const ordenPane = (
    <div className="ticket-inner">
      <div className="ticket-head">
        <div><h3 className="ticket-origen">Órdenes</h3>
          <div className="ticket-mesero">{user.nombre} · {totalProd} producto(s)</div></div>
        <button type="button" className="btn btn-add btn-sm" onClick={addOrden}><Plus size={16} aria-hidden="true" /> Persona</button>
      </div>
      {entrada === "domicilio" && domOk && (
        <button type="button" className="dom-resumen" onClick={() => setModalDom(true)} aria-label={`Editar datos del domicilio: ${dom.nombre || "cliente"}, ${dom.direccion}`}>
          <Bike size={15} aria-hidden="true" />
          <span>{dom.nombre || "Domicilio"} · {dom.direccion}</span>
          <Pencil size={13} aria-hidden="true" />
        </button>
      )}
      <div className="ticket-scroll">
        {pedido.ordenes.map((o, idx) => (
          <OrdenBlock key={o.id} o={o} activa={activa === idx}
            onSelect={() => setActiva(idx)} onRename={(v) => renombrar(idx, v)}
            onCant={(key, d) => setCant(idx, key, d)} onDelete={() => borrarOrden(idx)}
            canDelete={pedido.ordenes.length > 1}
            onPrep={(k) => setPrep(idx, k)} />
        ))}

        {mostrarExtras && (
          <div className="pedido-extras">
            <div className="pedido-extras-head">Para todo el pedido (llevar)</div>
            <div className="pedido-extras-add">
              {empaqueCat.map((it) => (
                <button type="button" key={it.key} className="extra-chip" style={{ "--cat": CATS.empaque.color }} onClick={() => addExtraPedido(it)}>
                  <Plus size={12} aria-hidden="true" /> {it.corto}{it.precio > 0 ? ` ${money(it.precio)}` : ""}
                </button>
              ))}
            </div>
            {extras.length > 0 && (
              <ul className="orden-items" style={{ marginTop: 8 }}>
                {extras.map((it) => (
                  <li key={it.key} className="oitem" style={{ "--cat": CATS.empaque.color }}>
                    <span className="oitem-dot" aria-hidden="true" /><span className="oitem-name">{it.corto || it.nombre}</span>
                    <span className="oitem-precio">{it.precio > 0 ? money(it.precio * it.cantidad) : "sin costo"}</span>
                    <div className="stepper">
                      <button type="button" aria-label={`Quitar uno: ${it.corto || it.nombre}`} onClick={() => setCantExtra(it.key, -1)}><Minus size={16} aria-hidden="true" /></button>
                      <span>{it.cantidad}</span>
                      <button type="button" aria-label={`Agregar uno: ${it.corto || it.nombre}`} onClick={() => setCantExtra(it.key, 1)}><Plus size={16} aria-hidden="true" /></button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {isPhone && tieneProductos(b) && (
          <button type="button" className="btn btn-danger-ghost btn-sm" disabled={enviando} onClick={descartar}>
            <Trash2 size={14} aria-hidden="true" /> Descartar comanda
          </button>
        )}
      </div>
      <div className="ticket-total"><span>Total</span><b>{money(totalDinero)}</b></div>
    </div>
  );

  const previewTicket = esExtra
    ? { id: "preview", tipo: "aqui", esExtra: true, origen: `Mesa ${mesaId}`, paraLlevar: false,
        ordenes: pedido.ordenes, extras: pedido.extras || [], mesero: user.nombre, hora: hora(), fecha: fecha(), domicilio: null }
    : buildTicketPreview(entrada, tipo, mesaId, dom, refLlevar, pedido, user);

  const envioAlerta = envio?.estado === "error" ? (
    <div className="envio-alerta" role="alert">
      <span>{envio.incierto
        ? `No se pudo confirmar el envío: ${envio.mensaje} Si ya había llegado, reintentar no la duplica.`
        : `No se envió a cocina: ${envio.mensaje}`}</span>
      <button type="button" className="btn btn-sm btn-danger" onClick={finalizar}><RefreshCw size={14} aria-hidden="true" /> Reintentar envío</button>
    </div>
  ) : null;

  const botonEnviar = (
    <button type="button" className={"btn " + (esExtra ? "btn-barro" : "btn-primary")} disabled={vacio || enviando} onClick={finalizar} aria-busy={enviando}
      aria-label={enviando ? "Enviando a cocina" : esExtra ? "Enviar orden extra" : "Enviar a cocina"}>
      {enviando ? <Loader2 size={16} className="girando" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
      {enviando ? "Enviando…" : isPhone ? (esExtra ? "Enviar extra" : "Enviar") : esExtra ? "Enviar orden extra" : "Enviar a cocina"}
    </button>
  );
  const accionesBorrador = (entrada === "aqui" && !esExtra) || tieneProductos(b) ? (
    <div className="ticket-extra">
      {entrada === "aqui" && !esExtra && (
        <button type="button" className="btn btn-ghost btn-sm" disabled={enviando || (vacio && !mesaBorrador)} onClick={() => guardarBorrador()}>
          <Save size={14} aria-hidden="true" /> Guardar borrador
        </button>
      )}
      {tieneProductos(b) && (
        <button type="button" className="btn btn-danger-ghost btn-sm" disabled={enviando} onClick={descartar}>
          <Trash2 size={14} aria-hidden="true" /> Descartar
        </button>
      )}
    </div>
  ) : null;

  // Mesa ya enviada: resumen + orden extra (la orden original no se edita)
  if (mesaOcupada && !esExtra) {
    const ped = mesaInfo.pedido || { ordenes: [], extras: [] };
    const extrasMesa = mesaInfo.extras || [];
    const tot = ticketTotal(ped) + extrasMesa.reduce((s, e) => s + (e.total != null ? Number(e.total) : ticketTotal(e)), 0);
    const reenviar = async () => {
      if (!(await confirmDialog({ titulo: "Reenviar a cocina", mensaje: "Se enviará de nuevo a la cocina para que la impriman. No vuelve a contar como venta.", confirmar: "Reenviar" }))) return;
      db.reenviar(mesaId);
    };
    const pendienteLocal = tieneCambios(b);
    return (
      <div className="comanda-wrap">
        <div className="type-bar">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => go("mesas")}><ArrowLeft size={16} aria-hidden="true" /> Mesas</button>
          <span className="mesa-chip">Mesa {mesaId}</span>
        </div>
        {banner}
        {estadoBar}
        {pendienteLocal && (
          <div className="envio-alerta" role="alert" style={{ marginTop: 10 }}>
            <span>Otro dispositivo ya envió esta mesa. Tienes {contarProductos(b.pedido)} producto(s) capturados aquí que no se enviaron.</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-sm btn-barro" onClick={() => cambiar((d) => ({ ...d, esExtra: true, envio: null }), false)}>Enviarlos como orden extra</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => quitarBorrador()}>Descartarlos</button>
            </div>
          </div>
        )}
        <div className="resumen-scroll">
          <h3 className="resumen-h">Lo que ya se envió a cocina</h3>
          <ResumenPedido ped={ped} />
          {extrasMesa.map((ex, n) => (
            <div key={ex.id} className="resumen-extra">
              <div className="resumen-extra-h">Orden extra {n + 1}{ex.hora ? ` · ${ex.hora}` : ""}</div>
              <ResumenPedido ped={ex} />
            </div>
          ))}
          <div className="ticket-total"><span>Total</span><b>{money(tot)}</b></div>
        </div>
        <div className="resumen-actions">
          <button type="button" className="btn btn-barro btn-block" onClick={() => { cambiar((d) => ({ ...d, esExtra: true, pedido: nuevoPedido(), activa: 0, envio: null, envioId: null, sucio: false }), false); setPane("menu"); }}>
            <Plus size={16} aria-hidden="true" /> Agregar orden extra
          </button>
          <button type="button" className="btn btn-line btn-block" onClick={reenviar}><Send size={16} aria-hidden="true" /> Reenviar a cocina</button>
          <button type="button" className="btn btn-danger-ghost btn-block" onClick={confirmLiberar}>Marcar mesa como libre</button>
        </div>
      </div>
    );
  }

  return (
    <div className="comanda-wrap">
      {typeBar}
      {banner}
      {estadoBar}

      {isPhone ? (
        <>
          <div className="pane-toggle" role="tablist" aria-label="Vista de la comanda">
            <button type="button" role="tab" aria-selected={pane === "menu"} onClick={() => setPane("menu")}>Menú</button>
            <button type="button" role="tab" aria-selected={pane === "orden"} onClick={() => setPane("orden")}>Órdenes · {totalProd}</button>
          </div>
          <div className="pane-scroll" role="tabpanel">{pane === "menu" ? menuPane : ordenPane}</div>
          <div className="phone-footer">
            {envioAlerta}
            <div className="footer-der">
              {entrada === "aqui" && !esExtra && (
                <button type="button" className="btn btn-ghost" disabled={enviando || (vacio && !mesaBorrador)} onClick={() => guardarBorrador()} aria-label="Guardar borrador">
                  <Save size={16} aria-hidden="true" /> Guardar
                </button>
              )}
              <button type="button" className="btn btn-line" disabled={vacio} onClick={() => setTicket(previewTicket)} aria-label="Ver ticket"><Printer size={16} aria-hidden="true" /> Ticket</button>
              {botonEnviar}
            </div>
          </div>
        </>
      ) : (
        <div className="comanda">
          <section className="menu-pane" aria-label="Menú">
            <div className="menu-pane-scroll">{menuPane}</div>
          </section>
          <aside className="ticket-pane" aria-label="Órdenes de la comanda">
            {ordenPane}
            {envioAlerta}
            <div className="footer-der">
              <button type="button" className="btn btn-line" disabled={vacio} onClick={() => setTicket(previewTicket)}><Printer size={16} aria-hidden="true" /> Ver ticket</button>
              {botonEnviar}
            </div>
            {accionesBorrador}
          </aside>
        </div>
      )}

      {modalDom && (
        <DomicilioModal dom={dom} setDom={(nd) => cambiar((d) => ({ ...d, dom: nd }))}
          onAgregar={() => {
            if (!dom.direccion.trim() || !telefonoValido(dom.telefono)) return false;
            cambiar((d) => ({ ...d, domOk: true }), false); setModalDom(false); return true;
          }}
          onClose={() => setModalDom(false)} />
      )}
      {ticket && <TicketModal t={ticket} negocio={data.nombreNegocio} onClose={() => setTicket(null)} />}
    </div>
  );
}

function ResumenPedido({ ped }) {
  return (<>
    {(ped.ordenes || []).map((o) => (
      <div key={o.id} className="resumen-orden">
        <div className="resumen-oname">{o.nombre}{o.prep ? ` · ${PREP_LABEL[o.prep] || o.prep}` : ""}</div>
        {o.items.map((it) => <div key={it.key} className="resumen-item"><span>{it.cantidad}×</span> {it.nombre}</div>)}
      </div>
    ))}
    {(ped.extras || []).length > 0 && (
      <div className="resumen-orden">
        <div className="resumen-oname">Para todo el pedido</div>
        {ped.extras.map((it) => <div key={it.key} className="resumen-item"><span>{it.cantidad}×</span> {it.corto || it.nombre}</div>)}
      </div>
    )}
  </>);
}

function buildTicketPreview(entrada, tipo, mesaId, dom, refLlevar, pedido, user) {
  let tt, origen, paraLlevar = false;
  if (entrada === "aqui") { tt = "aqui"; origen = `Mesa ${mesaId}`; paraLlevar = tipo === "llevar"; }
  else if (entrada === "llevar") { tt = "llevar"; origen = refLlevar.trim() ? `Para llevar · ${refLlevar.trim()}` : "Para llevar"; }
  else { tt = "domicilio"; origen = dom.nombre || "Domicilio"; }
  return { id: "preview", tipo: tt, origen, paraLlevar, ordenes: pedido.ordenes, extras: pedido.extras || [],
    mesero: user.nombre, hora: hora(), fecha: fecha(), domicilio: entrada === "domicilio" ? dom : null };
}

/* columna de menú */
function MenuCol({ id, title, cat, items, onAdd }) {
  return (
    <section className="menu-col" id={id} style={{ "--cat": CATS[cat].color }} aria-labelledby={id + "-h"}>
      <h3 className="col-head" id={id + "-h"}>{title}</h3>
      <div className="col-items">{items.map((it) => <ItemBtn key={it.key} item={it} onAdd={onAdd} />)}</div>
    </section>
  );
}
function ItemBtn({ item, onAdd }) {
  return (
    <button type="button" className="item-btn" style={{ "--cat": CATS[item.cat].color }} onClick={() => onAdd(item)}
      aria-label={`Agregar ${item.nombre}, ${money(item.precio)}`}>
      <span className="item-nombre">{item.nombre}
        {item.cat === "bebida" && item.quedan != null && item.quedan <= 5 && <span className="item-quedan">quedan {item.quedan}</span>}</span>
      <span className="item-precio">{money(item.precio)}</span>
    </button>
  );
}

/* bloque de orden (una persona) */
function OrdenBlock({ o, activa, onSelect, onRename, onCant, onDelete, canDelete, onPrep }) {
  const [edit, setEdit] = useState(false);
  const total = o.items.reduce((a, i) => a + i.cantidad, 0);
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  return (
    <div className={"orden" + (activa ? " activa" : "")} onClick={onSelect}>
      <div className="orden-head">
        {edit ? (
          <input className="orden-input" autoFocus value={o.nombre} aria-label="Nombre de la orden" maxLength={40}
            onChange={(e) => onRename(e.target.value)} onBlur={() => setEdit(false)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEdit(false); } }}
            onClick={(e) => e.stopPropagation()} />
        ) : (
          <button type="button" className="orden-sel" aria-pressed={activa} onClick={stop(onSelect)}>
            {o.nombre}{activa && <span className="marca">Añadiendo aquí</span>}
          </button>
        )}
        <div className="orden-right">
          <span className="orden-count" aria-label={`${total} productos`}>{total}</span>
          {!edit && <button type="button" className="icon-btn" aria-label={`Renombrar ${o.nombre}`} onClick={stop(() => setEdit(true))}><Pencil size={16} aria-hidden="true" /></button>}
          {canDelete && <button type="button" className="icon-btn" aria-label={`Eliminar ${o.nombre}`} onClick={stop(onDelete)}><Trash2 size={17} aria-hidden="true" /></button>}
        </div>
      </div>
      {o.items.length === 0 ? (
        <div className="orden-empty">{activa ? "Toca un producto del menú para agregarlo aquí." : "Sin productos. Selecciónala para agregar."}</div>
      ) : (
        <ul className="orden-items">
          {o.items.map((it) => (
            <li key={it.key} className="oitem" style={{ "--cat": (CATS[it.cat] || CATS.taco).color }}>
              <span className="oitem-dot" aria-hidden="true" /><span className="oitem-name">{it.nombre}</span>
              <span className="oitem-precio">{money((it.precio || 0) * it.cantidad)}</span>
              <div className="stepper" onClick={(e) => e.stopPropagation()}>
                <button type="button" aria-label={`Quitar un ${it.nombre} de ${o.nombre}`} onClick={() => onCant(it.key, -1)}><Minus size={16} aria-hidden="true" /></button>
                <span aria-label={`${it.cantidad} ${it.nombre}`}>{it.cantidad}</span>
                <button type="button" aria-label={`Agregar un ${it.nombre} a ${o.nombre}`} onClick={() => onCant(it.key, 1)}><Plus size={16} aria-hidden="true" /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="orden-prep" role="group" aria-label={`Preparación de ${o.nombre}`}>
        <span className="orden-prep-label" aria-hidden="true">Preparación:</span>
        {PREPS.map((pr) => (
          <button type="button" key={pr.k} className="prep-chip" aria-pressed={o.prep === pr.k}
            onClick={stop(() => onPrep(pr.k))}>{pr.label}</button>
        ))}
      </div>
    </div>
  );
}

/* datos del domicilio */
function DomicilioModal({ dom, setDom, onAgregar, onClose }) {
  const id = useId();
  const [intento, setIntento] = useState(false);
  const f = (k) => (e) => setDom({ ...dom, [k]: e.target.value });
  const errDir = intento && !dom.direccion.trim() ? "Escribe la dirección." : "";
  const errTel = intento && !telefonoValido(dom.telefono) ? "Escribe un teléfono de 7 a 20 dígitos." : "";
  return (
    <Modal titulo="Datos del domicilio" icono={<Bike size={20} aria-hidden="true" />} onClose={onClose} className="modal-dom">
      <form noValidate onSubmit={(e) => { e.preventDefault(); setIntento(true); onAgregar(); }}>
        <div className="modal-body">
          <label htmlFor={id + "n"}>Nombre</label>
          <input id={id + "n"} className="inp" value={dom.nombre} onChange={f("nombre")} placeholder="Nombre de quien pide" autoComplete="off" maxLength={80} />
          <label htmlFor={id + "d"}>Dirección <span className="req" aria-hidden="true">*</span></label>
          <input id={id + "d"} className="inp" value={dom.direccion} onChange={f("direccion")} placeholder="Calle, número, colonia" autoComplete="off"
            required aria-required="true" aria-invalid={!!errDir} aria-describedby={errDir ? id + "de" : undefined} maxLength={200} />
          {errDir && <span className="login-err" id={id + "de"}>{errDir}</span>}
          <label htmlFor={id + "r"}>Referencia</label>
          <input id={id + "r"} className="inp" value={dom.referencia} onChange={f("referencia")} placeholder="Entre calles, color de casa…" autoComplete="off" maxLength={200} />
          <label htmlFor={id + "t"}>Número telefónico <span className="req" aria-hidden="true">*</span></label>
          <input id={id + "t"} className="inp" type="tel" inputMode="tel" value={dom.telefono} onChange={f("telefono")} placeholder="10 dígitos" autoComplete="off"
            required aria-required="true" aria-invalid={!!errTel} aria-describedby={errTel ? id + "te" : undefined} maxLength={20} />
          {errTel && <span className="login-err" id={id + "te"}>{errTel}</span>}
          <div className="dom-row">
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}><label htmlFor={id + "p"}>Pago</label>
              <select id={id + "p"} className="inp" value={dom.pago} onChange={f("pago")}>
                <option value="efectivo">Efectivo</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="transferencia">Transferencia</option>
              </select></div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}><label htmlFor={id + "m"}>Tiempo estimado (min)</label>
              <input id={id + "m"} className="inp" inputMode="numeric" value={dom.tiempo} onChange={(e) => setDom({ ...dom, tiempo: e.target.value.replace(/\D/g, "").slice(0, 3) })} placeholder="30" /></div>
          </div>
          <p className="muted small" style={{ margin: "8px 0 0" }}><span aria-hidden="true">*</span> Obligatorio</p>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cerrar</button>
          <button type="submit" className="btn btn-primary"><Check size={16} aria-hidden="true" /> Guardar datos</button>
        </div>
      </form>
    </Modal>
  );
}

/* etiqueta + color para tickets y cocina */
function ticketView(t) {
  if (t.reenvio) return { label: "Reenvío (no es venta)", color: "var(--tinta2)" };
  if (t.esExtra) return { label: "Orden extra", color: "var(--especial)" };
  if (t.tipo === "aqui" && t.paraLlevar) return { label: "Exclusivo para llevar", color: TIPOS.llevar.color };
  const Tb = TIPOS[t.tipo] || TIPOS.aqui;
  return { label: Tb.label, color: Tb.color };
}

/* impresión térmica 58mm — un solo ticket (estilo cuenta) sirve para cocina y cliente */
const esBebida = (it) => it.cat === "bebida" || (it.key || "").startsWith("beb-");
const itemPrecio = (it) => (it.precio || 0) * it.cantidad;

const AUTOPRINT_KEY = "tequeria_autoprint";
const getAutoprint = () => { try { return localStorage.getItem(AUTOPRINT_KEY) === "1"; } catch { return false; } };
const setAutoprintLS = (v) => { try { localStorage.setItem(AUTOPRINT_KEY, v ? "1" : "0"); } catch {} };

// Sonido corto (beep) sin archivos
function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
    const ac = new Ctx(); const o = ac.createOscillator(); const g = ac.createGain();
    o.type = "sine"; o.frequency.value = 880; o.connect(g); g.connect(ac.destination);
    g.gain.setValueAtTime(0.001, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.3, ac.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.35);
    o.start(); o.stop(ac.currentTime + 0.36);
    setTimeout(() => { try { ac.close(); } catch {} }, 600);
  } catch {}
}
function notificar(titulo, cuerpo) {
  try { if (navigator.vibrate) navigator.vibrate([120, 60, 120]); } catch {}
  beep();
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(titulo, { body: cuerpo, tag: "tequeria-pedido" });
    }
  } catch {}
}

function TicketModal({ t, negocio, onClose, autoPrint }) {
  const ex = t.extras || [];
  const ordenes = t.ordenes || [];
  const [modo, setModo] = useState(t.cuenta || "junta");   // "junta" | "separada"
  const [auto, setAuto] = useState(getAutoprint());
  const doPrint = () => { setTimeout(() => window.print(), 80); };

  useEffect(() => {
    if (autoPrint) {
      const id = setTimeout(() => window.print(), 350);
      return () => clearTimeout(id);
    }
  }, []);

  const total = ordenes.reduce((s, o) => s + o.items.reduce((a, i) => a + itemPrecio(i), 0), 0) + ex.reduce((a, e) => a + itemPrecio(e), 0);

  // En modo JUNTA agrupamos las bebidas de todas las órdenes hasta abajo
  const bebidasJuntas = [];
  if (modo === "junta") {
    const map = {};
    ordenes.forEach((o) => o.items.forEach((it) => {
      if (esBebida(it)) { if (!map[it.key]) { map[it.key] = { ...it }; bebidasJuntas.push(map[it.key]); } else map[it.key].cantidad += it.cantidad; }
    }));
  }

  const Item = ({ it }) => (
    <div className="tp-item">
      <span className="tp-q">{it.cantidad}</span>
      <span className="tp-n">{nombreTicket(it)}</span>
      <span className="tp-p">{itemPrecio(it) > 0 ? money(itemPrecio(it)) : ""}</span>
    </div>
  );

  return (
    <Modal titulo={`Ticket · ${t.origen}`} icono={<Printer size={20} aria-hidden="true" />} onClose={onClose} className="modal-ticket">
      <div id="print-area" className="ticket-print t58">
        <div className="tp-name">{negocio}</div>
        <div className="tp-sub">{t.origen}{t.paraLlevar ? " · para llevar" : ""}{t.reenvio ? " · REIMPRESIÓN" : ""}</div>
        <div className="tp-meta"><span>Mesero: {t.mesero}</span><span>{t.hora}</span></div>
        <div className="tp-meta"><span>{t.fecha}</span><span className="tp-modo-tag">{modo === "separada" ? "CUENTA SEPARADA" : "CUENTA"}</span></div>
        {t.domicilio && !t.domicilio.anonimizado && (
          <div className="tp-dom">
            {t.domicilio.nombre && <div>Cliente: {t.domicilio.nombre}</div>}
            <div>Dir: {t.domicilio.direccion}</div>
            {t.domicilio.referencia && <div>Ref: {t.domicilio.referencia}</div>}
            <div>Tel: {t.domicilio.telefono}</div>
            <div>Pago: {t.domicilio.pago}{t.domicilio.tiempo ? ` · ${t.domicilio.tiempo} min` : ""}</div>
          </div>
        )}
        <div className="tp-line" />

        {modo === "separada" ? (
          ordenes.map((o) => {
            const sub = o.items.reduce((a, i) => a + itemPrecio(i), 0);
            return (
              <div key={o.id} className="tp-orden">
                <div className="tp-oname">{o.nombre}{o.prep ? " · " + (PREP_LABEL[o.prep] || o.prep) : ""}</div>
                <div className="tp-items">{o.items.map((it) => <Item key={it.key} it={it} />)}</div>
                <div className="tp-suborden"><span>Subtotal {o.nombre}</span><span>{money(sub)}</span></div>
              </div>
            );
          })
        ) : (
          <>
            {ordenes.map((o) => {
              const comida = o.items.filter((it) => !esBebida(it));
              if (comida.length === 0) return null;
              return (
                <div key={o.id} className="tp-orden">
                  <div className="tp-oname">{o.nombre}{o.prep ? " · " + (PREP_LABEL[o.prep] || o.prep) : ""}</div>
                  <div className="tp-items">{comida.map((it) => <Item key={it.key} it={it} />)}</div>
                </div>
              );
            })}
            {bebidasJuntas.length > 0 && (
              <div className="tp-orden tp-bebidas">
                <div className="tp-oname">BEBIDAS</div>
                <div className="tp-items">{bebidasJuntas.map((it) => <Item key={it.key} it={it} />)}</div>
              </div>
            )}
          </>
        )}

        {ex.length > 0 && (
          <>
            <div className="tp-line" />
            <div className="tp-extras-h">* PARA TODO EL PEDIDO</div>
            <div className="tp-items">{ex.map((it) => <Item key={it.key} it={it} />)}</div>
          </>
        )}

        <div className="tp-line" />
        <div className="tp-total"><span>TOTAL</span><span>{t.reenvio ? "—" : money(total)}</span></div>
        <div className="tp-foot">¡Gracias por su compra!</div>
      </div>

      {ordenes.length > 1 && (
        <div className="ticket-modos no-print" role="group" aria-label="Formato de la cuenta">
          <button type="button" className="seg-b" aria-pressed={modo === "junta"} onClick={() => setModo("junta")}>Junta</button>
          <button type="button" className="seg-b" aria-pressed={modo === "separada"} onClick={() => setModo("separada")}>Separada</button>
        </div>
      )}
      <label className="auto-print no-print">
        <input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); setAutoprintLS(e.target.checked); }} />
        Auto-imprimir nuevos pedidos (cocina)
      </label>
      <div className="modal-actions no-print">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cerrar</button>
        <button type="button" className="btn btn-primary" onClick={doPrint}><Printer size={16} aria-hidden="true" /> Imprimir</button>
      </div>
    </Modal>
  );
}

/* ============================== AVISOS DE COCINA ============================== */
function CocinaAlertas({ data, onAbrir }) {
  const seen = useRef(null);
  const [nuevos, setNuevos] = useState([]);
  const [permiso, setPermiso] = useState(typeof Notification !== "undefined" ? Notification.permission : "unsupported");

  useEffect(() => {
    const pend = (data.cocina || []).filter((t) => t.estado !== "listo");
    const ids = new Set(pend.map((t) => t.id));
    if (seen.current === null) { seen.current = ids; return; }   // primera carga: no avisar
    const recien = pend.filter((t) => !seen.current.has(t.id));
    seen.current = ids;
    if (recien.length > 0) {
      const t0 = recien[0];
      notificar("Nuevo pedido", (t0.esExtra ? "Orden extra · " : "") + t0.origen + (recien.length > 1 ? ` (+${recien.length - 1})` : ""));
      setNuevos((xs) => [...recien, ...xs].slice(0, 8));
      if (getAutoprint()) onAbrir(recien[0], true);
    }
  }, [data.cocina]);

  const pedirPermiso = async () => { try { setPermiso(await Notification.requestPermission()); } catch {} };
  const quitar = (id) => setNuevos((xs) => xs.filter((x) => x.id !== id));

  if (nuevos.length === 0 && permiso !== "default") return null;
  return (
    <div className="cocina-alertas" role="region" aria-label="Avisos de cocina">
      {permiso === "default" && (
        <button type="button" className="alerta-permiso" onClick={pedirPermiso}>🔔 Activar avisos de nuevos pedidos</button>
      )}
      <div role="status" aria-live="polite" style={{ display: "contents" }}>
        {nuevos.map((t) => (
          <div key={t.id} className={"alerta-pedido" + (t.esExtra ? " extra" : "")}>
            <span className="alerta-txt"><span aria-hidden="true">🔔 </span>{t.esExtra ? "Orden extra" : "Nuevo pedido"}: <b>{t.origen}</b></span>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => { onAbrir(t); quitar(t.id); }}><Printer size={14} aria-hidden="true" /> Imprimir</button>
            <button type="button" className="icon-btn" aria-label={`Ocultar aviso de ${t.origen}`} onClick={() => quitar(t.id)}><X size={16} aria-hidden="true" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================== COCINA ============================== */
function Cocina({ data, db, user, errorCarga }) {
  const edita = puedeEditar(user, "cocina");
  const [tab, setTab] = useState("pendientes");
  const [ticket, setTicket] = useState(null);

  const pend = (data.cocina || []).filter((t) => t.estado !== "listo");
  const listos = (data.cocina || []).filter((t) => t.estado === "listo");
  const historial = data.historial || [];
  const res = data.periodo || { total: 0, count: 0, porTipo: {}, porMesero: {}, top: [], gastos: 0 };

  const compartirWhatsApp = () => {
    const txt = textoCorteWhatsApp(data.nombreNegocio, res, fecha());
    try { window.open("https://wa.me/?text=" + encodeURIComponent(txt), "_blank", "noopener"); }
    catch { try { navigator.clipboard.writeText(txt); toast("Resumen copiado", "ok"); } catch {} }
  };

  const hacerCorte = async () => {
    if (errorCarga) { toast("No se puede hacer el corte con datos desactualizados. Reintenta la carga primero.", "error"); return; }
    if (!res.count) { toast("No hay ventas en este periodo.", "info"); return; }
    if (!(await confirmDialog({ titulo: "Corte del día", mensaje: `Ventas: ${res.count} · Total: ${money(res.total)}. El servidor calculará el total definitivo. Las comandas pendientes seguirán en cocina.`, confirmar: "Hacer corte" }))) return;
    const pin = await pedirPin({ titulo: "Corte del día", mensaje: "Escribe el PIN de un administrador para autorizar el corte.", etiqueta: "PIN de administrador" });
    if (pin === null) return;
    const r = await db.corte(pin);
    if (r.ok) toast(`Corte guardado: ${r.r.corte.tickets} venta(s) · ${money(r.r.corte.total)}`, "ok");
  };

  return (
    <div className="screen">
      <div className="screen-head"><div><h2>Cocina</h2>
        <p className="muted">{edita ? "Comandas en preparación y ventas del periodo (desde el último corte)." : "Vista de comandas pendientes (solo lectura)."}</p></div></div>

      {edita && (
        <div className="admin-tabs" role="tablist" aria-label="Secciones de cocina">
          <button type="button" role="tab" aria-selected={tab === "pendientes"} onClick={() => setTab("pendientes")}>Pendientes · {pend.length}</button>
          <button type="button" role="tab" aria-selected={tab === "historial"} onClick={() => setTab("historial")}>Ventas / Corte</button>
        </div>
      )}

      {(tab === "pendientes" || !edita) && (
        <>
          {pend.length === 0 && <div className="empty">No hay comandas pendientes.</div>}
          <div className="cocina-grid">
            {pend.map((t) => {
              const tv = ticketView(t);
              return (
                <article key={t.id} className={"kticket " + t.estado} aria-label={`${tv.label}: ${t.origen}, ${t.hora}`}>
                  <div className="kt-tipo" style={{ background: tv.color }}>{tv.label}</div>
                  <div className="kt-head"><span className="kt-origen">{t.origen}</span><span className="kt-hora">{t.hora}</span></div>
                  <div className="kt-mesero">{t.mesero}</div>
                  {t.estado === "preparando" && <div className="kt-estado">En preparación</div>}
                  {t.domicilio && !t.domicilio.anonimizado && (
                    <div className="kt-dom">📍 {t.domicilio.direccion}{t.domicilio.referencia ? ` · ${t.domicilio.referencia}` : ""}<br />📞 {t.domicilio.telefono} · {t.domicilio.pago}</div>
                  )}
                  <div className="kt-body">
                    {t.ordenes.map((o) => (
                      <div key={o.id} className="kt-orden"><div className="kt-oname">{o.nombre}</div>
                        {o.prep && <div className="kt-prep">» {PREP_LABEL[o.prep] || o.prep}</div>}
                        {o.items.map((it) => <div key={it.key} className="kt-item"><b>{it.cantidad}×</b> {it.nombre}</div>)}</div>
                    ))}
                    {t.extras && t.extras.length > 0 && (
                      <div className="kt-extras">
                        <div className="kt-extras-h">Para todo el pedido</div>
                        {t.extras.map((it) => <div key={it.key} className="kt-item"><b>{it.cantidad}×</b> {it.corto || it.nombre}</div>)}
                      </div>
                    )}
                  </div>
                  <div className="kt-tacos"><span aria-hidden="true">🌮 </span>Tacos en total: <b>{contarTacos(t)}</b></div>
                  {edita && (
                    <div className="kt-actions">
                      <button type="button" className="btn btn-line btn-sm" onClick={() => setTicket(t)}><Printer size={14} aria-hidden="true" /> Imprimir</button>
                      {t.estado === "pendiente" && <button type="button" className="btn btn-line btn-sm" onClick={() => db.setTicketEstado(t.id, "preparando")}>Preparando</button>}
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => db.setTicketEstado(t.id, "listo")}><Check size={14} aria-hidden="true" /> Listo</button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          {edita && listos.length > 0 && (
            <><h3 className="sub-h">Listos</h3>
              <div className="listos-row">
                {listos.map((t) => (
                  <div key={t.id} className="listo-chip"><span>{t.origen} · {t.hora}</span>
                    <button type="button" className="icon-btn" aria-label={`Regresar ${t.origen} a preparación`} title="Regresar a preparación" onClick={() => db.setTicketEstado(t.id, "preparando")}><Undo2 size={16} aria-hidden="true" /></button>
                    <button type="button" className="icon-btn" aria-label={`Quitar ${t.origen} de la lista de listos`} title="Quitar de la lista" onClick={() => db.archivarTicket(t.id)}><X size={16} aria-hidden="true" /></button>
                  </div>
                ))}
              </div></>
          )}
        </>
      )}

      {edita && tab === "historial" && (
        <>
          <div className="corte-bar">
            <div><div className="corte-total">{money(res.total)}</div>
              <div className="muted small">{res.count} venta(s) en el periodo{res.gastos > 0 ? ` · gastos ${money(res.gastos)} · neto ${money(res.total - res.gastos)}` : ""}</div></div>
            <div className="corte-btns">
              <button type="button" className="btn btn-line" onClick={compartirWhatsApp} disabled={res.count === 0}>Compartir</button>
              <button type="button" className="btn btn-primary" onClick={hacerCorte} disabled={!!errorCarga}>Hacer corte</button>
            </div>
          </div>
          <p className="muted small" style={{ marginTop: -6 }}>Ventas = comandas enviadas a cocina (los reenvíos no cuentan). El corte no confirma cobros.</p>

          {res.count > 0 && (
            <div className="corte-desglose">
              <div className="cd-col">
                <h4>Por tipo</h4>
                {Object.entries(res.porTipo || {}).map(([k, v]) => <div key={k} className="cd-row"><span>{k}</span><b>{money(v)}</b></div>)}
              </div>
              <div className="cd-col">
                <h4>Por mesero</h4>
                {Object.entries(res.porMesero || {}).map(([k, v]) => <div key={k} className="cd-row"><span>{k}</span><b>{money(v)}</b></div>)}
              </div>
              <div className="cd-col">
                <h4>Más vendidos</h4>
                {(res.top || []).map((p) => <div key={p.nombre} className="cd-row"><span>{p.nombre}</span><b>×{p.cant}</b></div>)}
              </div>
            </div>
          )}

          {historial.length === 0 && <div className="empty">Aún no hay ventas en este periodo.</div>}
          {historial.length < res.count && <p className="muted small">Se muestran las {historial.length} más recientes de {res.count}; los totales incluyen todas.</p>}
          <div className="hist-list">
            {historial.map((t) => {
              const tv = ticketView(t);
              return (
                <div key={t.id} className="hist-row">
                  <span className="hist-dot" aria-hidden="true" style={{ background: tv.color }} />
                  <div className="hist-info">
                    <div className="hist-origen">{t.origen}{t.esExtra ? " · orden extra" : ""}</div>
                    <div className="muted small">{t.hora} · {t.mesero} · {contarProductos(t)} prod.</div>
                  </div>
                  <div className="hist-total">{money(t.total != null ? t.total : ticketTotal(t))}</div>
                  <button type="button" className="btn btn-line btn-sm" onClick={() => setTicket(t)} aria-label={`Ver ticket de ${t.origen}, ${t.hora}`}><Printer size={14} aria-hidden="true" /> Ver</button>
                </div>
              );
            })}
          </div>
          {(data.cortes || []).length > 0 && (
            <><h3 className="sub-h">Cortes anteriores</h3>
              <div className="hist-list">
                {data.cortes.map((c) => (
                  <div key={c.id} className="hist-row">
                    <div className="hist-info"><div className="hist-origen">Corte {c.fecha}</div>
                      <div className="muted small">{c.hora} · {c.tickets} ventas{c.gastos > 0 ? ` · gastos ${money(c.gastos)}` : ""}{c.detalle?.top?.[0] ? ` · top: ${c.detalle.top[0].nombre}` : ""}</div></div>
                    <div className="hist-total">{money(c.total)}</div>
                  </div>
                ))}
              </div></>
          )}
        </>
      )}

      {ticket && <TicketModal t={ticket} negocio={data.nombreNegocio} onClose={() => setTicket(null)} />}
    </div>
  );
}

/* ============================== INVENTARIO ============================== */
function CantidadInput({ valor, nombre, onGuardar }) {
  const [txt, setTxt] = useState(String(valor));
  const [editando, setEditando] = useState(false);
  useEffect(() => { if (!editando) setTxt(String(valor)); }, [valor, editando]);
  const confirmar = () => {
    setEditando(false);
    const n = parseInt(txt, 10);
    if (!Number.isFinite(n) || n < 0) { setTxt(String(valor)); return; }
    if (n !== valor) onGuardar(n);
  };
  return (
    <input className="qty-inp" inputMode="numeric" aria-label={`Existencia de ${nombre}`} value={txt}
      onFocus={() => setEditando(true)} onChange={(e) => setTxt(e.target.value.replace(/\D/g, "").slice(0, 6))}
      onBlur={confirmar} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
  );
}

function Inventario({ data, db }) {
  return (
    <div className="screen">
      <div className="screen-head"><div><h2>Inventario</h2>
        <p className="muted">Marca lo disponible hoy. Cuando una bebida llega a 0 desaparece del menú. Las ventas descuentan existencias en el servidor.</p></div></div>
      <h3 className="sub-h">Bebidas y aguas</h3>
      <div className="inv-list">
        {data.bebidas.map((b) => (
          <div key={b.id} className={"inv-row" + (b.cantidad === 0 ? " agotado" : "")}>
            <label className="switch"><input type="checkbox" checked={b.activo} aria-label={`${b.nombre} disponible`} onChange={(e) => db.updateBebida(b.id, { activo: e.target.checked })} /><span aria-hidden="true" /></label>
            <span className="inv-name">{b.nombre}</span>
            {b.cantidad === 0 && <span className="tag-agotado">Agotado</span>}
            <div className="stepper">
              <button type="button" aria-label={`Restar una ${b.nombre}`} onClick={() => db.ajustarBebida(b.id, -1)} disabled={b.cantidad === 0}><Minus size={16} aria-hidden="true" /></button>
              <CantidadInput valor={b.cantidad} nombre={b.nombre} onGuardar={(n) => db.updateBebida(b.id, { cantidad: n })} />
              <button type="button" aria-label={`Sumar una ${b.nombre}`} onClick={() => db.ajustarBebida(b.id, 1)}><Plus size={16} aria-hidden="true" /></button>
            </div>
          </div>
        ))}
      </div>
      <h3 className="sub-h">Carnes</h3>
      <div className="inv-list">
        {data.carnes.map((c) => (
          <div key={c.id} className="inv-row">
            <label className="switch"><input type="checkbox" checked={c.activo} aria-label={`${c.nombre} disponible en el menú`} onChange={(e) => db.updateCarne(c.id, e.target.checked)} /><span aria-hidden="true" /></label>
            <span className="inv-name">{c.nombre}</span>
            <span className="muted">{c.activo ? "Disponible en el menú" : "Oculta del menú"}</span>
          </div>
        ))}
      </div>
      <p className="muted small" style={{ marginTop: 18 }}>Para agregar o quitar bebidas, carnes o productos, y cambiar precios, ve a Administración.</p>
    </div>
  );
}

/* ============================== GASTOS ============================== */
function Gastos({ data, db }) {
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("");
  const [err, setErr] = useState("");
  const id = useId();
  const gastos = data.gastos || [];
  const add = async (e) => {
    e.preventDefault(); setErr("");
    const m = leerImporte(monto);
    if (!concepto.trim()) { setErr("Escribe el concepto."); return; }
    if (!m || m <= 0) { setErr("Escribe un monto mayor a cero."); return; }
    const r = await db.addGasto(concepto.trim(), m);
    if (r.ok) { setConcepto(""); setMonto(""); }
  };
  const borrar = async (g) => {
    if (!(await confirmDialog({ titulo: "Eliminar gasto", mensaje: `¿Eliminar «${g.concepto}» por ${money(g.monto)}? Quedará registrado en la bitácora.`, confirmar: "Eliminar", peligro: true }))) return;
    db.removeGasto(g.id);
  };
  const total = gastos.reduce((s, g) => s + (Number(g.monto) || 0), 0);
  return (
    <div className="screen">
      <div className="screen-head"><div><h2>Gastos</h2><p className="muted">Salidas de dinero del periodo actual (desde el último corte).</p></div></div>
      <form className="gasto-add" onSubmit={add}>
        <div className="campo"><label htmlFor={id + "c"}>Concepto</label>
          <input id={id + "c"} className="inp" value={concepto} maxLength={120} onChange={(e) => setConcepto(e.target.value)} /></div>
        <div className="campo campo-monto"><label htmlFor={id + "m"}>Monto ($)</label>
          <input id={id + "m"} className="inp" placeholder="0.00" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} /></div>
        <button type="submit" className="btn btn-add"><Plus size={16} aria-hidden="true" /> Registrar</button>
      </form>
      {err && <div className="login-err" role="alert" style={{ marginTop: 8 }}>{err}</div>}
      <div className="gasto-total">Total del periodo: <b>{money(total)}</b></div>
      <div className="gasto-list">
        {gastos.length === 0 && <div className="empty">Aún no hay gastos en este periodo.</div>}
        {gastos.map((g) => (
          <div key={g.id} className="gasto-row">
            <div><div className="gasto-concepto">{g.concepto}</div>
              <div className="muted small">{g.fecha} · {g.hora} · {g.user}</div></div>
            <div className="gasto-monto">{money(g.monto)}</div>
            <button type="button" className="icon-btn" aria-label={`Eliminar gasto ${g.concepto}`} onClick={() => borrar(g)}><Trash2 size={17} aria-hidden="true" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================== ADMINISTRACIÓN (solo admin) ============================== */
function Admin({ data, db, user }) {
  const [tab, setTab] = useState("precios");
  return (
    <div className="screen">
      <div className="screen-head"><div><h2>Administración</h2>
        <p className="muted">Solo el administrador. Aquí defines precios, productos y usuarios.</p></div></div>
      <div className="admin-tabs" role="tablist" aria-label="Secciones de administración">
        {[["precios", "Precios"], ["productos", "Productos"], ["meseros", "Usuarios"]].map(([k, l]) => (
          <button type="button" role="tab" key={k} aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === "precios" && <AdminPrecios data={data} db={db} />}
        {tab === "productos" && <AdminProductos data={data} db={db} />}
        {tab === "meseros" && <AdminMeseros data={data} db={db} user={user} />}
      </div>
    </div>
  );
}

function AdminPrecios({ data, db }) {
  const grupos = catalogoBase(data.carnes);
  const empaqueRows = empaqueItems(data.precios).filter((e) => e.key !== "verdura-aparte");
  return (
    <div>
      <p className="muted small">Escribe el precio y presiona Enter o sal del campo para guardarlo. Se admiten centavos (ej. 25.50).</p>
      {Object.entries(grupos).map(([cat, rows]) => (
        <section key={cat} aria-labelledby={`hp-${cat}`}>
          <h3 className="sub-h" id={`hp-${cat}`} style={{ color: CATS[cat].color }}>{CATS[cat].label}</h3>
          <div className="precio-list">
            {rows.map((r) => (
              <PrecioRow key={r.key} nombre={r.nombre} value={data.precios[r.key] ?? 0} onGuardar={(v) => db.setPrecio(r.key, v)} />
            ))}
            {data.extras.filter((e) => e.cat === cat).map((e) => (
              <PrecioRow key={e.id} nombre={e.nombre + " (agregado)"} value={e.precio} onGuardar={(v) => db.setExtraPrecio(e.id, v)} />
            ))}
          </div>
        </section>
      ))}
      <h3 className="sub-h" style={{ color: CATS.bebida.color }}>Refrescos y aguas</h3>
      <div className="precio-list">
        {data.bebidas.map((b) => (
          <PrecioRow key={b.id} nombre={b.nombre} value={b.precio ?? 0} onGuardar={(v) => db.updateBebida(b.id, { precio: v })} />
        ))}
      </div>
      <h3 className="sub-h" style={{ color: CATS.empaque.color }}>Para llevar / empaque</h3>
      <p className="muted small">La "verdura aparte" siempre es sin costo.</p>
      <div className="precio-list">
        {empaqueRows.map((r) => (
          <PrecioRow key={r.key} nombre={r.nombre} value={data.precios[r.key] ?? 0} onGuardar={(v) => db.setPrecio(r.key, v)} />
        ))}
      </div>
    </div>
  );
}

// Edita con texto local y guarda al confirmar (no una petición por tecla)
function PrecioRow({ nombre, value, onGuardar }) {
  const id = useId();
  const [txt, setTxt] = useState(String(value));
  const [editando, setEditando] = useState(false);
  const [estado, setEstado] = useState("");
  useEffect(() => { if (!editando) setTxt(String(value)); }, [value, editando]);
  const confirmar = async () => {
    setEditando(false);
    const v = leerImporte(txt);
    if (v == null || v > 100000) { setEstado("No válido"); setTxt(String(value)); return; }
    if (v === Number(value)) { setEstado(""); return; }
    setEstado("Guardando…");
    const r = await onGuardar(v);
    setEstado(r?.ok ? "Guardado ✓" : "Error");
  };
  return (
    <div className="precio-row">
      <label className="precio-nombre" htmlFor={id}>{nombre}</label>
      <span className="precio-estado" aria-live="polite">{estado}</span>
      <div className="precio-input">
        <span aria-hidden="true">$</span>
        <input id={id} inputMode="decimal" value={txt} onFocus={() => { setEditando(true); setEstado(""); }}
          onChange={(e) => setTxt(e.target.value)} onBlur={confirmar}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setTxt(String(value)); setEditando(false); } }} />
      </div>
    </div>
  );
}

function CatCategoria({ titulo, cat, base, extras, ocultos, onToggle, onAdd, onDelExtra }) {
  const [nombre, setNombre] = useState("");
  const [precio, setPrecio] = useState("");
  const id = useId();
  const agregar = async (e) => {
    e.preventDefault();
    if (!nombre.trim()) return;
    const p = leerImporte(precio) ?? 0;
    const r = await onAdd(cat, nombre.trim(), p);
    if (r?.ok) { setNombre(""); setPrecio(""); }
  };
  return (
    <section aria-labelledby={id + "h"}>
      <h3 className="sub-h" id={id + "h"} style={{ color: CATS[cat].color }}>{titulo}</h3>
      <div className="inv-list">
        {base.map((it) => {
          const oculto = ocultos.includes(it.key);
          return (
            <div key={it.key} className={"inv-row" + (oculto ? " agotado" : "")}>
              <label className="switch"><input type="checkbox" checked={!oculto} aria-label={`Mostrar ${it.nombre} en el menú`} onChange={() => onToggle(it.key)} /><span aria-hidden="true" /></label>
              <span className="inv-name">{it.nombre}</span>
              {oculto && <span className="muted">oculto del menú</span>}
            </div>
          );
        })}
        {extras.map((e) => (
          <div key={e.id} className="inv-row">
            <span className="inv-name">{e.nombre} <span className="muted">(agregado)</span></span>
            <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => onDelExtra(e)}><Trash2 size={14} aria-hidden="true" /> Quitar</button>
          </div>
        ))}
      </div>
      <form className="prod-add" onSubmit={agregar}>
        <label className="sr-only" htmlFor={id + "n"}>Nuevo producto en {titulo}</label>
        <input id={id + "n"} className="inp" placeholder={`Agregar en ${titulo}`} value={nombre} maxLength={60} onChange={(e) => setNombre(e.target.value)} />
        <label className="sr-only" htmlFor={id + "p"}>Precio</label>
        <input id={id + "p"} className="inp inp-sm" inputMode="decimal" placeholder="Precio" value={precio} onChange={(e) => setPrecio(e.target.value)} />
        <button type="submit" className="btn btn-add" aria-label={`Agregar producto en ${titulo}`}><Plus size={16} aria-hidden="true" /></button>
      </form>
    </section>
  );
}

function AdminProductos({ data, db }) {
  const [carne, setCarne] = useState("");
  const [beb, setBeb] = useState({ nombre: "", precio: "", cantidad: "" });
  const id = useId();
  const base = catalogoBase(data.carnes);
  const ocultos = data.ocultos || [];

  const addCarne = async (e) => {
    e.preventDefault();
    const n = carne.trim(); if (!n) return;
    if (data.carnes.some((c) => c.id === slug(n))) { toast("Esa carne ya existe.", "error"); return; }
    const r = await db.addCarne(n);
    if (r.ok) setCarne("");
  };
  const quitarCarne = async (c) => {
    if (!(await confirmDialog({ titulo: "Quitar carne", mensaje: `¿Quitar ${c.nombre} y todos sus productos del menú?`, confirmar: "Quitar", peligro: true }))) return;
    db.removeCarne(c.id);
  };
  const quitarExtra = async (e) => {
    if (!(await confirmDialog({ titulo: "Quitar producto", mensaje: `¿Quitar «${e.nombre}» del menú?`, confirmar: "Quitar", peligro: true }))) return;
    db.removeExtra(e.id);
  };
  const addBeb = async (e) => {
    e.preventDefault();
    const n = beb.nombre.trim(); if (!n) return;
    const r = await db.addBebida(n, leerImporte(beb.precio) ?? 0, parseInt(beb.cantidad || "0", 10) || 0);
    if (r.ok) setBeb({ nombre: "", precio: "", cantidad: "" });
  };
  const quitarBeb = async (b) => {
    if (!(await confirmDialog({ titulo: "Quitar bebida", mensaje: `¿Quitar ${b.nombre} del inventario?`, confirmar: "Quitar", peligro: true }))) return;
    db.removeBebida(b.id);
  };
  const cats = [["taco", "Tacos"], ["quesa", "Quesadillas / Gringas"], ["volcan", "Volcanes"], ["costra", "Especialidad — Costra"]];

  return (
    <div>
      <h3 className="sub-h">Carnes</h3>
      <p className="muted small">Cada carne genera taco, gringa, llenadora, volcán, costra y media costra con precios iniciales. Quitarla elimina todos sus productos.</p>
      <div className="inv-list">
        {data.carnes.map((c) => (
          <div key={c.id} className="inv-row">
            <span className="inv-name">{c.nombre}</span>
            <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => quitarCarne(c)}><Trash2 size={14} aria-hidden="true" /> Quitar</button>
          </div>
        ))}
      </div>
      <form className="inv-add" onSubmit={addCarne}>
        <label className="sr-only" htmlFor={id + "c"}>Nueva carne</label>
        <input id={id + "c"} className="inp" placeholder="Nueva carne (ej. Suadero)" value={carne} maxLength={40} onChange={(e) => setCarne(e.target.value)} />
        <button type="submit" className="btn btn-add"><Plus size={16} aria-hidden="true" /> Agregar carne</button>
      </form>

      <p className="muted small" style={{ marginTop: 18 }}>Usa el interruptor para mostrar u ocultar un producto del menú, o "Quitar" para borrar uno agregado. Abajo de cada categoría puedes agregar uno nuevo.</p>
      {cats.map(([cat, titulo]) => (
        <CatCategoria key={cat} titulo={titulo} cat={cat} base={base[cat]}
          extras={data.extras.filter((e) => e.cat === cat)} ocultos={ocultos}
          onToggle={db.toggleOculto} onAdd={db.addExtra} onDelExtra={quitarExtra} />
      ))}

      <h3 className="sub-h" style={{ color: CATS.bebida.color }}>Refrescos y bebidas</h3>
      <div className="inv-list">
        {data.bebidas.map((b) => (
          <div key={b.id} className="inv-row">
            <label className="switch"><input type="checkbox" checked={b.activo} aria-label={`${b.nombre} activa`} onChange={() => db.updateBebida(b.id, { activo: !b.activo })} /><span aria-hidden="true" /></label>
            <span className="inv-name">{b.nombre}</span>
            <span className="muted">{money(b.precio)}</span>
            <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => quitarBeb(b)}><Trash2 size={14} aria-hidden="true" /> Quitar</button>
          </div>
        ))}
      </div>
      <form className="prod-add" onSubmit={addBeb}>
        <label className="sr-only" htmlFor={id + "bn"}>Nuevo refresco o agua</label>
        <input id={id + "bn"} className="inp" placeholder="Nuevo refresco / agua" value={beb.nombre} maxLength={60} onChange={(e) => setBeb({ ...beb, nombre: e.target.value })} />
        <label className="sr-only" htmlFor={id + "bp"}>Precio</label>
        <input id={id + "bp"} className="inp inp-sm" inputMode="decimal" placeholder="Precio" value={beb.precio} onChange={(e) => setBeb({ ...beb, precio: e.target.value })} />
        <label className="sr-only" htmlFor={id + "bc"}>Existencia</label>
        <input id={id + "bc"} className="inp inp-sm" inputMode="numeric" placeholder="Existencia" value={beb.cantidad} onChange={(e) => setBeb({ ...beb, cantidad: e.target.value.replace(/\D/g, "") })} />
        <button type="submit" className="btn btn-add" aria-label="Agregar bebida"><Plus size={16} aria-hidden="true" /></button>
      </form>
    </div>
  );
}

function AdminMeseros({ data, db, user }) {
  const [nuevo, setNuevo] = useState({ nombre: "", pin: "", rol: "mesero" });
  const id = useId();

  const add = async (e) => {
    e.preventDefault();
    const n = nuevo.nombre.trim(); const p = nuevo.pin.trim();
    if (!n || !PIN_RE.test(p)) { toast("Escribe nombre y un PIN de 4 a 8 dígitos.", "error"); return; }
    if (pinDebil(p)) { toast(mensajePin({ error: "debil" }), "error"); return; }
    const pin = await pedirPin({ titulo: "Crear usuario", mensaje: "Escribe tu PIN de administrador para autorizar.", etiqueta: "Tu PIN de administrador" });
    if (pin === null) return;
    const r = await db.crearUsuario(pin, n, p, nuevo.rol);
    if (r.ok) { toast(`Usuario "${n}" creado`, "ok"); setNuevo({ nombre: "", pin: "", rol: "mesero" }); }
  };
  const quitar = async (u) => {
    if (u.id === user.id) { toast("No puedes eliminar tu propio usuario.", "error"); return; }
    if (!(await confirmDialog({ titulo: "Eliminar usuario", mensaje: `¿Eliminar a ${u.nombre}? Su sesión se cerrará en todos los dispositivos.`, confirmar: "Eliminar", peligro: true }))) return;
    const pin = await pedirPin({ titulo: "Eliminar usuario", mensaje: "Escribe tu PIN de administrador para autorizar.", etiqueta: "Tu PIN de administrador" });
    if (pin === null) return;
    const r = await db.eliminarUsuario(pin, u.id);
    if (r.ok) toast("Usuario eliminado", "ok");
  };
  const restablecer = async (u) => {
    const nuevoPin = await pedirPin({ titulo: `PIN temporal para ${u.nombre}`, mensaje: "Escribe un PIN temporal (4 a 8 dígitos). Al entrar deberá elegir uno propio.", etiqueta: "PIN temporal", confirmar: "Continuar" });
    if (nuevoPin === null) return;
    if (!PIN_RE.test(nuevoPin)) { toast("El PIN debe tener de 4 a 8 dígitos.", "error"); return; }
    const pin = await pedirPin({ titulo: "Restablecer PIN", mensaje: "Escribe tu PIN de administrador para autorizar.", etiqueta: "Tu PIN de administrador" });
    if (pin === null) return;
    const r = await db.restablecerPin(pin, u.id, nuevoPin);
    if (r.ok) toast(`PIN de ${u.nombre} restablecido`, "ok");
  };

  return (
    <div>
      <div className="inv-list">
        {(data.usuarios || []).map((u) => (
          <div key={u.id} className="inv-row">
            <span className="inv-name">{u.nombre}{u.id === user.id ? " (tú)" : ""}</span>
            <span className={"rol-tag " + u.rol}>{ROLES[u.rol] || u.rol}</span>
            <button type="button" className="btn btn-line btn-sm" onClick={() => restablecer(u)} aria-label={`Restablecer PIN de ${u.nombre}`}><KeyRound size={14} aria-hidden="true" /> PIN</button>
            {u.id !== user.id && <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => quitar(u)} aria-label={`Eliminar a ${u.nombre}`}><Trash2 size={14} aria-hidden="true" /> Quitar</button>}
          </div>
        ))}
      </div>
      <h3 className="sub-h">Agregar usuario</h3>
      <form className="prod-add" onSubmit={add}>
        <label className="sr-only" htmlFor={id + "n"}>Nombre</label>
        <input id={id + "n"} className="inp" placeholder="Nombre" value={nuevo.nombre} maxLength={40} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
        <label className="sr-only" htmlFor={id + "p"}>PIN del nuevo usuario</label>
        <input id={id + "p"} className="inp inp-sm" type="password" inputMode="numeric" autoComplete="new-password" placeholder="PIN" value={nuevo.pin}
          onChange={(e) => setNuevo({ ...nuevo, pin: e.target.value.replace(/\D/g, "").slice(0, 8) })} />
        <label className="sr-only" htmlFor={id + "r"}>Rol</label>
        <select id={id + "r"} className="inp inp-sm" value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value })}>
          <option value="mesero">Mesero</option>
          <option value="cocinero">Cocinero</option>
          <option value="admin">Administrador</option>
        </select>
        <button type="submit" className="btn btn-add" aria-label="Crear usuario"><Plus size={16} aria-hidden="true" /></button>
      </form>
      <p className="muted small" style={{ marginTop: 10 }}>
        El <b>Mesero</b> toma órdenes y ve cocina. El <b>Cocinero</b> ve mesas, maneja cocina y hace el corte (con PIN de administrador). El <b>Administrador</b> controla precios, productos, inventario, gastos y usuarios.
      </p>
    </div>
  );
}
