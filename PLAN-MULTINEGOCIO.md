# Plan: La Tequería para varias taquerías

Fecha: 31 de octubre de 2026.
Estado: **plan aprobado, sin ejecutar.** Nada de esto está implementado todavía.

## Decisión

**Opción 1: una sola app y una sola base de datos para todas las taquerías**, con cada dato
marcado con su taquería. La app sigue en Vercel y la base en Supabase.

La opción 2 (una instalación por cliente) queda solo como un plan «dedicado» para un cliente
grande que la pague. Se haría siempre desde este mismo repositorio, con la configuración de
cada cliente en variables y sin copias del código.

Se descartó una base separada por cliente dentro de la misma web. Se puede hacer (la app vería
qué base usar según el subdominio), pero junta lo caro de las dos opciones: pagar y actualizar
una base por cliente y, además, la complejidad de la opción 1.

## Comparación

Los costos son aproximados; hay que revisar los precios vigentes.

| | 1. Una app para todos | 2. Una instalación por cliente |
|---|---|---|
| Costo por cliente | Casi cero: un Supabase Pro y un Vercel Pro alcanzan para muchas taquerías | Un proyecto de Supabase por cliente, unos 10 a 25 USD al mes cada uno |
| Actualizaciones | Una migración y una publicación sirven para todos | Migrar y publicar una vez por cada cliente |
| Alta de un cliente | Se registra solo con Google o correo | Hay que armar a mano el proyecto, la base y los usuarios |
| Aislamiento de datos | Depende de que cada función filtre por taquería | Total: cada cliente tiene su base |
| Personalización | Por configuración, igual para todos | A medida, pero un repositorio por cliente termina en varias versiones distintas que mantener |
| Si algo falla | Afecta a todos a la vez | Afecta a un solo cliente |

## Por qué la opción 1 le queda a esta app

- El navegador no puede tocar las tablas: todo pasa por funciones del servidor que revisan la
  sesión. Separar a los clientes se resuelve en un solo lugar: la sesión llevará la taquería y
  cada función filtrará por ella.
- Todas las taquerías necesitan lo mismo. Lo que cambia entre ellas es configuración, no código
  (ver el paso 2).
- Los datos son pocos; una base aguanta muchos clientes.
- Lo caro es mantener y actualizar, y la opción 2 lo multiplica.

## Riesgo principal y cómo cubrirlo

El riesgo es que un error muestre o cambie datos de otra taquería. Se cubre así:

- La taquería forma parte de la llave de cada tabla.
- Pruebas automáticas que crean dos taquerías y comprueban, función por función, que ninguna
  ve ni cambia lo de la otra.
- Un Supabase de pruebas para probar cada cambio antes de tocar producción.

## Acceso

- **Dueño:** entra con Google o correo. Crea su taquería, ve su suscripción y da de alta a su
  personal.
- **Dispositivos:** el dueño vincula cada tablet o celular una sola vez. Después el personal
  entra como hoy, con su nombre y su PIN, sin necesitar correo.
- Vincular el dispositivo impide que alguien desde internet pruebe PINs contra cualquier
  taquería.

## Qué hay que cambiar

Es el cambio más grande hasta ahora, porque toca todas las funciones.

### 1. La taquería en todas las tablas

Agregar la taquería a todas las tablas y hacer que cada función filtre por la taquería de la
sesión.

### 2. Configuración por taquería

Hoy varias cosas están fijas en el código o en una sola fila de configuración. Cada taquería
tendrá su propia configuración, editable en Administración. Una taquería nueva arranca con los
valores que hoy usa La Tequería, que se indican entre paréntesis.

- **Negocio**
  - Nombre, logo y color de marca (hoy el logo y la paleta «nopal» son fijos).
  - Dirección, teléfono y datos fiscales que salen en el ticket.
  - Zona horaria (hoy existe en la configuración, por defecto Ciudad de México) y moneda (pesos).
- **Mesas**
  - Cuántas hay (hoy 8 fijas).
  - Nombre de cada una (hoy «Mesa 1», «Mesa 2»…; por ejemplo «Barra» o «Terraza»).
- **Tipos de pedido:** activar o no «Para comer aquí», «Para llevar» y «Domicilio» (hoy los tres).
- **Folio**
  - Tipo: consecutivo sin reiniciar (como hoy), reiniciar cada día o reiniciar en cada corte.
  - Prefijo (por ejemplo «A-») y número inicial.
  - Cada taquería lleva su propia numeración (hoy hay una sola para toda la base).
