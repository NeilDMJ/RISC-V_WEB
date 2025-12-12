
import { RISCVProcessor, Stage } from './cpu.js';
import { toHex32, toInt32 } from './utils.js';
import { assembleProgram } from './utils.js';

let lastDecoded = null;
let currentDecoded = null; // Para actualizar cuando cambia el formato
const cpu = new RISCVProcessor();
let runInterval = null;
let displayFormat = 'dec'; // 'hex', 'dec', 'bin'
let executionDelay = 600; // Delay en ms entre ciclos de ejecución
let currentMemoryView = 'grid'; // 'grid' o 'table'

// ABI names para los registros
const ABI_NAMES = [
    'zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2',
    's0', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5',
    'a6', 'a7', 's2', 's3', 's4', 's5', 's6', 's7',
    's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6'
];

/* ============================================================
   INICIO
============================================================ */
document.addEventListener('DOMContentLoaded', () => {
    loadDatapathSVG();
    updateUI();

    // Event listeners seguros (verifica que el elemento existe antes de agregar listener)
    const btnStep = document.getElementById('btn-step');
    const btnRun = document.getElementById('btn-run');
    const btnReset = document.getElementById('btn-reset');
    const btnLoad = document.getElementById('btn-load');
    const btnFullscreen = document.getElementById('btn-fullscreen');
    const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
    const btnCollapseSidebar = document.getElementById('btn-collapse-sidebar');

    if (btnStep) btnStep.addEventListener('click', handleStep);
    if (btnRun) btnRun.addEventListener('click', handleRun);
    if (btnReset) btnReset.addEventListener('click', handleReset);
    if (btnLoad) btnLoad.addEventListener('click', handleLoad);
    if (btnFullscreen) btnFullscreen.addEventListener('click', handleFullscreen);
    if (btnToggleSidebar) btnToggleSidebar.addEventListener('click', toggleSidebar);
    if (btnCollapseSidebar) btnCollapseSidebar.addEventListener('click', toggleSidebar);
    
    // Configurar selector de formato
    setupFormatSelector();
    
    // Configurar control de velocidad
    setupSpeedControl();
    
    // Configurar toggle de vistas de memoria
    setupMemoryViewToggle();
});

/* ============================================================
   CARGAR SVG DEL DATAPATH
============================================================ */
async function loadDatapathSVG() {
    try {
        const response = await fetch('procesador.svg');
        const svgText = await response.text();
        
        const container = document.getElementById('datapath-container');
        container.innerHTML = svgText;
        
        // Ajustar el SVG al contenedor
        const svg = container.querySelector('svg');
        if (svg) {
            svg.style.width = '100%';
            svg.style.height = '100%';
            svg.style.position = 'relative';
            svg.style.zIndex = '2';
        }
    } catch (error) {
        console.error('Error cargando el SVG del datapath:', error);
    }
}

/* ============================================================
   MEMORY VIEW TOGGLE
============================================================ */
function setupMemoryViewToggle() {
    const viewBtns = document.querySelectorAll('.view-btn');
    const gridView = document.getElementById('memory-grid-view');
    const tableView = document.getElementById('memory-table-view');
    
    viewBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            viewBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const view = btn.dataset.view;
            
            if (view === 'grid') {
                gridView.classList.add('active');
                tableView.classList.remove('active');
                currentMemoryView = 'grid';
            } else {
                gridView.classList.remove('active');
                tableView.classList.add('active');
                currentMemoryView = 'table';
            }
        });
    });
}

/* ============================================================
   SPEED CONTROL
============================================================ */
function setupSpeedControl() {
    const slider = document.getElementById('speed-slider');
    const valueDisplay = document.getElementById('speed-value');
    
    if (!slider) return;
    
    slider.addEventListener('input', (e) => {
        executionDelay = parseInt(e.target.value);
        valueDisplay.textContent = executionDelay + 'ms';
    });
}

