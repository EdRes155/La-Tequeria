// Panel de dueños (paso 6b; docs/multinegocio/MODELO.md §3.3). Rutas:
//   /duenos                    entrada con correo y panel de las cuentas de la persona
//   /invitacion?clave=…        aceptar una invitación (entra con el correo invitado y la acepta)
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { Loader2, LogOut, RefreshCw, Copy, Smartphone, Trash2, UserPlus, Store, KeyRound, Users } from "lucide-react";
import { CSS } from "./estilos.js";
import { Toaster, toast, ConfirmHost, confirmDialog } from "./ui.jsx";
import { useCaptcha } from "./captcha.js";
import { supaDueno, auth, dueno, ErrorDueno, enlaceInvitacion, codigoLegible } from "./duenos.js";
import { ZONAS_MX, ZONA_DEFAULT, PIN_NUEVO_RE, pinDebil } from "./dominio.js";

const MIN_CLAVE = 10;   // contraseña de las personas (Supabase Auth exige el mismo mínimo)
const ROL = { propietario: "Propietario", encargado: "Encargado" };
const ESTADO_CUENTA = { activa: "Activa", pendiente: "Pendiente de activación", suspendida: "Suspendida" };
const mensaje = (e) => (e instanceof ErrorDueno ? e.message : "No se pudo completar. Inténtalo de nuevo.");
const ruta = () => window.location.pathname.replace(/\/+$/, "");
const claveInvitacion = () => new URLSearchParams(window.location.search).get("clave");
const fechaCorta = (t) => (t ? new Date(t).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

export default function PanelDuenos() {
  const [sesion, setSesion] = useState(undefined);   // undefined: cargando
  const [recuperando, setRecuperando] = useState(false);
  const invitacion = ruta() === "/invitacion" ? claveInvitacion() : null;
  useEffect(() => {
    if (!supaDueno) return;
    auth.sesion().then(setSesion);
    const sub = auth.alCambiar((ev, s) => { setSesion(s); if (ev === "PASSWORD_RECOVERY") setRecuperando(true); });
    return () => sub.unsubscribe();
  }, []);
  const hosts = (<><Toaster /><ConfirmHost /></>);
  if (!supaDueno) {
    return (<Marco><h1 className="login-titulo">Panel de dueños</h1>
      <p className="login-sub">Este panel necesita el servidor: no funciona en el modo local.</p>
      <a className="btn btn-ghost btn-block" href="/">Volver a la app</a>{hosts}</Marco>);
  }
  if (sesion === undefined) return <Marco><p className="login-sub" role="status"><Loader2 size={18} className="girando" aria-hidden="true" /> Cargando…</p></Marco>;
  if (recuperando && sesion) return (<Marco><NuevaClave onListo={() => setRecuperando(false)} />{hosts}</Marco>);
  if (!sesion) return (<Marco><EntradaDueno invitacion={!!invitacion} />{hosts}</Marco>);
  return (<><Panel correo={sesion.user?.email} invitacion={invitacion} />{hosts}</>);
}

function Marco({ children }) {
  return (
    <div className="login">
      <style>{CSS}</style>
      <aside className="login-hero">
        <div className="hero-top"><div><div className="hero-negocio">La Tequería</div><div className="hero-sub">Panel de dueños</div></div></div>
        <p className="hero-lema">Tus taquerías, sucursales, equipos y personas de confianza en un solo lugar.</p>
      </aside>
      <main className="login-panel"><div className="login-card">{children}</div></main>
    </div>
  );
}

/* ---------------- entrada con correo ---------------- */
function EntradaDueno({ invitacion }) {
  const id = useId();
  const [modo, setModo] = useState("entrar");   // entrar | crear | recuperar
  const [correo, setCorreo] = useState("");
  const [clave, setClave] = useState("");
  const [clave2, setClave2] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const caja = useRef(null);
  const captcha = useCaptcha(caja);
  const cambiar = (m) => { setModo(m); setErr(""); setOk(""); };
  const enviar = async (e) => {
    e.preventDefault();
    if (busy) return;
    setErr(""); setOk("");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo.trim())) { setErr("Escribe un correo válido."); return; }
    if (modo !== "recuperar" && clave.length < (modo === "crear" ? MIN_CLAVE : 1)) { setErr(`La contraseña debe tener al menos ${MIN_CLAVE} caracteres.`); return; }
    if (modo === "crear" && clave !== clave2) { setErr("Las contraseñas no coinciden."); return; }
    setBusy(true);
    try {
      let token;
      try { token = await captcha.obtener(); } catch { throw new ErrorDueno("CAPTCHA", "Completa la verificación de seguridad."); }
      if (modo === "entrar") await auth.entrar(correo, clave, token);
      else if (modo === "crear") {
        const r = await auth.registrarse(correo, clave, token);
        if (r.confirmar) setOk(`Te enviamos un correo a ${correo.trim()}. Abre el enlace para confirmarlo y después entra aquí.`);
      } else {
        await auth.recuperar(correo, token);
        setOk("Si el correo tiene cuenta, te llegará un enlace para elegir una contraseña nueva.");
      }
    } catch (ex) { setErr(mensaje(ex)); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={enviar}>
      <h1 className="login-titulo">{modo === "crear" ? "Crea tu acceso" : modo === "recuperar" ? "Recuperar contraseña" : "Panel de dueños"}</h1>
      <p className="login-sub">{invitacion ? "Te invitaron a una cuenta. Entra (o crea tu acceso) con el correo al que llegó la invitación."
        : modo === "crear" ? "Con tu correo administras tus taquerías. Te pediremos confirmarlo." : "Entra con tu correo para administrar tus taquerías."}</p>
      <div className="campo"><label htmlFor={id + "c"}>Correo</label>
        <input id={id + "c"} className="inp" type="email" autoComplete="email" value={correo} onChange={(e) => { setErr(""); setCorreo(e.target.value); }} /></div>
      {modo !== "recuperar" && <div className="campo"><label htmlFor={id + "p"}>Contraseña{modo === "crear" ? ` (${MIN_CLAVE} caracteres o más)` : ""}</label>
        <input id={id + "p"} className="inp" type="password" autoComplete={modo === "crear" ? "new-password" : "current-password"} value={clave}
          onChange={(e) => { setErr(""); setClave(e.target.value); }} /></div>}
      {modo === "crear" && <div className="campo"><label htmlFor={id + "q"}>Repite la contraseña</label>
        <input id={id + "q"} className="inp" type="password" autoComplete="new-password" value={clave2} onChange={(e) => { setErr(""); setClave2(e.target.value); }} /></div>}
      {captcha.activo && <div ref={caja} className="captcha" />}
      {captcha.estado === "esperando" && <p className="login-sub" role="status">Completa la verificación de seguridad para continuar.</p>}
      {err && <div className="login-err" role="alert">{err}</div>}
      {ok && <p className="login-sub" role="status">{ok}</p>}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
        {busy ? <Loader2 size={16} className="girando" aria-hidden="true" /> : null} {modo === "crear" ? "Crear acceso" : modo === "recuperar" ? "Enviar enlace" : "Entrar"}
      </button>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        {modo !== "entrar" && <button type="button" className="btn btn-ghost btn-sm" onClick={() => cambiar("entrar")}>Ya tengo acceso</button>}
        {modo !== "crear" && <button type="button" className="btn btn-ghost btn-sm" onClick={() => cambiar("crear")}>Crear acceso</button>}
        {modo !== "recuperar" && <button type="button" className="btn btn-ghost btn-sm" onClick={() => cambiar("recuperar")}>Olvidé mi contraseña</button>}
      </div>
    </form>
  );
}

