# Plan de Fase 5 — evaluado con el protocolo de decisión

Aplica [`METODOLOGIA-DECISIONES.md`](METODOLOGIA-DECISIONES.md) a los dos documentos de
propuestas. Ningún ítem entra aquí por sonar bien: entra con su premisa verificada y su delta
medido, o entra degradado a tarea de verificación.

Fecha de las mediciones: **2026-08-03**, contra el estado limpio de `/data` de ese día
(56 modelos, 44 rankeados, snapshots epoch 2026-08-03 · livebench 2026-06-25 · lmarena
2026-08-02).

---

## Parte A — Etapa 1: qué resultó cierto al comprobarlo

Se ejecutaron peticiones reales contra las tres fuentes y scripts sobre `/data`. Resultados:

| # | Afirmación evaluada | Estado | Medición |
|---|---|---|---|
| 1 | Epoch publica `stderr` por fila | **VERIFICADO — cierto** | 100 % de cobertura en las filas que ModelHub usa (release ≥ 2025‑06‑01). Mediana por benchmark: 0.41 a 2.59 puntos porcentuales |
| 2 | LMArena publica intervalos de confianza | **VERIFICADO — cierto** | `rating_lower`, `rating_upper`, `variance` presentes y poblados en el snapshot 2026‑08‑02 |
| 3 | Min‑max comprime y distorsiona la distribución relativa | **VERIFICADO — falso** | Min‑max es una transformación afín: preserva el orden. Simulación con cohorte alterada: orden de arena idéntico (`True`) |
| 4 | Min‑max es frágil ante la cohorte | **VERIFICADO — cierto, pero por otra razón** | Un modelo nuevo 60 puntos por encima del mejor mueve el valor normalizado 16.03 pts de media (24.29 el peor) → **2.40 pts de composite de media, 3.64 el peor** |
| 5 | LiveBench publica coste por evaluación | **VERIFICADO — falso** | Columnas reales del CSV: solo `model` y 23 tareas. No hay ninguna columna de coste, precio ni tokens |
| 6 | Se puede estimar VRAM con los datos actuales | **VERIFICADO — falso** | 0 de 56 modelos llevan `params_billions`, `pricing` o `context_window` en `/data`. Además solo 13 de 56 son de pesos abiertos |
| 7 | Hay degradación de checkpoint detectable al 3 % | **VERIFICADO — falso** | 65 snapshots, 7 meses, 52 modelos: caída máxima observada **1.87 %**, mediana 0.27 %, **cero** modelos superan el 2 %. Y `history.jsonl` solo contiene `lmarena_text_overall`: no existe histórico de composite que analizar |
| 8 | La densidad de evidencia varía entre modelos | **VERIFICADO — cierto** | De 4 a 9 benchmarks por modelo rankeado. 22 pares adyacentes separados por <2 pts difieren en ≥2 benchmarks de evidencia |
| 9 | Scale Labs es integrable ya | **VERIFICADO — ya adjudicado** | `config/sources.json` lo tiene como `candidate_v1_1`, solo scrape HTML, términos `unverified` desde 2026‑07‑27 |

### El hecho que ninguno de los dos documentos contiene

**La mediana de separación entre modelos vecinos es de 0.43 puntos de composite.**

- 32 de 43 pares adyacentes están separados por menos de 1.00 punto.
- 23 de 43 lo están por menos de 0.50.
- **Dos pares están separados por exactamente 0.00 y aun así reciben rangos distintos:**
  `#5 GPT‑5.6 Sol (max)` / `#6 Muse Spark 1.1`, y `#10 Gemini 3.6 Flash (high)` /
  `#11 GPT‑5.5 Pro`.

Contra eso: la mediana de `stderr` de Epoch es de 1.51 a 2.59 puntos según el benchmark, y los
tres primeros de LMArena tienen intervalos que se solapan casi por completo
(1507.26 [1498.50, 1516.02] · 1503.17 [1499.57, 1506.78] · 1503.17 [1496.71, 1509.63]).