function setupFormatSelector() {
    const toggleGroup = document.getElementById('format-toggle');
    
    if (!toggleGroup) {
        console.error('No se encontró el elemento format-toggle');
        return;
    }
    
    // Agregar listener DIRECTAMENTE al contenedor con event delegation
    toggleGroup.addEventListener('click', function(e) {
        // Verificar si es un botón
        if (!e.target.classList.contains('format-toggle-btn')) {
            return;
        }
        
        const btn = e.target;
        const format = btn.dataset.format;
        
        // Prevenir comportamiento por defecto
        e.preventDefault();
        e.stopPropagation();
        
        // Actualizar estado visual
        const allBtns = toggleGroup.querySelectorAll('.format-toggle-btn');
        allBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Actualizar formato global
        displayFormat = format;
        
        // Re-renderizar valores
        if (currentDecoded) {
            updateFormatTableValues(currentDecoded);
        }
    }, true); // Capture phase para asegurar que se dispare
}

/* ============================================================
   TOGGLE SIDEBAR
============================================================ */
function toggleSidebar() {
    const mainLayout = document.querySelector('.main-layout');
    mainLayout.classList.toggle('sidebar-collapsed');
    
    // Rotar el icono del botón collapse
    const collapseBtn = document.getElementById('btn-collapse-sidebar');
    if (mainLayout.classList.contains('sidebar-collapsed')) {
        collapseBtn.querySelector('svg').style.transform = 'rotate(180deg)';
    } else {
        collapseBtn.querySelector('svg').style.transform = 'rotate(0deg)';
    }
}

/* ============================================================
   STEP
============================================================ */
let isStepInProgress = false;

async function handleStep() {
    if (isStepInProgress) return;
    isStepInProgress = true;

    const result = await cpu.stepWithStageDelay(updateStageIndicator, 400);
    if (result) {
        // Detectar si la instrucción accede a memoria
        if (result.decoded.opcode === 0x03 || result.decoded.opcode === 0x23) {
            const addrIndex = (result.alu_res >>> 2) & 0x1f;
            const operation = result.decoded.opcode === 0x03 ? 'READ' : 'WRITE';
            updateMemoryStats(addrIndex * 4, operation);
        }
        updateUI(result);
    }
    
    isStepInProgress = false;
}

/* ============================================================
   RUN / PAUSE
============================================================ */
let isRunning = false;

async function handleRun(e) {
    const btn = e.target.closest('button');
    const span = btn.querySelector('span');

    if (isRunning) {
        isRunning = false;
        span.textContent = "Run";
        btn.classList.remove("active");
        return;
    }

    btn.classList.add("active");
    span.textContent = "Pause";
    isRunning = true;

    async function runLoop() {
        while (isRunning && !cpu.state.halted) {
            const stageDelay = Math.min(executionDelay / 5, 300);
            const result = await cpu.stepWithStageDelay(updateStageIndicator, stageDelay);
            if (result) updateUI(result);
            await new Promise(resolve => setTimeout(resolve, executionDelay / 5));
        }

        if (cpu.state.halted || !isRunning) {
            isRunning = false;
            btn.classList.remove("active");
            span.textContent = "Run";
        }
    }
    
    runLoop();
}

/* ============================================================
   RESET
============================================================ */
function handleReset() {
    isRunning = false;
    isStepInProgress = false;
    
    const runBtn = document.getElementById('btn-run');
    runBtn.querySelector('span').textContent = "Run";
    runBtn.classList.remove('active');

    lastDecoded = null;
    memoryAccessCount = 0;
    lastMemoryAddr = null;
    lastMemoryOp = '--';
    
    cpu.reset();
    updateUI();
    
    // Resetear estadísticas de memoria
    document.getElementById('memory-access-count').textContent = '0';
    document.getElementById('memory-last-addr').textContent = '--';
    document.getElementById('memory-last-op').textContent = '--';

    document.querySelectorAll('.stage-pill').forEach(el => el.classList.remove('active'));
}