function NuevaClave({ onListo }) {
  const id = useId();
  const [clave, setClave] = useState("");
  const [err, setErr] = useState("");
  const enviar = async (e) => {
    e.preventDefault();
    if (clave.length < MIN_CLAVE) { setErr(`Usa al menos ${MIN_CLAVE} caracteres.`); return; }
    try { await auth.nuevaClave(clave); toast("Contraseña actualizada", "ok"); onListo(); } catch (ex) { setErr(mensaje(ex)); }
  };
  return (
    <form onSubmit={enviar}>
      <h1 className="login-titulo">Contraseña nueva</h1>
      <div className="campo"><label htmlFor={id}>Contraseña nueva ({MIN_CLAVE} caracteres o más)</label>
        <input id={id} className="inp" type="password" autoComplete="new-password" value={clave} onChange={(e) => { setErr(""); setClave(e.target.value); }} /></div>
      {err && <div className="login-err" role="alert">{err}</div>}
      <button type="submit" className="btn btn-primary btn-block">Guardar</button>
    </form>
  );
}

/* ---------------- panel ---------------- */
function Panel({ correo, invitacion }) {
  const [datos, setDatos] = useState(null);
  const [err, setErr] = useState("");
  const [elegida, setElegida] = useState(null);
  const [aceptando, setAceptando] = useState(!!invitacion);
  const cargar = useCallback(async () => {
    try { setErr(""); const r = await dueno.misCuentas(); setDatos(r); setElegida((x) => x && r.cuentas.some((c) => c.id === x) ? x : r.cuentas[0]?.id || null); }
    catch (e) { setErr(mensaje(e)); if (e.codigo === "IDENTIDAD") await auth.salir(); }
  }, []);
  useEffect(() => {
    (async () => {
      if (invitacion) {
        try {
          const r = await dueno.aceptarInvitacion(invitacion);
          toast(`Ya eres ${ROL[r.cuenta?.rol]?.toLowerCase() || "miembro"} de la cuenta`, "ok");
          if (r.cuenta?.id) setElegida(r.cuenta.id);
        } catch (e) { toast(mensaje(e), "error"); }
        window.history.replaceState(null, "", "/duenos");
        setAceptando(false);
      }
      await cargar();
    })();
  }, [invitacion, cargar]);
  const cuenta = datos?.cuentas.find((c) => c.id === elegida);
  return (
    <div className="app">
      <style>{CSS}</style>
      <header className="topbar">
        <div className="topbar-brand"><Store size={20} aria-hidden="true" /> Panel de dueños</div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <span className="user-name">{correo}</span>
          <a className="nav-btn ghost" href="/" title="App de comandas">Comandas</a>
          <button type="button" className="nav-btn ghost" onClick={() => auth.salir()} aria-label="Salir del panel"><LogOut size={18} aria-hidden="true" /></button>
        </div>
      </header>
      <main className="main"><div className="screen">
        {(aceptando || !datos) && !err && <p className="muted" role="status"><Loader2 size={16} className="girando" aria-hidden="true" /> Cargando…</p>}
        {err && <div className="aviso-barra error" role="alert"><span>{err}</span><button type="button" className="btn btn-sm btn-line" onClick={cargar}><RefreshCw size={14} aria-hidden="true" /> Reintentar</button></div>}
        {datos && !aceptando && (datos.cuentas.length === 0
          ? <CrearCuenta onListo={(id) => { setElegida(id); cargar(); }} />
          : (<>
              {datos.cuentas.length > 1 && (
                <div className="campo" style={{ maxWidth: 360 }}><label htmlFor="cuenta-sel">Cuenta</label>
                  <select id="cuenta-sel" className="inp" value={elegida || ""} onChange={(e) => setElegida(e.target.value)}>
                    {datos.cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select></div>
              )}
              {cuenta && <Cuenta key={cuenta.id} cuenta={cuenta} recargar={cargar} />}
            </>))}
      </div></main>
    </div>
  );
}

function CrearCuenta({ onListo }) {
  const id = useId();
  const [f, setF] = useState({ nombre: "", sucursal: "", zona: ZONA_DEFAULT, admin: "", pin: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const campo = (k) => (e) => { setErr(""); setF({ ...f, [k]: k === "pin" ? e.target.value.replace(/\D/g, "").slice(0, 8) : e.target.value }); };
  const enviar = async (e) => {
    e.preventDefault();
    if (!f.nombre.trim() || !f.admin.trim()) { setErr("Escribe el nombre del negocio y del administrador."); return; }
    if (!PIN_NUEVO_RE.test(f.pin)) { setErr("El PIN del administrador debe tener de 6 a 8 dígitos."); return; }
    if (pinDebil(f.pin)) { setErr("Ese PIN es muy fácil de adivinar (por ejemplo 123456 o 111111). Elige otro."); return; }
    setBusy(true);
    try { const r = await dueno.crearCuenta(f.nombre.trim(), f.sucursal.trim() || null, f.zona, f.admin.trim(), f.pin); toast("Cuenta creada", "ok"); onListo(r.cuenta.id); }
    catch (ex) { setErr(mensaje(ex)); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={enviar} style={{ maxWidth: 520 }}>
      <h2>Registra tu taquería</h2>
      <p className="muted">Se crea la cuenta con su primera sucursal y el administrador que entrará con PIN en los equipos.</p>
      <div className="campo"><label htmlFor={id + "n"}>Nombre del negocio</label><input id={id + "n"} className="inp" maxLength={60} value={f.nombre} onChange={campo("nombre")} /></div>
      <div className="campo"><label htmlFor={id + "s"}>Nombre de la primera sucursal (si lo dejas vacío, el del negocio)</label><input id={id + "s"} className="inp" maxLength={60} placeholder="Matriz, Centro…" value={f.sucursal} onChange={campo("sucursal")} /></div>
      <div className="campo"><label htmlFor={id + "z"}>Zona horaria</label>
        <select id={id + "z"} className="inp" value={f.zona} onChange={campo("zona")}>{ZONAS_MX.map(([z, n]) => <option key={z} value={z}>{n}</option>)}</select></div>
      <div className="campo"><label htmlFor={id + "a"}>Nombre del administrador</label><input id={id + "a"} className="inp" maxLength={40} value={f.admin} onChange={campo("admin")} /></div>
      <div className="campo"><label htmlFor={id + "p"}>PIN del administrador (6 a 8 dígitos)</label>
        <input id={id + "p"} className="inp" type="password" inputMode="numeric" autoComplete="new-password" value={f.pin} onChange={campo("pin")} /></div>
      {err && <div className="login-err" role="alert">{err}</div>}
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? <Loader2 size={16} className="girando" aria-hidden="true" /> : null} Crear cuenta</button>
    </form>
  );
}

function Cuenta({ cuenta, recargar }) {
  const propietario = cuenta.rol === "propietario";
  const activa = cuenta.estado === "activa";
  return (
    <div>
      <div className="screen-head"><div>
        <h2>{cuenta.nombre}</h2>
        <p className="muted">{ROL[cuenta.rol]} · {ESTADO_CUENTA[cuenta.estado] || cuenta.estado}</p>
      </div></div>
      {!activa && <div className="aviso-barra" role="status"><span>La cuenta no está activa: no se pueden vincular equipos ni operar.</span></div>}
      <h3 className="sub-h">Sucursales</h3>
      <div className="inv-list">
        {(cuenta.sucursales || []).map((s) => <Sucursal key={s.id} cuenta={cuenta} sucursal={s} activa={activa} propietario={propietario} />)}
      </div>
      {propietario && activa && <NuevaSucursal cuenta={cuenta} onListo={recargar} />}
      {propietario && <Miembros cuenta={cuenta} recargar={recargar} />}
    </div>
  );
}

function Sucursal({ cuenta, sucursal, activa, propietario }) {
  const [equipos, setEquipos] = useState(null);
  const [codigo, setCodigo] = useState(null);
  const [monitor, setMonitor] = useState(false);
  const [rescate, setRescate] = useState(false);
  const [err, setErr] = useState("");
  const id = useId();
  const cargar = useCallback(async () => {
    try { setEquipos((await dueno.listarDispositivos(cuenta.id, sucursal.id)).dispositivos); } catch (e) { setErr(mensaje(e)); }
  }, [cuenta.id, sucursal.id]);
  useEffect(() => { cargar(); }, [cargar]);
  const generar = async () => {
    setErr("");
    try { setCodigo(await dueno.generarCodigo(cuenta.id, sucursal.id, monitor)); } catch (e) { setErr(mensaje(e)); }
  };
  const revocar = async (d) => {
    if (!(await confirmDialog({ titulo: "Dar de baja el equipo", mensaje: `«${d.nombre}» dejará de entrar a ${sucursal.nombre} de inmediato. Para volver a usarlo habrá que vincularlo con un código nuevo.`, confirmar: "Dar de baja", peligro: true }))) return;
    try { await dueno.revocarDispositivo(cuenta.id, d.id); toast(`«${d.nombre}» dado de baja`, "ok"); cargar(); } catch (e) { toast(mensaje(e), "error"); }
  };
  const vigentes = (equipos || []).filter((d) => !d.revocadoEn);
  const bajas = (equipos || []).filter((d) => d.revocadoEn);
  return (
    <section className="inv-row" style={{ flexDirection: "column", alignItems: "stretch" }} aria-labelledby={id + "h"}>
      <h4 id={id + "h"} style={{ margin: "6px 0" }}>{sucursal.nombre}{sucursal.activa === false ? " (inactiva)" : ""}</h4>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={generar} disabled={!activa}><KeyRound size={14} aria-hidden="true" /> Vincular un equipo</button>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={monitor} onChange={(e) => setMonitor(e.target.checked)} /> Monitor de cocina dedicado</label>
        {propietario && <button type="button" className="btn btn-line btn-sm" onClick={() => setRescate((x) => !x)}>Administrador de rescate</button>}
      </div>
      {codigo && <CodigoVinculacion codigo={codigo} sucursal={sucursal.nombre} onCerrar={() => { setCodigo(null); cargar(); }} />}
      {rescate && <Rescate cuenta={cuenta} sucursal={sucursal} onListo={() => setRescate(false)} />}
      {err && <div className="login-err" role="alert">{err}</div>}
      <h5 className="sub-h" style={{ margin: "10px 0 4px" }}>Equipos</h5>
      {equipos === null ? <p className="muted">Cargando…</p> : vigentes.length === 0 ? <p className="muted">Ningún equipo vinculado.</p> : (
        <ul className="inv-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {vigentes.map((d) => (
            <li key={d.id} className="inv-row">
              <Smartphone size={16} aria-hidden="true" />
              <span className="inv-name">{d.nombre}{d.monitorCocina ? " · monitor de cocina" : ""}</span>
              <span className="muted small">último uso {fechaCorta(d.ultimoUso)}{d.aprobadoPor ? ` · vinculó ${d.aprobadoPor}` : ""}</span>
              <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => revocar(d)} aria-label={`Dar de baja ${d.nombre}`}><Trash2 size={14} aria-hidden="true" /> Dar de baja</button>
            </li>
          ))}
        </ul>
      )}
      {bajas.length > 0 && <p className="muted small">Dados de baja: {bajas.map((d) => d.nombre).join(", ")}</p>}
    </section>
  );
}