El sitio publica hoy un orden estricto sobre diferencias que la propia medición no distingue.
Esto reordena todo lo que sigue: no es una mejora estética, es la brecha más grande entre lo
que ModelHub promete y lo que hace.

Y no es una idea nueva del proyecto. `SOURCES.md:48` ya dice que `stderr` y los logs públicos
significan que *«los scores llegan con incertidumbre y un rastro de reproducibilidad
adjunto»* — y el ingest la descarta. **Es una promesa documentada y no cobrada**, no una
feature.

### El defecto que tampoco contiene ninguno

**27 de 56 modelos toman su `human_preference` de una configuración distinta a la que
describen sus benchmarks.**

`composite.py:83` dice explícitamente por qué la política de variantes elige *una etiqueta para
todo el modelo*: tomar el máximo por benchmark produciría «una configuración que nadie
ejecuta». Pero `lmarena.py:161` selecciona la fila de arena con
`row["rating"] > best[key]["rating"]` — es decir, política *best*, la que
`config/weights.json` deliberadamente **no** eligió.

Resultado, medido:

| Modelo | Benchmarks describen | Arena aporta |
|---|---|---|
| Claude Fable 5 | `max` | `claude-fable-5` (plain) |
| Claude Opus 4.6 | `high` | `claude-opus-4-6-thinking` |
| Gemini 3.1 Pro | `high` | `gemini-3.1-pro-preview` |
| Claude Sonnet 5 | `xhigh` | `claude-sonnet-5-high` |

Con la escala actual (1320.28–1507.26), una diferencia de **7 puntos de rating entre variantes
vale 0.56 puntos de composite** — ya por encima de la mediana de separación entre vecinos
(0.43). Es el Frankenstein que la política existe para impedir, entrando por el 15 % del peso
que la política no cubre.

No afirmo que los 27 casos sean erróneos: algunos sufijos (`-thinking`, `-preview`) pueden ser
la misma configuración con otro nombre. Afirmo algo más incómodo: **hoy nadie puede
distinguirlo, y el sitio no lo declara.**

---

## Parte B — Etapa 2: los dos documentos, desenmascarados

### `propuestas.md`

**Calidad: alta.** Es el mejor de los dos por un margen amplio, y por la razón correcta:
etiqueta lo que no verificó. Su §4.4 —*«todas estas propuestas están escritas por una sola voz
en un momento concreto»*— es genuinamente la mejor línea de los dos documentos.

**Sesgos detectados:**

1. **Mímesis de registro.** Está escrito en el dialecto exacto de `CLAUDE.md`: mismas
   estructuras, mismo tipo de nota al margen, mismo tono de norma ganada a golpes. Eso hace
   que *se sienta* verificado aunque él mismo declare que no lo está. Es el sesgo que más me
   afectó a mí al leerlo, y es la razón de que la Etapa 2 del protocolo exista.
2. **Volumen como sustituto de decisión.** 42 ítems sin priorizar y sin rechazar ninguno
   propio. Una agenda de 42 ítems para un proyecto de una persona no es un plan: es un menú.
   La única lista de exclusión (§1.12) es de fuentes ajenas, no de propuestas propias.
3. **Proliferación de gobernanza.** §3.8, §3.13, §3.14 y §3.15 añaden plantillas, políticas y
   guías a un proyecto cuya restricción R8 es *sin mantenimiento humano diario*. §3.15 es
   autocontradictorio: propone medir en minutos el coste humano de cada decisión, lo que
   **crea** el mantenimiento humano que dice vigilar.
4. **Un error de hecho:** §3.3 propone la vista de coste «usando `cost` de LiveBench y
   SWE-bench». Esa columna no existe (verificado, punto 5 de la tabla).
5. **Un coste sobreestimado:** §2.3 advierte que el cálculo O(N×B) «puede ser costoso al
   build». Son 56 modelos × 10 benchmarks. Es instantáneo. La cautela está bien calibrada como
   hábito y mal calibrada en este caso concreto.

