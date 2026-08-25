# Protocolo de decisión resistente al sesgo

Cómo ModelHub convierte una propuesta en una decisión. Aplica a fuentes nuevas, controles
antisesgo, cambios de metodología y cambios de producto que tocan números publicados.

Existe porque el proyecto ya tiene una norma —*mide el antes y el después, no argumentes
plausibilidad*— pero esa norma se aplica al **código**, no a las **propuestas**. Un plan mal
filtrado produce código impecable que implementa la idea equivocada.

---

## Etapa 0 — Declaración de posición del evaluador

Antes de leer una propuesta, quien evalúa escribe sus incentivos estructurales. No para
disculparse: para que el lector pueda descontarlos.

### Declaración de quien escribió este documento

Mantengo ModelHub yo solo. No puedo evaluar una propuesta desde un punto neutral; decir que sí
lo logré sería el primer sesgo. Lo que sí puedo hacer es enumerar de dónde tira mi posición y
poner un contrapeso procedimental a cada tirón. Los seis que aplican aquí:

| Sesgo | De dónde viene | Contrapeso en este protocolo |
|---|---|---|
| **Apego a lo construido** | Refactorizar lo propio duele más que añadir algo nuevo encima. Tocar una función que ya funciona se siente como riesgo gratuito. | Etapa 4: la opción nula compite con puntaje. |
| **Producir por producir** | Una feature nueva se ve como avance; no tocar código que ya funciona no se ve como nada, aunque sea la decisión correcta. | Etapa 4: la opción nula compite con puntaje. |
| **Prestigio anglófono** | La bibliografía de referencia de este campo está casi toda en inglés. *Stanford*, *Berkeley*, *NVIDIA* me suenan a rigor; *Barcelona Supercomputing Center* me suena a desconocido. Eso es un artefacto de qué he leído, no una diferencia de evidencia. | Etapa 2: enmascarado de prestigio. |
| **Sofisticación** | Z-score, sigmoide, SHA-256, frontera de Pareto *leen* como rigor. La complejidad se confunde con la corrección. | Etapa 3: prueba del delta medido. Lo complejo que no mueve un número medido no entra. |
| **Falso balance** | Ante dos propuestas, me empuja a tratarlas como igual de válidas y sintetizarlas. No siempre lo son. | Etapa 1: cada documento se puntúa por su tasa de verificación, no por su tono. |
| **Cansancio** | Un proyecto de una sola persona rechaza menos en la semana catorce que en la semana uno. | Etapa 5: cuota de rechazo obligatoria. |

Un equipo evaluando esto en lugar de una persona sola escribiría otra tabla: política interna,
reputación ante colaboradores, presión de plazos compartidos. El formato es el mismo; el
contenido cambia según quién evalúe.

---

## Etapa 1 — Separación entre hecho y afirmación

Cada aseveración de una propuesta se etiqueta antes de discutirla:

- **VERIFICADO** — se ejecutó una comprobación y está el resultado. Se cita el comando y la
  salida.
- **VERIFICABLE** — se puede comprobar hoy con una petición HTTP o un script; nadie lo ha
  hecho.
- **NO VERIFICABLE** — predicción, preferencia estética o juicio de valor.

Regla dura: **ninguna propuesta pasa de la Etapa 3 apoyada en premisas VERIFICABLES sin
verificar.** No se rechaza — se degrada a *tarea de verificación*, que es trabajo real con
salida real, y vuelve a entrar cuando la premisa esté resuelta.

Un documento se caracteriza por su tasa de verificación, no por su seguridad retórica. Declarar
imparcialidad no es un método; ejecutar una comprobación sí.

---

## Etapa 2 — Enmascarado de prestigio

Antes de puntuar, se reescribe cada propuesta quitando:

- El nombre de la institución que produce la fuente.
- El nombre o el estilo del autor de la propuesta.
- Los adjetivos de calidad ("riguroso", "máxima resistencia", "el referente").

Queda solo la mecánica: qué endpoint, qué licencia, qué cadencia observada, qué categoría
alimenta, qué pasa si falla. Se puntúa esa versión. Se desenmascara **después**.

Esto ataca dos sesgos a la vez: el prestigio institucional y la **mímesis de registro** —una
propuesta escrita en el mismo dialecto que las notas del proyecto se siente verificada aunque
ella misma declare que no lo está.

---

## Etapa 3 — Prueba del delta medido

Si la propuesta cambia un número publicado, se implementa en una rama de medición y se reporta:

1. La métrica exacta.
2. El estado limpio anterior.
3. El estado posterior.
4. Cuántos modelos se mueven y cuánto.

Sin esas cuatro cifras, no hay decisión que tomar. Es la norma que ya usó el proyecto para el
filtro de LMArena (0.80 puntos de deriva frente a 11.94 de las alternativas); aquí solo se
convierte en puerta obligatoria en lugar de buena costumbre.