function CodigoVinculacion({ codigo, sucursal, onCerrar }) {
  const [ahora, setAhora] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 1000); return () => clearInterval(t); }, []);
  const resta = Math.max(0, Math.floor((new Date(codigo.vence).getTime() - ahora) / 1000));
  return (
    <div className="aviso-barra" role="status" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
      <span>Escribe este código en el equipo que quieres vincular a {sucursal}{codigo.monitorCocina ? " como monitor de cocina" : ""}:</span>
      <strong className="codigo-vinculacion" style={{ fontSize: 28, letterSpacing: 3 }} aria-label={`Código ${codigoLegible(codigo.codigo).split("").join(" ")}`}>{codigoLegible(codigo.codigo)}</strong>
      <span className="muted small">{resta > 0 ? `Vence en ${Math.floor(resta / 60)}:${String(resta % 60).padStart(2, "0")} · sirve una sola vez` : "Venció: genera otro."}</span>
      <button type="button" className="btn btn-line btn-sm" onClick={onCerrar}>Listo</button>
    </div>
  );
}

function Rescate({ cuenta, sucursal, onListo }) {
  const id = useId();
  const [nombre, setNombre] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const enviar = async (e) => {
    e.preventDefault();
    if (!nombre.trim()) { setErr("Escribe un nombre."); return; }
    if (!PIN_NUEVO_RE.test(pin) || pinDebil(pin)) { setErr("Usa un PIN de 6 a 8 dígitos que no sea fácil de adivinar."); return; }
    try { await dueno.crearAdministrador(cuenta.id, sucursal.id, nombre.trim(), pin); toast(`Administrador «${nombre.trim()}» creado en ${sucursal.nombre}`, "ok"); onListo(); }
    catch (ex) { setErr(mensaje(ex)); }
  };
  return (
    <form className="prod-add" onSubmit={enviar} aria-label="Administrador de rescate">
      <p className="muted small" style={{ width: "100%", margin: 0 }}>Si nadie puede entrar como administrador en {sucursal.nombre}, crea uno nuevo. Al entrar deberá elegir su propio PIN.</p>
      <label className="sr-only" htmlFor={id + "n"}>Nombre del administrador de rescate</label>
      <input id={id + "n"} className="inp" placeholder="Nombre" maxLength={40} value={nombre} onChange={(e) => { setErr(""); setNombre(e.target.value); }} />
      <label className="sr-only" htmlFor={id + "p"}>PIN del administrador de rescate</label>
      <input id={id + "p"} className="inp inp-sm" type="password" inputMode="numeric" autoComplete="new-password" placeholder="PIN" value={pin}
        onChange={(e) => { setErr(""); setPin(e.target.value.replace(/\D/g, "").slice(0, 8)); }} />
      <button type="submit" className="btn btn-primary btn-sm">Crear administrador</button>
      {err && <div className="login-err" role="alert" style={{ width: "100%" }}>{err}</div>}
    </form>
  );
}