### `propuestas2.md`

**Calidad: desigual.** Contiene la mejor idea de producto de los dos documentos y también el
único ítem que clasifico como inaceptable.

**Sesgos detectados:**

1. **Declarar imparcialidad en lugar de demostrarla.** Abre con una «Declaración de Principios
   e Imparcialidad» y no ejecuta una sola verificación. La declaración *ocupa el lugar* del
   método. Un documento que empieza afirmando su propia neutralidad merece más escrutinio, no
   menos.
2. **Sesgo de sofisticación.** Z‑score, sigmoide, SHA‑256, frontera de Pareto, gráficos
   radiales. Leen como rigor. El ítem estadístico central (§1.3) es **incorrecto en su
   premisa**: min‑max es afín y por tanto preserva el orden; no «comprime la distribución
   relativa». Y el reemplazo propuesto no arregla el problema real —la media y la desviación
   dependen de la cohorte exactamente igual que el mínimo y el máximo— mientras añade una
   sigmoide que **sí** distorsiona, comprimiendo justo la cabeza de la tabla, que es donde el
   lector mira. Medido: mueve 16 de 44 modelos, 2 de ellos ≥3 posiciones, con 2.27 puntos de
   deriva media y ninguna evidencia de que la posición nueva sea más correcta.
3. **No dialoga con lo ya decidido.** Pone Scale Labs como primer ítem de su Fase 3 sin
   mencionar que el repositorio lo tiene deferido desde 2026‑07‑27 con los términos sin
   verificar. Propone OpenCompass por «equilibrio geográfico» mientras el otro documento lo
   excluye por licencia y estabilidad no verificadas — los dos documentos se contradicen
   frontalmente y eso hay que **adjudicarlo**, no promediarlo.
4. **Equilibrio geográfico afirmado, no medido.** Propone añadir una fuente china para
   contrapesar el sesgo anglosajón, sin medir antes el sesgo. Añadir una fuente con otro sesgo
   no cancela el primero: superpone dos. `propuestas.md` §2.8 lo resuelve mucho mejor —
   *mostrar* el desbalance con la columna `Country` que ya está en los datos, y dejar que el
   lector lo pondere.
5. **Sobrealcance causal, con daño de severidad 4.** §3.3 propone marcar con la insignia
   «Posible Degradación de Checkpoint» a todo modelo que caiga 3 % sin cambio de versión. Es
   una **acusación pública contra un proveedor identificable, generada por un umbral**. Y está
   invertida: la caída máxima real observada en 7 meses es de 1.87 % —nunca dispararía por la
   causa que dice detectar— mientras que la recalibración de cohorte que medí mueve el
   composite entre 2.40 y 5.86 puntos, es decir, **sí dispararía por un artefacto de medición
   nuestro**. Un detector que solo puede activarse por la causa equivocada no es un detector.

**Lo bueno, y es genuino:**

- **§3.1, el auditor de alias, es la mejor idea de los dos documentos y no está en el otro.**
  `data/aliases.json` ya existe y no se expone en ninguna parte. 29 de 56 modelos tienen más de
  un alias. Un emparejamiento erróneo atribuye scores al modelo equivocado, que es el fallo
  silencioso más grave del pipeline, y hoy es invisible.
- **§3.2, los hashes SHA‑256**, son baratos, no mueven ningún número y convierten «confía en
  nuestro ingest» en «compruébalo».
- **§4.1, el estimador de VRAM**, es la única propuesta de los dos documentos escrita pensando
  en el estudiante de ESCOM en vez de en el metodólogo. Le falta la fuente de datos, no la
  intuición.

### Adjudicación entre ambos

`propuestas.md` es más fiable en método; `propuestas2.md` aporta tres ítems que aquél no tiene.
No se sintetizan: se toman por separado los ítems que pasan la rúbrica y se rechazan por
nombre los que no.

