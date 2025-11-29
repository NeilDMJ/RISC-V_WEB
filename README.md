# Simulador Visual de Procesador RISC-V 32-bit

## Descripción

Página web interactiva que muestra el funcionamiento de un procesador con arquitectura RISC-V de 32 bits. El simulador visualiza la arquitectura del procesador e ilumina progresivamente cada componente utilizado durante la ejecución de instrucciones, permitiendo comprender el ciclo de procesamiento paso a paso.

## Características

- **Visualización de arquitectura completa**: Diagrama SVG con todos los componentes principales del procesador (PC, Instruction Memory, Control Unit, Register File, ALU, Data Memory, Multiplexores)

- **Simulación paso a paso**: Ejecuta instrucciones avanzando etapa por etapa a través del pipeline de 5 etapas

- **Iluminación dinámica**: Los componentes y buses de datos se iluminan conforme son utilizados en cada etapa del procesamiento

- **Múltiples tipos de instrucciones**: Incluye ejemplos de instrucciones R-type, I-type, S-type y B-type

- **Modo automático**: Opción para ejecutar la simulación automáticamente con intervalos de tiempo

## Ciclo de Ejecución

El simulador implementa las cinco etapas del pipeline clásico RISC:

1. **FETCH**: Buscar la instrucción en memoria usando el Program Counter
2. **DECODE**: Decodificar la instrucción y leer registros
3. **EXECUTE**: Ejecutar la operación en la ALU
4. **MEMORY**: Acceder a memoria de datos (solo para LOAD/STORE)
5. **WRITE-BACK**: Escribir el resultado en el Register File

## Instrucciones Soportadas

- R-type: `add`, `sub`, `and`, `or`
- I-type: `addi`, `andi`, `ori`, `lw`
- S-type: `sw`
- B-type: `beq`, `bne`

## Objetivo Educativo

Esta herramienta está diseñada para estudiantes de arquitectura de computadoras que necesitan comprender visualmente cómo funciona un procesador RISC-V a nivel de hardware, mostrando el flujo de datos entre componentes durante la ejecución de diferentes tipos de instrucciones.