function NuevaSucursal({ cuenta, onListo }) {
  const id = useId();
  const [abierta, setAbierta] = useState(false);
  const [f, setF] = useState({ nombre: "", zona: ZONA_DEFAULT, admin: "", pin: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const campo = (k) => (e) => { setErr(""); setF({ ...f, [k]: k === "pin" ? e.target.value.replace(/\D/g, "").slice(0, 8) : e.target.value }); };
  const enviar = async (e) => {
    e.preventDefault();
    if (!f.nombre.trim() || !f.admin.trim()) { setErr("Escribe el nombre de la sucursal y del administrador."); return; }
    if (!PIN_NUEVO_RE.test(f.pin) || pinDebil(f.pin)) { setErr("Usa un PIN de 6 a 8 dígitos que no sea fácil de adivinar."); return; }
    setBusy(true);
    try { await dueno.crearSucursal(cuenta.id, f.nombre.trim(), f.zona, f.admin.trim(), f.pin); toast(`Sucursal «${f.nombre.trim()}» creada`, "ok"); setAbierta(false); setF({ nombre: "", zona: ZONA_DEFAULT, admin: "", pin: "" }); onListo(); }
    catch (ex) { setErr(mensaje(ex)); } finally { setBusy(false); }
  };
  if (!abierta) return <button type="button" className="btn btn-line" style={{ marginTop: 12 }} onClick={() => setAbierta(true)}><Store size={16} aria-hidden="true" /> Nueva sucursal</button>;
  return (
    <form onSubmit={enviar} style={{ maxWidth: 520, marginTop: 12 }} aria-label="Nueva sucursal">
      <h3 className="sub-h">Nueva sucursal</h3>
      <div className="campo"><label htmlFor={id + "n"}>Nombre de la sucursal</label><input id={id + "n"} className="inp" maxLength={60} value={f.nombre} onChange={campo("nombre")} /></div>
      <div className="campo"><label htmlFor={id + "z"}>Zona horaria</label>
        <select id={id + "z"} className="inp" value={f.zona} onChange={campo("zona")}>{ZONAS_MX.map(([z, n]) => <option key={z} value={z}>{n}</option>)}</select></div>
      <div className="campo"><label htmlFor={id + "a"}>Nombre de su administrador</label><input id={id + "a"} className="inp" maxLength={40} value={f.admin} onChange={campo("admin")} /></div>
      <div className="campo"><label htmlFor={id + "p"}>PIN de su administrador (6 a 8 dígitos)</label>
        <input id={id + "p"} className="inp" type="password" inputMode="numeric" autoComplete="new-password" value={f.pin} onChange={campo("pin")} /></div>
      {err && <div className="login-err" role="alert">{err}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={busy}>Crear sucursal</button>
        <button type="button" className="btn btn-ghost" onClick={() => setAbierta(false)}>Cancelar</button>
      </div>
    </form>
  );
}

function Miembros({ cuenta, recargar }) {
  const id = useId();
  const [lista, setLista] = useState(null);
  const [correo, setCorreo] = useState("");
  const [rol, setRol] = useState("encargado");
  const [enlace, setEnlace] = useState(null);
  const [err, setErr] = useState("");
  const cargar = useCallback(async () => {
    try { setLista(await dueno.listarMiembros(cuenta.id)); } catch (e) { setErr(mensaje(e)); }
  }, [cuenta.id]);
  useEffect(() => { cargar(); }, [cargar]);
  const invitar = async (e) => {
    e.preventDefault();
    setErr(""); setEnlace(null);
    try { const r = await dueno.invitarMiembro(cuenta.id, correo, rol); setEnlace({ url: enlaceInvitacion(r.token), correo: r.invitacion.correo }); setCorreo(""); cargar(); }
    catch (ex) { setErr(mensaje(ex)); }
  };
  const copiar = async () => {
    try { await navigator.clipboard.writeText(enlace.url); toast("Enlace copiado", "ok"); } catch { toast("No se pudo copiar: selecciónalo y cópialo a mano.", "error"); }
  };
  const quitar = async (m) => {
    const yo = m.yo;
    if (!(await confirmDialog({ titulo: yo ? "Salir de la cuenta" : "Quitar miembro",
      mensaje: yo ? `Dejarás de tener acceso a ${cuenta.nombre}.` : `${m.correo} dejará de tener acceso a ${cuenta.nombre}. Sus invitaciones y códigos pendientes dejan de servir.`,
      confirmar: yo ? "Salir" : "Quitar", peligro: true }))) return;
    try { await dueno.quitarMiembro(cuenta.id, m.id); toast(yo ? "Saliste de la cuenta" : "Miembro quitado", "ok"); if (yo) recargar(); else cargar(); }
    catch (ex) { toast(mensaje(ex), "error"); }
  };
  const cancelar = async (v) => {
    try { await dueno.cancelarInvitacion(cuenta.id, v.id); toast("Invitación cancelada", "ok"); cargar(); } catch (ex) { toast(mensaje(ex), "error"); }
  };
  return (
    <section style={{ marginTop: 24 }} aria-labelledby={id + "h"}>
      <h3 className="sub-h" id={id + "h"}><Users size={16} aria-hidden="true" /> Personas con acceso</h3>
      {lista === null ? <p className="muted">Cargando…</p> : (
        <ul className="inv-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {lista.miembros.map((m) => (
            <li key={m.id} className="inv-row">
              <span className="inv-name">{m.correo}{m.yo ? " (tú)" : ""}</span>
              <span className="rol-tag">{ROL[m.rol]}</span>
              <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => quitar(m)} aria-label={m.yo ? "Salir de la cuenta" : `Quitar a ${m.correo}`}>{m.yo ? "Salir" : "Quitar"}</button>
            </li>
          ))}
          {lista.invitaciones.map((v) => (
            <li key={v.id} className="inv-row">
              <span className="inv-name">{v.correo}</span>
              <span className="muted small">invitado como {ROL[v.rol]?.toLowerCase()} · vence {fechaCorta(v.vence)}</span>
              <button type="button" className="btn btn-line btn-sm" onClick={() => cancelar(v)} aria-label={`Cancelar la invitación de ${v.correo}`}>Cancelar</button>
            </li>
          ))}
        </ul>
      )}
      <form className="prod-add" onSubmit={invitar} aria-label="Invitar a una persona">
        <label className="sr-only" htmlFor={id + "c"}>Correo de la persona</label>
        <input id={id + "c"} className="inp" type="email" placeholder="correo@ejemplo.com" value={correo} onChange={(e) => { setErr(""); setCorreo(e.target.value); }} />
        <label className="sr-only" htmlFor={id + "r"}>Rol</label>
        <select id={id + "r"} className="inp inp-sm" value={rol} onChange={(e) => setRol(e.target.value)}>
          <option value="encargado">Encargado</option><option value="propietario">Propietario</option>
        </select>
        <button type="submit" className="btn btn-primary"><UserPlus size={16} aria-hidden="true" /> Invitar</button>
      </form>
      {err && <div className="login-err" role="alert">{err}</div>}
      {enlace && (
        <div className="aviso-barra" role="status" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
          <span>Envíale este enlace a {enlace.correo} (por WhatsApp o correo). Sirve una vez, vence en 7 días y solo funciona entrando con ese correo:</span>
          <code style={{ wordBreak: "break-all" }} aria-label="Enlace de invitación">{enlace.url}</code>
          <button type="button" className="btn btn-line btn-sm" onClick={copiar}><Copy size={14} aria-hidden="true" /> Copiar enlace</button>
        </div>
      )}
    </section>
  );
}