---

## Parte C — El plan

Cinco bloques. Cada uno con criterio de aceptación medible. Ninguno depende de una fuente
nueva; los bloques 1 a 4 se construyen sobre datos que ya se descargan y se tiran.

### Bloque 0 — Reconciliar la política de variantes *(prerrequisito, no negociable)*

**Por qué va primero:** poner barras de error sobre `human_preference` sin resolver esto sería
publicar la incertidumbre de una cifra cuya procedencia es inconsistente. Se arregla la
coherencia antes de decorarla.

- **0.1** — `lmarena.py` deja de colapsar por `rating` máximo y expone todas las variantes por
  clave canónica.
- **0.2** — `composite.py` selecciona la fila de arena cuya `effort_label` coincide con el
  `chosen_label` del modelo. Si no existe, se declara: el modelo queda con `human_preference`
  de otra configuración **y lo dice en la ficha**, o se deja ausente y baja la cobertura. Cuál
  de las dos es una decisión de metodología, y se toma con el delta medido en la mano.
- **0.3** — `/methodology` documenta que la política de variantes cubre también el eje de
  preferencia humana.

**Criterio de aceptación:** reporte con el antes y el después de los 27 modelos afectados —
cuántos cambian de `human_preference`, cuántos cambian de rango, deriva media de composite.
Si la deriva es despreciable, el hallazgo se documenta y el código se simplifica igual: la
coherencia no depende de que el error sea grande.

---

### Bloque 1 — Cobrar la incertidumbre ya documentada

**Evidencia que lo justifica:** mediana de separación 0.43 pts contra `stderr` mediano de 1.51
a 2.59 pts; dos pares con separación exactamente 0.00 recibiendo rangos distintos.

- **1.1** — El ingest conserva `stderr` de Epoch y `rating_lower`/`rating_upper`/`variance` de
  LMArena en `scores.json`. Solo esquema, sin UI: primero existe el dato, después se decide
  cómo se muestra.
- **1.2** — `composite.py` propaga la incertidumbre al composite. La fórmula y sus supuestos
  van a `/methodology` **antes** de que el número aparezca en la home. El supuesto de
  independencia entre fuentes que miden la misma capacidad se declara como lo que es: un
  supuesto que subestima el intervalo real.
- **1.3** — Regla de empate estadístico: cuando los intervalos de dos modelos vecinos se
  solapan, comparten posición y se marcan como empatados. **El rango deja de ser una promesa
  que la medición no puede sostener.**
- **1.4** — La ficha del modelo muestra `valor ± error` por score.

**Criterio de aceptación:** cuántos de los 43 pares adyacentes actuales resultan empates
estadísticos, publicado en `/methodology`. Predicción a contrastar: más de la mitad. Si sale
menos de un tercio, el bloque estaba mal fundamentado y hay que revisarlo.

**Riesgo declarado:** un ranking con empates masivos es menos vistoso. Es exactamente el precio
que el proyecto dice estar dispuesto a pagar.

---

### Bloque 2 — Hacer visible el acoplamiento de cohorte *(sin tocar el normalizador)*

**Evidencia:** un modelo nuevo en la cohorte mueve el composite ajeno 2.40 pts de media y 3.64
el peor caso, con la mediana de separación en 0.43. Un modelo puede perder posiciones sin que
su rating haya cambiado.

- **2.1** — El ingest registra por modelo el delta de arena **crudo** y el **normalizado** por
  separado.
- **2.2** — Cuando el normalizado se mueve y el crudo no, la ficha lo dice: *recalibración de
  cohorte, no cambio de medición*.
- **2.3** — `/methodology` explica que la normalización min‑max acopla a cada modelo con la
  cohorte de su build, con las cifras medidas aquí.

**No se cambia el normalizador.** Ni a z‑score ni a sigmoide: medido, mueve 16 de 44 modelos
sin poder demostrar que la posición nueva sea mejor. Si algún día se quiere desacoplar de
verdad, la vía es un **ancla fija** (puntos de referencia constantes entre builds), que ninguno
de los dos documentos propone y que exige su propio estudio.