/* ============================================================
   LOAD PROGRAM
============================================================ */
function handleLoad() {
    const code = document.getElementById('program-input').value.trim();
    if (!code) return;

    let program;

    if (/^[0-9a-fA-F]+$/.test(code.split("\n")[0].trim())) {
        program = code;
    } else {
        const hexArray = assembleProgram(code);
        program = hexArray.map(x => x.toString(16).padStart(8, "0")).join("\n");
    }

    lastDecoded = null;
    cpu.loadProgram(program);
    updateUI();
    showToast("Programa cargado exitosamente", "success");
}

/* ============================================================
   TOAST NOTIFICATIONS
============================================================ */
function showToast(message, type = "info") {
    // Remover toast anterior si existe
    const existingToast = document.querySelector('.toast');
    if (existingToast) existingToast.remove();
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--success-color)">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <span>${message}</span>
    `;
    document.body.appendChild(toast);
    
    // Trigger animation
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });
    
    // Remove after 3 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

/* ============================================================
   FULLSCREEN
============================================================ */
function handleFullscreen() {
    const section = document.getElementById('datapath-section');

    if (!document.fullscreenElement) {
        section.classList.add('fullscreen');
        section.requestFullscreen?.();
    } else {
        document.exitFullscreen?.();
    }
}

document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement)
        document.getElementById('datapath-section').classList.remove('fullscreen');
});

/* ============================================================
   STAGE INDICATOR
============================================================ */
function updateStageIndicator(stage) {
    // Actualizar pills
    document.querySelectorAll('.stage-pill').forEach(el => el.classList.remove('active'));

    const ids = {
        [Stage.FETCH]: 'stage-fetch',
        [Stage.DECODE]: 'stage-decode',
        [Stage.EXEC]: 'stage-exec',
        [Stage.MEM]: 'stage-mem',
        [Stage.WB]: 'stage-wb'
    };

    const el = document.getElementById(ids[stage]);
    if (el) el.classList.add("active");
    
    // Iluminar componentes del datapath
    illuminateDatapathComponents(stage);
}

/* ============================================================
   ILUMINAR COMPONENTES DEL DATAPATH SEGÚN ETAPA
============================================================ */
function illuminateDatapathComponents(stage) {
    // Limpiar todas las clases active del SVG
    const svg = document.querySelector('#datapath-container svg');
    if (!svg) return;
    
    svg.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
    
    // Definir qué componentes se iluminan en cada etapa
    const stageComponents = {
        [Stage.FETCH]: [
            // Componentes principales
            '#pc',
            '#instr-mem',
            '#pc-adder',
            // Buses de datos
            '#path57', '#path58', '#path59',
            'path[id^="bus-pc"]'
        ],
        [Stage.DECODE]: [
            // Componentes principales
            '#instr-mem',
            '#control-unit',
            '#registers',
            '#sign-extend',
            // Buses de datos
            'path[id^="path50"]',
            'path[id^="path51"]',
            'path[id^="imm"]',
            // Líneas de control activas desde control unit
            '#alu-op',      // Control de operación ALU
            '#alu-src',     // Control de fuente para ALU (reg vs imm)
            '#wem',         // Write enable memoria
            '#wer',         // Write enable registros
            '#alu2reg',     // Control mux write-back
            '#branch',      // Señal de branch
            '#br-neg',      // Señal de branch negado
            '#imm-rd'       // Línea de inmediato hacia rd
        ],
        [Stage.EXEC]: [
            // Componentes principales
            '#alu',
            '#mux-alu-a',
            '#registers',
            '#sign-extend',
            // Buses de datos
            'path[id^="path3"]',
            'path[id^="path81"]',
            'path[id^="path90"]',   // a2 - segundo operando ALU
            'path[id^="path92"]',   // ad - dirección desde registros
            // Líneas de control activas
            '#alu-op',      // Operación de la ALU
            '#alu-src',     // Selección de fuente para ALU
            '#branch',      // Branch activo en etapa de ejecución
            '#br-neg'       // Branch negado
        ],
        [Stage.MEM]: [
            // Componentes principales
            '#data-mem',
            '#alu',
            // Buses de datos
            'path[id^="path78"]',
            'path[id^="path82"]',
            'path[id^="path84"]',
            'path[id^="path80"]',
            'path[id^="path86"]',   // do2 - dato de memoria
            // Líneas de control activas
            '#wem',         // Write enable para memoria de datos
            '#branch',      // Branch (decisión basada en resultado ALU)
            '#br-neg'       // Branch negado
        ],
        [Stage.WB]: [
            // Componentes principales
            '#mux-wb',
            '#data-mem',
            '#registers',
            // Buses de datos
            'path[id^="alu-reg"]',
            'path[id^="path91"]',   // di - dato hacia registros
            // Líneas de control activas
            '#alu2reg',     // Selección de fuente para write-back (ALU vs MEM)
            '#wer'          // Write enable para banco de registros
        ]
    };
    
    // Obtener componentes para la etapa actual
    const componentsToIlluminate = stageComponents[stage] || [];
    
    // Iluminar cada componente
    componentsToIlluminate.forEach(selector => {
        const elements = svg.querySelectorAll(selector);
        elements.forEach(el => {
            el.classList.add('active');
        });
    });
}

/* ============================================================
   ILUMINAR SOLO LOS CAMPOS QUE CAMBIAN
============================================================ */
function highlightDecodeOnlyOnChange(decoded) {
    if (!decoded) return;

    const opcode = decoded.opcode;

    // Determinar tipo de instrucción
    const isR = opcode === 0x33;
    const isI = opcode === 0x13 || opcode === 0x03 || opcode === 0x67;
    const isS = opcode === 0x23;
    const isB = opcode === 0x63;
    const isU = opcode === 0x37 || opcode === 0x17;
    const isJ = opcode === 0x6f;

    // Actualizar badge de tipo
    const typeBadge = document.getElementById('instruction-type');
    typeBadge.className = 'instruction-type-badge';
    
    if (isR) { typeBadge.textContent = 'R-Type'; typeBadge.classList.add('r-type'); }
    else if (isI) { typeBadge.textContent = 'I-Type'; typeBadge.classList.add('i-type'); }
    else if (isS) { typeBadge.textContent = 'S-Type'; typeBadge.classList.add('s-type'); }
    else if (isB) { typeBadge.textContent = 'B-Type'; typeBadge.classList.add('b-type'); }
    else if (isU) { typeBadge.textContent = 'U-Type'; typeBadge.classList.add('u-type'); }
    else if (isJ) { typeBadge.textContent = 'J-Type'; typeBadge.classList.add('j-type'); }
    else { typeBadge.textContent = '--'; }

    // Si NO cambia la instrucción → NO animar
    if (lastDecoded && JSON.stringify(lastDecoded) === JSON.stringify(decoded))
        return;

    lastDecoded = decoded;

    // Ejecutar animación de fusión de campos
    animateInstructionFormat(decoded, { isR, isI, isS, isB, isU, isJ });
}

/* ============================================================
   ANIMACIÓN DE FUSIÓN DE CAMPOS PARA INMEDIATOS
============================================================ */
function animateInstructionFormat(decoded, types) {
    const { isR, isI, isS, isB, isU, isJ } = types;
    
    // Restaurar tabla al estado original primero
    resetFormatTable();
    
    // Delay para ver el estado inicial
    setTimeout(() => {
        // Iluminar campos activos
        document.getElementById('field-opcode').classList.add('active');
        
        if (isR) {
            // R-Type: todos los campos normales
            ['field-funct7', 'field-rs2', 'field-rs1', 'field-funct3', 'field-rd'].forEach((id, i) => {
                setTimeout(() => {
                    document.getElementById(id)?.classList.add('active');
                }, i * 100);
            });
        }
        
        else if (isI) {
            // I-Type: funct7 + rs2 se fusionan en imm[11:0]
            ['field-rs1', 'field-funct3', 'field-rd'].forEach((id, i) => {
                setTimeout(() => {
                    document.getElementById(id)?.classList.add('active');
                }, i * 100);
            });
            
            // Animación de fusión para imm[11:0]
            setTimeout(() => {
                mergeFieldsForImmediate(['field-funct7', 'field-rs2'], 'imm[11:0]', decoded.imm, 2);
            }, 400);
        }
        
        else if (isS) {
            // S-Type: funct7 = imm[11:5], rd = imm[4:0]
            ['field-rs1', 'field-rs2', 'field-funct3'].forEach((id, i) => {
                setTimeout(() => {
                    document.getElementById(id)?.classList.add('active');
                }, i * 100);
            });
            
            // Animación de fusión para los inmediatos
            setTimeout(() => {
                transformFieldToImm('field-funct7', 'imm[11:5]', (decoded.imm >> 5) & 0x7F);
                transformFieldToImm('field-rd', 'imm[4:0]', decoded.imm & 0x1F);
            }, 400);
        }
        
        else if (isB) {
            // B-Type: similar a S-Type
            ['field-rs1', 'field-rs2', 'field-funct3'].forEach((id, i) => {
                setTimeout(() => {
                    document.getElementById(id)?.classList.add('active');
                }, i * 100);
            });
            
            setTimeout(() => {
                transformFieldToImm('field-funct7', 'imm[12|10:5]', '');
                transformFieldToImm('field-rd', 'imm[4:1|11]', '');
            }, 400);
        }
        
        else if (isU || isJ) {
            // U-Type y J-Type: funct7, rs2, rs1, funct3 se fusionan en imm[31:12] o imm[20|...]
            document.getElementById('field-rd')?.classList.add('active');
            
            setTimeout(() => {
                const immLabel = isU ? 'imm[31:12]' : 'imm[20|10:1|11|19:12]';
                mergeFieldsForImmediate(['field-funct7', 'field-rs2', 'field-rs1', 'field-funct3'], immLabel, decoded.imm, 4);
            }, 400);
        }
        
    }, 200);
}

/* ============================================================
   FUSIONAR MÚLTIPLES CAMPOS EN UNO (PARA I-TYPE, U-TYPE, J-TYPE)
============================================================ */
function mergeFieldsForImmediate(fieldIds, immLabel, immValue, colspan) {
    const firstField = document.getElementById(fieldIds[0]);
    if (!firstField) return;
    
    // Añadir clase de preparación para fusión
    fieldIds.forEach((id, index) => {
        const field = document.getElementById(id);
        if (field) {
            field.classList.add('merging');
            if (index > 0) {
                // Los campos que se "comen" se desvanecen
                setTimeout(() => {
                    field.classList.add('merged-away');
                }, 200);
            }
        }
    });
    
    // Después de un delay, transformar el primer campo
    setTimeout(() => {
        firstField.classList.remove('merging');
        firstField.classList.add('merged-imm');
        firstField.setAttribute('colspan', colspan);
        
        // Cambiar contenido
        const nameSpan = firstField.querySelector('.field-name');
        const codeEl = firstField.querySelector('code');
        
        if (nameSpan) nameSpan.textContent = immLabel;
        if (codeEl) codeEl.textContent = immValue !== undefined ? immValue : '--';
        
        // Ocultar los otros campos
        fieldIds.slice(1).forEach(id => {
            const field = document.getElementById(id);
            if (field) {
                field.style.display = 'none';
            }
        });
        
    }, 500);
}

/* ============================================================
   TRANSFORMAR UN CAMPO INDIVIDUAL A INMEDIATO (PARA S-TYPE, B-TYPE)
============================================================ */
function transformFieldToImm(fieldId, immLabel, immValue) {
    const field = document.getElementById(fieldId);
    if (!field) return;
    
    field.classList.add('transforming-to-imm');
    
    setTimeout(() => {
        const nameSpan = field.querySelector('.field-name');
        const codeEl = field.querySelector('code');
        
        if (nameSpan) nameSpan.textContent = immLabel;
        if (codeEl && immValue !== '') codeEl.textContent = '0x' + immValue.toString(16);
        
        field.classList.remove('transforming-to-imm');
        field.classList.add('transformed-imm');
    }, 300);
}

/* ============================================================
   RESTAURAR TABLA AL FORMATO ORIGINAL
============================================================ */
function resetFormatTable() {
    const fields = [
        { id: 'field-funct7', name: 'funct7', valId: 'val-funct7' },
        { id: 'field-rs2', name: 'rs2', valId: 'val-rs2' },
        { id: 'field-rs1', name: 'rs1', valId: 'val-rs1' },
        { id: 'field-funct3', name: 'funct3', valId: 'val-funct3' },
        { id: 'field-rd', name: 'rd', valId: 'val-rd' },
        { id: 'field-opcode', name: 'opcode', valId: 'val-opcode' }
    ];
    
    fields.forEach(f => {
        const field = document.getElementById(f.id);
        if (field) {
            // Remover todas las clases de animación
            field.classList.remove('active', 'merging', 'merged-away', 'merged-imm', 
                                   'transforming-to-imm', 'transformed-imm', 'imm-field', 'imm-highlight');
            
            // Restaurar colspan
            field.removeAttribute('colspan');
            
            // Mostrar campo
            field.style.display = '';
            
            // Restaurar nombre original
            const nameSpan = field.querySelector('.field-name');
            if (nameSpan) nameSpan.textContent = f.name;
        }
    });
}


function getBinaryRepresentation(decoded) {
    if (!decoded) return '--------------------------------';
    
    const opcode = decoded.opcode;
    const rd = decoded.rd ?? 0;
    const rs1 = decoded.rs1 ?? 0;
    const rs2 = decoded.rs2 ?? 0;
    const funct3 = decoded.funct3 ?? 0;
    const funct7 = decoded.funct7 ?? 0;
    
    // Construir instrucción binaria según tipo
    const opcodeBin = opcode.toString(2).padStart(7, '0');
    const rdBin = rd.toString(2).padStart(5, '0');
    const rs1Bin = rs1.toString(2).padStart(5, '0');
    const rs2Bin = rs2.toString(2).padStart(5, '0');
    const funct3Bin = funct3.toString(2).padStart(3, '0');
    const funct7Bin = funct7.toString(2).padStart(7, '0');
    
    return `${funct7Bin} ${rs2Bin} ${rs1Bin} ${funct3Bin} ${rdBin} ${opcodeBin}`;
}

/* ============================================================
   UI UPDATES
============================================================ */
function updateUI(stepResult) {
    document.getElementById('ui-pc').textContent = toHex32(cpu.state.pc);
    document.getElementById('ui-cycle').textContent = cpu.state.cycle;

    renderRegisters();
    renderMemory();

    if (stepResult?.decoded) {
        const d = stepResult.decoded;
        currentDecoded = d; // Guardar para actualizar cuando cambie el formato

        // Actualizar tabla de formato de instrucción con formato seleccionado
        updateFormatTableValues(d);
        
        // Detalles adicionales - binario siempre igual
        document.getElementById('info-binary').textContent = getBinaryRepresentation(d);
        
        // Actualizar ASM en header si existe la función
        const asmEl = document.getElementById('ui-asm');
        if (asmEl && stepResult.asm) {
            asmEl.textContent = stepResult.asm;
        }

        highlightDecodeOnlyOnChange(d);
    }
}

/* ============================================================
   ACTUALIZAR VALORES DE LA TABLA CON FORMATO SELECCIONADO
============================================================ */
function updateFormatTableValues(d) {
    if (!d) return;
    
    // Aplicar formato a TODOS los campos según selección del usuario
    // Solo actualizamos el contenido de los elementos <code>, NO tocamos la estructura
    
    switch (displayFormat) {
        case 'hex':
            // Opcode en hex
            const opcodeHex = '0x' + d.opcode.toString(16).toUpperCase().padStart(2, '0');
            updateCodeElement('val-opcode', opcodeHex);
            
            // Registros en hex
            const rdHex = d.rd !== undefined ? '0x' + d.rd.toString(16).toUpperCase() : '--';
            const rs1Hex = d.rs1 !== undefined ? '0x' + d.rs1.toString(16).toUpperCase() : '--';
            const rs2Hex = d.rs2 !== undefined ? '0x' + d.rs2.toString(16).toUpperCase() : '--';
            updateCodeElement('val-rd', rdHex);
            updateCodeElement('val-rs1', rs1Hex);
            updateCodeElement('val-rs2', rs2Hex);
            
            // Funct en hex
            const funct3Hex = '0x' + d.funct3.toString(16).toUpperCase();
            const funct7Hex = '0x' + d.funct7.toString(16).toUpperCase().padStart(2, '0');
            updateCodeElement('val-funct3', funct3Hex);
            updateCodeElement('val-funct7', funct7Hex);
            
            // Inmediato en hex
            const immHex = d.imm !== undefined ? '0x' + (d.imm >>> 0).toString(16).toUpperCase().padStart(8, '0') : '--';
            updateCodeElement('info-imm', immHex);
            break;
            
        case 'bin':
            // Opcode en binario
            const opcodeBin = d.opcode.toString(2).padStart(7, '0');
            updateCodeElement('val-opcode', opcodeBin);
            
            // Registros en binario
            const rdBin = d.rd !== undefined ? d.rd.toString(2).padStart(5, '0') : '--';
            const rs1Bin = d.rs1 !== undefined ? d.rs1.toString(2).padStart(5, '0') : '--';
            const rs2Bin = d.rs2 !== undefined ? d.rs2.toString(2).padStart(5, '0') : '--';
            updateCodeElement('val-rd', rdBin);
            updateCodeElement('val-rs1', rs1Bin);
            updateCodeElement('val-rs2', rs2Bin);
            
            // Funct en binario
            const funct3Bin = d.funct3.toString(2).padStart(3, '0');
            const funct7Bin = d.funct7.toString(2).padStart(7, '0');
            updateCodeElement('val-funct3', funct3Bin);
            updateCodeElement('val-funct7', funct7Bin);
            
            // Inmediato en binario
            const immBin = d.imm !== undefined ? (d.imm >>> 0).toString(2).padStart(32, '0') : '--';
            updateCodeElement('info-imm', immBin);
            break;
            
        case 'dec':
        default:
            // Opcode en decimal
            updateCodeElement('val-opcode', d.opcode.toString());
            
            // Registros en decimal
            const rdDec = d.rd !== undefined ? d.rd.toString() : '--';
            const rs1Dec = d.rs1 !== undefined ? d.rs1.toString() : '--';
            const rs2Dec = d.rs2 !== undefined ? d.rs2.toString() : '--';
            updateCodeElement('val-rd', rdDec);
            updateCodeElement('val-rs1', rs1Dec);
            updateCodeElement('val-rs2', rs2Dec);
            
            // Funct en decimal
            updateCodeElement('val-funct3', d.funct3.toString());
            updateCodeElement('val-funct7', d.funct7.toString());
            
            // Inmediato en decimal - convertir a int32 con signo
            const immDec = d.imm !== undefined ? toInt32(d.imm).toString() : '--';
            updateCodeElement('info-imm', immDec);
            break;
    }
}


function updateCodeElement(elementId, value) {
    const el = document.getElementById(elementId);
    if (el) {
        el.textContent = value;
    }
}


function renderRegisters() {
    const tbody = document.querySelector('#registers-table tbody');
    tbody.innerHTML = "";

    for (let i = 0; i < 32; i++) {
        const regVal = cpu.state.regs[i] >>> 0;
        const hexVal = toHex32(regVal);
        const abiName = ABI_NAMES[i];

        const tr = document.createElement('tr');

        tr.innerHTML = `
            <td class="col-reg">x${i}</td>
            <td class="col-alias">${abiName}</td>
            <td class="col-hex">${hexVal}</td>
            <td class="col-dec">
                <input 
                    type="text" 
                    class="reg-dec-input" 
                    data-reg="${i}" 
                    value="${regVal}" 
                >
            </td>
        `;

        // Actualizar registro cuando escriban en el input
        tr.querySelector("input").addEventListener("change", e => {
            let val = parseInt(e.target.value);
            if (i === 0) val = 0;
            if (Number.isNaN(val)) val = 0;
            cpu.state.regs[i] = val >>> 0;
            renderRegisters();
        });

        tbody.appendChild(tr);
    }
}

/* ============================================================
   RENDER MEMORY (AMBAS VISTAS)
============================================================ */
let memoryAccessCount = 0;
let lastMemoryAddr = null;
let lastMemoryOp = '--';

function renderMemory() {
    renderMemoryGrid();
    renderMemoryTable();
}

function renderMemoryGrid() {
    const grid = document.getElementById('memory-grid');
    if (!grid) return;
    
    grid.innerHTML = '';

    for (let i = 0; i < 32; i++) {
        const memAddr = i * 4;
        const memVal = cpu.state.dataMem[i] >>> 0;
        const hexVal = memVal.toString(16).toUpperCase().padStart(8, '0');
        const decVal = memVal.toString();

        const cell = document.createElement('div');
        cell.className = 'memory-cell' + (lastMemoryAddr === memAddr ? ' active' : '');
        cell.innerHTML = `
            <div class="memory-cell-addr">0x${memAddr.toString(16).toUpperCase().padStart(2, '0')}</div>
            <div class="memory-cell-value">${hexVal}</div>
            <div class="memory-cell-dec">${decVal > 1000 ? (decVal / 1000).toFixed(1) + 'K' : decVal}</div>
        `;
        
        cell.addEventListener('click', () => {
            showMemoryDetail(i, memVal);
        });
        
        grid.appendChild(cell);
    }
}

function renderMemoryTable() {
    const tbody = document.querySelector('#memory-table tbody');
    if (!tbody) return;
    
    tbody.innerHTML = '';

    for (let i = 0; i < 32; i++) {
        const memAddr = i * 4;
        const memVal = cpu.state.dataMem[i] >>> 0;
        const hexVal = '0x' + memVal.toString(16).toUpperCase().padStart(8, '0');
        const decVal = memVal.toString();

        const tr = document.createElement('tr');
        tr.className = lastMemoryAddr === memAddr ? 'memory-active' : '';

        tr.innerHTML = `
            <td class="col-addr">0x${memAddr.toString(16).toUpperCase().padStart(2, '0')}</td>
            <td class="col-offset">[${i}]</td>
            <td class="col-hex">${hexVal}</td>
            <td class="col-dec">${decVal}</td>
        `;

        tbody.appendChild(tr);
    }
}

function showMemoryDetail(index, value) {
    // Aquí se puede agregar un tooltip o modal con más detalles
    console.log(`Memory[${index}] = 0x${value.toString(16).padStart(8, '0')} (${value})`);
}

function updateMemoryStats(lastAddr, operation = 'READ') {
    if (lastAddr !== null && lastAddr !== lastMemoryAddr) {
        memoryAccessCount++;
        lastMemoryAddr = lastAddr;
        lastMemoryOp = operation;
        
        document.getElementById('memory-access-count').textContent = memoryAccessCount;
        document.getElementById('memory-last-addr').textContent = '0x' + lastAddr.toString(16).toUpperCase().padStart(2, '0');
        document.getElementById('memory-last-op').textContent = operation;
    }
}
