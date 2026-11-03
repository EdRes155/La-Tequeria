// Datos sintéticos para el piloto técnico del plan multinegocio (PLAN-MULTINEGOCIO.md, decisión 4).
// Dos cuentas independientes, con una sucursal cada una, que comparten a propósito claves locales
// («Mesa 1», «pastor», «coca») para comprobar el aislamiento. Solo para desarrollo, pruebas
// automáticas y staging: nunca se siembran en producción. Nombres y correos son ficticios (dominio
// reservado .invalid) y los PIN cumplen la política de 6 a 8 dígitos, distintos entre sí.
// Se usarán para sembrar la base de prueba cuando exista el modelo de docs/multinegocio/MODELO.md.

const catalogoComun = {
  bebidas: [
    { id: "coca", nombre: "Coca-Cola", precio: 25, cantidad: 24 },
    { id: "agua-horchata", nombre: "Agua de horchata", precio: 30, cantidad: 12 },
  ],
};

export const CUENTAS = [
  {
    clave: "tequeria",
    nombre: "La Tequería (datos de prueba)",
    duenos: [{ correo: "propietario.tequeria@ejemplo.invalid", rol: "propietario" }],
    sucursales: [
      {
        clave: "tequeria-centro",
        nombre: "La Tequería · Centro (prueba)",
        zonaHoraria: "America/Mexico_City",
        mesas: 8,
        carnes: ["pastor", "bistec", "suadero"],
        ...catalogoComun,
        precios: { "taco-pastor": 20, "taco-bistec": 20, "gringa-pastor": 45 },
        personal: [
          { clave: "ana", nombre: "Ana Prueba", rol: "admin", pin: "804219" },
          { clave: "luis", nombre: "Luis Prueba", rol: "mesero", pin: "571936" },
          { clave: "tono", nombre: "Toño Prueba", rol: "cocinero", pin: "39071528" },
        ],
        dispositivos: [
          { clave: "caja", nombre: "Caja", monitorCocina: false },
          { clave: "cocina", nombre: "Monitor de cocina", monitorCocina: true },
        ],
      },
    ],
  },
  {
    clave: "piloto-b",
    nombre: "Taquería Piloto B (ficticia)",
    duenos: [
      { correo: "propietario.pilotob@ejemplo.invalid", rol: "propietario" },
      { correo: "encargado.pilotob@ejemplo.invalid", rol: "encargado" },
    ],
    sucursales: [
      {
        clave: "piloto-b-unica",
        nombre: "Taquería Piloto B (prueba)",
        zonaHoraria: "America/Monterrey",
        mesas: 5,
        carnes: ["pastor", "tripa"],
        ...catalogoComun,
        precios: { "taco-pastor": 18, "taco-tripa": 22, "gringa-pastor": 40 },
        personal: [
          { clave: "berta", nombre: "Berta Prueba", rol: "admin", pin: "62840715" },
          { clave: "omar", nombre: "Omar Prueba", rol: "mesero", pin: "918273" },
          { clave: "rita", nombre: "Rita Prueba", rol: "cocinero", pin: "730159" },
        ],
        dispositivos: [
          { clave: "mesero", nombre: "Tablet de meseros", monitorCocina: false },
          { clave: "cocina", nombre: "Monitor de cocina", monitorCocina: true },
        ],
      },
    ],
  },
];

export const sucursales = () => CUENTAS.flatMap((c) => c.sucursales.map((s) => ({ ...s, cuenta: c.clave })));