**Criterio de aceptación:** simular la entrada de un modelo frontera y verificar que el aviso
se dispara para los afectados y para nadie más.

---

### Bloque 3 — Auditoría de identidad y de integridad

Coste bajo, ningún número movido, y ataca el fallo más grave del pipeline.

- **3.1** — Ruta `/aliases`: por cada `model_id` canónico, las claves exactas que emparejaron
  en Epoch, LiveBench y LMArena, y la variante elegida. Los 29 modelos con más de un alias
  dejan de ser invisibles. *(De `propuestas2.md` §3.1.)*
- **3.2** — Botón de reporte de emparejamiento erróneo que abre un issue pre-rellenado.
- **3.3** — `SHA‑256` de cada payload crudo descargado, escrito en `status.json` con su
  timestamp; en el pie, versión del build y enlace al commit. *(De `propuestas2.md` §3.2.)*

**Criterio de aceptación:** cualquier lector puede recalcular un hash desde la fuente original
y compararlo, sin salir del sitio.

---

### Bloque 4 — Calidad de la evidencia, y las guardas visibles

- **4.1** — Densidad de verificación: cuántas fuentes independientes sostienen cada composite,
  junto al medidor de cobertura y **claramente distinta de él**. *(De `propuestas.md` §2.4;
  medido: rango real de 4 a 9 benchmarks, 22 pares adyacentes con evidencia dispar.)*
- **4.2** — `status.json` ya tiene `rejected_snapshots` y hoy nadie lo ve. Renderizarlo en
  `/methodology#rejections`: fuente, ratio observado, umbral, snapshot usado en su lugar.
  *(De `propuestas.md` §2.9.)* Es el ítem más barato del plan: el dato ya se escribe.
- **4.3** — Recalibrar `expected_cadence_days` de LiveBench. Declara 30 días; los snapshots
  reales saltan de 2026‑01‑08 a 2026‑06‑25 —168 días— y el sistema marca «fresh» a los 39 días
  de antigüedad actuales. Una alarma mal calibrada es una alarma apagada.

---

### Bloque 5 — El diferenciador en español *(tarea de verificación, no de implementación)*

`propuestas.md` §1.5 tiene razón en el fondo: ningún leaderboard mainstream mide calidad en
español, ModelHub tampoco, y es el único eje donde este proyecto puede ser el mejor del mundo
en vez de uno más.

Va como **tarea de verificación** porque su premisa está sin verificar y el propio documento lo
admite: no está confirmado qué iniciativa sigue viva ni si exporta datos legibles por máquina.

- **5.1** — Comprobar con peticiones HTTP reales qué evaluación en español está activa hoy,
  bajo qué licencia y con qué cobertura de modelos frontera.
- **5.2** — Con esos datos, decidir. Si la cobertura resulta sesgada hacia modelos abiertos
  regionales, se rotula con la cobertura efectiva (*«evaluados N de M modelos del ranking
  general»*) o no se publica.
- **5.3** — Si entra, entra como **track separado**, nunca en el composite. Meterlo dentro
  penalizaría a modelos que simplemente no se entrenaron para español, que es el mismo sesgo
  que el proyecto combate.

**Aquí aplico mi propia declaración de posición:** mi entrenamiento hace que HELM o BFCL me
suenen más sólidos que una iniciativa del BSC. Esa diferencia es de familiaridad, no de
evidencia. Enmascarando ambas y comparando solo endpoint, licencia, cadencia y cobertura, la
evaluación en español es la que tiene mayor valor marginal para **este** proyecto: es la única
que ninguna alternativa le ofrece a su audiencia.

---

## Parte D — Etapa 5: rechazado y diferido

Cuota de rechazo alcanzada: **12 de 27 ítems evaluados** no entran. Se publican con motivo,
según la Etapa 8.

