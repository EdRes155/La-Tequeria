// Datos sintéticos para el piloto técnico del plan multinegocio (PLAN-MULTINEGOCIO.md, decisión 4).
// Dos cuentas independientes, con una sucursal cada una, que comparten a propósito claves locales
// («Mesa 1», «pastor», «coca») para comprobar el aislamiento. Solo para desarrollo, pruebas
// automáticas y staging: nunca se siembran en producción. Nombres y correos son ficticios (dominio
// reservado .invalid) y los PIN cumplen la política de 6 a 8 dígitos, distintos entre sí.
//
// El origen está congelado. Cada prueba pide su propia copia profunda con crearCuentas() o
// sucursales(): cambiar algo de una sucursal nunca afecta a la otra, a otra prueba ni al origen.

const congelar = (o) => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) Object.values(Object.freeze(o)).forEach(congelar);
  return o;
};
// Cada sucursal arma su propio catálogo: aunque las claves coincidan, los objetos no se comparten
const bebidasBase = () => [
  { id: "coca", nombre: "Coca-Cola", precio: 25, cantidad: 24 },
  { id: "agua-horchata", nombre: "Agua de horchata", precio: 30, cantidad: 12 },
];

const ORIGEN = congelar([
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
        bebidas: bebidasBase(),
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
        bebidas: bebidasBase(),
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
]);

// Copia profunda nueva en cada llamada
export const crearCuentas = () => structuredClone(ORIGEN);
export const sucursales = (cuentas = crearCuentas()) => cuentas.flatMap((c) => c.sucursales.map((s) => ({ ...s, cuenta: c.clave })));
// Solo para comprobar que el origen no se puede modificar
export const origenParaPruebas = ORIGEN;
