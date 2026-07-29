# ModelHub

*[Read this in English](README.md)*

**El baremo independiente de modelos frontera.** *The independent frontier model scoreboard.*

Un ranking abierto de modelos de IA frontera — cerrados y open-weights en la misma cancha —
hecho para que se vea quién va realmente adelante sin leerlo a través del marketing de las
empresas que venden los modelos.

Cada número lleva su fuente, su fecha y cómo se midió. Lo que un proveedor afirma sobre su
propio modelo se guarda y se muestra, pero nunca cuenta para el score.

## Por qué existe

El panorama cambia cada semana, y no hay una vista limpia, bilingüe y transparente que ponga
modelos cerrados y abiertos en una sola tabla. Los leaderboards están dispersos, las cifras
publicadas por los proveedores circulan más rápido que las mediciones independientes, y
algunas fuentes envejecen sin avisar.

El Open LLM Leaderboard de HuggingFace sigue reportando su Space como `RUNNING`. Su dataset
de resultados no cambia desde marzo de 2025. Comprobarlo costó una llamada a la API, y es la
razón por la que [SOURCES.md](SOURCES.md) registra lo que cada fuente *realmente* hace y no
lo que aparenta hacer.

El mismo criterio aplica hacia adentro. Si la descripción generada para un modelo se
contradice o se sale de lo que `/data` realmente registra, se rechaza, y el sitio muestra
"descripción pendiente" en vez de rellenar el espacio. Un hueco honesto se publica; el
relleno inventado no.

ModelHub está hecho para estudiantes que quieren números, no hype.

## Cómo funciona el anti-sesgo

Está aplicado en el esquema y en el pipeline, no en un disclaimer.

- Cada score lleva etiqueta `human_eval`, `third_party_benchmark` o `vendor_claim`. **Solo
  los dos primeros alimentan el compuesto.**
- Nada se muestra sin `measured_at`. Ningún número flota sin fecha.
- A los modelos que no tienen dato en una categoría se les marca como parciales y se les
  puntúa sobre el peso realmente disponible, nunca rellenando con ceros. La tabla muestra un
  medidor de cobertura de cinco segmentos junto a cada score, para que un compuesto armado
  con tres categorías no pueda pasar por uno armado con cinco.
- **Un modelo necesita 4 de 5 categorías para siquiera ser rankeado.** Por debajo aparece en
  una sección provisional, sin puesto. Repartir el peso solo entre las categorías que un
  modelo casualmente tiene medidas lo elevaría por lo que le *falta*: un modelo poco evaluado
  con buen desempeño en dos benchmarks superaría a uno evaluado a fondo. El umbral es 4 y no
  5 para que un modelo recién salido, con los cuatro benchmarks pero todavía sin votos en
  Arena, siga rankeando, marcado como "sin voto humano aún". Se exige evidencia; ser nuevo no
  se castiga.
- Lo multimodal se mide pero se deja **fuera** del compuesto. Penalizar a un modelo de solo
  texto por una categoría en la que no compite inventaría una diferencia que no existe.
- Los pesos viven en [`config/weights.json`](config/weights.json) y son debatibles por pull
  request.

### Git como base de datos

No hay base de datos externa. La data en `/data` es la fuente de verdad, commiteada como JSON
plano. La ingesta diaria corre en GitHub Actions y commitea su salida, así que **cada cambio
en cada número es un diff auditable** y el historial de git es la serie temporal detrás de
las sparklines.

## Compuesto

| Categoría | Peso |
|---|---|
| Razonamiento | 25% |
| Código | 25% |
| Matemáticas | 20% |
| Preferencia humana (LMArena) | 15% |
| Seguimiento de instrucciones | 15% |

Los benchmarks que ya vienen en escala porcentual se usan tal cual. Las calificaciones
Bradley-Terry de LMArena se normalizan min-max sobre la cohorte presente en cada build. El
método completo vive en `/methodology`, y cada cifra es reproducible a mano desde los
archivos públicos.

## Fuentes

Las que se ingieren hoy — ver [SOURCES.md](SOURCES.md) para la auditoría completa, incluido
qué se comprobó, qué se rechazó y por qué.

| Fuente | Qué aporta | Licencia |
|---|---|---|
| [Epoch AI](https://epoch.ai/benchmarks) | Evaluaciones propias con logs públicos; flag open/cerrado; país | CC BY 4.0 |
| [LMArena](https://lmarena.ai/leaderboard) | Votación humana ciega, más el historial completo de calificaciones | CC BY 4.0 |
| [LiveBench](https://livebench.ai/) | Puntajes por tarea resistentes a contaminación | Apache-2.0 |

Excluidas a propósito: el Open LLM Leaderboard (archivado, su data congelada desde marzo de
2025), Aider Polyglot (congelado desde octubre de 2025) y swebench.com (CC-BY-NC,
incompatible con la licencia MIT de este repo).

## Cómo correrlo

```bash
npm install
npm run dev
```

Reconstruir la data desde las fuentes en vivo solo necesita Python 3 — la ingesta usa la
biblioteca estándar y nada más:

```bash
npm run ingest
```

Ese mismo comando corre a diario en GitHub Actions y commitea lo que haya cambiado. Si una
fuente no responde, la corrida igual termina: se reutiliza su último payload bueno desde
`data/cache/`, la caída queda registrada en `data/status.json`, y el sitio dice en la página
qué fuente está vieja y de cuándo son sus números. Callar la antigüedad sería su propia forma
de deshonestidad.

## Stack

Next.js 15 · React 19 · TypeScript · Tailwind v4 · next-intl · Python 3 (solo stdlib).

Hosting en el plan gratuito de Vercel, ingesta en GitHub Actions. El costo operativo es cero
por diseño, y cualquier cambio que introduzca un cobro queda fuera de alcance.

## Quién lo hizo

Un estudiante de Ciencias de la Computación en la ESCOM-IPN, como una herramienta que se usa
y no como un proyecto de clase que se califica. Esa es también la razón de que las reglas
estén aplicadas en código: un proyecto de una sola persona no puede depender de acordarse de
tener cuidado.

Las contribuciones son bienvenidas.

## Contribuir

Que alguien esté en desacuerdo con los pesos es el punto, no un problema — por eso viven en
un archivo de configuración y no en el código. Abre un pull request contra
`config/weights.json` con tu razonamiento, o un issue para sugerir un modelo o retar un
número.

Ver [CONTRIBUTING.md](CONTRIBUTING.md) para cómo retar un número, discutir los pesos o
proponer una fuente.

## Licencia

El código es [MIT](LICENSE). La data en `/data` deriva de las fuentes de arriba y conserva
sus términos; ver [NOTICE](NOTICE) para la atribución.