| Ítem | Origen | Decisión | Motivo |
|---|---|---|---|
| Z‑score + sigmoide | p2 §1.3 | **Rechazado** | Premisa falsa (min‑max es afín). Mueve 16 de 44 modelos, 2.27 pts de deriva media, sin demostrar mayor corrección. Etapa 3 |
| Insignia de degradación de checkpoint | p2 §3.3 | **Rechazado** | Daño severidad 4. Detector invertido: máximo real 1.87 %, cero modelos sobre 2 %; dispararía por recalibración propia (2.40–5.86 pts). Además `history.jsonl` solo tiene un benchmark. Etapa 7 |
| Vista de coste / frontera de Pareto | p §3.3, p2 §4.2 | **Diferido** | La columna de coste no existe en LiveBench (verificado). El precio solo existe en páginas de proveedor, luego es `vendor_claim` y no puede puntuar |
| Estimador de VRAM | p2 §4.1 | **Degradado a verificación** | Buena idea, sin datos: 0 de 56 modelos llevan parámetros. Requiere fuente nueva y aplica a 13 de 56 modelos. Primero la fuente, después la fórmula |
| Gráficos radiales en Compare | p2 §4.3 | **Rechazado** | Choca con la regla ya escrita: identidad por posición y etiqueta, no por tono. Con 5 ejes y todos los modelos entre 70 y 95, el área del polígono la decide el orden de los ejes, no el modelo |
| Factor de atenuación por contaminación | p2 §1.2 | **Rechazado como ponderación** | Atenuar un score por riesgo estimado es fabricar un número. Sobrevive la mitad buena: el **registro** de contaminación por benchmark (p §2.7), que informa sin alterar cifras |
| OpenCompass | p2 §2 | **Rechazado por ahora** | Licencia y estabilidad sin verificar; los dos documentos se contradicen. El desbalance geográfico se **muestra** (p §2.8, columna `Country` ya disponible), no se compensa apilando sesgos |
| Scale Labs / SEAL | p2 §2 | **Diferido — ya adjudicado** | `sources.json` lo marca `candidate_v1_1`, solo scrape HTML, términos `unverified`. Reabrirlo exige leer los términos, no reproponerlo |
| HELM, BFCL, MixEval, GAIA | p §1.1–1.4 | **Diferido** | Todos con endpoint y licencia sin verificar por su propio autor. Ninguno pasa la Etapa 1 hasta que alguien ejecute las peticiones |
| Métrica de coste humano por decisión | p §3.15 | **Rechazado** | Crea el mantenimiento humano que pretende vigilar. Contradice R8 |
| Plantillas de corrección, política de retiro, guía de pesos | p §3.8, §3.13, §3.14 | **Diferido** | Gobernanza para un volumen de colaboración que aún no existe. Se escriben cuando llegue el primer PR externo que las necesite, no antes |
| Presets de pesos y calculadora | p §2.2, §3.2 | **Diferido tras el Bloque 1** | Buena idea, orden equivocado. Dejar ajustar pesos sobre un ranking cuyos empates aún no se declaran enseña a distinguir modelos que la medición no distingue |

---

## Parte E — Lo que este plan no cubre

Etapa 8, y límite conocido del protocolo: solo evalúa lo que alguien propuso.

- **Ninguno de los dos documentos propuso nada sobre accesibilidad**, que es literalmente lo que
  la Fase 5 declara en `CLAUDE.md` («community hardening, a11y, performance»). Los dos
  documentos redefinieron la fase hacia lo que a sus autores les interesaba. Yo tampoco lo
  detecté hasta releer el estado de fases — anotarlo es más honesto que corregirlo en
  silencio.
- **Ninguno propuso reducir nada.** 42 y 15 ítems, todos aditivos. Un proyecto de una persona
  con R8 debería preguntarse también qué quitar.
