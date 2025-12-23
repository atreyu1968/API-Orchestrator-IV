# Patrones de Rechazo para Implementar Sistemas Preventivos

Este documento registra los motivos de rechazo después de la primera reescritura, para implementar sistemas preventivos como el vocabulario histórico.

---

## Patrón #1: Anacronismos Terminológicos (IMPLEMENTADO)

**Proyecto afectado**: Observador de las Sombras (Capítulo 15)  
**Género**: historical_thriller  
**Problema**: El Ghostwriter usa términos científicos modernos en contextos históricos  

**Ejemplos detectados**:
- "Claviceps purpurea" (latín científico moderno) en lugar de "el hongo del centeno"
- "formol/formaldehído" (s. XIX) en lugar de "aceites aromáticos"
- "bacteria/virus" en lugar de "miasma/humores pútridos"
- "parálisis de análisis" (término psicológico moderno)

**Solución implementada**: Diccionario `HISTORICAL_VOCABULARY` en `orchestrator.ts`
- Lista de términos prohibidos por género
- Alternativas válidas para la época
- Vocabulario de época sugerido

**Estado**: IMPLEMENTADO (23/12/2025)

---

## Patrón #2: [PENDIENTE DE REGISTRO]

**Proyecto afectado**:  
**Género**:  
**Problema**:  

**Ejemplos detectados**:
- 

**Solución propuesta**:

**Estado**: PENDIENTE

---

## Patrón #3: [PENDIENTE DE REGISTRO]

**Proyecto afectado**:  
**Género**:  
**Problema**:  

**Ejemplos detectados**:
- 

**Solución propuesta**:

**Estado**: PENDIENTE

---

## Notas de Seguimiento

Cuando un capítulo sea rechazado después del primer intento de reescritura:
1. Registrar el diagnóstico del Editor aquí
2. Identificar si es un patrón recurrente
3. Diseñar sistema preventivo (vocabulario, reglas, prohibiciones)
4. Implementar en `buildRefinementInstructions()` o en el prompt del Ghostwriter

---

## Patrones Conocidos de Revisiones Finales (Para Referencia)

De las novelas completadas:

### "La escriba de la Via Augusta"
- **repeticion_lexica**: "parálisis de análisis" (7+ veces) - término anacrónico
- **continuidad_fisica**: Cambios de color de ojos entre capítulos
- **arcos_incompletos**: Salto lógico entre sentencia y epílogo

### "La Sombra del Nilo"  
- **arcos_incompletos**: Contradicción sobre documentos quemados vs escondidos
- **continuidad_ubicacion**: Direcciones geográficas incorrectas

### "Código de Silencio"
- **repeticion_lexica**: "cicatriz de quemadura en el dorso de la mano derecha" (14+ veces)
- **coherencia_temporal**: Epílogo colocado al inicio

---

*Este documento debe actualizarse cada vez que se identifique un nuevo patrón de rechazo recurrente.*