- **Menú**
  - Carnes (hoy ya se editan).
  - Tipos de producto por carne (hoy fijos: taco, taco de queso, gringa, llenadora, volcán,
    costra y media costra).
  - Productos sin carne (hoy fijos: quesadilla de maíz, quesadilla de queso, volcán de queso,
    costra y media costra de queso).
  - Categorías y su orden en tickets y cocina (hoy tacos, gringas, volcanes, costras, bebidas).
  - Bebidas y existencias (hoy ya se editan) y si se descuenta inventario al vender (hoy sí).
  - Extras de empaque para llevar y domicilio (hoy fijos: verdura aparte, bolsa de verdura,
    tortillas de harina y de maíz; sus precios ya se editan).
  - Preparaciones (hoy fijas: con todo, natural, con cilantro, con cebolla).
  - Precios y productos ocultos (hoy ya se editan).
- **Ticket de cocina**
  - Contraer los nombres: no abreviar, abreviar solo los productos (como hoy) o abreviar
    productos y carnes (por ejemplo «T Pas.»).
  - Diccionario de abreviaturas editable (hoy T, T queso, G, Llen., V, C, ½C, Quesa, Tort.).
  - Mostrar o no el conteo de tacos (hoy sí).
  - Papel por defecto de 58 u 80 mm (hoy 58; cada dispositivo puede cambiarlo).
- **Ticket de cuenta**
  - Mensaje al pie (hoy «¡Gracias por su visita!»).
  - Mostrar o no el precio unitario (hoy sí, cuando hay más de una pieza).
  - Datos del negocio en el encabezado.
- **Cobros**
  - Métodos de pago activos (hoy efectivo, tarjeta y transferencia).
  - Propinas sugeridas (hoy 10 % y 15 %, más una cantidad libre).
  - Montos rápidos de efectivo (hoy el exacto y los billetes que lo cubren).
  - «Liberar la mesa al cobrar» marcado o no por defecto (hoy marcado).
- **Reglas de mesa**
  - No liberar una mesa sin cobrarla (hoy activa).
  - Permitir «Cerrar sin cobro» con PIN de administrador y motivo (hoy activo).
- **Estatus del pedido:** cuándo pasa a «Recibido» (hoy en cuanto aparece en la pantalla de
  cocina; la otra opción es un botón en cocina).
- **Cocina**
  - Modo de la cocina: impresora o monitor, y si en modo monitor también se imprime la comanda
    (hoy ya se configura en Administración → Cocina; por defecto impresora).
  - Minutos para marcar la espera (hoy 10 y 20).
  - Una sola cocina activa a la vez (hoy sí).
  - Auto-imprimir los pedidos nuevos y los avisos (hoy se eligen en cada dispositivo).
- **Corte**
  - Quién puede hacerlo (hoy cocinero o administrador, siempre con PIN de administrador).
  - Compartir el resumen por WhatsApp (hoy disponible).
- **Domicilio:** días para anonimizar direcciones y teléfonos (hoy 90).
- **Seguridad**
  - Largo del PIN (hoy de 4 a 8 dígitos).
  - Intentos antes del bloqueo (hoy 5 por usuario y 30 por conexión).
  - Duración de la sesión (hoy 14 horas sin uso y 3 días como máximo).
- **Permisos por rol:** qué secciones ve y edita cada rol (hoy fijos para mesero, cocinero y
  administrador).

Además dejan de ser compartidos y pasan a ser de cada taquería: la cocina activa y el canal de
tiempo real (hoy todas las taquerías escucharían el mismo canal).

### 3. Registro y dispositivos

Registro con Google o correo, alta de la taquería y vinculación de dispositivos.

### 4. Menú configurable

El catálogo de hoy asume carnes combinadas con taco, gringa, volcán y costra; otra taquería
puede vender otras cosas.

### 5. Pruebas y ambiente de pruebas

Pruebas de aislamiento entre taquerías y un Supabase de pruebas.

### 6. Suscripción y respaldos

Cobro de la suscripción (Stripe o Mercado Pago) y una forma de exportar los datos de un
cliente. Restaurar un respaldo regresa la base completa, y eso afectaría a todos.

### 7. La Tequería como primer cliente

Pasar La Tequería como la primera taquería del sistema, sin perder datos.

## Antes de cobrar

Las condiciones de los planes son aproximadas; hay que revisar las vigentes.

- El plan gratis de Vercel no permite uso comercial: hace falta Vercel Pro.
- El plan gratis de Supabase pausa los proyectos inactivos y no incluye respaldos: para clientes
  hace falta Pro.
- La app guarda teléfonos y direcciones de los pedidos a domicilio. Hacen falta aviso de
  privacidad y términos de servicio, conforme a la ley de protección de datos personales.

## Cuándo sí conviene la opción 2

Si solo habrá 2 o 3 clientes, o si una cadena exige sus datos en su propia cuenta. Aun así: un
solo repositorio, con la configuración de cada cliente en variables, sin copias.