- **Nadie fuera del ecosistema anglófono ha revisado esta lista**, y quien la escribe está
  entrenado mayoritariamente en ese ecosistema. `propuestas.md` §4.4 pide esa revisión externa;
  sigue pendiente y este documento no la sustituye.

---

## Orden de ejecución

```
Bloque 0  →  Bloque 1  →  Bloque 2
   (coherencia)  (incertidumbre)  (cohorte)
                      ↓
              Bloque 3 + Bloque 4   ← independientes, en paralelo
                      ↓
                  Bloque 5          ← verificación primero
```

Los bloques 3 y 4 no dependen de los anteriores y podrían adelantarse si se busca una entrega
visible pronto. Los bloques 0, 1 y 2 son secuenciales: cada uno hace falsa la premisa del
siguiente si se salta.

**Cada bloque cierra con la misma frase o no cierra:** la métrica, el antes y el después.

---

## Parte F — Resultados de la ejecución (2026-08-03)

Los cinco bloques están implementados. Esto es lo que la medición dijo, incluido dónde
contradijo al plan.

### Bloque 0 — el plan proponía la regla equivocada

El plan daba dos opciones para cuando LMArena no publica la configuración elegida y decía que
se resolvería «con el delta medido en la mano». Medido:

| Opción | human_preference perdida | Deriva media de compuesto | Cambian de rango |
|---|---|---|---|
| Dejar el hueco (opción estricta) | **21 de 43 modelos** | 1.92 pts | 38 de 56 |
| Arena con voto completo en la elección | 0 | 1.35 pts | 37 de 56 |
| **Arena como desempate + divulgar** | **0** | **0.29 pts** | **17 de 56** |

La opción estricta era la que más se parecía a la regla existente y resultó demasiado cara: los
vocabularios no son conmensurables —Epoch etiqueta esfuerzo, Arena publica un nombre simple—,
así que una ausencia de coincidencia suele ser nomenclatura, no configuración distinta.

Dar a Arena voto completo también falló, y con una lección concreta: **una sola fila de Arena
volteaba etiquetas que cuatro benchmarks ya sostenían**. Claude Opus 4.6 perdía todos sus
scores de LiveBench y 17.88 puntos de compuesto. Por eso Arena desempata pero no vota.

Lo que sí murió en todos los casos: elegir la fila de Arena por rating máximo. Eso era la
política «best» aplicada en silencio al 15 % del peso. Al quitarla, **6 modelos cedieron 11.6
puntos de rating de media, 22.7 el peor**. Top-3 intacto; 24 de 57 modelos declaran ahora la
discrepancia de configuración.

**Efecto secundario que hubo que resolver:** al cambiar la variante puntuada, el histórico
existente mezclaría dos series distintas. `merge_history` ahora reinicia la serie cuando la
variante cambia, en vez de empalmar. Resultado: 2206 puntos, **cero series con variantes
mezcladas**.

### Bloque 1 — la predicción se cumplió y se quedó corta

Predije «más de la mitad» de los 43 pares adyacentes como empates estadísticos. Real:
**33 de 43 (77 %)**. De 44 modelos rankeados quedan **25 rangos distintos**. Las dos parejas
que estaban a 0.00 y recibían números distintos ahora comparten el #4.

Dos hallazgos que el plan no anticipaba:

- **Solo 127 de 263 entradas (48 %) llevan error publicado**, y apenas 10 de 44 modelos lo
  tienen completo. El intervalo es un piso mucho más flojo de lo que yo suponía, y por eso está
  etiquetado como piso en `/methodology` y en cada ficha.
- **Dos modelos no tienen ningún error publicado.** Mi primera implementación les ponía
  `±0.00`, que se lee como precisión perfecta cuando significa lo contrario. Ahora es `null` y
  la ficha dice que su posición es la menos defendible de la tabla.

**Defecto de UI que salió al verificar:** el rango de significancia no es monótono con el
puntaje, así que la columna corría `13, 17, 16` hacia abajo y parecía un bug. Se ordena por
rango y luego por puntaje; verificado sobre las 44 filas, sin inversiones.