**Corolario que se olvida siempre:** medir también sirve para *rechazar*. Un cambio que mueve
16 de 44 modelos y no puede demostrar que la posición nueva es más correcta que la vieja está
peor que antes, no mejor: introdujo movimiento sin introducir verdad.

---

## Etapa 4 — La opción nula compite

"No hacer nada" se puntúa en la misma rúbrica que las demás opciones. Una propuesta no gana por
ser positiva; gana por **superar a no hacerla**, contando el mantenimiento que crea.

En un proyecto cuya restricción R8 es *sin mantenimiento humano diario*, cada control nuevo es
una deuda recurrente. Un control que exige revisión trimestral no cuesta cero: cuesta una
revisión trimestral para siempre.

---

## Etapa 5 — Cuota de rechazo

**Al menos un tercio de los ítems evaluados debe terminar en rechazado o diferido**, y el
motivo se escribe.

No es una cuota arbitraria: es un detector de que hubo filtrado. Una revisión que aprueba todo
no filtró nada, solo reordenó. Si al final del proceso la cuota no se alcanza de forma natural,
la revisión se repite con la sospecha de que se está siendo complaciente — no se rechaza algo
al azar para cumplir el número.

---

## Etapa 6 — Prueba de inversión

Tres preguntas por ítem. Si alguna no tiene respuesta, es una preferencia disfrazada de
decisión:

1. **¿Qué observación lo probaría equivocado?** Si nada puede refutarlo, no es un control, es
   una opinión con código.
2. **¿Cómo se deshace?** Coste de revertir, en horas y en confianza del lector.
3. **¿Lo aprobaría si no involucrara un LLM / si viniera de una institución que no conozco /
   si lo hubiera propuesto la otra parte?** La pregunta de simetría.

---

## Etapa 7 — Prueba de daño asimétrico

Se responde: **si esto está mal, ¿quién paga?**

Escala de severidad, de menor a mayor:

1. El proyecto queda feo. *(Barato.)*
2. El lector se confunde y lo corrige leyendo `/methodology`. *(Aceptable.)*
3. Un modelo aparece mejor o peor de lo que la evidencia sostiene. *(Caro: es la tesis del
   proyecto.)*
4. **El sitio publica una afirmación sobre un tercero identificable que la evidencia no
   sostiene.** *(Inaceptable.)*

Cualquier ítem que pueda alcanzar el nivel 4 necesita evidencia de un orden superior al resto,
y por defecto se rechaza. Un indicador automático que etiqueta a un proveedor con una conducta
—degradación silenciosa, publicidad engañosa— es una acusación pública generada por un umbral.
El umbral tiene que ser mucho mejor que "suena razonable".

---

## Etapa 8 — Registro de lo rechazado

Lo rechazado se publica con la misma visibilidad que lo aceptado, con su motivo y su fecha.

Las omisiones también son decisiones metodológicas. Un proyecto que solo muestra lo que
incluyó está ocultando la mitad de su metodología, y es exactamente la opacidad que ModelHub
le reprocha a los demás.

---

## Rúbrica

Cada ítem se puntúa en seis ejes. Los tres primeros suman, los tres últimos restan.

| Eje | −3 | 0 | +3 |
|---|---|---|---|
| **Evidencia de la premisa** | premisa falsa, verificada | verificable, sin verificar | verificada con salida citada |
| **Delta medido** | mueve números sin medición | no mueve números | mueve números con antes/después |
| **Alineación con la tesis** | pide confiar en el sitio | neutral | permite comprobar el sitio |
| **Coste recurrente (R8)** | revisión humana periódica | trabajo único | reduce trabajo humano |
| **Reversibilidad** | rompe el histórico | reversible con esfuerzo | reversible en un commit |
| **Daño si es incorrecto** | severidad 4 | severidad 2 | severidad 1 |

**Umbrales:**

- Suma ≥ +6 y ningún eje en −3 → **aceptar**.
- Suma ≥ +3 → **aceptar tras resolver el eje más bajo**.
- Cualquier eje en −3 → **rechazar o degradar a tarea de verificación**, sin importar la suma.

Ese último renglón es el que hace trabajo. Impide que una idea atractiva compre su entrada
acumulando puntos en los ejes fáciles.

---

## Límites conocidos de este protocolo

Se escriben aquí para que no haya que descubrirlos:

- **No corrige el sesgo de encuadre.** Solo evalúa lo que alguien propuso. Si nadie propone
  medir calidad en español, el protocolo no lo echa de menos. Contrapeso parcial: la Etapa 8
  vuelve visibles las ausencias, pero solo las que alguien nombró alguna vez.
- **La cuota de rechazo se puede gamificar** rechazando ítems triviales para proteger los
  caros. Solo lo detecta una segunda lectura.
- **El enmascarado de prestigio es imperfecto**: una fuente conocida se reconoce por su
  esquema aunque se le quite el nombre.
- **La rúbrica da falsa precisión.** Los números son ordinales, no métricas. Sirven para forzar
  la comparación entre ejes, no para promediarse en serio.
