/* Estilos de la app. Paleta "nopal": verde profundo, maíz, achiote, mole y talavera.
   Todo texto tiene contraste ≥ 4.5:1 (WCAG 1.4.3). Tipografía: Figtree (interfaz) y
   Bricolage Grotesque (títulos), incluidas en la app (sin servicios externos). */
export const CSS = `
:root{
  --marca:#0B3B2C; --agave:#11634A; --agave2:#0E523D; --agave-suave:#E7F2EC; --oro:#F2C14E;
  --lima:#3A731C; --maiz:#A15C07; --barro:#C2410C;
  --especial:#8B1E3F; --agua:#1D4E89; --empaque:#55702A;
  --crema:#F6F1E8; --papel:#FFFFFF; --tinta:#1F1A17; --tinta2:#5C554D;
  --linea:#E6DDD0; --ok:#167A4A; --ok-suave:#EAF5EE; --alerta:#B42318; --foco:#2563EB;
  --barro-suave:#FCEEE6; --maiz-suave:#FDF3E1;
  --fuente:"Figtree Variable",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --fuente-titulo:"Bricolage Grotesque Variable","Figtree Variable",system-ui,sans-serif;
  --sombra:0 1px 2px rgba(31,26,23,.06),0 6px 18px rgba(31,26,23,.06);
  --sombra-alta:0 18px 50px rgba(11,59,44,.18);
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
html,body,#root{height:100%;margin:0;overflow:hidden;overscroll-behavior:none;}
.app{height:100vh;height:100dvh;display:flex;flex-direction:column;background:var(--crema);
  font-family:var(--fuente);color:var(--tinta);}
.loading{display:flex;flex-direction:column;gap:12px;height:100vh;height:100dvh;align-items:center;justify-content:center;color:var(--tinta2);font-family:var(--fuente);padding:20px;text-align:center;}
button,input,select,textarea{font-family:inherit;}
button{cursor:pointer;}
h1,h2,h3,.brand-title,.mesa-num,.corte-total,.type-banner,.ticket-origen,.kt-origen{font-family:var(--fuente-titulo);letter-spacing:-.01em;}
.item-precio,.oitem-precio,.ticket-total b,.hist-total,.gasto-monto,.corte-total,.cd-row b,.cobro-monto,.tp-p{font-variant-numeric:tabular-nums;}
.muted{color:var(--tinta2);} .small{font-size:12px;}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;}
:focus-visible{outline:3px solid var(--foco);outline-offset:2px;}
.topbar :focus-visible{outline-color:#fff;}

/* LOGIN: panel de marca + tarjeta con usuarios y teclado numérico */
.login{min-height:100vh;min-height:100dvh;height:100%;overflow:auto;display:grid;grid-template-columns:minmax(320px,44%) 1fr;background:var(--crema);font-family:var(--fuente);color:var(--tinta);}
.login-hero{position:relative;overflow:hidden;background:radial-gradient(120% 90% at 10% 0%,#14614A 0%,var(--marca) 55%,#072A1F 100%);color:#E8F1EC;padding:36px 40px;display:flex;flex-direction:column;justify-content:space-between;gap:24px;}
.picado{position:absolute;left:0;right:0;top:0;width:100%;height:56px;opacity:.95;}
.hero-top{display:flex;align-items:center;gap:12px;margin-top:40px;}
.hero-logo{width:56px;height:56px;flex:none;filter:drop-shadow(0 6px 12px rgba(0,0,0,.25));}
.hero-negocio{font-family:var(--fuente-titulo);font-size:28px;font-weight:700;color:#fff;line-height:1.05;}
.hero-sub{font-size:14px;color:#A9C9B8;}
.hero-hora{font-family:var(--fuente-titulo);font-size:clamp(56px,8vw,96px);font-weight:700;color:#fff;line-height:1;margin:0;font-variant-numeric:tabular-nums;}
.hero-fecha{font-size:18px;margin:8px 0 0;color:#E8F1EC;}
.hero-fecha::first-letter{text-transform:uppercase;}
.hero-lema{font-size:15px;color:#A9C9B8;margin:18px 0 0;max-width:30ch;line-height:1.5;}
.hero-estado{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:600;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);padding:6px 12px;border-radius:999px;align-self:flex-start;}
.hero-estado i{width:9px;height:9px;border-radius:50%;background:var(--oro);display:inline-block;}
.hero-estado.ok i{background:#5BD08F;} .hero-estado.mal i{background:#FF8A7A;}
.login-panel{display:flex;align-items:center;justify-content:center;padding:32px 20px;}
.login-card{background:var(--papel);border-radius:24px;padding:32px;width:min(460px,100%);box-shadow:var(--sombra-alta);border:1px solid var(--linea);}
.login-card form{display:flex;flex-direction:column;}
.login-titulo{margin:0;font-size:28px;line-height:1.1;}
.login-sub{margin:6px 0 20px;color:var(--tinta2);font-size:15px;}
.user-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:12px;}
.user-tile{display:flex;flex-direction:column;align-items:center;gap:10px;padding:16px 10px;border:1.5px solid var(--linea);background:var(--papel);border-radius:18px;color:var(--tinta);font-weight:700;font-size:15px;min-height:120px;transition:transform .08s,border-color .15s,box-shadow .15s;}
.user-tile:hover{border-color:var(--agave);box-shadow:var(--sombra);}
.user-tile:active{transform:scale(.97);}
.user-tile-nombre{text-align:center;line-height:1.2;overflow-wrap:anywhere;}
.avatar{width:52px;height:52px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:18px;flex:none;letter-spacing:.02em;box-shadow:inset 0 -3px 0 rgba(0,0,0,.15);}
.avatar.grande{width:60px;height:60px;font-size:21px;}
.volver{align-self:flex-start;display:inline-flex;align-items:center;gap:6px;background:none;border:none;color:var(--tinta2);font-weight:700;font-size:14px;padding:6px 2px;min-height:44px;margin:-8px 0 8px;}
.quien{display:flex;align-items:center;gap:14px;margin-bottom:16px;}
.quien-nombre{font-family:var(--fuente-titulo);font-size:24px;font-weight:700;line-height:1.1;}
.quien .login-sub{margin:2px 0 0;}
.pin-input{width:100%;box-sizing:border-box;margin:0 0 8px;padding:12px 14px;font-size:28px;letter-spacing:.45em;text-align:center;border:1.5px solid var(--linea);border-radius:14px;background:var(--crema);color:var(--tinta);font-variant-numeric:tabular-nums;}
.pin-input:focus{border-color:var(--agave);background:#fff;}
.teclado{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px;}
.tecla{min-height:60px;border-radius:16px;border:1.5px solid var(--linea);background:var(--papel);font-size:24px;font-weight:700;color:var(--tinta);display:flex;align-items:center;justify-content:center;gap:6px;font-variant-numeric:tabular-nums;transition:transform .06s,background .1s;}
.tecla:active{transform:scale(.96);background:var(--crema);}
.tecla.secundaria{color:var(--tinta2);}
.tecla.entrar{background:var(--agave);border-color:var(--agave);color:#fff;font-size:17px;}
.tecla.entrar:disabled{opacity:.45;}
.login-err{color:var(--alerta);margin:4px 0 6px;font-weight:600;}
.agitar{animation:agitar .35s ease;}
@keyframes agitar{20%,60%{transform:translateX(-6px);}40%,80%{transform:translateX(6px);}}
@media (prefers-reduced-motion:reduce){.agitar{animation:none;}}
.login-hint{margin-top:16px;font-size:13px;color:var(--tinta2);}
.login-setup{text-align:left;background:var(--crema);border:1px solid var(--linea);border-radius:14px;padding:12px 14px;font-size:14px;line-height:1.5;}
.login-setup code{display:block;margin-top:6px;background:#fff;border:1px solid var(--linea);border-radius:8px;padding:8px;font-size:12px;overflow-wrap:anywhere;}
.campo{display:flex;flex-direction:column;gap:4px;text-align:left;margin-bottom:10px;}
.campo label,.campo .etq{font-size:13px;font-weight:700;color:var(--tinta2);}
.req{color:var(--alerta);}
@media (max-width:899.98px){
  .login{grid-template-columns:1fr;grid-template-rows:auto 1fr;}
  .login-hero{padding:20px 20px 18px;flex-direction:row;align-items:flex-end;flex-wrap:wrap;gap:10px 16px;}
  .picado{height:36px;}
  .hero-top{margin-top:26px;flex:1;}
  .hero-logo{width:44px;height:44px;}
  .hero-negocio{font-size:22px;}
  .hero-centro{display:flex;align-items:baseline;gap:10px;}
  .hero-hora{font-size:30px;}
  .hero-fecha{margin:0;font-size:14px;}
  .hero-lema{display:none;}
  .hero-estado{order:3;}
  .login-panel{align-items:flex-start;padding:18px 14px 28px;}
  .login-card{padding:22px 18px;border-radius:20px;}
}

/* TOPBAR */
.topbar{display:flex;align-items:center;gap:14px;background:linear-gradient(180deg,#0E4634,var(--marca));color:#fff;padding:10px 16px;flex-wrap:wrap;box-shadow:0 2px 10px rgba(11,59,44,.25);position:relative;z-index:2;}
.topbar-logo{width:30px;height:30px;flex:none;}
.topbar-brand{display:flex;align-items:center;gap:8px;font-weight:800;font-size:18px;}
.conn-dot{width:10px;height:10px;border-radius:50%;flex:none;box-shadow:0 0 0 2px rgba(255,255,255,.35);}
.topbar-cactus{font-size:22px;}
.topbar-nav{display:flex;gap:6px;flex:1;flex-wrap:wrap;}
.nav-btn{display:flex;align-items:center;gap:7px;background:transparent;border:none;color:#E3EFE8;padding:9px 13px;border-radius:11px;font-size:14px;font-weight:600;position:relative;min-height:44px;}
.nav-btn.on{background:rgba(255,255,255,.18);color:#fff;}
.nav-btn.ghost{padding:9px;min-width:44px;justify-content:center;}
.nav-corto{display:none;}
.badge{position:absolute;top:-2px;right:-2px;background:var(--barro);color:#fff;border-radius:10px;font-size:11px;font-style:normal;padding:1px 6px;}
.topbar-user{display:flex;align-items:center;gap:6px;}
.user-name{font-weight:600;font-size:14px;}

/* Avisos de cocina */
.cocina-alertas{position:sticky;top:0;z-index:30;display:flex;flex-direction:column;gap:6px;padding:8px 12px;background:var(--crema);border-bottom:1px solid var(--linea);}
.alerta-permiso{background:var(--maiz);color:#fff;border:0;border-radius:10px;padding:10px;font-weight:700;cursor:pointer;min-height:44px;}
.alerta-pedido{display:flex;align-items:center;gap:8px;background:#fff;border:1.5px solid var(--ok);border-radius:12px;padding:8px 10px;animation:toastIn .2s ease;}
.alerta-pedido.extra{border-color:var(--especial);}
.alerta-txt{flex:1;font-size:14px;}

/* Avisos de conexión/datos */
.aviso-barra{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 16px;font-size:14px;font-weight:600;background:var(--maiz-suave);color:#5A3A00;border-bottom:1px solid #EBD5A8;}
.aviso-barra.error{background:var(--barro-suave);color:var(--alerta);border-bottom-color:#E9C3B2;}
.aviso-barra span{flex:1;min-width:200px;}

.main{flex:1;overflow:auto;min-height:0;}

/* SCREENS */
.screen{padding:22px;max-width:1100px;margin:0 auto;}
.screen-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;}
.screen-head h2{margin:0;font-size:26px;} .screen-head .muted{margin:4px 0 18px;}
.sub-h{margin:26px 0 12px;font-size:18px;}
.empty{padding:30px;text-align:center;color:var(--tinta2);background:var(--papel);border:1px dashed var(--linea);border-radius:14px;}

/* MESAS */
.mesas-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px;}
.mesa-card{background:var(--papel);border:2px solid var(--linea);border-radius:18px;padding:18px;min-height:130px;box-shadow:var(--sombra);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;transition:transform .08s;color:var(--tinta);position:relative;}
.mesa-card:active{transform:scale(.97);}
.mesa-card.ocupada{border-color:var(--barro);background:var(--barro-suave);}
.mesa-card.borrador{border-color:var(--maiz);border-style:dashed;background:var(--maiz-suave);}
.mesa-num{font-size:40px;font-weight:800;line-height:1;}
.mesa-estado{font-size:13px;font-weight:700;color:var(--tinta2);text-transform:uppercase;letter-spacing:1px;}
.mesa-card.ocupada .mesa-estado{color:var(--barro);}
.mesa-card.borrador .mesa-estado{color:var(--maiz);}
.mesa-info{display:flex;flex-direction:column;align-items:center;gap:3px;font-size:12px;color:var(--tinta2);margin-top:6px;text-align:center;}
.mesa-mesero{background:var(--barro);color:#fff;padding:3px 10px;border-radius:8px;font-weight:700;font-size:12px;}
.mesa-card.borrador .mesa-mesero{background:var(--maiz);}
.sin-guardar{position:absolute;top:8px;right:8px;background:var(--agave);color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:8px;}

.especial-card{background:var(--papel);}
.especial-card.llevar{border-color:var(--maiz);color:var(--maiz);}
.especial-card.llevar:active{background:var(--maiz-suave);}
.especial-card.domicilio{border-color:var(--barro);color:var(--barro);}
.especial-card.domicilio:active{background:var(--barro-suave);}
.especial-card-label{font-size:17px;font-weight:800;margin-top:8px;}
.especial-badge{margin-top:4px;background:var(--barro);color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:8px;}

.type-fixed{display:flex;align-items:center;gap:6px;background:var(--tc);color:#fff;padding:9px 16px;border-radius:12px;font-weight:800;font-size:15px;}
.mesa-chip{background:var(--agave);color:#fff;padding:8px 14px;border-radius:12px;font-weight:800;font-size:15px;}
.ocupada-bar{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;background:var(--barro-suave);border-bottom:1px solid var(--linea);padding:8px 16px;font-size:14px;color:var(--barro);}
.ocupada-bar.borrador{background:var(--maiz-suave);color:#5A3A00;}
.ocupada-bar b{color:var(--tinta);}

/* COMANDA */
.comanda-wrap{height:100%;display:flex;flex-direction:column;min-height:0;}
.type-bar{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--papel);border-bottom:1px solid var(--linea);flex-wrap:wrap;}
.type-btns{display:flex;gap:8px;flex:1;flex-wrap:wrap;}
.type-btn{display:flex;align-items:center;gap:6px;border:2px solid var(--linea);background:#fff;color:var(--tinta);padding:9px 14px;border-radius:12px;font-weight:700;font-size:14px;position:relative;min-height:44px;}
.type-btn.on{border-color:var(--tc);background:var(--tc);color:#fff;}
.type-banner{color:#fff;text-align:center;font-weight:800;font-size:20px;letter-spacing:.5px;padding:8px;text-transform:uppercase;}

.comanda{flex:1;display:grid;grid-template-columns:1fr 380px;min-height:0;}
.menu-pane{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--linea);}
.menu-pane-scroll{flex:1;overflow:auto;padding:14px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;scroll-padding-top:120px;}
.menu-inner{display:flex;flex-direction:column;gap:14px;}
.persona-bar{position:sticky;top:-14px;z-index:5;display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:-14px -14px 0;padding:10px 14px;background:var(--papel);border-bottom:1px solid var(--linea);}
.pane-scroll .persona-bar{top:-14px;}
.persona-label{font-size:13px;font-weight:800;color:var(--tinta2);}
.persona-chip{display:flex;align-items:center;gap:6px;border:2px solid var(--linea);background:#fff;color:var(--tinta);border-radius:20px;padding:6px 12px;font-size:14px;font-weight:700;min-height:44px;}
.persona-chip[aria-pressed="true"]{border-color:var(--agave);background:var(--agave);color:#fff;}
.persona-n{font-size:12px;opacity:.85;}
.persona-add{border:2px dashed var(--lima);background:#fff;color:var(--lima);border-radius:20px;min-height:44px;min-width:44px;font-weight:800;display:flex;align-items:center;justify-content:center;gap:4px;padding:6px 12px;}
.menu-tools{display:flex;flex-direction:column;gap:8px;}
.cat-jumps{display:flex;gap:6px;flex-wrap:wrap;}
.cat-jumps button{border:1.5px solid var(--linea);background:#fff;color:var(--tinta);border-radius:10px;padding:8px 12px;font-weight:700;font-size:13px;min-height:44px;}
.buscar{max-width:none;}
.cols-3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}
.menu-col{background:var(--papel);border-radius:14px;border:1px solid var(--linea);overflow:hidden;}
.col-head{background:var(--cat);color:#fff;padding:9px 12px;font-weight:700;font-size:14px;margin:0;}
.col-items{padding:8px;display:flex;flex-direction:column;gap:7px;}
.item-btn{display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;border:1.5px solid var(--linea);background:#fff;border-radius:10px;padding:10px 12px;font-size:14px;font-weight:600;color:var(--tinta);min-height:48px;border-left:5px solid var(--cat);transition:transform .06s,background .1s;}
.item-btn:active{transform:scale(.97);background:var(--crema);}
.item-nombre{flex:1;}
.item-precio{font-weight:800;color:var(--cat);font-size:13px;white-space:nowrap;}
.item-quedan{display:block;font-size:11px;font-weight:600;color:var(--tinta2);}
.especial,.bebidas-box,.resultados{background:var(--papel);border:1px solid var(--linea);border-radius:14px;overflow:hidden;}
.especial-head{background:var(--especial);color:#fff;padding:9px 14px;font-weight:700;font-size:15px;margin:0;}
.especial-items,.bebidas-items,.resultados-items{padding:10px;display:flex;flex-wrap:wrap;gap:8px;}
.especial-items .item-btn{flex:1;min-width:140px;--cat:var(--especial);}
.bebidas-head{background:var(--agua);color:#fff;padding:9px 14px;font-weight:700;font-size:15px;margin:0;}
.bebidas-items .item-btn{flex:1;min-width:130px;--cat:var(--agua);}
.resultados-items .item-btn{flex:1 1 220px;}

.ticket-pane{display:flex;flex-direction:column;background:var(--papel);min-height:0;overflow:hidden;}
.ticket-inner{flex:1;display:flex;flex-direction:column;min-height:0;}
.ticket-head{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid var(--linea);background:var(--crema);}
.ticket-origen{font-size:18px;font-weight:800;margin:0;} .ticket-mesero{font-size:12px;color:var(--tinta2);}
.dom-resumen{display:flex;align-items:center;gap:8px;width:100%;text-align:left;background:var(--barro-suave);border:none;border-bottom:1px solid var(--linea);padding:10px 16px;font-size:13px;color:var(--barro);font-weight:600;min-height:44px;}
.dom-resumen span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ticket-scroll{flex:1;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;}

.orden{border:1.5px solid var(--linea);border-radius:12px;padding:10px;background:#fff;}
.orden.activa{border-color:var(--agave);box-shadow:0 0 0 2px rgba(23,58,47,.18);}
.orden-head{display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:6px;}
.orden-sel{display:flex;align-items:center;gap:6px;background:none;border:none;font-weight:800;font-size:15px;color:var(--tinta);min-height:44px;padding:0 4px;text-align:left;}
.orden-sel .marca{font-size:11px;font-weight:700;background:var(--agave);color:#fff;border-radius:8px;padding:2px 7px;}
.orden-input{font-weight:800;font-size:15px;border:1.5px solid var(--agave);border-radius:6px;padding:6px 8px;min-width:0;flex:1;}
.orden-right{display:flex;align-items:center;gap:4px;}
.orden-count{background:var(--agave);color:#fff;border-radius:20px;min-width:24px;text-align:center;font-size:12px;font-weight:700;padding:2px 6px;}
.orden-empty{font-size:12px;color:var(--tinta2);font-style:italic;padding:4px 2px;}
.orden-prep{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-top:9px;padding-top:9px;border-top:1px dashed var(--linea);}
.orden-prep-label{font-size:12px;font-weight:700;color:var(--tinta2);margin-right:2px;}
.prep-chip{border:1.5px solid var(--linea);background:#fff;border-radius:20px;padding:8px 12px;font-size:13px;font-weight:700;color:var(--tinta2);min-height:40px;}
.prep-chip[aria-pressed="true"]{background:var(--agave);border-color:var(--agave);color:#fff;}
.extra-chip{display:flex;align-items:center;gap:3px;border:1.5px solid var(--cat);background:#fff;color:var(--cat);border-radius:20px;padding:8px 12px;font-size:13px;font-weight:700;min-height:40px;}
.extra-chip:active{background:#EEF3E8;}
.ref-input{flex:1;min-width:120px;border:2px solid var(--linea);border-radius:12px;padding:9px 12px;font-size:15px;font-weight:600;background:#fff;min-height:44px;}
.ref-input:focus{border-color:var(--maiz);}
.pedido-extras{border:1.5px dashed var(--empaque);border-radius:12px;padding:10px;margin-top:4px;background:#F4F8EF;}
.pedido-extras-head{font-weight:800;font-size:13px;color:var(--empaque);margin-bottom:8px;}
.pedido-extras-add{display:flex;flex-wrap:wrap;gap:6px;}
.kt-extras{border-top:1px dashed var(--linea);margin-top:4px;padding-top:6px;}
.kt-extras-h{font-weight:800;font-size:12px;color:var(--empaque);margin-bottom:3px;}
.orden-items{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px;}
.oitem{display:flex;align-items:center;gap:8px;font-size:14px;}
.oitem-dot{width:9px;height:9px;border-radius:50%;background:var(--cat);flex:none;}
.oitem-name{flex:1;min-width:0;}
.oitem-precio{font-weight:700;font-size:13px;color:var(--tinta2);white-space:nowrap;}
.stepper{display:flex;align-items:center;gap:2px;border:1px solid var(--linea);border-radius:10px;overflow:hidden;flex:none;}
.stepper button{border:none;background:var(--crema);width:44px;height:44px;display:flex;align-items:center;justify-content:center;color:var(--tinta);}
.stepper button:active{background:var(--linea);}
.stepper span{min-width:28px;text-align:center;font-weight:700;font-size:14px;}
.icon-btn{border:none;background:none;color:var(--tinta2);min-width:44px;min-height:44px;padding:8px;display:flex;align-items:center;justify-content:center;border-radius:10px;}
.icon-btn:active{color:var(--alerta);background:var(--crema);}

.footer-izq,.footer-der{display:flex;gap:8px;padding:12px 14px;border-top:1px solid var(--linea);background:var(--papel);}
.footer-izq .btn,.footer-der .btn{flex:1;}
.ticket-extra{display:flex;gap:8px;padding:0 14px 12px;flex-wrap:wrap;}
.ticket-extra .btn{flex:1;}
.envio-alerta{margin:0 14px 10px;padding:10px 12px;border-radius:12px;background:var(--barro-suave);border:1.5px solid var(--alerta);color:var(--alerta);font-size:14px;font-weight:600;display:flex;flex-direction:column;gap:8px;}
.envio-alerta .btn{align-self:flex-start;}

/* BOTONES */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:none;border-radius:12px;padding:12px 16px;font-size:15px;font-weight:700;min-height:44px;transition:transform .06s,opacity .1s;}
.btn:active{transform:scale(.97);} .btn:disabled{opacity:.45;cursor:not-allowed;}
.btn-sm{padding:8px 12px;font-size:14px;min-height:40px;} .btn-block{width:100%;margin-top:8px;}
.btn-primary{background:var(--agave);color:#fff;}
.btn-add{background:var(--lima);color:#fff;}
.btn-barro{background:var(--barro);color:#fff;}
.btn-line{background:#fff;border:1.5px solid var(--agave);color:var(--agave);}
.btn-ghost{background:var(--crema);color:var(--tinta);border:1px solid var(--linea);}
.btn-danger-ghost{background:#fff;border:1.5px solid var(--alerta);color:var(--alerta);}
.btn-danger{background:var(--alerta);color:#fff;}
.girando{animation:girar 1s linear infinite;}
@keyframes girar{to{transform:rotate(360deg);}}

/* INPUTS */
.inp{border:1.5px solid var(--linea);border-radius:10px;padding:11px 12px;font-size:16px;width:100%;background:#fff;color:var(--tinta);min-height:44px;}
.inp:focus{border-color:var(--agave);}

/* PESTAÑAS CELULAR */
.pane-toggle{display:flex;gap:6px;padding:8px 12px;background:var(--papel);border-bottom:1px solid var(--linea);}
.pane-toggle button{flex:1;border:none;background:var(--crema);border-radius:10px;padding:11px;font-weight:700;font-size:14px;color:var(--tinta2);min-height:44px;}
.pane-toggle button[aria-selected="true"]{background:var(--agave);color:#fff;}
.pane-scroll{flex:1;overflow:auto;min-height:0;padding:14px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;scroll-padding-top:120px;}
.phone-footer{border-top:1px solid var(--linea);background:var(--papel);}
.phone-footer .footer-izq,.phone-footer .footer-der{border-top:none;}
.phone-footer .ticket-extra{padding-top:10px;}

/* COCINA */
.cocina-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;}
.kticket{background:var(--papel);border:1px solid var(--linea);border-radius:14px;overflow:hidden;}
.kt-tipo{color:#fff;font-weight:800;font-size:13px;text-transform:uppercase;letter-spacing:.5px;padding:6px 12px;}
.kt-head{display:flex;justify-content:space-between;align-items:center;padding:8px 12px 0;}
.kt-origen{font-weight:800;font-size:16px;} .kt-hora{font-size:12px;color:var(--tinta2);}
.kt-mesero{font-size:12px;color:var(--tinta2);padding:0 12px 6px;}
.kt-estado{font-size:12px;font-weight:700;color:var(--maiz);padding:0 12px 6px;}
.kt-dom{font-size:13px;color:var(--barro);padding:0 12px 6px;line-height:1.5;}
.kt-body{display:flex;flex-direction:column;gap:8px;padding:0 12px 10px;}
.kt-orden{background:var(--crema);border-radius:8px;padding:7px 9px;}
.kt-oname{font-weight:700;font-size:13px;margin-bottom:3px;}
.kt-item{font-size:14px;}
.kt-prep{font-size:12px;font-weight:700;color:var(--barro);margin-bottom:2px;}
.kt-actions{display:flex;gap:6px;padding:0 12px 12px;flex-wrap:wrap;} .kt-actions .btn{flex:1;}
.kt-tacos{margin:0 12px 10px;background:var(--crema);border:1px dashed var(--barro);border-radius:9px;padding:6px 10px;font-size:13px;font-weight:700;color:var(--barro);text-align:center;}
.kt-tacos b{font-size:16px;}
.corte-bar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;background:var(--papel);border:1px solid var(--linea);border-radius:14px;padding:14px 16px;margin-bottom:14px;}
.corte-total{font-size:26px;font-weight:800;color:var(--agave);line-height:1;}
.corte-btns{display:flex;gap:8px;flex:none;}
.corte-desglose{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px;}
.cd-col{background:var(--papel);border:1px solid var(--linea);border-radius:12px;padding:12px 14px;}
.cd-col h4{margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--tinta2);}
.cd-row{display:flex;justify-content:space-between;gap:8px;padding:3px 0;font-size:14px;}
.hist-list{display:flex;flex-direction:column;gap:8px;}
.hist-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--papel);border:1px solid var(--linea);border-radius:12px;padding:10px 12px;}
.hist-dot{width:10px;height:10px;border-radius:50%;flex:none;}
.hist-info{flex:1;min-width:0;}
.hist-origen{font-weight:700;font-size:14px;}
.hist-total{font-weight:800;color:var(--barro);}
.resumen-scroll{flex:1;overflow:auto;padding:14px;min-height:0;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;}
.resumen-h{margin:0 0 10px;font-size:16px;}
.resumen-orden{background:var(--papel);border:1px solid var(--linea);border-radius:12px;padding:10px 12px;margin-bottom:8px;}
.resumen-oname{font-weight:800;font-size:14px;margin-bottom:4px;}
.resumen-item{font-size:14px;}
.resumen-item span{font-weight:700;display:inline-block;min-width:26px;}
.resumen-actions{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border-top:1px solid var(--linea);background:var(--papel);}
.resumen-extra{border:1px solid var(--especial);border-radius:12px;padding:8px 10px 4px;margin-bottom:8px;background:rgba(180,40,40,.05);}
.resumen-extra-h{font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--especial);margin-bottom:6px;}
.listos-row{display:flex;flex-wrap:wrap;gap:8px;}
.listo-chip{display:flex;align-items:center;gap:4px;background:#EAF3EE;border:1px solid #CFE3D8;border-radius:20px;padding:2px 4px 2px 14px;font-size:14px;color:var(--ok);font-weight:600;}
.listo-chip .icon-btn{color:var(--ok);}

/* INVENTARIO */
.inv-list{display:flex;flex-direction:column;gap:8px;}
.inv-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:var(--papel);border:1px solid var(--linea);border-radius:12px;padding:8px 14px;min-height:56px;}
.inv-row.agotado{background:var(--barro-suave);border-color:#E9C3B2;}
.inv-name{font-weight:700;flex:1;min-width:120px;}
.tag-agotado{background:var(--alerta);color:#fff;font-size:12px;padding:2px 8px;border-radius:8px;font-weight:700;}
.qty-inp{width:56px;text-align:center;border:none;font-weight:700;font-size:15px;background:transparent;min-height:44px;}
.inv-add{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;} .inv-add .inp{flex:1;min-width:160px;}
.switch{position:relative;display:inline-flex;align-items:center;width:52px;height:44px;flex:none;}
.switch input{position:absolute;opacity:0;width:100%;height:100%;margin:0;cursor:pointer;}
.switch span{position:absolute;left:4px;right:4px;top:9px;height:26px;background:#9AA293;border-radius:20px;transition:.2s;pointer-events:none;}
.switch span:before{content:"";position:absolute;width:20px;height:20px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s;}
.switch input:checked + span{background:var(--ok);}
.switch input:checked + span:before{transform:translateX(18px);}
.switch input:focus-visible + span{outline:3px solid var(--foco);outline-offset:2px;}

/* GASTOS */
.gasto-add{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;} .gasto-add .campo{flex:1;min-width:140px;margin:0;} .gasto-add .campo-monto{flex:none;width:140px;}
.gasto-total{margin:14px 0;font-size:16px;}
.gasto-list{display:flex;flex-direction:column;gap:8px;}
.gasto-row{display:flex;align-items:center;gap:12px;background:var(--papel);border:1px solid var(--linea);border-radius:12px;padding:8px 8px 8px 14px;}
.gasto-concepto{font-weight:700;} .gasto-monto{margin-left:auto;font-weight:800;color:var(--barro);}

/* MODALES */
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:50;padding:16px;}
.modal{background:#fff;border-radius:16px;width:min(380px,100%);max-height:calc(100dvh - 32px);overflow:auto;color:var(--tinta);}
.modal:focus{outline:none;}
.modal-dom{width:min(440px,100%);}
.modal-head{display:flex;align-items:center;gap:10px;padding:10px 10px 10px 18px;border-bottom:1px solid var(--linea);}
.modal-head h3{margin:0;flex:1;font-size:18px;}
.modal-body{padding:16px;display:flex;flex-direction:column;gap:4px;}
.modal-body label{font-size:13px;font-weight:700;color:var(--tinta2);margin-top:8px;}
.dom-row{display:flex;gap:10px;}
.modal-actions{display:flex;gap:8px;padding:14px;border-top:1px solid var(--linea);flex-wrap:wrap;} .modal-actions .btn{flex:1;}
.modal > .modal-actions{position:sticky;bottom:0;background:#fff;}
.confirm-msg{margin:0;padding:14px 18px 4px;color:var(--tinta);line-height:1.5;}
.modal-pin{padding:0 18px 8px;}
.form-error{color:var(--alerta);font-weight:600;font-size:14px;padding:0 18px;}

/* Toasts */
.toaster{position:fixed;left:0;right:0;bottom:18px;display:flex;flex-direction:column;align-items:center;gap:8px;z-index:90;pointer-events:none;padding:0 16px;}
body:has(.modal-bg) .toaster{top:12px;bottom:auto;}
.toast{pointer-events:auto;max-width:460px;width:fit-content;display:flex;align-items:center;gap:6px;background:var(--tinta);color:#fff;padding:6px 6px 6px 16px;border-radius:12px;font-size:15px;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,.25);animation:toastIn .22s ease;}
.toast .icon-btn{color:#fff;}
.toast.ok{background:var(--ok);}
.toast.error{background:var(--alerta);}
.toast.info{background:var(--agave2);}
@keyframes toastIn{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:translateY(0);}}
.ticket-total{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-top:2px solid var(--agave);background:var(--crema);font-size:16px;font-weight:700;}
.ticket-total b{font-size:22px;color:var(--agave);}

/* ADMIN */
.admin-tabs{display:flex;gap:6px;margin-bottom:18px;flex-wrap:wrap;}
.admin-tabs button{background:var(--papel);border:1.5px solid var(--linea);border-radius:11px;padding:10px 18px;font-weight:700;font-size:14px;color:var(--tinta2);min-height:44px;}
.admin-tabs button[aria-selected="true"]{background:var(--agave);border-color:var(--agave);color:#fff;}
.precio-list{display:flex;flex-direction:column;gap:6px;}
.precio-row{display:flex;align-items:center;gap:12px;background:var(--papel);border:1px solid var(--linea);border-radius:10px;padding:6px 14px;}
.precio-nombre{flex:1;font-weight:600;font-size:14px;}
.precio-input{display:flex;align-items:center;gap:2px;border:1.5px solid var(--linea);border-radius:9px;padding:0 10px;background:#fff;font-weight:700;}
.precio-input:focus-within{border-color:var(--agave);box-shadow:0 0 0 3px rgba(31,111,235,.35);}
.precio-input span{color:var(--tinta2);}
.precio-input input{width:72px;border:none;font-size:16px;font-weight:700;text-align:right;background:transparent;min-height:42px;}
.precio-input input:focus{outline:none;}
.precio-estado{font-size:12px;min-width:60px;text-align:right;color:var(--tinta2);}
.prod-add{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;}
.prod-add .inp{flex:1;min-width:140px;}
.inp-sm{flex:none !important;max-width:130px;}
.rol-tag{font-size:12px;font-weight:700;padding:3px 10px;border-radius:8px;}
.rol-tag.admin{background:var(--agave);color:#fff;}
.rol-tag.mesero{background:var(--linea);color:var(--tinta);}
.rol-tag.cocinero{background:var(--barro);color:#fff;}
.topbar .rol-tag.mesero{background:#E6DEC9;}
.mesa-card.solo-ver{cursor:default;}

/* TICKET TÉRMICO 58mm */
.modal-ticket{width:min(320px,100%);}
.ticket-print{font-family:"Courier New",monospace;color:#000;background:#fff;}
.t58{width:230px;margin:12px auto 0;padding:8px 10px;border:1px solid var(--linea);border-radius:4px;}
.tp-name{text-align:center;font-size:18px;font-weight:800;line-height:1.1;}
.tp-sub{text-align:center;font-size:12px;margin:2px 0 6px;}
.tp-meta{display:flex;justify-content:space-between;font-size:11px;gap:6px;}
.tp-modo-tag{font-weight:800;}
.tp-dom{font-size:12px;margin-top:6px;line-height:1.5;overflow-wrap:anywhere;}
.tp-line{border-top:1px dashed #000;margin:7px 0;}
.tp-orden{margin-bottom:7px;}
.tp-oname{font-weight:800;font-size:13px;}
.tp-extras-h{font-weight:800;font-size:12px;margin-bottom:2px;}
/* el nombre puede ocupar varias líneas para que dos productos parecidos se distingan */
.tp-item{display:flex;gap:6px;font-size:14px;align-items:baseline;line-height:1.35;}
.tp-q{min-width:20px;font-weight:800;text-align:right;}
.tp-n{flex:1;min-width:0;overflow-wrap:anywhere;}
.tp-p{font-weight:700;white-space:nowrap;}
.tp-total{display:flex;justify-content:space-between;font-weight:800;font-size:16px;margin:2px 0 6px;}
.tp-foot{text-align:center;font-size:12px;margin-top:4px;}
.tp-suborden{display:flex;justify-content:space-between;font-weight:700;font-size:13px;border-top:1px dotted #000;margin-top:3px;padding-top:2px;}
.tp-bebidas{margin-top:5px;padding-top:4px;border-top:1px dashed #000;}
.tp-bebidas .tp-oname{letter-spacing:1px;}
.auto-print{display:flex;align-items:center;gap:8px;font-size:14px;color:var(--tinta2);padding:10px 14px 0;cursor:pointer;min-height:44px;}
.auto-print input{width:20px;height:20px;}
.ticket-modos{display:flex;gap:0;margin:10px 14px 0;border:1px solid var(--linea);border-radius:10px;overflow:hidden;}
.seg-b{flex:1;padding:10px;background:#fff;border:0;font-weight:700;color:var(--tinta2);cursor:pointer;min-height:44px;}
.seg-b[aria-pressed="true"]{background:var(--agave);color:#fff;}

/* COBROS */
.pago-chip{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:700;padding:2px 9px;border-radius:999px;white-space:nowrap;}
.pago-chip.pagado{background:var(--ok-suave);color:var(--ok);}
.pago-chip.pendiente{background:var(--maiz-suave);color:var(--maiz);}
.pago-chip.previo{background:var(--crema);color:var(--tinta2);}
/* Estatus del pedido (mesero) */
.estado-pedido{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:800;padding:3px 10px 3px 8px;border-radius:999px;white-space:nowrap;background:var(--crema);color:var(--tinta2);margin-top:4px;}
.ep-pasos{display:inline-flex;gap:3px;}
.ep-pasos i{width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.25;}
.ep-pasos i.on{opacity:1;}
.estado-pedido.p-recibido{background:#E8EEF6;color:var(--agua);}
.estado-pedido.p-proceso{background:var(--maiz-suave);color:var(--maiz);}
.estado-pedido.p-entregado{background:var(--agave-suave);color:var(--agave);}
.estado-pedido.p-cobrado{background:var(--ok-suave);color:var(--ok);}
.estatus-lista{display:flex;flex-direction:column;gap:6px;margin:4px 0 12px;}
.estatus-fila{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;font-size:14px;font-weight:600;}
.estatus-fila .estado-pedido{margin-top:0;}
.nota-liberar{text-align:center;margin:4px 0 0;}
.aviso-sin-cobro{margin:0 0 4px;padding:10px 12px;border-radius:12px;background:var(--barro-suave);color:var(--tinta);font-size:14px;line-height:1.45;}
.link-sin-cobro{align-self:center;margin:6px 0 0;color:var(--alerta);text-decoration:underline;}
.cobro-monto.sin-cobro{color:var(--alerta);}
.mesa-cobrar{margin-top:4px;background:var(--maiz-suave);color:var(--maiz);font-size:12px;font-weight:800;padding:2px 9px;border-radius:999px;}
.por-cobrar{margin-top:26px;}
.por-cobrar-list{display:flex;flex-direction:column;gap:8px;}
.pc-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:var(--papel);border:1px solid var(--linea);border-radius:14px;padding:10px 12px 10px 16px;box-shadow:var(--sombra);}
.pc-info{flex:1;min-width:160px;}
.pc-origen{font-weight:800;}
.pc-total{font-family:var(--fuente-titulo);font-size:20px;font-weight:700;font-variant-numeric:tabular-nums;}
.modal-cobro{width:min(480px,100%);}
.cobro-cuentas{display:flex;flex-direction:column;gap:6px;margin-bottom:6px;}
.cobro-cuenta{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1.5px solid var(--linea);border-radius:12px;min-height:48px;cursor:pointer;}
.cobro-cuenta:has(input:checked){border-color:var(--agave);background:var(--agave-suave);}
.cobro-cuenta input{width:20px;height:20px;accent-color:var(--agave);}
.cobro-cuenta span:first-of-type{flex:1;}
.cobro-total{display:flex;justify-content:space-between;align-items:baseline;padding:12px 4px 4px;border-top:1px dashed var(--linea);margin-top:6px;}
.cobro-monto{font-family:var(--fuente-titulo);font-size:32px;font-weight:700;color:var(--agave);}
.segmento{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;}
.segmento button{display:flex;flex-direction:column;align-items:center;gap:2px;border:1.5px solid var(--linea);background:var(--papel);border-radius:12px;padding:8px 6px;font-weight:700;font-size:14px;color:var(--tinta);min-height:56px;}
.segmento button[aria-pressed="true"]{border-color:var(--agave);background:var(--agave);color:#fff;}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;}
.chips button{border:1.5px solid var(--linea);background:var(--papel);border-radius:999px;padding:8px 14px;font-weight:700;font-size:14px;min-height:40px;color:var(--tinta);font-variant-numeric:tabular-nums;}
.chips button[aria-pressed="true"]{border-color:var(--agave);background:var(--agave-suave);color:var(--agave);}
.cambio{display:flex;justify-content:space-between;align-items:center;margin-top:10px;padding:12px 14px;border-radius:14px;background:var(--ok-suave);color:var(--ok);font-weight:800;font-size:18px;}
.cambio.falta{background:var(--barro-suave);color:var(--alerta);}
.cobro-hecho{text-align:center;padding:10px 18px 4px;}
.cobro-hecho .cobro-monto{font-size:44px;}
.check-linea{display:flex;align-items:center;gap:10px;font-weight:600;margin-top:12px;min-height:44px;}
.check-linea input{width:20px;height:20px;accent-color:var(--agave);}
.etq-sec{font-size:13px;font-weight:800;color:var(--tinta2);margin:12px 0 6px;text-transform:uppercase;letter-spacing:.04em;}
.cobrado-grid{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:6px;font-size:13px;color:var(--tinta2);}
.cobrado-grid b{color:var(--tinta);}

/* COCINA: tiempo de espera */
.kt-espera{font-size:12px;font-weight:800;padding:2px 8px;border-radius:999px;background:var(--crema);color:var(--tinta2);}
.kt-espera.media{background:var(--maiz-suave);color:var(--maiz);}
.kt-espera.alta{background:var(--barro-suave);color:var(--alerta);}
.kt-folio{font-size:12px;color:var(--tinta2);font-weight:700;}

/* TICKET: formatos cuenta / cocina y ancho de papel */
.t80{width:300px;margin:12px auto 0;padding:8px 12px;border:1px solid var(--linea);border-radius:4px;}
.ticket-print.t58,.ticket-print.t80{box-shadow:0 2px 8px rgba(0,0,0,.06);}
.tp-folio{display:flex;justify-content:space-between;font-size:12px;font-weight:800;}
.tp-unit{font-size:11px;color:#333;margin-left:26px;margin-top:-2px;}
.tp-pago{font-size:12px;margin-top:4px;}
.tp-pago div{display:flex;justify-content:space-between;}
.tp-cocina .tp-head{text-align:center;border:2px solid #000;padding:4px 2px;margin-bottom:6px;}
.tp-cocina .tp-tipo{font-size:20px;font-weight:900;letter-spacing:.04em;text-transform:uppercase;line-height:1.1;}
.tp-cocina .tp-origen{font-size:18px;font-weight:800;}
.tp-cocina .tp-oname{font-size:15px;border-bottom:1px solid #000;margin-top:6px;}
.tp-cocina .tp-prep{font-size:14px;font-weight:900;text-transform:uppercase;margin:2px 0 3px;}
.tp-cocina .tp-item{font-size:17px;font-weight:700;line-height:1.3;}
.tp-cocina .tp-q{min-width:28px;font-size:18px;}
.tp-cocina .tp-tacos{font-size:16px;font-weight:900;text-align:center;border-top:2px solid #000;margin-top:6px;padding-top:4px;}
.ticket-opciones{display:flex;gap:8px;flex-wrap:wrap;margin:10px 14px 0;}
.ticket-opciones .ticket-modos{margin:0;flex:1;min-width:140px;}

@media print{
  @page{ margin:0; }
  html,body{ margin:0!important; padding:0!important; background:#fff; }
  body *{ visibility:hidden; }
  #print-area,#print-area *{ visibility:visible; color:#000!important; }
  #print-area{ position:absolute; left:0; top:0; margin:0!important; border:0!important; border-radius:0!important; padding:0 2mm!important; box-shadow:none!important; }
  .no-print{ display:none!important; }
}

/* Celular: mismo corte que useIsPhone() (< 760 px) */
@media (max-width:759.98px){
  .cols-3{grid-template-columns:1fr;}
  .type-banner{font-size:16px;}
  .topbar{gap:6px;padding:6px 8px;}
  .topbar-name,.user-name,.topbar-user .rol-tag{display:none;}
  .topbar-brand{flex:1;}
  /* todas las secciones visibles en una segunda fila, sin desplazamiento oculto */
  .topbar-nav{order:3;flex:1 1 100%;display:grid;grid-template-columns:repeat(var(--n),1fr);gap:4px;}
  .nav-btn{flex-direction:column;gap:2px;padding:6px 2px;font-size:12px;justify-content:center;}
  .nav-largo{display:none;} .nav-corto{display:inline;}
  .badge{top:2px;right:calc(50% - 22px);}
  .topbar-user .nav-btn.ghost{min-height:40px;padding:6px;}
  .nav-btn{min-height:48px;padding:4px 2px;}
  /* comanda compacta: el menú conserva el espacio vertical */
  .type-bar{gap:6px;padding:6px 10px;flex-wrap:nowrap;}
  .type-btns{flex:1;flex-wrap:nowrap;gap:6px;min-width:0;}
  .type-btn{padding:6px 10px;}
  .type-bar .mesa-chip,.tf-ocultable{display:none;}
  .type-fixed{padding:8px 10px;font-size:14px;}
  .ref-input{min-width:0;}
  .type-banner{font-size:14px;padding:4px;}
  .pane-toggle{padding:6px 10px;}
  .phone-footer .footer-der{padding:8px 10px;gap:6px;}
  .phone-footer .btn{padding:10px 8px;font-size:14px;}
  .envio-alerta{margin:8px 10px 0;}
  .mesas-grid{grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;}
  .mesa-card{min-height:112px;padding:12px;}
  .screen{padding:16px;}
  .dom-row{flex-direction:column;gap:0;}
}
`;