### Bloque 2 — probado en ambas direcciones

- Cohorte idéntica → **0 modelos marcados**.
- Entra un modelo 60 puntos por encima del mejor → **52 de 57 marcados**, todos con delta crudo
  exactamente `+0.00` y efecto de hasta −6.09 puntos de compuesto.
- El modelo cuyo rating **sí** cambió 25 puntos de verdad → **no se marca**.

El normalizador no se tocó, como decía el plan.

### Bloque 3 — el hash se comprobó de forma independiente

Se volvió a descargar `benchmark_data.zip` desde cero y se comparó con lo publicado:
`12330e01…2a68`, 440 807 bytes, **coincide**. La página `/aliases` expone 57 modelos y 183
nombres emparejados, y marca los **20 casos** en que una misma fuente aportó más de un nombre a
la misma clave, que es donde se escondería un colapso mal hecho.

### Bloque 4 — aquí el plan estaba equivocado

El plan afirmaba que `expected_cadence_days` de LiveBench estaba mal calibrado. **No lo está.**
Medido sobre los 11 snapshots que la propia fuente publica: mediana de 35.5 días contra 30
declarados. La declaración se sostiene.

Lo que sí es cierto y el plan mezclaba con lo anterior: **el hueco más largo fue de 179 días**,
y durante ese hueco el estado degradado sí se activó a los 120. Mi primer mensaje de aviso
decía lo contrario —«el umbral nunca disparó»— y era falso, porque 179 > 120.

En vez de editar un número a mano, la cadencia declarada se contrasta ahora contra la observada
en cada corrida, y solo se disputa cuando la mediana la contradice por más del doble. La
calibración se comprueba sola.

### Bloque 5 — la verificación mató la propuesta que yo más defendí

En el plan escribí que la evaluación en español era «el único eje donde este proyecto puede ser
el mejor del mundo». La comprobación empírica dice que no con los datos que hay:

| | La Leaderboard | IberBench |
|---|---|---|
| Licencia | Apache-2.0 (verificada en Space y dataset) | Space MIT, **dataset sin licencia** |
| Último dato | 2026-02-20 | **2025-03-20** (16 meses) |
| Estado | Space en `RUNTIME_ERROR` | Space `SLEEPING` |
| **Solape con el ranking** | **0 de 57** | — |

51 modelos evaluados, 57 en ModelHub, **intersección cero**. Miden modelos abiertos regionales
de 1B a 40B —`salamandra-2b`, `flor-6.3b`, `aguila-7b`, `gemma-3-1b`—; ModelHub sigue modelos
frontera. Una columna de calidad en español estaría vacía en las 57 filas.

`iberbench.uni.lu`, la homepage que proponía `propuestas.md` §1.5, no resuelve.

Registrado en `SOURCES.md` y `config/sources.json` con la evidencia y la fecha, para que quien
vuelva a tener esta idea empiece desde la medición y no desde el entusiasmo. El hueco sigue
siendo real; llenarlo exigiría **correr** la evaluación, no ingerir la de otro, y eso choca con
R1 y R2 en vez de caber dentro.

### Lo que me equivoqué, en una lista

Por la Etapa 8: los errores propios se publican igual que los aciertos.

1. Propuse la regla estricta del Bloque 0 y la medición la descartó.
2. Afirmé que la cadencia de LiveBench estaba mal calibrada. No lo está.
3. Escribí un mensaje de aviso que decía que un umbral nunca disparó cuando sí lo hizo.
4. Mi primera versión de la incertidumbre publicaba `±0.00` para modelos sin error medido.
5. Metí prosa en inglés dentro del ingest en un proyecto bilingüe por arquitectura (R4).
6. Defendí el track de español como el ítem de mayor valor y no sobrevivió a su propia
   verificación.
7. Corrí `npm run build` con el dev server levantado, que CLAUDE.md prohíbe expresamente.
